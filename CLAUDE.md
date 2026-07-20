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

## Fresh machine setup (read this FIRST on a new computer)

Everything below is gitignored or untracked, so `git clone` alone does **not**
give you a working checkout. Recreate these by hand. **Never paste real values
into a tracked file** — only the variable NAMES belong in git.

| File (gitignored) | Variables | Where to get the values |
|---|---|---|
| `frontend/.env` | `GEMINI_API_KEY`, `NEXT_PUBLIC_API_URL` | Key: Vercel → WeddingAI → Settings → Environment Variables (Production). URL: the Railway backend domain. |
| `backend/.env` | `MOCK_MODE`, `PORT`, `PUBLIC_BASE_URL`, `DATABASE_URL`, `TEST_DATABASE_URL`, `RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID`, `R2_*` | `cp backend/.env.example backend/.env` — the local Postgres defaults already work; RunPod/R2 only matter in real mode. |
| `.env.pod` (repo root) | `POD_SSH_USER`, `POD_SSH_HOST`, `POD_SSH_PORT`, `POD_SSH_KEY` | RunPod dashboard → the pod's SSH details. Only needed to touch the GPU pod. |
| `photos-inbox/` | — | Local test photos; not in git. Re-add if needed, or shoot a video and use `scripts/video-to-frames.sh`. |

Then:

```bash
cd backend && docker compose up -d && cargo run    # Postgres must be up first
cd frontend && npm install && npm run dev
```

Sanity check: `curl -s localhost:8080/api/health` should report `"db":"ok"`.

## Commands

Backend (Rust/Axum, port 8080):

```bash
cd backend
cp .env.example .env   # mock mode works with nothing filled in
docker compose up -d   # REQUIRED: Postgres. Unlike the old SQLite there is no
                       # "create if missing" — a fresh clone needs a live server.
cargo run              # first build is slow; migrations auto-run
cargo test             # needs Postgres too (no `sqlite::memory:` equivalent);
                       # tests are in src/routes.rs (DB-backed) and src/db.rs
                       # (pure next_state logic only)
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

**Video is a first-class input.** A splat needs 40–150 overlapping views, which
is impractical to shoot by hand, so a 45–90s slow orbit video works anywhere
photos do. Three implementations of ONE decision — keep them in agreement:
`frontend/lib/frames.ts` (in-browser `<video>`+`<canvas>`, runs before the
existing JSZip step so **no backend or worker change was needed**),
`scripts/video-to-frames.sh` (ffmpeg, for local/manual runs), and
`worker/handler.py` step 2b (ffmpeg, blueprint only). All three sample at a
FIXED rate targeting ~110 frames clamped to 40–150 — scene detection would thin
out exactly the slow, dense, high-overlap passes that reconstruct best.
Caveats: motion blur is the top failure mode; and iPhone HEVC often won't decode
outside Safari, so the browser path fails with a message pointing at the script.

Frontend structure (post-mockup rework): `app/page.tsx` (Upload — drag-drop
photos **or a video** → theme pick → client-side zip via JSZip → PUT),
`app/jobs/` (Memories grid +
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

## Deployment state (EPHEMERAL — update or remove as things change; last edit 2026-07-20 ~04:40 UTC)

- ✅ **POSTGRES IS LIVE ON RAILWAY (2026-07-20 ~05:00 UTC).** Confirmed by the
  `_sqlx_migrations` and `jobs` tables existing in the Postgres service's Data
  tab — the migration ran for real. **The DB no longer resets on deploy**, which
  kills the old "reseed after EVERY push" rule.
- **⚠️ The deploy that got us here crash-looped first — learn from it.** The
  first push died with sqlx's bare `Configuration(RelativeUrlWithoutBase)`,
  ~5 min of 502s. Cause: `DATABASE_URL` existed on the backend service but its
  VALUE wasn't a URL — a Railway reference `${{Foo.DATABASE_URL}}` stays a
  literal string when no service is named exactly `Foo`, so the dashboard shows
  a correctly-set variable that is useless. The reliable fix is Railway's own
  **"Trying to connect a database? Add Variable"** prompt, which wires the
  reference with no name to typo. `main.rs` now validates the scheme up front
  and names the cause (`b9daa47`) instead of panicking cryptically — it never
  logs the value, which carries the password.
  **Process lesson**: a masked variable value cannot be verified from outside.
  Read it in Railway's Raw Editor BEFORE pushing a change that depends on it.
  Also: right after a push, `/api/health` returning 200 may still be the OLD
  deploy — don't read it as success until the rebuild has actually swapped.
- **Railway layout**: services `WeddingAI` (backend, volume `weddingai-volume`
  mounted at `/data`) and `Postgres` (volume `postgres-volume`).
- **Postgres migration DONE + VERIFIED** (`dcb8392`). Verified
  against a real Postgres 16 in Docker, not merely compiled: fmt/clippy/4 tests
  pass, migrations apply, and a full `uploaded → done` job walk exercised every
  rewritten statement. Two silent-at-compile-time landmines caught and fixed:
  `iters` must be **BIGINT** (db.rs declares `i64`; Postgres `int4` is strict and
  sqlx won't widen it), and `created_at` must stay **TEXT** defaulting to
  `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')` — the obvious
  `CURRENT_TIMESTAMP` would break every date in the Memories grid, because
  `frontend/app/jobs/page.tsx` regex-matches SQLite's exact format to parse UTC.
