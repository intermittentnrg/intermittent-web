import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/server.ts";

const app = await buildApp();

afterAll(async () => {
  await app.close();
});

async function expectLegacyRedirect(url: string, location: string) {
  const response = await app.inject({ method: "GET", url });
  expect(response.statusCode).toBe(302);
  expect(response.headers.location).toBe(location);
}

describe("legacyDashboardRedirect", () => {
  it("translates legacy simulation dashboard URL params", async () => {
    await expectLegacyRedirect(
      "/d/bdhjgwdfjkwe8a/generation-imbalance?var-min_interval=1d&orgId=1&from=now-1y&to=now&timezone=browser&var-region=usa&var-area_type=balancing_authority&var-area=92&var-production_type=22&var-production_type=24&var-production_type=1&var-production_type=9&var-production_type=41&var-production_type=40&var-production_type=14&var-production_type=15&var-production_type=17&var-production_type=20&var-transmission=1&var-solar_multiply=1.5&var-wind_multiply=1&var-nuclear_multiply=6&var-demand_multiply=1",
      "/usa/balancing_authority/CAISO/1_year_ago_to_now/simulation?min_interval=1d&production_type=battery%2Cbiogas%2Cbiomass%2Cgeothermal%2Chydro_large%2Chydro_small%2Cnuclear%2Cother%2Csolar%2Cwind_onshore&nuclear_multiplier=6&wind_multiplier=1&solar_multiplier=1.5&demand_multiplier=1",
    );
  });

  it("uses DB area rows for numeric legacy area ids", async () => {
    await expectLegacyRedirect(
      "/d/QCEg6rl7z/generation?from=now-7d&to=now&var-region=canada&var-area_type=region&var-area=261",
      "/canada/region/CA-AB/7_days_ago_to_now/generation",
    );
  });
});
