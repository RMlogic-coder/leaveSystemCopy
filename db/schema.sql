CREATE TABLE IF NOT EXISTS json_stores (
    store_key TEXT PRIMARY KEY,
    payload JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_json_stores_updated_at
    ON json_stores (updated_at DESC);