- **STORAGE FOR IMAGE BYTES — prefer a Railway BUCKET over a Railway VOLUME**
  (researched 2026-07-20 ~04:50 UTC; supersedes the earlier volume plan):
  - Railway **Buckets** are private, fully **S3-compatible** object storage,
    `$0.015/GB-month` with **unlimited free egress and free S3 API ops**.
    Credentials live in the bucket's **Credentials** tab. Private by default —
    serve files via presigned URLs or proxy them through the backend.
    Created from `+ New` → **Bucket** (it IS in the Add-New-Service menu).
  - Railway **Volumes** are NOT in that menu — a volume is not a service. You
    attach one to an EXISTING service (right-click the service on the canvas,
    or the service's Settings → Volumes; `Cmd+K` → "attach volume" also works).
    Hard limits: **0.5 GB free / 5 GB Hobby / 50 GB Pro**, **one volume per
    service**, and **replicas cannot be used with volumes at all**.
  - **Why Bucket wins here**: the repo is ALREADY built for an S3-compatible
    store — `backend/.env.example` stubs `R2_ENDPOINT / R2_ACCESS_KEY_ID /
    R2_SECRET_ACCESS_KEY / R2_BUCKET / R2_PUBLIC_BASE`, `routes.rs:97-104` has
    the presigning TODO where the 501 lives, and `ROADMAP.md:13` locks
    "Artifacts: Cloudflare R2 (S3-compatible)". A Railway Bucket is that same
    shape, hosted next to the backend. Those five env vars map 1:1 — no rename
    needed, just fill them from the Credentials tab.
  - **Cost of Bucket over Volume**: needs an S3 SDK (`aws-sdk-s3`, currently NOT
    in `Cargo.toml`) plus presigning code, vs. a volume's trivial `std::fs`.
    That is the only reason a volume was ever attractive.
- **Local dev now REQUIRES a database**: `docker compose up -d` from `backend/`.
  Postgres has no `sqlite::memory:` equivalent, so `cargo run` AND `cargo test`
  both need a live server (CI got a Postgres service container). Tests each get
  their own schema so parallel runs can't collide on one `jobs` table.
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
- **GEMINI BILLING ENABLED by the user 2026-07-20 ~04:30 UTC.** `/api/render`
  (image generation, `gemini-2.5-flash-image`) previously 429'd with
  `generate_content_free_tier` because the key's project was free tier — image
  generation has no free allowance, though text models worked. The code and
  model ID were always correct; it was purely a billing tier issue.
  ⚠️ **NOT re-tested since billing was enabled** — confirm with one live
  "Visualize theme" click before relying on it in a demo.
- **Vision render feature shipped** (`6850bf1`, ~20:39 UTC): `/api/render`
  route (image-to-image: one venue photo + theme → concept render), "Visualize
  theme" button on the report card. An ultracode verify fleet (4 Sonnet finders
  → Opus adversarial verifiers; 8 raw findings, 1 confirmed) caught a real
  race — in-flight Gemini responses landing on a swapped photo set — fixed via
  a `requestSeq` ref guard in `page.tsx`.
