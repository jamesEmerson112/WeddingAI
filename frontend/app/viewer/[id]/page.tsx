"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { sceneUrl } from "@/lib/api";
import { useJobPolling } from "@/lib/useJobPolling";

export default function ViewerPage() {
  // Route param via the hook (client component — see note in jobs/[id]/page.tsx).
  const params = useParams<{ id: string }>();
  const id = params.id;

  // Reuse the polling hook so the viewer fills in on its own if the job isn't
  // done yet when the page opens.
  const { job } = useJobPolling(id);
  const url = job ? sceneUrl(job) : null;

  // No scene URL yet (job still running, or artifacts missing) -> fallback.
  if (!url) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-zinc-500">Scene not ready yet.</p>
        <Link href={`/jobs/${id}`} className="text-blue-600 hover:underline">
          Check job status
        </Link>
      </div>
    );
  }

  // scene_url may be a local path (/demo/scene.html) or an absolute R2 URL —
  // the iframe renders either the same way.
  return (
    <iframe
      src={url}
      title="Gaussian splat scene"
      className="w-full h-screen border-0"
    />
  );
}
