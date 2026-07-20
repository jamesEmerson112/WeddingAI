// Pre-written wedding themes for the demo flow: pick one and it immediately
// satisfies /api/render's theme payload — no Gemini call needed to select.
// The descriptions are written as image-generation prompts (concrete visual
// detail), because that's exactly where they end up.

import type { ThemeReport } from "./theme";

export type PresetTheme = {
  key: string;
  emoji: string;
  report: ThemeReport;
};

// photo_coverage only means something when Gemini has actually inspected the
// photos, so presets carry a neutral placeholder and the UI hides the coverage
// banner for preset-sourced themes (advice === "").
const COVERAGE = { verdict: "usable" as const, advice: "" };

export const PRESET_THEMES: PresetTheme[] = [
  {
    key: "sage-ivory",
    emoji: "🌿",
    report: {
      theme_name: "Sage & Ivory Garden",
      one_liner: "An airy garden romance in soft greens and warm ivory.",
      description:
        "A fresh garden-party wedding: ivory linens with flowing sheer drapery, olive branches and trailing eucalyptus laid along the tables, whitewashed wooden chairs, unlacquered brass candlesticks with cream taper candles, and warm afternoon sunlight.",
      venue_observations: "",
      color_palette: [
        { name: "Ivory", hex: "#F6F1E7" },
        { name: "Sage", hex: "#8BA07A" },
        { name: "Olive", hex: "#5F6F4E" },
        { name: "Champagne", hex: "#E4D9C4" },
        { name: "Bark", hex: "#5A4F48" },
      ],
      decor: [
        "Sheer ivory drapery",
        "Olive-branch table runners",
        "Brass candlesticks",
        "Whitewashed wood chairs",
      ],
      florals: ["White garden roses", "Eucalyptus", "Ranunculus", "Baby's breath"],
      tags: ["garden", "organic", "daylight", "romantic"],
      photo_coverage: COVERAGE,
    },
  },
  {
    key: "cherry-blossom",
    emoji: "🌸",
    report: {
      theme_name: "Cherry-Blossom Pastel",
      one_liner: "Dreamy pastel pinks under drifting blossom branches.",
      description:
        "A soft springtime wedding: hanging cherry-blossom branches over the tables, blush silk runners and ribbon chair sashes, pale pink and white place settings with pearl accents, and diffused dreamy pastel light throughout the room.",
      venue_observations: "",
      color_palette: [
        { name: "Blush", hex: "#F7E4E8" },
        { name: "Petal", hex: "#EFB7C4" },
        { name: "Rose", hex: "#D98A9E" },
        { name: "Mist", hex: "#C9C4C2" },
        { name: "Mauve", hex: "#8A5A6A" },
      ],
      decor: [
        "Hanging blossom branches",
        "Blush silk table runners",
        "Ribbon chair sashes",
        "Pearl-accent place settings",
      ],
      florals: ["Cherry blossoms", "Blush peonies", "Sweet peas", "White tulips"],
      tags: ["pastel", "spring", "dreamy", "soft"],
      photo_coverage: COVERAGE,
    },
  },
  {
    key: "burgundy-brass",
    emoji: "🕯️",
    report: {
      theme_name: "Moody Burgundy & Brass",
      one_liner: "A candlelit, deep-toned reception with brass warmth.",
      description:
        "A moody candlelit reception: deep burgundy velvet linens, tall brass candelabras crowded with amber candles, smoked-glass goblets, dark wood tables, and low warm lighting that leaves the corners of the room in soft shadow.",
      venue_observations: "",
      color_palette: [
        { name: "Burgundy", hex: "#6E1F2A" },
        { name: "Wine", hex: "#8E2F3C" },
        { name: "Brass", hex: "#B08D57" },
        { name: "Candle Glow", hex: "#E8C39E" },
        { name: "Charcoal", hex: "#2E2226" },
      ],
      decor: [
        "Brass candelabras",
        "Burgundy velvet linens",
        "Smoked-glass goblets",
        "Dark wood tables",
      ],
      florals: [
        "Burgundy dahlias",
        "Deep red garden roses",
        "Dried amaranth",
        "Dark foliage",
      ],
      tags: ["moody", "candlelight", "evening", "dramatic"],
      photo_coverage: COVERAGE,
    },
  },
  {
    key: "coastal",
    emoji: "🏖️",
    report: {
      theme_name: "Coastal Blue & Sand",
      one_liner: "Breezy seaside calm in blues, linen, and driftwood.",
      description:
        "A breezy coastal wedding: seafoam gauze runners on sand-toned linen, driftwood and lantern centerpieces with rope accents, scattered dune grasses, white and dusty-blue place settings, and bright airy daylight like an open shoreline.",
      venue_observations: "",
      color_palette: [
        { name: "Sea", hex: "#4A7BA6" },
        { name: "Mist", hex: "#A9C6D9" },
        { name: "Sand", hex: "#E8DCC0" },
        { name: "Foam", hex: "#F4F0E6" },
        { name: "Driftwood", hex: "#8A755A" },
      ],
      decor: [
        "Driftwood centerpieces",
        "Rope-wrapped lanterns",
        "Seafoam gauze runners",
        "Dune-grass accents",
      ],
      florals: [
        "White hydrangeas",
        "Dusty blue thistle",
        "Beach grasses",
        "White lisianthus",
      ],
      tags: ["coastal", "airy", "relaxed", "daylight"],
      photo_coverage: COVERAGE,
    },
  },
  {
    key: "golden-hour",
    emoji: "✨",
    report: {
      theme_name: "Golden Hour",
      one_liner: "Everything glowing in warm late-afternoon amber.",
      description:
        "A golden-hour wedding: the whole room washed in warm amber light, caramel silk runners, amber glass votives flickering down the tables, gold-rimmed place settings, warm string lights overhead, and long soft shadows like late afternoon sun.",
      venue_observations: "",
      color_palette: [
        { name: "Honey", hex: "#F0D9A8" },
        { name: "Amber", hex: "#E0A26A" },
        { name: "Copper", hex: "#C9762F" },
        { name: "Terracotta", hex: "#A04A45" },
        { name: "Umber", hex: "#5A3B32" },
      ],
      decor: [
        "Amber glass votives",
        "Caramel silk runners",
        "Gold-rimmed place settings",
        "Warm string lights",
      ],
      florals: [
        "Toffee roses",
        "Golden amaranth",
        "Bronze chrysanthemums",
        "Wheat stems",
      ],
      tags: ["golden hour", "warm", "glowing", "sunset"],
      photo_coverage: COVERAGE,
    },
  },
  {
    key: "vintage-film",
    emoji: "🎞️",
    report: {
      theme_name: "Vintage Film",
      one_liner: "A nostalgic, film-grain romance in faded warm tones.",
      description:
        "A nostalgic vintage wedding with the warmth of old film: lace overlays on cream linens, mismatched antique brass frames and candle lanterns, dusty-rose and sepia tones, a subtle film-grain softness, and gentle tungsten-warm light.",
      venue_observations: "",
      color_palette: [
        { name: "Sepia", hex: "#C8A97E" },
        { name: "Cream", hex: "#EFE6D4" },
        { name: "Faded Rose", hex: "#C4907F" },
        { name: "Teal Gray", hex: "#7E938F" },
        { name: "Umber", hex: "#6B5442" },
      ],
      decor: [
        "Lace table overlays",
        "Antique brass frames",
        "Candle lanterns",
        "Aged-paper menus",
      ],
      florals: [
        "Dusty roses",
        "Dried hydrangea",
        "Bunny tail grass",
        "Cream carnations",
      ],
      tags: ["vintage", "film", "nostalgic", "warm"],
      photo_coverage: COVERAGE,
    },
  },
];
