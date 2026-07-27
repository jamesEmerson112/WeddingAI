use std::path::PathBuf;
use std::sync::Arc;

use sqlx::PgPool;

use crate::worker_client::WorkerClient;

/// Everything read from the environment, once, at startup.
pub struct Config {
    pub mock_mode: bool,
    pub port: u16,
    /// Base URL clients can reach this backend on. The upload endpoint hands the
    /// browser an absolute URL built from this — it must be the *public* address
    /// when deployed, not localhost.
    pub public_base_url: String,
    /// Root of the persistent volume. Everything the backend stores on disk
    /// lives under here: `uploads/` (photo zips on their way to the GPU) and
    /// `artifacts/` (finished scenes on their way back to the browser).
    ///
    /// On Railway this MUST be the volume's mount path — if the volume isn't
    /// attached, `/data` silently resolves to the ephemeral container disk and
    /// every stored file vanishes on the next redeploy. `main.rs` probes it at
    /// startup and `/api/health` reports it so that failure is loud, not silent.
    pub data_dir: PathBuf,
    pub runpod_api_key: String,
    pub runpod_endpoint_id: String,
    /// Bearer token guarding the artifact ingest route. Empty disables the
    /// route entirely (it 404s), so it does not exist unless deliberately
    /// switched on.
    pub admin_token: String,
    /// Filename under `artifacts/` that finished MOCK jobs should point at,
    /// e.g. `scene-3041.html`. Empty keeps the old inert placeholder path.
    pub demo_scene_key: String,
    /// Budget the storage bar measures against, in bytes. Not a hard cap — the
    /// real limit is the Railway volume's own size — just the denominator the UI
    /// fills toward. Defaults to the 5 GB Hobby volume; set it to match the
    /// actual plan (the free tier is 0.5 GB).
    pub storage_limit_bytes: u64,
}

impl Config {
    pub fn from_env() -> Config {
        // Mock mode is the default: anything except an explicit "false" keeps it on,
        // so a fresh clone works with no .env at all.
        let mock_mode = std::env::var("MOCK_MODE")
            .map(|v| v != "false")
            .unwrap_or(true);
        let port = std::env::var("PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(8080);
        // Resolution order: explicit PUBLIC_BASE_URL, else Railway's injected
        // public domain (so deploys there need no extra config), else localhost.
        let public_base_url = std::env::var("PUBLIC_BASE_URL")
            .ok()
            .filter(|v| !v.is_empty())
            .or_else(|| {
                std::env::var("RAILWAY_PUBLIC_DOMAIN")
                    .ok()
                    .filter(|v| !v.is_empty())
                    .map(|domain| format!("https://{domain}"))
            })
            .unwrap_or_else(|| format!("http://localhost:{port}"))
            .trim_end_matches('/')
            .to_string();
        // Where persistent files live. Same resolution shape as public_base_url:
        // an explicit DATA_DIR wins; otherwise assume `/data` when running on
        // Railway (where a volume is expected at that mount path) and a
        // gitignored `./data` when running locally.
        let data_dir: PathBuf = std::env::var("DATA_DIR")
            .ok()
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| {
                let on_railway = std::env::var("RAILWAY_PUBLIC_DOMAIN")
                    .map(|v| !v.is_empty())
                    .unwrap_or(false);
                if on_railway { "/data" } else { "./data" }.to_string()
            })
            .into();
        // Empty strings are fine in mock mode; real mode needs them filled in.
        let runpod_api_key = std::env::var("RUNPOD_API_KEY").unwrap_or_default();
        let runpod_endpoint_id = std::env::var("RUNPOD_ENDPOINT_ID").unwrap_or_default();
        let admin_token = std::env::var("ADMIN_TOKEN").unwrap_or_default();
        let demo_scene_key = std::env::var("DEMO_SCENE_KEY").unwrap_or_default();
        // 5 GiB default = the Railway Hobby volume. Override to match the plan.
        let storage_limit_bytes = std::env::var("STORAGE_LIMIT_BYTES")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(5 * 1024 * 1024 * 1024);
        Config {
            mock_mode,
            port,
            public_base_url,
            data_dir,
            runpod_api_key,
            runpod_endpoint_id,
            admin_token,
            demo_scene_key,
            storage_limit_bytes,
        }
    }

    /// Photo zips land here on their way to the GPU worker.
    pub fn uploads_dir(&self) -> PathBuf {
        self.data_dir.join("uploads")
    }

    /// Finished scenes live here on their way back to the browser.
    pub fn artifacts_dir(&self) -> PathBuf {
        self.data_dir.join("artifacts")
    }

    /// The `artifacts_json` a finished MOCK job should carry, or `None` when no
    /// demo scene is configured (callers then fall back to
    /// `LEGACY_PLACEHOLDER_ARTIFACTS`).
    ///
    /// `is_sample` is load-bearing, not decoration. Every mock job resolves to
    /// the SAME one scene, so the frontend must be able to label it as a sample
    /// rather than pass it off as the viewer's own upload. Deriving that from a
    /// URL string comparison (as the frontend used to) breaks the moment a real
    /// per-job scene is served from the same directory — so the backend, the
    /// only party that actually knows, says so explicitly.
    ///
    /// Lives here rather than in `poller.rs` because two callers must produce
    /// byte-identical JSON: the poller stamping newly-finished jobs, and the
    /// startup backfill repairing jobs that finished before this existed.
    pub fn demo_artifacts_json(&self) -> Option<String> {
        if self.demo_scene_key.is_empty() {
            return None;
        }
        let base = &self.public_base_url;
        let key = &self.demo_scene_key;
        Some(
            serde_json::json!({
                "scene_url": format!("{base}/artifacts/{key}"),
                "is_sample": true,
            })
            .to_string(),
        )
    }
}

/// What the mock poller stamped on finished jobs before scenes moved to the
/// volume: a frontend-relative path to an inert 4 KB stand-in.
///
/// Still the fallback when no demo scene is configured, AND the exact value the
/// startup backfill looks for in historical rows.
pub const LEGACY_PLACEHOLDER_ARTIFACTS: &str = r#"{"scene_url":"/demo/scene.html"}"#;

/// The one shared object every request handler receives (via axum's State).
#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub config: Arc<Config>,
    pub worker: Arc<WorkerClient>,
}

impl AppState {
    pub fn new(db: PgPool, config: Config) -> AppState {
        // The ONLY place where mock-vs-real is decided. Everything downstream
        // just matches on the enum.
        let worker = if config.mock_mode {
            WorkerClient::Mock
        } else {
            WorkerClient::Runpod {
                http: reqwest::Client::new(),
                api_key: config.runpod_api_key.clone(),
                endpoint_id: config.runpod_endpoint_id.clone(),
            }
        };
        AppState {
            db,
            config: Arc::new(config),
            worker: Arc::new(worker),
        }
    }
}
