"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { sceneKind, sceneUrl } from "@/lib/api";
import { EXAMPLE_SCENE_TITLE, memoryTitle } from "@/lib/memory";
import { useJobPolling } from "@/lib/useJobPolling";

export default function ViewerPage() {
  // Route param via the hook (client component — see note in jobs/[id]/page.tsx).
  const params = useParams<{ id: string }>();
  const id = params.id;

  // Reuse the polling hook so the viewer fills in on its own if the job isn't
  // done yet when the page opens.
  const { job } = useJobPolling(id);
  const url = job ? sceneUrl(job) : null;
  // Three-way classification (placeholder / example / real) lives in
  // lib/api.ts's sceneKind() — see its doc comment for what each case means
  // and why the distinction matters. null here just means "no scene yet".
  const kind = sceneKind(url);
  const title = kind === "example" ? EXAMPLE_SCENE_TITLE : memoryTitle(id);

  // The committed example export is 30.7 MB (21.4 MB gzipped) — on a slow
  // connection the iframe would otherwise sit blank for 20-30s. Track load
  // completion per-URL so the spinner reveals once onLoad fires and resets
  // correctly if the scene changes (e.g. polling flips a job to "done" while
  // this page is open). This is the React-documented "adjust state during
  // render" pattern, not a useEffect, specifically to avoid the
  // set-state-in-effect lint error (no setState synchronously at the top
  // level of a useEffect body) — see the two lines below.
  const [loaded, setLoaded] = useState(false);
  const [loadedForUrl, setLoadedForUrl] = useState<string | null>(null);
  if (url !== loadedForUrl) {
    setLoadedForUrl(url);
    setLoaded(false);
  }
  // Safety net: if onLoad never fires (blocked, errored, whatever), don't
  // permanently hide the scene behind the spinner. setState here is inside a
  // timer callback, not synchronously at the effect's top level, so it does
  // not trip set-state-in-effect.
  useEffect(() => {
    if (!url) return;
    const timer = setTimeout(() => setLoaded(true), 25000);
    return () => clearTimeout(timer);
  }, [url]);

  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  async function share() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked — nothing useful to show.
    }
  }

  return (
    <div
      className="relative flex-1 overflow-hidden"
      style={{
        background: "radial-gradient(130% 130% at 50% 25%,#4a3d40,#161113)",
      }}
    >
      {url ? (
        // scene_url may be a local path (/demo/scene.html or the committed
        // example) or an absolute R2 URL — the iframe renders either the same
        // way. key={url} forces a clean remount (and a fresh load event) if
        // the URL changes instead of reusing a stale iframe.
        <iframe
          key={url}
          src={url}
          title="Gaussian splat scene"
          onLoad={() => setLoaded(true)}
          className="absolute inset-0 h-full w-full border-0"
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-white/70">Scene not ready yet.</p>
          <Link
            href={`/jobs/${id}`}
            className="pointer-events-auto rounded-lg bg-white/15 px-4 py-2 text-sm font-medium text-white backdrop-blur transition-colors hover:bg-white/25"
          >
            Check status
          </Link>
        </div>
      )}

      {/* Loading cover: the scene file is tens of MB, so a blank iframe on a
          slow connection reads as broken rather than working. Sits above the
          iframe until onLoad fires (or the 25s safety-net timer above gives
          up), then disappears entirely — never blocks pointer events once
          gone, and the background matches the container so there's no flash. */}
      {url && !loaded && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-3"
          style={{
            background: "radial-gradient(130% 130% at 50% 25%,#4a3d40,#161113)",
          }}
        >
          <div className="animate-spin-ring size-9 rounded-full border-[3px] border-white/25 border-t-[#c98f86]" />
          <div className="text-[13px] font-medium text-white/85">
            Loading the scene…
          </div>
          <div className="max-w-xs text-center text-xs text-white/50">
            This is a large 3D file (tens of MB) — it can take a moment on a
            slower connection.
          </div>
        </div>
      )}

      {/* Overlay chrome. The wrappers ignore the pointer so orbit-dragging the
          iframe still works everywhere except the actual controls. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/40 to-transparent px-4 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3.5">
          <Link
            href="/jobs"
            className="pointer-events-auto rounded-lg bg-white/15 px-3.5 py-2 text-[13px] font-medium text-white backdrop-blur transition-colors hover:bg-white/25"
          >
            ‹&nbsp; Memories
          </Link>
          {/* min-w-0 lets the flex child shrink so truncate can engage — a
              wrapped title would collide with the Studio CTA below. Stacked
              with the example badge (when shown) rather than inline, so the
              badge can't get truncated away with a long title. */}
          <div className="flex min-w-0 flex-col gap-1">
            <div className="min-w-0 truncate font-serif text-xl font-semibold text-white">
              {title}
            </div>
            {kind === "example" && (
              <span className="pointer-events-none w-fit rounded-full bg-terra px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-white">
                Sample reconstruction — not your upload
              </span>
            )}
          </div>
        </div>
        <button
          onClick={share}
          className="pointer-events-auto rounded-lg bg-white/15 px-3.5 py-2 text-[13px] font-medium text-white backdrop-blur transition-colors hover:bg-white/25"
        >
          {copied ? "Copied ✓" : "Share"}
        </button>
      </div>

      <div className="pointer-events-none absolute top-[70px] right-4 sm:right-6">
        <Link
          href={`/studio?from=${id}`}
          className="pointer-events-auto flex items-center gap-1.5 rounded-lg bg-terra px-4 py-2.5 text-[13.5px] font-semibold text-white shadow-lg transition-colors hover:bg-terra-dark"
        >
          ✦ Reimagine in Studio
        </Link>
      </div>

      {kind === "placeholder" ? (
        <div className="pointer-events-none absolute bottom-6 left-1/2 hidden -translate-x-1/2 items-center gap-4 rounded-full border border-white/10 bg-black/55 px-5 py-2.5 text-xs font-medium text-white/85 backdrop-blur sm:flex">
          <span>Stand-in scene — the real reconstruction renders here once processing runs</span>
        </div>
      ) : kind === "example" || kind === "real" ? (
        // Same pill for both real cases — the orbit controls are equally
        // real either way, so this row never needs to change shape between
        // them. The "this is a sample" disclosure lives in the badge next to
        // the title above, not here.
        <div className="pointer-events-none absolute bottom-6 left-1/2 hidden -translate-x-1/2 items-center gap-4 rounded-full border border-white/10 bg-black/55 px-5 py-2.5 text-xs font-medium text-white/85 backdrop-blur sm:flex">
          <span>Drag to orbit</span>
          <span className="opacity-40">·</span>
          <span>Scroll to zoom</span>
          <span className="opacity-40">·</span>
          <span>Double-click to focus</span>
        </div>
      ) : null}
    </div>
  );
}
