const DEFAULT_COLORS: Record<string, string> = {
  biomass_and_waste: "rgb(128, 224, 167)",
  nuclear: "rgb(213, 0, 50)",
  lignite: "rgb(92, 26, 35)",
  hard_coal: "rgb(137, 137, 137)",
  gas: "rgb(198, 163, 201)",
  hydro: "rgb(2, 77, 188)",
  hydro_water_reservoir: "rgb(2, 77, 188)",
  other: "rgb(241, 194, 27)",
  other_renewable: "rgb(199, 156, 148)",
  wind: "rgb(152, 205, 251)",
  wind_onshore: "rgb(152, 205, 251)",
  solar: "rgb(236, 232, 26)",
  import: "rgb(124, 46, 163)",
  export: "rgb(124, 46, 163)",
  transmission: "rgb(124, 46, 163)",
};

function colorForMetric(metric: string, overrides?: Record<string, string>) {
  const key = (metric.split("/").at(-1) || metric)
    .replace(/_negative$/, "")
    .replace(/^\d+_/, "");
  return (overrides ?? DEFAULT_COLORS)[key] ?? DEFAULT_COLORS[key];
}

/**
 * Returns a colour resolver bound to an optional `colors` query parameter.
 *
 * Format: `metric:color;metric:color`
 * Example: `wind:rgb(255,153,0);solar:rgb(153,0,255)`
 *
 * Use CSS `rgb(r,g,b)` — `#hex` won't work in query params.
 * When no query value is given, returns the default resolver.
 */
export function colorsFromQuery(
  value: string | undefined,
): (metric: string) => string | undefined {
  if (!value) return colorForMetric;

  const overrides: Record<string, string> = {};
  for (const part of value.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;
    const metric = trimmed.slice(0, colonIdx).trim();
    const color = trimmed.slice(colonIdx + 1).trim();
    if (metric && color) {
      overrides[metric] = color;
    }
  }

  return Object.keys(overrides).length > 0
    ? (metric: string) => colorForMetric(metric, overrides)
    : colorForMetric;
}

/**
 * Cool-to-warm-to-black gradient: pale blue → blue → purple → pink → yellow → orange → red → near-black.
 * Oldest years are faded cool tones, current year is bold near-black.
 * A pink intermediate avoids muddy browns when transitioning from purple to yellow.
 * @param t position in [0, 1] — 0 gives pale blue, 1 gives near-black
 * @returns CSS rgb() string
 */
export function yoyColor(t: number): string {
  const stops: Array<[number, number, number, number]> = [
    [0.0, 210, 230, 245],  // pale blue
    [0.2, 90, 165, 230],   // blue
    [0.4, 165, 105, 200],  // purple
    [0.55, 245, 225, 60],  // bright yellow
    [0.7, 245, 160, 45],   // orange
    [0.85, 230, 65, 65],   // red
    [1.0, 25, 25, 25],     // near-black
  ];

  const pos = Math.max(0, Math.min(1, t));

  for (let i = 0; i < stops.length - 1; i++) {
    if (pos >= stops[i][0] && pos <= stops[i + 1][0]) {
      const segment = (pos - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
      const r = Math.round(stops[i][1] + (stops[i + 1][1] - stops[i][1]) * segment);
      const g = Math.round(stops[i][2] + (stops[i + 1][2] - stops[i][2]) * segment);
      const b = Math.round(stops[i][3] + (stops[i + 1][3] - stops[i][3]) * segment);
      return `rgb(${r}, ${g}, ${b})`;
    }
  }

  return "rgb(25, 25, 25)";
}

export function areaColor(area: string) {
  return (
    (
      {
        SE: "rgba(0, 100, 200, 0.7)",
        NO: "rgba(0, 150, 100, 0.7)",
        DK: "rgba(200, 50, 50, 0.7)",
        FI: "rgba(150, 0, 150, 0.7)",
        DE: "rgba(200, 150, 0, 0.7)",
      } as Record<string, string>
    )[area] || "rgba(150,150,150,0.7)"
  );
}
