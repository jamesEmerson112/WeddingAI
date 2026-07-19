use std::sync::Arc;

use sqlx::SqlitePool;

use crate::worker_client::WorkerClient;

/// Everything read from the environment, once, at startup.
pub struct Config {
    pub mock_mode: bool,
    pub port: u16,
    pub runpod_api_key: String,
    pub runpod_endpoint_id: String,
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
        // Empty strings are fine in mock mode; real mode needs them filled in.
        let runpod_api_key = std::env::var("RUNPOD_API_KEY").unwrap_or_default();
        let runpod_endpoint_id = std::env::var("RUNPOD_ENDPOINT_ID").unwrap_or_default();
        Config {
            mock_mode,
            port,
            runpod_api_key,
            runpod_endpoint_id,
        }
    }
}

/// The one shared object every request handler receives (via axum's State).
#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub config: Arc<Config>,
    pub worker: Arc<WorkerClient>,
}

impl AppState {
    pub fn new(db: SqlitePool, config: Config) -> AppState {
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
