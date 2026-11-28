import { describe, it, expect, afterEach } from "vitest";
import { createBsoResolvers, loggableNameResolvers, redactProviderUrl } from "../../dist/common-utils/resolvers.js";
import { PKCLogger } from "../../dist/util.js";

// bso-resolver 0.1.0 requires the caller's log, which pkc-js passes in the daemon
const log = PKCLogger({ namespace: "bitsocial-cli:test:resolvers" });

describe("createBsoResolvers", () => {
    let resolvers: ReturnType<typeof createBsoResolvers> = [];

    afterEach(async () => {
        for (const r of resolvers) await r.destroy({ log });
        resolvers = [];
    });

    it("creates resolvers with default providers when none specified", () => {
        resolvers = createBsoResolvers();
        expect(resolvers).toHaveLength(6);
        expect(resolvers[0].key).toBe("bso-https://eth.drpc.org");
        expect(resolvers[0].provider).toBe("https://eth.drpc.org");
        expect(resolvers[5].key).toBe("bso-https://eth-pokt.nodies.app");
        expect(resolvers[5].provider).toBe("https://eth-pokt.nodies.app");
    });

    it("creates resolvers with default providers when empty array passed", () => {
        resolvers = createBsoResolvers([]);
        expect(resolvers).toHaveLength(6);
        expect(resolvers[0].provider).toBe("https://eth.drpc.org");
        expect(resolvers[5].provider).toBe("https://eth-pokt.nodies.app");
    });

    it("creates resolvers from custom provider list", () => {
        resolvers = createBsoResolvers(["https://mainnet.infura.io/v3/KEY"]);
        expect(resolvers).toHaveLength(1);
        expect(resolvers[0].key).toBe("bso-https://mainnet.infura.io/v3/KEY");
        expect(resolvers[0].provider).toBe("https://mainnet.infura.io/v3/KEY");
    });

    it("canResolve returns true for .bso and .eth names", () => {
        resolvers = createBsoResolvers();
        expect(resolvers[0].canResolve({ name: "example.bso" })).toBe(true);
        expect(resolvers[0].canResolve({ name: "example.eth" })).toBe(true);
        expect(resolvers[0].canResolve({ name: "example.com" })).toBe(false);
        expect(resolvers[0].canResolve({ name: "example" })).toBe(false);
    });

    it("resolvers conform to the NameResolver interface expected by pkc-js", () => {
        resolvers = createBsoResolvers(["https://eth.drpc.org"]);
        const resolver = resolvers[0];
        expect(typeof resolver.key).toBe("string");
        expect(typeof resolver.provider).toBe("string");
        expect(typeof resolver.canResolve).toBe("function");
        expect(typeof resolver.resolve).toBe("function");
    });
});

