import type { FastifyInstance } from "fastify";
import { apiStub, dashboardSpa, geoipRedirect, health, imageStub, nordpool } from "./controllers.js";
import { electricityMix } from "./electricityMix.js";
import { demand, generation, generationTotal, prices } from "./basicDashboards.js";

const dashboardDataEndpoints = [
  "electricity_mix",
  "generation",
  "generation_min_max",
  "generation_total",
  "generation_yoy",
  "demand",
  "demand_min_max",
  "demand_yoy",
  "transmission",
  "per_unit",
  "per_unit_peak",
  "per_unit_total",
  "per_unit_moving_capacity",
  "capture_price",
  "prices",
  "simulations",
  "maps",
  "sweden",
];

export async function registerRoutes(app: FastifyInstance) {
  app.get("/health", health);
  app.get("/nordpool", nordpool);

  app.get("/:region/:area_type/:area/:date_range/electricity_mix/data", electricityMix as never);
  app.get("/:region/:area_type/:area/:date_range/generation/data", generation as never);
  app.get("/:region/:area_type/:area/:date_range/generation_total/data", generationTotal as never);
  app.get("/:region/:area_type/:area/:date_range/demand/data", demand as never);
  app.get("/:region/:area_type/:area/:date_range/prices/data", prices as never);

  const implementedEndpoints = new Set(["electricity_mix", "generation", "generation_total", "demand", "prices"]);
  for (const endpoint of dashboardDataEndpoints.filter((name) => !implementedEndpoints.has(name))) {
    app.get(`/:region/:area_type/:area/:date_range/${endpoint}/data`, async (request, reply) => {
      (request.params as Record<string, string>).endpoint = endpoint;
      return apiStub(request as never, reply);
    });
  }

  app.get("/:region/:area_type/:area/:date_range/:dashboard/image", dashboardImageHandler);
  app.get("/:region/:area_type/:area/:date_range/:dashboard/image.png", dashboardImageHandler);

  app.get("/:region/:area_type/:area/:date_range/:dashboard", dashboardSpa as never);

  app.get("/", geoipRedirect);
}

async function dashboardImageHandler(request: Parameters<typeof imageStub>[0], reply: Parameters<typeof imageStub>[1]) {
  return imageStub(request, reply);
}
