function parseIntervalString(str = "15m") {
  const table: Record<string, number> = {
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
    "6h": 21600,
    "12h": 43200,
    "1d": 86400,
    "1w": 604800,
    "1M": 2592000,
  };
  return table[str] || 900;
}

export function calculateInterval(
  from: Date,
  to: Date,
  widthValue?: string,
  minIntervalValue?: string,
) {
  const minInterval = parseIntervalString(minIntervalValue || "15m");
  const width = Math.max(Number(widthValue || 1000), 1);
  const targetInterval = Math.floor(
    (to.getTime() - from.getTime()) / 1000 / width,
  );
  if (targetInterval <= minInterval) return minInterval;
  return (
    [900, 1800, 3600, 7200, 14400, 21600, 43200, 86400, 172800, 604800, 2592000]
      .filter((i) => i <= targetInterval)
      .at(-1) || minInterval
  );
}

export function calculateYoyInterval(
  widthValue?: string,
  minIntervalValue?: string,
) {
  const min =
    (
      {
        "1h": 3600,
        "6h": 21600,
        "12h": 43200,
        "1d": 86400,
        "1w": 604800,
        "1M": 2592000,
      } as Record<string, number>
    )[minIntervalValue || "1d"] || 86400;
  const target = 31536000 / Math.max(Number(widthValue || 1000), 1);
  if (target <= min) return min;
  return (
    [3600, 21600, 43200, 86400, 172800, 604800, 2592000]
      .filter((i) => i <= target)
      .at(-1) || min
  );
}
