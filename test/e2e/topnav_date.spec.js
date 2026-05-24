import { expectPath } from './helpers.js';

describe('Date Navigation', () => {
  it('date range inputs are present', async () => {
    await browser.url('/europe/country/SE/7_days_ago_to_now/electricity_mix');
    await expect($('#date-from')).toBeExisting();
    await expect($('#date-to')).toBeExisting();
  });

  it('preset dropdown button is present', async () => {
    await browser.url('/europe/country/SE/7_days_ago_to_now/electricity_mix');
    await expect($('.date-preset-btn')).toBeExisting();
  });

  it('date range URL params are passed to page', async () => {
    await browser.url('/europe/country/SE/2024-01-01_to_2024-01-31/electricity_mix');
    await expect($('#date-from')).toBeExisting();
    await expect($('#date-to')).toBeExisting();
  });

  it('selecting preset date updates URL', async () => {
    await browser.url('/europe/country/SE/7_days_ago_to_now/electricity_mix');
    await $('.date-preset-btn').click();
    await $('.date-preset-option[data-preset="last_30_days"]').click();
    await expectPath('/europe/country/SE/30_days_ago_to_now/electricity_mix');
  });

  it('changing date inputs updates URL', async () => {
    await browser.url('/europe/country/SE/2024-01-15_to_2024-01-30/electricity_mix');
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

    await browser.url('/europe/country/SE/2023-06-01_to_2023-06-30/electricity_mix');
    await expect($('#date-from')).toHaveValue('2023-06-01');
    await expect($('#date-to')).toHaveValue('2023-06-30');
  });
});
