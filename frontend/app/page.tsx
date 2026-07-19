"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import JSZip from "jszip";
import { createUpload, putZip, createJob } from "@/lib/api";
import { analyzePhotos, renderTheme, type ThemeReport } from "@/lib/theme";

// How many training iterations to request for a new job. 7000 is a reasonable
// default for a quick splat; the backend accepts this as the `iters` field.
const DEFAULT_ITERS = 7000;

// The Create button walks through these stages so the user sees progress.
type Stage = "idle" | "zipping" | "uploading" | "creating" | "error";

export default function UploadPage() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // Gemini wedding-theme designer state, separate from the splat flow above so
  // a failed analysis never blocks creating the 3D scene (and vice versa).
  const [report, setReport] = useState<ThemeReport | null>(null);
  const [themeBusy, setThemeBusy] = useState(false);
  const [themeCached, setThemeCached] = useState(false);
  const [themeError, setThemeError] = useState<string | null>(null);

  // Vision render state: Gemini's image model redraws the venue in the theme.
  const [renderImage, setRenderImage] = useState<string | null>(null);
  const [renderBusy, setRenderBusy] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  // Bumped whenever the photo selection changes. Async Gemini responses check
  // it before painting, so a slow reply for an old photo set can never land on
  // a new one. A ref (not state) because state reads inside the async closure
  // would be stale by resolve time.
  const requestSeq = useRef(0);

  // Total size of the selected photos in megabytes, for the summary line.
  const totalMb = files.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024);

  // True while we are busy zipping/uploading/creating — disables the button.
  const busy = stage === "zipping" || stage === "uploading" || stage === "creating";

  // Keep only image files from a dropped or picked selection.
  function addFiles(list: FileList | null) {
    if (!list) return;
    const images = Array.from(list).filter((f) => f.type.startsWith("image/"));
    setFiles(images);
    // New photo set → the old theme report and render no longer apply, and any
    // in-flight Gemini response for the old set must not paint over this one.
    requestSeq.current++;
    setReport(null);
    setThemeCached(false);
    setThemeError(null);
    setRenderImage(null);
    setRenderError(null);
  }

  // Ask Gemini (via our server route) for a theme designed around these photos.
  // Repeat clicks force a fresh take; the same set re-selected later hits the
  // localStorage cache inside analyzePhotos and resolves instantly.
  async function designTheme() {
    if (files.length === 0 || themeBusy) return;
    const myReq = requestSeq.current;
    setThemeError(null);
    setThemeBusy(true);
    try {
      const result = await analyzePhotos(files, { force: report !== null });
      if (requestSeq.current !== myReq) return; // photo set changed mid-flight
      setReport(result.report);
      setThemeCached(result.cached);
      // A new theme invalidates any previous render of the old one.
      setRenderImage(null);
      setRenderError(null);
    } catch (e) {
      if (requestSeq.current !== myReq) return;
      setThemeError(e instanceof Error ? e.message : String(e));
    } finally {
      setThemeBusy(false);
    }
  }

  // Ask Gemini's image model for a concept render of THIS venue in the theme.
  async function visualizeTheme() {
    if (!report || files.length === 0 || renderBusy) return;
    const myReq = requestSeq.current;
    setRenderError(null);
    setRenderBusy(true);
    try {
      const image = await renderTheme(files, report);
      if (requestSeq.current !== myReq) return; // photo set changed mid-flight
      setRenderImage(image);
    } catch (e) {
      if (requestSeq.current !== myReq) return;
      setRenderError(e instanceof Error ? e.message : String(e));
    } finally {
      setRenderBusy(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }

  // The full upload flow: zip in the browser -> get an upload slot -> PUT the
  // zip -> create a job -> navigate to that job's status page.
  async function createSplat() {
    if (files.length === 0 || busy) return;
    setError(null);
    try {
      // 1. Zip the selected photos client-side.
      setStage("zipping");
      const zip = new JSZip();
      for (const file of files) zip.file(file.name, file);
      const blob = await zip.generateAsync({ type: "blob" });

      // 2. Ask the backend where to upload, then PUT the zip there.
      setStage("uploading");
      const { upload_key, upload_url } = await createUpload();
      await putZip(upload_url, blob);

      // 3. Create the job and jump to its live status page.
      setStage("creating");
      const job = await createJob(upload_key, DEFAULT_ITERS);
      router.push(`/jobs/${job.id}`);
    } catch (e) {
      setStage("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Button label reflects the current stage.
  const buttonLabel =
    stage === "zipping"
      ? "Zipping photos…"
      : stage === "uploading"
        ? "Uploading…"
        : stage === "creating"
          ? "Creating job…"
          : "Create Splat";

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold">Create a splat</h1>
      <p className="mt-1 text-sm text-zinc-500">
        40–150 photos of one place, good overlap
      </p>

      {/*
        The whole drop zone is a <label> wrapping a hidden file input, so a
        click anywhere opens the file picker (accessible, no manual handlers)
        while the drag handlers cover drag-and-drop.
      */}
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`mt-6 block cursor-pointer rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
          dragging
            ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
            : "border-zinc-300 dark:border-zinc-700"
        }`}
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Drag photos here, or{" "}
          <span className="font-medium text-blue-600">browse</span>
        </p>
        <input
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
      </label>

      {/* Selected-files summary + scrollable list. */}
      {files.length > 0 && (
        <div className="mt-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {files.length} photo{files.length === 1 ? "" : "s"} ·{" "}
            {totalMb.toFixed(1)} MB
          </p>
          <ul className="mt-2 max-h-48 divide-y divide-zinc-100 overflow-y-auto rounded-md border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
            {files.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="flex justify-between px-3 py-1.5"
              >
                <span className="truncate">{f.name}</span>
                <span className="ml-3 shrink-0 text-zinc-400">
                  {(f.size / (1024 * 1024)).toFixed(1)} MB
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Gemini wedding-theme designer: the AI step between photos and splat. */}
      {files.length > 0 && (
        <div className="mt-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Wedding theme designer</h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                Gemini studies your venue photos and designs a theme for the
                space before the 3D scene is built.
              </p>
            </div>
            <button
              onClick={designTheme}
              disabled={themeBusy}
              className="shrink-0 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {themeBusy ? "Designing…" : report ? "Redesign" : "Design theme"}
            </button>
          </div>

          {themeError && (
            <div className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {themeError}
            </div>
          )}

          {report && (
            <div className="mt-4 space-y-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold">{report.theme_name}</h3>
                  {themeCached && (
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800">
                      cached
                    </span>
                  )}
                </div>
                <p className="text-sm text-zinc-500 italic">{report.one_liner}</p>
              </div>

              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {report.description}
              </p>

              <div className="flex flex-wrap gap-2">
                {report.color_palette.map((c) => (
                  <span
                    key={`${c.hex}-${c.name}`}
                    className="flex items-center gap-1.5 rounded-full border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-800"
                  >
                    <span
                      className="h-3 w-3 rounded-full border border-black/10"
                      style={{ backgroundColor: c.hex }}
                    />
                    {c.name}
                  </span>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <h4 className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">
                    Decor
                  </h4>
                  <ul className="mt-1 list-disc pl-4 text-sm text-zinc-600 dark:text-zinc-400">
                    {report.decor.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">
                    Florals
                  </h4>
                  <ul className="mt-1 list-disc pl-4 text-sm text-zinc-600 dark:text-zinc-400">
                    {report.florals.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                <span className="font-medium">In your photos: </span>
                {report.venue_observations}
              </p>

              {/* Coverage verdict doubles as splat-quality advice. */}
              <div
                className={`rounded-md border px-3 py-2 text-xs ${
                  report.photo_coverage.verdict === "good"
                    ? "border-green-300 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300"
                    : report.photo_coverage.verdict === "usable"
                      ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
                      : "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                }`}
              >
                Photo set for 3D: <span className="font-semibold">{report.photo_coverage.verdict}</span>
                {" — "}
                {report.photo_coverage.advice}
              </div>

              <div className="flex flex-wrap gap-1.5">
                {report.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                  >
                    #{t}
                  </span>
                ))}
              </div>

              {/* Vision render: Gemini redraws the venue decorated in the theme. */}
              <div>
                <button
                  onClick={visualizeTheme}
                  disabled={renderBusy}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                >
                  {renderBusy
                    ? "Rendering…"
                    : renderImage
                      ? "Re-render"
                      : "Visualize theme"}
                </button>
                {renderError && (
                  <div className="mt-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                    {renderError}
                  </div>
                )}
                {renderImage && (
                  <figure className="mt-3">
                    {/* Data URL from our own API — next/image can't optimize it. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={renderImage}
                      alt={`AI concept render of the venue in the "${report.theme_name}" theme`}
                      className="w-full rounded-md border border-zinc-200 dark:border-zinc-800"
                    />
                    <figcaption className="mt-1 text-[11px] text-zinc-400">
                      AI concept render — Gemini reimagines your venue in this
                      theme.
                    </figcaption>
                  </figure>
                )}
              </div>
            </div>
          )}

          {/* Spec §2: disclose what Gemini does, visibly. */}
          <p className="mt-3 text-[11px] text-zinc-400">
            Theme design &amp; photo check powered by Google Gemini. A downscaled
            sample of your photos is analyzed server-side and not stored.
          </p>
        </div>
      )}

      {/* Error banner shown if any step of the flow fails. */}
      {error && (
        <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      <button
        onClick={createSplat}
        disabled={files.length === 0 || busy}
        className="mt-6 w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {buttonLabel}
      </button>
    </main>
  );
}
