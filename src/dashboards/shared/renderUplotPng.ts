/**
 * Server-side uPlot PNG rendering for social preview cards.
 *
 * Handles:
 *  - Standard charts (mainSeries / extraSeries)
 *  - Heatmap charts (heatmapMeta)
 *  - Multi-panel dashboards (uses first panel only)
 */

import { Canvas } from "skia-canvas";
import { initDomShim, setShimCanvas } from "../../shared/uplotDomShim.ts";
import { buildUplotPayload } from "../../shared/uplotPayload.js";
import { divergentSeries } from "../../shared/series.js";
import { formatPower, formatPrice, formatEnergy } from "../../shared/echartsFormatters.ts";
import { HEATMAP_COLORS, heatmapPlugin } from "../../shared/uplotHeatmap.ts";

const LEGEND_HEIGHT = 44;

function drawLegend(u: any, ctx: any, canvasWidth: number, canvasHeight: number): void {
  const groups = new Map<string, string>();
  for (let si = 1; si < u.series.length; si++) {
    const s = u.series[si];
    if (!s || !s.label || s.show === false) continue;
    const color = typeof s.stroke === "function"
      ? s.stroke(u, si)
      : ((s.stroke as string) || "#888");
    if (!groups.has(s.label)) groups.set(s.label, color);
  }
  if (groups.size === 0) return;

  const items = Array.from(groups.entries());
  const font = '14px "DejaVu Sans", sans-serif';
  ctx.font = font;
  ctx.textBaseline = "middle";

  const markerSize = 10;
  const gap = 6;
  const itemGap = 20;
  const totalWidth = items.reduce((sum, [label]) => {
    const textWidth = ctx.measureText(label).width;
    return sum + markerSize + gap + textWidth + itemGap;
  }, 0) - itemGap;

  const legendTop = canvasHeight - LEGEND_HEIGHT;
  const legendCenterY = legendTop + LEGEND_HEIGHT / 2;
  const startX = Math.max(0, (canvasWidth - totalWidth) / 2);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, legendTop, canvasWidth, LEGEND_HEIGHT);
  ctx.strokeStyle = "rgba(0,0,0,0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(20, legendTop);
  ctx.lineTo(canvasWidth - 20, legendTop);
  ctx.stroke();

  let x = startX;
  for (const [label, color] of items) {
    ctx.fillStyle = color;
    ctx.fillRect(x, legendCenterY - markerSize / 2, markerSize, markerSize);
    x += markerSize + gap;
    ctx.fillStyle = "#333333";
    ctx.textAlign = "left";
    ctx.fillText(label, x, legendCenterY);
    x += ctx.measureText(label).width + itemGap;
  }
}

async function renderStandardChart(
  panel: Record<string, any>,
  response: Record<string, unknown>,
  width: number,
  height: number,
): Promise<Buffer> {
  const startTime = response.startTime as number | undefined;
  const interval = response.interval as number | undefined;
  const timezone = response.timezone as string | undefined;

  const mainSeries = panel.mainSeries as any[] | undefined;
  if (!mainSeries || mainSeries.length === 0) return renderBlankPng(width, height);

  const extraSeries = panel.extraSeries as any[] | undefined;
  const title = panel.title as string || response.title as string || "";
  const currencySymbol = panel.currencySymbol as string | undefined;

  const allSeries = [...mainSeries, ...(extraSeries || [])];
  const count = allSeries.reduce<number>((max, s) => Math.max(max, (s.data as any[])?.length ?? 0), 0);
  if (count === 0) return renderBlankPng(width, height);

  const timestamps = new Array<number>(count);
  for (let i = 0; i < count; i++) timestamps[i] = (startTime ?? 0) + i * (interval ?? 0);

  const needsDivergent = mainSeries.some((s: any) => s.fill);
  const processedMain = needsDivergent ? divergentSeries(mainSeries) : mainSeries;
  const mergedSeries = [...processedMain, ...(extraSeries || [])];

  const uplotResult = buildUplotPayload(title, timestamps, mergedSeries, currencySymbol);
  const { opts, data, seriesMeta } = uplotResult as {
    opts: Record<string, any>;
    data: (number | null)[][];
    seriesMeta?: Array<{ type?: string }>;
  };

  const canvas = new Canvas(Math.ceil(width), Math.ceil(height));
  setShimCanvas(canvas);
  const { default: uPlot } = await import("uplot");

  const axes = (opts.axes || []).map((axis: Record<string, any>) => {
    if (axis.values) return axis;
    if (axis.scale === "y" || axis.scale === "power" || axis.scale === "energy") {
      const fmt = axis.scale === "energy" ? formatEnergy : formatPower;
      return { ...axis, values: (_u: any, ticks: number[]) => ticks.map((v: number) => fmt(v)) };
    }
    if (axis.scale === "price-l" || axis.scale === "price-r" || axis.scale === "percent") {
      return { ...axis, values: (_u: any, ticks: number[]) => ticks.map((v: number) => formatPrice(v)) };
    }
    return axis;
  });

  if (panel.scales) opts.scales = { ...opts.scales, ...panel.scales };
  if (panel.axisSide != null && axes.length > 0) {
    for (const ax of axes) { if (ax.side != null) ax.side = panel.axisSide; }
  }
  if (panel.axisScale === "energy" && axes[1]) {
    axes[1].values = (_u: any, ticks: number[]) => ticks.map((v: number) => formatEnergy(v));
  }
  if (panel.xAxisSize != null && axes[0]) {
    axes[0].size = panel.xAxisSize;
    if (panel.xAxisSize === 0) axes[0].show = false;
  }
  if (panel.padding) opts.padding = panel.padding;

  if (seriesMeta && opts.series) {
    for (let i = 0; i < seriesMeta.length; i++) {
      const meta = seriesMeta[i];
      const s = opts.series[i + 1];
      if (s && meta?.type === "bar" && !s.paths) s.paths = (uPlot.paths as any).bars({ gap: 4 });
    }
  }

  const chartOpts: Record<string, any> = {
    ...opts,
    width,
    height,
    padding: opts.padding
      ? (Array.isArray(opts.padding)
        ? [opts.padding[0], opts.padding[1], Math.max(opts.padding[2] || 0, LEGEND_HEIGHT), opts.padding[3]]
        : [opts.padding, opts.padding, Math.max(opts.padding, LEGEND_HEIGHT), opts.padding])
      : [8, 8, LEGEND_HEIGHT, 8],
    axes,
    cursor: { show: false },
    select: { show: false },
    legend: { show: false },
    plugins: [],
    hooks: {
      drawClear: [() => {
        canvas.getContext("2d").fillStyle = "white";
        canvas.getContext("2d").fillRect(0, 0, canvas.width, canvas.height);
      }],
      draw: [(u: any) => drawLegend(u, canvas.getContext("2d"), width, height)],
    },
  };

  if (timezone) chartOpts.tzDate = (ts: number) => uPlot.tzDate(new Date(ts * 1e3), timezone);

  const dataWithX = [timestamps, ...data] as any;
  const chart = new uPlot(chartOpts as any, dataWithX, (_self: any, _init: Function) => { _init(); });
  // uPlot defers _commit via microTask; wait for it before exporting.
  await new Promise(r => setTimeout(r, 0));

  try {
    return await canvas.toBuffer("png");
  } finally {
    chart.destroy();
  }
}

