import fs from "fs/promises";
import path from "path";
import { describe, expect, it } from "vitest";
import { directory as randomDirectory } from "tempy";
import { caddyfilePath } from "../../src/reachability/caddy.js";
import { applyKuboConfig } from "../../src/reachability/setup.js";
import {
    announcedNames,
    isNameHealthy,
    judgeName,
    NOT_CONFIGURED_MESSAGE,
    planIpChange,
    ReachabilityRuntime,
    STALE_NAME_DROP_AFTER_MS,
    type RuntimeDependencies
} from "../../src/reachability/runtime.js";
import { readReachabilityConfig, readReachabilityRuntimeStatus, reachabilityDir, writeReachabilityConfig, type ReachabilityConfig } from "../../src/reachability/state.js";

const V4 = "93.184.216.34";
const V4_NEW = "93.184.216.35";
const V6 = "2606:4700::1";

describe("planIpChange", () => {
    it("is no change when the same addresses are seen", () => {
        expect(planIpChange([V4, V6], [V6, V4])).toBeUndefined();
    });

    it("replaces a moved IPv4 and keeps IPv6", () => {
        expect(planIpChange([V4, V6], [V4_NEW, V6])).toEqual([V4_NEW, V6]);
    });

    it("does not read an empty result as the address going away", () => {
        expect(planIpChange([V4, V6], [])).toBeUndefined();
    });

    it("does not drop a family it found nothing for", () => {
        expect(planIpChange([V4, V6], [V6])).toBeUndefined();
    });

    it("adds a family that appeared", () => {
        expect(planIpChange([V4], [V4, V6])).toEqual([V4, V6]);
    });

    it("keeps the held address when peers also report another one", () => {
        expect(planIpChange([V4], [V4_NEW, V4])).toBeUndefined();
    });

    it("compares IPv6 as addresses, not strings", () => {
        expect(planIpChange(["2606:4700:0:0::1"], [V6])).toBeUndefined();
    });
});

const baseConfig = (overrides: Partial<ReachabilityConfig> = {}): ReachabilityConfig => ({
    version: 1,
    enabled: true,
    mode: "ip",
    wsPort: 4002,
    announce: [`/ip4/${V4}/tcp/443/tls/ws`],
    publicIps: [V4],
    staging: false,
    acmeDirectory: "https://acme-v02.api.letsencrypt.org/directory",
    caddyAdminPort: 2019,
    ...overrides
});

describe("announced names", () => {
    it("finds dns addresses and skips IPs", () => {
        const names = announcedNames(baseConfig({ domain: "node.example", announce: [`/ip4/${V4}/tcp/443/tls/ws`, "/dns4/node.example/tcp/443/tls/ws"] }));
        expect(names).toEqual([{ name: "node.example", address: "/dns4/node.example/tcp/443/tls/ws", onlyRequireResolution: false }]);
    });

    it("includes dropped names, so they can recover", () => {
        expect(announcedNames(baseConfig({ announce: [], droppedAnnounce: ["/dns4/node.example/tcp/443/tls/ws"] }))).toHaveLength(1);
    });

    it("only requires a proxied name to resolve", () => {
        const proxied = "/dns4/proxy.example/tcp/443/tls/ws";
        expect(announcedNames(baseConfig({ announce: [proxied], externalAnnounce: [proxied] }))[0]!.onlyRequireResolution).toBe(true);
        expect(announcedNames(baseConfig({ announce: ["/dns4/node.example/tcp/443/tls/ws"], domain: "node.example", domainForced: true }))[0]!.onlyRequireResolution).toBe(true);
    });

    it("judges health", () => {
        const direct = { name: "n", address: "a", onlyRequireResolution: false };
        expect(isNameHealthy(direct, { v4: [V4], v6: [] }, [V4])).toBe(true);
        expect(isNameHealthy(direct, { v4: ["1.1.1.1"], v6: [] }, [V4])).toBe(false);
        expect(isNameHealthy(direct, { v4: [], v6: [] }, [V4])).toBe(false);
        const proxied = { ...direct, onlyRequireResolution: true };
        expect(isNameHealthy(proxied, { v4: ["1.1.1.1"], v6: [] }, [V4])).toBe(true);
        expect(isNameHealthy(proxied, { v4: [], v6: [] }, [V4])).toBe(false);
    });
});

