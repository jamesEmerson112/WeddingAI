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

Frontend structure (post-mockup rework): `app/page.tsx` (Upload — drag-drop →
theme pick → client-side zip via JSZip → PUT), `app/jobs/` (Memories grid +
`[id]` Processing stepper polling via `lib/useJobPolling.ts`),
`app/viewer/[id]` (iframe scene + overlay chrome), `app/studio/page.tsx`
(Gemini restyle screen), `components/AppShell.tsx` (nav). Client libs:
`lib/api.ts` (all backend calls, base URL `NEXT_PUBLIC_API_URL`, default
`http://localhost:8080`), `lib/theme.ts` (downscaling, `/api/analyze` +
`/api/render` callers, job-keyed sessionStorage handoff to Studio),
`lib/themes.ts` (6 authored preset themes), `lib/memory.ts` (per-job display
title/gradient + localStorage meta).

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
- **DEMO SEEDS: WIPED — 0 `done` jobs on the live backend (needs reseed).**
  The `bfa806d` push rebuilt Railway and cleared SQLite. Reseed with
  `bash <scratchpad>/seed-demo-jobs.sh` (session 6de23d68, ~30s, creates 3
  jobs the mock poller walks to `done` in ~25s). User interrupted the reseed
  at ~01:10 UTC — RUN IT before any demo. Rule: verify + reseed after EVERY
  push (even docs-only pushes have triggered a Railway rebuild).
- **Push freeze LIFTED (user call, ~21:05 UTC)** — pushes are fine anytime:
  both platforms deploy zero-downtime, so the demo link never goes dark.
- **UI MOCKUP REWORK SHIPPED + LIVE** (`d3ad453` build, `bfa806d` review
  fixes; Vercel deploy verified live ~01:15 UTC: `/studio` → 200, homepage
  says "Create a memory"). Source design: `WeddingAI-Prototype.html` at repo
  root (untracked bundled artifact; extracted markup at scratchpad
  `prototype-extracted.html`). Plan:
  `/Users/mrbam/.claude/plans/unified-crunching-gadget.md`.
  Five screens, all building + linting clean:
  `app/page.tsx` Upload ("Create a memory": dropzone + real thumbnails, 6
  preset theme chips from `lib/themes.ts`, secondary "let Gemini design from
  my photos" = the spec-required structured-output path);
  `app/jobs/[id]` Processing (vertical stepper, progress bar, shimmer panel);
  `app/jobs/page.tsx` Memories (card grid, titles/gradients from
  `lib/memory.ts`); `app/viewer/[id]` (iframe + overlay chrome, Share copies
  URL, "✦ Reimagine in Studio"); `app/studio/page.tsx` NEW (scope one/all,
  mood chips, editable prompt, REAL sequential `/api/render` loop with
  progress + per-photo error tiles). Shell: `components/AppShell.tsx` nav,
  `globals.css` warm tokens + mockup keyframes (light-only), Cormorant
  Garamond + Geist in `layout.tsx`.
- **Ultracode validation of the rework (2026-07-20 ~00:45 UTC)**: 5 Sonnet
  finders → Opus adversarial verifiers, 20 agents; 15 raw findings, 11
  confirmed, all FIXED in `bfa806d`. Load-bearing outcomes worth remembering:
  - Studio handoff is now **keyed by job id** (`weddingai:scene:<id>`, old
    entries pruned on save) and the viewer links `/studio?from=<id>` — before,
    "Reimagine in Studio" silently used the LAST upload's photos for any
    memory you opened.
  - Studio gates its empty state on hydration (a refresh used to flash
    "Nothing to restyle yet"), cancels in-flight renders on unmount via
    AbortController, and distinguishes "wrong memory" from "never uploaded".
  - `saveSessionScene` returns a boolean; `saveMemoryMeta` records
    `studioReady` so a quota failure is explainable instead of silent.
  - Upload: `designTheme` owns its `requestSeq` generation and only clears
    busy when still current; photo input ignored while `busy` (the visible
    set could diverge from the one actually uploading); thumbnail object URLs
    minted in the event handler (Strict Mode double-invokes memo factories).
  - Jobs list parses SQLite's UTC `created_at` as UTC (was showing tomorrow's
    date every evening in PT).
  - Processing keeps completed steps on failure instead of resetting to 0%.
  - **Lint gotchas that WILL bite again**: `react-hooks/set-state-in-effect`
    and "Cannot access refs during render" are ERRORS here. Use
    `useSyncExternalStore` for client-only reads, adjust-state-during-render
    for derived values, and event handlers for side effects.
  - `useSearchParams` in a prerendered route needs a `<Suspense>` boundary.
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

