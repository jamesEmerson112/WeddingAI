//! The HTTP layer: the router and every request handler.

use axum::{
    Json, Router,
    body::Body,
    extract::{Path, State},
    http::{HeaderMap, StatusCode, header},
    response::Response,
    routing::{get, post, put},
};
use futures_util::TryStreamExt;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio_util::io::{ReaderStream, StreamReader};
use tower_http::{limit::RequestBodyLimitLayer, services::ServeDir};
use uuid::Uuid;

use crate::db;
use crate::state::AppState;

/// Ceiling on a single uploaded photo zip.
///
/// These bytes now land on a Railway volume (5 GB on the Hobby plan) instead of
/// being discarded, so an unbounded sink is a self-inflicted outage rather than
/// a theoretical risk. ~25 uploads fit at this size. There is no retention
/// sweep yet — see the storage notes in CLAUDE.md.
///
/// MUST be enforced with `RequestBodyLimitLayer`, NOT `DefaultBodyLimit`.
/// `DefaultBodyLimit` only annotates the request with a size hint that
/// `Bytes`-based extractors (Bytes/String/Json/Form) consult; a handler taking
/// a raw `axum::body::Body` never reads it, so the cap silently does nothing.
/// That was the original bug here — a 250 MB body was accepted and written to
/// disk in full against a nominal 200 MB limit. `RequestBodyLimitLayer` wraps
/// the body itself, so it holds regardless of which extractor runs.
const MAX_UPLOAD_BYTES: usize = 200 * 1024 * 1024;

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
    // ServeDir needs the path before `state` is moved into `with_state`.
    let artifacts_dir = state.config.artifacts_dir();

    Router::new()
        .route("/api/health", get(health))
        .route("/api/uploads", post(create_upload))
        // One key, two directions: the browser PUTs the photo zip here, and the
        // GPU worker GETs it back. This is the whole reason the backend exists
        // as a broker — neither side needs object-store credentials.
        //
        // The body cap is raised well above axum's 2MB default (a real photo
        // zip is tens of MB) but capped at MAX_UPLOAD_BYTES rather than left
        // wide open, because these bytes are now kept.
        .route(
            "/api/uploads/{key}",
            put(store_upload)
                .get(get_upload)
                .layer(RequestBodyLimitLayer::new(MAX_UPLOAD_BYTES)),
        )
        // Ingest for finished scenes. Guarded by ADMIN_TOKEN; 404s when unset.
        .route(
            "/api/artifacts/{*name}",
            put(put_artifact).layer(RequestBodyLimitLayer::new(MAX_UPLOAD_BYTES)),
        )
        // How much of the volume the stored files use — drives the header bar.
        .route("/api/storage", get(storage))
        // One path, two methods: POST creates a job, GET lists all jobs.
        .route("/api/jobs", post(create_job).get(list_jobs))
        .route("/api/jobs/{id}", get(get_job))
        .with_state(state)
        // Public read-only serving of scene artifacts off the volume.
        //
        // ServeDir rather than a hand-rolled handler on purpose: it gives
        // streaming, range requests, ETag/conditional GETs, content-type
        // sniffing, and path-traversal rejection for free. `precompressed_gzip`
        // serves `<file>.gz` when the client accepts gzip — which matters a lot
        // here, since the demo scene is 29 MB raw and 21 MB gzipped.
        .nest_service(
            "/artifacts",
            ServeDir::new(&artifacts_dir).precompressed_gzip(),
        )
}

// ---------------------------------------------------------------------------
// GET /api/health — one request that proves process, DB, and config are good.
// ---------------------------------------------------------------------------

