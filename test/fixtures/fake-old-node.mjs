// Preloaded with `node --import` so bin/run sees an unsupported Node version without one being installed (issue #280).
const version = process.env.FAKE_NODE_VERSION;
Object.defineProperty(process, "versions", { value: { ...process.versions, node: version } });
Object.defineProperty(process, "version", { value: `v${version}` });
