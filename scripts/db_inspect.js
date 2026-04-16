#!/usr/bin/env node

require("dotenv").config();
const { isConfigured, listStoreMeta, readStore, closeStore } = require("../db/postgresStore");

function payloadSizeLabel(payload) {
    if (Array.isArray(payload)) return `array(${payload.length})`;
    if (payload && typeof payload === "object") return `object(${Object.keys(payload).length} keys)`;
    return typeof payload;
}

async function main() {
    if (!isConfigured()) {
        throw new Error("DATABASE_URL is not set. Add it to .env before running db:inspect.");
    }

    const rows = await listStoreMeta();
    if (!rows.length) {
        console.log("No stores found in json_stores.");
        return;
    }

    console.log("store_key | payload_type | updated_at | payload_shape");
    console.log("-".repeat(90));

    for (const row of rows) {
        const payload = await readStore(row.store_key, null);
        const shape = payloadSizeLabel(payload);
        console.log(`${row.store_key} | ${row.payload_type} | ${new Date(row.updated_at).toISOString()} | ${shape}`);
    }
}

main().catch(async (err) => {
    console.error("db:inspect failed:", err.message);
    process.exitCode = 1;
}).finally(async () => {
    try {
        await closeStore();
    } catch {
        // ignore close errors
    }
});
