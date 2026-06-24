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

async function expectLegacyStatus(url: string, status: number) {
  const response = await app.inject({ method: "GET", url });
  expect(response.statusCode).toBe(status);
}

async function expectLegacyRedirectContaining(url: string, patterns: string[]) {
  const response = await app.inject({ method: "GET", url });
  expect(response.statusCode).toBe(302);
  const loc: string = response.headers.location as string;
  for (const pattern of patterns) {
    expect(loc).toContain(pattern);
  }
}

describe("legacyDashboardRedirect", () => {
  describe("UID mappings", () => {
    it("translates legacy simulation dashboard URL params", async () => {
      await expectLegacyRedirect(
        "/d/bdhjgwdfjkwe8a/generation-imbalance?var-min_interval=1d&orgId=1&from=now-1y&to=now&timezone=browser&var-region=usa&var-area_type=balancing_authority&var-area=92&var-production_type=22&var-production_type=24&var-production_type=1&var-production_type=9&var-production_type=41&var-production_type=40&var-production_type=14&var-production_type=15&var-production_type=17&var-production_type=20&var-transmission=1&var-solar_multiply=1.5&var-wind_multiply=1&var-nuclear_multiply=6&var-demand_multiply=1",
        "/usa/balancing_authority/CAISO/1_year_ago_to_now/simulation?min_resolution=1d&production_type=battery,biogas,biomass,geothermal,hydro_large,hydro_small,nuclear,other,solar,wind_onshore&nuclear_multiplier=6&wind_multiplier=1&solar_multiplier=1.5&demand_multiplier=1",
      );
    });

    it("uses DB area rows for numeric legacy area ids", async () => {
      await expectLegacyRedirect(
        "/d/QCEg6rl7z/generation?from=now-7d&to=now&var-region=canada&var-area_type=region&var-area=261",
        "/canada/region/CA-AB/7_days_ago_to_now/generation",
      );
    });

    it("maps capture price europe uid to capture_price dashboard", async () => {
      // uid c563789e-77f2-44be-945e-c3b452532cd1 → capture_price
      await expectLegacyRedirectContaining(
        "/d/c563789e-77f2-44be-945e-c3b452532cd1/generation-capture-price-europe?orgId=1&from=now-5y&to=now&timezone=browser&var-area_type=country&var-area_type=zone&var-area=31&var-area=32&var-area=33&var-area=34&var-production_type=17&var-interval=1%20month",
        ["/capture_price", "production_type="],
      );
    });

    it("maps capture price australia uid to capture_price dashboard", async () => {
      // uid f0aa6f8a-b182-4548-94ee-2b5281d119a5 → capture_price
      await expectLegacyRedirectContaining(
        "/d/f0aa6f8a-b182-4548-94ee-2b5281d119a5/generation-capture-price-australia?orgId=1&from=2009-12-31T14:00:00.000Z&to=now&timezone=Australia%2FBrisbane&var-area_type=region&var-area=$__all&var-production_type=27&var-interval=1%20month",
        ["/capture_price"],
      );
    });

    it("maps prices-plotly-map uid to price_map dashboard", async () => {
      // uid fa529e06-ff34-415d-adf1-dde1a6f28350 → price_map
      await expectLegacyRedirectContaining(
        "/d/fa529e06-ff34-415d-adf1-dde1a6f28350/prices-plotly-map?var-min_interval=1h&orgId=1&from=now-7d&to=now&timezone=utc&var-region=europe&var-area=$__all&var-scale_max=200",
        ["/price_map"],
      );
    });

    it("returns 404 for unknown legacy uid", async () => {
      await expectLegacyStatus(
        "/d/00000000-0000-0000-0000-000000000000/unknown-dashboard",
        404,
      );
    });

    it("returns 404 for unported prices-heatmap uid", async () => {
      // da5dd0d3-c7e8-4e17-b187-19f7e12bbdf7 = prices-heatmap — not ported
      await expectLegacyStatus(
        "/d/da5dd0d3-c7e8-4e17-b187-19f7e12bbdf7/prices-heatmap?orgId=1&from=now-2y&to=now&timezone=browser&var-area=$__all",
        404,
      );
    });
  });

  describe("date handling", () => {
    it("handles now/y Grafana macro (round to year) for from", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/d/ed438e5f-3c21-4f76-b5c5-3b0083a998ba/demand-yoy?orgId=1&from=now%2Fy&to=now%2Fy&timezone=browser&var-region=europe&var-area_type=country&var-area=12&var-interval=1%20month",
      });
      expect(response.statusCode).toBe(302);
      // now/y should resolve to the current year (e.g. "2026")
      const loc: string = response.headers.location as string;
      expect(loc).toContain("/europe/country/");
      // date range should be <currentYear>_to_<currentYear>
      const currentYear = String(new Date().getUTCFullYear());
      expect(loc).toContain(`/${currentYear}_to_${currentYear}/`);
      expect(loc).toContain("/demand_yoy");
    });

    it("handles now/y Grafana macro for generation-yoy", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/d/d85aa31b-fd17-484e-85bf-23bdc1ef5af2/generation-yoy?orgId=1&from=now%2Fy&to=now%2Fy&timezone=browser&var-region=europe&var-area_type=country&var-area=30&var-production_type=20&var-interval=1%20day",
      });
      expect(response.statusCode).toBe(302);
      const loc: string = response.headers.location as string;
      expect(loc).toContain("/generation_yoy");
      const currentYear = String(new Date().getUTCFullYear());
      expect(loc).toContain(`/${currentYear}_to_${currentYear}/`);
    });

    it("preserves hyphens in absolute ISO date strings", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/d/bdkf9e861xu68a/energy-kwh?var-min_interval=30d&orgId=1&from=2014-12-31T23:00:00.000Z&to=now&timezone=browser&var-region=europe&var-area_type=country&var-area_type=zone&var-area=30&var-area=33&var-area=34&var-production_type=6&var-unit=443&var-unit=444",
      });
      expect(response.statusCode).toBe(302);
      const loc: string = response.headers.location as string;
      // Date should have hyphens preserved, not underscores
      expect(loc).toContain("2014-12-31T23:00:00.000Z_to_now");
      // Commas in query values should not be URL-encoded
      expect(loc).not.toContain("units=443%2C444");
      expect(loc).toContain("units=443,444");
    });
  });

  describe("comma encoding in query params", () => {
    it("does not URL-encode commas in units values", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/d/bdkf9e861xu68a/energy-kwh?var-min_interval=30d&orgId=1&from=now-1y&to=now&var-region=usa&var-area_type=balancing_authority&var-area=92&var-unit=443&var-unit=444",
      });
      expect(response.statusCode).toBe(302);
      const loc: string = response.headers.location as string;
      expect(loc).toContain("units=443,444");
      expect(loc).not.toContain("%2C");
    });
  });
});
