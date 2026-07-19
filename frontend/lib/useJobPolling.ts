"use client";

import { useEffect, useState } from "react";
import { getJob, type Job } from "@/lib/api";

// Once a job reaches one of these states it never changes again, so we stop
// polling. (`done` is the happy path; `failed` is the error path.)
const TERMINAL_STATES = ["done", "failed"];

// React hook: poll GET /api/jobs/{id} every 2 seconds until the job is done or
// failed. Returns the latest job (null until the first fetch lands) plus any
// error message. The interval is cleared on unmount and whenever `id` changes.
export function useJobPolling(id: string): { job: Job | null; error: string | null } {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // `active` guards against calling setState after the component has
    // unmounted (or after `id` changed and this effect was cleaned up).
    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function tick() {
      try {
        const next = await getJob(id);
        if (!active) return;
        setJob(next);
        // Reached a terminal state -> nothing more will change, stop the timer.
        if (TERMINAL_STATES.includes(next.state) && timer) {
          clearInterval(timer);
          timer = null;
        }
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    }

    // Fetch once immediately so the UI isn't blank for 2 seconds, then poll.
    tick();
    timer = setInterval(tick, 2000);

    // Cleanup: runs on unmount and before the effect re-runs for a new id.
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [id]);

  return { job, error };
}
