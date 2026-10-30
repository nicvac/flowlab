// Valore restituito scelto tra gli attributi: niente dichiarazione nel corpo
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 820 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.clear(); const s = document.querySelector('#speed'); s.value = 0; s.dispatchEvent(new Event('input')); FlowLab.loadExample('conto'); FlowLab.showUml(); });
await page.waitForTimeout(200);
await page.locator('.ubox:has(.uname:text-is("ContoBancario")) .uhit.head').click({ button: 'right' });
await page.click('#pop button:has-text("Nuovo metodo")'); await page.waitForTimeout(100);
await page.fill('#f_fname', 'getTitolare');
await page.click('.modal button:has-text("Aggiungi valore restituito")');
console.log('suggerimenti:', await page.$$eval('.modal datalist option', (o) => o.map((x) => `${x.value} (${x.textContent})`).join(', ')));
await page.fill('.modal .rrow input', 'titolare');
console.log('tipo:', await page.inputValue('.modal .rrow select'), '· bloccato:', await page.isDisabled('.modal .rrow select'), '· etichetta:', await page.isVisible('.modal .rtag'));
await page.fill('.modal .rrow input', 'risultato');
console.log('variabile normale → bloccato:', await page.isDisabled('.modal .rrow select'), '· etichetta:', await page.isVisible('.modal .rtag'));
await page.fill('.modal .rrow input', 'TITOLARE');
await page.click('.modal footer .btn.primary'); await page.waitForTimeout(150);
const f = await page.evaluate(() => { const f = FlowLab.state.prog.functions.find((x) => x.name === 'getTitolare'); return { body: f.body.map((s) => s.kind), rets: ModelLib.rets(f) }; });
console.log('metodo creato:', JSON.stringify(f));
console.log('nel diagramma delle classi:', await page.locator('.urow.method .umem', { hasText: 'getTitolare' }).textContent());
// uso del metodo
await page.evaluate(() => { const m = FlowLab.state.prog.functions[0]; m.body.push(ModelLib.makeStmt('output', { expression: '"Titolare: " & a.getTitolare()' })); FlowLab.render(); });
await page.click('#runBtn'); await page.waitForTimeout(400);
console.log('output:', (await page.evaluate(() => document.querySelector('#conOut').textContent)).split('€').slice(-2).join('€'));
// una variabile nuova si dichiara come prima
await page.evaluate(() => FlowLab.showUml()); await page.waitForTimeout(100);
await page.locator('.ubox:has(.uname:text-is("ContoBancario")) .uhit.head').click({ button: 'right' });
await page.click('#pop button:has-text("Nuovo metodo")'); await page.waitForTimeout(100);
await page.fill('#f_fname', 'doppio'); await page.click('.modal button:has-text("Aggiungi valore restituito")'); await page.fill('.modal .rrow input', 'd'); await page.selectOption('.modal .rrow select', 'Real');
await page.click('.modal footer .btn.primary'); await page.waitForTimeout(150);
console.log('variabile nuova:', await page.evaluate(() => JSON.stringify(FlowLab.state.prog.functions.find((x) => x.name === 'doppio').body.map((s) => `${s.kind} ${s.name}: ${s.type}`))));
await page.screenshot({ path: 'test/retattr.png' });
console.log('ERR', errs);
await browser.close();
