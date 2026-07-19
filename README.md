# WeddingAI
Stanford x DeepMind Hackathon

Built on the open-source [splat-service](https://github.com/jamesEmerson112/splat-service) boilerplate: photos in, a browser-viewable 3D scene out. Upload a few dozen overlapping photos of one place and the service reconstructs it as a **3D Gaussian Splatting** scene you can orbit in any browser — no plugins, no app. Behind the scenes a cloud GPU worker runs COLMAP (structure-from-motion) then [LichtFeld Studio](https://github.com/MrNeRF/LichtFeld-Studio) (headless training), exports a self-contained scene, and stores it on object storage. The whole upload → job → progress → viewer loop runs **locally with zero cloud credentials** thanks to a built-in mock mode (see Quickstart). The stack is a small, deliberately readable Rust/Axum backend, a Next.js frontend, and a Python GPU worker.

## Architecture

```
  ┌─────────┐   HTTP    ┌──────────────┐   HTTP    ┌──────────────┐
  │ Browser │ ────────▶ │  Next.js FE  │ ────────▶ │   Axum BE    │
  │ (you)   │ ◀──────── │   :3000      │ ◀──────── │   :8080      │
  └─────────┘           └──────────────┘           └──────┬───────┘
   upload photos          upload UI, job                  │ creates job,
   orbit the scene        stepper, viewer                 │ polls for progress
                                                          ▼
                              ┌───────────────────────────────────────────┐
                              │  Worker (one of two, chosen by MOCK_MODE)  │
                              │                                            │
                              │  MOCK poller  ─── walks the state machine  │
                              │                   on a timer (no GPU)      │
                              │                                            │
                              │  RunPod GPU worker ── COLMAP ──▶ LichtFeld │
                              │  (real mode)          (SfM)      Studio    │
                              │                                 (train)    │
                              └───────────────────┬───────────────────────┘
                                                  │ artifacts (scene.html/.sog)
                                                  ▼
                                          ┌────────────────┐
                                          │  R2 artifacts  │
                                          │ (object store) │
                                          └────────────────┘
```

**Job state machine:** `uploaded → queued → sfm → training → exporting → done` (any state → `failed`).

## Quickstart (mock mode)

No GPU, no RunPod, no R2 — the backend's mock poller marches each job through
every state on a timer, and the viewer shows a placeholder scene. Two terminals:

```bash
# Terminal 1 — backend (Rust/Axum on :8080)
cd backend
cp .env.example .env
cargo run

# Terminal 2 — frontend (Next.js on :3000)
cd frontend
npm install
npm run dev
# (no env file needed: the frontend defaults to http://localhost:8080;
#  set NEXT_PUBLIC_API_URL in .env.local to point elsewhere)
```

Open http://localhost:3000, drop in a few images, and hit upload. What you'll
see: the job appears in `uploaded`, then advances **one stage every ~5 seconds**
(`queued → sfm → training → exporting`), reaching **`done` in ~25 seconds**. The
"View scene" link opens the **placeholder scene** in the viewer. (The first
`cargo run` compiles dependencies and is slow; subsequent runs are instant.)

## Real mode — ROADMAP Phase 1

Real mode swaps the mock poller for an actual RunPod GPU worker and stores
artifacts on Cloudflare R2. The worker (`worker/handler.py` + `worker/Dockerfile`)
is currently a **stub** — wiring it up is [Phase 1](./ROADMAP.md). To flip the
backend out of mock mode you set `MOCK_MODE=false` and provide:

| Env var | Used by | Purpose |
|---|---|---|
| `MOCK_MODE=false` | backend | Use the RunPod worker + R2 presigning instead of the mock poller. |
| `RUNPOD_API_KEY` | backend | Authenticate to the RunPod serverless API. |
| `RUNPOD_ENDPOINT_ID` | backend | The serverless endpoint that runs the worker image. |
| `R2_ENDPOINT` | backend, worker | Cloudflare R2 S3-compatible endpoint URL. |
| `R2_ACCESS_KEY_ID` | backend, worker | R2 access key (presign uploads / read+write artifacts). |
| `R2_SECRET_ACCESS_KEY` | backend, worker | R2 secret key. |
| `R2_BUCKET` | backend, worker | Bucket holding `uploads/` and `jobs/<id>/` objects. |
| `R2_PUBLIC_BASE` | worker | Public base URL used to build the returned `scene_url`. |

## Repo layout

| Path | What it is |
|---|---|
| `frontend/` | Next.js + TypeScript + Tailwind UI: upload (drag-drop → client-side zip → PUT), job-status stepper, jobs list, iframe viewer. |
| `backend/` | Rust/Axum service + SQLite (sqlx). Job state machine, REST endpoints, background poller, and the single mock-vs-real worker switch. |
| `worker/` | RunPod serverless GPU worker — `handler.py` + `Dockerfile`. **Phase 1 stub** (COLMAP → LichtFeld Studio → export → upload). |
| `docs/` | Phase 0 runbook (`phase0-runbook.md`) + notes for the one-time manual pipeline. |
| `ROADMAP.md` | The 5-phase product roadmap this repo implements. |
| `.github/workflows/ci.yml` | CI: backend `fmt`/`clippy`/`test` + frontend `build`. |
| `LICENSE` | MIT. |

## More

- [ROADMAP.md](./ROADMAP.md) — the full 5-phase plan (manual pipeline → worker → backend → frontend → polish).
- [docs/phase0-runbook.md](./docs/phase0-runbook.md) — step-by-step manual GPU pipeline (the commands the worker automates).

## Credits & License

This project is based on the MIT-licensed [splat-service](https://github.com/jamesEmerson112/splat-service) boilerplate. It orchestrates LichtFeld Studio (GPLv3) strictly as an external process invoked inside the worker container — no GPL source is vendored, modified, or linked into this codebase, so the MIT license applies to everything here.
