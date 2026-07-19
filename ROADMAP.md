# Roadmap: Photos-to-3D Web Service ("splat-as-a-service")

## Context

James (strong Python/TS, beginner Rust, no CUDA-capable local GPU — the GTX 1070 Ti is below LichtFeld's SM 70 floor) is building a learning/portfolio web service: **users upload photos of one place → backend queues a job → cloud GPU worker runs COLMAP then LichtFeld Studio headless → the trained 3D Gaussian Splatting scene comes back viewable in any browser.** GPU work happens on rented cloud hardware; browser viewing of results works fine locally.

Guiding principle: push all hard/GPU/C++ work into the worker (Python + a prebuilt binary), keep the Rust backend thin (CRUD + RunPod proxy + one poll loop), keep the FE a comfort-zone Next.js app.

## Locked decisions

- **Scope:** learning/portfolio. Minimal auth, no payments, must scale to ~$0 when idle.
- **FE:** Next.js on Vercel. **BE:** Rust/Axum on Fly.io (explicit learning goal — kept small). **DB:** SQLite via sqlx.
- **GPU worker:** RunPod serverless (min-workers 0, pay per second). **Artifacts:** Cloudflare R2 (S3-compatible, zero egress fees — decisive since viewers repeatedly download multi-MB scenes).
- **Phase 0 is manual** — run the whole pipeline by hand before any web code.

## Verified repo facts the plan relies on (from source exploration)

- **Headless training:** `LichtFeld-Studio -d <dataset> -o <out> --headless [--eval] [-i N] [--config json]` → writes `<out>/splat_<iter>.ply` + `checkpoints/checkpoint.resume`; `--eval` adds `metrics.csv` (psnr/ssim/num_gaussians). Canonical template: `eval/benchmark_mipnerf360_mcmc.sh`.
- **Web export without GUI:** `LichtFeld-Studio convert splat_30000.ply out.html -f html` (also `-f sog|spz`). HTML = single self-contained file (PlayCanvas SuperSplat viewer, WebGPU→WebGL fallback, scene embedded as base64 SOG, ≈1.33×SOG + 50 KB). Backup path: standalone `lichtfeld.io` Python module (`save_sog`/`export_html` work in a plain Python process).
- **Dataset layout:** COLMAP `sparse/0/cameras.bin+images.bin` + `images/` (points3D optional → random init), or nerfstudio `transforms.json`. **COLMAP is not bundled** — worker runs it first.
- **Worker image portability:** default build targets the detected GPU only; use `-DBUILD_PORTABLE=ON` (PTX-only, JIT on any GPU ≥ SM 75/Turing, `cmake --install build --prefix ./dist`) for RunPod's mixed fleet.
- **Progress (stretch):** `--headless --tcp-connection` runs a ZMQ REP/PUB pair with training telemetry/events. MVP uses RunPod status polling instead.
- Repo `docker/` is a dev container (build env only) — recipe reference for our worker image, not usable as-is.

---

## Phase 0 — Manual pipeline on a rented GPU box (~$5–15, a few evenings)

**Goal:** prove the pipeline end-to-end by hand; produce one scene viewable in a local browser; record the numbers that size every later decision.

1. Rent a **RunPod GPU Pod** (RTX 4090 community ~$0.4–0.7/hr; 3090/A5000 cheaper fallbacks) on a CUDA 12.8 devel Ubuntu 24.04 template, with a network volume (persist build + data between sessions; kill the pod when idle).
2. Get CUDA COLMAP (`apt install colmap`, verify GPU SIFT works; else build from source — record which route worked).
3. Build LichtFeld portable: `cmake -B build -DBUILD_PORTABLE=ON && cmake --build build -j && cmake --install build --prefix ./dist` (first vcpkg build is very slow — time it).
4. Shoot/collect **~40–150 overlapping photos of one place** → `project/images/`.
5. COLMAP SfM: `feature_extractor` (GPU) → `exhaustive_matcher` (or `sequential_matcher` for walkthroughs) → `mapper` → `project/sparse/0/`.
6. Train: `./dist/bin/LichtFeld-Studio -d project -o out --headless --eval --test-every 8 -i 30000`.
7. Export: `convert out/splat_30000.ply out.html -f html` and `... out.sog -f sog`.
8. Download both to the local machine; confirm they render in a browser.

**Record (the real deliverable):** per-stage wall-clock (vcpkg build, COLMAP stages, train to 7k/30k), peak VRAM (`nvidia-smi -l 1`), GPU model, final num_gaussians + PSNR/SSIM, artifact sizes (ply/sog/html), COLMAP failure modes encountered.

**Done when:** `out.html` renders the scene locally + a one-page notes file of timings/sizes exists.

## Phase 1 — Worker automation: Docker image + RunPod serverless (~$20–40 to debug; then ~$0.30–1.00/job)

**Goal:** one reproducible container; input = photos-zip URL, output = artifact URLs.

- **Image (multi-stage):** builder = `nvidia/cuda:12.8-devel-ubuntu24.04` + gcc-14/vcpkg → build CUDA COLMAP + LichtFeld `BUILD_PORTABLE=ON` → `/dist`. Runtime = `nvidia/cuda:12.8-runtime-ubuntu24.04` + `/dist` + COLMAP + Python 3 + `runpod` SDK + `boto3` + `handler.py`. Build on a pod or CI (no local CUDA), push to GHCR.
- **`handler.py` flow:** download/unzip photos → guardrails (min photo count, zip size cap, iteration cap) → COLMAP (clear user-facing error if reconstruction fails) → headless train → `convert` to `.sog` + `.html` → upload artifacts + `metrics.csv` to R2 `jobs/<job_id>/` → report stages via `runpod.serverless.progress_update` (readable from RunPod's `/status` — no inbound webhook needed) → return `{status, artifacts, timings, num_gaussians}`.
- **Endpoint config:** min workers 0, max 1–2, FlashBoot on, GPU filter Turing+ only (T4/A4000/A5000/3090/4090/L4) to satisfy the SM 75 floor.

**Done when:** a cold-start invocation with a zip URL completes end-to-end and the returned `sog_url`/`html_url` render. Record cold-start time + GPU-seconds per job.

## Phase 2 — Rust/Axum backend, kept thin (~$0–5/mo on Fly.io)

**Goal:** minimal Axum service — where the Rust learning happens, sized so it can't sink the project.

- **State machine:** `uploaded → queued → sfm → training → exporting → done` (+ `failed` from any state). SQLite row: `id, state, created_at, runpod_id, artifacts_json, error_msg` (`backend/migrations/0001_jobs.sql`).
- **Endpoints:** `POST /api/uploads` (presigned R2 PUT URL — FE uploads zip directly), `POST /api/jobs` (create row, call RunPod `/run`, store `runpod_id`), `GET /api/jobs/:id` (state + artifacts), `GET /api/jobs` (gallery/list).
- **Progress:** one Tokio background task polls RunPod `/status/{runpod_id}` for active jobs, maps status + `stage` onto the state machine. FE polls `GET /api/jobs/:id`. (ZMQ live-telemetry feed = stretch, only after the happy path works.)
- Files: `backend/src/main.rs`, `routes.rs`, `runpod.rs`.

**Done when:** full flow via `curl` only: presign → PUT zip → create job → state walks `queued→sfm→training→exporting→done` → artifact URLs resolve.

## Phase 3 — Next.js frontend ($0, Vercel free tier)

- **Upload:** drag-and-drop multi-photo, client-side zip (JSZip), presigned PUT to R2 (backend never proxies bytes), inline guidance (40–150 JPGs, one place, good overlap), upload progress bar.
- **Status page:** poll job; stepper UI (`Queued → Structure-from-motion → Training → Exporting → Done`); surface `failed` with the worker's actionable message.
- **Viewer (MVP):** the self-contained HTML export in an `<iframe>` — zero viewer code, guaranteed to render. **Stretch:** custom SOG viewer component (PlayCanvas/supersplat-viewer) for smaller transfers + own UI chrome.
- Files: `frontend/app/upload/page.tsx`, `frontend/app/jobs/[id]/page.tsx`.

**Done when:** a stranger can upload photos from the deployed URL and orbit their scene minutes later; a deliberately bad photo set produces a readable failure UX.

## Phase 4 — Polish, guardrails, portfolio (negligible cost)

- Portfolio README + architecture diagram + honest "what I learned in Rust" section.
- **Demo gallery:** 3–5 pre-baked scenes from R2 (site impresses even with cold workers).
- **Cost guardrails (do not skip):** iteration cap (≤30k), photo/zip size caps (FE + worker), per-day job cap, max 1 concurrent worker, min-workers 0 + idle timeout, global kill-switch env var, GPU-seconds logging per job.
- **Photo-capture guidance page** (60–80% overlap, orbit subject, avoid blur/reflections/textureless surfaces) — the single biggest lever on success rate.

**Done when:** site runs publicly for a week with idle spend ≈ $0 and caps rejecting oversized uploads.

## Top risks & mitigations

1. **COLMAP fails on bad photo sets** → capture-guidance page, up-front photo-count validation, actionable error messages, `sequential_matcher` for walkthroughs.
2. **Worker image build pain** (slow vcpkg, CUDA version matching) → build once on pod/CI, cache in registry, pin CUDA 12.8, always `BUILD_PORTABLE=ON`.
3. **RunPod cold starts** (image pull + PTX JIT) → lean runtime image, FlashBoot, demo gallery up front, honest "spinning up a GPU" status.
4. **Artifact sizes / SM mismatch** → serve raw SOG via zero-egress R2, cap iterations, GPU filter Turing+.
5. **Rust learning curve stalls the BE** → Rust surface stays CRUD + proxy + one poll loop; complexity lives in Python (worker) and TS (FE).

## Budget

~**$50–100 all-in** to build and run for a few months: Phase 0 $5–15, Phase 1 debug $20–40, ~$0.30–1.00 per job, R2/Vercel $0, Fly.io $0–5/mo, optional domain ~$10/yr.

## Timeline (solo, evenings/weekends)

Phase 0: 1 week · Phase 1: 1–2 weeks · Phase 2: 1–2 weeks · Phase 3: 1 week · Phase 4: 1 week → **~4–8 weeks total.**

## Immediate next step

Phase 0, step 1: create a RunPod account, rent an RTX 4090 pod with a network volume, and start the manual pipeline. (Claude can guide command-by-command in a session; the pod work happens over SSH.)
