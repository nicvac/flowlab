import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1366, height: 820 } });
const errs=[]; page.on('pageerror', e => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.clear(); FlowLab.loadExample('matrici'); const s=document.querySelector('#speed'); s.value=0; s.dispatchEvent(new Event('input')); });
await page.click('.tabw[data-tab=vars] [role=tab]'); await page.click('#runBtn'); await page.waitForTimeout(700);
const icons = await page.$$('#varsBody .avopen'); const links = await page.$$('#varsBody .avlink');
console.log('icone:', icons.length, 'link:', links.length);
await icons[0].click(); await page.waitForTimeout(200);
await (await page.$$('#varsBody .caret'))[1].click(); await page.waitForTimeout(350); await (await page.$$('#varsBody .avlink'))[1].click(); await page.waitForTimeout(200);
await icons[0].click(); await page.waitForTimeout(200);   // stessa finestra: non ne apre una seconda
console.log('finestre:', await page.$$eval('.avwin .fwin-title', t => t.map(x => x.textContent)));
await page.screenshot({ path: 'test/vi.png', clip: { x: 1020, y: 90, width: 346, height: 250 } });
console.log('ERR', errs); await browser.close();
