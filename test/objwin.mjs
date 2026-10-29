// Ispettore degli oggetti e numerazione per classe
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
const wait = (ms = 150) => page.waitForTimeout(ms);
await page.evaluate(() => { localStorage.clear(); const s = document.querySelector('#speed'); s.value = 0; s.dispatchEvent(new Event('input')); FlowLab.loadExample('forme'); FlowLab.setTab('vars'); });
await wait(200);
// passo passo fino a dentro aggiungi, poi a fine programma
for (let i = 0; i < 400 && (await page.evaluate(() => FlowLab.run.state)) !== 'done'; i++) {
  await page.evaluate(() => document.querySelector('#stepBtn').click());
  if (i === 60) {
    await page.click('#varsBody button.ov-link.obj >> nth=0'); await wait();
    console.log('aperto durante il passo-passo:', await page.locator('.ovwin .fwin-title').allTextContents());
  }
}
console.log('stato prima:', await page.evaluate(() => FlowLab.run.state), await page.evaluate(() => FlowLab.state.tab));
await page.click('#runBtn'); await wait(400);
console.log('stato:', await page.evaluate(() => FlowLab.run.state), '· output:', (await page.evaluate(() => document.querySelector('#conOut').textContent)).slice(0, 200));
console.log('dopo la fine, la finestra aperta indica:', await page.locator('.ovwin .av-state').first().textContent());
await page.locator('.ovwin .iconbtn').first().click();
await page.evaluate(() => FlowLab.setTab('vars')); // a fine esecuzione si torna alla console
await page.click('#varsBody button.ov-link.obj'); await wait();
const ov = page.locator('.ovwin').first();
console.log('Disegno:', (await ov.locator('tbody tr').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ')).join(' | '));
await ov.locator('button.ov-link:not(.obj)').click(); await wait();
console.log('celle:', await page.locator('.avwin .av-c').allTextContents());
await page.locator('.avwin .av-c.obj', { hasText: 'Cerchio' }).click(); await wait();
console.log('finestre:', await page.locator('.ovwin .fwin-title').allTextContents());
const c = page.locator('.ovwin', { has: page.locator('.fwin-title', { hasText: 'Cerchio#1' }) });
console.log('Cerchio#1:', await c.locator('.av-state').textContent(), '·', (await c.locator('tbody tr').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ')).join(' | '));
await wait(100);
console.log('connettori:', await page.evaluate(() => [...document.querySelectorAll('svg.wlinks .wlink')].map((g) => g.getAttribute('class')).join(' | ')));
await page.screenshot({ path: 'test/objwin.png' });
// spostando la finestra il connettore la segue
const hd = page.locator('.ovwin .fwin-head', { hasText: 'Cerchio#1' }); const hb = await hd.boundingBox();
const d0 = await page.evaluate(() => document.querySelector('svg.wlinks .wlink.on .wl-line').getAttribute('d'));
await page.mouse.move(hb.x + 60, hb.y + 10); await page.mouse.down(); await page.mouse.move(hb.x - 260, hb.y + 300, { steps: 5 }); await page.mouse.up(); await wait(100);
const d1 = await page.evaluate(() => document.querySelector('svg.wlinks .wlink.on .wl-line').getAttribute('d'));
console.log('il connettore segue la finestra:', d0 !== d1);
await page.screenshot({ path: 'test/objwin2.png' });
// chiudendo la finestra il connettore sparisce
const n0 = await page.locator('svg.wlinks .wlink').count();
await page.locator('.ovwin', { has: page.locator('.fwin-title', { hasText: 'Cerchio#1' }) }).locator('.fwin-head .iconbtn').click(); await wait(100);
console.log('connettori prima e dopo la chiusura:', n0, '→', await page.locator('svg.wlinks .wlink').count());
// nuovo avvio: le finestre indicano l'esecuzione precedente
await page.click('#runBtn'); await wait(300);
console.log('dopo un nuovo avvio:', await page.locator('.ovwin .av-state').first().textContent());
console.log('ERR', errs);
await browser.close();
