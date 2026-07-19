// Typed fetch helpers for the splat-service backend.
//
// Everything the frontend knows about the backend lives here: the base URL,
// the shape of a Job, the ordered list of job states, and one small function
// per HTTP endpoint. Pages/components import from this file instead of calling
// fetch() directly, so the API surface stays in one place.

// Base URL of the backend. In dev it defaults to the local Axum server; in a
// deployed setting set NEXT_PUBLIC_API_URL (see .env.example). The NEXT_PUBLIC_
// prefix is what makes the value available in the browser.
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

// A single job row, exactly as the backend returns it.
// Mirrors the Job struct in backend/src/db.rs — keep the two in sync.
export type Job = {
  id: string;
  state: string;
  created_at: string;
  upload_key: string;
  iters: number;
  runpod_id: string | null;
  artifacts_json: string | null;
  error_msg: string | null;
};

// The job state machine, in order. Mirrors the STATES array in backend/src/db.rs.
// A job walks through these one at a time. `failed` is a separate terminal state
// reachable from any step, so it is intentionally NOT part of this ordered list.
export const JOB_STATES = [
  "uploaded",
  "queued",
  "sfm",
  "training",
  "exporting",
  "done",
] as const;

// Shape returned by POST /api/uploads: where to PUT the zip, and the key that
// identifies it when we later create a job.
export type Upload = { upload_key: string; upload_url: string };

// Small helper: turn a non-2xx response into a thrown Error carrying the
// backend's response body, so callers can surface a useful message.
async function ensureOk(res: Response): Promise<Response> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed (${res.status})`);
  }
  return res;
}

// POST /api/uploads -> { upload_key, upload_url }
// Asks the backend for a place to upload the zip.
export async function createUpload(): Promise<Upload> {
  const res = await fetch(`${API}/api/uploads`, { method: "POST" });
  await ensureOk(res);
  return res.json();
}

// PUT {upload_url} with the zip blob as the body.
// The upload_url may be absolute (a real R2 presigned URL) or a relative path
// (the local mock-upload sink). Relative paths are resolved against the API base.
export async function putZip(url: string, blob: Blob): Promise<void> {
  const target = url.startsWith("http") ? url : `${API}${url}`;
  const res = await fetch(target, { method: "PUT", body: blob });
  await ensureOk(res);
}

// POST /api/jobs { upload_key, iters? } -> Job
// Creates a job for a previously uploaded zip. `iters` is optional; when it is
// undefined JSON.stringify drops the key and the backend uses its own default.
export async function createJob(uploadKey: string, iters?: number): Promise<Job> {
  const res = await fetch(`${API}/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ upload_key: uploadKey, iters }),
  });
  await ensureOk(res);
  return res.json();
}

// GET /api/jobs/{id} -> Job
// `no-store` keeps polling honest — we always want the freshest state.
export async function getJob(id: string): Promise<Job> {
  const res = await fetch(`${API}/api/jobs/${id}`, { cache: "no-store" });
  await ensureOk(res);
  return res.json();
}

// GET /api/jobs -> Job[]
export async function listJobs(): Promise<Job[]> {
  const res = await fetch(`${API}/api/jobs`, { cache: "no-store" });
  await ensureOk(res);
  return res.json();
}

// Pull the viewable scene URL out of a finished job.
// artifacts_json is a JSON string the backend stamps on completion, e.g.
// {"scene_url": "/demo/scene.html"}. Returns null if there are no artifacts yet
// or the JSON is missing/malformed (so the viewer can show a fallback).
export function sceneUrl(job: Job): string | null {
  if (!job.artifacts_json) return null;
  try {
    const artifacts = JSON.parse(job.artifacts_json) as { scene_url?: string };
    return artifacts.scene_url ?? null;
  } catch {
    return null;
  }
}