## Phase 0 state (EPHEMERAL — update or remove as things change; last edit 2026-07-20 ~01:15 UTC)

RunPod pod is ALIVE and doing a **clean LichtFeld rebuild** (started 00:59 UTC).

- **Pod**: RTX 5090 (32 GB, 32 vCPU, Ubuntu 24.04, CUDA 12.8.93 at
  `/usr/local/cuda`, NOT on default SSH PATH), euro-3. 120 GB network volume
  at `/workspace` (MooseFS, persistent), 30 GB container disk.
- **SSH**: `.env.pod` at repo root (gitignored). Variable names are
  `POD_SSH_USER / POD_SSH_HOST / POD_SSH_PORT / POD_SSH_KEY` — connect with
  `ssh -i "$POD_SSH_KEY" -p "$POD_SSH_PORT" "$POD_SSH_USER@$POD_SSH_HOST"`.
  On macOS also `export PATH=/usr/bin:/bin:...` first — this shell's default
  PATH lacks curl/ssh/grep.
- **THE 2-HOUR FIRST RUN BUILT NOTHING.** 19:36→21:54 UTC was entirely vcpkg
  deps; LichtFeld's own configure then FAILED on a missing system package
  (`libgtk-3-dev`, required by `cmake/SetupNativeFileDialog.cmake` for the NFD
  GTK backend). The script has **no `set -e`**, so it fell through configure →
  build → install → "SANITY CHECK FAILED", which masked the real cause. Fixed
  by `apt-get install -y libgtk-3-dev` (done, gtk 3.24.41 present).
- A second relaunch inherited the half-generated build tree and died instantly
  with `fatal error: opening dependency file ... .o.d: No such file or
  directory`. Fix: **wipe `/workspace/LichtFeld-Studio/build` and reconfigure**
  (done 00:59 UTC).
- **The vcpkg binary cache is at `/root/.cache/vcpkg/archives` (1.3 GB, 74
  ports) — OUTSIDE the build tree**, so wiping `build/` does NOT repeat the
  2-hour dependency phase; ports restore from cache. (It is on the CONTAINER
  disk, so it dies with the pod — the volume keeps sources only.)
- **Current run**: tmux session `build`, log `/workspace/build3.log` (the
  script does NOT self-redirect — always launch as
  `tmux new-session -d -s build "bash /workspace/phase0_build.sh > /workspace/buildN.log 2>&1"`,
  or the output is lost when the session ends). Check with
  `grep -E "^=== " /workspace/build3.log | tail` and
  `grep -oE "\[[0-9]+/[0-9]+\]" /workspace/build3.log | tail -1` (ninja).
  Success = `/workspace/dist/bin/run_lichtfeld.sh` exists (also the first-ever
  Blackwell/5090 JIT test; escape hatch = rent a 4090 in euro-3, same volume).
- **PHOTO DATA (user pasted 2026-07-20 ~00:40 UTC)**: `photos-inbox/` at repo
  root (gitignored) holds `Location-1/` (6 JPEGs, 5712×4284) and `Location-2/`
  (7 JPEGs, 1024×768). **This is far too few for a real splat** — COLMAP +
  LichtFeld want 40–150 photos of ONE place with good overlap; 6–7 views will
  not reconstruct. Uses that DO work with this set: the demo "sample venue"
  button, theme-analysis and render demos, screenshots. **A real 3D run needs
  the user to shoot/supply a proper walkthrough set of one room.** Also
  pre-resize before training (max 4096px, `--max-width` default 3840).
- **Iron rule**: end of session = TERMINATE THE POD, KEEP THE VOLUME. Idle
  pods bill ~$1/hr. Note the vcpkg binary cache does NOT survive termination.

## Rules that override defaults

- **DESKTOP ONLY (user call, 2026-07-19 ~17:55 PT)**: this is a prototype for a
  laptop-projected demo and desktop screenshots. Do NOT spend time on mobile
  layout, phone breakpoints, or touch affordances. Existing responsive classes
  can stay (they're already written and passing), but no new mobile work, and
  don't report mobile-only issues as defects.

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
