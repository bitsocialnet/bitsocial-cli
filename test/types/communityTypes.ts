type PKCModule = Awaited<typeof import("@pkcprotocol/pkc-js", { with: { "resolution-mode": "import" } })>;
type PKCFactory = PKCModule["default"];


type PKCInstance = Awaited<ReturnType<PKCFactory>>;
export type CommunityInstance = Awaited<ReturnType<PKCInstance["createCommunity"]>>;


export type CommunityIpfsType = NonNullable<CommunityInstance["raw"]["communityIpfs"]>;
export type CreateCommunityOptions = NonNullable<Parameters<PKCInstance["createCommunity"]>[0]>;
export type CommunityEditOptions = Parameters<CommunityInstance["edit"]>[0];
