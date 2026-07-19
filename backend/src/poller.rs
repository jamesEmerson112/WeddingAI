//! The background poller: the heartbeat that moves jobs forward over time.

use std::time::Duration;

use crate::db;
use crate::state::AppState;
use crate::worker_client::WorkerClient;

/// Runs for the entire life of the process, ticking once every 5 seconds.
///
/// IMPORTANT: this loop must NEVER exit. A dead poller would silently freeze
/// every in-flight job, so if a single tick fails (a DB hiccup, a network blip)
/// we log a warning and keep looping. Errors are deliberately swallowed here.
pub async fn run(state: AppState) {
    tracing::info!("poller started (ticking every 5s)");
    loop {
        // Sleep first so we don't hammer the DB the instant the process boots.
        tokio::time::sleep(Duration::from_secs(5)).await;

        if let Err(e) = tick(&state).await {
            tracing::warn!("poller tick failed (ignored, will retry next tick): {e}");
        }
    }
}

/// A single pass over all active jobs. Returns `Err` so `run` can log-and-continue.
async fn tick(state: &AppState) -> sqlx::Result<()> {
    let jobs = db::list_active_jobs(&state.db).await?;
    for job in jobs {
        // The worker enum decides how a job advances. Mock walks the state machine
        // on a timer; Runpod asks RunPod for the real status.
        match &*state.worker {
            WorkerClient::Mock => advance_mock(state, &job).await?,
            WorkerClient::Runpod { .. } => advance_runpod(state, &job).await?,
        }
    }
    Ok(())
}

/// Mock mode: move this job exactly one step along the state machine per tick.
async fn advance_mock(state: &AppState, job: &db::Job) -> sqlx::Result<()> {
    // What's the next state? `None` means we're already at a terminal state
    // (done/failed) — nothing to do.
    let Some(next) = db::next_state(&job.state) else {
        return Ok(());
    };

    if next == "done" {
        // Reaching 'done' stamps the placeholder scene so the viewer has something
        // to show. In real mode this URL would come from the worker's artifacts.
        db::set_done(&state.db, &job.id, r#"{"scene_url":"/demo/scene.html"}"#).await?;
    } else {
        db::set_state(&state.db, &job.id, next).await?;
    }
    tracing::info!("mock: job {} -> {}", job.id, next);
    Ok(())
}

/// Real mode: ask RunPod how this job is doing and mirror that into our DB.
async fn advance_runpod(state: &AppState, job: &db::Job) -> sqlx::Result<()> {
    // We can only poll jobs we actually submitted — those have a runpod_id.
    let Some(runpod_id) = &job.runpod_id else {
        return Ok(());
    };

    // Ask RunPod for the current status. A network/parse error here is NOT fatal:
    // log it and skip this job; we'll try again on the next tick.
    let update = match state.worker.check_status(runpod_id).await {
        Ok(u) => u,
        Err(e) => {
            tracing::warn!("runpod status check failed for job {}: {e}", job.id);
            return Ok(());
        }
    };

    match update.state.as_str() {
        "done" => {
            // Store the artifacts we got, or an empty object if there were none.
            let artifacts = update.artifacts_json.as_deref().unwrap_or("{}");
            db::set_done(&state.db, &job.id, artifacts).await?;
            tracing::info!("runpod: job {} -> done", job.id);
        }
        "failed" => {
            let error = update.error.as_deref().unwrap_or("runpod job failed");
            db::set_failed(&state.db, &job.id, error).await?;
            tracing::info!("runpod: job {} -> failed", job.id);
        }
        // Any in-progress state: only write (and log) if it actually changed, to
        // avoid pointless DB writes and log spam on every 5s tick.
        new_state => {
            if new_state != job.state {
                db::set_state(&state.db, &job.id, new_state).await?;
                tracing::info!("runpod: job {} -> {}", job.id, new_state);
            }
        }
    }
    Ok(())
}
