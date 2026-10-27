import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1366, height: 820 } });
const errs=[]; page.on('pageerror', e => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.clear(); FlowLab.loadExample('matrici'); const s=document.querySelector('#speed'); s.value=3; s.dispatchEvent(new Event('input')); });
await page.click('.tabw[data-tab=vars] [role=tab]');
for (let i = 0; i < 9; i++) { await page.click('#stepBtn'); await page.waitForTimeout(30); }
await page.waitForTimeout(700);
const h = () => page.$$eval('#varsBody tr.detail .det-wrap', w => w.map(x => Math.round(x.getBoundingClientRect().height)));
console.log('chiuse:', await h());
await (await page.$$('#varsBody .caret'))[0].click();
await page.waitForTimeout(80); console.log('durante l\'apertura:', await h());
await page.waitForTimeout(300); console.log('aperta la prima:', await h(), 'ruotata:', await page.$eval('#varsBody .caret', c => getComputedStyle(c.querySelector('svg')).transform !== 'none'));
await page.screenshot({ path: 'test/ct.png', clip: { x: 940, y: 130, width: 426, height: 200 } });
// resta aperta dopo un passo (la tabella viene ridisegnata)
await page.click('#stepBtn'); await page.waitForTimeout(700); console.log('dopo un passo:', await h());
await page.click('#varsBody tr.detail.open .avlink'); await page.waitForTimeout(200);
console.log('finestra:', await page.$$eval('.avwin .fwin-title', t => t.map(x => x.textContent)));
await (await page.$$('#varsBody .caret'))[0].click(); await page.waitForTimeout(350); console.log('richiusa:', await h());
console.log('ERR', errs); await browser.close();
