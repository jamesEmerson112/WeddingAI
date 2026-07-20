"""RunPod serverless handler — GPU worker for splat-service.

STATUS: Phase 1 STUB. This file describes the shape of the worker and lists,
as numbered TODO(Phase 1) comments, every step the real handler must perform.
It does not run the pipeline yet. See ROADMAP.md "Phase 1" for the full plan
and docs/phase0-runbook.md for the manual commands this automates.

------------------------------------------------------------------------------
The pipeline in one line:
    photos.zip  ->  COLMAP (SfM)  ->  LichtFeld Studio (train)  ->  scene.html/.sog
------------------------------------------------------------------------------

Input event (RunPod passes this as `event["input"]`):
    {
        "job_id":     str,  # our backend's job UUID; also the R2 output prefix
        "upload_key": str,  # R2 object key of the uploaded photos zip, e.g. "uploads/<uuid>.zip"
        "iters":      int   # training iterations (capped by the backend, e.g. 7000-30000)
    }

Output (returned to RunPod, surfaced to the backend via /status):
    {
        "scene_url": str    # public R2 URL of the self-contained scene.html
    }
    (Phase 1 will likely also return sog_url, metrics, timings, and num_gaussians;
     the backend only requires scene_url to mark a job "done".)

Progress: each stage calls runpod.serverless.progress_update(event, "<stage>")
so the backend's poller can map RunPod status -> our state machine
(uploaded -> queued -> sfm -> training -> exporting -> done) without an inbound
webhook.
"""

# The RunPod SDK is only present inside the worker container (see Dockerfile:
# `pip install runpod boto3`). It is intentionally imported here so the shape of
# the real handler is clear, even though the body below is still a stub.
import runpod


def handler(event):
    """Process one job. `event["input"]` matches the Input schema in the docstring."""
    job_input = event["input"]
    job_id = job_input["job_id"]
    upload_key = job_input["upload_key"]
    iters = job_input.get("iters", 30000)

    # TODO(Phase 1) 1. DOWNLOAD: pull the photos zip from R2.
    #   - boto3 S3 client pointed at the R2 endpoint (env: R2_ENDPOINT,
    #     R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET).
    #   - client.download_file(R2_BUCKET, upload_key, "/work/photos.zip").
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

    # TODO(Phase 1) 6. UPLOAD: push artifacts to R2 under jobs/{job_id}/.
    #   - client.upload_file("out/scene.html", R2_BUCKET, f"jobs/{job_id}/scene.html")
    #   - also scene.sog and metrics.csv.
    #   - scene_url = f"{R2_PUBLIC_BASE}/jobs/{job_id}/scene.html".

    # TODO(Phase 1) 7. RETURN: hand the artifact URL(s) back to RunPod.
    #   - progress_update(event, "done")
    #   - return {"scene_url": scene_url}  # plus sog_url/metrics/timings later.

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
