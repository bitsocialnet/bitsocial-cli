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
