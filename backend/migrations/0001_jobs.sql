CREATE TABLE jobs (
    id             TEXT PRIMARY KEY,                        -- uuid v4, generated app-side
    state          TEXT NOT NULL DEFAULT 'uploaded',        -- uploaded|queued|sfm|training|exporting|done|failed
    -- Kept as TEXT rather than TIMESTAMPTZ on purpose: db.rs reads created_at
    -- into a plain String, and sqlx's Postgres driver (unlike SQLite's) will not
    -- decode a timestamp column into String without pulling in chrono/time.
    -- to_char also reproduces SQLite's exact 'YYYY-MM-DD HH:MM:SS' UTC shape,
    -- which frontend/app/jobs/page.tsx pattern-matches on to parse dates as UTC.
    created_at     TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
    upload_key     TEXT NOT NULL,                           -- object-store key the photos zip was PUT to
    -- BIGINT, not INTEGER: db.rs declares `iters: i64`. SQLite's dynamic affinity
    -- round-tripped that happily, but Postgres INTEGER is a strict 4-byte int4
    -- and sqlx will not implicitly widen it into an i64 — it fails at runtime.
    iters          BIGINT NOT NULL DEFAULT 7000,            -- training iterations requested
    runpod_id      TEXT,                                    -- RunPod job id (NULL in mock mode)
    artifacts_json TEXT,                                    -- JSON: {"scene_url": "..."} when done
    error_msg      TEXT                                     -- populated when state = failed
);
