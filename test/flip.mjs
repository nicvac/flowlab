// Voltare pagina nel visualizzatore 3D: avanti la pagina entra da destra verso sinistra, indietro da sinistra verso destra
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 820 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.clear(); const s = document.querySelector('#speed'); s.value = 0; s.dispatchEvent(new Event('input')); FlowLab.loadExample('matrici'); FlowLab.setTab('vars'); });
await page.click('#runBtn'); await page.waitForTimeout(500);
await page.locator('#varsBody tr.arr', { hasText: 'cubo' }).locator('.avopen').click(); await page.waitForTimeout(700);
const win = page.locator('.avwin', { hasText: 'cubo' });
const rest = await win.locator('.av-page').boundingBox();
for (const [btn, name] of [['precedente', 'indietro'], ['successivo', 'avanti']]) {
  await win.locator(`button[aria-label="pagina: ${btn}"]`).click();
  await page.evaluate(() => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = 60; }));
  const r = await win.locator('.av-page').boundingBox();
  await page.evaluate(() => document.getAnimations().forEach((a) => a.play()));
  await page.waitForTimeout(500);
  const side = r.x + r.width > rest.x + rest.width - 3 ? 'appoggiata a destra (entra da destra verso sinistra)' : r.x < rest.x + 3 ? 'appoggiata a sinistra (entra da sinistra verso destra)' : '?';
  console.log(`${name}: all'inizio ${Math.round(r.x)}-${Math.round(r.x + r.width)} su ${Math.round(rest.x)}-${Math.round(rest.x + rest.width)} → ${side}`);
}
console.log('ERR', errs);
await browser.close();
