import type { FastifyInstance } from "fastify";
import {
  dashboardSpa,
  health,
  nordpool,
} from "./controllers.js";
import { geoipRedirect } from "./geoipController.js";
import { legacyDashboardRedirect } from "./legacyRedirectController.js";
import { electricityMix } from "./dashboards/electricityMix.js";
import {
  generation,
  generationMinMax,
  generationTotal,
  generationYoy,
  simulations,
} from "./dashboards/generation.js";
import { demand, demandMinMax, demandYoy } from "./dashboards/demand.js";
import { transmission } from "./dashboards/transmission.js";
import {
  perUnit,
  perUnitMovingCapacity,
  perUnitPeak,
  perUnitTotal,
  perUnitBattery,
} from "./dashboards/perUnit.js";
import { capturePrice, prices } from "./dashboards/prices.js";
import { maps, priceMap, sweden } from "./dashboards/misc.js";

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
    per_unit_battery: perUnitBattery,
    capture_price: capturePrice,
    simulations,
    maps,
    price_map: priceMap,
    sweden,
    prices,
  };

  for (const [endpoint, handler] of Object.entries(dataHandlers)) {
    app.get(
      `/:region/:area_type/:area/:date_range/${endpoint}/echarts.json`,
      handler as never,
    );
    app.get(
      `/:region/:area_type/:area/:date_range/${endpoint}/echarts.png`,
      handler as never,
    );
  }

  app.get(
    "/:region/:area_type/:area/:date_range/:dashboard",
    dashboardSpa as never,
  );

  app.get("/", geoipRedirect);
}
