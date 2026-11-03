// Asks the router to forward ports. Used only when no interface holds a public address.
export const ROUTER_MAPPED_PORTS: { port: number; protocol: "tcp" | "udp" }[] = [
    { port: 443, protocol: "tcp" },
    { port: 80, protocol: "tcp" },
    { port: 443, protocol: "udp" }
];

const MAPPING_TTL_MS = 60 * 60 * 1000;

export interface NatRouter {
    externalIp(): Promise<string>;
    mapPorts(internalHost: string): Promise<{ mapped: string[]; refused: string[] }>;
    release(): Promise<void>;
}

export async function discoverNatRouter(timeoutMs = 5000): Promise<NatRouter | undefined> {
    const { upnpNat } = await import("@achingbrain/nat-port-mapper");
    const client = upnpNat({ description: "bitsocial reachability", autoRefresh: false, ttl: MAPPING_TTL_MS });
    try {
        for await (const gateway of client.findGateways({ signal: AbortSignal.timeout(timeoutMs) })) {
            return {
                externalIp: () => gateway.externalIp({ signal: AbortSignal.timeout(timeoutMs) }),
                mapPorts: async (internalHost) => {
                    const mapped: string[] = [];
                    const refused: string[] = [];
                    for (const { port, protocol } of ROUTER_MAPPED_PORTS) {
                        const label = `${protocol.toUpperCase()} ${port}`;
                        try {
                            await gateway.map(port, internalHost, { protocol, externalPort: port, signal: AbortSignal.timeout(timeoutMs) });
                            mapped.push(label);
                        } catch {
                            refused.push(label);
                        }
                    }
                    return { mapped, refused };
                },
                release: () => gateway.stop({ signal: AbortSignal.timeout(timeoutMs) })
            };
        }
    } catch {
        // No router answered in time, which is the normal result on a host with a public address.
    }
    return undefined;
}
