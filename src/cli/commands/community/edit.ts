//@ts-expect-error
import DataObjectParser from "dataobject-parser";
import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../base-command.js";
import { PKCLogger, mergeDeep, parseJsoncFile } from "../../../util.js";
import * as remeda from "remeda";

export default class Edit extends BaseCommand {
    static override description = "Edit a community's properties. For a list of properties, visit https://github.com/pkcprotocol/pkc-js";

    static override args = {
        address: Args.string({
            name: "address",
            required: true,
            description: "Address of the community to edit. It could be the name domain, or a public key"
        })
    };

    static override flags = {
        jsonFile: Flags.file({
            char: "f",
            exists: true,
            description: "Path to a JSON/JSONC file containing edit options (supports comments)"
        })
    };

    static override examples = [
        // TODO update this to change the name instead
        // Also are we testing modifying name properly?
        // in theory user should not modify address, they should modify name
        {
            description: "Change the address of the community to a new domain address",
            command: "bitsocial community edit 12D3KooWG3XbzoVyAE6Y9vHZKF64Yuuu4TjdgQKedk14iYmTEPWu --address newAddress.bso"
        },
        {
            description: "Add the author address 'esteban.bso' as an admin on the community",
            command: `bitsocial community edit mycommunity.bso '--roles["esteban.bso"].role' admin`
        },
        {
            description:
                "Add two challenges to the community. The first challenge will be a question and answer, and the second will be an image captcha",
            command: `bitsocial community edit mycommunity.bso --settings.challenges[0].name question --settings.challenges[0].options.question "what is the password?" --settings.challenges[0].options.answer thepassword --settings.challenges[1].name captcha-canvas-v3`
        },
        {
            description: "Change the title and description",
            command: `bitsocial community edit mycommunity.bso --title "This is the new title" --description "This is the new description" `
        },
        {
            description: "Remove a role from a moderator/admin/owner",
            command: "bitsocial community edit bitsocial.bso --roles['rinse12.bso'] null"
        },
        {
            description: "Enable settings.fetchThumbnailUrls to fetch the thumbnail of url submitted by authors",
            command: "bitsocial community edit bitsocial.bso --settings.fetchThumbnailUrls"
        },
        {
            description: "disable settings.fetchThumbnailUrls",
            command: "bitsocial community edit bitsocial.bso --settings.fetchThumbnailUrls=false"
        },
        {
            description: "Edit a community using options from a JSON/JSONC file",
            command: "bitsocial community edit bitsocial.bso --jsonFile ./edit-options.json"
        }
    ];

    async run(): Promise<void> {
        const { flags, args } = await this.parse(Edit);

        const log = PKCLogger("bitsocial-cli:commands:community:edit");
        log(`flags: `, flags);
        const pkc = await this._connectToPkcRpc(flags.pkcRpcUrl.toString());

        const cliEditOptions = DataObjectParser.transpose(remeda.omit(flags, ["pkcRpcUrl", "jsonFile"]))["_data"];
        log("CLI edit options parsed:", cliEditOptions);

        // Parse JSONC file if provided
        let jsonFileOptions: Record<string, unknown> = {};
        if (flags.jsonFile) {
            try {
                jsonFileOptions = await parseJsoncFile(flags.jsonFile);
                log("JSONC file options parsed:", jsonFileOptions);
            } catch (e) {
                if (e instanceof Error) {
                    this.error(e.message);
                }
                throw e;
            }
        }

        // Merge: JSON file options first, then CLI flags override
        let editOptions: Record<string, unknown>;
        if (flags.jsonFile && Object.keys(cliEditOptions).length > 0) {
            editOptions = mergeDeep(jsonFileOptions, cliEditOptions);
        } else if (flags.jsonFile) {
            editOptions = jsonFileOptions;
        } else {
            editOptions = cliEditOptions;
        }
        log("Final edit options:", editOptions);

        const localCommunities = pkc.communities;
        if (!localCommunities.includes(args.address))
            this.error("Can't edit a remote community, make sure you're editing a local community");

        try {
            const community = await pkc.createCommunity({ address: args.address });

            const mergedState = remeda.pick(community, remeda.keys.strict(editOptions) as (keyof typeof community)[]);
            const finalMergedState = mergeDeep(mergedState, editOptions);
            log("Internal community state after merge:", finalMergedState);
            await community.edit(finalMergedState);
            this.log(community.address);
        } catch (e) {
            const error = e instanceof Error ? e : new Error(typeof e === "string" ? e : JSON.stringify(e));
            //@ts-expect-error
            error.details = { ...error.details, editOptions, address: args.address };
            console.error(error);
            await pkc.destroy();
            this.exit(1);
        }
        await pkc.destroy();
    }
}
