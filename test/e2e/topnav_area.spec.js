import { expectPath } from './helpers.js';

describe('Area Navigation', () => {
  beforeEach(async () => {
    await browser.setWindowSize(1920, 1080);
  });

  it('desktop: area selection, persistence, and region switching', async () => {
    await browser.url('/europe/country/SE/7_days_ago_to_now/electricity_mix');

    await $('#location-selector-btn').click();
    await $('.area-menu').$('button*=Europe').click();
    await $('.area-menu').$('button*=Country').click();
    await $('.area-menu').$('label*=SE').click();
    await $('.area-menu').$('label*=AT').click();
    await $('.area-menu').$('button=Apply').click();
    await expectPath('/europe/country/AT/7_days_ago_to_now/electricity_mix');

    await browser.url('/europe/country/all/7_days_ago_to_now/electricity_mix');
    await $('#location-selector-btn').click();
    await $('.area-menu').$('button*=Europe').click();
    await $('.area-menu').$('button*=Country').click();
    await expect($('#area-all')).toBeSelected();
    await $('.area-menu').$('label=All areas').click();
    await $('.area-menu').$('label*=SE').click();
    await $('.area-menu').$('label*=DE').click();
    await $('.area-menu').$('label*=AT').click();
    await $('.area-menu').$('button=Apply').click();
    await expectPath('/europe/country/AT,DE,SE/7_days_ago_to_now/electricity_mix');

    await $('#location-selector-btn').click();
    await $('.area-menu').$('button*=Europe').click();
    await $('.area-menu').$('button*=Country').click();
    await expect($('#area-SE')).toBeSelected();
    await expect($('#area-DE')).toBeSelected();
    await expect($('#area-AT')).toBeSelected();

    await browser.url('/europe/country/SE/7_days_ago_to_now/electricity_mix');
    await $('#location-selector-btn').click();
    await $('.area-menu').$('button*=Usa').click();
    await $('.area-menu').$('button*=Balancing Authority').click();
    await $('.area-menu').$('label=All areas').click();
    await $('.area-menu').$('button=Apply').click();
    await expectPath('/usa/balancing_authority/all/7_days_ago_to_now/electricity_mix');
  });

  it('mobile: accordion navigation and close button work', async () => {
    await browser.setWindowSize(375, 812);
    await browser.url('/europe/country/SE/7_days_ago_to_now/electricity_mix');
    await $('#location-selector-btn').click();
    await expect($('.area-menu.open')).toBeDisplayed();

    const menu = await $('.area-menu');
    await expect(menu).toHaveText(expect.stringContaining('Country'));
    await $('.area-menu [data-step="areas"] .step-back').click();
    await expect(menu).toHaveText(expect.stringContaining('Europe'));
    await $('.area-menu [data-step="areaType"] .step-back').click();
    await expect($('.area-menu [data-step="region"].visible')).toBeExisting();
    await $('.area-menu [data-step="region"] .step-close').click();
    await expect($('.area-menu.open')).not.toBeExisting();
  });
});
