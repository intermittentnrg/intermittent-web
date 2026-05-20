import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/server.ts";

const app = await buildApp();

afterAll(async () => {
  await app.close();
});

async function expectGeoipRedirect(headers: Record<string, string>, location: string) {
  const response = await app.inject({ method: "GET", url: "/", headers });
  expect(response.statusCode).toBe(302);
  expect(response.headers.location).toBe(location);
}

describe("geoipRedirect", () => {
  it("redirects to default (US48) with no GeoIP headers", async () => {
    await expectGeoipRedirect({}, "/usa/country/US48/7_days_ago_to_now/electricity_mix");
  });

  it.each([
    ["DE", "/europe/country/DE/7_days_ago_to_now/electricity_mix"],
    ["FR", "/europe/country/FR/7_days_ago_to_now/electricity_mix"],
    ["GB", "/europe/country/GB/7_days_ago_to_now/electricity_mix"],
  ])("redirects European country %s", async (country, location) => {
    await expectGeoipRedirect({ "cf-ipcountry": country, "cf-region-code": "", "cf-ipcontinent": "EU" }, location);
  });

  it.each([
    ["ON", "/canada/region/CA-ON/7_days_ago_to_now/electricity_mix"],
    ["AB", "/canada/region/CA-AB/7_days_ago_to_now/electricity_mix"],
    ["BC", "/usa/country/US48/7_days_ago_to_now/electricity_mix"],
  ])("redirects Canadian region %s", async (regionCode, location) => {
    await expectGeoipRedirect({ "cf-ipcountry": "CA", "cf-region-code": regionCode, "cf-ipcontinent": "NA" }, location);
  });

  it.each([
    ["NSW", "/australia/region/NSW1/7_days_ago_to_now/electricity_mix"],
    ["QLD", "/australia/region/QLD1/7_days_ago_to_now/electricity_mix"],
    ["SA", "/australia/region/SA1/7_days_ago_to_now/electricity_mix"],
    ["TAS", "/australia/region/TAS1/7_days_ago_to_now/electricity_mix"],
    ["VIC", "/australia/region/VIC1/7_days_ago_to_now/electricity_mix"],
    ["WA", "/australia/region/WEM/7_days_ago_to_now/electricity_mix"],
    ["NT", "/australia/region/all/7_days_ago_to_now/electricity_mix"],
    ["ACT", "/australia/region/all/7_days_ago_to_now/electricity_mix"],
  ])("redirects Australian region %s", async (regionCode, location) => {
    await expectGeoipRedirect({ "cf-ipcountry": "AU", "cf-region-code": regionCode, "cf-ipcontinent": "OC" }, location);
  });

  it.each([
    ["US", "NA", "/usa/country/US48/7_days_ago_to_now/electricity_mix"],
    ["BR", "SA", "/brazil/region/all/7_days_ago_to_now/electricity_mix"],
    ["TW", "AS", "/taiwan/country/TW/7_days_ago_to_now/electricity_mix"],
    ["ZA", "AF", "/south_africa/country/ZA/7_days_ago_to_now/electricity_mix"],
    ["MX", "NA", "/mexico/country/MX/7_days_ago_to_now/electricity_mix"],
    ["AR", "SA", "/argentina/country/AR/7_days_ago_to_now/electricity_mix"],
  ])("redirects country %s", async (country, continent, location) => {
    await expectGeoipRedirect({ "cf-ipcountry": country, "cf-region-code": "", "cf-ipcontinent": continent }, location);
  });

  it.each([
    ["IS", "", "EU", "/europe/country/all/7_days_ago_to_now/electricity_mix"],
    ["GG", "", "EU", "/europe/country/GB/7_days_ago_to_now/electricity_mix"],
    ["JP", "13", "AS", "/japan/region/all/7_days_ago_to_now/electricity_mix"],
    ["GL", "", "NA", "/usa/country/US48/7_days_ago_to_now/electricity_mix"],
    ["PY", "", "SA", "/brazil/region/all/7_days_ago_to_now/electricity_mix"],
    ["NG", "", "AF", "/south_africa/country/ZA/7_days_ago_to_now/electricity_mix"],
    ["FJ", "", "OC", "/australia/region/all/7_days_ago_to_now/electricity_mix"],
    ["AQ", "", "AN", "/usa/country/US48/7_days_ago_to_now/electricity_mix"],
    ["XX", "", "", "/usa/country/US48/7_days_ago_to_now/electricity_mix"],
  ])("uses fallback for %s/%s/%s", async (country, regionCode, continent, location) => {
    await expectGeoipRedirect({ "cf-ipcountry": country, "cf-region-code": regionCode, "cf-ipcontinent": continent }, location);
  });

  it("handles lowercase country and continent codes", async () => {
    await expectGeoipRedirect({ "cf-ipcountry": "de", "cf-region-code": "", "cf-ipcontinent": "eu" }, "/europe/country/DE/7_days_ago_to_now/electricity_mix");
  });

  it("handles lowercase region codes", async () => {
    await expectGeoipRedirect({ "cf-ipcountry": "CA", "cf-region-code": "on", "cf-ipcontinent": "na" }, "/canada/region/CA-ON/7_days_ago_to_now/electricity_mix");
  });
});
