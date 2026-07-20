# TODO

Ordered toward submission — see `docs/hackathon-spec.md` §9 (deliverables) and §12
(definition of done).

## 1. Gemini wedding-theme feature (SHIPPED 2026-07-19 ~20:25 UTC)

The hackathon's required Gemini capability. Product angle (user-decided):
**AI wedding-theme designer** — photos → structured theme report → walkable 3D
venue. Model pinned: `gemini-3.5-flash`.

- [x] `frontend/app/api/analyze/route.ts` — POST route handler (server-side, key
      never reaches the browser): JSON body of downscaled base64 photos, calls
      `gemini-3.5-flash` with system instruction + structured-output schema
      (theme name/one-liner/description, hex color palette, decor, florals, tags,
      venue observations, photo_coverage verdict good/usable/poor + advice).
- [x] Error handling per hackathon spec: missing input (400), unsupported file
      type (400), Gemini failure (502), timeout (504, 50s cap), malformed
      response (502). No stack traces or key material in responses.
- [x] Client-side downscale (`frontend/lib/theme.ts`): canvas → ~1024px JPEG
      q0.7, ≤8 photos sampled evenly across the set (Vercel 4.5MB body cap).
- [x] Demo cache: report stored in localStorage keyed by photo-set fingerprint —
      re-selecting the same set resolves instantly ("cached" badge); "Redesign"
      forces a fresh call.
- [x] Upload page integration: theme designer card on `frontend/app/page.tsx`
      with palette swatches, coverage verdict banner, and the visible "powered
      by Google Gemini" disclosure (spec §2).
- [x] Env plumbing: key in Vercel Production env AND `frontend/.env`
      (gitignored); `frontend/.env.example` created.
- [x] Live-call verification of `/api/analyze` (real image → real structured
      report on the public URL, ~20:52 UTC).
- [ ] **`/api/render` blocked on key tier**: free-tier key has no image-gen
      quota (429 `generate_content_free_tier`). Fix = billing upgrade or billed
      key swap; NO code change. Also blocks the image→3D pipeline run.
- [ ] (cut for time) Preloaded example photo set for one-click judging.

## 1.5 UI mockup implementation (BUILT ~21:55 UTC — push after the 2:30 demo)

Source: `WeddingAI-Prototype.html` (repo root). All five screens implemented,
build + lint green, smoke-tested on a local prod server.

- [x] Design tokens + fonts + AppShell nav (globals.css, layout.tsx,
      components/AppShell.tsx)
- [x] Upload "Create a memory": preset theme chips (lib/themes.ts, 6 authored
      themes) + Gemini design-from-photos path, photo thumbnails, session
      handoff to Studio
- [x] Processing "Rebuilding your day": vertical stepper + progress bar +
      shimmer preview panel
- [x] Memories gallery: card grid, deterministic titles/gradients (lib/memory.ts)
- [x] Viewer chrome: back/Share/orbit-hint overlays, ✦ Reimagine in Studio
- [x] Studio (/studio): scope one/all, mood chips, editable prompt, REAL
      sequential /api/render loop with progress + per-photo error tiles
- [x] Pushed (`d3ad453`) and validated by an ultracode fleet (15 raw findings,
      11 confirmed, all fixed in `bfa806d`). Vercel deploy verified live.
- [ ] **RESEED the demo jobs** — the push wiped Railway's DB, live count is 0.

## 1.6 Real 3D run (build DONE — now blocked only on running it)

- [x] **LichtFeld build SUCCEEDED** — `/workspace/dist/bin/run_lichtfeld.sh` on
      the persistent volume (see CLAUDE.md Phase 0 for the two root causes).
- [x] **Full pipeline PROVEN end to end on the RTX 5090** (2026-07-20, from the
      Location-1 test run): COLMAP → train → `convert` → `scene.html` (3.3 MB).
      Blackwell/sm_120 kernels JIT cleanly — the build's last untested
      assumption. Three runbook fixes committed in `f2057d0`:
      `--ImageReader.single_camera 1`, CPU matching (the GPU SIFT matcher
      core-dumps on this pod), and `--undistort` for phone lens distortion.
      Also: `convert` exits **134 even on success** — test for the file, not `$?`.
- [ ] Run it on real footage: video → frames → COLMAP → train → `convert` →
      scp down → `frontend/public/demo/scene.html`. **No backend work needed**:
      `poller.rs:51` hardcodes `{"scene_url":"/demo/scene.html"}`, so replacing
      that one static file makes every memory in the deployed app show the real
      scene.
- [ ] **TERMINATE THE POD** when done — still billing ~$1/hr.

### ⛔ THE DATA BLOCKER — uploads never reach the GPU

