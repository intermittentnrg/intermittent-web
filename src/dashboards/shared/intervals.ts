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
