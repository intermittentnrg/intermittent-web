import { expectPath } from './helpers.js';

describe('Area Navigation', () => {
  beforeEach(async () => {
    await browser.setWindowSize(1920, 1080);
  });

  it('desktop: area selection, persistence, and region switching', async () => {
    await browser.url('/europe/country/SE/7_days_ago_to_now/electricity_mix');

    await $('#location-selector-btn').click();
    await $('.area-node[data-node-type="region"][data-region="europe"] > .area-node-button').click();
    await $('.area-node[data-node-type="area-type"][data-region="europe"][data-area-type="country"] > .area-node-button').click();
    await $('.area-node[data-region="europe"][data-area-type="country"][data-area="AT"] label').click();
    await $('.area-menu').$('button=Apply').click();
    await expectPath('/europe/country/AT/7_days_ago_to_now/electricity_mix');

    await browser.url('/europe/country/all/7_days_ago_to_now/electricity_mix');
    await $('#location-selector-btn').click();
    await $('.area-node[data-node-type="region"][data-region="europe"] > .area-node-button').click();
    await $('.area-node[data-node-type="area-type"][data-region="europe"][data-area-type="country"] > .area-node-button').click();
    await expect($('.area-node[data-region="europe"][data-area-type="country"][data-area="all"] input')).toBeSelected();
    await $('.area-node[data-region="europe"][data-area-type="country"][data-area="all"] label').click();
    await $('.area-node[data-region="europe"][data-area-type="country"][data-area="SE"] label').click();
    await $('.area-node[data-region="europe"][data-area-type="country"][data-area="DE"] label').click();
    await $('.area-node[data-region="europe"][data-area-type="country"][data-area="AT"] label').click();
    await $('.area-menu').$('button=Apply').click();
    await expectPath('/europe/country/AT,DE,SE/7_days_ago_to_now/electricity_mix');

    await $('#location-selector-btn').click();
    await $('.area-node[data-node-type="region"][data-region="europe"] > .area-node-button').click();
    await $('.area-node[data-node-type="area-type"][data-region="europe"][data-area-type="country"] > .area-node-button').click();
    await expect($('.area-node[data-region="europe"][data-area-type="country"][data-area="SE"] input')).not.toBeSelected();
    await expect($('.area-node[data-region="europe"][data-area-type="country"][data-area="DE"] input')).not.toBeSelected();
    await expect($('.area-node[data-region="europe"][data-area-type="country"][data-area="AT"] input')).not.toBeSelected();
    await expect($('.area-node[data-region="europe"][data-area-type="country"][data-area="all"] input')).toBeSelected();

    await browser.url('/europe/country/SE/7_days_ago_to_now/electricity_mix');
    await $('#location-selector-btn').click();
    await $('.area-node[data-node-type="region"][data-region="usa"] > .area-node-button').click();
    await $('.area-node[data-node-type="area-type"][data-region="usa"][data-area-type="balancing_authority"] > .area-node-button').click();
    await $('.area-node[data-region="usa"][data-area-type="balancing_authority"][data-area="all"] label').click();
    await $('.area-menu').$('button=Apply').click();
    await expectPath('/usa/balancing_authority/all/7_days_ago_to_now/electricity_mix');
  });

  it('mobile: inline accordion navigation and close button work', async () => {
    await browser.setWindowSize(375, 812);
    await browser.url('/europe/country/SE/7_days_ago_to_now/electricity_mix');
    await $('#location-selector-btn').click();
    await expect($('.area-menu.open')).toBeDisplayed();

    const menu = await $('.area-menu');
    await expect(menu).toHaveText(expect.stringContaining('Europe'));
    await expect(menu).toHaveText(expect.stringContaining('Country'));
    await expect($('.area-node[data-node-type="region"][data-region="europe"].is-open')).toBeExisting();
    await expect($('.area-node[data-node-type="area-type"][data-area-type="country"].is-open')).toBeExisting();

    await $('.area-menu').$('button*=Usa').click();
    await expect($('.area-node[data-node-type="region"][data-region="usa"].is-open')).toBeExisting();
    await expect($('.area-node[data-node-type="region"][data-region="europe"].is-open')).not.toBeExisting();

    await $('.area-menu .step-close').click();
    await expect($('.area-menu.open')).not.toBeExisting();
  });
});
