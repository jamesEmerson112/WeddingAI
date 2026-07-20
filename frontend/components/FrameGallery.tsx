"use client";

import { useEffect, useState } from "react";

type FrameGalleryProps = {
  /** Already-minted object URLs. Index-aligned with `timestamps`. This
   * component owns none of their lifecycle — it never calls
   * createObjectURL/revokeObjectURL, that stays the caller's job. */
  urls: string[];
  /** Seconds into the source video, index-aligned with `urls`; null when the
   * current photo set isn't video-derived (e.g. a dropped photo set or a
   * sample set). */
  timestamps: number[] | null;
};

function formatTime(s: number): string {
  const total = Math.max(0, Math.round(s));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * Scrollable grid of every extracted frame plus a click-to-open lightbox with
 * keyboard navigation. Purely presentational: all it owns is which index (if
 * any) is open.
 */
export default function FrameGallery({ urls, timestamps }: FrameGalleryProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  // Reset the open frame whenever the urls array is replaced wholesale (a new
  // video/photo set), so a stale index can't reopen over a frame the user
  // never clicked. Adjust-state-during-render is safe here: plain integer
  // state, no side effect, and Strict Mode's replay is inert.
  const [prevUrls, setPrevUrls] = useState(urls);
  if (urls !== prevUrls) {
    setPrevUrls(urls);
    setOpenIndex(null);
  }

  // Clamp rather than trust the stored index — a shrunk or replaced `urls`
  // (even one with the same identity check bypassed, belt-and-suspenders)
  // can't point the lightbox at a frame that no longer exists.
  const safeOpen = openIndex !== null && openIndex < urls.length ? openIndex : null;

  // Keyboard nav for the lightbox — the one legitimate effect here: it
  // subscribes to an external system (the window) and calls setState only
  // inside the listener callback, which the set-state-in-effect rule permits.
  useEffect(() => {
    if (safeOpen === null) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenIndex(null);
      if (e.key === "ArrowRight") {
        setOpenIndex((i) => (i === null ? i : Math.min(i + 1, urls.length - 1)));
      }
      if (e.key === "ArrowLeft") {
        setOpenIndex((i) => (i === null ? i : Math.max(i - 1, 0)));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [safeOpen, urls.length]);

  if (urls.length === 0) return null;

  const hasPrev = safeOpen !== null && safeOpen > 0;
  const hasNext = safeOpen !== null && safeOpen < urls.length - 1;

  return (
    <>
      <div className="grid max-h-[380px] grid-cols-6 gap-1.5 overflow-y-auto rounded-lg border border-ink/10 bg-card p-1.5">
        {urls.map((src, i) => (
          <button
            key={src}
            type="button"
            onClick={() => setOpenIndex(i)}
            className="group relative aspect-square overflow-hidden rounded-md"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={`Frame ${i + 1}`}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover transition-opacity group-hover:opacity-90"
            />
            <span className="absolute right-0.5 bottom-0.5 rounded bg-black/55 px-1 py-px font-mono text-[9px] font-medium text-white">
              {i + 1}
            </span>
          </button>
        ))}
      </div>

      {safeOpen !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setOpenIndex(null)}
        >
          <div
            className="relative flex max-h-[90vh] max-w-[90vw] flex-col items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpenIndex(null);
              }}
              className="absolute -top-10 right-0 rounded-full bg-white/15 px-3 py-1.5 text-sm font-medium text-white backdrop-blur transition-colors hover:bg-white/25"
            >
              ✕
            </button>

            {hasPrev && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenIndex((i) => (i === null ? i : Math.max(i - 1, 0)));
                }}
                className="absolute top-1/2 left-0 -translate-x-14 -translate-y-1/2 rounded-full bg-white/15 px-3 py-2.5 text-lg font-medium text-white backdrop-blur transition-colors hover:bg-white/25"
              >
                ‹
              </button>
            )}
            {hasNext && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenIndex((i) =>
                    i === null ? i : Math.min(i + 1, urls.length - 1),
                  );
                }}
                className="absolute top-1/2 right-0 translate-x-14 -translate-y-1/2 rounded-full bg-white/15 px-3 py-2.5 text-lg font-medium text-white backdrop-blur transition-colors hover:bg-white/25"
              >
                ›
              </button>
            )}

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={urls[safeOpen]}
              alt={`Frame ${safeOpen + 1} of ${urls.length}`}
              className="max-h-[80vh] max-w-[85vw] rounded-lg object-contain"
            />

            <div className="rounded-full bg-black/55 px-3.5 py-1.5 text-xs font-medium text-white/85 backdrop-blur">
              Frame {safeOpen + 1} of {urls.length}
              {timestamps && timestamps[safeOpen] !== undefined
                ? ` · ${formatTime(timestamps[safeOpen])}`
                : ""}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
