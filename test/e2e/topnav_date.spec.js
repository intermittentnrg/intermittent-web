import { expectPath } from './helpers.js';

describe('Date Navigation', () => {
  it('date range inputs are present', async () => {
    await browser.url('/europe/country/SE/7_days_ago_to_now/electricity_mix');
    await expect($('#date-from')).toBeExisting();
    await expect($('#date-to')).toBeExisting();
  });

  it('date range dropdown button is present', async () => {
    await browser.url('/europe/country/SE/7_days_ago_to_now/electricity_mix');
    await expect($('.date-range-btn')).toBeExisting();
  });

  it('date range URL params are passed to page', async () => {
    await browser.url('/europe/country/SE/2024-01-01_to_2024-01-31/electricity_mix');
    await expect($('#date-from')).toBeExisting();
    await expect($('#date-to')).toBeExisting();
  });

  it('apply button is present inside dropdown', async () => {
    await browser.url('/europe/country/SE/7_days_ago_to_now/electricity_mix');
    await $('.date-range-btn').click();
    await expect($('.date-range-menu .dropdown__apply')).toBeExisting();
  });

  it('selecting preset date updates URL', async () => {
    await browser.url('/europe/country/SE/7_days_ago_to_now/electricity_mix');
    await $('.date-range-btn').click();
    await $('.dropdown__option[data-preset="last_30_days"]').click();
    await expectPath('/europe/country/SE/30_days_ago_to_now/electricity_mix');
  });

  it('typing dates and clicking apply updates URL', async () => {
    await browser.url('/europe/country/SE/2024-01-15_to_2024-01-30/electricity_mix');
    await $('.date-range-btn').click();

    const fromInput = await $('#date-from');
    const toInput = await $('#date-to');

    await fromInput.click();
    await browser.keys(['Control', 'a']);
    await browser.keys('2024-01-01');
    await toInput.click();
    await browser.keys(['Control', 'a']);
    await browser.keys('2024-01-31');

    await $('.date-range-menu .dropdown__apply').click();
    await expectPath('/europe/country/SE/2024-01-01_to_2024-01-31/electricity_mix');
  });

  it('typing dates and pressing Enter updates URL', async () => {
    await browser.url('/europe/country/SE/2024-01-15_to_2024-01-30/electricity_mix');
    await $('.date-range-btn').click();

    const fromInput = await $('#date-from');
    const toInput = await $('#date-to');

    await fromInput.click();
    await browser.keys(['Control', 'a']);
    await browser.keys('2024-01-01');
    await toInput.click();
    await browser.keys(['Control', 'a']);
    await browser.keys('2024-01-31');
    await browser.keys('Enter');
    await expectPath('/europe/country/SE/2024-01-01_to_2024-01-31/electricity_mix');
  });

  it('focusing from input clears preset selection', async () => {
    await browser.url('/europe/country/SE/7_days_ago_to_now/electricity_mix');
    await $('.date-range-btn').click();

    const dateRange = await $('#topnav-date');

    // Initially a preset is selected
    await expect(dateRange.$('.date-range-preset .dropdown__option.selected')).toBeExisting();

    const fromInput = await $('#date-from');
    await fromInput.click();

    // After focusing the input, no preset should be selected
    await expect(dateRange.$('.date-range-preset .dropdown__option.selected')).not.toBeExisting();
  });
});
