import { describe, it, expect } from "vitest";
import path from "path";
import { collectPackageUsages, packageNameToDir } from "../../src/common-utils/package-registry.js";

// A package name becomes a directory under ${dataPath}/<subdir>. Without validation, `remove ../communities` resolved
// to ${dataPath}/communities and deleted it, and a package.json name with `..` could install anywhere.

describe("packageNameToDir", () => {
    const packagesDir = path.join(path.sep, "data", "page-sorts");

    it("maps unscoped and scoped npm names inside the packages dir", () => {
        expect(packageNameToDir(packagesDir, "active-page-sort")).toBe(path.join(packagesDir, "active-page-sort"));
        expect(packageNameToDir(packagesDir, "@pkcprotocol/active-page-sort")).toBe(path.join(packagesDir, "@pkcprotocol", "active-page-sort"));
        expect(packageNameToDir(packagesDir, "a.b_c-d~e")).toBe(path.join(packagesDir, "a.b_c-d~e"));
    });

    for (const name of [
        "../communities",
        "..",
        ".",
        "@scope/..",
        "@../x",
        "a/b",
        "@scope",
        "@scope/a/b",
        "foo\\..\\..\\bar",
        "",
        "/etc",
        ".hidden"
    ]) {
        it(`rejects ${JSON.stringify(name)}`, () => {
            expect(() => packageNameToDir(packagesDir, name)).toThrow(/Invalid package name/);
        });
    }
});

describe("collectPackageUsages", () => {
    it("reads addresses from pkc.communities object entries (pkc-js >= 0.0.129) and destroys pkc", async () => {
        const settingsByAddress: Record<string, unknown> = {
            "a.bso": { challenges: [{ name: "captcha" }] },
            "b.bso": { challenges: [{ name: "mintpass" }, { name: "captcha" }] }
        };
        const destroyed: boolean[] = [];
        const pkc = {
            communities: [
                { address: "a.bso", publicKey: "12D3KooWFakeA", started: true },
                { address: "b.bso", publicKey: "12D3KooWFakeB", started: false }
            ],
            createCommunity: async ({ address }: { address: string }) => ({ settings: settingsByAddress[address] }),
            destroy: async () => {
                destroyed.push(true);
            }
        };
        const usages = await collectPackageUsages(pkc, (settings: any) =>
            (settings.challenges as { name: string }[]).flatMap((c, i) => (c.name === "captcha" ? [`settings.challenges[${i}]`] : []))
        );
        expect(usages).toEqual(["a.bso settings.challenges[0]", "b.bso settings.challenges[1]"]);
        expect(destroyed).toEqual([true]);
    });
});
