import type { SubplebbitEditOptions, SubplebbitInstance, SubplebbitIpfsType } from "../types/communityTypes.js";

export const currentSubProps: Partial<SubplebbitInstance> = {
    title: "original title",
    description: "original description",
    pubsubTopic: "original pubsub topic",
    suggested: {
        primaryColor: "original suggested.primaryColor",
        secondaryColor: "original suggested.secondaryColor",
        avatarUrl: "original suggested.avatarUrl",
        bannerUrl: "original suggested.bannerUrl",
        backgroundUrl: "original suggested.backgroundUrl",
        language: "original suggested.languge"
    },
    features: {
        noVideos: false,
        noSpoilers: false,
        noImages: false,
        noVideoReplies: false,
        noSpoilerReplies: false,
        noImageReplies: false,
        noPolls: false,
        noCrossposts: false,
        noUpvotes: false,
        noDownvotes: false,
        noAuthors: false,
        anonymousAuthors: false,
        noNestedReplies: false,
        safeForWork: false,
        authorFlairs: false,
        requireAuthorFlairs: false,
        postFlairs: false,
        requirePostFlairs: false,
        noMarkdownImages: false,
        noMarkdownVideos: false,
        markdownImageReplies: false,
        markdownVideoReplies: false
    },
    address: "12KWOsomething",
    rules: ["Rule 1", "Rule 2"],
    settings: { challenges: [{ name: "captcha-canvas-v3" }], fetchThumbnailUrls: false, fetchThumbnailUrlsProxyUrl: undefined },
    roles: { "rinse12.bso": { role: "admin" } },
    createdAt: 12345678,
    started: true,
    updatedAt: 123456
};

//TODO add flairs here
export const objectPropsToEdit: Required<Pick<SubplebbitEditOptions, "roles" | "features" | "suggested" | "settings">> = {
    settings: {
        challenges: [
            undefined as any, // Should add a new challenge, settings.challenges[0] should be kept as is
            { options: { question: "What is the password", answer: "The password" } }
        ],
        fetchThumbnailUrls: true
        // fetchThumbnailUrlsProxyUrl: "http://localhost:12345" // explicitly don't modify it
    },
    roles: {
        "rinse12.bso": null as any, //remove rinse from roles
        "esteban.bso": { role: "admin" } // add esteban.bso as an addmin
    },
    features: {
        noVideos: true,
        noSpoilers: true,
        noImages: true,
        noVideoReplies: true,
        noSpoilerReplies: true,
        noImageReplies: true,
        noPolls: true,
        noCrossposts: true,
        noUpvotes: true,
        noDownvotes: true,
        noAuthors: true,
        anonymousAuthors: true,
        noNestedReplies: true,
        safeForWork: true,
        authorFlairs: true,
        requireAuthorFlairs: true,
        postFlairs: true,
        requirePostFlairs: true,
        noMarkdownImages: true,
        noMarkdownVideos: true,
        markdownImageReplies: true,
        markdownVideoReplies: true
    },
    suggested: {
        primaryColor: "new suggested.primaryColor",
        secondaryColor: "new suggested.secondaryColor",
        avatarUrl: "new suggested.avatarUrl",
        bannerUrl: "new suggested.bannerUrl",
        backgroundUrl: "new suggested.backgroundUrl",
        language: "new suggested.languge"
    }
};
