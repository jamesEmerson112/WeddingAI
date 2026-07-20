/**
 * Browser-side video → frames, so a walkthrough video can feed the same
 * pipeline as a photo set.
 *
 *   video → [THIS FILE: <video> + <canvas>] → JPEG frames → JSZip → job
 *
 * Shooting 40-150 stills by hand is impractical; a 45-90s slow orbit gives the
 * same coverage. We extract here rather than server-side because the existing
 * upload flow already zips in the browser — this drops in ahead of that and
 * needs no backend or worker change.
 *
 * Fixed-interval sampling on purpose: COLMAP wants *evenly spaced* views with
 * consistent overlap as the camera moves. Scene detection optimises for visual
 * change, which is the opposite — it would thin out exactly the slow, dense,
 * high-overlap passes that reconstruct best. Mirrors scripts/video-to-frames.sh.
 */

/** Below this COLMAP often fails to register a single connected model. */
export const MIN_FRAMES = 40;
/** Above this, training time climbs for little reconstruction gain. */
export const MAX_FRAMES = 150;
/** What we aim for when the video is long enough to afford it. */
export const TARGET_FRAMES = 110;

/**
 * Frames are downscaled to this width. Deliberately below LichtFeld's 3840
 * `--max-width`: 110 frames at 4K would make a zip too large to upload
 * comfortably, and detail beyond this adds little for reconstruction.
 */
const MAX_WIDTH = 1920;
const JPEG_QUALITY = 0.85;

/** Per-frame seek budget. A stuck seek should fail loudly, not hang forever. */
const SEEK_TIMEOUT_MS = 10_000;

export type ExtractOptions = {
  /** Called after each frame so the UI can show progress. */
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  targetFrames?: number;
  maxWidth?: number;
};

export function isVideoFile(file: File): boolean {
  // Some browsers report an empty type for less common containers, so fall
  // back to the extension rather than silently rejecting a valid video.
  if (file.type.startsWith("video/")) return true;
  return /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(file.name);
}

/** How many frames we'll take from a clip of this length, and at what rate. */
export function planExtraction(
  duration: number,
  targetFrames = TARGET_FRAMES,
): { count: number; fps: number } {
  const count = Math.max(
    MIN_FRAMES,
    Math.min(MAX_FRAMES, Math.round(targetFrames)),
  );
  return { count, fps: count / duration };
}

function abortError() {
  return new DOMException("Frame extraction cancelled", "AbortError");
}

/** Resolve once the video element reports it can seek and knows its duration. */
function loadVideo(video: HTMLVideoElement, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      // Overwhelmingly the cause is a codec the browser can't decode — HEVC
      // from an iPhone is the usual culprit outside Safari. Say so, and point
      // at the escape hatch rather than leaving a dead end.
      reject(
        new Error(
          "This browser can't decode that video (HEVC/H.265 from iPhone is the " +
            "usual cause). Try Safari, re-export as H.264/MP4, or extract frames " +
            "locally with scripts/video-to-frames.sh and upload those images.",
        ),
      );
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort);
  });
}

/** Seek to `time` and resolve once the frame at that position is presented. */
function seekTo(video: HTMLVideoElement, time: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out seeking to ${time.toFixed(2)}s in the video.`));
    }, SEEK_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Video decoding failed partway through extraction."));
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort);
    video.currentTime = time;
  });
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Could not encode a frame to JPEG.")),
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}

/**
 * Extract evenly spaced JPEG frames from a video file.
 *
 * Returns Files named `frame_0001.jpg`… so they sort correctly and flow into
 * the existing photo path unchanged, alongside a parallel `timestamps` array
 * (seconds into the source video) so a viewer can label each frame — index i
 * of one corresponds to index i of the other.
 */
export async function extractFrames(
  file: File,
  opts: ExtractOptions = {},
): Promise<{ frames: File[]; timestamps: number[] }> {
  const { onProgress, signal, targetFrames = TARGET_FRAMES, maxWidth = MAX_WIDTH } = opts;

  if (signal?.aborted) throw abortError();

  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  // Required before drawImage will read pixels from a cross-origin source;
  // harmless for the blob URLs we use here.
  video.crossOrigin = "anonymous";
  video.src = url;

  try {
    await loadVideo(video, signal);

    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(
        "Could not read the video's duration — try re-exporting it as MP4.",
      );
    }
    if (duration < 10) {
      throw new Error(
        `That clip is only ${duration.toFixed(0)}s. Aim for a 45-90s slow orbit ` +
          "so there are enough distinct viewpoints to reconstruct.",
      );
    }

    const { width: vw, height: vh } = {
      width: video.videoWidth,
      height: video.videoHeight,
    };
    if (!vw || !vh) throw new Error("Could not read the video's dimensions.");

    const { count } = planExtraction(duration, targetFrames);

    const scale = Math.min(1, maxWidth / vw);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vw * scale);
    canvas.height = Math.round(vh * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not create a canvas to decode frames into.");

    const frames: File[] = [];
    const timestamps: number[] = [];
    for (let i = 0; i < count; i++) {
      if (signal?.aborted) throw abortError();

      // Sample at interval midpoints: seeking to exactly 0 or to the final
      // timestamp is unreliable across browsers and yields duplicate frames.
      const t = ((i + 0.5) * duration) / count;
      await seekTo(video, t, signal);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const blob = await canvasToJpeg(canvas);
      const name = `frame_${String(i + 1).padStart(4, "0")}.jpg`;
      frames.push(new File([blob], name, { type: "image/jpeg" }));
      timestamps.push(t);

      onProgress?.(i + 1, count);
    }

    return { frames, timestamps };
  } finally {
    // Drop the decoder's hold on the blob before revoking, or Safari can keep
    // the whole video buffered in memory.
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
