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

// One downscaled photo, ready to send to a Gemini route.
export type ScenePhoto = { data: string; mimeType: string };

// The handoff from the Upload page to Studio: the downscaled photo set plus
// the theme chosen at create time (null when none was picked).
export type SessionScene = { photos: ScenePhoto[]; report: ThemeReport | null };

// Gemini only needs a taste of the set, and Vercel caps request bodies at
// ~4.5MB — 8 photos at ~1024px JPEG stays comfortably under both limits.
const MAX_PHOTOS = 8;
const TARGET_EDGE = 1024;
const JPEG_QUALITY = 0.7;
const CACHE_PREFIX = "weddingai:theme:";
const SESSION_KEY = "weddingai:scene";

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
export async function downscale(file: File): Promise<ScenePhoto | null> {
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

// Downscale an evenly-sampled slice of the set (≤ MAX_PHOTOS), skipping any
// photo the browser can't decode.
export async function downscaleSet(files: File[]): Promise<ScenePhoto[]> {
  const images = await Promise.all(sample(files).map(downscale));
  return images.filter((img): img is ScenePhoto => img !== null);
}

// ---- Upload → Studio handoff (sessionStorage; ~1MB, well under quota) ----

export function saveSessionScene(scene: SessionScene): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(scene));
  } catch {
    // Best effort — Studio shows its empty state if the handoff is missing.
  }
}

export function loadSessionScene(): SessionScene | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as SessionScene) : null;
  } catch {
    return null;
  }
}

// Raw-string snapshot for useSyncExternalStore (stable reference — parsing
// happens behind useMemo on the caller's side). Returns null on the server.
export function sessionSceneSnapshot(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
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

  const images = await downscaleSet(files);
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

// Ask Gemini's image model to restyle ONE already-downscaled photo in the
// theme. Returns a data: URL ready for an <img>. Not cached — base64 images
// blow past localStorage quotas, so results live in React state.
export async function renderOne(
  image: ScenePhoto,
  report: ThemeReport,
): Promise<string> {
  const res = await fetch("/api/render", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      theme: {
        theme_name: report.theme_name,
        one_liner: report.one_liner,
        description: report.description,
        palette: report.color_palette.map((c) => `${c.name} (${c.hex})`),
      },
      image,
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Render failed (${res.status})`);
  }
  const { image: dataUrl } = (await res.json()) as { image: string };
  return dataUrl;
}

// Convenience wrapper: restyle the middle photo of a File set (usually a
// representative interior view).
export async function renderTheme(
  files: File[],
  report: ThemeReport,
): Promise<string> {
  const image = await downscale(files[Math.floor(files.length / 2)]);
  if (!image) throw new Error("Couldn't read a venue photo to render from.");
  return renderOne(image, report);
}
