import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const url = 'file://' + process.cwd() + '/dist/FlowLab.html';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PAGEERR ' + e.message));
await page.goto(url);
await page.waitForTimeout(800);
await page.screenshot({ path: 'test/shot1.png' });
// run media example with inputs
await page.evaluate(() => { localStorage.clear(); FlowLab.loadExample('media'); });
await page.selectOption('#speed', { index: 0 }).catch(()=>{});
await page.evaluate(() => { const s=document.querySelector('#speed'); s.value=0; s.dispatchEvent(new Event('input')); });
await page.click('#runBtn');
for (const v of ['3','7','5.5','8']) { await page.waitForSelector('#conInput:not([disabled])'); await page.fill('#conInput', v); await page.press('#conInput','Enter'); }
await page.waitForTimeout(300);
console.log('CONSOLE:\n' + await page.innerText('#conOut'));
await page.screenshot({ path: 'test/shot2.png' });
// roundtrip all examples via XML and run non-interactive ones
const res = await page.evaluate(async () => {
  const out = [];
  for (const id of ['bolle','file','fattoriale','mcd']) {
    FlowLab.loadExample(id);
    const xml = FlowLab.serialize();
    FlowLab.loadText(xml, id + '.fprg');
    const xml2 = FlowLab.serialize();
    out.push(id + ' roundtrip ' + (xml.replace(/saved" value="[^"]*"|edited" value="[^"]*"|created" value="[^"]*"/g,'') === xml2.replace(/saved" value="[^"]*"|edited" value="[^"]*"|created" value="[^"]*"/g,'') ? 'OK' : 'DIFF'));
  }
  return out;
});
console.log(res.join('\n'));
await page.evaluate(() => FlowLab.loadExample('bolle'));
await page.click('#runBtn'); await page.waitForTimeout(500);
console.log('BOLLE:\n' + await page.innerText('#conOut'));
await page.evaluate(() => FlowLab.loadExample('file'));
await page.click('#runBtn'); await page.waitForTimeout(500);
console.log('FILE:\n' + await page.innerText('#conOut'));
await page.evaluate(() => FlowLab.loadExample('fattoriale'));
await page.click('#runBtn'); await page.waitForSelector('#conInput:not([disabled])'); await page.fill('#conInput','10'); await page.press('#conInput','Enter'); await page.waitForTimeout(300);
console.log('FATT:\n' + await page.innerText('#conOut'));
await page.click('#tabs [data-tab=code]'); await page.waitForTimeout(300);
await page.screenshot({ path: 'test/shot4.png' });
console.log('ERRORS:', errs);
await browser.close();
