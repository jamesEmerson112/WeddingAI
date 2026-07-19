//! The worker client: how the backend hands a job off to whatever actually does
//! the GPU work, and how it asks about that job's progress later.

use crate::db;

/// A worker is one of exactly two things, so we model it as an ENUM and `match`
/// on it — instead of a trait object like `Box<dyn Worker>`.
///
/// Why an enum, not a trait? For a Rust beginner an enum is far easier to read
/// and debug than an async trait (which needs the `async_trait` crate or verbose
/// `Pin<Box<dyn Future>>` signatures). There are only ever two implementations,
/// so an enum costs nothing and keeps the control flow obvious.
///
/// This enum is also THE SEAM that a later phase fills in: the `Mock` arm already
/// works end-to-end today; the `Runpod` arm has the real HTTP calls written but
/// only runs once real credentials are supplied. Swapping to a trait later, if it
/// were ever needed, is a mechanical refactor.
pub enum WorkerClient {
    /// Local demo mode: no network, no credentials. `submit` is a no-op and the
    /// poller's Mock arm walks jobs forward on a timer instead.
    Mock,
    /// Real mode: talk to a RunPod serverless endpoint over HTTP.
    Runpod {
        /// Reused HTTP client (connection pooling lives inside it).
        http: reqwest::Client,
        /// RunPod API key, sent as a bearer token.
        api_key: String,
        /// Which serverless endpoint to submit to.
        endpoint_id: String,
    },
}

/// What the poller learns when it asks the worker "how's this job doing?".
pub struct StatusUpdate {
    /// Our internal state name — one of `db::STATES`, or `"failed"`.
    pub state: String,
    /// JSON blob of output artifacts, present only when the job finished.
    pub artifacts_json: Option<String>,
    /// Human-readable error message, present only when the job failed.
    pub error: Option<String>,
}

impl WorkerClient {
    /// Hand a freshly-created job to the worker.
    ///
    /// Returns:
    /// - `Ok(Some(runpod_id))` — real job accepted; remember this id to poll it.
    /// - `Ok(None)`            — mock mode; nothing to remember, the poller drives it.
    /// - `Err(msg)`            — submission failed; the caller marks the job failed.
    pub async fn submit(&self, job: &db::Job) -> Result<Option<String>, String> {
        match self {
            WorkerClient::Mock => {
                // No real work — the poller's Mock arm advances this job on a timer.
                tracing::info!("mock worker: pretending to submit job {}", job.id);
                Ok(None)
            }
            WorkerClient::Runpod {
                http,
                api_key,
                endpoint_id,
            } => {
                // POST /v2/{endpoint_id}/run with a bearer token and a JSON body.
                let url = format!("https://api.runpod.ai/v2/{endpoint_id}/run");
                let body = serde_json::json!({
                    "input": {
                        "job_id": job.id,
                        "upload_key": job.upload_key,
                        "iters": job.iters,
                    }
                });
                let resp = http
                    .post(&url)
                    .bearer_auth(api_key)
                    .json(&body)
                    .send()
                    .await
                    .map_err(|e| format!("runpod submit request failed: {e}"))?;
                // RunPod replies with e.g. {"id": "abc123", "status": "IN_QUEUE"}.
                let json: serde_json::Value = resp
                    .json()
                    .await
                    .map_err(|e| format!("runpod submit: response was not JSON: {e}"))?;
                let id = json["id"]
                    .as_str()
                    .ok_or_else(|| format!("runpod submit: no job id in response: {json}"))?;
                Ok(Some(id.to_string()))
            }
        }
    }

    /// Ask the worker for the current status of a previously-submitted job.
    pub async fn check_status(&self, runpod_id: &str) -> Result<StatusUpdate, String> {
        match self {
            // In mock mode the poller uses `db::next_state` instead of calling this,
            // so this arm is never actually reached.
            WorkerClient::Mock => Err("check_status is not used in mock mode".to_string()),
            WorkerClient::Runpod {
                http,
                api_key,
                endpoint_id,
            } => {
                // GET /v2/{endpoint_id}/status/{id}.
                let url = format!("https://api.runpod.ai/v2/{endpoint_id}/status/{runpod_id}");
                let resp = http
                    .get(&url)
                    .bearer_auth(api_key)
                    .send()
                    .await
                    .map_err(|e| format!("runpod status request failed: {e}"))?;
                // RunPod wraps everything in {"status": "...", "output": {...}}.
                let json: serde_json::Value = resp
                    .json()
                    .await
                    .map_err(|e| format!("runpod status: response was not JSON: {e}"))?;

                // Translate RunPod's status into one of OUR state names.
                let status = json["status"].as_str().unwrap_or("IN_QUEUE");
                let update = match status {
                    "IN_QUEUE" => StatusUpdate {
                        state: "queued".to_string(),
                        artifacts_json: None,
                        error: None,
                    },
                    "IN_PROGRESS" => {
                        // Our worker reports which pipeline stage it's in via
                        // output.stage (e.g. "sfm", "training", "exporting").
                        let stage = json["output"]["stage"].as_str().unwrap_or("training");
                        StatusUpdate {
                            state: stage.to_string(),
                            artifacts_json: None,
                            error: None,
                        }
                    }
                    "COMPLETED" => {
                        // Re-serialize the artifacts sub-object into a JSON string so
                        // it can be stored verbatim in the jobs table. If the worker
                        // sent no artifacts, leave it None (the poller substitutes {}).
                        let artifacts = &json["output"]["artifacts"];
                        let artifacts_json = if artifacts.is_null() {
                            None
                        } else {
                            Some(artifacts.to_string())
                        };
                        StatusUpdate {
                            state: "done".to_string(),
                            artifacts_json,
                            error: None,
                        }
                    }
                    "FAILED" => {
                        let error = json["error"]
                            .as_str()
                            .unwrap_or("runpod job failed")
                            .to_string();
                        StatusUpdate {
                            state: "failed".to_string(),
                            artifacts_json: None,
                            error: Some(error),
                        }
                    }
                    // Anything unexpected: treat it as still queued rather than
                    // erroring out, so the poller simply checks again next tick.
                    _ => StatusUpdate {
                        state: "queued".to_string(),
                        artifacts_json: None,
                        error: None,
                    },
                };
                Ok(update)
            }
        }
    }
}
