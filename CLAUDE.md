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
| `backend/src/routes.rs` | HTTP endpoints: `GET /api/health`, `POST /api/uploads`, `POST/GET /api/jobs`, `GET /api/jobs/{id}`, mock upload sink |
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

## Deployment state (EPHEMERAL — update or remove as things change; last edit 2026-07-19 ~20:10 UTC)

- **Backend LIVE**: `https://weddingai-production.up.railway.app` (mock mode).
  `GET /api/health` verifies process + DB + config in one request (reports
  `mock_mode`, `public_base_url`, `version`; 503 if DB unreachable). Railway
  auto-deploys on every push to main via `backend/Dockerfile` (pins rust:1.88 —
  Railway's default Railpack rustc 1.85 is too old for the locked `icu_*` crates).
- Mock upload URL is built from `PUBLIC_BASE_URL`, falling back to Railway's
  injected `RAILWAY_PUBLIC_DOMAIN`, else `http://localhost:PORT` (fixed
  2026-07-19 — was hardcoded localhost, which broke the deployed upload flow).
- Railway volume for SQLite NOT confirmed attached — until it is (mount `/data`
  + `DATABASE_URL=sqlite:///data/data.db?mode=rwc`), the DB resets on each
  redeploy. Optional: set Railway healthcheck path to `/api/health`.
- **Frontend FULLY WIRED + Gemini key LIVE (verified ~20:52 UTC)**:
  `https://wedding-ai-omega.vercel.app` bundle points at Railway; both env vars
  set in Vercel Production. `/api/analyze` verified END-TO-END on the live site
  with a real image → real `gemini-3.5-flash` structured report. Key also in
  `frontend/.env` (verified gitignored via `frontend/.gitignore:34`) for local
  dev. Still to run: full incognito upload → viewer test.
- **`/api/render` DEPLOYED but BLOCKED BY KEY TIER**: live calls 429 with
  `generate_content_free_tier` quota exceeded — the Gemini key's project is
  FREE TIER, which has no real image-generation allowance (text models work).
  Verified via direct REST: `gemini-2.5-flash-image` IS on the key's model
  list, metadata resolves, generateContent → 429. **Code and model ID are
  correct — NO code change needed.** USER ACTION: enable billing / upgrade the
  key's project to Tier 1 (ai.google.dev) or swap `GEMINI_API_KEY` to a billed
  project's key in Vercel + `frontend/.env`. Until then the "Visualize theme"
  button 502s gracefully (demo can skip it). **This also blocks the afternoon
  generated-images→LichtFeld run** — image generation is the product's input.
- **Vision render feature shipped** (`6850bf1`, ~20:39 UTC): `/api/render`
  route (image-to-image: one venue photo + theme → concept render), "Visualize
  theme" button on the report card. An ultracode verify fleet (4 Sonnet finders
  → Opus adversarial verifiers; 8 raw findings, 1 confirmed) caught a real
  race — in-flight Gemini responses landing on a swapped photo set — fixed via
  a `requestSeq` ref guard in `page.tsx`.
- **Demo seeds: 3 `done` jobs live** (60ebff58…, 7f3bee9f…, 2edbfa03…, re-seeded
  ~21:15 UTC after the docs push `40639bf` DID wipe the Railway DB — so even
  docs-only pushes can trigger a rebuild; always verify + reseed after ANY push
  via the session seed script).
- **Push freeze LIFTED (user call, ~21:05 UTC)** — pushes are fine anytime:
  both platforms deploy zero-downtime, so the demo link never goes dark. Only
  consequence of a backend-touching push is a Railway DB wipe → re-run the
  seed script (`scratchpad/seed-demo-jobs.sh` of session 6de23d68, ~30s) and
  the 4 demo scenes are back.
