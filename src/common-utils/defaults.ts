// Not sure 'defaults' is the best name here
import envPaths from "env-paths";

export default {
    PKC_DATA_PATH: envPaths("bitsocial", { suffix: "" }).data,
    PKC_RPC_URL: new URL("ws://localhost:9138"),
    KUBO_RPC_URL: new URL(process.env["KUBO_RPC_URL"] || "http://127.0.0.1:50019/api/v0"),
    IPFS_GATEWAY_URL: new URL(process.env["IPFS_GATEWAY_URL"] || "http://127.0.0.1:6473"),
    HTTP_TRACKERS: [
        "https://peers.pleb.bot",
        "https://routing.lol",
        "https://peers.forumindex.com",
        "https://peers.plebpubsub.xyz",
        "https://routerofbitsocial.xyz",
        "https://bsotracker.online"
    ],
    PKC_LOG_PATH: envPaths("bitsocial", { suffix: "" }).log
};
