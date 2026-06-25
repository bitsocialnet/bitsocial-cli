import { describe, it, expect } from "vitest";
import defaults from "../../dist/common-utils/defaults.js";

describe("defaults", () => {
    it("ships the expected default HTTP routers (trackers)", () => {
        expect(defaults.HTTP_TRACKERS).toEqual([
            "https://peers.pleb.bot",
            "https://routing.lol",
            "https://peers.forumindex.com",
            "https://peers.plebpubsub.xyz",
            "https://routerofbitsocial.xyz",
            "https://bsotracker.online"
        ]);
    });
});