- **UI MOCKUP REWORK IN PROGRESS (~21:45 UTC, uncommitted on disk)** — source
  design: `WeddingAI-Prototype.html` at repo root (bundled artifact; extracted
  markup at scratchpad `prototype-extracted.html`, session 6de23d68). Approved
  plan: `/Users/mrbam/.claude/plans/unified-crunching-gadget.md`. User
  decisions: all 5 screens; responsive (not fixed-width); demo flow = upload
  photos → pick a PRE-WRITTEN theme (6 authored in `frontend/lib/themes.ts`) →
  photos generated to match; photo-analysis stays as secondary path; Studio
  "All out" mode REALLY loops /api/render over all session photos.
  **DONE (build+lint green)**: `globals.css` (warm tokens: cream/paper/ink/
  terra/sage etc. + mockup keyframes pulseDot/shimmerX/floatY/spinRing, light-
  only), `layout.tsx` (+Cormorant Garamond via next/font, WeddingAI metadata),
  `components/AppShell.tsx` (New/Memories/Studio nav pills), `lib/themes.ts`
  (6 preset themes as full ThemeReport objects), `lib/memory.ts` (jobId→title/
  gradient + localStorage meta), `lib/theme.ts` (+downscaleSet, sessionStorage
  scene handoff saveSessionScene/loadSessionScene/sessionSceneSnapshot,
  renderOne), `app/page.tsx` (Upload: preset chips + "design from photos" +
  thumbnails; saves scene handoff + memory meta at create), `app/studio/
  page.tsx` (NEW: scope one/all, mood chips, editable prompt, sequential real
  render loop w/ progress + per-photo error tiles; useSyncExternalStore for
  sessionStorage — lint forbids setState-in-effect),
  `app/jobs/[id]/page.tsx` (Processing screen — written by a subagent, NOT
  yet verified by me).
  **STILL TO DO**: `app/jobs/page.tsx` (Memories card grid — still old table)
  and `app/viewer/[id]/page.tsx` (viewer overlay chrome: ‹ Memories, serif
  title, Share-copies-URL, ✦ Reimagine in Studio → /studio, orbit-hint pill,
  pointer-events-none wrapper pattern) — spec in plan file §"Screens" 3+4;
  then npm run build && lint, local walkthrough, push, RESEED (a push earlier
  today wiped the DB: seeds now 3 done jobs 60ebff58…, 7f3bee9f…, 2edbfa03…).
  A helper subagent doing jobs list+viewer DIED on the monthly spend limit
  (user raised it $10; limit may bite again — prefer solo coding, no agents).
- Then: the afternoon image→3D run for the end-of-day complete submission.
- CORS still permissive — restrict to the Vercel domain before judging.
- **PRODUCT DEFINITION (user's words, 2026-07-19 ~20:45 UTC)**: "use the
  generated images then get processed into a 3D with LichtFeld" — i.e. Gemini
  GENERATES the themed venue images and **those generated images are the input
  to the LichtFeld 3D pipeline**. Today's build = step 1 (theme +
  `gemini-2.5-flash-image` venue render, live) + the pipeline skeleton (mock);
  the generated-images→LichtFeld hop is the next milestone (needs the banked
  volume build + a multi-view-consistent generation strategy). All pitch and
  README copy must describe the product this way.
- **Gemini feature SHIPPED 2026-07-19 ~20:25 UTC** — first slice: theme
  designer (photos → `gemini-3.5-flash` structured theme report). Server-side only route
  `frontend/app/api/analyze/route.ts` (response schema, 400/502/504 error
  mapping, 50s timeout, maxDuration=60); client `frontend/lib/theme.ts`
  (canvas downscale to ~1024px JPEG, ≤8 sampled photos, localStorage demo
  cache keyed by photo set); report card + Gemini disclosure in
  `frontend/app/page.tsx`. Locally needs `frontend/.env.local` — USER runs:
  `grep '^GEMINI_API_KEY=' backend/.env > frontend/.env.local`.

## Phase 0 state (EPHEMERAL — update or remove as things change; last edit 2026-07-19 ~20:10 UTC)

A RunPod Phase 0 session is IN PROGRESS. Live facts a fresh session needs:

- **Pod**: RTX 5090 (32 GB, 32 vCPU, Ubuntu 24.04, CUDA 12.8.93 toolkit at
  `/usr/local/cuda` — NOT on default SSH PATH), euro-3 datacenter.
  **120 GB network volume at `/workspace` (persistent), 30 GB container disk.**
- **SSH**: endpoint lives in `.env.pod` at the repo root (gitignored — CLAUDE.md
  is pushed, so no live host/port here). It's the "exposed TCP" variant (supports
  scp; the proxy variant does not). The endpoint dies with the pod; a replacement
  pod gets new values (user pastes them into `.env.pod`).
