/**
 * Publish the repo's sample photo sets so the browser can load them.
 *
 *   photos-inbox/<Set>/*.jpg  →  frontend/public/samples/<Set>/*.jpg
 *                             →  frontend/public/samples/manifest.json
 *
 * Next only serves files under `public/`, and `photos-inbox/` lives at the repo
 * root, so the sets have to be copied in before a build. Doing it here rather
 * than committing a second copy keeps `photos-inbox/` the single source of
 * truth — `public/samples/` is generated and gitignored.
 *
 * Runs on `predev` and `prebuild`, so a fresh clone works with no extra step.
 *
 * Never throws: a missing or empty `photos-inbox/` writes an empty manifest and
 * the gallery simply renders nothing. A sample gallery is not worth failing a
 * production deploy over.
 */

import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const SOURCE = join(REPO_ROOT, "photos-inbox");
const OUT_DIR = join(HERE, "..", "public", "samples");

/** Full-resolution staging area — deliberately not published. */
const SKIP_DIRS = new Set(["originals"]);
const PHOTO_RE = /\.(jpe?g|png|webp)$/i;

/** "Location-1" → "Location 1" — the sets are named by folder, not metadata. */
function labelFor(dirName) {
  return dirName.replace(/[-_]+/g, " ").trim();
}

async function collectSets() {
  let entries;
  try {
    entries = await readdir(SOURCE, { withFileTypes: true });
  } catch {
    console.warn(`[samples] no ${SOURCE} — writing an empty manifest.`);
    return [];
  }

  const sets = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;

    const dir = join(SOURCE, entry.name);
    const photos = (await readdir(dir)).filter((f) => PHOTO_RE.test(f)).sort();
    if (!photos.length) continue;

    let bytes = 0;
    for (const photo of photos) bytes += (await stat(join(dir, photo))).size;

    sets.push({
      id: entry.name,
      label: labelFor(entry.name),
      count: photos.length,
      bytes,
      photos: photos.map((f) => `/samples/${entry.name}/${f}`),
    });
  }
  return sets.sort((a, b) => a.id.localeCompare(b.id));
}

async function main() {
  // Rebuild from scratch so a photo deleted from photos-inbox/ doesn't linger
  // in public/ and keep showing up in the gallery.
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const sets = await collectSets();
  for (const set of sets) {
    await cp(join(SOURCE, set.id), join(OUT_DIR, set.id), { recursive: true });
  }

  await writeFile(
    join(OUT_DIR, "manifest.json"),
    JSON.stringify({ sets }, null, 2) + "\n",
  );

  const total = sets.reduce((n, s) => n + s.count, 0);
  console.log(
    `[samples] published ${sets.length} set(s), ${total} photo(s): ` +
      (sets.map((s) => `${s.id} (${s.count})`).join(", ") || "none"),
  );
}

main().catch((err) => {
  // Still emit a manifest so the app's fetch resolves rather than 404s.
  console.warn(`[samples] failed, continuing with an empty manifest: ${err}`);
  return mkdir(OUT_DIR, { recursive: true }).then(() =>
    writeFile(join(OUT_DIR, "manifest.json"), '{"sets":[]}\n'),
  );
});
