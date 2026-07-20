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

## 1.6 Real 3D run (BLOCKED on photo data)

- [ ] Pod is doing a clean LichtFeld rebuild (see CLAUDE.md Phase 0). Once
      `dist/bin/run_lichtfeld.sh` exists: COLMAP → train → `convert` to
      scene.html → scp down → `frontend/public/` + point a job's
      artifacts_json at it.
- [ ] **Need a proper photo set**: `photos-inbox/` has only 6 + 7 photos of
      two locations; a splat needs 40–150 views of ONE place with overlap.

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

## 3. Submission materials (spec §9 — prepare before the form appears)

- [ ] README restructure per spec §10 (product overview, problem, solution, Gemini
      integration note, architecture, setup, env var names, deployment, demo link).
- [ ] Product name + one-sentence pitch (template in spec §11).
- [ ] Problem statement + target user.
- [ ] Explanation of exactly where Gemini is used.
- [ ] Two-minute pitch video + ~one-minute product demo video.
- [ ] Screenshots of the finished product.
- [ ] Business-potential blurb; team info (solo submission).
- [ ] Final check: all links tested in incognito (spec §12).

## Open decisions

- [ ] Exact product angle (bottom of `docs/hackathon-spec.md`). Deployment decided:
      Railway + Vercel. Model decided: `gemini-3.5-flash`.

## Stretch (not required for submission)

- [ ] Real 3D pipeline: RunPod serverless worker (Phase 1 stub → real COLMAP +
      LichtFeld) + Cloudflare R2 artifacts. `RUNPOD_API_KEY` still to be added to
      `backend/.env`; R2 account/bucket/credentials not created yet.
