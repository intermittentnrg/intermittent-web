import type { MapSeriesOption } from "echarts/types/dist/echarts";
import type { AnyRow } from "./types.ts";
import type { CustomSeriesLabelFormatter } from "../../shared/echartsFormatters.ts";

export type MapTimelineFrame = {
  name: string;
  layout: { title: string };
  data: [{ locations: string[]; z: number[] }];
};

/** A label option that accepts either a standard ECharts formatter or our custom descriptor. */
type CustomLabel = Omit<NonNullable<MapSeriesOption["label"]>, "formatter"> & {
  formatter?: CustomSeriesLabelFormatter;
};

export type MapTimelineOptions = {
  title: string;
  valueName: string;
  tooltip: string;
  visualMap: Record<string, unknown>;
  graphics?: unknown[];
  map?: Partial<MapSeriesOption>;
  label?: CustomLabel | MapSeriesOption["label"];
};

export function buildMapTimelineFrames(rows: AnyRow[], timeZoneLabel = "UTC") {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const frames = new Map<number, MapTimelineFrame>();

  for (const row of rows) {
    const time = Number(row.time);
    if (!frames.has(time)) {
      frames.set(time, {
        data: [{ locations: [], z: [] }],
        layout: { title: `${formatter.format(new Date(time))} ${timeZoneLabel}` },
        name: String(time),
      });
    }

    const frame = frames.get(time)!;
    frame.data[0].locations.push(String(row.metric));
    frame.data[0].z.push(Number(row.value));
  }

  return [...frames.values()];
}

export function buildMapTimelineOptions(frames: MapTimelineFrame[], options: MapTimelineOptions) {
  const build = (frame: MapTimelineFrame | undefined) =>
    (frame?.data[0]?.locations || []).map((location, index) => ({
      name: location,
      value: frame!.data[0].z[index],
    }));

  return {
    baseOption: {
      timeline: {
        axisType: "category",
        autoPlay: false,
        playInterval: 150,
        data: frames.map((frame, index) => ({ value: index, text: frame.layout.title })),
        left: "10%",
        right: "10%",
        bottom: 20,
      },
      title: {
        text: frames[0]?.layout?.title || options.title,
        left: "center",
        top: 24,
        textStyle: { fontFamily: "DejaVu Sans, sans-serif", fontSize: 54, fontWeight: 700 },
      },
      tooltip: { trigger: "item", formatter: options.tooltip },
      visualMap: options.visualMap,
      graphic: options.graphics || [],
      series: [
        {
          name: options.valueName,
          type: "map",
          map: "world",
          roam: true,
          nameProperty: "zoneName",
          itemStyle: {
            borderColor: "#333333",
            borderWidth: 1.4,
            areaColor: "#d9d9d9",
          },
          emphasis: {
            itemStyle: {
              borderColor: "#111111",
              borderWidth: 2,
            },
          },
          ...options.map,
          label: options.label,
          data: build(frames[0]),
        },
      ],
      animation: false,
    },
    options: frames.map((frame) => ({
      title: { text: frame.layout.title },
      series: [{ data: build(frame) }],
    })),
  };
}
