//! The HTTP layer: the router and every request handler.

use axum::{
    Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Path, State},
    http::StatusCode,
    routing::{get, post, put},
};
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::db;
use crate::state::AppState;

/// Every handler reports failure the same simple way: an HTTP status + a message.
/// No custom error enum — for a service this small, a plain tuple is the least
/// code and the easiest to read. axum knows how to turn `(StatusCode, String)`
/// into an HTTP response automatically.
type ApiError = (StatusCode, String);

/// Build the router with all routes wired to their handlers, and attach the
/// shared `AppState` so every handler can reach the DB / config / worker.
///
/// The caller (`main`) wraps the returned router in a CORS layer before serving.
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/uploads", post(create_upload))
        // The mock upload sink accepts a real photo zip, which is far larger than
        // axum's default 2MB body cap — bump the limit to 500MB *for this route
        // only* so `PUT`s of real photo zips aren't rejected as "payload too large".
        .route(
            "/api/mock-upload/{key}",
            put(mock_upload).layer(DefaultBodyLimit::max(500 * 1024 * 1024)),
        )
        // One path, two methods: POST creates a job, GET lists all jobs.
        .route("/api/jobs", post(create_job).get(list_jobs))
        .route("/api/jobs/{id}", get(get_job))
        .with_state(state)
}

// ---------------------------------------------------------------------------
// GET /api/health — one request that proves process, DB, and config are good.
// ---------------------------------------------------------------------------

/// Health probe. Returns 200 with a config snapshot when the DB answers a
/// trivial query, 503 otherwise — so a deploy healthcheck pointed here refuses
/// to go live with a bad DATABASE_URL or a broken volume mount.
async fn health(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    match sqlx::query("SELECT 1").execute(&state.db).await {
        Ok(_) => (
            StatusCode::OK,
            Json(json!({
                "status": "ok",
                "db": "ok",
                // The two config values that decide whether a deploy actually
                // works — surfaced here so one curl answers "is it wired right?"
                "mock_mode": state.config.mock_mode,
                "public_base_url": state.config.public_base_url,
                "version": env!("CARGO_PKG_VERSION"),
            })),
        ),
        Err(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "status": "degraded",
                "db": e.to_string(),
            })),
        ),
    }
}

// ---------------------------------------------------------------------------
// POST /api/uploads — get somewhere to upload the photo zip to.
// ---------------------------------------------------------------------------

async fn create_upload(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    // A fresh object-store key for this upload. `.zip` because the browser zips
    // the selected photos before uploading.
    let id = Uuid::new_v4();
    let upload_key = format!("uploads/{id}.zip");

    if state.config.mock_mode {
        // Mock mode: hand back a URL pointing at our own PUT sink (below). The
        // frontend's upload code is then IDENTICAL in mock and real mode — it
        // just PUTs the bytes to whatever `upload_url` we return here. Built on
        // the public base URL because it's the *browser* that PUTs to it.
        let base = &state.config.public_base_url;
        let upload_url = format!("{base}/api/mock-upload/{id}");
        Ok(Json(json!({
            "upload_key": upload_key,
            "upload_url": upload_url,
        })))
    } else {
        // TODO(Phase 1): presign a real R2 (S3-compatible) PUT URL with aws-sdk-s3
        // and return it in place of the mock URL above. The frontend needs no
        // changes — it already uploads to whatever URL this endpoint returns.
        Err((
            StatusCode::NOT_IMPLEMENTED,
            "R2 presigning not configured yet — see ROADMAP Phase 1".to_string(),
        ))
    }
}

// ---------------------------------------------------------------------------
// PUT /api/mock-upload/{key} — a stand-in for object storage.
// ---------------------------------------------------------------------------

/// Accept the uploaded bytes, log how many there were, and throw them away. This
/// exists purely so the frontend's real upload path works with zero credentials.
/// The `{key}` segment is ignored — there is nowhere to actually store the data.
async fn mock_upload(Path(key): Path<String>, body: Bytes) -> StatusCode {
    tracing::info!(
        "mock upload received for {key}: {} bytes (discarded)",
        body.len()
    );
    StatusCode::OK
}

