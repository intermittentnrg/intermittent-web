import type { FastifyReply, FastifyRequest } from "fastify";
import echarts = require("echarts");
import sharp from "sharp";

export type DashboardImageParams = {
  region: string;
  area_type: string;
  area: string;
  date_range: string;
  dashboard: string;
};

type Query = Record<string, string | number | boolean | undefined>;
type DashboardPayload = { options?: unknown; height?: number };

type HeaderFn = (name: string, value: string) => FakeReply;
class FakeReply {
  statusCode = 200;
  headers: Record<string, string> = {};
  payload: unknown;

  code(code: number) { this.statusCode = code; return this; }
  status(code: number) { return this.code(code); }
  header: HeaderFn = (name, value) => { this.headers[name.toLowerCase()] = value; return this; };
  send(payload: unknown) { this.payload = payload; return payload; }
}

type DashboardDataHandler = (request: FastifyRequest, reply: FastifyReply) => unknown | Promise<unknown>;

export function makeDashboardImageHandler(handlers: Record<string, DashboardDataHandler>) {
  return async function dashboardImageHandler(
    request: FastifyRequest<{ Params: DashboardImageParams; Querystring: Query }>,
    reply: FastifyReply,
  ) {
    const dashboard = request.params.dashboard;
    const dataHandler = handlers[dashboard];
    if (!dataHandler) {
      return reply.code(404).send({ error: "unknown_dashboard", dashboard });
    }

    const width = 1200;
    const height = 630;
    const format = request.url.endsWith(".png") ? "png" : "webp";

    const fakeReply = new FakeReply();
    const fakeRequest = { ...request, params: request.params, query: request.query } as unknown as FastifyRequest;
    const maybePayload = await dataHandler(fakeRequest, fakeReply as unknown as FastifyReply);
    const payload = (fakeReply.payload ?? maybePayload) as DashboardPayload;

    if (fakeReply.statusCode >= 400 || !payload?.options) {
      return reply.code(fakeReply.statusCode || 500).send(payload || { error: "image_data_failed" });
    }

    const svg = renderEchartsSvg(payload.options, width, height);
    const png = await sharp(Buffer.from(svg)).png().toBuffer();

    if (format === "webp") {
      const webp = await sharp(png).webp({ quality: 90 }).toBuffer();
      return reply
        .header("Content-Type", "image/webp")
        .header("Cache-Control", "public, max-age=3600")
        .send(webp);
    }

    return reply
      .header("Content-Type", "image/png")
      .header("Cache-Control", "public, max-age=3600")
      .send(png);
  };
}

function renderEchartsSvg(options: unknown, width: number, height: number) {
  const chart = echarts.init(null, undefined, { renderer: "svg", ssr: true, width, height });
  try {
    chart.setOption(options as never);
    return chart.renderToSVGString();
  } finally {
    chart.dispose();
  }
}