- **DEMO SEEDS: 3 `done` jobs live, reseeded ~04:58 UTC onto Postgres.**
  Reseed if ever needed: `scripts/seed-demo-jobs.sh [API_URL] [COUNT]`
  (in-repo, ~30s, then the mock poller walks them to `done` in ~25s).
  **The old "reseed after EVERY push" rule is now OBSOLETE** — that was a
  SQLite-on-ephemeral-disk problem, and Postgres persists across deploys.
  Still verify after a push, with the tally form and NOT `grep -c` (the API
  returns ONE line of JSON, so `grep -c` can only ever print 0 or 1):
  `curl -s $API/api/jobs | grep -o '"state":"[a-z]*"' | sort | uniq -c`
- **THERE IS NO PUSH FREEZE** (lifted by the user ~21:05 UTC, still lifted).
  Pushes are fine anytime: both platforms deploy zero-downtime, so the demo
  link never goes dark. Do NOT invent a "hold the push so Railway stays
  untouched" rule — that was an assistant error on 2026-07-20 ~01:30 UTC and
  the user correctly called it out. The real consequence of a push is only
  that a Railway rebuild wipes ephemeral SQLite; the response is verify +
  reseed, never withhold the push.
- **UI MOCKUP REWORK SHIPPED + LIVE** (`d3ad453` build, `bfa806d` review
  fixes; Vercel deploy verified live ~01:15 UTC: `/studio` → 200, homepage
  says "Create a memory"). Source design: **`WeddingAI-Prototype.html`** at repo
  root — now COMMITTED (551 KB bundled artifact) so it survives a machine move;
  it is the design of record for all five screens.
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

## Phase 0 state (EPHEMERAL — update or remove as things change; last edit 2026-07-20 ~04:40 UTC)

✅ **LICHTFELD BUILD SUCCEEDED (2026-07-20 ~04:15 UTC).** Binary at
**`/workspace/dist/bin/run_lichtfeld.sh`** — on the PERSISTENT network volume, so
it survives pod termination. Verified runnable (exit 0, full help text, all
subcommands). No Blackwell/RTX 5090 JIT errors; `CMAKE_CUDA_ARCHITECTURES` was
auto-detected as `120-real;120-virtual`. Caveat: this only exercised startup and
CLI parsing — a real CUDA kernel JIT only triggers on an actual training run.

⚠️ **THE POD IS STILL RUNNING AND BILLING ~$1/hr.** Terminate when done; the
volume (and therefore the binary) survives, but `/root/.cache/vcpkg` does not.

**Two root causes, both found by experiment — record them so nobody re-guesses:**
1. The mass `.o.d: No such file or directory` failure was **NOT** a MooseFS/network
   filesystem race. That hypothesis was **disproven** by relocating the build to
   local container disk and reproducing the identical instant failure. The real
   cause: LichtFeld's own `cmake/CompilerCacheLauncher.cmake` (a ccache wrapper,
   ON by default) runs `execute_process(... WORKING_DIRECTORY <top-level build
   root>)` while the enclosing Makefile rule has already `cd`'d into the
   per-target subdir, so every relative `-MF .../*.o.d` resolved against the wrong
   directory. Deterministic, not a race — which is exactly why CUDA/nvcc objects
   (which bypass the launcher) were unaffected. **Fix: `-DENABLE_COMPILER_CACHE=OFF`.**
