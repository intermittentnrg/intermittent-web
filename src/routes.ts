import type { FastifyInstance } from "fastify";
import { dashboardSpa, geoipRedirect, health, nordpool } from "./controllers.js";
import { legacyDashboardRedirect } from "./legacyRedirectController.js";
import { electricityMix } from "./electricityMix.js";
import { demand, emptyDashboard, generation, generationTotal, prices } from "./basicDashboards.js";
import { demandMinMax, demandYoy, generationMinMax, generationYoy, transmission } from "./moreDashboards.js";
import { perUnit, perUnitPeak, perUnitTotal } from "./perUnitDashboards.js";
import { capturePrice, maps, perUnitMovingCapacity, simulations, sweden } from "./specialDashboards.js";
import { makeDashboardImageHandler } from "./dashboardImage.js";

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
  app.get("/d/:uid/:dashboard", legacyDashboardRedirect as never);

  const dataHandlers = {
    electricity_mix: electricityMix,
    generation,
    generation_total: generationTotal,
    generation_min_max: generationMinMax,
    generation_yoy: generationYoy,
    demand,
    demand_min_max: demandMinMax,
    demand_yoy: demandYoy,
    transmission,
    per_unit: perUnit,
    per_unit_peak: perUnitPeak,
    per_unit_total: perUnitTotal,
    per_unit_moving_capacity: perUnitMovingCapacity,
    capture_price: capturePrice,
    simulations,
    maps,
    sweden,
    prices,
  };

  for (const [endpoint, handler] of Object.entries(dataHandlers)) {
    app.get(`/:region/:area_type/:area/:date_range/${endpoint}/data`, handler as never);
  }

  const implementedEndpoints = new Set(["electricity_mix", "generation", "generation_total", "generation_min_max", "generation_yoy", "demand", "demand_min_max", "demand_yoy", "transmission", "per_unit", "per_unit_peak", "per_unit_total", "per_unit_moving_capacity", "capture_price", "simulations", "maps", "sweden", "prices"]);
  for (const endpoint of dashboardDataEndpoints.filter((name) => !implementedEndpoints.has(name))) {
    app.get(`/:region/:area_type/:area/:date_range/${endpoint}/data`, async (request, reply) => {
      (request.params as Record<string, string>).endpoint = endpoint;
      return emptyDashboard(request as never, reply);
    });
  }

  const dashboardImageHandler = makeDashboardImageHandler(dataHandlers as never);
  app.get("/:region/:area_type/:area/:date_range/:dashboard/image", dashboardImageHandler as never);
  app.get("/:region/:area_type/:area/:date_range/:dashboard/image.png", dashboardImageHandler as never);
  app.get("/:region/:area_type/:area/:date_range/:dashboard/image.webp", dashboardImageHandler as never);

  app.get("/:region/:area_type/:area/:date_range/:dashboard", dashboardSpa as never);

  app.get("/", geoipRedirect);
}
