import type { FastifyInstance } from "fastify";
import { dashboardSpa, geoipRedirect, health, nordpool } from "./controllers.js";
import { legacyDashboardRedirect } from "./legacyRedirectController.js";
import { electricityMix } from "./dashboards/electricityMix.js";
import { generation, generationMinMax, generationTotal, generationYoy, simulations } from "./dashboards/generation.js";
import { demand, demandMinMax, demandYoy } from "./dashboards/demand.js";
import { transmission } from "./dashboards/transmission.js";
import { perUnit, perUnitMovingCapacity, perUnitPeak, perUnitTotal } from "./dashboards/perUnit.js";
import { capturePrice, prices } from "./dashboards/prices.js";
import { maps, sweden } from "./dashboards/misc.js";
import { makeDashboardImageHandler } from "./dashboardImage.js";

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

  const dashboardImageHandler = makeDashboardImageHandler(dataHandlers as never);
  app.get("/:region/:area_type/:area/:date_range/:dashboard/image", dashboardImageHandler as never);
  app.get("/:region/:area_type/:area/:date_range/:dashboard/image.png", dashboardImageHandler as never);
  app.get("/:region/:area_type/:area/:date_range/:dashboard/image.webp", dashboardImageHandler as never);

  app.get("/:region/:area_type/:area/:date_range/:dashboard", dashboardSpa as never);

  app.get("/", geoipRedirect);
}
