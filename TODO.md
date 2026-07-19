# TODO

Ordered toward submission — see `docs/hackathon-spec.md` §9 (deliverables) and §12
(definition of done).

## 1. Gemini photo-analysis feature (deferred 2026-07-19)

The hackathon's required Gemini capability. Design agreed, implementation not started.
Model is pinned: `gemini-3.5-flash` (see CLAUDE.md). SDK `@google/genai` is already
installed in `frontend/`.

- [ ] `frontend/app/api/analyze/route.ts` — POST route handler (server-side, key never
      reaches the browser): accepts photos as multipart form data, calls
      `gemini-3.5-flash` with a system instruction + structured-output JSON schema
      (verdict good/usable/poor, score, per-issue list with severity — blur / low
      overlap / reflective / textureless / exposure, reshoot advice, scene
      title/description/tags for the gallery).
- [ ] Error handling per hackathon spec: missing input (400), unsupported file type
      (400), Gemini failure (502), timeout (504), malformed/unparseable response
      (502 with graceful fallback). No stack traces or key material in responses.
- [ ] Client-side downscale before upload (canvas → ~1024px JPEG): Gemini inline
      request limit is ~20 MB total, so raw phone photos won't fit — resize in the
      browser, then send up to ~24 sampled photos.
- [ ] Upload page (`frontend/app/page.tsx`) integration: "Check photos" step before
      "Create Splat", result card showing the report, visible "Photo check powered
      by Gemini" disclosure (spec §2 requires disclosing what Gemini does).
- [ ] Env plumbing:
  - [ ] Copy the key (manual, so it never transits tooling):
        `grep '^GEMINI_API_KEY=' backend/.env > frontend/.env.local`
  - [ ] Create `frontend/.env.example` (GEMINI_API_KEY=, NEXT_PUBLIC_API_URL=) —
        the `!.env.example` gitignore negation is already in place.
- [ ] Preloaded example photo set (spec §7: judges need a one-click demo; include a
      deliberately bad set that Gemini visibly rejects with advice).

## 2. First deploy dry-run (do IMMEDIATELY after the Gemini feature works locally)

Deployment is a hard submission requirement (spec §4.6, §9, §12) — dry-run it days
before the deadline, not hours. Locked targets: backend → Railway, frontend → Vercel.

- [ ] Railway: deploy the Axum backend (Dockerfile or Nixpacks), attach a volume
      for the SQLite file (Railway's filesystem is ephemeral — without a volume the
      DB resets every redeploy), respect Railway's injected `PORT`.
- [ ] Vercel: deploy `frontend/`, set `GEMINI_API_KEY` and `NEXT_PUBLIC_API_URL`
      (the Railway URL) in project env vars.
- [ ] Restrict the permissive CORS in `backend/src/main.rs` to the Vercel domain.
- [ ] Verify the full flow on the public URL in an incognito browser (spec §12).
- [ ] After the dry-run, every `git push` auto-redeploys both — no further work.

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
