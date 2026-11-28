import { BsoResolver } from "@bitsocial/bso-resolver";

export const DEFAULT_PROVIDERS = [
    "https://eth.drpc.org",
    "https://ethereum.publicnode.com",
    "https://ethereum-rpc.publicnode.com",
    "https://rpc.mevblocker.io",
    "https://1rpc.io/eth",
    "https://eth-pokt.nodies.app"
];

export function createBsoResolvers(providers?: string[]): BsoResolver[] {
    const resolverProviders = providers && providers.length > 0 ? providers : DEFAULT_PROVIDERS;
    return resolverProviders.map((provider) => new BsoResolver({ key: `bso-${provider}`, provider }));
}

/**
 * A provider URL as it may be logged: its origin only. A path, query or credentials can carry the provider's API key
 * (`https://mainnet.infura.io/v3/<key>`), and the log reaches the file and getLogs, which RPC clients can call.
 */
export function redactProviderUrl(provider: string): string {
    let url: URL;
    try {
        url = new URL(provider);
    } catch {
        return "[invalid URL]";
    }
    const hasMore = (url.pathname !== "/" && url.pathname !== "") || url.search !== "" || url.hash !== "" || url.username !== "" || url.password !== "";
    return hasMore ? `${url.origin}/…` : url.origin;
}

/** `text` with every URL in it (any scheme: http, https, ws, wss...) reduced by redactProviderUrl. */
export function redactUrlsInText(text: string): string {
    return text.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"']+/gi, (match) => redactProviderUrl(match));
}

const BSO_KEY_PREFIX = "bso-";

/**
 * Name resolvers as they may be logged: their keys, redacted. A BSO resolver's key is `bso-<provider URL>`
 * (createBsoResolvers), so all of what follows the prefix is one URL, commas included.
 */
export function loggableNameResolvers(resolvers: readonly { key: string }[] | undefined): string[] | undefined {
    return resolvers?.map((resolver) => {
        const key = String(resolver.key);
        return key.startsWith(BSO_KEY_PREFIX) ? BSO_KEY_PREFIX + redactProviderUrl(key.slice(BSO_KEY_PREFIX.length)) : redactUrlsInText(key);
    });
}