/// Health probe. Returns 200 with a config snapshot when the DB answers a
/// trivial query, 503 otherwise — so a deploy healthcheck pointed here refuses
/// to go live with a bad DATABASE_URL or a broken volume mount.
async fn health(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    // An actual write, not a metadata check: the failure mode worth catching is
    // "the directory exists but this process can't write to it", which
    // `exists()` reports as healthy. Cheap enough for a healthcheck interval.
    //
    // Probes the volume ROOT rather than artifacts/ deliberately — artifacts/ is
    // served publicly by ServeDir, and a healthcheck firing every few seconds
    // would keep briefly materialising a probe file inside a directory anyone
    // can fetch from. Same volume, same answer, nothing served.
    let data_dir_writable = probe_writable(&state.config.data_dir).await;

    match sqlx::query("SELECT 1").execute(&state.db).await {
        Ok(_) => (
            StatusCode::OK,
            Json(json!({
                "status": "ok",
                "db": "ok",
                // The config values that decide whether a deploy actually
                // works — surfaced here so one curl answers "is it wired right?"
                "mock_mode": state.config.mock_mode,
                "public_base_url": state.config.public_base_url,
                // NOTE: true here does NOT prove the Railway volume is mounted.
                // An unattached volume leaves `/data` writable on the ephemeral
                // container disk, which passes this probe and then loses every
                // file on the next redeploy. Confirm the mount separately.
                "data_dir": state.config.data_dir.display().to_string(),
                "data_dir_writable": data_dir_writable,
                "demo_scene_key": state.config.demo_scene_key,
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
// GET /api/storage — how full the volume is, for the header bar.
// ---------------------------------------------------------------------------

/// Bytes + file count under one directory, gathered by a recursive walk.
struct DirUsage {
    bytes: u64,
    files: u64,
}

/// Report stored bytes against the configured budget.
///
/// The number is our own usage (a walk of what we wrote), not the filesystem's
/// free space — deterministic, dependency-free, and identical local and
/// deployed. `limit_bytes` is a soft denominator for the UI, not the real cap;
/// the real cap is the Railway volume's own size.
async fn storage(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let uploads = state.config.uploads_dir();
    let artifacts = state.config.artifacts_dir();

    // The walk hits the disk, so keep it off the async runtime. Cheap at demo
    // scale (tens of files); if that ever changes, cache it in AppState.
    let (uploads_use, artifacts_use) =
        tokio::task::spawn_blocking(move || (dir_usage(&uploads), dir_usage(&artifacts)))
            .await
            .map_err(internal)?;

    let used = uploads_use.bytes + artifacts_use.bytes;
    Ok(Json(json!({
        "used_bytes": used,
        "limit_bytes": state.config.storage_limit_bytes,
        "uploads_bytes": uploads_use.bytes,
        "artifacts_bytes": artifacts_use.bytes,
        "file_count": uploads_use.files + artifacts_use.files,
    })))
}

/// Recursively sum file sizes under `dir`. A missing directory is 0, not an
/// error — the storage view should never fail just because nothing's stored
/// yet. Dotfiles are skipped: the only ones here are the `.write-probe` /
/// `.health-probe` files the writability checks leave behind, which aren't
/// user data and would otherwise inflate the count.
fn dir_usage(dir: &std::path::Path) -> DirUsage {
    let mut usage = DirUsage { bytes: 0, files: 0 };
    let Ok(entries) = std::fs::read_dir(dir) else {
        return usage;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue;
        }
        // file_type() avoids a follow-symlink stat; fall back to is_file below.
        match entry.file_type() {
            Ok(ft) if ft.is_dir() => {
                let sub = dir_usage(&entry.path());
                usage.bytes += sub.bytes;
                usage.files += sub.files;
            }
            Ok(ft) if ft.is_file() => {
                if let Ok(meta) = entry.metadata() {
                    usage.bytes += meta.len();
                    usage.files += 1;
                }
            }
            _ => {}
        }
    }
    usage
}

// ---------------------------------------------------------------------------
// POST /api/uploads — get somewhere to upload the photo zip to.
// ---------------------------------------------------------------------------

async fn create_upload(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    // A fresh object-store key for this upload. `.zip` because the browser zips
    // the selected photos before uploading.
    let id = Uuid::new_v4();
    let upload_key = format!("uploads/{id}.zip");

    // Same URL in mock and real mode: the backend stores the bytes itself on
    // the attached volume, so there is no object store to presign against and
    // no credentials for either the browser or the GPU worker to hold. Built on
    // the public base URL because it's the *browser* that PUTs to it.
    let base = &state.config.public_base_url;
    let upload_url = format!("{base}/api/uploads/{id}");
    Ok(Json(json!({
        "upload_key": upload_key,
        "upload_url": upload_url,
    })))
}

// ---------------------------------------------------------------------------
// PUT /api/uploads/{key} — store the photo zip on the volume.
// GET /api/uploads/{key} — hand it to the GPU worker.
// ---------------------------------------------------------------------------

/// Resolve `{key}` to a path under `uploads/`, rejecting anything that isn't a
/// bare UUID. Parsing as a UUID (rather than sanitizing a string) is what keeps
/// `..` and absolute paths out of the join — there is no traversal to filter
/// because nothing but a UUID is ever accepted.
fn upload_path(state: &AppState, key: &str) -> Result<std::path::PathBuf, ApiError> {
    let id: Uuid = key
        .parse()
        .map_err(|_| (StatusCode::BAD_REQUEST, "upload key must be a uuid".into()))?;
    Ok(state.config.uploads_dir().join(format!("{id}.zip")))
}

/// Stream a request body straight to `path`, cleaning up on any failure.
///
/// Streaming rather than taking `Bytes` matters now that the bytes are kept: a
/// `Bytes` extractor buffers the ENTIRE upload in memory before the handler
/// runs, so a 200 MB zip would be a 200 MB allocation per concurrent upload.
///
/// Every failure path deletes the partial file. A truncated zip left on disk
/// would look like a valid upload and only fail much later, deep inside COLMAP,
/// where the real cause is almost impossible to see.
async fn stream_body_to_file(body: Body, path: &std::path::Path) -> Result<u64, ApiError> {
    let mut file = tokio::fs::File::create(path).await.map_err(disk_error)?;
    let stream = body
        .into_data_stream()
        .map_err(|e| std::io::Error::other(e.to_string()));
    let mut reader = StreamReader::new(stream);

    let cleanup = |e: std::io::Error| async move {
        let _ = tokio::fs::remove_file(path).await;
        disk_error(e)
    };

    let written = match tokio::io::copy(&mut reader, &mut file).await {
        Ok(n) => n,
        Err(e) => return Err(cleanup(e).await),
    };
    // Flush explicitly: dropping the handle would discard buffered bytes
    // without surfacing an error, and a silently short file is the worst
    // possible outcome here.
    if let Err(e) = tokio::io::AsyncWriteExt::flush(&mut file).await {
        return Err(cleanup(e).await);
    }
    Ok(written)
}

/// Map a write failure to a status a caller can act on.
///
/// Two cases are worth distinguishing from a generic 500:
/// - the volume is full (507), which is an operator problem, not a bad request;
/// - the body exceeded `MAX_UPLOAD_BYTES` (413), which surfaces through the
///   stream as an I/O error because `RequestBodyLimitLayer` aborts the body
///   mid-flight rather than rejecting the request up front.
fn disk_error(e: std::io::Error) -> ApiError {
    if e.kind() == std::io::ErrorKind::StorageFull {
        return (
            StatusCode::INSUFFICIENT_STORAGE,
            "storage volume is full".to_string(),
        );
    }
    let text = e.to_string();
    if text.contains("length limit exceeded") || text.contains("body too large") {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            format!("upload exceeds the {MAX_UPLOAD_BYTES} byte limit"),
        );
    }
    (StatusCode::INTERNAL_SERVER_ERROR, text)
}

async fn store_upload(
    State(state): State<AppState>,
    Path(key): Path<String>,
    body: Body,
) -> Result<StatusCode, ApiError> {
    let path = upload_path(&state, &key)?;
    let written = stream_body_to_file(body, &path).await?;
    tracing::info!("stored upload {key}: {written} bytes");
    Ok(StatusCode::OK)
}

/// Stream a stored zip back out — this is how the GPU worker fetches its input.
///
/// Access control is the unguessability of a v4 UUID, which is NOT
/// authentication. Anyone holding the key can read the photos. That is an
/// accepted trade for a demo with no accounts; revisit before real users.
async fn get_upload(
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> Result<Response, ApiError> {
    let path = upload_path(&state, &key)?;
    let file = tokio::fs::File::open(&path)
        .await
        .map_err(|_| (StatusCode::NOT_FOUND, format!("no upload for key {key}")))?;
    let len = file.metadata().await.map_err(internal)?.len();

    // Stream from disk instead of reading it all into memory, for the same
    // reason store_upload streams in.
    let body = Body::from_stream(ReaderStream::new(file));
    Response::builder()
        .header(header::CONTENT_TYPE, "application/zip")
        .header(header::CONTENT_LENGTH, len)
        .body(body)
        .map_err(internal)
}

// ---------------------------------------------------------------------------
// PUT /api/artifacts/{*name} — ingest a finished scene onto the volume.
// ---------------------------------------------------------------------------

/// Accept an artifact (a scene export, or its `.gz` sibling) and store it under
/// `artifacts/`, from where the public `/artifacts` ServeDir serves it.
///
/// Two callers: the GPU worker publishing a real per-job scene, and a human
/// seeding the demo scene by hand.
///
/// Guarded by a bearer token. When `ADMIN_TOKEN` is unset the route reports 404
/// rather than 401 — an unconfigured deploy should look like it has no such
/// endpoint at all, not like one waiting to be guessed at.
async fn put_artifact(
    State(state): State<AppState>,
    Path(name): Path<String>,
    headers: HeaderMap,
    body: Body,
) -> Result<StatusCode, ApiError> {
    let expected = &state.config.admin_token;
    if expected.is_empty() {
        return Err((StatusCode::NOT_FOUND, "not found".into()));
    }
    let presented = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    if !constant_time_eq(presented.as_bytes(), expected.as_bytes()) {
        return Err((
            StatusCode::UNAUTHORIZED,
            "bad or missing bearer token".into(),
        ));
    }

    let path = artifact_path(&state, &name)?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(disk_error)?;
    }

    let written = stream_body_to_file(body, &path).await?;

    // Drop any stale precompressed sibling.
    //
    // `ServeDir::precompressed_gzip()` prefers `<name>.gz` for every
    // gzip-accepting client and only falls back to the plain file if the `.gz`
    // is absent. So re-uploading `scene.html` while an OLD `scene.html.gz` sits
    // beside it would serve the old content to every browser (all of them send
    // `Accept-Encoding: gzip`) while `curl --compressed`-less checks show the
    // new content — a difference that is genuinely hard to spot. Removing the
    // sibling makes the fallback path correct-by-default; re-upload the `.gz`
    // afterwards to restore compression.
    if !name.ends_with(".gz") {
        let sibling = path.with_extension(format!(
            "{}.gz",
            path.extension().and_then(|e| e.to_str()).unwrap_or("")
        ));
        if tokio::fs::remove_file(&sibling).await.is_ok() {
            tracing::warn!(
                "removed stale {}.gz — re-upload it to restore gzip serving",
                name
            );
        }
    }

    tracing::info!("stored artifact {name}: {written} bytes");
    Ok(StatusCode::OK)
}

/// Resolve a (possibly nested, e.g. `jobs/<id>/scene.html`) artifact name to a
/// path under `artifacts/`.
///
/// Allow-list, not deny-list: every segment must be non-empty and consist only
/// of `[A-Za-z0-9._-]`, and no segment may begin with a dot. That admits
/// `jobs/<uuid>/scene.html.gz` and excludes `..`, absolute paths, backslashes,
/// NUL, and dotfiles without needing to enumerate what traversal looks like.
fn artifact_path(state: &AppState, name: &str) -> Result<std::path::PathBuf, ApiError> {
    let bad = || {
        (
            StatusCode::BAD_REQUEST,
            "artifact name must be slash-separated [A-Za-z0-9._-] segments".to_string(),
        )
    };
    let segments: Vec<&str> = name.split('/').collect();
    if segments.is_empty() {
        return Err(bad());
    }
    for segment in &segments {
        if segment.is_empty() || segment.starts_with('.') {
            return Err(bad());
        }
        if !segment
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        {
            return Err(bad());
        }
    }
    let mut path = state.config.artifacts_dir();
    for segment in segments {
        path.push(segment);
    }
    Ok(path)
}

/// Length-independent byte comparison, so a token check can't be narrowed by
/// timing. Not worth a crate dependency at this size.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Write-and-delete probe used by the healthcheck.
async fn probe_writable(dir: &std::path::Path) -> bool {
    let probe = dir.join(".health-probe");
    if tokio::fs::write(&probe, b"ok").await.is_err() {
        return false;
    }
    let _ = tokio::fs::remove_file(&probe).await;
    true
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
    use sqlx::PgPool;
    use sqlx::postgres::PgPoolOptions;

    // Config is built by hand rather than via from_env: mutating env vars in
    // tests is racy (tests run in parallel in one process).
    //
    // `data_dir` gets a per-test unique directory for the same reason each test
    // gets its own Postgres schema — parallel tests writing the same
    // `uploads/`/`artifacts/` tree would collide on filenames and go flaky.
    fn test_config() -> Config {
        let data_dir = std::env::temp_dir().join(format!("weddingai_test_{}", Uuid::new_v4()));
        Config {
            mock_mode: true,
            port: 8080,
            public_base_url: "http://localhost:8080".to_string(),
            data_dir,
            runpod_api_key: String::new(),
            runpod_endpoint_id: String::new(),
            admin_token: String::new(),
            demo_scene_key: String::new(),
            storage_limit_bytes: 5 * 1024 * 1024 * 1024,
        }
    }

    /// Postgres has no in-process equivalent of `sqlite::memory:`, so these
    /// tests need a reachable server. `docker compose up -d db` from backend/
    /// starts one; CI provides it as a service container.
    ///
    /// Each test gets its own schema so parallel tests can't collide on the
    /// same `jobs` table — the old in-memory SQLite gave that isolation for
    /// free, and losing it silently would make these tests flaky.
    async fn test_state() -> AppState {
        let url = std::env::var("TEST_DATABASE_URL").unwrap_or_else(|_| {
            "postgres://postgres:postgres@localhost:5432/weddingai_test".to_string()
        });
        let schema = format!("test_{}", Uuid::new_v4().simple());
        let pool = PgPoolOptions::new()
            .after_connect({
                let schema = schema.clone();
                move |conn, _| {
                    let schema = schema.clone();
                    Box::pin(async move {
                        sqlx::query(&format!("CREATE SCHEMA IF NOT EXISTS {schema}"))
                            .execute(&mut *conn)
                            .await?;
                        sqlx::query(&format!("SET search_path TO {schema}"))
                            .execute(&mut *conn)
                            .await?;
                        Ok(())
                    })
                }
            })
            .connect(&url)
            .await
            .expect("TEST_DATABASE_URL must point at a running Postgres");
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .expect("migrations apply cleanly");
        let state = AppState::new(pool, test_config());
        // main.rs does this at startup; the handlers assume it has happened.
        std::fs::create_dir_all(state.config.uploads_dir()).unwrap();
        std::fs::create_dir_all(state.config.artifacts_dir()).unwrap();
        state
    }

    /// A state with no DB, for the pure path/token logic that doesn't touch one.
    /// Avoids making every unit test wait on Postgres.
    fn fs_only_state() -> AppState {
        let config = test_config();
        std::fs::create_dir_all(config.uploads_dir()).unwrap();
        std::fs::create_dir_all(config.artifacts_dir()).unwrap();
        AppState::new(
            PgPool::connect_lazy("postgres://unused/unused").unwrap(),
            config,
        )
    }

    // -- Path safety ------------------------------------------------------
    // These two functions are the entire boundary between a user-supplied
    // string and a filesystem write, so they get tested harder than anything
    // else here.

    #[tokio::test]
    async fn artifact_path_accepts_nested_names_and_stays_inside_the_dir() {
        let state = fs_only_state();
        let root = state.config.artifacts_dir();
        for name in [
            "scene-3041.html",
            "scene-3041.html.gz",
            "jobs/9f8b2c1e-0000-4000-8000-000000000000/scene.html",
        ] {
            let path = artifact_path(&state, name).expect("should accept {name}");
            assert!(path.starts_with(&root), "{name} escaped the artifacts dir");
        }
    }

    #[tokio::test]
    async fn artifact_path_rejects_traversal_and_absolute_paths() {
        let state = fs_only_state();
        for name in [
            "../secret",
            "..",
            "a/../../b",
            "/etc/passwd",
            "a//b",       // empty segment
            ".hidden",    // dotfile
            "a/.ssh/key", // dotfile in a nested position
            "a\\b",       // backslash, a separator on some platforms
            "a\0b",       // NUL
            "sc ene.html",
        ] {
            assert!(
                artifact_path(&state, name).is_err(),
                "artifact_path wrongly accepted {name:?}"
            );
        }
    }

    #[tokio::test]
    async fn upload_path_accepts_only_uuids() {
        let state = fs_only_state();
        let id = Uuid::new_v4().to_string();
        assert!(upload_path(&state, &id).is_ok());
        for key in ["../escape", "not-a-uuid", "", "..", &format!("{id}/../x")] {
            assert!(
                upload_path(&state, key).is_err(),
                "upload_path wrongly accepted {key:?}"
            );
        }
    }

    // -- Upload round trip -------------------------------------------------

    #[tokio::test]
    async fn upload_stores_bytes_and_serves_them_back() {
        let state = fs_only_state();
        let key = Uuid::new_v4().to_string();
        let payload = b"PK\x03\x04 pretend this is a photo zip".to_vec();

        let status = store_upload(
            State(state.clone()),
            Path(key.clone()),
            Body::from(payload.clone()),
        )
        .await
        .expect("store should succeed");
        assert_eq!(status, StatusCode::OK);

        let stored = std::fs::read(state.config.uploads_dir().join(format!("{key}.zip"))).unwrap();
        assert_eq!(stored, payload, "stored bytes differ from what was sent");

        let res = get_upload(State(state.clone()), Path(key)).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(res.headers()[header::CONTENT_TYPE], "application/zip");
        // Content-Length must match, or the worker's download silently truncates.
        assert_eq!(
            res.headers()[header::CONTENT_LENGTH],
            payload.len().to_string()
        );
    }

    #[tokio::test]
    async fn get_upload_404s_for_a_key_that_was_never_stored() {
        let state = fs_only_state();
        let err = get_upload(State(state), Path(Uuid::new_v4().to_string()))
            .await
            .expect_err("should not find it");
        assert_eq!(err.0, StatusCode::NOT_FOUND);
    }

    // -- Artifact ingest guard --------------------------------------------

    #[tokio::test]
    async fn put_artifact_404s_when_no_admin_token_is_configured() {
        // Not 401: an unconfigured deploy should look like it has no such
        // endpoint, rather than one waiting to be guessed at.
        let state = fs_only_state();
        let err = put_artifact(
            State(state),
            Path("scene.html".to_string()),
            HeaderMap::new(),
            Body::from("x"),
        )
        .await
        .expect_err("route should be disabled");
        assert_eq!(err.0, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn put_artifact_requires_the_right_bearer_token() {
        let mut config = test_config();
        config.admin_token = "s3cret".to_string();
        std::fs::create_dir_all(config.artifacts_dir()).unwrap();
        let state = AppState::new(
            PgPool::connect_lazy("postgres://unused/unused").unwrap(),
            config,
        );

        let mut wrong = HeaderMap::new();
        wrong.insert(header::AUTHORIZATION, "Bearer nope".parse().unwrap());
        let err = put_artifact(
            State(state.clone()),
            Path("scene.html".to_string()),
            wrong,
            Body::from("x"),
        )
        .await
        .expect_err("wrong token must be rejected");
        assert_eq!(err.0, StatusCode::UNAUTHORIZED);

        let mut right = HeaderMap::new();
        right.insert(header::AUTHORIZATION, "Bearer s3cret".parse().unwrap());
        let status = put_artifact(
            State(state.clone()),
            Path("jobs/abc/scene.html".to_string()),
            right,
            Body::from("<html>scene</html>"),
        )
        .await
        .expect("right token must be accepted");
        assert_eq!(status, StatusCode::OK);
        // Nested names must create their parent directories, not fail.
        let written =
            std::fs::read(state.config.artifacts_dir().join("jobs/abc/scene.html")).unwrap();
        assert_eq!(written, b"<html>scene</html>");
    }

    #[tokio::test]
    async fn put_artifact_removes_a_stale_gz_sibling() {
        // ServeDir::precompressed_gzip prefers <name>.gz for every gzip-capable
        // client, so a leftover .gz would serve OLD content to every browser
        // while a plain curl showed the new content.
        let mut config = test_config();
        config.admin_token = "t".to_string();
        std::fs::create_dir_all(config.artifacts_dir()).unwrap();
        let gz = config.artifacts_dir().join("scene.html.gz");
        std::fs::write(&gz, b"stale compressed content").unwrap();
        let state = AppState::new(
            PgPool::connect_lazy("postgres://unused/unused").unwrap(),
            config,
        );

        let mut auth = HeaderMap::new();
        auth.insert(header::AUTHORIZATION, "Bearer t".parse().unwrap());
        put_artifact(
            State(state.clone()),
            Path("scene.html".to_string()),
            auth,
            Body::from("fresh content"),
        )
        .await
        .unwrap();

        assert!(
            !gz.exists(),
            "stale .gz survived; browsers would keep getting the old scene"
        );
        let plain = std::fs::read(state.config.artifacts_dir().join("scene.html")).unwrap();
        assert_eq!(plain, b"fresh content");
    }

    #[tokio::test]
    async fn put_artifact_keeps_the_plain_file_when_uploading_a_gz() {
        // The reverse case must NOT delete anything — seeding uploads the plain
        // file first, then its .gz, and that second PUT must leave the pair intact.
        let mut config = test_config();
        config.admin_token = "t".to_string();
        std::fs::create_dir_all(config.artifacts_dir()).unwrap();
        let plain = config.artifacts_dir().join("scene.html");
        std::fs::write(&plain, b"plain").unwrap();
        let state = AppState::new(
            PgPool::connect_lazy("postgres://unused/unused").unwrap(),
            config,
        );

        let mut auth = HeaderMap::new();
        auth.insert(header::AUTHORIZATION, "Bearer t".parse().unwrap());
        put_artifact(
            State(state.clone()),
            Path("scene.html.gz".to_string()),
            auth,
            Body::from("gzipped"),
        )
        .await
        .unwrap();

        assert!(
            plain.exists(),
            "uploading the .gz wrongly deleted the plain file"
        );
        assert!(state.config.artifacts_dir().join("scene.html.gz").exists());
    }

    #[test]
    fn disk_error_distinguishes_full_volume_from_a_generic_failure() {
        use std::io::{Error, ErrorKind};
        assert_eq!(
            disk_error(Error::new(ErrorKind::StorageFull, "no space")).0,
            StatusCode::INSUFFICIENT_STORAGE
        );
        assert_eq!(
            disk_error(Error::other("length limit exceeded")).0,
            StatusCode::PAYLOAD_TOO_LARGE
        );
        assert_eq!(
            disk_error(Error::other("something else")).0,
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[tokio::test]
    async fn relabel_repoints_only_legacy_placeholder_rows() {
        use crate::state::LEGACY_PLACEHOLDER_ARTIFACTS;
        let state = test_state().await;
        let new_artifacts = r#"{"scene_url":"https://x/artifacts/s.html","is_sample":true}"#;
        let real = r#"{"scene_url":"https://worker/jobs/1/scene.html"}"#;

        // Three rows: a legacy done job, a real done job, and an unfinished one.
        let legacy = db::insert_job(&state.db, "uploads/a.zip", 7000)
            .await
            .unwrap();
        db::set_done(&state.db, &legacy.id, LEGACY_PLACEHOLDER_ARTIFACTS)
            .await
            .unwrap();
        let genuine = db::insert_job(&state.db, "uploads/b.zip", 7000)
            .await
            .unwrap();
        db::set_done(&state.db, &genuine.id, real).await.unwrap();
        let pending = db::insert_job(&state.db, "uploads/c.zip", 7000)
            .await
            .unwrap();

        let n = db::relabel_legacy_demo_jobs(&state.db, new_artifacts)
            .await
            .unwrap();
        assert_eq!(n, 1, "should touch exactly the legacy placeholder row");

        let after = db::get_job(&state.db, &legacy.id).await.unwrap().unwrap();
        assert_eq!(after.artifacts_json.as_deref(), Some(new_artifacts));
        // A genuine per-job scene must never be overwritten.
        let untouched = db::get_job(&state.db, &genuine.id).await.unwrap().unwrap();
        assert_eq!(untouched.artifacts_json.as_deref(), Some(real));
        // And an unfinished job keeps its NULL artifacts.
        let still_pending = db::get_job(&state.db, &pending.id).await.unwrap().unwrap();
        assert_eq!(still_pending.artifacts_json, None);

        // Idempotent: running it again is a no-op.
        let again = db::relabel_legacy_demo_jobs(&state.db, new_artifacts)
            .await
            .unwrap();
        assert_eq!(again, 0, "second run must be a no-op");
    }

    // -- Storage accounting -----------------------------------------------

    #[tokio::test]
    async fn storage_sums_both_dirs_including_nested_artifacts() {
        let state = fs_only_state();
        // An upload, a top-level artifact, and a nested one.
        std::fs::write(state.config.uploads_dir().join("a.zip"), vec![0u8; 100]).unwrap();
        std::fs::write(state.config.artifacts_dir().join("s.html"), vec![0u8; 30]).unwrap();
        let nested = state.config.artifacts_dir().join("jobs/xyz");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("scene.html"), vec![0u8; 7]).unwrap();

        let Json(body) = storage(State(state)).await.unwrap();
        assert_eq!(body["uploads_bytes"], 100);
        assert_eq!(body["artifacts_bytes"], 37); // 30 + 7, recursion works
        assert_eq!(body["used_bytes"], 137);
        assert_eq!(body["file_count"], 3);
        assert_eq!(body["limit_bytes"], 5u64 * 1024 * 1024 * 1024);
    }

    #[tokio::test]
    async fn storage_ignores_probe_dotfiles() {
        let state = fs_only_state();
        // The write-probes the health/startup checks leave behind must not
        // count as stored data.
        std::fs::write(state.config.data_dir.join(".write-probe"), b"ok").unwrap();
        std::fs::write(state.config.artifacts_dir().join(".health-probe"), b"ok").unwrap();
        std::fs::write(state.config.uploads_dir().join("real.zip"), vec![0u8; 50]).unwrap();

        let Json(body) = storage(State(state)).await.unwrap();
        assert_eq!(body["file_count"], 1, "only the real upload should count");
        assert_eq!(body["used_bytes"], 50);
    }

    #[tokio::test]
    async fn storage_reports_zero_on_empty_dirs() {
        let state = fs_only_state();
        let Json(body) = storage(State(state)).await.unwrap();
        assert_eq!(body["used_bytes"], 0);
        assert_eq!(body["file_count"], 0);
    }

    #[test]
    fn dir_usage_of_a_missing_dir_is_zero_not_an_error() {
        let usage = dir_usage(std::path::Path::new("/no/such/weddingai/dir"));
        assert_eq!(usage.bytes, 0);
        assert_eq!(usage.files, 0);
    }

    #[test]
    fn constant_time_eq_matches_normal_equality() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"ab"));
        assert!(!constant_time_eq(b"", b"a"));
        assert!(constant_time_eq(b"", b""));
    }

    #[tokio::test]
    async fn health_reports_ok_with_reachable_db() {
        let (status, Json(body)) = health(State(test_state().await)).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["status"], "ok");
        assert_eq!(body["db"], "ok");
        assert_eq!(body["mock_mode"], true);
        assert_eq!(body["public_base_url"], "http://localhost:8080");
        assert_eq!(body["data_dir_writable"], true);
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
