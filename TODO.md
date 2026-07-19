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
- [ ] Env plumbing:
  - [ ] Copy the key (manual, so it never transits tooling):
        `grep '^GEMINI_API_KEY=' backend/.env > frontend/.env.local`
  - [x] `frontend/.env.example` created (GEMINI_API_KEY=, NEXT_PUBLIC_API_URL=).
  - [ ] Set `GEMINI_API_KEY` in Vercel env vars (Production) — required for the
        deployed demo.
- [ ] Live-call verification (route error paths smoke-tested; a real Gemini call
      needs the key in `.env.local` / Vercel).
- [ ] (cut for time) Preloaded example photo set for one-click judging.

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
