"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { JOB_STATES } from "@/lib/api";
import { useJobPolling } from "@/lib/useJobPolling";

// Label + description shown for each state in JOB_STATES, in the same order.
const STEP_META: Record<(typeof JOB_STATES)[number], { label: string; desc: string }> = {
  uploaded: { label: "Uploaded", desc: "Your photos are in." },
  queued: { label: "Queued", desc: "Waiting for a free GPU." },
  sfm: { label: "Aligning", desc: "Finding where each photo was taken." },
  training: { label: "Training", desc: "Learning the light field of the room." },
  exporting: { label: "Exporting", desc: "Packing a browser-ready scene." },
  done: { label: "Ready", desc: "Your memory is live." },
};

export default function JobStatusPage() {
  // In App Router client components the route params come from the useParams()
  // hook — NOT the `params` prop, which is a Promise here and can't be read
  // directly. useParams<{ id: string }>() types params.id as a string.
  const params = useParams<{ id: string }>();
  const id = params.id;

  const { job, error } = useJobPolling(id);

  // Where the job sits in the ordered state machine. `indexOf` returns -1 for
  // `failed` (which isn't in JOB_STATES) — the failed banner below covers that
  // case instead of the stepper trying to represent it.
  const currentIndex = job
    ? (JOB_STATES as readonly string[]).indexOf(job.state)
    : -1;
  const isDone = job?.state === "done";
  const progress = (Math.max(currentIndex, 0) / (JOB_STATES.length - 1)) * 100;

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12 sm:px-10 sm:py-14">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-serif text-4xl font-semibold text-ink">Rebuilding your day</h1>
        <span className="font-mono text-xs text-fawn">job {id.slice(0, 8)}</span>
      </div>

      <div className="my-4 h-1.5 overflow-hidden rounded-full bg-ink/10 sm:my-6">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#c98f86] to-terra transition-[width] duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Network/polling error (distinct from a job that reports `failed`). */}
      {error && (
        <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!job ? (
        <p className="mt-8 text-sm text-taupe">Loading…</p>
      ) : (
        <div className="grid gap-10 sm:grid-cols-2 sm:items-start sm:gap-12">
          {/* Vertical stepper + terminal-state banners. */}
          <div>
            <ol>
              {JOB_STATES.map((state, i) => {
                const meta = STEP_META[state];
                const completed = i < currentIndex || isDone;
                const current = i === currentIndex && !isDone;
                const last = i === JOB_STATES.length - 1;
                return (
                  <li key={state} className="flex gap-4">
                    <div className="flex flex-none flex-col items-center">
                      <div
                        className={`flex h-[30px] w-[30px] items-center justify-center rounded-full text-[13px] font-semibold ${
                          completed
                            ? "bg-sage text-white"
                            : current
                              ? "animate-pulse-dot bg-terra text-white"
                              : "bg-[#efe7dc] text-sandstone"
                        }`}
                      >
                        {completed ? "✓" : i + 1}
                      </div>
                      {!last && (
                        <div
                          className={`mt-[3px] h-[30px] w-0.5 ${completed ? "bg-sage" : "bg-[#e2d8ca]"}`}
                        />
                      )}
                    </div>
                    <div className="pb-4">
                      <p
                        className={`text-[15px] ${
                          completed || current ? "font-semibold text-ink" : "font-medium text-sandstone"
                        }`}
                      >
                        {meta.label}
                      </p>
                      <p className="mt-0.5 text-[13px] text-mocha">{meta.desc}</p>
                    </div>
                  </li>
                );
              })}
            </ol>

            {/* Job reported failure: red banner with the backend's message. */}
            {job.state === "failed" && (
              <div className="mt-2 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                <p className="font-medium">Job failed</p>
                {job.error_msg && <p className="mt-1">{job.error_msg}</p>}
              </div>
            )}

            {/* Job finished: offer the viewer. */}
            {isDone && (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#cdd8bd] bg-sage-wash px-5 py-4">
                <p className="text-sm font-medium text-sage-ink">Your memory is ready to explore.</p>
                <Link
                  href={`/viewer/${job.id}`}
                  className="whitespace-nowrap rounded-lg bg-sage px-5 py-2.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-sage-dark"
                >
                  View memory →
                </Link>
              </div>
            )}
          </div>

          {/* Decorative preview panel — no real render happens until the scene is done. */}
          <div
            className="relative aspect-[4/3] overflow-hidden rounded-xl shadow-2xl"
            style={{ background: "radial-gradient(120% 120% at 30% 20%,#3a2f33,#171214)" }}
          >
            <div
              className="absolute inset-0 animate-float-y"
              style={{
                background: "radial-gradient(closest-side at 55% 55%,rgba(200,143,134,.5),transparent 70%)",
              }}
            />
            <div
              className="absolute inset-0 animate-shimmer-x"
              style={{
                background:
                  "linear-gradient(105deg,transparent 30%,rgba(255,255,255,.09) 50%,transparent 70%)",
                backgroundSize: "500px 100%",
              }}
            />
            <div className="absolute bottom-[18px] left-5 flex items-center gap-2 text-[13px] font-medium text-white/80">
              <span className="h-2 w-2 animate-pulse-dot rounded-full bg-[#c98f86]" />
              Point cloud forming…
            </div>
            <div className="absolute right-4 top-4 font-mono text-[11px] text-white/50">preview</div>
          </div>
        </div>
      )}
    </main>
  );
}
