use serde::Serialize;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

/// The job lifecycle, in order. `failed` is reachable from any state.
pub const STATES: [&str; 6] = ["uploaded", "queued", "sfm", "training", "exporting", "done"];

/// The state machine: given the current state, what comes next?
/// Returns None for `done`, `failed`, or anything unknown.
pub fn next_state(current: &str) -> Option<&'static str> {
    let idx = STATES.iter().position(|s| *s == current)?;
    STATES.get(idx + 1).copied()
}

#[derive(Debug, Serialize, FromRow)]
pub struct Job {
    pub id: String,
    pub state: String,
    pub created_at: String,
    pub upload_key: String,
    pub iters: i64,
    pub runpod_id: Option<String>,
    pub artifacts_json: Option<String>,
    pub error_msg: Option<String>,
}

pub async fn insert_job(pool: &PgPool, upload_key: &str, iters: i64) -> sqlx::Result<Job> {
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO jobs (id, upload_key, iters) VALUES ($1, $2, $3)")
        .bind(&id)
        .bind(upload_key)
        .bind(iters)
        .execute(pool)
        .await?;
    // Read the row back so callers see the DB-generated fields (state, created_at).
    let job = get_job(pool, &id).await?;
    Ok(job.expect("row we just inserted exists"))
}

pub async fn get_job(pool: &PgPool, id: &str) -> sqlx::Result<Option<Job>> {
    sqlx::query_as::<_, Job>("SELECT * FROM jobs WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn list_jobs(pool: &PgPool) -> sqlx::Result<Vec<Job>> {
    sqlx::query_as::<_, Job>("SELECT * FROM jobs ORDER BY created_at DESC, id")
        .fetch_all(pool)
        .await
}

/// Jobs the poller still needs to move forward.
pub async fn list_active_jobs(pool: &PgPool) -> sqlx::Result<Vec<Job>> {
    sqlx::query_as::<_, Job>("SELECT * FROM jobs WHERE state NOT IN ('done', 'failed')")
        .fetch_all(pool)
        .await
}

pub async fn set_state(pool: &PgPool, id: &str, state: &str) -> sqlx::Result<()> {
    sqlx::query("UPDATE jobs SET state = $1 WHERE id = $2")
        .bind(state)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn set_runpod_id(pool: &PgPool, id: &str, runpod_id: &str) -> sqlx::Result<()> {
    sqlx::query("UPDATE jobs SET runpod_id = $1 WHERE id = $2")
        .bind(runpod_id)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn set_done(pool: &PgPool, id: &str, artifacts_json: &str) -> sqlx::Result<()> {
    sqlx::query("UPDATE jobs SET state = 'done', artifacts_json = $1 WHERE id = $2")
        .bind(artifacts_json)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn set_failed(pool: &PgPool, id: &str, error_msg: &str) -> sqlx::Result<()> {
    sqlx::query("UPDATE jobs SET state = 'failed', error_msg = $1 WHERE id = $2")
        .bind(error_msg)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn walks_the_full_lifecycle() {
        assert_eq!(next_state("uploaded"), Some("queued"));
        assert_eq!(next_state("queued"), Some("sfm"));
        assert_eq!(next_state("sfm"), Some("training"));
        assert_eq!(next_state("training"), Some("exporting"));
        assert_eq!(next_state("exporting"), Some("done"));
    }

    #[test]
    fn terminal_and_unknown_states_go_nowhere() {
        assert_eq!(next_state("done"), None);
        assert_eq!(next_state("failed"), None);
        assert_eq!(next_state("nonsense"), None);
    }
}
