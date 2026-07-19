// POST /api/analyze — the hackathon's required Gemini feature.
//
// Runs ONLY on the server (Next.js route handler): GEMINI_API_KEY is read from
// process.env here and never shipped to the browser. The client sends a small
// JSON body of downscaled photos; Gemini returns a structured wedding-theme
// report constrained by a response schema, so the frontend never has to parse
// free-form prose.

import { GoogleGenAI, Type } from "@google/genai";

// Vercel kills functions at 10s by default — the Gemini call needs more room.
export const maxDuration = 60;

const MODEL = "gemini-3.5-flash";
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGES = 12;
// Give up before Vercel's 60s ceiling so the client gets a real 504, not a cut
// connection.
const GEMINI_TIMEOUT_MS = 50_000;

// The report shape Gemini must fill in. Mirrors ThemeReport in lib/theme.ts —
// keep the two in sync.
const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    theme_name: { type: Type.STRING },
    one_liner: { type: Type.STRING },
    description: { type: Type.STRING },
    venue_observations: { type: Type.STRING },
    color_palette: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          hex: { type: Type.STRING },
        },
        required: ["name", "hex"],
      },
    },
    decor: { type: Type.ARRAY, items: { type: Type.STRING } },
    florals: { type: Type.ARRAY, items: { type: Type.STRING } },
    tags: { type: Type.ARRAY, items: { type: Type.STRING } },
    photo_coverage: {
      type: Type.OBJECT,
      properties: {
        verdict: { type: Type.STRING, enum: ["good", "usable", "poor"] },
        advice: { type: Type.STRING },
      },
      required: ["verdict", "advice"],
    },
  },
  required: [
    "theme_name",
    "one_liner",
    "description",
    "venue_observations",
    "color_palette",
    "decor",
    "florals",
    "tags",
    "photo_coverage",
  ],
};

const SYSTEM_INSTRUCTION = `You are WeddingAI's wedding designer. The user uploads photos of ONE real venue or space; the same photos will also be reconstructed into a walkable 3D scene with Gaussian splatting.

Rules:
- Ground everything in what is actually visible in the photos — reference concrete features (light, materials, architecture, greenery) in venue_observations.
- Propose ONE cohesive wedding theme tailored to this specific space: an evocative theme_name, a one_liner pitch, a short description, a 4-6 color palette (valid #rrggbb hex values), 3-5 decor suggestions, 3-5 floral suggestions, and 3-6 short lowercase tags.
- photo_coverage judges whether the set is good enough for 3D reconstruction: "good" (sharp, well-lit, generous overlap from many angles), "usable" (workable with gaps), or "poor" (blurry, sparse, reflective, or textureless). advice = one or two concrete reshoot tips.
- Be specific and concise. No markdown in any field.`;

type InlineImage = { data: string; mimeType: string };

function fail(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // Deploy misconfiguration, not a user error. No key material in responses.
    return fail(500, "The design service is not configured on this server.");
  }

  // -- Validate input: missing/malformed → 400, per the hackathon spec. -------
  let images: InlineImage[];
  try {
    const body = (await request.json()) as { images?: InlineImage[] };
    images = body.images ?? [];
  } catch {
    return fail(400, "Request body must be JSON with an `images` array.");
  }
  if (!Array.isArray(images) || images.length === 0) {
    return fail(400, "Send at least one photo to analyze.");
  }
  if (images.length > MAX_IMAGES) {
    return fail(400, `Send at most ${MAX_IMAGES} photos per analysis.`);
  }
  for (const img of images) {
    if (typeof img?.data !== "string" || img.data.length === 0) {
      return fail(400, "Each image needs base64 `data`.");
    }
    if (!ALLOWED_TYPES.has(img.mimeType)) {
      return fail(400, "Unsupported file type — send JPEG, PNG, or WebP images.");
    }
  }

  // -- Call Gemini: failure → 502, timeout → 504. ----------------------------
  const ai = new GoogleGenAI({ apiKey });
  const parts = [
    ...images.map((img) => ({
      inlineData: { data: img.data, mimeType: img.mimeType },
    })),
    {
      text: `These ${images.length} photos are a sample of one venue. Design the wedding theme and assess the photo set.`,
    },
  ];

  let raw: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const call = ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.7,
      },
    });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), GEMINI_TIMEOUT_MS);
    });
    raw = (await Promise.race([call, timeout])).text;
  } catch (e) {
    if (e instanceof Error && e.message === "timeout") {
      return fail(504, "The design service took too long — try again with fewer photos.");
    }
    console.error("gemini call failed:", e instanceof Error ? e.message : e);
    return fail(502, "The design service is temporarily unavailable — try again.");
  } finally {
    clearTimeout(timer);
  }

  // -- Parse the structured output: malformed → 502 with a graceful message. -
  try {
    if (!raw) throw new Error("empty response");
    return Response.json({ report: JSON.parse(raw), model: MODEL });
  } catch {
    console.error("gemini returned an empty or unparseable response");
    return fail(502, "The design service returned an unexpected answer — try again.");
  }
}
