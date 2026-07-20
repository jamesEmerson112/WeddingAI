# Screenshot shot list

For the submission form and the README. **Desktop only** — this prototype is
built for a laptop-projected demo, so shoot at 1280–1440px wide and don't bother
with mobile.

Save to `docs/submission/screenshots/` as `NN-name.png` so they order naturally.

**Before shooting:** reseed the gallery (`scripts/seed-demo-jobs.sh`), use a
clean browser profile with no extensions or bookmark bar, and take everything at
the same window size so the set looks consistent.

---

## The five that matter

**01-theme-report.png — the single most important image**
Upload screen with a Gemini-designed theme report open: palette swatches with
hex values visible, decor and florals lists, and the "powered by Google Gemini"
disclosure in frame. This is the one that proves the structured-output
integration at a glance. If only one screenshot is used anywhere, use this.

**02-restyled-render.png**
The "Visualize theme" result — the venue photo restyled. Ideally framed so the
source photo and the render are both visible for a before/after read.
*(Requires `/api/render` to be working — confirm first.)*

**03-video-extraction.png**
The dropzone mid-extraction, with the progress row reading something like
"extracting frames… 68/110" and thumbnails filling in. This is the
differentiator most people won't expect.

**04-memories-gallery.png**
The Memories grid with several finished scenes. Shows the product is a real
app with state, not a single-screen toy.

**05-studio.png**
Studio mid-run: mood chips, the editable prompt, and restyled results appearing
in the grid with progress.

## Optional extras

**06-processing.png** — the vertical stepper partway through, showing the real
job state machine.

**07-viewer.png** — the viewer with its overlay chrome. Use with care: the
deployed scene is a placeholder, so don't caption it in a way that implies a
real reconstruction.

---

## Captions

Write captions that match the README's honest status. For the viewer shot in
particular: "Scene viewer (placeholder scene — reconstruction runs in mock mode
in the deployed app)" rather than anything implying a finished 3D capture.
