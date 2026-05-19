import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function runNodeSmokeTest(script: string) {
  const result = spawnSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    timeout: 10_000,
  });

  expect(
    {
      status: result.status,
      signal: result.signal,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.error?.message,
    },
    result.stderr || result.stdout || result.error?.message || `node exited with ${result.status ?? result.signal}`,
  ).toMatchObject({ status: 0, signal: null });

  return result.stdout;
}

describe("@napi-rs/canvas", () => {
  it("renders a PNG directly", () => {
    const stdout = runNodeSmokeTest(String.raw`
      const { createCanvas } = require("@napi-rs/canvas");
      const canvas = createCanvas(320, 180);
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, 320, 180);
      context.fillStyle = "#222222";
      context.font = "24px DejaVu Sans, sans-serif";
      context.fillText("canvas smoke test", 20, 60);
      const png = canvas.toBuffer("image/png");
      if (png.subarray(0, 8).compare(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) !== 0) {
        throw new Error("canvas output is not a PNG");
      }
      if (png.length <= 1000) throw new Error("canvas PNG is unexpectedly small: " + png.length);
      console.log("canvas PNG bytes: " + png.length);
    `);

    expect(stdout).toContain("canvas PNG bytes:");
  });

  it("renders an ECharts PNG through the same SSR canvas path used by price-map frames", () => {
    const stdout = runNodeSmokeTest(String.raw`
      const { createCanvas } = require("@napi-rs/canvas");
      const echarts = require("echarts");
      echarts.setPlatformAPI({ createCanvas: () => createCanvas(1, 1) });
      const width = 320;
      const height = 180;
      const canvas = createCanvas(width, height);
      const chart = echarts.init(canvas, undefined, { renderer: "canvas", ssr: true, width, height });
      try {
        chart.setOption({
          backgroundColor: "#ffffff",
          textStyle: { fontFamily: "DejaVu Sans, sans-serif" },
          title: { text: "ECharts canvas smoke test" },
          xAxis: { type: "category", data: ["a", "b", "c"] },
          yAxis: { type: "value" },
          series: [{ type: "line", data: [1, 3, 2] }],
        });
        const png = chart.renderToCanvas().toBuffer("image/png");
        if (png.subarray(0, 8).compare(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) !== 0) {
          throw new Error("ECharts output is not a PNG");
        }
        if (png.length <= 1000) throw new Error("ECharts PNG is unexpectedly small: " + png.length);
        console.log("ECharts PNG bytes: " + png.length);
      } finally {
        chart.dispose();
      }
    `);

    expect(stdout).toContain("ECharts PNG bytes:");
  });
});
