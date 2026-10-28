// Voltare pagina nel visualizzatore 3D: avanti da destra a sinistra, indietro al contrario
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 820 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.clear(); const s = document.querySelector('#speed'); s.value = 0; s.dispatchEvent(new Event('input')); FlowLab.loadExample('matrici'); FlowLab.setTab('vars'); });
await page.click('#runBtn'); await page.waitForTimeout(500);
await page.locator('#varsBody tr.arr', { hasText: 'cubo' }).locator('.avopen').click(); await page.waitForTimeout(700);
const win = page.locator('.avwin', { hasText: 'cubo' });
const pageRect = await win.locator('.av-page').boundingBox();
const probe = async () => page.evaluate(() => [...document.querySelectorAll('.av-sheet')].map((s) => { const r = s.getBoundingClientRect(); return { cls: s.className.replace('av-page ', ''), left: Math.round(r.left), right: Math.round(r.right), first: s.querySelector('.av-c')?.textContent }; }));
const start = await win.locator('.av-pagestep output').textContent();
for (const [btn, name] of [['precedente', 'indietro'], ['successivo', 'avanti']]) {
  await win.locator(`button[aria-label="pagina: ${btn}"]`).click();
  const shots = [];
  for (const t of [90, 220, 380]) { await page.waitForTimeout(t === 90 ? 90 : t - (t === 220 ? 90 : 220)); shots.push(await probe()); if (t === 220) await win.screenshot({ path: `test/flip_${name}.png` }); }
  await page.waitForTimeout(500);
  console.log(name, '· pagina', await win.locator('.av-pagestep output').textContent(), '· foglio:', JSON.stringify(shots.map((x) => x.map((y) => `${y.cls} ${y.left}-${y.right} (${y.first})`))), '· fogli rimasti:', (await probe()).length);
}
console.log('pagina: x', Math.round(pageRect.x), '-', Math.round(pageRect.x + pageRect.width), '· partenza', start);
console.log('ERR', errs);
await browser.close();
