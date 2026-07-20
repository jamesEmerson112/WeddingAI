"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { sceneUrl } from "@/lib/api";
import { memoryTitle } from "@/lib/memory";
import { useJobPolling } from "@/lib/useJobPolling";

export default function ViewerPage() {
  // Route param via the hook (client component — see note in jobs/[id]/page.tsx).
  const params = useParams<{ id: string }>();
  const id = params.id;

  // Reuse the polling hook so the viewer fills in on its own if the job isn't
  // done yet when the page opens.
  const { job } = useJobPolling(id);
  const url = job ? sceneUrl(job) : null;

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
        // scene_url may be a local path (/demo/scene.html) or an absolute R2
        // URL — the iframe renders either the same way.
        <iframe
          src={url}
          title="Gaussian splat scene"
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

      {/* Overlay chrome. The wrappers ignore the pointer so orbit-dragging the
          iframe still works everywhere except the actual controls. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/40 to-transparent px-4 py-4 sm:px-6">
        <div className="flex items-center gap-3.5">
          <Link
            href="/jobs"
            className="pointer-events-auto rounded-lg bg-white/15 px-3.5 py-2 text-[13px] font-medium text-white backdrop-blur transition-colors hover:bg-white/25"
          >
            ‹&nbsp; Memories
          </Link>
          <div className="font-serif text-xl font-semibold text-white">
            {memoryTitle(id)}
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
          href="/studio"
          className="pointer-events-auto flex items-center gap-1.5 rounded-lg bg-terra px-4 py-2.5 text-[13.5px] font-semibold text-white shadow-lg transition-colors hover:bg-terra-dark"
        >
          ✦ Reimagine in Studio
        </Link>
      </div>

      <div className="pointer-events-none absolute bottom-6 left-1/2 hidden -translate-x-1/2 items-center gap-4 rounded-full border border-white/10 bg-black/55 px-5 py-2.5 text-xs font-medium text-white/85 backdrop-blur sm:flex">
        <span>Drag to orbit</span>
        <span className="opacity-40">·</span>
        <span>Scroll to zoom</span>
        <span className="opacity-40">·</span>
        <span>Double-click to focus</span>
      </div>
    </div>
  );
}