describe("judgeName", () => {
    const start = Date.parse("2026-11-02T00:00:00Z");

    it("warns at the first failure and records when it began", () => {
        expect(judgeName(false, undefined, undefined, start)).toEqual({ warn: true, drop: false, restore: false, failingSince: new Date(start).toISOString() });
    });

    it("warns once per hour", () => {
        const previous = { failingSince: new Date(start).toISOString() };
        expect(judgeName(false, previous, start, start + 59 * 60_000).warn).toBe(false);
        expect(judgeName(false, previous, start, start + 60 * 60_000).warn).toBe(true);
    });

    it("drops at 24 hours and not before", () => {
        const previous = { failingSince: new Date(start).toISOString() };
        expect(judgeName(false, previous, undefined, start + STALE_NAME_DROP_AFTER_MS - 1).drop).toBe(false);
        expect(judgeName(false, previous, undefined, start + STALE_NAME_DROP_AFTER_MS).drop).toBe(true);
    });

    it("does not drop twice", () => {
        expect(judgeName(false, { failingSince: new Date(start).toISOString(), droppedFromAnnounce: true }, undefined, start + 2 * STALE_NAME_DROP_AFTER_MS).drop).toBe(false);
    });

    it("restores a recovered name that was dropped, and clears the failure", () => {
        expect(judgeName(true, { failingSince: "x", droppedFromAnnounce: true }, undefined, start)).toEqual({ warn: false, drop: false, restore: true });
        expect(judgeName(true, { failingSince: "x" }, undefined, start)).toEqual({ warn: false, drop: false, restore: false });
    });
});

