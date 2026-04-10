// Run bitsocial daemon, make sure it's not throwing an error
// Try to connect to pkc RPC, if it doesn't connect, throw

import { ChildProcess, spawn } from "child_process";

interface SpawnOptions {
    args: string[];
    isDaemon?: boolean;
    waitForPattern?: string;
}

const spawnBitsocialProcess = async (options: SpawnOptions): Promise<ChildProcess | string> => {
    const Logger = await import("@pkcprotocol/pkc-logger");
    const log = Logger.default("bitsocial-cli:ci:run-daemon-before-release:spawnBitsocialProcess");

    const { args, isDaemon = false, waitForPattern } = options;

    return new Promise((resolve, reject) => {
        const fullArgs = ["./bin/run", ...args];
        console.log(`Spawning bitsocial process with args: ${fullArgs.join(" ")}`);
        const process = spawn("node", fullArgs, {
            stdio: isDaemon ? ["pipe", "pipe", "inherit"] : ["pipe", "pipe", "pipe"]
        }) as ChildProcess;

        let stdout = "";
        let stderr = "";
        let error = "";

        if (isDaemon) {
            // Daemon mode: wait for specific pattern and return process
            process.on("exit", (exitCode, signal) => {
                reject(`spawnAsync process '${process.pid}' exited with code '${exitCode}' signal '${signal}' and error: ${error}`);
            });

            process.stdout?.on("data", (data) => {
                const output = data.toString();
                if (waitForPattern && output.match(waitForPattern)) {
                    process.removeAllListeners();
                    resolve(process);
                }
            });

            process.on("error", (data) => {
                log.error("Error from bitsocial process:", data);
                error += String(data);
            });
        } else {
            // CLI command mode: wait for completion and return output
            process.stdout?.on("data", (data) => {
                stdout += data.toString();
            });

            process.stderr?.on("data", (data) => {
                stderr += data.toString();
            });

            process.on("exit", (exitCode) => {
                if (exitCode === 0) {
                    resolve(stdout.trim());
                } else {
                    reject(`Command failed with exit code ${exitCode}. stderr: ${stderr}`);
                }
            });

            process.on("error", (error) => {
                reject(`Command failed with error: ${error.message}`);
            });
        }
    });
};

const retrySpawnBitsocialProcess = async (options: SpawnOptions, maxRetries = 5): Promise<ChildProcess | string> => {
    const Logger = await import("@pkcprotocol/pkc-logger");
    const log = Logger.default("bitsocial-cli:ci:run-daemon-before-release:retrySpawnBitsocialProcess");

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await spawnBitsocialProcess(options);
        } catch (e) {
            if (attempt === maxRetries) {
                log.error(`All ${maxRetries} attempts failed for args: ${options.args.join(" ")}`);
                throw e;
            }
            const delaySeconds = attempt * 3;
            log(`Attempt ${attempt}/${maxRetries} failed, retrying in ${delaySeconds}s...`, String(e));
            await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
        }
    }
    throw new Error("Unreachable");
};

(async () => {
    const Logger = await import("@pkcprotocol/pkc-logger");
    const log = Logger.default("bitsocial-cli:ci:run-daemon-before-release");

    const bitsocialDaemon = (await spawnBitsocialProcess({
        args: ["daemon"],
        isDaemon: true,
        waitForPattern: "Communities in data path"
    })) as ChildProcess;

    // Test CLI commands
    log("Testing CLI commands...");

    let communityAddress: string;

    try {
        // Create community and capture address
        communityAddress = (await retrySpawnBitsocialProcess({
            args: ["community", "create", "--description", "test"]
        })) as string;
        log(`Created community with address: ${communityAddress}`);
    } catch (e) {
        log.error("Error creating community", e);
        await bitsocialDaemon.kill();
        throw e;
    }

    console.log("community address", communityAddress);
    try {
        // Edit the community
        await spawnBitsocialProcess({
            args: ["community", "edit", communityAddress, "--description", "random description"]
        });
        log(`Successfully edited community ${communityAddress}`);
    } catch (e) {
        log.error("Error editing community", e);
        await bitsocialDaemon.kill();
        throw e;
    }

    const getOutput = (await spawnBitsocialProcess({
        args: ["community", "get", communityAddress]
    })) as string;
    const subJson = JSON.parse(getOutput);
    console.log("community description", subJson.description);
    if (subJson.description !== "random description") {
        await bitsocialDaemon.kill();
        throw Error("community.description should be 'random description' at this point. Instead it's: " + subJson.description);
    }
    await bitsocialDaemon.kill();

    console.log("No problem with bitsocial-cli on this OS and platform");
})();
