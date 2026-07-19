# TODO

## Gemini photo-analysis feature (deferred 2026-07-19)

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
  - [ ] Create `frontend/.env.example` (GEMINI_API_KEY=, NEXT_PUBLIC_API_URL=) and
        add a `!.env.example` negation to `frontend/.gitignore` (its `.env*` rule
        currently ignores example files too).
  - [ ] Set `GEMINI_API_KEY` in Vercel project env when deploying.
- [ ] Preloaded example photo set (spec §7: judges need a one-click demo; include a
      deliberately bad set that Gemini visibly rejects with advice).

## Other open items

- [ ] Decide the exact product angle — open decision at the bottom of
      `docs/hackathon-spec.md`. (Deployment DECIDED 2026-07-19: backend → Railway,
      frontend → Vercel.)
- [ ] Railway setup: deploy the Axum backend (Dockerfile or Nixpacks), attach a
      volume for the SQLite file (Railway's filesystem is ephemeral — without a
      volume the DB resets every redeploy), set `PORT` from Railway's injected
      value, then point Vercel's `NEXT_PUBLIC_API_URL` at the Railway URL.
- [ ] Restrict the permissive CORS in `backend/src/main.rs` before public deploy
      (allow the Vercel domain).
- [ ] First commit + push of the imported boilerplate (nothing committed yet).
