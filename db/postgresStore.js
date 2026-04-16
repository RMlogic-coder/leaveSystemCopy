const { Pool } = require("pg");

const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const PGSSL = String(process.env.PGSSL || "false").trim().toLowerCase() === "true";

let pool = null;
let initialized = false;

function isConfigured() {
    return Boolean(DATABASE_URL);
}

function buildPool() {
    if (!isConfigured()) {
        throw new Error("DATABASE_URL is not set");
    }
    return new Pool({
        connectionString: DATABASE_URL,
        ssl: PGSSL ? { rejectUnauthorized: false } : false
    });
}

async function initStore() {
    if (initialized) return;
    if (!pool) pool = buildPool();

    await pool.query(`
        CREATE TABLE IF NOT EXISTS json_stores (
            store_key TEXT PRIMARY KEY,
            payload JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    initialized = true;
}

async function readStore(storeKey, fallbackValue) {
    if (!pool) pool = buildPool();
    await initStore();

    const result = await pool.query(
        "SELECT payload FROM json_stores WHERE store_key = $1 LIMIT 1",
        [storeKey]
    );

    if (!result.rows.length) {
        return fallbackValue;
    }
    return result.rows[0].payload;
}

async function writeStore(storeKey, payload) {
    if (!pool) pool = buildPool();
    await initStore();

    await pool.query(
        `
        INSERT INTO json_stores (store_key, payload, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (store_key)
        DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
        `,
        [storeKey, JSON.stringify(payload)]
    );
}

async function listStoreMeta() {
    if (!pool) pool = buildPool();
    await initStore();

    const result = await pool.query(
        "SELECT store_key, jsonb_typeof(payload) AS payload_type, updated_at FROM json_stores ORDER BY store_key"
    );
    return result.rows;
}

async function healthCheck() {
    if (!pool) pool = buildPool();
    const result = await pool.query("SELECT NOW() AS now");
    return result.rows[0];
}

async function closeStore() {
    if (!pool) return;
    await pool.end();
    pool = null;
    initialized = false;
}

module.exports = {
    isConfigured,
    initStore,
    readStore,
    writeStore,
    listStoreMeta,
    healthCheck,
    closeStore
};
