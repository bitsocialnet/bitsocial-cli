import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import fs from "fs/promises";
import { getPKCLogger } from "../util.js";
import { randomBytes } from "crypto";
import express from "express";
import { loadChallengesIntoPKC } from "../challenge-packages/challenge-utils.js";

async function _generateModifiedIndexHtmlWithRpcSettings(webuiPath: string, webuiName: string, ipfsGatewayPort: number) {
    const indexHtmlString = (await fs.readFile(path.join(webuiPath, "index_backup_no_rpc.html")))
        .toString()
        .replace(/<script>\s*\/\/\s*Redirect non-hash URLs[\s\S]*?<\/script>/, "");
    const defaultRpcOptionString = `[window.location.origin.replace("https://", "wss://").replace("http://", "ws://") + window.location.pathname.split('/' + '${webuiName}')[0]]`;
    // Ipfs media only locally because ipfs gateway doesn't allow remote connections
    const defaultIpfsMedia = `if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || window.location.hostname === "0.0.0.0")window.defaultMediaIpfsGatewayUrl = 'http://' + window.location.hostname + ':' + ${ipfsGatewayPort}`;
    const defaultOptionsString = `<script>window.defaultPkcOptions = {pkcRpcClientsOptions: ${defaultRpcOptionString}};${defaultIpfsMedia};console.log(window.defaultPkcOptions, window.defaultMediaIpfsGatewayUrl)</script>`;

    const modifiedIndexHtmlContent = "<!DOCTYPE html>" + defaultOptionsString + indexHtmlString.replace("<!DOCTYPE html>", "");

    return modifiedIndexHtmlContent;
}

async function _generateRpcAuthKeyIfNotExisting(pkcDataPath: string) {
    const pkcRpcAuthKeyPath = path.join(pkcDataPath, "auth-key");
    const envAuthKey = process.env["PKC_RPC_AUTH_KEY"];
    let pkcRpcAuthKey: string;
    if (envAuthKey) {
        pkcRpcAuthKey = envAuthKey;
        await fs.writeFile(pkcRpcAuthKeyPath, pkcRpcAuthKey);
    } else {
        try {
            pkcRpcAuthKey = await fs.readFile(pkcRpcAuthKeyPath, "utf-8");
        } catch (e) {
            pkcRpcAuthKey = randomBytes(32).toString("base64").replace(/[/+=]/g, "").substring(0, 40);
            await fs.writeFile(pkcRpcAuthKeyPath, pkcRpcAuthKey, { flag: "wx" });
        }
    }
    return pkcRpcAuthKey;
}

