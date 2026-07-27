//! splat-service backend — a small Axum + Postgres service that turns a photo
//! upload into a 3D Gaussian-splat "job" and marches it through a state machine
//! (uploaded → queued → sfm → training → exporting → done) until it's viewable.
//!
//! It is also the FILE BROKER between the browser and the GPU worker: photo zips
//! and finished scenes are both stored on an attached volume under `DATA_DIR`
//! and served over HTTP, so neither side needs object-store credentials.
//!
//! The six backend files, and what each one owns:
//!
//! - `main.rs`          (this file) — startup wiring: env → DB → migrate → router → serve.
//! - `state.rs`         — `Config` + `AppState`; the ONE place mock-vs-real is decided.
//! - `db.rs`            — the `Job` struct, the state machine, and every SQL query.
//! - `routes.rs`        — the HTTP endpoints: jobs, upload store/fetch, artifact ingest/serve.
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
    let mut config = Config::from_env();

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

    // Fail with an explanation rather than sqlx's bare
    // `Configuration(RelativeUrlWithoutBase)`, which is what you get when
    // DATABASE_URL is set but isn't a URL at all. The overwhelmingly common
    // cause on Railway is an unresolved reference variable: `${{Foo.DATABASE_URL}}`
    // stays a literal string when no service is named exactly `Foo`, so the
    // variable looks correctly set in the dashboard while being useless.
    //
    // NEVER log db_url itself — it carries the database password.
    if !(db_url.starts_with("postgres://") || db_url.starts_with("postgresql://")) {
        let hint = if db_url.contains("${{") {
            "it still contains a literal `${{...}}` reference — the referenced \
             Railway service name doesn't match any service in this project"
        } else if db_url.starts_with("sqlite:") {
            "it's still the old SQLite URL — this backend moved to Postgres"
        } else {
            "it has no `postgres://` scheme"
        };
        panic!(
            "DATABASE_URL is not a Postgres connection string: {hint}. \
             Expected postgres://user:pass@host:port/dbname. \
             On Railway set it to the reference ${{{{Postgres.DATABASE_URL}}}} \
             (exact service name), or use the dashboard's \
             \"Trying to connect a database? Add Variable\" prompt."
        );
    }

    // Create the storage directories and prove they're actually writable before
    // serving a single request.
    //
    // This exists for the same reason as the DATABASE_URL check above: a
    // misconfiguration that only surfaces later is far more expensive than a
    // loud startup failure. The specific trap here is that if the Railway
    // volume is NOT attached, `/data` still exists and still accepts writes —
    // it just resolves to the ephemeral container disk, so everything works
    // perfectly until the next redeploy silently erases every stored file.
    // Probing can't distinguish those two cases, so `/api/health` reports the
    // path and the operator confirms the mount separately (`railway volume list`).
    ensure_writable_dir(&config.uploads_dir());
    ensure_writable_dir(&config.artifacts_dir());
    tracing::info!("storage ready at {}", config.data_dir.display());

    // Refuse to advertise a demo scene that isn't actually on disk.
    //
    // This is the exact failure that caused the incident this whole change
    // exists to fix: the code confidently pointed every viewer at a scene file
    // the host was not serving, so the iframe 404'd — strictly worse than the
    // honest placeholder it replaced. Setting DEMO_SCENE_KEY before running
    // scripts/seed-demo-scene.sh would reproduce it exactly.
    //
    // So: verify, and fail CLOSED to the placeholder rather than open to a 404.
    if !config.demo_scene_key.is_empty() {
        let scene = config.artifacts_dir().join(&config.demo_scene_key);
        if !scene.is_file() {
            tracing::error!(
                "DEMO_SCENE_KEY is set to '{}' but {} does not exist — falling back \
                 to the placeholder scene. Run scripts/seed-demo-scene.sh to upload \
                 it, then restart.",
                config.demo_scene_key,
                scene.display()
            );
            config.demo_scene_key.clear();
        } else {
            tracing::info!("demo scene ready: {}", scene.display());
        }
    }

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

    // Repoint any job that finished BEFORE a demo scene was configured. Runs on
    // every boot and is a no-op once converted — see relabel_legacy_demo_jobs.
    if let Some(artifacts) = config.demo_artifacts_json() {
        match db::relabel_legacy_demo_jobs(&db, &artifacts).await {
            Ok(0) => {}
            Ok(n) => tracing::info!("repointed {n} finished job(s) at the demo scene"),
            // Not fatal: new jobs still get the right URL, and the service is
            // more useful up than down.
            Err(e) => tracing::warn!("could not repoint finished jobs (ignored): {e}"),
        }
    }

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

/// Create `dir` if needed, then write and delete a probe file to prove the
/// process can actually write there.
///
/// The two failure modes are deliberately NOT treated the same:
///
/// - `create_dir_all` failing means the configuration is unusable — the path is
///   wrong or the mount is missing — so panic, the same way an unparseable
///   DATABASE_URL does. There is nothing the service could usefully do.
///
/// - the probe write failing is logged, and the process boots anyway. The
///   dominant cause of that is a FULL VOLUME, which is now reachable for the
///   first time (uploads used to be discarded; they are kept). Panicking there
///   would turn "uploads are failing" into "the whole service is in a permanent
///   crash loop, including the parts that only read" — every boot would refill,
///   re-probe, and re-panic with no way out except a redeploy. Reads, the job
///   API, and already-stored scenes all keep working, and `/api/health` reports
///   `data_dir_writable: false`, which is what an operator needs to see.
fn ensure_writable_dir(dir: &std::path::Path) {
    if let Err(e) = std::fs::create_dir_all(dir) {
        panic!(
            "cannot create storage directory {}: {e}. On Railway this usually \
             means DATA_DIR points somewhere the volume isn't mounted — check \
             the service's Volumes settings and that the mount path matches.",
            dir.display()
        );
    }
    let probe = dir.join(".write-probe");
    if let Err(e) = std::fs::write(&probe, b"ok") {
        tracing::error!(
            "storage directory {} is NOT writable: {e}. Uploads and artifact \
             ingest will fail until this is fixed (a full volume is the usual \
             cause). Serving reads anyway — see /api/health.",
            dir.display()
        );
        return;
    }
    // Best effort: a leftover probe file is harmless, so don't fail on cleanup.
    let _ = std::fs::remove_file(&probe);
}
