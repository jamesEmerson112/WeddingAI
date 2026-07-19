CREATE TABLE jobs (
    id             TEXT PRIMARY KEY,                        -- uuid v4
    state          TEXT NOT NULL DEFAULT 'uploaded',        -- uploaded|queued|sfm|training|exporting|done|failed
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    upload_key     TEXT NOT NULL,                           -- object-store key the photos zip was PUT to
    iters          INTEGER NOT NULL DEFAULT 7000,           -- training iterations requested
    runpod_id      TEXT,                                    -- RunPod job id (NULL in mock mode)
    artifacts_json TEXT,                                    -- JSON: {"scene_url": "..."} when done
    error_msg      TEXT                                     -- populated when state = failed
);
