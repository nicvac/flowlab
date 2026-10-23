import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
const errs=[]; page.on('pageerror', e => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
for (const id of ['media','mcd','bolle']) {
  await page.evaluate((id) => { localStorage.clear(); FlowLab.loadExample(id); }, id); await page.waitForTimeout(150);
  await page.screenshot({ path: `test/look_${id}.png` });
}
await page.evaluate(() => { const s=FlowLab.state; s.fi = 1; FlowLab.render(); }); await page.waitForTimeout(100);
await page.screenshot({ path: 'test/look_func.png' });
console.log('ERR', errs); await browser.close();
