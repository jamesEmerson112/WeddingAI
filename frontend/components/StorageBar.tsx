"use client";

import { useStoragePolling } from "@/lib/useStoragePolling";

// Bytes -> a compact "1.2 GB" / "640 MB" string. lib/samples.ts's formatBytes
// is hard-coded to MB and used elsewhere, so this is a separate GB-aware one.
function formatSize(bytes: number): string {
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  const mb = bytes / 1024 / 1024;
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

// Fill colour by how full the volume is, mirroring the sage/amber/red tri-state
// that pill() uses on the Memories cards — under budget stays on-brand (the
// same terra gradient as the other progress bars), then warns, then alarms.
function fillClass(pct: number): string {
  if (pct >= 90) return "bg-red-600";
  if (pct >= 70) return "bg-amber-500";
  return "bg-gradient-to-r from-[#c98f86] to-terra";
}

// Live volume-usage indicator in the app-shell header. Renders nothing until
// the first reading lands (and nothing at all if the endpoint is unavailable —
// see useStoragePolling), so it never shows a broken or empty bar.
export default function StorageBar() {
  const storage = useStoragePolling();
  if (!storage || storage.limit_bytes <= 0) return null;

  // Clamp: used can momentarily exceed the soft budget (it's not a hard cap),
  // and a >100% bar would overflow its track.
  const rawPct = (storage.used_bytes / storage.limit_bytes) * 100;
  const pct = Math.min(100, Math.max(0, rawPct));

  const title =
    `Storage: ${formatSize(storage.used_bytes)} of ${formatSize(storage.limit_bytes)} used ` +
    `(${rawPct.toFixed(1)}%)\n` +
    `${formatSize(storage.uploads_bytes)} uploads · ${formatSize(storage.artifacts_bytes)} scenes · ` +
    `${storage.file_count} file${storage.file_count === 1 ? "" : "s"}`;

  return (
    // Desktop-only, matching the "Help" span it sits beside (project is
    // desktop-only). title carries the full breakdown on hover.
    <div
      className="hidden items-center gap-2 sm:flex"
      title={title}
      aria-label={title}
    >
      <span className="text-[11px] font-medium text-mocha tabular-nums">
        {formatSize(storage.used_bytes)} / {formatSize(storage.limit_bytes)}
      </span>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-ink/10">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out ${fillClass(rawPct)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
