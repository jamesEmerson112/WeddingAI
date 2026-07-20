"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import JSZip from "jszip";
import { createUpload, putZip, createJob } from "@/lib/api";
import {
  analyzePhotos,
  downscaleSet,
  saveSessionScene,
  type ThemeReport,
} from "@/lib/theme";
import { PRESET_THEMES } from "@/lib/themes";
import { saveMemoryMeta } from "@/lib/memory";
import { extractFrames, isVideoFile } from "@/lib/frames";

// How many training iterations to request for a new job. 7000 is a reasonable
// default for a quick splat; the backend accepts this as the `iters` field.
const DEFAULT_ITERS = 7000;

// The Create button walks through these stages so the user sees progress.
type Stage = "idle" | "zipping" | "uploading" | "creating" | "error";

// The chosen theme, whether picked from the presets or designed by Gemini
// from the photos — both shapes are a full ThemeReport.
type Selection = { source: "preset" | "gemini"; report: ThemeReport };

// How many photo thumbnails to show before collapsing into a "+N" tile.
const THUMB_LIMIT = 11;

export default function UploadPage() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const [selection, setSelection] = useState<Selection | null>(null);
  const [themeBusy, setThemeBusy] = useState(false);
  const [themeCached, setThemeCached] = useState(false);
  const [themeError, setThemeError] = useState<string | null>(null);

  // Bumped whenever the photo selection (or an explicit theme pick) changes.
  // Async Gemini responses check it before painting, so a slow reply for an
  // old request can never land on a new one. A ref (not state) because state
  // reads inside the async closure would be stale by resolve time.
  const requestSeq = useRef(0);

  // Object URLs for the thumbnail grid. Minted in the event handler that
  // changes the photo set — not in a memo, whose factory Strict Mode
  // double-invokes, orphaning a batch of blob URLs nothing can revoke.
  const [thumbs, setThumbs] = useState<string[]>([]);
  useEffect(() => {
    return () => thumbs.forEach((u) => URL.revokeObjectURL(u));
  }, [thumbs]);

  // Video → frames progress, null when no extraction is running.
  const [extracting, setExtracting] = useState<{ done: number; total: number } | null>(
    null,
  );
  const extractAbort = useRef<AbortController | null>(null);
  // Decoding a whole video is long-running; don't leave it decoding into a
  // canvas that no longer has a page.
  useEffect(() => () => extractAbort.current?.abort(), []);

  const totalMb = files.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024);
  const busy =
    stage === "zipping" ||
    stage === "uploading" ||
    stage === "creating" ||
    extracting !== null;
  const goodOverlap = files.length >= 24;

  // Adopt a new photo set. The [thumbs] effect above revokes the previous
  // batch's object URLs when this replaces them, so there's nothing to free
  // here.
  function applyImages(images: File[]) {
    setFiles(images);
    setThumbs(images.slice(0, THUMB_LIMIT).map((f) => URL.createObjectURL(f)));
  }

  // Accept either a photo set or a single walkthrough video — a video is
  // decoded to evenly spaced frames here, then travels the identical path
  // (zip → upload → job), so nothing downstream knows the difference.
  //
  // Ignored while a memory is being created: that flow captured the old set,
  // so swapping the visible photos now would show a set the job isn't using.
  async function addFiles(list: FileList | null) {
    if (!list || busy) return;
    const picked = Array.from(list);

    // Own this generation so a second drop supersedes a slow extraction.
    const myReq = ++requestSeq.current;
    setThemeError(null);
    setThemeCached(false);
    setError(null);
    // A preset theme survives a photo swap; a Gemini-designed one was about
    // THOSE photos and no longer applies.
    setSelection((sel) => (sel?.source === "gemini" ? null : sel));

    const video = picked.find(isVideoFile);
    if (!video) {
      applyImages(picked.filter((f) => f.type.startsWith("image/")));
      return;
    }

    extractAbort.current?.abort();
    const controller = new AbortController();
    extractAbort.current = controller;

    applyImages([]);
    setExtracting({ done: 0, total: 0 });
    try {
      const frames = await extractFrames(video, {
        signal: controller.signal,
        onProgress: (done, total) => {
          if (requestSeq.current === myReq) setExtracting({ done, total });
        },
      });
      if (requestSeq.current !== myReq) return;
      applyImages(frames);
    } catch (e) {
      // A supersede or unmount aborts on purpose — not worth an error banner.
      if (requestSeq.current !== myReq || (e as Error)?.name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (requestSeq.current === myReq) setExtracting(null);
    }
  }

  function pickPreset(report: ThemeReport) {
    // Invalidate any in-flight photo analysis so it can't overwrite this pick.
    requestSeq.current++;
    setThemeBusy(false);
    setThemeError(null);
    setThemeCached(false);
    setSelection({ source: "preset", report });
  }

  // Ask Gemini (via our server route) for a theme designed around these photos.
  // Repeat clicks force a fresh take; the same set re-selected later hits the
  // localStorage cache inside analyzePhotos and resolves instantly.
  async function designTheme() {
    if (files.length === 0 || themeBusy) return;
    // Own the generation (like Studio's generate) so two overlapping analyses
    // can never share one and both paint.
    const myReq = ++requestSeq.current;
    setThemeError(null);
    setThemeBusy(true);
    try {
      const result = await analyzePhotos(files, {
        force: selection?.source === "gemini",
      });
      if (requestSeq.current !== myReq) return; // photos/theme changed mid-flight
      setSelection({ source: "gemini", report: result.report });
      setThemeCached(result.cached);
    } catch (e) {
      if (requestSeq.current !== myReq) return;
      setThemeError(e instanceof Error ? e.message : String(e));
    } finally {
      // A superseded call must not clear a newer call's busy flag.
      if (requestSeq.current === myReq) setThemeBusy(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }

  // The full flow: zip in the browser -> get an upload slot -> PUT the zip ->
  // create a job -> hand the photos + theme to Studio -> the job's status page.
  async function createMemory() {
    if (files.length === 0 || busy) return;
    setError(null);
    try {
      // Downscale the sampled set in parallel with zipping — Studio needs it.
      const scenePromise = downscaleSet(files);

      setStage("zipping");
      const zip = new JSZip();
      for (const file of files) zip.file(file.name, file);
      const blob = await zip.generateAsync({ type: "blob" });

      setStage("uploading");
      const { upload_key, upload_url } = await createUpload();
      await putZip(upload_url, blob);

      setStage("creating");
      const job = await createJob(upload_key, DEFAULT_ITERS);

      // Hand this memory's photos to Studio, keyed by job id so Studio can
      // tell whose photos it holds. Records whether the handoff fit in
      // storage, so Studio can explain itself instead of looking empty.
      const stored = saveSessionScene(job.id, {
        photos: await scenePromise,
        report: selection?.report ?? null,
      });

      // Client-side metadata so the gallery and Studio know this memory.
      saveMemoryMeta(job.id, {
        themeName: selection?.report.theme_name,
        photoCount: files.length,
        studioReady: stored,
      });

      router.push(`/jobs/${job.id}`);
    } catch (e) {
      setStage("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const buttonLabel = extracting
    ? "Extracting frames…"
    : stage === "zipping"
      ? "Zipping photos…"
      : stage === "uploading"
        ? "Uploading…"
        : stage === "creating"
          ? "Creating your memory…"
          : "Create memory  →";

  const report = selection?.report ?? null;

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-12">
      <div className="mb-8">
        <div className="mb-3 text-xs font-semibold tracking-[0.14em] text-terra uppercase">
          New memory
        </div>
        <h1 className="font-serif text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
          Create a memory
        </h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-taupe">
          Add your photos — or just walk the room with your camera rolling —
          pick the vibe of your day, and we&rsquo;ll rebuild it as a 3D space,
          styled to a palette that matches your theme.
        </p>
      </div>

      <div className="grid items-start gap-7 lg:grid-cols-2">
        {/* ---- 1 · Your photos ---- */}
        <section className="rounded-2xl border border-ink/10 bg-paper p-6 shadow-[0_18px_40px_-28px_rgba(40,25,20,0.42)]">
          <div className="mb-3 text-xs font-semibold tracking-[0.08em] text-mocha uppercase">
            1 · Your photos
          </div>

          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`block cursor-pointer rounded-xl border-2 border-dashed p-7 text-center transition-colors ${
              dragging ? "border-terra bg-blush" : "border-dune bg-card"
            }`}
          >
            <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-blush text-xl">
              ✧
            </div>
            <div className="text-[15px] font-medium text-ink">
              Drag your photos or a video here, or{" "}
              <span className="font-semibold text-terra underline">browse</span>
            </div>
            <div className="mt-1 text-xs text-fawn">
              40–150 photos of one place — or a 45–90s slow orbit video
            </div>
            <input
              type="file"
              multiple
              accept="image/*,video/*"
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
          </label>

          {/* Video → frames. Decoding is the slow part, so show real counts. */}
          {extracting && (
            <div className="mt-4 rounded-xl border border-ink/10 bg-card px-4 py-3">
              <div className="flex items-center justify-between text-[13px] font-medium text-clay">
                <span className="flex items-center gap-2">
                  <span className="size-[7px] animate-pulse-dot rounded-full bg-terra" />
                  Extracting frames from your video…
                </span>
                <span className="font-mono text-xs text-fawn">
                  {extracting.total ? `${extracting.done}/${extracting.total}` : "reading…"}
                </span>
              </div>
              <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-ink/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#c98f86] to-terra transition-[width] duration-300 ease-out"
                  style={{
                    width: extracting.total
                      ? `${(extracting.done / extracting.total) * 100}%`
                      : "0%",
                  }}
                />
              </div>
            </div>
          )}

          {files.length > 0 && (
            <>
              <div className="mt-4 mb-3 flex items-center justify-between px-0.5">
                <div className="text-[13px] font-medium text-taupe">
                  {files.length} photo{files.length === 1 ? "" : "s"} ·{" "}
                  {totalMb.toFixed(0)} MB
                </div>
                <div
                  className={`flex items-center gap-1.5 text-xs font-medium ${
                    goodOverlap ? "text-sage" : "text-fawn"
                  }`}
                >
                  <span
                    className={`size-[7px] rounded-full ${
                      goodOverlap ? "bg-sage" : "bg-fawn"
                    }`}
                  />
                  {goodOverlap ? "Good overlap" : "More angles help"}
                </div>
              </div>
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                {thumbs.map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={src}
                    src={src}
                    alt={`Photo ${i + 1}`}
                    className="aspect-square rounded-md object-cover"
                  />
                ))}
                {files.length > THUMB_LIMIT && (
                  <div className="flex aspect-square items-center justify-center rounded-md bg-ink/5 text-xs font-medium text-fawn">
                    +{files.length - THUMB_LIMIT}
                  </div>
                )}
              </div>
            </>
          )}
        </section>

        {/* ---- 2 · Your theme ---- */}
        <section className="rounded-2xl border border-ink/10 bg-paper p-6 shadow-[0_18px_40px_-28px_rgba(40,25,20,0.42)]">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold tracking-[0.08em] text-mocha uppercase">
              2 · Your theme
            </span>
            <span className="rounded-full bg-blush px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.05em] text-terra uppercase">
              Gemini
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            {PRESET_THEMES.map((p) => {
              const active =
                selection?.source === "preset" &&
                selection.report.theme_name === p.report.theme_name;
              return (
                <button
                  key={p.key}
                  onClick={() => pickPreset(p.report)}
                  className={`rounded-full border px-3.5 py-2 text-[12.5px] transition-colors ${
                    active
                      ? "border-terra bg-terra font-semibold text-white"
                      : "border-ink/15 bg-white text-clay hover:border-terra hover:bg-[#fbf3ec]"
                  }`}
                >
                  {p.emoji} {p.report.theme_name}
                </button>
              );
            })}
          </div>

          {/* The spec-required structured-output path: Gemini designs a theme
              from the photos themselves. */}
          <div className="mt-4 flex items-center gap-2.5">
            <button
              onClick={designTheme}
              disabled={files.length === 0 || themeBusy}
              className="rounded-lg border border-ink/15 bg-white px-3.5 py-2 text-[12.5px] font-semibold text-clay transition-colors hover:border-terra hover:bg-[#fbf3ec] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {themeBusy
                ? "Designing…"
                : selection?.source === "gemini"
                  ? "✦ Redesign from my photos"
                  : "✦ Or let Gemini design from my photos"}
            </button>
            {themeCached && selection?.source === "gemini" && (
              <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[10px] font-medium text-fawn">
                cached
              </span>
            )}
          </div>

          {themeError && (
            <div className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
              {themeError}
            </div>
          )}

          {report && (
            <div className="mt-5 space-y-4">
              <div>
                <div className="font-serif text-2xl font-semibold text-ink">
                  {report.theme_name}
                </div>
                <p className="text-sm text-taupe italic">{report.one_liner}</p>
              </div>

              <div className="flex gap-2">
                {report.color_palette.map((c) => (
                  <div key={`${c.hex}-${c.name}`} className="flex-1 text-center">
                    <div
                      className="h-10 rounded-lg border border-ink/10"
                      style={{ backgroundColor: c.hex }}
                    />
                    <div className="mt-1 font-mono text-[9px] font-medium text-fawn">
                      {c.hex.toUpperCase()}
                    </div>
                  </div>
                ))}
              </div>

              {selection?.source === "gemini" && (
                <>
                  <p className="text-sm leading-relaxed text-taupe">
                    {report.description}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <h4 className="text-[11px] font-semibold tracking-wide text-mocha uppercase">
                        Decor
                      </h4>
                      <ul className="mt-1 list-disc pl-4 text-sm text-taupe">
                        {report.decor.map((d) => (
                          <li key={d}>{d}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h4 className="text-[11px] font-semibold tracking-wide text-mocha uppercase">
                        Florals
                      </h4>
                      <ul className="mt-1 list-disc pl-4 text-sm text-taupe">
                        {report.florals.map((f) => (
                          <li key={f}>{f}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  {report.venue_observations && (
                    <p className="text-sm text-taupe">
                      <span className="font-medium text-ink">
                        In your photos:{" "}
                      </span>
                      {report.venue_observations}
                    </p>
                  )}
                  {/* Coverage verdict doubles as splat-quality advice. */}
                  {report.photo_coverage.advice && (
                    <div
                      className={`rounded-lg border px-3 py-2 text-xs ${
                        report.photo_coverage.verdict === "good"
                          ? "border-sage-soft bg-sage-wash text-sage-ink"
                          : report.photo_coverage.verdict === "usable"
                            ? "border-amber-300 bg-amber-wash text-amber-ink"
                            : "border-red-300 bg-red-50 text-red-700"
                      }`}
                    >
                      Photo set for 3D:{" "}
                      <span className="font-semibold">
                        {report.photo_coverage.verdict}
                      </span>
                      {" — "}
                      {report.photo_coverage.advice}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {report.tags.map((t) => (
                      <span
                        key={t}
                        className="rounded bg-blush px-2 py-0.5 text-xs text-terra"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                </>
              )}

              <p className="text-[11.5px] text-fawn">
                ✦ We&rsquo;ll style your 3D scene and Studio edits to this
                palette. You can fine-tune it anytime.
              </p>
            </div>
          )}

          {/* Spec §2: disclose what Gemini does, visibly. */}
          <p className="mt-4 text-[11px] text-fawn">
            Theme design &amp; photo check powered by Google Gemini. A downscaled
            sample of your photos is analyzed server-side and not stored.
          </p>
        </section>
      </div>

      {error && (
        <div className="mt-5 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        onClick={createMemory}
        disabled={files.length === 0 || busy}
        className="mt-7 w-full rounded-xl bg-terra px-4 py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-terra-dark disabled:cursor-not-allowed disabled:opacity-50"
      >
        {buttonLabel}
      </button>
    </main>
  );
}
