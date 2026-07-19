# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

WeddingAI — a solo Stanford × DeepMind hackathon project, built on the imported
[splat-service](https://github.com/jamesEmerson112/splat-service) boilerplate:
users upload photos of one place, a job pipeline reconstructs it as a 3D Gaussian
Splatting scene viewable in the browser.

**Hackathon constraint (non-negotiable):** the deployed product's primary feature
must meaningfully use a **Gemini model**, called **server-side only** (the key must
never reach frontend code), with structured output and error handling. The
boilerplate has **no Gemini integration yet** — that is the main work to add. Full
requirements live in `docs/hackathon-spec.md`; the exact product angle on top of
the splat pipeline is still an open decision recorded at the bottom of that file.

**Locked decisions (2026-07-19):**

- Gemini model pinned to `gemini-3.5-flash` (Gemini Developer API — key verified
  working; 1M-token input, 65k output). No rolling aliases like
  `gemini-flash-latest`. Fallback order if needed: `gemini-2.5-flash`, then
  `gemini-3.1-flash-lite`.
- Deployment: **backend on Railway, frontend on Vercel**. This overrides
  ROADMAP.md's Fly.io choice for the backend. Note: Railway's filesystem is
  ephemeral — the SQLite file needs a Railway volume attached (or accept a
  reset-on-redeploy DB for the demo).

## Commands

Backend (Rust/Axum, port 8080):

```bash
cd backend
cp .env.example .env   # mock mode works with nothing filled in
cargo run              # first build is slow; SQLite file auto-created, migrations auto-run
cargo test             # tests live in src/db.rs
cargo test <name>      # single test
cargo fmt --check      # CI enforces
cargo clippy -- -D warnings   # CI enforces — warnings fail the build
```

Frontend (Next.js 16 + TypeScript + Tailwind 4, port 3000):

```bash
cd frontend
npm install
npm run dev
npm run build          # CI runs this
npm run lint
```

CI (`.github/workflows/ci.yml`) runs all of the above on **every push and PR** —
run fmt/clippy/test and the frontend build locally before pushing. No
`DATABASE_URL` is needed anywhere at compile time (sqlx runtime queries, not the
`query!` macros).

## Architecture

Three components; the frontend talks only to the backend, the backend talks to a
worker:

```
Next.js FE (:3000) → Axum BE (:8080) → worker: mock poller (default) OR RunPod GPU
                                        artifacts → Cloudflare R2 (real mode)
```

**Job state machine** (the spine of everything):
`uploaded → queued → sfm → training → exporting → done`, any state → `failed`.

**Mock vs real is decided in exactly one place**: `AppState::new` in
`backend/src/state.rs` picks `WorkerClient::Mock` or `WorkerClient::Runpod` from
`MOCK_MODE`. Mock is the default (anything except the literal string `false`
keeps it on), needs zero credentials, and advances each job one state every ~5s
(`done` in ~25s, placeholder scene). Real mode needs the RunPod/R2 vars in
`backend/.env.example` and a finished worker — `worker/handler.py` is currently a
**stub** (ROADMAP Phase 1).

Backend file responsibilities (each owns one concern):

| File | Owns |
|---|---|
| `backend/src/main.rs` | startup wiring: env → DB → migrate → router → serve |
| `backend/src/state.rs` | `Config` + `AppState`; the one mock-vs-real switch |
| `backend/src/db.rs` | `Job` struct, state-machine transitions, every SQL query, the tests |
| `backend/src/routes.rs` | HTTP endpoints: `POST /api/uploads`, `POST/GET /api/jobs`, `GET /api/jobs/{id}`, mock upload sink |
| `backend/src/worker_client.rs` | the `Mock`/`Runpod` enum seam — how a job is handed to a GPU |
| `backend/src/poller.rs` | background Tokio task nudging active jobs forward every 5s |

Frontend structure: `app/page.tsx` (upload: drag-drop → client-side zip via JSZip
→ PUT), `app/jobs/` (list + `[id]` status stepper polling via
`lib/useJobPolling.ts`), `app/viewer/[id]` (iframe viewer). All API calls go
through `lib/api.ts`, base URL = `NEXT_PUBLIC_API_URL`, default
`http://localhost:8080`.

## Docs map

| Path | What it is |
|---|---|
| `docs/hackathon-spec.md` | Full hackathon requirements, verbatim; open product/deploy decisions at the bottom |
| `ROADMAP.md` | 5-phase plan, **locked stack decisions**, verified LichtFeld/COLMAP facts — consult before re-deciding anything it settles |
| `docs/lichtfeld/` | Vendored upstream LichtFeld-Studio manual (repo docs + wiki snapshot); provenance in `INDEX.md` |
| `docs/lichtfeld/wiki/Command-Line-Options.md` | **Authoritative CLI flag reference** for worker code (some wiki feature pages use stale flag names — trust this file) |
| `docs/phase0-runbook.md`, `docs/phase0-notes.md` | Manual GPU pipeline the worker will automate |
| `TODO.md` | Deferred work queue (Gemini feature build is the top item) |

Pipeline gotchas from the LichtFeld manual: COLMAP images must be **undistorted**
(else scenes "explode"; or pass `--undistort` / `--gut`); max image size is
4096×4096 and anything wider than `--max-width` (default 3840) gets rescaled on
every load — pre-resize photos before training; GPU floor is SM 7.5 with 8 GB+
VRAM, no multi-GPU.

## Phase 0 state (EPHEMERAL — update or remove as things change; last edit 2026-07-19 ~19:45 UTC)

A RunPod Phase 0 session is IN PROGRESS. Live facts a fresh session needs:

- **Pod**: RTX 5090 (32 GB, 32 vCPU, Ubuntu 24.04, CUDA 12.8.93 toolkit at
  `/usr/local/cuda` — NOT on default SSH PATH), euro-3 datacenter.
  **120 GB network volume at `/workspace` (persistent), 30 GB container disk.**
- **SSH**: endpoint lives in `.env.pod` at the repo root (gitignored — CLAUDE.md
  is pushed, so no live host/port here). It's the "exposed TCP" variant (supports
  scp; the proxy variant does not). The endpoint dies with the pod; a replacement
  pod gets new values (user pastes them into `.env.pod`).