describe("ReachabilityRuntime", () => {
    const setup = async (config?: ReachabilityConfig, overrides: Partial<RuntimeDependencies> = {}) => {
        const dataPath = randomDirectory();
        const kuboRepoPath = path.join(dataPath, "repo");
        await fs.mkdir(kuboRepoPath, { recursive: true });
        await fs.writeFile(path.join(kuboRepoPath, "config"), JSON.stringify({ Addresses: { Swarm: [], AppendAnnounce: [] }, Swarm: {} }));
        await fs.mkdir(reachabilityDir(dataPath), { recursive: true });
        if (config) {
            await applyKuboConfig(config, { dataPath, kuboRepoPath }, config.enabled);
            await fs.writeFile(caddyfilePath(dataPath), `{\n}\n\nhttps://${V4} {\n}\n`);
        }
        const events: string[] = [];
        let clock = Date.parse("2026-11-02T00:00:00Z");
        let onCaddyExit = () => {};
        let caddyUp = false;
        let derived: string[] = config?.publicIps ?? [];
        let records = { v4: [V4], v6: [] as string[] };
        const deps: RuntimeDependencies = {
            dataPath,
            kuboRepoPath,
            kuboRpcUrl: new URL("http://127.0.0.1:1/api/v0"),
            log: (message) => events.push(`log: ${message}`),
            warn: (message) => events.push(`warn: ${message}`),
            now: () => clock,
            derivePublicIps: async () => derived,
            resolveDomain: async () => records,
            restartKubo: async () => void events.push("restart kubo"),
            waitForIssuance: async (_config, names) => names,
            caddy: {
                start: async (onExit) => {
                    onCaddyExit = onExit;
                    caddyUp = true;
                    events.push("caddy start");
                },
                stop: async () => {
                    caddyUp = false;
                    events.push("caddy stop");
                },
                reload: async () => void events.push("caddy reload"),
                isUp: async () => caddyUp
            },
            ...overrides
        };
        const runtime = new ReachabilityRuntime(deps);
        return {
            deps,
            dataPath,
            kuboRepoPath,
            runtime,
            events,
            advance: (ms: number) => (clock += ms),
            setDerived: (ips: string[]) => (derived = ips),
            setRecords: (next: { v4: string[]; v6: string[] }) => (records = next),
            setCaddyUp: (up: boolean) => (caddyUp = up),
            crashCaddy: () => {
                caddyUp = false;
                onCaddyExit();
            }
        };
    };
    const kuboAnnounce = async (repo: string) => JSON.parse(await fs.readFile(path.join(repo, "config"), "utf-8")).Addresses.AppendAnnounce;

    it("prints one line when nothing is configured, and starts nothing", async () => {
        const { runtime, events } = await setup();
        await runtime.start();
        await runtime.stop();
        expect(events).toEqual([`warn: ${NOT_CONFIGURED_MESSAGE}`]);
    });

    it("stays quiet when the operator disabled it", async () => {
        const { runtime, events } = await setup(baseConfig({ enabled: false }));
        await runtime.start();
        await runtime.stop();
        expect(events).toEqual([]);
    });

    it("logs the addresses and starts Caddy", async () => {
        const { runtime, events } = await setup(baseConfig());
        await runtime.start();
        expect(events).toContain(`log: Browser addresses: /ip4/${V4}/tcp/443/tls/ws`);
        expect(events).toContain("caddy start");
        await runtime.stop();
    });

    it("does not start Caddy for a WebTransport-only or proxy-only node", async () => {
        const { runtime, events } = await setup(baseConfig({ publicIps: [], announce: [], mode: "webtransport-only" }));
        await fs.writeFile(caddyfilePath((runtime as any).deps.dataPath), "{\n}\n");
        await runtime.start();
        expect(events).not.toContain("caddy start");
        await runtime.stop();
    });

    it("brings Caddy back after a crash", async () => {
        const { runtime, events, crashCaddy } = await setup(baseConfig());
        await runtime.start();
        crashCaddy();
        await runtime.watchCaddy();
        expect(events.filter((event) => event === "caddy start")).toHaveLength(2);
        await runtime.stop();
    });

    it("adopts a Caddy already holding the admin port, rather than starting a second", async () => {
        const { runtime, events } = await setup(baseConfig(), { caddy: { start: async () => void events2.push("start"), stop: async () => {}, reload: async () => void events2.push("reload"), isUp: async () => true } });
        const events2: string[] = [];
        await runtime.watchCaddy();
        await runtime.stop();
        expect(events2).toEqual(["reload"]);
        expect(events).toEqual([]);
    });

    it("starts one Caddy when checks overlap during a slow start", async () => {
        let starts = 0;
        let up = false;
        const { runtime } = await setup(baseConfig(), {
            caddy: {
                start: async () => {
                    starts++;
                    await new Promise((resolve) => setTimeout(resolve, 50));
                    up = true;
                },
                stop: async () => {},
                reload: async () => {},
                isUp: async () => up
            }
        });
        await Promise.all([runtime.watchCaddy(), runtime.watchCaddy(), runtime.watchCaddy()]);
        expect(starts).toBe(1);
    });

    it("keeps running when the first Caddy start fails, and tries again", async () => {
        let attempts = 0;
        const { runtime, events } = await setup(baseConfig(), {
            caddy: {
                start: async () => {
                    attempts++;
                    if (attempts === 1) throw new Error("download failed");
                },
                stop: async () => {},
                reload: async () => {},
                isUp: async () => false
            }
        });
        await runtime.start();
        expect(events.some((event) => event.includes("download failed"))).toBe(true);
        await runtime.watchCaddy();
        expect(attempts).toBe(2);
        await runtime.stop();
    });

    it("keeps a dropped domain in the Caddyfile through an IP change, so it can recover", async () => {
        const domainAddress = "/dns4/node.example/tcp/443/tls/ws";
        const { runtime, dataPath, setDerived, setRecords } = await setup(baseConfig({ domain: "node.example", announce: [`/ip4/${V4}/tcp/443/tls/ws`], droppedAnnounce: [domainAddress], mode: "ip" }));
        setRecords({ v4: [], v6: [] });
        setDerived([V4_NEW]);
        await runtime.runChecks();
        await runtime.runChecks();
        expect(await fs.readFile(caddyfilePath(dataPath), "utf-8")).toContain("https://node.example");
    });

    it("notices an adopted Caddy stopping, and starts its own", async () => {
        const { runtime, events, setCaddyUp } = await setup(baseConfig());
        setCaddyUp(true);
        await runtime.watchCaddy();
        expect(events).not.toContain("caddy start");
        setCaddyUp(false);
        await runtime.watchCaddy();
        expect(events).toContain("caddy start");
        await runtime.stop();
    });

    it("does not lose the address when no certificate can be issued after an IP change, and retries", async () => {
        let issue = false;
        const { runtime, dataPath, events, setDerived } = await setup(baseConfig(), { waitForIssuance: async (_config, names) => (issue ? names : []) });
        const before = await fs.readFile(caddyfilePath(dataPath), "utf-8");
        setDerived([V4_NEW]);
        await runtime.runChecks();
        await runtime.runChecks();
        expect((await readReachabilityConfig(dataPath))!.publicIps).toEqual([V4]);
        expect(await fs.readFile(caddyfilePath(dataPath), "utf-8")).toBe(before);
        expect(events).not.toContain("restart kubo");

        issue = true;
        await runtime.runChecks();
        await runtime.runChecks();
        expect((await readReachabilityConfig(dataPath))!.publicIps).toEqual([V4_NEW]);
    });

    it("does not undo a disable that lands during an IP change", async () => {
        const context: { dataPath?: string; kuboRepoPath?: string } = {};
        const { runtime, dataPath, kuboRepoPath, setDerived } = await setup(baseConfig(), {
            waitForIssuance: async (_config, names) => {
                const current = (await readReachabilityConfig(context.dataPath!))!;
                await applyKuboConfig(current, { dataPath: context.dataPath!, kuboRepoPath: context.kuboRepoPath! }, false);
                return names;
            }
        });
        context.dataPath = dataPath;
        context.kuboRepoPath = kuboRepoPath;
        setDerived([V4_NEW]);
        await runtime.runChecks();
        await runtime.runChecks();
        expect((await readReachabilityConfig(dataPath))!.enabled).toBe(false);
        expect(await kuboAnnounce(kuboRepoPath)).toEqual([]);
    });

    describe("router leases", () => {
        const fakeRouter = () => {
            const calls: string[] = [];
            return {
                calls,
                router: {
                    externalIp: async () => V4,
                    mapPorts: async () => (calls.push("map"), { mapped: ["TCP 443"], refused: [] }),
                    release: async () => void calls.push("release")
                }
            };
        };
        const natDeps = (router: ReturnType<typeof fakeRouter>["router"]) => ({ discoverRouter: async () => router, hasPublicIpv4Interface: () => false, lanIpv4: () => "192.168.1.5" });

        it("asks for the forwards at daemon start, since setup's lease may have expired by then", async () => {
            const { calls, router } = fakeRouter();
            const { runtime } = await setup(baseConfig(), natDeps(router));
            await runtime.start();
            await runtime.leasesSettled();
            expect(calls).toContain("map");
            await runtime.stop();
        });

        it("does not touch the router on a machine with a public IPv4", async () => {
            const { calls, router } = fakeRouter();
            const { runtime } = await setup(baseConfig(), { ...natDeps(router), hasPublicIpv4Interface: () => true });
            await runtime.refreshLeases();
            expect(calls).toEqual([]);
        });

        it("releases the forwards instead of renewing them once disabled", async () => {
            const { calls, router } = fakeRouter();
            const { runtime, dataPath } = await setup(baseConfig(), natDeps(router));
            await runtime.refreshLeases();
            await writeReachabilityConfig(dataPath, baseConfig({ enabled: false }));
            calls.length = 0;
            await runtime.refreshLeases();
            expect(calls).toEqual(["release"]);
            await runtime.refreshLeases();
            expect(calls).toEqual(["release"]);
        });
    });

    it("reloads when the Caddyfile changes on a running daemon", async () => {
        const { runtime, dataPath, events } = await setup(baseConfig());
        await runtime.start();
        await runtime.watchCaddy();
        expect(events).not.toContain("caddy reload");
        await fs.writeFile(caddyfilePath(dataPath), `{\n}\n\nhttps://${V4_NEW} {\n}\n`);
        await runtime.watchCaddy();
        expect(events).toContain("caddy reload");
        await runtime.stop();
    });

    it("stops Caddy when disabled on a running daemon", async () => {
        const { runtime, dataPath, events } = await setup(baseConfig());
        await runtime.start();
        await writeReachabilityConfig(dataPath, baseConfig({ enabled: false }));
        await runtime.watchCaddy();
        expect(events).toContain("caddy stop");
        await runtime.stop();
    });

    it("waits for a second reading before acting on an IP change, then moves everything", async () => {
        const { runtime, dataPath, kuboRepoPath, events, setDerived } = await setup(baseConfig());
        await runtime.start();
        setDerived([V4_NEW]);
        await runtime.runChecks();
        expect(events).not.toContain("restart kubo");

        await runtime.runChecks();
        expect(events).toContain("restart kubo");
        expect(events).toContain("caddy reload");
        expect(await fs.readFile(caddyfilePath(dataPath), "utf-8")).toContain(V4_NEW);
        const newAddress = `/ip4/${V4_NEW}/tcp/443/tls/ws`;
        expect(await kuboAnnounce(kuboRepoPath)).toContain(newAddress);
        expect((await readReachabilityConfig(dataPath))!).toMatchObject({ publicIps: [V4_NEW], announce: [newAddress] });
        await runtime.stop();
    });

    it("ignores one odd reading", async () => {
        const { runtime, events, setDerived } = await setup(baseConfig());
        setDerived([V4_NEW]);
        await runtime.runChecks();
        setDerived([V4]);
        await runtime.runChecks();
        await runtime.runChecks();
        expect(events).not.toContain("restart kubo");
    });

    it("keeps a domain's address through an IP change", async () => {
        const domainAddress = "/dns4/node.example/tcp/443/tls/ws";
        const { runtime, dataPath, setDerived, setRecords } = await setup(baseConfig({ domain: "node.example", announce: [`/ip4/${V4}/tcp/443/tls/ws`, domainAddress], mode: "ip+domain" }));
        setRecords({ v4: [V4_NEW], v6: [] });
        setDerived([V4_NEW]);
        await runtime.runChecks();
        await runtime.runChecks();
        expect((await readReachabilityConfig(dataPath))!.announce).toEqual([`/ip4/${V4_NEW}/tcp/443/tls/ws`, domainAddress]);
    });

    describe("stale name", () => {
        const domainAddress = "/dns4/node.example/tcp/443/tls/ws";
        const domainConfig = () => baseConfig({ domain: "node.example", announce: [`/ip4/${V4}/tcp/443/tls/ws`, domainAddress], mode: "ip+domain" });

        it("warns hourly, drops at 24 hours, and restores on recovery", async () => {
            const { runtime, dataPath, kuboRepoPath, events, advance, setRecords } = await setup(domainConfig());
            setRecords({ v4: [], v6: [] });
            await runtime.runChecks();
            const warnings = () => events.filter((event) => event.startsWith("warn:") && event.includes("has not pointed")).length;
            expect(warnings()).toBe(1);

            advance(30 * 60_000);
            await runtime.runChecks();
            expect(warnings()).toBe(1);

            advance(31 * 60_000);
            await runtime.runChecks();
            expect(warnings()).toBe(2);
            expect((await readReachabilityConfig(dataPath))!.announce).toContain(domainAddress);

            advance(24 * 60 * 60_000);
            await runtime.runChecks();
            let config = (await readReachabilityConfig(dataPath))!;
            expect(config.announce).not.toContain(domainAddress);
            expect(config.droppedAnnounce).toEqual([domainAddress]);
            expect(await kuboAnnounce(kuboRepoPath)).not.toContain(domainAddress);
            expect(events).toContain("restart kubo");
            expect((await readReachabilityRuntimeStatus(dataPath))!.domains!["node.example"]).toMatchObject({ ok: false, droppedFromAnnounce: true });

            setRecords({ v4: [V4], v6: [] });
            await runtime.runChecks();
            config = (await readReachabilityConfig(dataPath))!;
            expect(config.announce).toContain(domainAddress);
            expect(config.droppedAnnounce).toBeUndefined();
            expect(await kuboAnnounce(kuboRepoPath)).toContain(domainAddress);
        });

        it("does not announce a name twice when setup already restored it", async () => {
            const { runtime, dataPath, setRecords, advance } = await setup(domainConfig());
            setRecords({ v4: [], v6: [] });
            await runtime.runChecks();
            advance(25 * 60 * 60_000);
            await runtime.runChecks();
            const dropped = (await readReachabilityConfig(dataPath))!;
            // What rerunning setup does once DNS is fixed: the address is back, and the status file is behind.
            await writeReachabilityConfig(dataPath, { ...dropped, announce: [...dropped.announce, domainAddress] });
            setRecords({ v4: [V4], v6: [] });
            await runtime.runChecks();
            expect((await readReachabilityConfig(dataPath))!.announce.filter((address) => address === domainAddress)).toHaveLength(1);
        });

        it("survives a daemon restart, so 24 hours is not reset", async () => {
            const { deps, runtime, dataPath, advance, setRecords } = await setup(domainConfig());
            setRecords({ v4: [], v6: [] });
            await runtime.runChecks();
            advance(25 * 60 * 60_000);
            await new ReachabilityRuntime(deps).runChecks();
            expect((await readReachabilityConfig(dataPath))!.droppedAnnounce).toEqual([domainAddress]);
        });

        it("does not treat a forced name pointing elsewhere as failing", async () => {
            const { runtime, events, setRecords } = await setup(baseConfig({ domain: "node.example", domainForced: true, announce: [domainAddress] }));
            setRecords({ v4: ["1.1.1.1"], v6: [] });
            await runtime.runChecks();
            expect(events.filter((event) => event.includes("has not pointed"))).toEqual([]);
        });
    });

    it("warns when a certificate has under 24 hours left, at most hourly", async () => {
        const { runtime, dataPath, events, advance } = await setup(baseConfig({ publicIps: ["203.0.113.7"], announce: [], acmeDirectory: "https://acme-v02.api.letsencrypt.org/directory" }), { derivePublicIps: async () => [] });
        const directory = path.join(dataPath, "reachability", "caddy-data", "certificates", "acme-v02.api.letsencrypt.org-directory", "203.0.113.7");
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(path.join(directory, "203.0.113.7.crt"), CERTIFICATE_EXPIRING_2126);
        advance(Date.parse("2126-10-09T00:00:00Z") - Date.parse("2026-11-02T00:00:00Z"));
        await runtime.runChecks();
        await runtime.runChecks();
        expect(events.filter((event) => event.includes("hours left"))).toHaveLength(1);
    });

    it("runs a damaged config past the daemon instead of throwing", async () => {
        const { runtime, dataPath, events } = await setup();
        await fs.writeFile(path.join(reachabilityDir(dataPath), "config.json"), "{ broken");
        await runtime.start();
        await runtime.stop();
        expect(events.some((event) => event.includes("Reachability is not running"))).toBe(true);
    });
});

