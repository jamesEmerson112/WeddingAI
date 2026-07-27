"use client";

import { useEffect, useState } from "react";
import { getStorage, type Storage } from "@/lib/api";

// Poll GET /api/storage every 15s (storage changes slowly, unlike a job's
// state). Returns the latest reading, or null.
//
// null is deliberately the ONLY "not available" signal — a failed fetch resets
// to null rather than surfacing an error. The endpoint doesn't exist until the
// backend redeploys, so a Vercel build still pointing at the old backend would
// otherwise light up an error for a purely cosmetic indicator. The consumer
// (StorageBar) renders nothing on null, so the header just omits the bar.
export function useStoragePolling(): Storage | null {
  const [storage, setStorage] = useState<Storage | null>(null);

  useEffect(() => {
    // Guards setState after unmount, same shape as useJobPolling.
    let active = true;

    async function tick() {
      try {
        const next = await getStorage();
        if (active) setStorage(next);
      } catch {
        // Endpoint missing / backend down / CORS — hide the bar, don't error.
        if (active) setStorage(null);
      }
    }

    // Fetch once so the bar can appear without waiting a full interval.
    tick();
    const timer = setInterval(tick, 15000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return storage;
}
