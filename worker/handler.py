"""RunPod serverless handler — GPU worker for splat-service.

STATUS: Phase 1 STUB. This file describes the shape of the worker and lists,
as numbered TODO(Phase 1) comments, every step the real handler must perform.
It does not run the pipeline yet. See ROADMAP.md "Phase 1" for the full plan
and docs/phase0-runbook.md for the manual commands this automates.

------------------------------------------------------------------------------
The pipeline in one line:
    photos.zip  ->  COLMAP (SfM)  ->  LichtFeld Studio (train)  ->  scene.html/.sog
------------------------------------------------------------------------------

File transfer is BROKERED BY THE BACKEND, not R2 directly. Both sides talk
HTTP to the backend's own endpoints (PUBLIC_BASE_URL):
    GET  {PUBLIC_BASE_URL}/api/uploads/{uuid}       -> streams the photos zip
    PUT  {PUBLIC_BASE_URL}/api/artifacts/{name}     -> uploads a finished artifact
                                                        (Authorization: Bearer ADMIN_TOKEN)
    GET  {PUBLIC_BASE_URL}/artifacts/{name}         -> public read-back URL

Input event (RunPod passes this as `event["input"]`):
    {
        "job_id":     str,  # our backend's job UUID; also the artifact name prefix
        "upload_key": str,  # backend upload key of the photos zip, e.g. "uploads/<uuid>.zip"
                             # (the worker must parse the bare uuid out of this to
                             # call GET /api/uploads/{uuid} — see TODO 1 below)
        "iters":      int   # training iterations (capped by the backend, e.g. 7000-30000)
    }

Output (returned to RunPod, surfaced to the backend via /status):
    {
        "artifacts": {
            "scene_url": str   # public URL of the self-contained scene.html,
                                # e.g. "https://.../artifacts/jobs/<job_id>/scene.html"
        }
    }
    (Phase 1 will likely also add sog_url, metrics, timings, and num_gaussians
     under "artifacts"; the backend only requires scene_url to mark a job "done".)

    *** CONTRACT NOTE: this "artifacts" nesting must stay in lockstep with
    backend/src/worker_client.rs, which parses COMPLETED jobs as
    `json["output"]["artifacts"]` and stores that sub-object verbatim as
    `artifacts_json`. If this file's return shape and worker_client.rs's parse
    path ever disagree again, a real (non-mock) job silently stores nothing —
    change both halves of this contract together. ***

Progress: each stage calls runpod.serverless.progress_update(event, "<stage>")
so the backend's poller can map RunPod status -> our state machine
(uploaded -> queued -> sfm -> training -> exporting -> done) without an inbound
webhook. worker_client.rs reads these back as `output.stage` while the RunPod
status is IN_PROGRESS.
"""

# The RunPod SDK is only present inside the worker container (see Dockerfile:
# `pip install runpod requests`). It is intentionally imported here so the shape
# of the real handler is clear, even though the body below is still a stub.
# (No boto3/S3 client needed any more — the backend brokers file transfer over
# plain HTTP; see the module docstring.)
import runpod


