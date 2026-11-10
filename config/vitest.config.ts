import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["test/**/*.test.ts"],
        // Gives the run one temp directory and removes it afterwards, so runs do not pile up in the OS temp dir.
        globalSetup: ["test/helpers/temp-root.global-setup.ts"],
        testTimeout: 30000,
        hookTimeout: 30000,
        globals: false,
        pool: "forks", // Each test file runs in separate process to avoid ESM singleton cache contamination
        sequence: {
            concurrent: false
        },
        fileParallelism: true
    }
});
