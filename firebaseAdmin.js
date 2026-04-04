const fs = require("fs");
const admin = require("firebase-admin");

const FIREBASE_ENABLED = process.env.FIREBASE_ENABLED === "true";
const FIREBASE_DB_URL = String(process.env.FIREBASE_DB_URL || "").trim();
const FIREBASE_SERVICE_ACCOUNT_JSON = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
const GOOGLE_APPLICATION_CREDENTIALS = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();

let initialized = false;

function loadServiceAccount() {
    if (FIREBASE_SERVICE_ACCOUNT_JSON) {
        return JSON.parse(FIREBASE_SERVICE_ACCOUNT_JSON);
    }

    if (!GOOGLE_APPLICATION_CREDENTIALS) {
        throw new Error("Missing GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_JSON");
    }

    const raw = fs.readFileSync(GOOGLE_APPLICATION_CREDENTIALS, "utf-8");
    return JSON.parse(raw);
}

function initializeFirebaseAdmin() {
    if (!FIREBASE_ENABLED || initialized) {
        return initialized;
    }

    if (!FIREBASE_DB_URL) {
        console.warn("[firebase] FIREBASE_ENABLED=true but FIREBASE_DB_URL is missing. Firebase mirror disabled.");
        return false;
    }

    try {
        const serviceAccount = loadServiceAccount();
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: FIREBASE_DB_URL
        });
        initialized = true;
        console.log("[firebase] Admin SDK initialized.");
        return true;
    } catch (err) {
        console.warn(`[firebase] Failed to initialize Admin SDK: ${err.message}`);
        initialized = false;
        return false;
    }
}

function isFirebaseReady() {
    return initialized;
}

function mirrorToFirebase(nodePath, payload) {
    if (!initialized) return;

    admin
        .database()
        .ref(String(nodePath || "").replace(/^\/+/, ""))
        .set(payload)
        .catch((err) => {
            console.warn(`[firebase] Mirror failed for ${nodePath}: ${err.message}`);
        });
}

async function writeToFirebase(nodePath, payload) {
    if (!initialized) return false;

    await admin
        .database()
        .ref(String(nodePath || "").replace(/^\/+/, ""))
        .set(payload);

    return true;
}

async function readFromFirebase(nodePath) {
    if (!initialized) return null;

    const snapshot = await admin
        .database()
        .ref(String(nodePath || "").replace(/^\/+/, ""))
        .get();

    if (!snapshot.exists()) return null;
    return snapshot.val();
}

module.exports = {
    initializeFirebaseAdmin,
    isFirebaseReady,
    mirrorToFirebase,
    readFromFirebase,
    writeToFirebase
};