def handler(event):
    """Process one job. `event["input"]` matches the Input schema in the docstring."""
    job_input = event["input"]
    job_id = job_input["job_id"]
    upload_key = job_input["upload_key"]
    iters = job_input.get("iters", 30000)

    # TODO(Phase 1) 1. DOWNLOAD: pull the photos zip from the backend (not R2 —
    #   the backend brokers all file transfer; see module docstring).
    #   - upload_key looks like "uploads/<uuid>.zip"; parse out the bare uuid
    #     (e.g. upload_key.removeprefix("uploads/").removesuffix(".zip")) since
    #     the backend route is GET /api/uploads/{uuid}, not the raw key.
    #   - requests.get(f"{PUBLIC_BASE_URL}/api/uploads/{uuid}", stream=True),
    #     write the response body to "/work/photos.zip" in chunks.
    #   - env: PUBLIC_BASE_URL (no auth needed for this GET — it's a public
    #     read of an upload the browser itself PUT to the backend).
    #   - progress_update(event, "queued").

    # TODO(Phase 1) 2. UNZIP: extract photos into a COLMAP-shaped project dir.
    #   - unzip /work/photos.zip -> /work/project/images/
    #   - Guardrails: reject if too few images / zip too large (cost control).

    # TODO(Phase 1) 2b. VIDEO -> FRAMES: if the upload is a video rather than a
    #   zip of stills, extract frames before COLMAP sees it. Shooting 40-150
    #   photos by hand is impractical; a 45-90s slow orbit is the same coverage.
    #   - ffmpeg -i input.mp4 -vf "fps={N},scale=1920:-2" -q:v 2 \
    #         images/frame_%04d.jpg
    #   - Pick N so the frame count lands in 40-150 (N = target / duration), the
    #     same band scripts/video-to-frames.sh and frontend/lib/frames.ts use.
    #     Keep all three in agreement — they are three implementations of one
    #     decision.
    #   - Fixed rate on purpose: COLMAP wants EVENLY SPACED overlap. Scene
    #     detection optimises for visual change, thinning out exactly the slow,
    #     dense passes that reconstruct best.
    #   - Motion blur is the top failure mode for video-derived splats. If COLMAP
    #     registers only a fraction of the frames, suspect blur before geometry.
    #   - NOTE: the deployed frontend ALREADY extracts frames in-browser
    #     (frontend/lib/frames.ts), so uploads arriving from the web app are
    #     always a zip of stills. This step is for direct/API video uploads and
    #     for videos the browser cannot decode (HEVC outside Safari).

    # TODO(Phase 1) 3. COLMAP SfM: recover camera poses + sparse point cloud.
    #   - progress_update(event, "sfm")
    #   - colmap feature_extractor --database_path db.db --image_path images
    #   - colmap exhaustive_matcher --database_path db.db
    #       (use sequential_matcher for ordered walkthrough footage)
    #   - colmap mapper --database_path db.db --image_path images --output_path sparse
    #   - If sparse/0 is missing/near-empty -> raise a clear "reconstruction failed:
    #     photos need more overlap" error so the backend can show it to the user.

    # TODO(Phase 1) 4. TRAIN: run LichtFeld Studio headless on the COLMAP project.
    #   - progress_update(event, "training")
    #   - /dist/bin/run_lichtfeld.sh -d /work/project -o /work/out \
    #         --headless --eval --test-every 8 -i {iters}
    #   - Produces /work/out/splat_<iters>.ply (+ metrics.csv from --eval).

    # TODO(Phase 1) 5. EXPORT: convert the trained PLY to web-viewable formats.
    #   - progress_update(event, "exporting")
    #   - run_lichtfeld.sh convert out/splat_<iters>.ply out/scene.html -f html
    #       (self-contained PlayCanvas viewer, scene embedded as base64 SOG)
    #   - run_lichtfeld.sh convert out/splat_<iters>.ply out/scene.sog  -f sog
    #       (raw SOG, for a future custom viewer / smaller transfers)

    # TODO(Phase 1) 6. UPLOAD: push artifacts to the backend under jobs/{job_id}/
    #   (not R2 — the backend brokers all file transfer; see module docstring).
    #   - PUT {PUBLIC_BASE_URL}/api/artifacts/jobs/{job_id}/scene.html with the
    #     file body, header "Authorization: Bearer {ADMIN_TOKEN}".
    #   - also scene.sog and metrics.csv the same way, once those are wired up.
    #   - scene_url = f"{PUBLIC_BASE_URL}/artifacts/jobs/{job_id}/scene.html"
    #     (the PUBLIC read-back route — no bearer token needed for the GET).
    #   - env: PUBLIC_BASE_URL, ADMIN_TOKEN.

    # TODO(Phase 1) 7. RETURN: hand the artifact URL(s) back to RunPod.
    #   - progress_update(event, "done")
    #   - return {"artifacts": {"scene_url": scene_url}}  # plus sog_url/metrics/
    #     timings alongside scene_url under "artifacts" later.
    #   - CONTRACT NOTE: this "artifacts" nesting is read verbatim by
    #     backend/src/worker_client.rs's `json["output"]["artifacts"]` parse on
    #     COMPLETED — keep the two in lockstep (see module docstring).

    raise NotImplementedError(
        f"worker stub: pipeline not implemented for job {job_id} "
        f"(upload_key={upload_key}, iters={iters}) — see ROADMAP.md Phase 1"
    )


# TODO(Phase 1): start the RunPod serverless worker. Uncommented, this hands
# control to the SDK, which long-polls RunPod for jobs and calls handler() for
# each one. Commented out for now so the container's CMD (python -u handler.py)
# just runs the stub message below instead of trying to serve.
# runpod.serverless.start({"handler": handler})


if __name__ == "__main__":
    print("stub — see ROADMAP.md Phase 1")
