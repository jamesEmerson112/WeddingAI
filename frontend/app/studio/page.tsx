"use client";
/* eslint-disable @next/next/no-img-element -- all images here are data: URLs
   from our own Gemini route or the session handoff; next/image can't help. */

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  renderOne,
  sessionSceneSnapshot,
  type ScenePhoto,
  type SessionScene,
  type ThemeReport,
} from "@/lib/theme";
import { PRESET_THEMES } from "@/lib/themes";

type Scope = "one" | "all";

// One tile in the result canvas, parallel to the target photo list.
type Result =
  | { status: "waiting" }
  | { status: "generating" }
  | { status: "done"; image: string }
  | { status: "error"; message: string };

function dataUrl(p: ScenePhoto): string {
  return `data:${p.mimeType};base64,${p.data}`;
}

// sessionStorage doesn't exist during SSR — subscribe to a raw-string
// snapshot (null on the server) and parse it once per change.
const noopSubscribe = () => () => {};

export default function StudioPage() {
  const sceneRaw = useSyncExternalStore(
    noopSubscribe,
    sessionSceneSnapshot,
    () => null,
  );
  const scene = useMemo<SessionScene | null>(() => {
    if (!sceneRaw) return null;
    try {
      return JSON.parse(sceneRaw) as SessionScene;
    } catch {
      return null;
    }
  }, [sceneRaw]);

  const [scope, setScope] = useState<Scope>("one");
  // Theme + description are DERIVED from the picked chip (or the upload
  // handoff, or the first preset) so no effect is needed to seed them.
  const [picked, setPicked] = useState<ThemeReport | null>(null);
  const [descEdit, setDescEdit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[]>([]);

  const report = picked ?? scene?.report ?? PRESET_THEMES[0].report;
  const desc = descEdit ?? report.description;

  // Bumped on any theme/scope change so in-flight Gemini responses for the
  // old configuration can never paint over the new one (see app/page.tsx).
  const requestSeq = useRef(0);

  const photos = useMemo(() => scene?.photos ?? [], [scene]);
  const midIndex = Math.floor(photos.length / 2);
  const targets = scope === "one" ? (photos.length ? [photos[midIndex]] : []) : photos;

  function invalidate() {
    requestSeq.current++;
    setBusy(false);
    setResults([]);
  }

  function pickScope(next: Scope) {
    if (next === scope) return;
    setScope(next);
    invalidate();
  }

  function pickTheme(next: ThemeReport) {
    setPicked(next);
    setDescEdit(null);
    invalidate();
  }

  // Restyle the target photos one at a time — image generation is slow and
  // rate-limited, so a sequential loop with visible progress beats a burst.
  async function generate() {
    if (busy || targets.length === 0) return;
    const myReq = ++requestSeq.current;
    const themed: ThemeReport = {
      ...report,
      description: desc.trim() || report.description,
    };
    setBusy(true);
    setResults(targets.map(() => ({ status: "waiting" })));

    for (let i = 0; i < targets.length; i++) {
      if (requestSeq.current !== myReq) return;
      setResults((prev) =>
        prev.map((r, j) => (j === i ? { status: "generating" } : r)),
      );
      try {
        const image = await renderOne(targets[i], themed);
        if (requestSeq.current !== myReq) return;
        setResults((prev) =>
          prev.map((r, j) => (j === i ? { status: "done", image } : r)),
        );
      } catch (e) {
        if (requestSeq.current !== myReq) return;
        const message = e instanceof Error ? e.message : String(e);
        setResults((prev) =>
          prev.map((r, j) => (j === i ? { status: "error", message } : r)),
        );
      }
    }
    if (requestSeq.current === myReq) setBusy(false);
  }

  const doneCount = results.filter((r) => r.status === "done").length;
  const currentIndex = results.findIndex((r) => r.status === "generating");
  const generateLabel = busy
    ? scope === "one"
      ? "Generating…"
      : `Restyling ${Math.min(currentIndex + 1, targets.length)} of ${targets.length}…`
    : scope === "one"
      ? "✦ Generate preview"
      : "✦ Transform gallery";

  // ---- Empty state: Studio needs the photos from an upload this session ----
  if (photos.length === 0) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-blush text-2xl">
          ✦
        </div>
        <h1 className="font-serif text-3xl font-semibold text-ink">
          Nothing to restyle yet
        </h1>
        <p className="mt-3 max-w-md text-[15px] leading-relaxed text-taupe">
          Studio works with the photos from your latest upload. Create a memory
          first, then come back to reimagine it in a new mood.
        </p>
        <Link
          href="/"
          className="mt-6 rounded-xl bg-terra px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-terra-dark"
        >
          Create a memory →
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-12">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h1 className="font-serif text-4xl font-semibold text-ink">
          Scene Studio
        </h1>
        <span className="rounded-full bg-blush px-2.5 py-1 text-[10.5px] font-semibold tracking-[0.06em] text-terra uppercase">
          Powered by Gemini
        </span>
      </div>
      <p className="mb-8 max-w-xl text-[15px] leading-relaxed text-taupe">
        Reimagine your memory in a new mood. Test the look on a single frame
        first, then transform the whole set when you love it.
      </p>

      <div className="grid items-start gap-8 lg:grid-cols-[280px_1fr]">
        {/* ---- Controls ---- */}
        <div className="flex flex-col gap-6">
          <div>
            <div className="mb-2.5 text-xs font-semibold tracking-[0.08em] text-mocha uppercase">
              Scope
            </div>
            {(
              [
                { key: "one", title: "Test the theme", sub: "One photo · fast preview" },
                { key: "all", title: "All out", sub: `Whole set · ${photos.length} photos` },
              ] as const
            ).map((m) => (
              <button
                key={m.key}
                onClick={() => pickScope(m.key)}
                className={`mb-2 w-full rounded-xl px-4 py-3 text-left transition-colors ${
                  scope === m.key
                    ? "border-2 border-terra bg-paper"
                    : "border border-ink/15 bg-paper hover:border-terra/50"
                }`}
              >
                <div className="text-sm font-semibold text-ink">{m.title}</div>
                <div className="mt-0.5 text-xs text-mocha">{m.sub}</div>
              </button>
            ))}
          </div>

          <div>
            <div className="mb-2.5 text-xs font-semibold tracking-[0.08em] text-mocha uppercase">
              Mood
            </div>
            <div className="flex flex-wrap gap-2">
              {PRESET_THEMES.map((p) => {
                const active = report.theme_name === p.report.theme_name;
                return (
                  <button
                    key={p.key}
                    onClick={() => pickTheme(p.report)}
                    className={`rounded-full px-3.5 py-2 text-[12.5px] transition-colors ${
                      active
                        ? "bg-terra font-semibold text-white"
                        : "border border-ink/15 bg-white font-medium text-clay hover:border-terra"
                    }`}
                  >
                    {p.emoji} {p.report.theme_name}
                  </button>
                );
              })}
              {/* A Gemini-designed theme handed over from the upload page. */}
              {scene?.report &&
                !PRESET_THEMES.some(
                  (p) => p.report.theme_name === scene.report!.theme_name,
                ) && (
                  <button
                    onClick={() => pickTheme(scene.report!)}
                    className={`rounded-full px-3.5 py-2 text-[12.5px] transition-colors ${
                      report.theme_name === scene.report.theme_name
                        ? "bg-terra font-semibold text-white"
                        : "border border-ink/15 bg-white font-medium text-clay hover:border-terra"
                    }`}
                  >
                    ✦ {scene.report.theme_name}
                  </button>
                )}
            </div>
          </div>

          <div>
            <div className="mb-2.5 text-xs font-semibold tracking-[0.08em] text-mocha uppercase">
              Describe your theme
            </div>
            <textarea
              value={desc}
              onChange={(e) => setDescEdit(e.target.value)}
              rows={4}
              className="w-full resize-y rounded-xl border border-ink/15 bg-white px-3.5 py-3 text-[13px] leading-relaxed text-clay outline-none focus:border-terra"
            />
          </div>

          <div>
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-xs font-semibold tracking-[0.08em] text-mocha uppercase">
                Palette
              </span>
              <span className="text-[11.5px] font-medium text-terra">
                {report.theme_name}
              </span>
            </div>
            <div className="flex gap-2">
              {report.color_palette.map((c) => (
                <div key={`${c.hex}-${c.name}`} className="flex-1 text-center">
                  <div
                    className="h-9 rounded-lg border border-ink/10"
                    style={{ backgroundColor: c.hex }}
                  />
                  <div className="mt-1 font-mono text-[9px] font-medium text-fawn">
                    {c.hex.toUpperCase()}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={generate}
            disabled={busy || targets.length === 0}
            className="w-full rounded-xl bg-terra px-4 py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-terra-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {generateLabel}
          </button>
        </div>

        {/* ---- Canvas ---- */}
        {scope === "one" ? (
          <div className="grid items-center gap-3 sm:grid-cols-[1fr_44px_1fr]">
            <div>
              <div className="mb-2 text-xs font-semibold text-mocha">
                Source · 1 photo
              </div>
              {photos.length > 0 && (
                <img
                  src={dataUrl(photos[midIndex])}
                  alt="Source venue photo"
                  className="aspect-[4/3] w-full rounded-xl object-cover shadow-[0_16px_34px_-24px_rgba(40,25,20,0.5)]"
                />
              )}
            </div>
            <div className="hidden items-center justify-center pt-6 text-2xl text-terra sm:flex">
              →
            </div>
            <div>
              <div className="mb-2 text-xs font-semibold text-mocha">
                {report.theme_name}
              </div>
              <ResultTile result={results[0]} themeName={report.theme_name} />
            </div>
          </div>
        ) : (
          <div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {targets.map((p, i) => (
                <div key={i}>
                  <ResultTile
                    result={results[i]}
                    themeName={report.theme_name}
                    source={dataUrl(p)}
                  />
                </div>
              ))}
            </div>
            {doneCount > 0 && (
              <p className="mt-4 text-[12.5px] text-mocha">
                ✦ These restyled frames are the input to the 3D rebuild — the
                next step turns them back into a walkable scene.
              </p>
            )}
          </div>
        )}
      </div>

      <p className="mt-10 text-[11px] text-fawn">
        Restyling powered by Google Gemini. Your downscaled photos are processed
        server-side and not stored.
      </p>
    </main>
  );
}

// One result panel: idle prompt, generating shimmer, the restyled image, or an
// inline error — with an optional source-photo inset for the gallery grid.
function ResultTile({
  result,
  themeName,
  source,
}: {
  result: Result | undefined;
  themeName: string;
  source?: string;
}) {
  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-[#efe7dc] shadow-[0_16px_34px_-24px_rgba(40,25,20,0.5)]">
      {(!result || result.status === "waiting") && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sandstone">
          <div className="text-2xl">✦</div>
          <div className="text-[13px] font-medium">
            {result ? "Waiting…" : "Pick a mood, then Generate"}
          </div>
        </div>
      )}

      {result?.status === "generating" && (
        <>
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(120% 120% at 30% 20%, #3a2f33, #171214)",
            }}
          />
          <div
            className="animate-shimmer-x absolute inset-0"
            style={{
              background:
                "linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.1) 50%, transparent 70%)",
              backgroundSize: "500px 100%",
            }}
          />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <div className="animate-spin-ring size-9 rounded-full border-[3px] border-white/25 border-t-[#c98f86]" />
            <div className="text-[13px] font-medium text-white/85">
              Gemini is reimagining…
            </div>
          </div>
        </>
      )}

      {result?.status === "done" && (
        <>
          <img
            src={result.image}
            alt={`Venue restyled in the "${themeName}" theme`}
            className="absolute inset-0 h-full w-full object-cover"
          />
          {source && (
            <img
              src={source}
              alt="Original photo"
              className="absolute bottom-2.5 left-2.5 w-16 rounded-md border-2 border-white/90 shadow"
            />
          )}
          <div
            className={`absolute bottom-2.5 rounded-full bg-black/35 px-2.5 py-1 text-[10.5px] font-semibold text-white backdrop-blur ${
              source ? "right-2.5" : "left-2.5"
            }`}
          >
            ✦ Gemini · {themeName}
          </div>
        </>
      )}

      {result?.status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-blush px-4 text-center">
          <div className="text-lg">✦</div>
          <div className="text-[12.5px] leading-snug font-medium text-terra">
            {result.message}
          </div>
        </div>
      )}
    </div>
  );
}
