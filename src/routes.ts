import type { FastifyInstance } from "fastify";
import {
  dashboardSpa,
  health,
  nordpool,
} from "./controllers.ts";
import { geoipRedirect } from "./geoipController.ts";
import { legacyDashboardRedirect } from "./legacyRedirectController.ts";
import { electricityMix } from "./dashboards/electricityMix.ts";
import {
  generation,
  generationMinMax,
  generationTotal,
  generationYoy,
  simulation,
} from "./dashboards/generation.ts";
import { demand, demandMinMax, demandYoy } from "./dashboards/demand.ts";
import { transmission } from "./dashboards/transmission.ts";
import {
  perUnit,
  perUnitMovingCapacity,
  perUnitPeak,
  perUnitTotal,
  perUnitBattery,
} from "./dashboards/perUnit.ts";
import { capturePrice, prices } from "./dashboards/prices.ts";
import { generationOfPeakMap, maps, priceMap, sweden } from "./dashboards/misc.ts";

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
    simulation,
    maps,
    price_map: priceMap,
    generation_of_peak_map: generationOfPeakMap,
    sweden,
    prices,
  };

  for (const [endpoint, handler] of Object.entries(dataHandlers)) {
    app.get(
      `/:region/:area_type/:area/:date_range/${endpoint}.json`,
      handler as never,
    );
    app.get(
      `/:region/:area_type/:area/:date_range/${endpoint}.png`,
      handler as never,
    );
    // Keep old /echarts.png as an alias for backward compatibility
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
