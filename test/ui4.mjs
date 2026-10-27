import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const url = 'file://' + process.cwd() + '/dist/FlowLab.html';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERR ' + e.message));
await page.goto(url); await page.waitForTimeout(300);
await page.evaluate(() => { const s=document.querySelector('#speed'); s.value=0; s.dispatchEvent(new Event('input')); });
const cases = { parita: ['7'], tabellina: ['6'], mcd: ['84','36'], indovina: ['50','25','75','12','88','37','63','6','94','1','100','45','55','30','70','20','80','10','90','5','95','15','85','35','65','40','60'], media: ['0'] };
for (const [id, inputs] of Object.entries(cases)) {
  await page.evaluate((id) => FlowLab.loadExample(id), id);
  await page.click('#runBtn');
  for (const v of inputs) {
    const st = await page.evaluate(() => FlowLab.run.state);
    if (st !== 'input') { await page.waitForTimeout(100); if (await page.evaluate(() => FlowLab.run.state) !== 'input') break; }
    await page.fill('#conInput', v); await page.press('#conInput', 'Enter'); await page.waitForTimeout(30);
  }
  await page.waitForTimeout(200);
  const txt = (await page.innerText('#conOut')).split('\n');
  console.log(id, '→', txt.slice(-3).join(' | '), '| state', await page.evaluate(() => FlowLab.run.state));
}
// ricarica: autosave
await page.reload(); await page.waitForTimeout(300);
console.log('after reload program:', await page.innerText('#progName'));
await page.click('#helpBtn'); await page.waitForTimeout(100);
await page.screenshot({ path: 'test/help.png' });
console.log('ERRORS', errs);
await browser.close();
