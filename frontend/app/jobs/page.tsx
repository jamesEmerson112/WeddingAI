"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listJobs, type Job } from "@/lib/api";

// Tailwind classes for a job's state badge:
//   done   -> green, failed -> red, anything in between -> pulsing amber.
function badgeClass(state: string): string {
  if (state === "done")
    return "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300";
  if (state === "failed")
    return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300";
  return "bg-amber-100 text-amber-800 animate-pulse dark:bg-amber-900/40 dark:text-amber-300";
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
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold">Jobs</h1>

      {error && (
        <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {jobs.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-500">
          No jobs yet.{" "}
          <Link href="/" className="text-blue-600 hover:underline">
            Create one.
          </Link>
        </p>
      ) : (
        <table className="mt-6 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
              <th className="py-2 font-medium">Job</th>
              <th className="py-2 font-medium">State</th>
              <th className="py-2 font-medium">Created</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr
                key={job.id}
                className="border-b border-zinc-100 dark:border-zinc-900"
              >
                {/* Show only the first 8 chars of the (long) job id. */}
                <td className="py-2 font-mono text-xs">{job.id.slice(0, 8)}</td>
                <td className="py-2">
                  <span
                    className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${badgeClass(
                      job.state,
                    )}`}
                  >
                    {job.state}
                  </span>
                </td>
                <td className="py-2 text-zinc-500">{job.created_at}</td>
                <td className="py-2 text-right">
                  <Link
                    href={`/jobs/${job.id}`}
                    className="text-blue-600 hover:underline"
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
