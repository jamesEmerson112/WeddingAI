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
// createUpload returns an absolute URL pointing at the backend's own
// PUT /api/uploads/{key} sink, which stores the zip on its volume. The relative
// branch is kept as a cheap safety net in case that ever changes shape.
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

// How full the storage volume is. `used_bytes` is the sum of stored uploads +
// artifacts; `limit_bytes` is the configured budget the UI fills toward (a soft
// denominator, not the filesystem's real cap). Mirrors backend/src/routes.rs's
// storage() handler.
export type Storage = {
  used_bytes: number;
  limit_bytes: number;
  uploads_bytes: number;
  artifacts_bytes: number;
  file_count: number;
};

// GET /api/storage -> Storage
export async function getStorage(): Promise<Storage> {
  const res = await fetch(`${API}/api/storage`, { cache: "no-store" });
  await ensureOk(res);
  return res.json();
}

// The exact URL of the inert stand-in scene, a small committed file at
// public/demo/scene.html. This is the ONE value that means "no real scene" —
// compared with strict equality, never a prefix/startsWith check, because real
// scenes could plausibly live under /demo/ too.
const PLACEHOLDER_SCENE_URL = "/demo/scene.html";

// Everything the frontend knows about a job's artifacts, parsed once.
//
// The backend stamps artifacts_json on completion and is the sole authority on
// what a job's scene URL is: it always writes ABSOLUTE URLs for scenes it
// serves itself (off the Railway volume, /artifacts/...), and the only relative
// value it ever writes is PLACEHOLDER_SCENE_URL, which resolves against the
// frontend's own static files. So there is deliberately NO base-URL resolution
// and NO client-side substitution here — the URL is used exactly as given.
type SceneArtifacts = { scene_url?: string; is_sample?: boolean };

function parseArtifacts(job: Job | null): SceneArtifacts | null {
  if (!job?.artifacts_json) return null;
  try {
    return JSON.parse(job.artifacts_json) as SceneArtifacts;
  } catch {
    return null;
  }
}

// Pull the viewable scene URL out of a finished job.
// Returns null if there are no artifacts yet or the JSON is missing/malformed
// (so the viewer can show a "not ready" fallback).
export function sceneUrl(job: Job): string | null {
  return parseArtifacts(job)?.scene_url ?? null;
}

// The three kinds of scene a job can resolve to, and the one place that tells
// them apart — so components branch on this instead of comparing URL string
// literals themselves. Takes the Job rather than a URL because the
// example/real distinction is carried by the artifacts JSON's `is_sample`
// flag, not by anything visible in the URL.
//
//  - "placeholder": the inert stand-in at PLACEHOLDER_SCENE_URL. There is no
//    reconstruction behind it at all, so it gets the honest "stand-in"
//    caption and no orbit hints.
//  - "example": a genuine reconstruction, but ONE FIXED SCENE reused for
//    EVERY mock job — it was not built from whatever this viewer uploaded.
//    The orbit controls are really real, which is exactly why this is
//    load-bearing: without a label it looks like the viewer's own result.
//    Callers MUST surface a plain "sample, not your upload" disclosure.
//  - "real": a genuine per-job scene from an actual GPU worker run. This one
//    really was built from the viewer's own photos, so it gets orbit hints
//    and no sample label.
//
// Returns null when there is no scene yet (no job, no artifacts, malformed
// JSON, or no scene_url), so callers keep handling "not ready" themselves
// rather than folding it into this type.
export type SceneKind = "placeholder" | "example" | "real";

export function sceneKind(job: Job | null): SceneKind | null {
  const artifacts = parseArtifacts(job);
  if (!artifacts?.scene_url) return null;
  if (artifacts.scene_url === PLACEHOLDER_SCENE_URL) return "placeholder";
  if (artifacts.is_sample === true) return "example";
  return "real";
}
