const STABLE_PALETTE = [
  "#5470c6",
  "#91cc75",
  "#fac858",
  "#ee6666",
  "#73c0de",
  "#3ba272",
  "#fc8452",
  "#9a60b4",
  "#ea7ccc",
  "#2f4554",
  "#61a0a8",
  "#d48265",
  "#749f83",
  "#ca8622",
  "#bda29a",
  "#6e7074",
  "#546570",
  "#c4ccd3",
];

export function normalizedMetricKey(metric: string) {
  return (metric.split("/").at(-1) || metric).replace(/_negative$/, "");
}

export function stableColor(key: string) {
  const normalized = normalizedMetricKey(key);
  let hash = 0;

  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
  }

  return STABLE_PALETTE[Math.abs(hash) % STABLE_PALETTE.length];
}

export function metricColor(metric: string) {
  const key = normalizedMetricKey(metric);
  return (
    {
      "02_nuclear": "rgb(213, 0, 50)",
      "05_gas": "rgb(198, 163, 201)",
      "06_hydro": "rgb(2, 77, 188)",
      "09_wind": "rgb(152, 205, 251)",
      "09_wind_onshore": "rgb(152, 205, 251)",
      "11_solar": "rgb(236, 232, 26)",
    } as Record<string, string>
  )[key];
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
