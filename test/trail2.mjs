import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('flowlab:sideHidden','true'); FlowLab.loadExample('media'); });
await page.reload(); await page.waitForTimeout(300);
await page.evaluate(() => FlowLab.loadExample('media'));
let shots = 0;
for (let i = 0; i < 30; i++) {
  await page.click('#stepBtn'); await page.waitForTimeout(80);
  if (await page.evaluate(() => FlowLab.run.state) === 'input') { await page.fill('#conInput', '2'); await page.press('#conInput','Enter'); }
  await page.waitForTimeout(600);
  const t = await page.evaluate(() => { const t = FlowLab.run.trail; const s = (id) => document.querySelector(`#chart .shape[data-id="${id}"]`)?.dataset.kind; return t ? [s(t.from), s(t.to)] : null; });
  if (t && t[0] === 'assign' && t[1] === 'for') { await page.screenshot({ path: 'test/t3.png' }); shots++; break; }
}
// a metà animazione
for (let i = 0; i < 3; i++) { await page.click('#stepBtn'); await page.waitForTimeout(650); if (await page.evaluate(() => FlowLab.run.state) === 'input') { await page.fill('#conInput', '2'); await page.press('#conInput','Enter'); await page.waitForTimeout(650);} }
await page.click('#stepBtn'); await page.waitForTimeout(230); await page.screenshot({ path: 'test/t4.png' });
console.log('loop shot', shots); await browser.close();