- **Build running**: `/workspace/phase0_build.sh` (runbook steps 2–4) in tmux
  session `build`, log at `/workspace/build.log` with `=== ...===` UTC milestones
  (check: `grep -E "^=== " /workspace/build.log | tail`). Started 19:36 UTC;
  as of 21:11 UTC still in vcpkg deps (61 ports done, python3 in flight, active
  CPU — healthy, not stuck; ETA for finished dist/bin ≈ 22:00–23:30 UTC, fine
  for the afternoon run).
  **DEADLINE CORRECTION (user, ~20:48 UTC): 2:30 PM PT is only the IN-PERSON
  demo; the complete submission is due END OF DAY.** So: the 2:30 demo ships on
  the mock pipeline, and the REAL run happens this afternoon — **KEEP THE POD
  RUNNING through the demo** (overrides the earlier terminate-at-2:00 note; the
  build must finish for the afternoon session). Afternoon plan ("rough is fine"
  per user): COLMAP on ORIGINAL photos for consistent poses → Gemini-restyle
  20–40 of them with one fixed theme prompt → train LichtFeld on the restyled
  images (-i 7000 first) → convert to scene.html → scp down → commit to
  frontend/public/ + point a job's artifacts_json at it → push + re-run the
  seed script. If the pod dies mid-build, rerun `/workspace/phase0_build.sh`
  (idempotent, vcpkg caches on the volume). Deliberate
  deviations from the runbook: `-j16` and `VCPKG_MAX_CONCURRENCY=16` (60 GB RAM
  OOM guard on 32 cores).
- **COLMAP already installed** (runbook step 5 DONE, in parallel): `/usr/bin/colmap`,
  log at `/workspace/colmap_install.log`.
- **When build finishes**: `/workspace/dist/bin/run_lichtfeld.sh --help` is the
  sanity check AND the first-ever Blackwell/5090 JIT test (docs never mention
  Blackwell; escape hatch = rent a 4090 in euro-3, same volume, same PTX binary).
- **Next**: runbook steps 6–11 — scp photos (40–60 of one place) to
  `/workspace/project/images`, SfM, train (`-i 7000` first to bank a result,
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

## Context history

### 2026-07-19 20:54 UTC — hackathon day session

**Accomplished:**
- Shipped mandatory Gemini feature: theme designer — `frontend/app/api/analyze/route.ts`
  (gemini-3.5-flash, structured output, 400/502/504 error mapping) + client lib
  `frontend/lib/theme.ts` (downscale, evenly-sampled ≤8 photos, localStorage demo
  cache) + report card UI in `frontend/app/page.tsx`. Commits `697a128`, `6850bf1`.
- Shipped vision render: `frontend/app/api/render/route.ts` (gemini-2.5-flash-image,
  image-to-image venue restyle) + "Visualize theme" button.
- Ran an ultracode verify fleet (4 Sonnet finders + Opus adversarial verifiers,
  12 agents): 8 raw findings, 1 confirmed — stale in-flight Gemini response race
  on photo-set swap — fixed with a `requestSeq` ref guard in `page.tsx`.
- Live-verified frontend↔backend wiring on wedding-ai-omega.vercel.app;
  `/api/analyze` confirmed end-to-end with a real Gemini call on the public URL.
- Root-caused `/api/render` failure to the Gemini key being FREE TIER (429
  `generate_content_free_tier` via direct REST test; model exists on the key,
  code is correct, no code change needed).
- Product definition locked (user's words): Gemini GENERATES the themed venue
  images and those generated images are the input to the LichtFeld 3D pipeline.
- Deadline corrected: 2:30 PM PT is only the in-person demo; complete submission
  due end of day. Pod kept alive through the demo for the afternoon image→3D run.

**Open questions:**
1. UI mockup: which mockup/design source should the frontend implement? (user
   to specify — declared next phase)
2. Gemini key billing: when will the key's project be upgraded to a paid tier
   (or a billed key swapped in)? Blocks `/api/render` AND the afternoon
   generated-images→LichtFeld run.
3. Afternoon run: which 40–60 photo set of one place will be used, and how
   many restyled images (~20–40) are wanted?
4. Railway volume still not attached — DB resets on every deploy; accept for
   demo or attach before end-of-day submission?
5. Restrict permissive CORS to the Vercel domain before the end-of-day submission?
6. Submission materials (README restructure, pitch video, demo video,
   screenshots — TODO.md item 3) are all not started; when to begin this afternoon?
