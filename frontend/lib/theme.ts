// Client helpers for the Gemini wedding-theme feature.
//
// The browser downscales a sample of the selected photos, POSTs them to our own
// Next.js route (/api/analyze — same origin, so the Gemini key stays on the
// server), and caches the resulting report in localStorage keyed by the photo
// set, so repeat runs during a demo are instant and cost nothing.

// The report shape returned by /api/analyze. Mirrors RESPONSE_SCHEMA in
// app/api/analyze/route.ts — keep the two in sync.
export type ThemeReport = {
  theme_name: string;
  one_liner: string;
  description: string;
  venue_observations: string;
  color_palette: { name: string; hex: string }[];
  decor: string[];
  florals: string[];
  tags: string[];
  photo_coverage: { verdict: "good" | "usable" | "poor"; advice: string };
};

// Gemini only needs a taste of the set, and Vercel caps request bodies at
// ~4.5MB — 8 photos at ~1024px JPEG stays comfortably under both limits.
const MAX_PHOTOS = 8;
const TARGET_EDGE = 1024;
const JPEG_QUALITY = 0.7;
const CACHE_PREFIX = "weddingai:theme:";

// A stable id for a photo set: same files selected again → same key → cache
// hit. Name+size+mtime is plenty for a demo cache; no need to hash pixels.
function fingerprint(files: File[]): string {
  const sig = files
    .map((f) => `${f.name}:${f.size}:${f.lastModified}`)
    .sort()
    .join("|");
  let h = 0;
  for (let i = 0; i < sig.length; i++) h = (h * 31 + sig.charCodeAt(i)) | 0;
  return `${CACHE_PREFIX}${files.length}:${(h >>> 0).toString(16)}`;
}

// Pick up to MAX_PHOTOS files spread evenly across the set, so a 60-photo
// walkthrough contributes views from all around the space, not just the start.
function sample(files: File[]): File[] {
  if (files.length <= MAX_PHOTOS) return files;
  const step = files.length / MAX_PHOTOS;
  return Array.from({ length: MAX_PHOTOS }, (_, i) => files[Math.floor(i * step)]);
}

// Downscale one photo to a small JPEG and return its base64 payload. Returns
// null for files the browser can't decode (e.g. HEIC on some platforms) so the
// caller can skip them instead of failing the whole batch.
async function downscale(
  file: File,
): Promise<{ data: string; mimeType: string } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, TARGET_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    return { data: dataUrl.slice(dataUrl.indexOf(",") + 1), mimeType: "image/jpeg" };
  } catch {
    return null;
  }
}

// Analyze a photo set. Resolves from the localStorage cache when the same set
// was analyzed before (cached: true), unless `force` asks for a fresh take.
export async function analyzePhotos(
  files: File[],
  opts: { force?: boolean } = {},
): Promise<{ report: ThemeReport; cached: boolean }> {
  const key = fingerprint(files);
  if (!opts.force) {
    try {
      const hit = localStorage.getItem(key);
      if (hit) return { report: JSON.parse(hit) as ThemeReport, cached: true };
    } catch {
      // Unreadable cache entry — fall through to a live call.
    }
  }

  const images = (await Promise.all(sample(files).map(downscale))).filter(
    (img) => img !== null,
  );
  if (images.length === 0) {
    throw new Error("None of the selected photos could be read as images.");
  }

  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Analysis failed (${res.status})`);
  }
  const { report } = (await res.json()) as { report: ThemeReport };

  try {
    localStorage.setItem(key, JSON.stringify(report));
  } catch {
    // Storage full or blocked — caching is best-effort.
  }
  return { report, cached: false };
}
