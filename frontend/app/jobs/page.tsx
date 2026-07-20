"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listJobs, type Job } from "@/lib/api";
import { memoryGradient, memoryMeta, memoryTitle } from "@/lib/memory";

// Status pill for a memory card: done → sage "Ready", failed → red,
// anything in between → amber "Training".
function pill(state: string): { label: string; cls: string } {
  if (state === "done")
    return { label: "Ready", cls: "bg-sage-wash text-sage-ink" };
  if (state === "failed")
    return { label: "Failed", cls: "bg-red-100 text-red-700" };
  return { label: "Training", cls: "bg-amber-wash text-amber-ink" };
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Load the job list on mount, then refresh every 5 seconds so in-progress
  // jobs update on their own.
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const next = await listJobs();
        if (active) setJobs(next);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e));
      }
    }
    load();
    const timer = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-12">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-4xl font-semibold text-ink">
            Your memories
          </h1>
          <p className="mt-1.5 text-sm text-mocha">
            {jobs.length} scene{jobs.length === 1 ? "" : "s"}
          </p>
        </div>
        <Link
          href="/"
          className="rounded-lg bg-ink px-5 py-3 text-[13.5px] font-semibold text-cream transition-colors hover:bg-[#3a2f2a]"
        >
          ＋ New memory
        </Link>
      </div>

      {error && (
        <div className="mb-5 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {jobs.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-ink/10 bg-paper px-6 py-16 text-center">
          <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-blush text-xl">
            ✧
          </div>
          <p className="font-serif text-2xl font-semibold text-ink">
            No memories yet
          </p>
          <p className="mt-2 max-w-sm text-sm text-taupe">
            Upload photos of your day and we&rsquo;ll rebuild it as a walkable
            3D scene.
          </p>
          <Link
            href="/"
            className="mt-5 rounded-xl bg-terra px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-terra-dark"
          >
            Create a memory →
          </Link>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {jobs.map((job) => {
            const p = pill(job.state);
            const meta = memoryMeta(job.id);
            const inProgress = job.state !== "done" && job.state !== "failed";
            return (
              <Link
                key={job.id}
                href={job.state === "done" ? `/viewer/${job.id}` : `/jobs/${job.id}`}
                className="overflow-hidden rounded-2xl border border-ink/10 bg-paper shadow-[0_14px_30px_-24px_rgba(40,25,20,0.5)] transition-transform hover:-translate-y-0.5"
              >
                {inProgress ? (
                  // Still training: the dark "forming" shimmer thumb.
                  <div
                    className="relative aspect-[16/10]"
                    style={{
                      background:
                        "radial-gradient(120% 120% at 30% 20%,#3a2f33,#171214)",
                    }}
                  >
                    <div
                      className="animate-shimmer-x absolute inset-0"
                      style={{
                        background:
                          "linear-gradient(105deg,transparent 30%,rgba(255,255,255,.08) 50%,transparent 70%)",
                        backgroundSize: "500px 100%",
                      }}
                    />
                  </div>
                ) : (
                  <div
                    className="aspect-[16/10]"
                    style={{ background: memoryGradient(job.id) }}
                  />
                )}
                <div className="px-4 pt-3.5 pb-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate font-serif text-xl font-semibold text-ink">
                      {memoryTitle(job.id)}
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold ${p.cls}`}
                    >
                      {p.label}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-xs text-mocha">
                    {formatDate(job.created_at)}
                    {meta?.photoCount ? ` · ${meta.photoCount} photos` : ""}
                    {meta?.themeName ? ` · ${meta.themeName}` : ""}
                  </div>
                </div>
              </Link>
            );
          })}

          <Link
            href="/"
            className="flex min-h-[180px] flex-col items-center justify-center gap-2.5 rounded-2xl border-2 border-dashed border-dune text-terra transition-colors hover:bg-[#fbf3ec]"
          >
            <div className="flex size-11 items-center justify-center rounded-full bg-blush text-xl">
              ＋
            </div>
            <div className="text-sm font-semibold">New memory</div>
          </Link>
        </div>
      )}
    </main>
  );
}
