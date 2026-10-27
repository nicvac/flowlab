import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1366, height: 860 } });
const errs=[]; page.on('pageerror', e => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.clear(); const s=document.querySelector('#speed'); s.value=0; s.dispatchEvent(new Event('input')); FlowLab.loadExample('minmax'); });
await page.click('#runBtn'); await page.waitForTimeout(400);
console.log((await page.innerText('#conOut')).split('\n').slice(1, 4).join(' | '));
// salvataggio e riapertura
const rt = await page.evaluate(() => { const x = FlowLab.serialize(); FlowLab.loadText(x, 'mm.fprg'); return [x.match(/<function name="calcolaMassimoEMinimo"[^>]*>/)[0], FlowLab.serialize() === x.replace(/saved" value="[^"]*"/, (m) => m) ]; });
console.log(rt[0]);
await page.click('#runBtn'); await page.waitForTimeout(400);
console.log('dopo riapertura:', (await page.innerText('#conOut')).split('\n').slice(2, 4).join(' | '));
// diagramma della funzione
await page.selectOption('#funcSel', '1'); await page.waitForTimeout(150);
console.log('fine funzione:', await page.$eval('#chart .shape[data-id^="end:"] text', t => t.textContent));
await page.screenshot({ path: 'test/m1.png' });
// nuova funzione con 2 valori dalla finestra
await page.click('#funcAdd'); await page.fill('#f_fname', 'Dividi');
await page.click('text=+ Aggiungi parametro'); await page.fill('.params:not(:has(.rrow)) .prow input[type=text] >> nth=0', 'a');
await page.click('text=+ Aggiungi parametro'); await page.fill('.params:not(:has(.rrow)) .prow input[type=text] >> nth=1', 'b');
await page.click('text=+ Aggiungi valore restituito'); await page.fill('.rrow input >> nth=0', 'q');
await page.click('text=+ Aggiungi valore restituito'); await page.fill('.rrow input >> nth=1', 'r');
await page.screenshot({ path: 'test/m2.png' });
await page.click('.modal footer .btn.primary'); await page.waitForTimeout(150);
console.log('funzione creata:', await page.evaluate(() => { const f = FlowLab.state.prog.functions.at(-1); return f.name + ' → ' + JSON.stringify(f.returns) + ' | corpo: ' + f.body.map(s => s.kind + ':' + (s.name || '')).join(',') + ' | type=' + f.type + ' var=' + f.variable; }));
console.log('fine:', await page.$eval('#chart .shape[data-id^="end:"] text', t => t.textContent));
// salvataggio: avviso
await page.evaluate(() => { window.showSaveFilePicker = undefined; });
await page.keyboard.press('Control+s'); await page.waitForTimeout(200);
console.log('avviso:', await page.innerText('#toast'));
console.log('ERR', errs); await browser.close();
