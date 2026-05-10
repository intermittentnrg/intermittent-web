import type { FastifyInstance } from "fastify";
import { apiStub, dashboardSpa, geoipRedirect, health, imageStub, nordpool } from "./controllers.js";
import { electricityMix } from "./electricityMix.js";
import { demand, emptyDashboard, generation, generationTotal, prices } from "./basicDashboards.js";
import { demandMinMax, demandYoy, generationMinMax, generationYoy, transmission } from "./moreDashboards.js";
import { perUnit, perUnitPeak, perUnitTotal } from "./perUnitDashboards.js";
import { capturePrice, maps, perUnitMovingCapacity, simulations, sweden } from "./specialDashboards.js";

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
  app.get("/:region/:area_type/:area/:date_range/generation_min_max/data", generationMinMax as never);
  app.get("/:region/:area_type/:area/:date_range/generation_yoy/data", generationYoy as never);
  app.get("/:region/:area_type/:area/:date_range/demand/data", demand as never);
  app.get("/:region/:area_type/:area/:date_range/demand_min_max/data", demandMinMax as never);
  app.get("/:region/:area_type/:area/:date_range/demand_yoy/data", demandYoy as never);
  app.get("/:region/:area_type/:area/:date_range/transmission/data", transmission as never);
  app.get("/:region/:area_type/:area/:date_range/per_unit/data", perUnit as never);
  app.get("/:region/:area_type/:area/:date_range/per_unit_peak/data", perUnitPeak as never);
  app.get("/:region/:area_type/:area/:date_range/per_unit_total/data", perUnitTotal as never);
  app.get("/:region/:area_type/:area/:date_range/per_unit_moving_capacity/data", perUnitMovingCapacity as never);
  app.get("/:region/:area_type/:area/:date_range/capture_price/data", capturePrice as never);
  app.get("/:region/:area_type/:area/:date_range/simulations/data", simulations as never);
  app.get("/:region/:area_type/:area/:date_range/maps/data", maps as never);
  app.get("/:region/:area_type/:area/:date_range/sweden/data", sweden as never);
  app.get("/:region/:area_type/:area/:date_range/prices/data", prices as never);

  const implementedEndpoints = new Set(["electricity_mix", "generation", "generation_total", "generation_min_max", "generation_yoy", "demand", "demand_min_max", "demand_yoy", "transmission", "per_unit", "per_unit_peak", "per_unit_total", "per_unit_moving_capacity", "capture_price", "simulations", "maps", "sweden", "prices"]);
  for (const endpoint of dashboardDataEndpoints.filter((name) => !implementedEndpoints.has(name))) {
    app.get(`/:region/:area_type/:area/:date_range/${endpoint}/data`, async (request, reply) => {
      (request.params as Record<string, string>).endpoint = endpoint;
      return emptyDashboard(request as never, reply);
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
