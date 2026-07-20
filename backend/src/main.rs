//! splat-service backend — a small Axum + SQLite service that turns a photo
//! upload into a 3D Gaussian-splat "job" and marches it through a state machine
//! (uploaded → queued → sfm → training → exporting → done) until it's viewable.
//!
//! The six backend files, and what each one owns:
//!
//! - `main.rs`          (this file) — startup wiring: env → DB → migrate → router → serve.
//! - `state.rs`         — `Config` + `AppState`; the ONE place mock-vs-real is decided.
//! - `db.rs`            — the `Job` struct, the state machine, and every SQL query.
//! - `routes.rs`        — the HTTP endpoints (uploads, jobs, and the mock upload sink).
//! - `worker_client.rs` — the `Mock`/`Runpod` seam: how a job is handed off to a GPU.
//! - `poller.rs`        — background task that nudges active jobs forward every 5s.
//!
//! To run: copy `.env.example` to `.env`, then `cargo run`. In mock mode (the
//! default) it needs no GPU and no credentials — jobs advance on a timer.

// Module declarations. Each corresponds to a file in `src/`.
mod db;
mod poller;
mod routes;
mod state;
mod worker_client;

use sqlx::postgres::PgPoolOptions;
use state::{AppState, Config};
use tower_http::cors::CorsLayer;

// `#[tokio::main]` turns this async fn into a normal `main` by spinning up the
// Tokio async runtime around it. Everything below can then use `.await`.
#[tokio::main]
async fn main() {
    // Load variables from a local `.env` file if one exists. `.ok()` means "it's
    // fine if there's no file" — env vars can also come from the real environment.
    dotenvy::dotenv().ok();

    // Set up logging. `tracing::info!(...)` calls elsewhere print through this.
    // Verbosity is controlled by the RUST_LOG env var (defaults to `info`).
    tracing_subscriber::fmt::init();

    // Read all configuration from the environment exactly once, up front.
    let config = Config::from_env();

    // Announce the mode loudly — it's the first thing to look for in the logs.
    if config.mock_mode {
        tracing::info!("MOCK MODE enabled — jobs advance on a timer, no GPU or credentials needed");
    } else {
        tracing::info!("REAL MODE enabled — jobs are submitted to RunPod");
    }

    // Connect to Postgres. Unlike the old SQLite file there is no "create if
    // missing" — the database must already exist, so a fresh clone needs a
    // reachable server (see backend/README-dev or docker-compose.yml).
    //
    // On Railway, set this service's DATABASE_URL to the reference
    // `${{Postgres.DATABASE_URL}}`, which resolves to the private-network URL
    // (postgres.railway.internal). DATABASE_PUBLIC_URL is the external proxy and
    // bills network egress — prefer the private one for service-to-service.
    let db_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:5432/weddingai".to_string());
    let db = PgPoolOptions::new()
        .connect(&db_url)
        .await
        .expect("failed to connect to the database");

    // Apply migrations from ./migrations (embedded into the binary at compile time).
    // This creates the `jobs` table on first run and is a no-op afterwards.
    sqlx::migrate!("./migrations")
        .run(&db)
        .await
        .expect("failed to run database migrations");

    // Build the shared state. `AppState::new` is where mock-vs-real is wired up.
    // Grab the port before `config` is moved into the state.
    let port = config.port;
    let state = AppState::new(db, config);

    // Spawn the background poller. It runs for the entire life of the process,
    // moving each active job to its next state. `state.clone()` is cheap — the
    // pool/config/worker inside are all shared (Arc / connection pool handle).
    tokio::spawn(poller::run(state.clone()));

    // Build the router and wrap it in a permissive CORS layer so the frontend
    // (a browser page on a different port) is allowed to call this API.
    // TODO: restrict CORS before production
    let app = routes::router(state).layer(CorsLayer::permissive());

    // Bind the TCP listener on all interfaces and start serving.
    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("failed to bind the TCP listener");
    tracing::info!("listening on http://{addr}");
    axum::serve(listener, app)
        .await
        .expect("the HTTP server crashed");
}