- **Build running**: `/workspace/phase0_build.sh` (runbook steps 2–4) in tmux
  session `build`, log at `/workspace/build.log` with `=== ...===` UTC milestones.
  Started 19:36 UTC; ETA 20:20–20:50 UTC. Deliberate deviations from the runbook:
  `-j16` and `VCPKG_MAX_CONCURRENCY=16` (60 GB RAM OOM guard on 32 cores).
  Script is idempotent — rerun to resume; vcpkg caches completed deps on the volume.
- **When build finishes**: `/workspace/dist/bin/run_lichtfeld.sh --help` is the
  sanity check AND the first-ever Blackwell/5090 JIT test (docs never mention
  Blackwell; escape hatch = rent a 4090 in euro-3, same volume, same PTX binary).
- **Next**: runbook steps 5–11 — COLMAP install, scp photos (40–60 of one place)
  to `/workspace/project/images`, SfM, train (`-i 7000` first to bank a result,
  then 30k if time allows), `convert` to .html/.sog, scp down, RECORD all timings
  in `docs/phase0-notes.md`. User has ~1-hour windows — bank results early.
- **Iron rule**: end of session = TERMINATE THE POD, KEEP THE VOLUME. The build
  and all data live on `/workspace` and survive. Idle pods bill ~$1/hr.

## Rules that override defaults

- **Next.js version warning**: `frontend/AGENTS.md` (included by
  `frontend/CLAUDE.md`) — this Next.js (16.2.10) has breaking changes vs. training
  data; read the relevant guide in `node_modules/next/dist/docs/` before writing
  frontend code.
- **Secrets**: `GEMINI_API_KEY` and all RunPod/R2 credentials live in `.env`
  files (gitignored) and are used server-side only.
- CORS is `permissive()` in `main.rs` with a TODO to restrict before production —
  relevant once deployed for judging.
