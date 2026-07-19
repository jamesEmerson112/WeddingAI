"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import JSZip from "jszip";
import { createUpload, putZip, createJob } from "@/lib/api";

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

  // Total size of the selected photos in megabytes, for the summary line.
  const totalMb = files.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024);

  // True while we are busy zipping/uploading/creating — disables the button.
  const busy = stage === "zipping" || stage === "uploading" || stage === "creating";

  // Keep only image files from a dropped or picked selection.
  function addFiles(list: FileList | null) {
    if (!list) return;
    const images = Array.from(list).filter((f) => f.type.startsWith("image/"));
    setFiles(images);
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