2. Then, at 100%, a GCC 14 link failure: `undefined reference to
   std::__stacktrace_impl::_S_current`. `std::stacktrace` lives in a separate
   archive (`libstdc++exp.a`); `libOpenImageIO.a` also needs those symbols but is
   flattened AFTER it, and GNU ld's single left-to-right pass never rescans.
   `LINK_GROUP:RESCAN` and `$<LINK_LIBRARY:WHOLE_ARCHIVE,...>` both failed to fix
   it. **Fix: raw `-Wl,--whole-archive <path> -Wl,--no-whole-archive` strings
   passed to `target_link_libraries`** in `src/core/CMakeLists.txt` — raw strings
   bypass CMake's link-line reordering; library names don't.
   Edits live only on the pod's throwaway clone (backup:
   `/workspace/src_core_CMakeLists.txt.bak`), NOT in this repo.

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
- **BUILD ATTEMPT #3 FAILED — wiping `build/` was NOT the fix.** Log
  `/workspace/build3.log`. Configure SUCCEEDED this time (00:59:05 → 01:05:39
  UTC, so the gtk fix held), then the build died in **12 seconds** with the
  SAME error on EVERY target at once (lfs_tree_sitter, OpenMeshCore, nfd,
  nvimgcodec, spz_lib, lfs_geometry, gsplat_backend_lfs, Zep):
  `fatal error: opening dependency file CMakeFiles/<t>.dir/<f>.o.d: No such
  file or directory`. **Ruled out: disk space AND inodes** — `/` is 8% used
  (28 G free), `/workspace` has 216 T free. Note the log shows `gmake`
  (Makefiles generator), not ninja as earlier notes assumed.
  Leading hypothesis: the build tree is on `/workspace`, a **MooseFS network
  mount**, and GCC's `.o.d` dependency-file writes into freshly-created
  object dirs are unreliable there → **build on the container disk**
  (`/root/...`) instead. The vcpkg binary cache already lives on that disk,
  so relocating the build tree does NOT repeat the dependency phase.
  A background agent (spawned ~01:40 UTC) is testing this and will retry.
- **Launch pattern**: the script does NOT self-redirect — always launch as
  `tmux new-session -d -s buildN "bash /workspace/phase0_build.sh > /workspace/buildN.log 2>&1"`,
  or the output is lost when the session ends. Check with
  `grep -E "^=== " /workspace/buildN.log | tail`, `grep -oE "\[ *[0-9]+%\]"`
  (make) or `grep -oE "\[[0-9]+/[0-9]+\]"` (ninja) piped to `tail -1`.
  Success = `/workspace/dist/bin/run_lichtfeld.sh` exists (also the first-ever
  Blackwell/5090 JIT test; escape hatch = rent a 4090 in euro-3, same volume).
- **CAPTURE = VIDEO, NOT PHOTOS (user call ~02:00 UTC).** Shooting 40–150
  stills by hand is a hassle; instead shoot a 45–90s slow orbit and run
  `scripts/video-to-frames.sh <video> [outdir] [fps]` (ffmpeg, tested). It
  auto-picks fps to land ~110 frames, warns outside 40–150, downscales
  >3840px once so LichtFeld doesn't rescale on every load, and writes
  `frame_%04d.jpg` at `-q:v 2`. Fixed-rate on purpose: COLMAP wants evenly
  spaced overlap, whereas scene detection thins out exactly the slow dense
  passes that reconstruct best. Side benefit: one camera = one set of
  intrinsics, which COLMAP prefers over a mixed photo set.
  **Shooting tips that decide success**: move slowly (motion blur is the #1
  failure mode for video-derived splats), keep good light, lock exposure and
  focus if the phone allows, and **turn OFF electronic stabilisation** — EIS
  warps and crops per frame, which breaks the single-camera-model assumption.
  If COLMAP registers only a fraction of the frames, suspect blur first.
- **PHOTO DATA + PLAN (user call 2026-07-20 ~01:40 UTC): test with the 6–7
  views FIRST; user will shoot 40–150 only if that fails.** `photos-inbox/`
  at repo root (gitignored) holds `Location-1/` (6 JPEGs, 5712×4284) and
  `Location-2/` (7 JPEGs, 1024×768). Use **Location-2 first** (7 views, and
  1024×768 needs no pre-resize). Expectation to set honestly: 6–7 views will
  very likely NOT yield a clean walkable scene — COLMAP may fail to register
  them all into one model — but the run still earns its keep by exercising
  COLMAP → train → `convert` → viewer end to end, so a bigger set later is a
  data swap rather than a debugging session. Pre-resize Location-1 before
  training (max 4096px, `--max-width` default 3840).
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
