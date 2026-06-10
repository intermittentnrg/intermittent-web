import { describe, expect, it } from "vitest";
import { divergentSeries } from "../../src/dashboards/shared/series.ts";

const posSeries = { name: "pos", data: [1000, 1000] }
const negSeries = { name: "neg", data: [-1000, -1000] }
const mixSeries = { name: "mix", data: [1000, -1000] }

describe("divergentSeries", () => {
  it("returns pos/neg series", () => {
    const input = [
      posSeries,
      negSeries
    ];

    expect(divergentSeries(input)).toHaveLength(2);
  });
  it("splits mixed series", () => {
    const input = [
      mixSeries
    ];

    const output = divergentSeries(input);
    expect(output).toHaveLength(2);
    expect(output[1].name).toEqual("mix");
  });
});
