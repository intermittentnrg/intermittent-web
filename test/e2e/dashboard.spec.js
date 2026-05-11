const { expectPath } = require('./helpers');

const dataDashboards = [
  'generation',
  'demand',
  'demand_min_max',
  'demand_yoy',
  'prices',
  'generation_total',
  'generation_min_max',
  'electricity_mix',
  'transmission',
  'capture_price',
  'per_unit',
  'per_unit_peak',
  'per_unit_total',
  'per_unit_moving_capacity',
  'simulations',
];

describe('Dashboard', () => {
  for (const dashboard of dataDashboards) {
    it(`${dashboard} chart loads`, async () => {
      await browser.url(`/europe/country/SE/2025-01-01_to_2025-01-02/${dashboard}`);
      await expect($('#main-chart canvas')).toBeExisting();
      await expect($('body')).not.toHaveText(expect.stringContaining('Failed to load data'));
    });
  }
});

describe('Dashboard Navigation', () => {
  it('dashboard page loads correctly', async () => {
    await browser.url('/europe/country/SE/7_days_ago_to_now/electricity_mix');
    await expect($('#main-chart canvas')).toBeExisting();
    await expect($('body')).not.toHaveText(expect.stringContaining('Error'));
    await expect($$('script[type="module"]')).toBeElementsArrayOfSize({ gte: 1 });
  });

  it('dashboard navigation updates URL and preserves state', async () => {
    await browser.url('/europe/country/SE/7_days_ago_to_now/electricity_mix');
    await $('a=Generation').click();
    await $('.dashboard-dropdown').$('a=Generation').click();
    await expectPath('/europe/country/SE/7_days_ago_to_now/generation');

    await browser.url('/europe/country/AT/7_days_ago_to_now/electricity_mix');
    await $('a=Generation').click();
    await $('.dashboard-dropdown').$('a=Generation').click();
    await expectPath('/europe/country/AT/7_days_ago_to_now/generation');

    await browser.url('/europe/country/SE/2024-01-01_to_2024-01-31/electricity_mix');
    await $('a=Generation').click();
    await $('.dashboard-dropdown').$('a=Generation').click();
    await expectPath('/europe/country/SE/2024-01-01_to_2024-01-31/generation');
  });
});
