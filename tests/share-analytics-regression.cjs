const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const origin = 'https://cpi-next.com';

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const errors = [];
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    // Serve the production origin locally; never send test traffic to Google.
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/blank') return route.fulfill({ contentType: 'text/html', body: '<body></body>' });
      const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.abort();
      return route.fulfill({ body: fs.readFileSync(file), contentType: ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' })[path.extname(file)] || 'application/octet-stream' });
    });
    const page = await context.newPage();
    await page.goto(origin + '/blank');
    await page.addScriptTag({ path: path.join(root, 'share-payload.js') });
    const urls = await page.evaluate(() => [
      cpiSharePayload.buildUrl('overview', { p: { o: '11.5-11.7', e: '11.6-12.1', n: '11.5-11.8', h: '11.4-11.5' }, f: { b: 53 }, b: { i: '1413', s: 'clear', p: 12.19 } }),
      cpiSharePayload.buildUrl('history', { d: '2026-09-27', c: { e: 15, h: 17 }, b: { i: '4583', b: 'unregistered', s: 'easy', p: 12.11 }, u: 0 }),
      cpiSharePayload.buildUrl('daily', { d: '2026-10-01', i: [{ i: '4096', g: 'easy', a: 0 }] }),
    ]);
    const events = () => page.evaluate(() => (window.dataLayer || []).filter(entry => entry[0] === 'event').map(entry => ({ name: entry[1], params: entry[2] })));
    for (let index = 0; index < urls.length; index++) {
      await page.goto(urls[index]);
      await page.waitForFunction(() => window.dataLayer?.some(entry => entry[0] === 'event' && entry[1] === 'page_view'));
      const views = (await events()).filter(event => event.name === 'page_view');
      assert.equal(views.length, 1);
      assert.equal(views[0].params.share_type, ['overview', 'history', 'daily'][index]);
      assert.equal(views[0].params.share_status, 'valid');
      assert.equal(views[0].params.page_location, origin + '/share.html?t=' + ['o', 'h', 'd'][index]);
      assert.equal(await page.evaluate(() => location.href), urls[index]);
      await page.locator('#shareCtaTitle').scrollIntoViewIfNeeded();
      await page.waitForFunction(() => dataLayer.some(entry => entry[0] === 'event' && entry[1] === 'share_cta_view'));
      await page.evaluate(() => cpiAnalytics.reportShare('daily', 'valid'));
      assert.equal((await events()).filter(event => event.name === 'page_view').length, 1);
      assert.equal((await events()).filter(event => event.name === 'share_cta_view').length, 1);
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.resolve() } });
      });
      await page.locator('#shareCtaCopy').click();
      await page.waitForFunction(() => dataLayer.some(entry => entry[0] === 'event' && entry[1] === 'share_url_copy'));
      await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } }));
      await page.locator('#shareCtaCopy').click();
      await page.waitForFunction(() => document.getElementById('shareCtaCopyMessage').textContent.includes('コピーできませんでした'));
      assert.equal((await events()).filter(event => event.name === 'share_url_copy').length, 1);
      // Prevent navigation while exercising the real delegated click handler.
      await page.evaluate(() => {
        const link = document.querySelector('.share-cta__start');
        link.addEventListener('click', event => event.preventDefault());
        link.click();
        const chart = document.querySelector('a[href*="chart-pages/"]');
        chart.addEventListener('click', event => event.preventDefault());
        chart.click();
      });
      assert.equal((await events()).filter(event => event.name === 'share_cta_click').length, 1);
      assert.equal((await events()).filter(event => event.name === 'chart_open').length, 1);
      const queue = await page.evaluate(() => JSON.stringify((dataLayer || []).map(entry => [...entry])));
      assert.ok(!queue.includes(new URL(urls[index]).searchParams.get('d')));
      assert.ok(!queue.includes('&h='));
    }
    await page.goto(origin + '/share.html?t=d&v=1&d=SECRET&h=bad');
    await page.waitForFunction(() => window.dataLayer?.some(entry => entry[0] === 'event'));
    assert.equal((await events())[0].params.share_status, 'invalid');
    assert.ok(!(await events()).some(event => event.name === 'share_cta_view'));
    assert.ok(await page.locator('#shareCta').isHidden());

    await page.goto(origin + '/blank', { referer: urls[0] });
    await page.addScriptTag({ path: path.join(root, 'analytics.js') });
    await page.evaluate(() => cpiAnalytics.track('test'));
    assert.equal((await events())[0].params.page_referrer, origin + '/share.html?t=o');
    const local = await context.newPage();
    await local.goto('about:blank');
    await local.addScriptTag({ path: path.join(root, 'analytics.js') });
    assert.equal(await local.evaluate(() => typeof dataLayer), 'undefined');
    assert.deepEqual(errors, []);
    console.log('PASS: three share types, sanitized URLs/referrers, one pageview/impression, CTA/chart clicks, successful copies only, invalid URLs and local preview exclusion');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
