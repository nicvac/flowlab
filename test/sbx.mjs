import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1320, height: 820 } });
await page.goto('file://' + process.cwd() + '/test/sbx/host.html'); await page.waitForTimeout(800);
const f = page.frame({ url: /inner/ });
await f.evaluate(() => { localStorage.clear(); FlowLab.loadExample('parita'); const s=document.querySelector('#speed'); s.value=0; s.dispatchEvent(new Event('input')); });
await f.click('#runBtn'); await f.waitForSelector('#conInput:not([disabled])');
await f.fill('#conInput', '8'); await f.click('#conSend'); await page.waitForTimeout(300);
console.log('click Invia →', await f.evaluate(() => FlowLab.run.state), '|', (await f.innerText('#conOut')).replace(/\n/g,' / '));
await f.click('#runBtn'); await f.waitForSelector('#conInput:not([disabled])');
await f.fill('#conInput', '9'); await f.press('#conInput', 'Enter'); await page.waitForTimeout(300);
console.log('Invio →', await f.evaluate(() => FlowLab.run.state), '|', (await f.innerText('#conOut')).replace(/\n/g,' / '));
// dialog
const ins = await f.$$('#chart .ins'); await ins[0].click(); await f.click('.insbtn[title="Output"]');
await f.fill('#f_expression', '"ciao"'); await f.click('.modal footer .btn.primary'); await page.waitForTimeout(150); console.log('dialog closed (click):', await f.$('.modal') === null); const ins2 = await f.$$('#chart .ins'); await ins2[0].click(); await f.click('.insbtn[title="Input"]'); await f.fill('#f_variable', 'numero'); await f.press('#f_variable','Enter'); await page.waitForTimeout(200);
console.log('dialog closed (Enter):', await f.$('.modal') === null, await f.evaluate(() => (document.querySelector('.formerr')||{}).textContent));
await browser.close();