async function renderHeatmapChart(
  panel: Record<string, any>,
  response: Record<string, unknown>,
  width: number,
  height: number,
): Promise<Buffer> {
  const timezone = response.timezone as string | undefined;
  const heatmapMeta = panel.heatmapMeta as {
    timestamps: number[];
    unitNames: string[];
    values: (number | null)[][];
  };
  if (!heatmapMeta) return renderBlankPng(width, height);

  const { timestamps, unitNames, values } = heatmapMeta;
  const count = timestamps.length;
  const unitCount = unitNames.length;
  if (count === 0 || unitCount === 0) return renderBlankPng(width, height);

  const canvas = new Canvas(Math.ceil(width), Math.ceil(height));
  setShimCanvas(canvas);
  const { default: uPlot } = await import("uplot");

  const maxLabelChars = unitNames.reduce((max, n) => Math.max(max, n.length), 0);
  const yAxisSize = Math.min(Math.max(maxLabelChars * 7 + 24, 80), 300);
  const ySplits: number[] = Array.from({ length: unitCount }, (_, i) => i);

  const chartOpts: Record<string, any> = {
    width,
    height,
    padding: [0, 0, 0, 0],
    scales: {
      x: { time: true },
      y: { range: [-0.5, Math.max(0.5, unitCount - 0.5)] },
    },
    cursor: { show: false },
    select: { show: false },
    legend: { show: false },
    series: [{ label: "Time" }, { show: false }, { show: false }],
    axes: [
      { stroke: "#888", grid: { stroke: "rgba(0,0,0,0.06)" }, font: '12px "DejaVu Sans", sans-serif' },
      {
        stroke: "#888", grid: { stroke: "rgba(0,0,0,0.06)" }, font: '12px "DejaVu Sans", sans-serif',
        size: yAxisSize,
        values: (_u: any, ticks: number[]) => ticks.map((v: number) => unitNames[Math.round(v)] ?? ""),
        splits: () => ySplits,
      },
    ],
    plugins: [heatmapPlugin(timestamps, unitNames, values)],
    hooks: {
      drawClear: [() => {
        canvas.getContext("2d").fillStyle = "white";
        canvas.getContext("2d").fillRect(0, 0, canvas.width, canvas.height);
      }],
    },
  };

  if (timezone) chartOpts.tzDate = (ts: number) => uPlot.tzDate(new Date(ts * 1e3), timezone);

  const yMin = new Array(count).fill(0);
  const yMax = new Array(count).fill(unitCount - 1);
  const dataWithX = [timestamps, yMin, yMax] as any;

  const chart = new uPlot(chartOpts as any, dataWithX, (_self: any, _init: Function) => { _init(); });
  await new Promise(r => setTimeout(r, 0));

  try {
    return await canvas.toBuffer("png");
  } finally {
    chart.destroy();
  }
}

export async function renderUplotPng(
  response: Record<string, unknown>,
  width: number,
  height: number,
): Promise<Buffer> {
  const panels = response.panels as Record<string, any>[] | undefined;
  if (!panels || panels.length === 0) return renderBlankPng(width, height);

  initDomShim();

  const panel = panels[0];
  if (panel.heatmapMeta) return renderHeatmapChart(panel, response, width, height);
  return renderStandardChart(panel, response, width, height);
}

async function renderBlankPng(width: number, height: number): Promise<Buffer> {
  const canvas = new Canvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toBuffer("png");
}