describe("daemon wiring: chainProviderUrls -> PKC nameResolvers", () => {
    let resolvers: ReturnType<typeof createBsoResolvers> = [];

    afterEach(async () => {
        for (const r of resolvers) await r.destroy({ log });
        resolvers = [];
    });

    it("default chain provider URLs produce resolvers in pkcOptions.nameResolvers", () => {
        const chainProviderUrls = [
            "https://eth.drpc.org",
            "https://ethereum.publicnode.com",
            "https://ethereum-rpc.publicnode.com",
            "https://rpc.mevblocker.io",
            "https://1rpc.io/eth",
            "https://eth-pokt.nodies.app"
        ];

        resolvers = createBsoResolvers(chainProviderUrls);
        const pkcOptions: Record<string, any> = {};
        pkcOptions.nameResolvers = [...(pkcOptions.nameResolvers || []), ...resolvers];

        expect(pkcOptions.nameResolvers).toHaveLength(6);
        expect(pkcOptions.nameResolvers[0].key).toBe("bso-https://eth.drpc.org");
        expect(pkcOptions.nameResolvers[0].provider).toBe("https://eth.drpc.org");
        expect(pkcOptions.nameResolvers[5].key).toBe("bso-https://eth-pokt.nodies.app");
        expect(pkcOptions.nameResolvers[5].provider).toBe("https://eth-pokt.nodies.app");
        for (const resolver of pkcOptions.nameResolvers) {
            expect(resolver.canResolve({ name: "test.bso" })).toBe(true);
            expect(typeof resolver.resolve).toBe("function");
        }
    });

    it("custom chain provider URLs override defaults in pkcOptions.nameResolvers", () => {
        const chainProviderUrls = ["https://mainnet.infura.io/v3/KEY"];

        resolvers = createBsoResolvers(chainProviderUrls);
        const pkcOptions: Record<string, any> = {};
        pkcOptions.nameResolvers = [...(pkcOptions.nameResolvers || []), ...resolvers];

        expect(pkcOptions.nameResolvers).toHaveLength(1);
        expect(pkcOptions.nameResolvers[0].key).toBe("bso-https://mainnet.infura.io/v3/KEY");
        expect(pkcOptions.nameResolvers[0].provider).toBe("https://mainnet.infura.io/v3/KEY");
    });

    it("resolvers are appended to existing nameResolvers without replacing them", () => {
        const existingResolver = { key: "existing", provider: "existing", canResolve: () => false, resolve: async () => undefined };
        resolvers = createBsoResolvers(["https://eth.drpc.org"]);
        const pkcOptions: Record<string, any> = { nameResolvers: [existingResolver] };
        pkcOptions.nameResolvers = [...(pkcOptions.nameResolvers || []), ...resolvers];

        expect(pkcOptions.nameResolvers).toHaveLength(2);
        expect(pkcOptions.nameResolvers[0].key).toBe("existing");
        expect(pkcOptions.nameResolvers[1].key).toBe("bso-https://eth.drpc.org");
    });
});

// Logged provider URLs reach the log file and getLogs; a path or query can hold the provider's API key
describe("redactProviderUrl", () => {
    it("keeps only the origin of a URL with a path, query or credentials", () => {
        expect(redactProviderUrl("https://mainnet.infura.io/v3/SECRET")).toBe("https://mainnet.infura.io/…");
        expect(redactProviderUrl("https://rpc.example/?apikey=SECRET")).toBe("https://rpc.example/…");
        expect(redactProviderUrl("https://user:SECRET@rpc.example")).toBe("https://rpc.example/…");
    });

    it("leaves a bare origin as it is", () => {
        expect(redactProviderUrl("https://eth.drpc.org")).toBe("https://eth.drpc.org");
        expect(redactProviderUrl("https://eth.drpc.org/")).toBe("https://eth.drpc.org");
    });

    it("does not echo a value that is not a URL", () => {
        expect(redactProviderUrl("not a url SECRET")).toBe("[invalid URL]");
    });

    it("redacts WebSocket provider URLs", () => {
        expect(redactProviderUrl("wss://mainnet.infura.io/ws/v3/SECRET")).toBe("wss://mainnet.infura.io/…");
        expect(loggableNameResolvers([{ key: "bso-wss://mainnet.infura.io/ws/v3/SECRET" }, { key: "bso-ws://127.0.0.1:8546/SECRET" }])).toEqual([
            "bso-wss://mainnet.infura.io/…",
            "bso-ws://127.0.0.1:8546/…"
        ]);
    });

    it("redacts all of a provider URL that contains a comma", () => {
        expect(loggableNameResolvers([{ key: "bso-https://rpc.example/v1,SECRET?key=a,SECRET2" }])).toEqual(["bso-https://rpc.example/…"]);
    });

    it("redacts the provider URL inside BSO resolver keys", () => {
        expect(loggableNameResolvers([{ key: "bso-https://mainnet.infura.io/v3/SECRET" }, { key: "custom" }])).toEqual([
            "bso-https://mainnet.infura.io/…",
            "custom"
        ]);
    });
});
