import { Flags } from "@oclif/core";
//@ts-ignore
import DataObjectParser from "dataobject-parser";
import fs from "fs";
import { BaseCommand } from "../../base-command.js";
import { PKCLogger, mergeDeep, parseJsoncFile } from "../../../util.js";
import * as remeda from "remeda";

export default class Create extends BaseCommand {
    static override description =
        "Create a community with specific properties. A newly created community will be started after creation and be able to receive publications. For a list of properties, visit https://github.com/pkcprotocol/pkc-js";

    static override examples = [
        {
            description: "Create a community with title 'Hello Plebs' and description 'Welcome'",
            command: "<%= config.bin %> <%= command.id %> --title 'Hello Plebs' --description 'Welcome'"
        },
        {
            description: "Create a community using options from a JSON/JSONC file",
            command: "<%= config.bin %> <%= command.id %> --jsonFile ./create-options.json"
        }
    ];

    static override flags = {
        privateKeyPath: Flags.file({
            exists: true,
            description:
                "Private key (PEM) of the community signer that will be used to determine address (if address is not a domain). If it's not provided then PKC will generate a private key"
        }),
        jsonFile: Flags.file({
            char: "f",
            exists: true,
            description: "Path to a JSON/JSONC file containing create options (supports comments)"
        })
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(Create);

        const log = PKCLogger("bitsocial-cli:commands:community:create");
        log(`flags: `, flags);
        const pkc = await this._connectToPkcRpc(flags.pkcRpcUrl.toString());
        const cliCreateOptions = DataObjectParser.transpose(
            remeda.omit(flags, ["pkcRpcUrl", "privateKeyPath", "jsonFile"])
        )["_data"];

        // Parse JSONC file if provided
        let jsonFileOptions: Record<string, unknown> = {};
        if (flags.jsonFile) {
            try {
                jsonFileOptions = await parseJsoncFile(flags.jsonFile);
                log("JSONC file options parsed:", jsonFileOptions);
            } catch (e) {
                if (e instanceof Error) {
                    await pkc.destroy();
                    this.error(e.message);
                }
                throw e;
            }
        }

        // Merge: JSON file options first, then CLI flags override
        let createOptions: NonNullable<Parameters<(typeof pkc)["createCommunity"]>[0]>;
        if (flags.jsonFile && Object.keys(cliCreateOptions).length > 0) {
            createOptions = mergeDeep(jsonFileOptions, cliCreateOptions);
        } else if (flags.jsonFile) {
            createOptions = jsonFileOptions as typeof createOptions;
        } else {
            createOptions = cliCreateOptions;
        }
        log("Final create options:", createOptions);

        if (flags.privateKeyPath)
            try {
                //@ts-expect-error
                createOptions.signer = { privateKey: (await fs.promises.readFile(flags.privateKeyPath)).toString(), type: "ed25519" };
            } catch (e) {
                const error = e instanceof Error ? e : new Error(typeof e === "string" ? e : JSON.stringify(e));
                //@ts-expect-error
                error.details = { ...error.details, privateKeyPath: flags.privateKeyPath };

                await pkc.destroy();
                this.error(error);
            }

        try {
            const createdCommunity = await pkc.createCommunity(createOptions);
            await createdCommunity.start();
            this.log(createdCommunity.address);
        } catch (e) {
            const error = e instanceof Error ? e : new Error(typeof e === "string" ? e : JSON.stringify(e));
            //@ts-expect-error
            error.details = { ...error.details, createOptions };
            await pkc.destroy();
            this.error(error);
        }
        await pkc.destroy();
    }
}
