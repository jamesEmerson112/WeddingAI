// POST /api/render — Gemini draws the user's actual venue redecorated in the
// proposed wedding theme (image-to-image, so the render is recognizably their
// space). Same server-side-only contract as /api/analyze: the key lives in
// process.env here and never reaches the browser.

import { GoogleGenAI } from "@google/genai";

// Vercel kills functions at 10s by default — image generation needs more room.
export const maxDuration = 60;

// Gemini's image-output model (separate from the text/vision model used by
// /api/analyze — gemini-3.5-flash cannot emit images).
const MODEL = "gemini-2.5-flash-image";
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const GEMINI_TIMEOUT_MS = 50_000;

type RenderRequest = {
  theme?: {
    theme_name?: string;
    one_liner?: string;
    description?: string;
    palette?: string[];
  };
  image?: { data?: string; mimeType?: string };
};

function fail(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return fail(500, "The design service is not configured on this server.");
  }

  // -- Validate input: missing/malformed → 400. -------------------------------
  let body: RenderRequest;
  try {
    body = (await request.json()) as RenderRequest;
  } catch {
    return fail(400, "Request body must be JSON.");
  }
  const theme = body.theme;
  const image = body.image;
  if (!theme?.theme_name || !theme.description) {
    return fail(400, "Send the theme (name + description) to render.");
  }
  if (typeof image?.data !== "string" || image.data.length === 0) {
    return fail(400, "Send one venue photo as base64 `data`.");
  }
  if (!ALLOWED_TYPES.has(image.mimeType ?? "")) {
    return fail(400, "Unsupported file type — send a JPEG, PNG, or WebP photo.");
  }

  const prompt =
    `Redecorate this exact venue for a wedding in the theme "${theme.theme_name}"` +
    `${theme.one_liner ? ` — ${theme.one_liner}` : ""}. ` +
    `${theme.description} ` +
    `${theme.palette?.length ? `Color palette: ${theme.palette.join(", ")}. ` : ""}` +
    "Keep the room's architecture, layout, and camera angle unchanged — only add " +
    "wedding decor, florals, table settings, and lighting that match the theme. " +
    "Photorealistic, no people, no text or watermarks.";

  // -- Call Gemini: failure → 502, timeout → 504. -----------------------------
  const ai = new GoogleGenAI({ apiKey });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const call = ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { data: image.data, mimeType: image.mimeType! } },
            { text: prompt },
          ],
        },
      ],
    });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), GEMINI_TIMEOUT_MS);
    });
    const result = await Promise.race([call, timeout]);

    // The response mixes text and image parts — take the first image.
    const parts = result.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        const mime = part.inlineData.mimeType ?? "image/png";
        return Response.json({
          image: `data:${mime};base64,${part.inlineData.data}`,
          model: MODEL,
        });
      }
    }
    console.error("gemini render returned no image part");
    return fail(502, "The render came back without an image — try again.");
  } catch (e) {
    if (e instanceof Error && e.message === "timeout") {
      return fail(504, "The render took too long — try again.");
    }
    console.error("gemini render failed:", e instanceof Error ? e.message : e);
    return fail(502, "The render service is temporarily unavailable — try again.");
  } finally {
    clearTimeout(timer);
  }
}
