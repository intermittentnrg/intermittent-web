/**
 * Split series into positive and negative sub-groups for divergent (import/export) charts.
 * Works with any object that has a `data` array of numbers.
 *
 * - Series with both positive and negative values are split into two:
 *   one with only positive values (_stack: "pos") and one with only
 *   negative values (_stack: "neg").
 * - Series with only positive or only negative values are kept as-is
 *   but assigned _stack: "pos" or _stack: "neg" respectively.
 *
 * @param input - Array of series objects, each with a `data` number array.
 * @returns New array with split/assigned series.
 */
export function divergentSeries(input) {
  const output = [];
  for (const series of input) {
    let hasPositive = false;
    let hasNegative = false;

    for (const value of series.data) {
      if (value > 0) hasPositive = true;
      if (value < 0) hasNegative = true;
      if (hasPositive && hasNegative) break;
    }

    if (hasPositive && hasNegative) {
      output.push({
        ...series,
        _stack: "pos",
        data: series.data.map((value) => Math.max(value, 0)),
      });
      output.push({
        ...series,
        _stack: "neg",
        data: series.data.map((value) => Math.min(value, 0)),
      });
    } else {
      output.push({
        ...series,
        _stack: hasNegative ? "neg" : "pos",
      });
    }
  }

  return output;
}
