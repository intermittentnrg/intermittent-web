describe('Electricity Mix / Generation Dashboard options', () => {
  it('production type dropdown behavior', async () => {
    await browser.url('/europe/country/SE/2025-01-01_to_2025-01-02/generation');

    const selector = await $('.production-type-selector');
    await selector.$('.dropdown-btn').click();
    await selector.$$('.dropdown-option')[1].waitForExist({ timeout: 10000 });

    await expect(selector.$('#production-type-all')).toBeSelected();
    await selector.$('label=Hydro Water Reservoir').click();
    await expect(selector.$('#production-type-all')).not.toBeSelected();
  });
});

describe('Per Unit Dashboard', () => {
  it('production type filters unit dropdown', async () => {
    await browser.url('/europe/country/SE/2025-01-01_to_2025-01-02/per_unit');
    await expect($('#main-chart canvas')).toBeExisting();

    const selector = await $('.unit-selector');
    await selector.$('.dropdown-btn').click();
    await selector.$('.dropdown-option').waitForExist({ timeout: 10000 });
    await expect(selector.$('#unit-all')).toBeExisting();
    await selector.$('button=Apply').click();
    await expect($('#main-chart canvas')).toBeExisting();
  });
});
