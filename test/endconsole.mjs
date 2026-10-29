// A fine esecuzione (dopo Esegui) si torna alla console; nel passo-passo resta la scheda scelta
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 820 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.clear(); FlowLab.loadExample('forme'); });
for (const speed of [0, 3]) {
  await page.evaluate((v) => { const s = document.querySelector('#speed'); s.value = v; s.dispatchEvent(new Event('input')); FlowLab.setTab('vars'); }, speed);
  await page.click('#runBtn');
  const during = await page.evaluate(() => FlowLab.state.tab);
  await page.waitForFunction(() => FlowLab.run.state === 'done', null, { timeout: 120000 });
  console.log(`velocità ${speed}: durante ${during}, alla fine ${await page.evaluate(() => FlowLab.state.tab)} · ultima riga: ${(await page.innerText('#conOut')).split('\n').pop()}`);
}
await page.evaluate(() => { const s = document.querySelector('#speed'); s.value = 0; s.dispatchEvent(new Event('input')); FlowLab.setTab('vars'); });
for (let i = 0; i < 400 && (await page.evaluate(() => FlowLab.run.state)) !== 'done'; i++) await page.evaluate(() => document.querySelector('#stepBtn').click());
console.log('passo-passo fino alla fine:', await page.evaluate(() => FlowLab.state.tab));
console.log('ERR', errs);
await browser.close();
