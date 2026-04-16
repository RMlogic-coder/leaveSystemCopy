#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
require("dotenv").config();
const { initStore, writeStore, isConfigured, closeStore } = require("../db/postgresStore");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");

const DATA_FILES = [
    "credentials.json",
    "fa_leave_requests.json",
    "warden_leave_requests.json",
    "warden_students.json",
    "leave_data.json",
    "student_master.json",
    "mess_semester_rates.json",
    "hostel_warden_mapping.json"
];

function readJson(filePath) {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
}

async function main() {
    if (!isConfigured()) {
        throw new Error("DATABASE_URL is not set. Add it to .env before running migration.");
    }

    await initStore();

    for (const fileName of DATA_FILES) {
        const fullPath = path.join(DATA_DIR, fileName);
        if (!fs.existsSync(fullPath)) {
            console.warn(`[skip] ${fileName} not found`);
            continue;
        }

        const payload = readJson(fullPath);
        const storeKey = path.basename(fileName, ".json");
        await writeStore(storeKey, payload);

        const kind = Array.isArray(payload) ? `array(${payload.length})` : "object";
        console.log(`[ok] ${storeKey} <= ${fileName} (${kind})`);
    }

    await closeStore();
    console.log("Migration finished.");
}

main().catch(async (err) => {
    console.error("Migration failed:", err.message);
    try {
        await closeStore();
    } catch {
        // best effort close
    }
    process.exit(1);
});
