export async function expectPath(path) {
  await browser.waitUntil(async () => (await browser.getUrl()).endsWith(path), {
    timeoutMsg: `expected current URL to end with ${path}, got ${await browser.getUrl()}`,
  });
}