**Frames uploaded through the frontend are discarded on arrival.**
`backend/src/routes.rs:111-120` is explicit: *"Accept the uploaded bytes, log
how many there were, and throw them away. There is nowhere to actually store
the data."* The upload looks completely successful — frames extract, the job
walks to `done`, the viewer opens — but nothing is persisted and nothing is
handed to a worker.

This is why the 3D run is currently a **manual, out-of-band** process
(`scripts/video-to-frames.sh` → `scp` → pod) rather than something the product
does. Closing it needs three pieces, in this order:

1. **Storage** (1.7 Phase 2 below) — a Railway Bucket so `mock_upload` writes
   the zip somewhere instead of dropping it. Everything else depends on this;
   without it there is nothing for a worker to fetch.
2. **RunPod wiring** — `MOCK_MODE=false` plus `RUNPOD_API_KEY` and
   `RUNPOD_ENDPOINT_ID` on the Railway backend service (names already stubbed in
   `backend/.env.example`; the seam is `AppState::new` in `state.rs`, which is
   the single mock-vs-real switch). **USER provides these values** — they're the
   RunPod account key and the serverless endpoint id.
3. **The worker itself** — `worker/handler.py` is still a stub ending in
   `raise NotImplementedError`. It needs the real COLMAP → train → convert →
   upload body, using the corrected flags recorded in `docs/phase0-runbook.md`.

Note (2) alone does nothing: pointing the backend at RunPod without (1) just
means the worker is handed an upload key for bytes that were never stored, and
without (3) there is no endpoint to call. Sequence matters.

## 1.7 Storage: Postgres + volume (Phase 1 of 3 done)

- [x] Phase 1: SQLite → Postgres, verified against real Postgres 16 (`dcb8392`,
      UNPUSHED — pushing before Railway Postgres exists takes the backend down).
- [ ] **USER: provision Railway Postgres**, set backend `DATABASE_URL` to
      `${{Postgres.DATABASE_URL}}`, then push + reseed.
- [ ] Phase 2: persist the upload zip + the ≤8 downscaled photos; `photos`
      table; GET/POST photo routes. **Use a Railway BUCKET, not a volume** —
      S3-compatible, free egress, no 5 GB / no-replicas limits, and it matches
      the R2_* env stubs + presigning TODO the repo already has (see CLAUDE.md
      "STORAGE FOR IMAGE BYTES"). Needs `aws-sdk-s3` added to Cargo.toml.
- [ ] Phase 3: real gallery thumbnails (replacing the CSS gradient at
      `frontend/app/jobs/page.tsx:129`) + Studio loading any past memory.
- [x] Photo decision (user, ~01:40 UTC): **try the 6–7 views we already have
      first** (`photos-inbox/Location-2/`, 7 JPEGs @1024×768 — no pre-resize
      needed). Only if that fails does the user shoot a 40–150 set. Expect a
      poor/failed reconstruction at 7 views; the value is proving the pipeline
      end to end so a bigger set is a pure data swap.
- [x] **Capture strategy solved (user, ~02:00 UTC): shoot VIDEO, not photos.**
      `scripts/video-to-frames.sh <video> [outdir] [fps]` extracts evenly
      spaced frames with ffmpeg. Auto-picks fps to land ~110 frames, warns
      outside 40–150, downscales >3840px once (LichtFeld `--max-width`), writes
      `frame_%04d.jpg` at `-q:v 2`. Tested: auto-rate, explicit-rate,
      downscale (5760→3840 keeping aspect), and all four guard paths.
      Bonus over hand-shot photos: one camera = one set of intrinsics, which
      COLMAP prefers.
