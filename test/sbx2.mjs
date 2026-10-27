import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1320, height: 820 } });
await page.goto('file://' + process.cwd() + '/test/sbx/host.html'); await page.waitForTimeout(800);
const f = page.frame({ url: /inner/ });
await f.evaluate(() => localStorage.clear());
await f.click('.tabw[data-tab=console] .detach');
await f.dragAndDrop('.tabw[data-tab=code] [role=tab]', '.tabw[data-tab=vars]', { targetPosition: { x: 3, y: 10 } });
console.log('sandbox: finestre', await f.$$eval('.fwin', w => w.map(x => x.dataset.win)), 'schede', await f.$$eval('#tabs [role=tab]', b => b.map(x => x.textContent)));
await browser.close();
