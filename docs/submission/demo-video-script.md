# Product demo video script — ~1 minute

Pure product walkthrough. No pitch, no problem statement — the pitch video does
that. This one proves it works.

**Format:** screen recording of https://wedding-ai-omega.vercel.app with
voiceover. Desktop, full screen, 1280px+ wide.

**Before recording:**
- Reseed the gallery if empty: `scripts/seed-demo-jobs.sh`
- **Confirm "Visualize theme" works** — it was quota-blocked until billing was
  enabled and has not been re-tested. If it still fails, cut beat 4 rather than
  recording a failure.
- Have a short venue video (45–90s) or a folder of venue photos ready.
- Close notification banners, hide bookmarks, use a clean browser profile.

---

## 0:00–0:10 — Capture

> "This is WeddingAI. I'm starting with a video I shot walking around an empty
> venue."

*Drag the video onto the dropzone. Let the frame-extraction progress bar run
visibly — "extracting frames, 68 of 110".*

> "It's pulling evenly spaced frames out of the video right here in the browser —
> that's what the 3D reconstruction needs, and nobody's going to shoot a hundred
> photos by hand."

## 0:10–0:30 — Gemini theme design

*Click "✦ Or let Gemini design from my photos".*

> "Now Gemini looks at the actual room and designs a wedding theme for it."

*Let the report render. Move the cursor across the palette swatches.*

> "That's a structured response — a real palette with hex values, decor,
> florals, and what Gemini noticed about this specific space. It even tells you
> whether your footage is good enough to reconstruct in 3D."

## 0:30–0:45 — Gemini restyling

*Click "Visualize theme".*

> "And this is the same room, restyled for that theme. Not a stock photo —
> the venue I just filmed."

**Hold on the render for two full seconds.**

## 0:45–1:00 — Pipeline and Studio

*Click "Create memory", let the stepper advance a beat, then open a finished
memory from the gallery.*

> "Creating the memory runs it through the reconstruction pipeline — aligning,
> training, exporting — and opens the scene."

*Click "✦ Reimagine in Studio".*

> "And Studio restyles the whole set in a different mood, whenever you change
> your mind."

---

## Honesty note

If you narrate the viewer, say "opens the scene" — **not** "walk through your
venue in 3D". The deployed app returns a placeholder scene; the real
reconstruction isn't wired up yet. The README states this, and the video
shouldn't contradict it. Judges forgive a labelled gap; they don't forgive
discovering an unlabelled one.
