import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1366, height: 820 } });
const errs=[]; page.on('pageerror', e => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(300);
await page.click('.tabw[data-tab=vars] .detach');
// trascina la finestra sopra il pannello laterale (a destra)
const head = await page.$('.fwin[data-win=vars] .fwin-head'); let hb = await head.boundingBox();
await page.mouse.move(hb.x + 40, hb.y + 10); await page.mouse.down(); await page.mouse.move(1300, 300, { steps: 10 }); await page.mouse.up();
const r = await page.$eval('.fwin[data-win=vars]', w => { const b = w.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right)]; });
const side = await page.$eval('#side', s => Math.round(s.getBoundingClientRect().left));
console.log('finestra', r, 'pannello inizia a x', side, '→ sopra il pannello:', r[2] > side);
// riduci / ripristina
const h0 = await page.$eval('.fwin[data-win=vars]', w => w.offsetHeight);
await page.click('.fwin[data-win=vars] .minbtn'); await page.waitForTimeout(100);
const h1 = await page.$eval('.fwin[data-win=vars]', w => w.offsetHeight);
await page.screenshot({ path: 'test/q1.png' });
await page.reload(); await page.waitForTimeout(300);
const h1b = await page.$eval('.fwin[data-win=vars]', w => w.offsetHeight);
await page.click('.fwin[data-win=vars] .minbtn'); await page.waitForTimeout(100);
const h2 = await page.$eval('.fwin[data-win=vars]', w => w.offsetHeight);
console.log('altezze: normale', h0, 'ridotta', h1, 'ridotta dopo ricarica', h1b, 'ripristinata', h2);
// console ridotta si riapre quando il programma chiede input
await page.click('.tabw[data-tab=console] .detach'); await page.click('.fwin[data-win=console] .minbtn');
await page.evaluate(() => { FlowLab.loadExample('parita'); const s=document.querySelector('#speed'); s.value=0; s.dispatchEvent(new Event('input')); });
await page.click('#runBtn'); await page.waitForSelector('#conInput:not([disabled])', { timeout: 5000 });
console.log('console riaperta per input:', !(await page.$eval('.fwin[data-win=console]', w => w.classList.contains('min'))));
await page.fill('#conInput','3'); await page.press('#conInput','Enter');
// nascondi pannello laterale
const cw0 = await page.$eval('#canvasWrap', e => e.clientWidth);
await page.click('#sideToggle'); await page.waitForTimeout(100);
const cw1 = await page.$eval('#canvasWrap', e => e.clientWidth);
const winsVisible = await page.$$eval('.fwin', ws => ws.every(w => w.offsetParent !== null || getComputedStyle(w).display !== 'none'));
await page.screenshot({ path: 'test/q2.png' });
await page.reload(); await page.waitForTimeout(300);
const hiddenAfterReload = await page.evaluate(() => document.body.classList.contains('side-hidden'));
await page.click('#sideToggle'); await page.waitForTimeout(100);
const cw2 = await page.$eval('#canvasWrap', e => e.clientWidth);
console.log('larghezza diagramma: con pannello', cw0, 'senza', cw1, 'riaperto', cw2, '| finestre visibili', winsVisible, '| nascosto dopo ricarica', hiddenAfterReload);
console.log('ERR', errs); await browser.close();
