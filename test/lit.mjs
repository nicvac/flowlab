import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1366, height: 860 } });
const errs=[]; page.on('pageerror', e => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.clear(); FlowLab.loadExample('mcd'); });
const lit = () => page.evaluate(() => document.querySelector('#chart .shape.exec')?.dataset.kind || document.querySelector('#chart .shape.exec')?.dataset.id || 'nessuno');
for (let i = 0; i < 4; i++) {
  await page.click('#stepBtn');
  const during = await lit(); await page.waitForTimeout(150); const mid = await lit(); await page.waitForTimeout(500); const after = await lit();
  console.log(`passo ${i + 1}: subito=${during} a metà=${mid} all'arrivo=${after}`);
}
// velocità Media in esecuzione continua
await page.evaluate(() => { const s=document.querySelector('#speed'); s.value=2; s.dispatchEvent(new Event('input')); });
await page.click('#stopBtn'); await page.click('#runBtn'); await page.waitForTimeout(120);
console.log('esecuzione Media, a metà tragitto:', await lit()); await page.waitForTimeout(220); console.log('dopo arrivo:', await lit());
console.log('ERR', errs); await browser.close();
