const path = require("path");
const { readFileSync } = require("fs");
require("dotenv").config();
const { initializeFirebaseAdmin, mirrorToFirebase, isFirebaseReady } = require("./firebaseAdmin");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");

const DATASETS = [
    { file: "credentials.json", node: "credentials", type: "object" },
    { file: "fa_leave_requests.json", node: "fa_leave_requests", type: "array" },
    { file: "warden_leave_requests.json", node: "warden_leave_requests", type: "array" },
    { file: "leave_data.json", node: "leave_data", type: "array" },
    { file: "student_master.json", node: "student_master", type: "array" },
    { file: "hostel_warden_mapping.json", node: "hostel_warden_mapping", type: "object" },
    { file: "mess_semester_rates.json", node: "mess_semester_rates", type: "object" },
    { file: "warden_students.json", node: "warden_students", type: "array" }
];

function readJson(fileName) {
    const fullPath = path.join(DATA_DIR, fileName);
    const raw = readFileSync(fullPath, "utf-8");
    return JSON.parse(raw);
}

async function main() {
    initializeFirebaseAdmin();

    if (!isFirebaseReady()) {
        throw new Error("Firebase is not initialized. Set FIREBASE_ENABLED=true and Firebase env vars.");
    }

    for (const dataset of DATASETS) {
        const payload = readJson(dataset.file);
        if (dataset.type === "array" && !Array.isArray(payload)) {
            throw new Error(`${dataset.file} must contain a JSON array`);
        }
        if (dataset.type === "object" && (!payload || typeof payload !== "object" || Array.isArray(payload))) {
            throw new Error(`${dataset.file} must contain a JSON object`);
        }

        mirrorToFirebase(dataset.node, payload);
        console.log(`[firebase-import] queued ${dataset.file} -> /${dataset.node}`);
    }

    // Allow queued mirror writes to flush before process exits.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log("[firebase-import] completed");
}

main().catch((err) => {
    console.error("[firebase-import] failed:", err.message);
    process.exit(1);
});
