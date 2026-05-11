const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { register } = require('tsx/cjs/api');

let app;

function discoverPublicIp() {
  if (process.env.PUBLIC_IP) return process.env.PUBLIC_IP;

  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }

  return '127.0.0.1';
}

const appPort = Number(process.env.E2E_PORT || 3100);
const baseUrl = process.env.BASE_URL || `http://${discoverPublicIp()}:${appPort}`;
const chromeArgs = ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1920,1080'];
if (process.env.HEADLESS === '1' || process.env.HEADLESS === 'true') {
  chromeArgs.unshift('--headless=new');
}

exports.config = {
  runner: 'local',
  hostname: process.env.SELENIUM_HOST || 'selenium-hub.monitoring.int.mog.se',
  port: Number(process.env.SELENIUM_PORT || 4444),
  path: process.env.SELENIUM_PATH || '/wd/hub',

  specs: ['./test/e2e/**/*.spec.js'],
  maxInstances: Number(process.env.WDIO_MAX_INSTANCES || 1),

  capabilities: [{
    browserName: process.env.BROWSER || 'chrome',
    'wdio:enforceWebDriverClassic': true,
    'goog:chromeOptions': {
      args: chromeArgs,
    },
  }],

  logLevel: process.env.WDIO_LOG_LEVEL || 'error',
  bail: 0,
  baseUrl,
  waitforTimeout: Number(process.env.WDIO_WAITFOR_TIMEOUT || 15000),
  connectionRetryTimeout: Number(process.env.WDIO_CONNECTION_RETRY_TIMEOUT || 120000),
  connectionRetryCount: Number(process.env.WDIO_CONNECTION_RETRY_COUNT || 3),

  framework: 'mocha',
  reporters: ['spec'],

  mochaOpts: {
    ui: 'bdd',
    timeout: Number(process.env.WDIO_MOCHA_TIMEOUT || 120000),
  },

  async onPrepare(config) {
    if (process.env.BASE_URL) {
      console.log(`Using external app at ${process.env.BASE_URL}`);
      return;
    }

    process.env.NODE_ENV = process.env.NODE_ENV || 'test';
    register();
    const { startServer } = require('./src/server.ts');
    app = await startServer({ host: '0.0.0.0', port: appPort });

    console.log(`Started test app at ${config.baseUrl}`);
  },

  async afterTest(test, context, { error, passed }) {
    if (passed) return;

    const screenshotDir = path.join(process.cwd(), 'tmp', 'wdio-screenshots');
    fs.mkdirSync(screenshotDir, { recursive: true });

    const safeTitle = test.title.replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '');
    const screenshotPath = path.join(screenshotDir, `${Date.now()}-${safeTitle}.png`);
    await browser.saveScreenshot(screenshotPath);
    console.log(`Saved failure screenshot: ${screenshotPath}`);
  },

  async onComplete() {
    if (app) await app.close();
  }, 
};