const CERTIFICATE_EXPIRING_2126 = `-----BEGIN CERTIFICATE-----
MIIBwTCCAWigAwIBAgIULCKX6LXG4To/wQObUkjGcK75nXswCgYIKoZIzj0EAwIw
HDEaMBgGA1UEAwwRcmVhY2hhYmlsaXR5LXRlc3QwIBcNMjYxMTAyMTI1NzQxWhgP
MjEyNjEwMDkxMjU3NDFaMBwxGjAYBgNVBAMMEXJlYWNoYWJpbGl0eS10ZXN0MFkw
EwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAELndqlPuOzVu5TN+hSkn0IrB98qbFHS7K
iCj2zWR7niAi/octeM1WJe7hMYPSOHLKVeb6l9musqzB+oKJgf6BlqOBhTCBgjAd
BgNVHQ4EFgQU59HJ9KLzGmnyywqsFgO0q+SIQ44wHwYDVR0jBBgwFoAU59HJ9KLz
GmnyywqsFgO0q+SIQ44wDwYDVR0TAQH/BAUwAwEB/zAvBgNVHREEKDAmhwTLAHEH
hxAgAQ24AAAAAAAAAAAAAAAHggxub2RlLmV4YW1wbGUwCgYIKoZIzj0EAwIDRwAw
RAIgY0U1lu/j1wXrOBhZ09CaVWyCrwxwSJ8hIMqO7XAq2SACIFPBLDHJ67dGGXq+
Kd6p8xQWxlusPWNMReJkdwGvoLKZ
-----END CERTIFICATE-----
`;