// ---------------------------------------------------------------------------
// POST /api/jobs — create a job for an already-uploaded zip.
// ---------------------------------------------------------------------------

/// The JSON body for creating a job. `iters` is optional and defaults to 7000.
#[derive(Deserialize)]
struct CreateJob {
    upload_key: String,
    iters: Option<i64>,
}

async fn create_job(
    State(state): State<AppState>,
    Json(req): Json<CreateJob>,
) -> Result<Json<db::Job>, ApiError> {
    let iters = req.iters.unwrap_or(7000);

    // 1. Record the job in the DB. It starts in state 'uploaded'.
    let job = db::insert_job(&state.db, &req.upload_key, iters)
        .await
        .map_err(internal)?;

    // 2. Hand it to the worker. What happens next depends on mock vs real mode:
    match state.worker.submit(&job).await {
        // Real mode: remember RunPod's id and mark the job 'queued'.
        Ok(Some(runpod_id)) => {
            db::set_runpod_id(&state.db, &job.id, &runpod_id)
                .await
                .map_err(internal)?;
            db::set_state(&state.db, &job.id, "queued")
                .await
                .map_err(internal)?;
        }
        // Mock mode: nothing to do here — the poller advances it on a timer.
        Ok(None) => {}
        // Submission failed: mark the job 'failed' so the UI can surface it.
        Err(e) => {
            db::set_failed(&state.db, &job.id, &e)
                .await
                .map_err(internal)?;
        }
    }

    // 3. Re-read the row so the response reflects any changes made in step 2.
    let job = db::get_job(&state.db, &job.id)
        .await
        .map_err(internal)?
        .ok_or_else(|| internal("job vanished right after it was created"))?;
    Ok(Json(job))
}

// ---------------------------------------------------------------------------
// GET /api/jobs/{id} — one job, or 404.
// ---------------------------------------------------------------------------

async fn get_job(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<db::Job>, ApiError> {
    match db::get_job(&state.db, &id).await.map_err(internal)? {
        Some(job) => Ok(Json(job)),
        None => Err((StatusCode::NOT_FOUND, format!("no job with id {id}"))),
    }
}

// ---------------------------------------------------------------------------
// GET /api/jobs — every job, newest first.
// ---------------------------------------------------------------------------

async fn list_jobs(State(state): State<AppState>) -> Result<Json<Vec<db::Job>>, ApiError> {
    let jobs = db::list_jobs(&state.db).await.map_err(internal)?;
    Ok(Json(jobs))
}

/// Turn any displayable error into a 500 response. Keeps the handlers short:
/// `.map_err(internal)?` on any fallible DB call.
fn internal<E: std::fmt::Display>(e: E) -> ApiError {
    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::Config;
    use sqlx::SqlitePool;

    // Config is built by hand rather than via from_env: mutating env vars in
    // tests is racy (tests run in parallel in one process).
    fn test_config() -> Config {
        Config {
            mock_mode: true,
            port: 8080,
            public_base_url: "http://localhost:8080".to_string(),
            runpod_api_key: String::new(),
            runpod_endpoint_id: String::new(),
        }
    }

    async fn test_state() -> AppState {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("in-memory sqlite always connects");
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .expect("migrations apply cleanly");
        AppState::new(pool, test_config())
    }

    #[tokio::test]
    async fn health_reports_ok_with_reachable_db() {
        let (status, Json(body)) = health(State(test_state().await)).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["status"], "ok");
        assert_eq!(body["db"], "ok");
        assert_eq!(body["mock_mode"], true);
        assert_eq!(body["public_base_url"], "http://localhost:8080");
        assert_eq!(body["version"], env!("CARGO_PKG_VERSION"));
    }

    #[tokio::test]
    async fn health_reports_degraded_when_db_is_gone() {
        let state = test_state().await;
        state.db.close().await;
        let (status, Json(body)) = health(State(state)).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(body["status"], "degraded");
    }
}