- [x] **Video upload works in the deployed product**: `frontend/lib/frames.ts`
      extracts ~110 frames in-browser (`<video>`+`<canvas>`) and feeds them to
      the existing JSZip → PUT → job path, so no backend/worker change was
      needed. Upload size is fine — `backend/src/routes.rs:34-37` already caps
      the mock sink at 500 MB and the PUT goes straight to Railway (never
      through Vercel's 4.5 MB serverless limit). Progress row + abort/supersede
      guards on `app/page.tsx`. Build + lint green.
- [x] `worker/Dockerfile` + `handler.py` step 2b: ffmpeg frame extraction
      documented for the GPU path (blueprint only — neither builds yet).
- [ ] **Smoke-test with a REAL phone video** (not yet done): drop it on `/`,
      measure extraction wall-time and zip size. If it's too slow to demo,
      lower `TARGET_FRAMES`/`MAX_WIDTH` in `frames.ts` — single constants.
      Also worth testing an HEVC clip to confirm the friendly error path.
- [ ] Shoot a 45–90s slow orbit of one room and run the pipeline on it.

## 1.8 THE INTENDED PRODUCT FLOW (user, 2026-07-20) — and what's missing

The flow the product is meant to have, in the user's words:

> upload videos → see the photos → edit/remove unused photos → ask Gemini to
> generate a photo with a theme for test → if not happy, choose a different
> theme; if happy, select all photos for re-generation

Measured against the build:

| Step | State |
|---|---|
| 1. Upload video | ✅ `lib/frames.ts` extracts ~110–150 frames in-browser |
| 2. See the photos | ⚠️ only 11 — `THUMB_LIMIT = 11` in `app/page.tsx`, the rest collapse into a `+N` tile |
| 3. Edit / remove unused photos | ❌ **NOT BUILT** — thumbnails are display-only |
| 4. Test-render one photo with a theme | ⚠️ built, but split across two screens |
| 5. Try a different theme | ✅ 6 presets (`lib/themes.ts`) + Gemini design |
| 6. Re-generate across all photos | ✅ Studio's "all" scope |

- [ ] **Step 3 is the gap, and step 2 blocks it** — you cannot curate what you
      cannot see. Needs: show every frame (virtualised or paged, 151 thumbnails
      is a lot of DOM), per-photo remove, select-all/none, and a running count.
      `applyImages()` in `app/page.tsx` is the seam — it already owns `files` +
      `thumbs`, so removal is a filter on both plus an `URL.revokeObjectURL`.
- [ ] **Curation also improves reconstruction.** Motion-blurred frames are the
      documented #1 cause of COLMAP registration failure, so letting a user drop
      bad frames helps the 3D path as much as the Gemini path. Worth a cheap
      automatic blur score (variance of Laplacian on the thumbnail canvas) to
      pre-flag likely-bad frames rather than making the user hunt for them.
- [ ] **Steps 4-6 are split across two screens**: the test render lives on the
      upload page, "re-generate all" lives in `/studio` after a job exists. The
      user's flow describes one continuous loop, so either move the test render
      into Studio or bring scope-all forward into upload.

## 2. First deploy dry-run (do IMMEDIATELY after the Gemini feature works locally)

Deployment is a hard submission requirement (spec §4.6, §9, §12) — dry-run it days
before the deadline, not hours. Locked targets: backend → Railway, frontend → Vercel.

- [x] Railway: backend LIVE at https://weddingai-production.up.railway.app
      (2026-07-19; Dockerfile build pinning rust:1.88, `GET /api/health` added,
      mock upload URL fixed to use the public domain). STILL TO DO: attach a
      volume (mount `/data`) + set `DATABASE_URL=sqlite:///data/data.db?mode=rwc`
      — until then the DB resets on every redeploy.
- [ ] Vercel: frontend deployed at https://wedding-ai-omega.vercel.app but env
      vars NOT set — set `NEXT_PUBLIC_API_URL` (the Railway URL above) and
      `GEMINI_API_KEY`, then redeploy (NEXT_PUBLIC_* is baked at build time;
      the live bundle currently has localhost:8080 in it).
- [ ] Restrict the permissive CORS in `backend/src/main.rs` to the Vercel domain.
- [ ] Verify the full flow on the public URL in an incognito browser (spec §12).
- [x] Auto-redeploy on `git push` confirmed working (Railway and Vercel).

## 3. Submission materials (spec §9) — WRITTEN, needs recording + links

All copy lives in `docs/submission/` (separate file per form field).

- [x] README fully rewritten per spec §10 — all nine required sections, plus an
      "Honest status" section stating that 3D reconstruction is mock in the
      deployed app. Every claim verified against code.
- [x] `pitch.txt` — product name + one-sentence pitch (spec §11 template).
- [x] `problem.txt` — problem statement + target user.
- [x] `gemini-usage.txt` — exactly where Gemini is used, with file paths.
- [x] `tech-stack.txt`, `business-potential.txt`, `team.txt`, `demo-links.txt`.
- [x] `pitch-video-script.md` (2 min, timed) + `demo-video-script.md` (~1 min).
- [x] `screenshot-shotlist.md` — which five screens to capture, and captions.
- [ ] **USER: record the two videos** and paste the URLs into `demo-links.txt`.
- [ ] **USER: capture screenshots** per the shot list → `docs/submission/screenshots/`.
- [ ] **USER: verify `/api/render` works** post-billing — it gates the best
      screenshot and a whole beat of the demo video, and is still untested.
- [ ] **USER: confirm the GitHub repo is public** (spec §12).
- [ ] Final check: all links tested in incognito (spec §12) — checklist is at
      the bottom of `demo-links.txt`.

## Open decisions

- [ ] Exact product angle (bottom of `docs/hackathon-spec.md`). Deployment decided:
      Railway + Vercel. Model decided: `gemini-3.5-flash`.

## Stretch (not required for submission)

- [ ] Real 3D pipeline: RunPod serverless worker (Phase 1 stub → real COLMAP +
      LichtFeld) + Cloudflare R2 artifacts. `RUNPOD_API_KEY` still to be added to
      `backend/.env`; R2 account/bucket/credentials not created yet.
