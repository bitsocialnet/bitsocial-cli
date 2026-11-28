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

/** `text` with every http(s) URL in it reduced by redactProviderUrl. */
export function redactUrlsInText(text: string): string {
    return text.replace(/https?:\/\/[^\s"',\]}]+/g, (match) => redactProviderUrl(match));
}

/** Name resolvers as they may be logged: their keys (which embed the provider URL for BSO resolvers), redacted. */
export function loggableNameResolvers(resolvers: readonly { key: string }[] | undefined): string[] | undefined {
    return resolvers?.map((resolver) => redactUrlsInText(String(resolver.key)));
}
