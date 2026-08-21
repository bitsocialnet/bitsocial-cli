import PKC from "@pkcprotocol/pkc-js";

const RPC_URL = "ws://localhost:9138";

const pkc = await PKC({ pkcRpcClientsOptions: [RPC_URL] });

await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out")), 20000);
    pkc.once("communitieschange", () => { clearTimeout(timeout); resolve(); });
});

const address = pkc.communities[0];
if (!address) { console.log("No communities"); await pkc.destroy(); process.exit(1); }

const community = await pkc.createCommunity({ address });
console.log("Community:", address);
console.log("Current roles:", JSON.stringify(community.roles, null, 2));

// Find any existing role to test null removal
const existingRole = Object.entries(community.roles || {})[0];
if (!existingRole) { console.log("No roles to test with"); await pkc.destroy(); process.exit(0); }

const [roleAddr, roleValue] = existingRole;
console.log(`\nTesting null removal on: ${roleAddr} (${roleValue?.role})`);

// Test 1: Try removing with null
console.log("\n--- Test: Removing role with null ---");
try {
    await community.edit({ roles: { [roleAddr]: null } });
    console.log("SUCCESS: null works");
} catch (e) {
    console.error("FAILED with null:", e.message || e);
}

// Test 2: Try removing with undefined
console.log("\n--- Test: Removing role with undefined ---");
try {
    const community2 = await pkc.createCommunity({ address });
    await community2.edit({ roles: { [roleAddr]: undefined } });
    console.log("SUCCESS: undefined works");
} catch (e) {
    console.error("FAILED with undefined:", e.message || e);
}

// Check final state
const community3 = await pkc.createCommunity({ address });
console.log("\nFinal roles:", JSON.stringify(community3.roles, null, 2));

// Re-add the role back
console.log("\n--- Restoring original role ---");
try {
    await community3.edit({ roles: { [roleAddr]: roleValue } });
    console.log("Restored");
} catch (e) {
    console.error("Failed to restore:", e.message || e);
}

await pkc.destroy();
