import { describe, expect, it } from "vitest";
import { getEchartsForSsr } from "../../src/dashboards/shared/echartsSsr.ts";

async function renderCanvasPng() {
  const { createCanvas } = await import("@napi-rs/canvas");

  const canvas = createCanvas(320, 180);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, 320, 180);
  context.fillStyle = "#222222";
  context.font = "24px DejaVu Sans, sans-serif";
  context.fillText("canvas smoke test", 20, 60);

  return canvas.toBuffer("image/png");
}

async function renderEchartsCanvasPng() {
  const { createCanvas } = await import("@napi-rs/canvas");

  const echarts = await getEchartsForSsr();
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

    return chart.renderToCanvas().toBuffer("image/png");
  } finally {
    chart.dispose();
  }
}

describe("@napi-rs/canvas", () => {
  it("renders a PNG directly", async () => {
    const png = await renderCanvasPng();

    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.length).toBeGreaterThan(1000);
  });

  it("renders an ECharts PNG through the same SSR canvas path used by price-map frames", async () => {
    const png = await renderEchartsCanvasPng();

    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.length).toBeGreaterThan(1000);
  });
});