// The daemon server will host both RPC and webui on the same port
export async function startDaemonServer(rpcUrl: URL, ipfsGatewayUrl: URL, pkcOptions: any) {
    // Start pkc-js RPC
    const log = (await getPKCLogger())("bitsocial-cli:daemon:startDaemonServer");
    const webuiExpressApp = express();
    const httpServer = webuiExpressApp.listen(Number(rpcUrl.port));
    log("HTTP server is running on", "0.0.0.0" + ":" + rpcUrl.port);
    const rpcAuthKey = await _generateRpcAuthKeyIfNotExisting(pkcOptions.dataPath!);
    const PKCRpc = await import("@pkcprotocol/pkc-js/rpc");

    // Will add ability to edit later, but it's hard coded for now

    log("Will be passing pkc options to RPC server", pkcOptions);

    const rpcServer = await PKCRpc.default.PKCWsServer({
        server: httpServer,
        pkcOptions: pkcOptions,
        authKey: rpcAuthKey
    });

    const webuisDir = path.join(__dirname, "..", "..", "dist", "webuis");

    const webUiNames = (await fs.readdir(webuisDir, { withFileTypes: true })).filter((file) => file.isDirectory()).map((file) => file.name);

    const webuis: { name: string; endpointLocal: string; endpointRemote: string }[] = [];
    log("Discovered webuis", webUiNames);
    for (const webuiNameWithVersion of webUiNames) {
        const webuiDirPath = path.join(webuisDir, webuiNameWithVersion);
        const webuiName = webuiNameWithVersion.split("-")[0]; // should be "seedit", "plebones"

        const modifiedIndexHtmlString = await _generateModifiedIndexHtmlWithRpcSettings(
            webuiDirPath,
            webuiName,
            Number(ipfsGatewayUrl.port)
        );

        const endpointLocal = `/${webuiName}`;
        webuiExpressApp.use(endpointLocal, express.static(webuiDirPath, { index: false }));
        webuiExpressApp.get(endpointLocal, (req, res, next) => {
            const isLocal = req.socket.localAddress && req.socket.localAddress === req.socket.remoteAddress;
            log(
                "Received local connection request for webui",
                endpointLocal,
                "with socket.localAddress",
                req.socket.localAddress,
                "and socket.remoteAddress",
                req.socket.remoteAddress
            );
            if (!isLocal) res.status(403).send("This endpoint does not exist for remote connections");
            else {
                res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
                res.set("Expires", "-1");
                res.set("Pragma", "no-cache");
                res.type("html").send(modifiedIndexHtmlString);
            }
        });

        const endpointRemote = `/${rpcAuthKey}/${webuiName}`;
        webuiExpressApp.use(endpointRemote, express.static(webuiDirPath, { index: false }));
        webuiExpressApp.get(endpointRemote, (req, res, next) => {
            const isLocal = req.socket.localAddress && req.socket.localAddress === req.socket.remoteAddress;
            log(
                "Received remote connection request for webui",
                endpointLocal,
                "with socket.localAddress",
                req.socket.localAddress,
                "and socket.remoteAddress",
                req.socket.remoteAddress,
                "with req.url",
                req.url
            );

            if (isLocal) {
                res.redirect(`http://localhost:${rpcUrl.port}/${webuiName}`);
            } else {
                res.set("Cache-Control", "public, max-age=600"); // 600 seconds = 10 minutes
                res.type("html").send(modifiedIndexHtmlString);
            }
        });

        webuis.push({ name: webuiName, endpointLocal, endpointRemote });
    }

    // Challenge reload endpoints
    const handleChallengeReload = async (_req: express.Request, res: express.Response) => {
        try {
            const loadedNames = await loadChallengesIntoPKC(pkcOptions.dataPath);
            // Notify all connected RPC clients about the updated challenges
            const onSettingsChange = (rpcServer as any)._onSettingsChange;
            if (onSettingsChange) {
                for (const connectionId of Object.keys(onSettingsChange)) {
                    const handlers = onSettingsChange[connectionId];
                    if (!handlers) continue;
                    for (const subscriptionId of Object.keys(handlers)) {
                        const handler = handlers[subscriptionId];
                        if (handler) await handler({ newPKC: (rpcServer as any).pkc });
                    }
                }
            }
            res.json({ ok: true, challenges: loadedNames });
        } catch (err) {
            log.error("Failed to reload challenges", err);
            res.status(500).json({ ok: false, error: String(err) });
        }
    };

    // Local-only endpoint (same isLocal check as webui routes)
    webuiExpressApp.post("/api/challenges/reload", (req, res) => {
        const isLocal = req.socket.localAddress && req.socket.localAddress === req.socket.remoteAddress;
        if (!isLocal) {
            res.status(403).send("This endpoint does not exist for remote connections");
            return;
        }
        handleChallengeReload(req, res);
    });

    // Remote endpoint with auth key
    webuiExpressApp.post(`/${rpcAuthKey}/api/challenges/reload`, (req, res) => {
        handleChallengeReload(req, res);
    });

    let daemonServerDestroyed = false;

    const cleanupDaemonServer = async () => {
        if (daemonServerDestroyed) return;
        await rpcServer.destroy();
        httpServer.close();
        daemonServerDestroyed = true;
    };

    return { rpcAuthKey, listedSub: rpcServer.pkc.communities, webuis, destroy: cleanupDaemonServer };
}
