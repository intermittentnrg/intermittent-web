export function normalizedMetricKey(metric: string) {
  return (metric.split("/").at(-1) || metric)
    .replace(/_negative$/, "")
    .replace(/^\d+_/, "");
}

export function metricColor(metric: string) {
  const key = normalizedMetricKey(metric);
  return (
    {
      biomass_and_waste: "rgb(128, 224, 167)",
      nuclear: "rgb(213, 0, 50)",
      lignite: "rgb(92, 26, 35)",
      hard_coal: "rgb(137, 137, 137)",
      gas: "rgb(198, 163, 201)",
      hydro: "rgb(2, 77, 188)",
      other: "rgb(241, 194, 27)",
      other_renewable: "rgb(199, 156, 148)",
      wind: "rgb(152, 205, 251)",
      wind_onshore: "rgb(152, 205, 251)",
      solar: "rgb(236, 232, 26)",
      import: "rgb(124, 46, 163)",
      export: "rgb(124, 46, 163)",
      transmission: "rgb(124, 46, 163)",
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
