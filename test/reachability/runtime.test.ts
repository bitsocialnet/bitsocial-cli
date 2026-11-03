import fs from "fs/promises";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { directory as randomDirectory } from "tempy";
import { caddyBinaryPath, caddyfilePath, generateCaddyfile } from "../../src/reachability/caddy.js";
import { setcapCommand } from "../../src/reachability/guidance.js";
import { applyKuboConfig } from "../../src/reachability/setup.js";
import {
    announcedNames,
    CHECK_INTERVAL_MS,
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
const V6_NEW = "2606:4700::2";

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
        let onCaddyExit: (lastOutput?: string) => void = () => {};
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
            crashCaddy: (lastOutput?: string) => {
                caddyUp = false;
                onCaddyExit(lastOutput);
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

    describe("the warning when Caddy exits", () => {
        const exitWarnings = (events: string[]) => events.filter((event) => event.includes("Caddy exited"));

        it("warns about a crash, naming Caddy's last output", async () => {
            const { runtime, events, crashCaddy } = await setup(baseConfig());
            await runtime.start();
            crashCaddy();
            expect(exitWarnings(events)).toHaveLength(1);
            await runtime.stop();
        });

        describe("when Caddy may not bind its port, as after an upgrade to a binary without the capability", () => {
            // Caddy's real last line for this failure, captured from an unprivileged run.
            const DENIED = '{"level":"error","msg":"loading initial config: loading new config: http app module: start: listening on :443: listen tcp :443: bind: permission denied"}';
            const crashDenied = async (overrides: Partial<RuntimeDependencies>) => {
                const { runtime, dataPath, events, crashCaddy } = await setup(baseConfig(), overrides);
                await runtime.start();
                crashCaddy(DENIED);
                await runtime.stop();
                return { warning: exitWarnings(events).join("\n"), dataPath };
            };

            it("names the fix for the binary now in use on Linux", async () => {
                const { warning, dataPath } = await crashDenied({ platform: "linux", detectContainer: async () => false });
                expect(warning).toContain(setcapCommand(caddyBinaryPath(dataPath, "linux")));
                expect(warning).toContain("ip_unprivileged_port_start");
            });

            it("does not suggest sudo inside a container", async () => {
                const { warning } = await crashDenied({ platform: "linux", detectContainer: async () => true });
                expect(warning).toContain("NET_BIND_SERVICE");
                expect(warning).not.toContain("sudo");
            });

            it("does not suggest Linux commands on another OS", async () => {
                const { warning } = await crashDenied({ platform: "darwin", detectContainer: async () => false });
                expect(warning).toContain("permission denied");
                expect(warning).not.toContain("setcap");
            });

            it("adds nothing for another failure", async () => {
                const { runtime, events, crashCaddy } = await setup(baseConfig(), { platform: "linux", detectContainer: async () => false });
                await runtime.start();
                crashCaddy('{"level":"error","msg":"listen tcp :443: bind: address already in use"}');
                await runtime.stop();
                expect(exitWarnings(events).join("\n")).not.toContain("setcap");
            });
        });

        it("stays quiet about a Caddy it stopped itself", async () => {
            const { runtime, dataPath, events, crashCaddy } = await setup(baseConfig());
            await runtime.start();
            await writeReachabilityConfig(dataPath, baseConfig({ enabled: false }));
            await runtime.watchCaddy();
            crashCaddy();
            expect(exitWarnings(events)).toEqual([]);
            await runtime.stop();
        });

        it("still warns about the next crash after stopping an adopted Caddy, which never reports an exit", async () => {
            const { runtime, dataPath, events, setCaddyUp, crashCaddy } = await setup(baseConfig());
            setCaddyUp(true);
            await runtime.watchCaddy();
            await writeReachabilityConfig(dataPath, baseConfig({ enabled: false }));
            await runtime.watchCaddy();
            await writeReachabilityConfig(dataPath, baseConfig());
            await runtime.watchCaddy();
            expect(events.filter((event) => event === "caddy start")).toHaveLength(1);
            crashCaddy();
            expect(exitWarnings(events)).toHaveLength(1);
            await runtime.stop();
        });
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

    const caddyfileFor = (config: ReachabilityConfig, dataPath: string, domains: string[]) =>
        generateCaddyfile({ ips: config.publicIps, domains, wsPort: config.wsPort, adminPort: config.caddyAdminPort, dataDirectory: path.join(dataPath, "caddy"), acmeDirectory: config.acmeDirectory });

    it("does not add a proxy's name to the Caddyfile on an IP change, which would make Caddy order a certificate for it forever", async () => {
        const proxied = "/dns4/proxy.example/tcp/443/tls/ws";
        const config = baseConfig({ domain: "proxy.example", domainForced: true, announce: [`/ip4/${V4}/tcp/443/tls/ws`, proxied], externalAnnounce: [proxied], mode: "ip+reverse-proxy" });
        const { runtime, dataPath, setDerived } = await setup(config);
        // What setup leaves after the name's own issuance failed: "keep only what worked".
        await fs.writeFile(caddyfilePath(dataPath), caddyfileFor(config, dataPath, []));
        setDerived([V4_NEW]);
        await runtime.runChecks();
        await runtime.runChecks();
        const caddyfile = await fs.readFile(caddyfilePath(dataPath), "utf-8");
        expect(caddyfile).toContain(`https://${V4_NEW}`);
        expect(caddyfile).not.toContain("https://proxy.example");
        expect((await readReachabilityConfig(dataPath))!.announce).toEqual([`/ip4/${V4_NEW}/tcp/443/tls/ws`, proxied]);
    });

    it("keeps the site of a forced domain that did get its own certificate through an IP change", async () => {
        const address = "/dns4/proxy.example/tcp/443/tls/ws";
        const config = baseConfig({ domain: "proxy.example", domainForced: true, announce: [`/ip4/${V4}/tcp/443/tls/ws`, address], externalAnnounce: [address], mode: "ip+domain+reverse-proxy" });
        const { runtime, dataPath, setDerived } = await setup(config);
        await fs.writeFile(caddyfilePath(dataPath), caddyfileFor(config, dataPath, ["proxy.example"]));
        setDerived([V4_NEW]);
        await runtime.runChecks();
        await runtime.runChecks();
        expect(await fs.readFile(caddyfilePath(dataPath), "utf-8")).toContain("https://proxy.example");
    });

    it("keeps a dropped domain in the Caddyfile through an IP change, so it can recover", async () => {
        const domainAddress = "/dns4/node.example/tcp/443/tls/ws";
        const config = baseConfig({ domain: "node.example", announce: [`/ip4/${V4}/tcp/443/tls/ws`], droppedAnnounce: [domainAddress], mode: "ip" });
        const { runtime, dataPath, setDerived, setRecords } = await setup(config);
        await fs.writeFile(caddyfilePath(dataPath), caddyfileFor(config, dataPath, ["node.example"]));
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

    it("does not lose the address when no certificate can be issued after an IP change, and retries after the wait", async () => {
        let issue = false;
        const { runtime, dataPath, events, setDerived, advance } = await setup(baseConfig(), { waitForIssuance: async (_config, names) => (issue ? names : []) });
        const before = await fs.readFile(caddyfilePath(dataPath), "utf-8");
        setDerived([V4_NEW]);
        await runtime.runChecks();
        await runtime.runChecks();
        expect((await readReachabilityConfig(dataPath))!.publicIps).toEqual([V4]);
        expect(await fs.readFile(caddyfilePath(dataPath), "utf-8")).toBe(before);
        expect(events).not.toContain("restart kubo");

        issue = true;
        advance(60 * 60_000);
        await runtime.runChecks();
        await runtime.runChecks();
        expect((await readReachabilityConfig(dataPath))!.publicIps).toEqual([V4_NEW]);
    });

    describe("a moved address that cannot get a certificate at all", () => {
        const HOUR = 60 * 60_000;
        const movedAndFailing = async () => {
            const attempts: string[][] = [];
            const state = { issues: false };
            const context = await setup(baseConfig(), {
                waitForIssuance: async (_config, names) => {
                    attempts.push(names);
                    return state.issues ? names : [];
                }
            });
            context.setDerived([V4_NEW]);
            const checks = async (count: number) => {
                for (let i = 0; i < count; i++) {
                    await context.runtime.runChecks();
                    context.advance(CHECK_INTERVAL_MS);
                }
            };
            return { ...context, attempts, state, checks };
        };
        const failureWarnings = (events: string[]) => events.filter((event) => event.startsWith("warn:") && event.includes("No certificate could be issued"));

        // Let's Encrypt allows 5 failed validations per identifier per hour, and retrying every other
        // check is 6: the node would lock itself out past the moment the operator fixes its forwarding.
        it("orders at most once an hour, and waits longer after each failure", async () => {
            const { attempts, checks, advance, events } = await movedAndFailing();
            await checks(2);
            expect(attempts).toEqual([[V4_NEW]]);
            await checks(10);
            expect(attempts, "retried inside the first hour").toHaveLength(1);
            expect(failureWarnings(events)).toHaveLength(1);

            advance(HOUR);
            await checks(2);
            expect(attempts).toHaveLength(2);
            advance(HOUR);
            await checks(2);
            expect(attempts, "the wait did not grow after a second failure").toHaveLength(2);
            advance(HOUR);
            await checks(2);
            expect(attempts).toHaveLength(3);
        });

        it("tells the operator how long it waits and how not to", async () => {
            const { checks, events } = await movedAndFailing();
            await checks(2);
            expect(failureWarnings(events)[0]).toMatch(/try again in 1 h.*bitsocial reachability setup/);
        });

        it("keeps serving the stored address during the wait", async () => {
            const { checks, dataPath, events } = await movedAndFailing();
            const before = await fs.readFile(caddyfilePath(dataPath), "utf-8");
            await checks(6);
            expect((await readReachabilityConfig(dataPath))!.publicIps).toEqual([V4]);
            expect(await fs.readFile(caddyfilePath(dataPath), "utf-8")).toBe(before);
            expect(events).not.toContain("restart kubo");
        });

        it("stops waiting once setup got a certificate for a new address", async () => {
            const { attempts, checks, dataPath, setDerived } = await movedAndFailing();
            await checks(2);
            await writeReachabilityConfig(dataPath, { ...(await readReachabilityConfig(dataPath))!, publicIps: [V4_NEW] });
            setDerived([V4_NEW, "93.184.216.36"]);
            await checks(1);
            setDerived(["93.184.216.36"]);
            await checks(2);
            expect(attempts.at(-1)).toEqual(["93.184.216.36"]);
        });

        it("starts the wait from the beginning after a success", async () => {
            const { attempts, checks, advance, dataPath, state, setDerived } = await movedAndFailing();
            await checks(2);
            state.issues = true;
            advance(HOUR);
            await checks(2);
            expect((await readReachabilityConfig(dataPath))!.publicIps).toEqual([V4_NEW]);

            state.issues = false;
            setDerived(["93.184.216.36"]);
            const before = attempts.length;
            await checks(2);
            expect(attempts).toHaveLength(before + 1);
            advance(HOUR);
            await checks(2);
            expect(attempts, "a success should have reset the wait to 1 hour").toHaveLength(before + 2);
        });
    });

    describe("stopping while an IP change waits for its certificate", () => {
        // The real wait, which polls for 90 s, with a certificate that never comes.
        const stoppedDuringWait = async () => {
            const context = await setup(baseConfig());
            delete context.deps.waitForIssuance;
            const before = await fs.readFile(caddyfilePath(context.dataPath), "utf-8");
            context.setDerived([V4_NEW]);
            await context.runtime.runChecks();
            void context.runtime.runChecks();
            await vi.waitFor(async () => expect(await fs.readFile(caddyfilePath(context.dataPath), "utf-8")).toContain(V4_NEW), { timeout: 5000 });
            const outcome = await Promise.race([
                context.runtime.stop().then(() => "stopped"),
                new Promise((resolve) => setTimeout(() => resolve("still waiting"), 10_000))
            ]);
            return { ...context, before, outcome };
        };

        it("does not hold up the daemon's shutdown", async () => {
            expect((await stoppedDuringWait()).outcome).toBe("stopped");
        }, 20_000);

        it("does not leave an address without a certificate for the next start, or report a failure that did not happen", async () => {
            const { dataPath, before, events } = await stoppedDuringWait();
            expect(await fs.readFile(caddyfilePath(dataPath), "utf-8")).toBe(before);
            expect((await readReachabilityConfig(dataPath))!.publicIps).toEqual([V4]);
            expect(events.filter((event) => event.includes("No certificate could be issued"))).toEqual([]);
        }, 20_000);
    });

    describe("a family that cannot get a certificate", () => {
        const HOUR = 60 * 60_000;
        const failingV6 = async () => {
            const attempts: string[][] = [];
            const state = { v6Issues: false };
            const context = await setup(baseConfig(), {
                waitForIssuance: async (_config, names) => {
                    attempts.push(names);
                    return names.filter((ip) => ip !== V6 || state.v6Issues);
                }
            });
            context.setDerived([V4, V6]);
            const checks = async (count: number) => {
                for (let i = 0; i < count; i++) {
                    await context.runtime.runChecks();
                    context.advance(CHECK_INTERVAL_MS);
                }
            };
            return { ...context, attempts, state, checks };
        };

        it("backs off instead of asking the CA again on every check", async () => {
            const { attempts, checks, advance, dataPath, state } = await failingV6();
            await checks(2);
            expect(attempts).toEqual([[V4, V6]]);
            await checks(6);
            expect(attempts, "retried inside the first hour").toHaveLength(1);

            advance(HOUR);
            await checks(2);
            expect(attempts).toHaveLength(2);
            advance(HOUR);
            await checks(2);
            expect(attempts, "the wait did not grow after a second failure").toHaveLength(2);
            advance(HOUR);
            await checks(2);
            expect(attempts).toHaveLength(3);

            state.v6Issues = true;
            advance(4 * HOUR);
            await checks(2);
            expect((await readReachabilityConfig(dataPath))!.publicIps).toEqual([V4, V6]);
        });

        it("does not report a move or touch kubo when nothing moved", async () => {
            const { checks, events, dataPath } = await failingV6();
            await checks(2);
            expect(events.filter((event) => event.includes("Public address changed"))).toEqual([]);
            expect(events).not.toContain("restart kubo");
            expect((await readReachabilityConfig(dataPath))!.publicIps).toEqual([V4]);
            expect(await fs.readFile(caddyfilePath(dataPath), "utf-8")).not.toContain("2606:4700");
        });

        it("follows a held address again once setup got that family a certificate", async () => {
            const { attempts, checks, dataPath, setDerived } = await failingV6();
            await checks(2);
            await writeReachabilityConfig(dataPath, { ...(await readReachabilityConfig(dataPath))!, publicIps: [V4, V6] });
            setDerived([V4, V6_NEW]);
            await checks(2);
            expect(attempts.at(-1)).toEqual([V4, V6_NEW]);
        });
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

        it("sets nothing up when stopped during the first start, which can spend minutes downloading Caddy", async () => {
            const { calls, router } = fakeRouter();
            let finishStart = () => {};
            let starting = false;
            const { runtime } = await setup(baseConfig(), {
                ...natDeps(router),
                caddy: {
                    start: async () => {
                        starting = true;
                        await new Promise<void>((resolve) => (finishStart = resolve));
                    },
                    stop: async () => {},
                    reload: async () => {},
                    isUp: async () => false
                }
            });
            const started = runtime.start();
            await vi.waitFor(() => expect(starting).toBe(true));
            const stopped = runtime.stop();
            finishStart();
            await Promise.all([started, stopped]);
            await runtime.leasesSettled();
            expect(calls).not.toContain("map");
            expect((runtime as any).timers).toEqual([]);
        });

        it("does not ask the router for forwards once stopped", async () => {
            const { calls, router } = fakeRouter();
            const { runtime } = await setup(baseConfig(), natDeps(router));
            await runtime.stop();
            await runtime.refreshLeases();
            expect(calls).not.toContain("map");
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

        describe("announced again by setup while still broken", () => {
            const droppedThenReannounced = async () => {
                const context = await setup(domainConfig());
                context.setRecords({ v4: [], v6: [] });
                await context.runtime.runChecks();
                context.advance(25 * 60 * 60_000);
                await context.runtime.runChecks();
                // What buildConfig stores when setup announces the address again: it leaves droppedAnnounce too.
                const { droppedAnnounce: _dropped, ...config } = (await readReachabilityConfig(context.dataPath))!;
                await writeReachabilityConfig(context.dataPath, { ...config, announce: [...config.announce, domainAddress] });
                return context;
            };

            it("gets a fresh 24 hours rather than being dropped at the next check", async () => {
                const { runtime, dataPath, advance } = await droppedThenReannounced();
                await runtime.runChecks();
                advance(60 * 60_000);
                await runtime.runChecks();
                expect((await readReachabilityConfig(dataPath))!.announce).toContain(domainAddress);
                expect((await readReachabilityRuntimeStatus(dataPath))!.domains!["node.example"]!.droppedFromAnnounce).toBeUndefined();
            });

            it("is dropped again if it stays broken, rather than staying announced forever", async () => {
                const { runtime, dataPath, advance } = await droppedThenReannounced();
                await runtime.runChecks();
                advance(25 * 60 * 60_000);
                await runtime.runChecks();
                const config = (await readReachabilityConfig(dataPath))!;
                expect(config.announce).not.toContain(domainAddress);
                expect(config.droppedAnnounce).toEqual([domainAddress]);
            });
        });

        it("restores a dropped name that recovers even if the status file was lost", async () => {
            const { runtime, dataPath } = await setup(baseConfig({ domain: "node.example", announce: [`/ip4/${V4}/tcp/443/tls/ws`], droppedAnnounce: [domainAddress], mode: "ip" }));
            await runtime.runChecks();
            expect((await readReachabilityConfig(dataPath))!.announce).toContain(domainAddress);
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
