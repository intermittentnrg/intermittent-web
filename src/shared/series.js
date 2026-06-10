/**
 * Split series into positive and negative stacks for divergent (import/export) charts.
 * Works with any object that has a `data` array of numbers.
 *
 * - Series with both positive and negative values are split into two:
 *   one with only positive values (stack: "pos") and one with only
 *   negative values (stack: "neg").
 * - Series with only positive or only negative values are kept as-is
 *   but assigned stack: "pos" or stack: "neg" respectively.
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
        stack: "pos",
        data: series.data.map((value) => Math.max(value, 0)),
      });
      output.push({
        ...series,
        stack: "neg",
        data: series.data.map((value) => Math.min(value, 0)),
      });
    } else {
      output.push({
        ...series,
        stack: hasNegative ? "neg" : "pos",
      });
    }
  }

  return output;
}
