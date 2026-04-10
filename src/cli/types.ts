import type {
    CreateNewLocalCommunityUserOptions as PKCCreateCommunityOptions
    //@ts-expect-error
} from "@pkcprotocol/pkc-js/dist/node/community/types.js";

export interface CliCreateCommunityOptions
    extends Pick<
        PKCCreateCommunityOptions,
        "title" | "description" | "suggested" | "settings" | "features" | "roles" | "rules" | "flairs"
    > {
    privateKeyPath?: string;
}
