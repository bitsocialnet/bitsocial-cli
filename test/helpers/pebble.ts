import { spawn, type ChildProcess } from "child_process";
import { createHash } from "crypto";
import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { Agent, fetch as undiciFetch } from "undici";
import decompress from "decompress";
import { allocateFreePort, killChildProcess, waitForCondition } from "./daemon-helpers.js";

// Let's Encrypt's test CA. Never talks to anything outside this machine, which is why CI can use it.
const PEBBLE_VERSION = "2.10.1";
const PEBBLE_SHA256: Record<string, string> = {
    "darwin-amd64": "4d1cd69f03bfecd094b944842c27b28bddc459ff466efc2f17cecdea37fd7c62",
    "darwin-arm64": "0e4a894a8672a8cfa6dcbff05619cb2b19072ea0bbecd05df101f087d08235b0",
    "linux-amd64": "c626f4b966f972aee217b0e121adf3eb9490d4ac57e490be730d0343d99a326e",
    "linux-arm64": "31883c79adbc7d21ebb36e84ed698e464e5c0486461c24049b20b3ec47ca9402",
    "windows-amd64": "2539f3903302d75f897522b23b1b52b3300f5f992245f13d3bdf3967cf23af6d",
    "windows-arm64": "787d2aec8a77c86c5f76280fdf9025f183171ef2115bfeb9ef7e32e0a2ee0f12"
};
const LISTENER_CERT = path.resolve("test/fixtures/pebble/listener-cert.pem");
const LISTENER_KEY = path.resolve("test/fixtures/pebble/listener-key.pem");

const pebbleOs = process.platform === "win32" ? "windows" : process.platform;
const pebbleArch = process.arch === "x64" ? "amd64" : process.arch;

async function ensurePebbleBinary(directory: string): Promise<string> {
    const target = `${pebbleOs}-${pebbleArch}`;
    const sha256 = PEBBLE_SHA256[target];
    if (!sha256) throw new Error(`No pinned Pebble for ${target}`);
    const binaryName = pebbleOs === "windows" ? "pebble.exe" : "pebble";
    const binaryPath = path.join(directory, binaryName);
    if (existsSync(binaryPath)) return binaryPath;

    const response = await fetch(`https://github.com/letsencrypt/pebble/releases/download/v${PEBBLE_VERSION}/pebble-${target}.zip`);
    if (!response.ok) throw new Error(`Pebble download returned HTTP ${response.status}`);
    const archive = Buffer.from(await response.arrayBuffer());
    const actual = createHash("sha256").update(archive).digest("hex");
    if (actual !== sha256) throw new Error(`Pebble sha256 mismatch: expected ${sha256}, got ${actual}`);
    const files = await decompress(archive, directory, {
        filter: (file) => path.basename(file.path) === binaryName,
        map: (file) => ({ ...file, path: binaryName })
    });
    if (files.length !== 1) throw new Error(`${binaryName} not found in the Pebble archive`);
    await fs.chmod(binaryPath, 0o755); // the release archive ships it without the exec bit
    return binaryPath;
}

export interface RunningPebble {
    directoryUrl: string;
    listenerRootPath: string;
    issuingRootPath: string;
    stop: () => Promise<void>;
}

// Skip-validation mode by default: orders succeed without dialling back, since CI cannot be reached on 80
// or 443. With `validateOn`, Pebble really dials those local ports, so a challenge has to succeed.
export async function startPebble(workDirectory: string, { validateOn }: { validateOn?: { httpPort: number; tlsPort: number } } = {}): Promise<RunningPebble> {
    await fs.mkdir(workDirectory, { recursive: true });
    const binaryPath = await ensurePebbleBinary(workDirectory);
    const [acmePort, managementPort] = await Promise.all([allocateFreePort(), allocateFreePort()]);
    const configPath = path.join(workDirectory, "pebble.json");
    await fs.writeFile(
        configPath,
        JSON.stringify({
            pebble: {
                listenAddress: `127.0.0.1:${acmePort}`,
                managementListenAddress: `127.0.0.1:${managementPort}`,
                certificate: LISTENER_CERT,
                privateKey: LISTENER_KEY,
                httpPort: validateOn?.httpPort ?? 5002,
                tlsPort: validateOn?.tlsPort ?? 5001,
                externalAccountBindingRequired: false,
                profiles: {
                    default: { description: "default", validityPeriod: 7_776_000 },
                    shortlived: { description: "matches Let's Encrypt's 160 hours", validityPeriod: 576_000 }
                }
            }
        })
    );
    const child: ChildProcess = spawn(binaryPath, ["-config", configPath], {
        env: { ...process.env, ...(validateOn ? {} : { PEBBLE_VA_ALWAYS_VALID: "1" }), PEBBLE_VA_NOSLEEP: "1", PEBBLE_WFE_NONCEREJECT: "0" },
        stdio: "ignore"
    });

    const dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
    const directoryUrl = `https://127.0.0.1:${acmePort}/dir`;
    const reachable = await waitForCondition(async () => {
        try {
            return (await undiciFetch(directoryUrl, { dispatcher })).ok;
        } catch {
            return false;
        }
    }, 20_000, 200);
    if (!reachable) {
        await killChildProcess(child);
        throw new Error("Pebble did not start");
    }
    // Generated fresh on every Pebble start, so it has to be fetched rather than committed.
    const rootResponse = await undiciFetch(`https://127.0.0.1:${managementPort}/roots/0`, { dispatcher });
    const issuingRootPath = path.join(workDirectory, "issuing-root.pem");
    await fs.writeFile(issuingRootPath, await rootResponse.text());
    await dispatcher.close();

    return { directoryUrl, listenerRootPath: LISTENER_CERT, issuingRootPath, stop: () => killChildProcess(child) };
}
