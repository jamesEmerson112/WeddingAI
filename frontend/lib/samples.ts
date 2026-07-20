/**
 * Preloaded sample photo sets, so the product can be tried without shooting
 * anything — the one-click path for a judge or a first-time visitor.
 *
 * The sets are published from `photos-inbox/` into `public/samples/` by
 * `scripts/build-samples.mjs` (see that file for why the copy is necessary).
 * This module is the browser half: read the manifest, then turn a chosen set
 * back into real `File` objects.
 *
 * Producing `File`s rather than a bespoke type is the whole point — the upload
 * page's `applyImages` and `createMemory` then treat a sample set exactly like
 * a drag-and-drop, so zip → PUT → job needs no special case.
 */

export type SampleSet = {
  id: string;
  label: string;
  count: number;
  bytes: number;
  /** Absolute, origin-relative URLs under `/samples/`. */
  photos: string[];
};

const MANIFEST_URL = "/samples/manifest.json";

/**
 * Load the published sets. Resolves to `[]` rather than throwing when the
 * manifest is missing — samples are an optional convenience, and a failure
 * here should hide the gallery, not break the upload page.
 */
export async function loadSampleSets(signal?: AbortSignal): Promise<SampleSet[]> {
  try {
    const res = await fetch(MANIFEST_URL, { signal, cache: "force-cache" });
    if (!res.ok) return [];
    const data = (await res.json()) as { sets?: SampleSet[] };
    return data.sets ?? [];
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    return [];
  }
}

/** Filename from a `/samples/...` URL, for the `File` name COLMAP will see. */
function basename(url: string): string {
  const last = url.split("/").pop() || "photo.jpg";
  return decodeURIComponent(last);
}

/**
 * Fetch a set's photos and wrap them as `File`s.
 *
 * Sequential on purpose: these are same-origin static assets and the sets are
 * small (6-7 photos), so the added complexity of a concurrency pool buys
 * nothing, while sequential fetching keeps `onProgress` honest.
 */
export async function fetchSampleFiles(
  set: SampleSet,
  opts: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<File[]> {
  const { onProgress, signal } = opts;
  const files: File[] = [];

  for (const url of set.photos) {
    const res = await fetch(url, { signal, cache: "force-cache" });
    if (!res.ok) {
      throw new Error(
        `Could not load the ${set.label} sample set (${basename(url)} returned ${res.status}).`,
      );
    }
    const blob = await res.blob();
    files.push(
      new File([blob], basename(url), { type: blob.type || "image/jpeg" }),
    );
    onProgress?.(files.length, set.photos.length);
  }

  return files;
}

/** "1.7 MB" — sets are small enough that MB with one decimal reads best. */
export function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
