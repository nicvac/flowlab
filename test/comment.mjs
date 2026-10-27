import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1300, height: 800 } });
const errs=[]; page.on('pageerror', e => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.clear(); FlowLab.loadExample('mcd'); }); await page.waitForTimeout(150);
const h0 = await page.$eval('#chart .shape.comment', g => g.getBBox().height);
await page.screenshot({ path: 'test/c1.png', clip: { x: 0, y: 40, width: 880, height: 500 } });
await page.click('#chart .ctoggle'); await page.waitForTimeout(150);
const h1 = await page.$eval('#chart .shape.comment', g => g.getBBox().height);
const sel = await page.evaluate(() => FlowLab.state.sel);
await page.screenshot({ path: 'test/c2.png', clip: { x: 0, y: 40, width: 880, height: 560 } });
await page.click('#chart .ctoggle'); await page.waitForTimeout(150);
const h2 = await page.$eval('#chart .shape.comment', g => g.getBBox().height);
// dblclick on toggle must not open dialog
await page.dblclick('#chart .ctoggle'); await page.waitForTimeout(150);
console.log('heights', h0, h1, h2, 'sel', sel, 'modal', !!(await page.$('.modal')), 'undo', await page.evaluate(() => FlowLab.state.undo.length));
// short comment: no toggle
await page.evaluate(() => { FlowLab.loadExample('parita'); }); 
console.log('ERR', errs); await browser.close();
