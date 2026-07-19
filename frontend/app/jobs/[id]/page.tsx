"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { JOB_STATES } from "@/lib/api";
import { useJobPolling } from "@/lib/useJobPolling";

export default function JobStatusPage() {
  // In App Router client components the route params come from the useParams()
  // hook — NOT the `params` prop, which is a Promise here and can't be read
  // directly. useParams<{ id: string }>() types params.id as a string.
  const params = useParams<{ id: string }>();
  const id = params.id;

  const { job, error } = useJobPolling(id);

  // Where the job sits in the ordered state machine. `indexOf` returns -1 for
  // `failed` (which isn't in JOB_STATES) — handled by the failed banner below.
  // Cast to readonly string[] so we can look up an arbitrary string.
  const currentIndex = job
    ? (JOB_STATES as readonly string[]).indexOf(job.state)
    : -1;
  const isDone = job?.state === "done";

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold">Job status</h1>
      <p className="mt-1 font-mono text-xs text-zinc-500">{id}</p>

      {/* Network/polling error (distinct from a job that reports `failed`). */}
      {error && (
        <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {!job ? (
        <p className="mt-8 text-sm text-zinc-500">Loading…</p>
      ) : (
        <>
          {/* Horizontal stepper across the ordered states. */}
          <ol className="mt-8 flex items-start">
            {JOB_STATES.map((state, i) => {
              const completed = i < currentIndex || isDone;
              const current = i === currentIndex && !isDone;
              return (
                <li
                  key={state}
                  className="flex flex-1 items-center last:flex-none"
                >
                  <div className="flex flex-col items-center">
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium ${
                        completed
                          ? "bg-green-600 text-white"
                          : current
                            ? "animate-pulse bg-blue-600 text-white"
                            : "bg-zinc-200 text-zinc-500 dark:bg-zinc-800"
                      }`}
                    >
                      {completed ? "✓" : i + 1}
                    </div>
                    <span
                      className={`mt-1 text-xs ${
                        current ? "font-medium" : "text-zinc-500"
                      }`}
                    >
                      {state}
                    </span>
                  </div>
                  {/* Connector line to the next step. */}
                  {i < JOB_STATES.length - 1 && (
                    <div
                      className={`mx-1 h-0.5 flex-1 ${
                        i < currentIndex || isDone
                          ? "bg-green-600"
                          : "bg-zinc-200 dark:bg-zinc-800"
                      }`}
                    />
                  )}
                </li>
              );
            })}
          </ol>

          {/* Job reported failure: red banner with the backend's message. */}
          {job.state === "failed" && (
            <div className="mt-8 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              <p className="font-medium">Job failed</p>
              {job.error_msg && <p className="mt-1">{job.error_msg}</p>}
            </div>
          )}

          {/* Job finished: offer the viewer. */}
          {isDone && (
            <Link
              href={`/viewer/${job.id}`}
              className="mt-8 inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              View scene
            </Link>
          )}
        </>
      )}
    </main>
  );
}
