// Display metadata for jobs ("memories"). The backend knows nothing about
// titles or themes, so this is all client-side: a deterministic pretty name and
// thumbnail gradient hashed from the job id, plus a localStorage entry written
// when a memory is created in this browser (theme + photo count). Jobs created
// elsewhere (e.g. seeded demo jobs) still get a stable name and gradient.

const NAMES = [
  "The First Dance",
  "Golden Hour Vows",
  "The Tablescape",
  "Reception Toast",
  "Garden Ceremony",
  "Candlelit Promises",
  "The Grand Entrance",
  "Champagne Hour",
  "The Quiet Aisle",
  "Evening Reception",
];

const GRADIENTS: [string, string][] = [
  ["#e8cdbf", "#a86056"],
  ["#e4d9c4", "#b0913f"],
  ["#cfd6c4", "#7f9068"],
  ["#d9c9d6", "#8d6f8a"],
  ["#e6d3c0", "#c08a5e"],
  ["#dcc7bd", "#b07f74"],
  ["#e2d6c0", "#a99164"],
  ["#ded0da", "#94799a"],
];

const META_PREFIX = "weddingai:memory:";

// Title for the committed example scene (frontend/public/demo/scene-3041.html,
// substituted for the mock placeholder — see lib/api.ts's sceneKind()), used
// in place of the usual hash-derived name whenever a job resolves to it. The
// scene is genuinely a startup office, so a random name like "The First
// Dance" over a picture of a desk would read as broken. Both the viewer
// (app/viewer/[id]/page.tsx) and the Memories grid (app/jobs/page.tsx) apply
// this override so a card's title always matches what opening it shows.
export const EXAMPLE_SCENE_TITLE = "My Startup Office";

export type MemoryMeta = {
  themeName?: string;
  photoCount?: number;
  // False when the Studio photo handoff didn't fit in sessionStorage, so
  // Studio can say so rather than looking like nothing was ever uploaded.
  studioReady?: boolean;
};

function hash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return h >>> 0;
}

export function memoryTitle(id: string): string {
  return NAMES[hash(id) % NAMES.length];
}

// CSS background value for the card thumbnail.
export function memoryGradient(id: string): string {
  const [a, b] = GRADIENTS[hash(id) % GRADIENTS.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

export function saveMemoryMeta(id: string, meta: MemoryMeta): void {
  try {
    localStorage.setItem(META_PREFIX + id, JSON.stringify(meta));
  } catch {
    // Best effort — the deterministic fallbacks still apply.
  }
}

export function memoryMeta(id: string): MemoryMeta | null {
  try {
    const raw = localStorage.getItem(META_PREFIX + id);
    return raw ? (JSON.parse(raw) as MemoryMeta) : null;
  } catch {
    return null;
  }
}
