// Array come valori restituiti: dialogo della funzione, dichiarazione automatica, esecuzione, file, attributo array restituito
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.clear(); const s = document.querySelector('#speed'); s.value = 0; s.dispatchEvent(new Event('input')); });
const wait = (ms = 150) => page.waitForTimeout(ms);
const ok = (name, cond) => console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
const out = async () => (await page.innerText('#conOut')).split('\n').filter((l) => l && !/^(Programma|▶|■|Esecuzione)/.test(l)).join(' | ');

await page.evaluate(() => FlowLab.loadExample('tabellina')); await wait(200);
await page.click('#funcAdd'); await wait(200);
await page.fill('#f_fname', 'quadrati');
await page.click('.modal button:has-text("+ Aggiungi parametro")'); await wait(80);
await page.locator('.modal .params').first().locator('.prow input').first().fill('n');
await page.click('.modal button:has-text("+ Aggiungi valore restituito")'); await wait(80);
const rrow = page.locator('.modal .params').nth(1).locator('.prow').first();
await rrow.locator('input').fill('q');
ok('forma del valore restituito', (await rrow.locator('select[aria-label^="Forma"]').count()) === 1);
await rrow.locator('select[aria-label^="Forma"]').selectOption('1');
await page.screenshot({ path: 'test/arrret1_dialog.png' });
await page.click('.modal footer .btn.primary'); await wait(200);
const f = await page.evaluate(() => { const g = FlowLab.state.prog.functions.find((x) => x.name === 'quadrati'); return { rets: ModelLib.rets(g), d: g.body[0] }; });
ok('valore restituito: ' + JSON.stringify(f.rets), f.rets[0].array && f.rets[0].dims === 1);
ok('dichiarazione automatica: array ' + f.d.array + ', dimensione "' + f.d.size + '"', f.d.kind === 'declare' && f.d.array && f.d.size === '' && f.d.name === 'q');
ok('avviso: ' + await page.locator('.toast').last().textContent(), /numero di elementi di q/.test(await page.locator('.toast').last().textContent()));

await page.evaluate(() => {
  const M = ModelLib, p = FlowLab.state.prog, g = p.functions.find((x) => x.name === 'quadrati');
  g.body[0].size = 'n';
  g.body.push(M.makeStmt('declare', { name: 'i', type: 'Integer' }), M.makeStmt('for', { variable: 'i', start: '0', end: 'n - 1', direction: 'inc', step: '1', body: [M.makeStmt('assign', { variable: 'q[i]', expression: 'i * i' })] }));
  p.functions[0].body = [M.makeStmt('declare', { name: 'v', type: 'Integer', array: true, size: '0' }), M.makeStmt('assign', { variable: 'v', expression: 'quadrati(4)' }),
    M.makeStmt('output', { expression: 'Size(v) & ": " & v[1] & " " & v[3]' })];
  FlowLab.showFunc(0); FlowLab.render();
});
await page.click('#runBtn'); await wait(500);
ok('esecuzione: ' + await out(), (await out()).includes('4: 1 9'));
// in un'espressione non si può usare
await page.evaluate(() => { const p = FlowLab.state.prog; p.functions[0].body.push(ModelLib.makeStmt('output', { expression: 'quadrati(2)' })); FlowLab.render(); });
await page.click('#runBtn'); await wait(500);
ok('uso sbagliato: ' + (await out()).split(' | ').pop(), /restituisce un array: si usa in un'assegnazione a un array/.test(await out()));
const xml = await page.evaluate(() => FlowLab.serialize());
ok('nel file: flowlab-returns', /flowlab-returns="q:Integer\[\]"/.test(xml));
await page.evaluate((x) => FlowLab.loadText(x, 'a.fprg'), xml); await wait(200);
ok('riaperto: ' + JSON.stringify(await page.evaluate(() => ModelLib.rets(FlowLab.state.prog.functions.find((x) => x.name === 'quadrati')))), await page.evaluate(() => ModelLib.rets(FlowLab.state.prog.functions.find((x) => x.name === 'quadrati'))[0].array === true));
const java = await page.evaluate(() => CodeGen.generate(FlowLab.state.prog, 'java'));
ok('Java: ' + (java.match(/public static int\[\] quadrati\(int n\)/) || ['?'])[0], /public static int\[\] quadrati\(int n\)/.test(java));

// vista Oggetti: un metodo restituisce un attributo array
await page.evaluate(() => {
  const M = ModelLib, p = M.newProgram(); M.wrapInClass(p);
  const c = M.makeClass('Classe', { attributes: [M.makeAttribute({ name: 'voti', type: 'Integer', array: true, size: '3', visibility: 'private' })], x: 300, y: 60 });
  p.classes.push(c);
  FlowLab.loadText(M.serializeFprg(p), 'oo.fprg');
});
await wait(200);
await page.evaluate(() => FlowLab.showUml()); await wait(150);
await page.locator('.ubox:has(.uname:text-is("Classe")) .uhit.head').click(); await wait(60);
await page.keyboard.press('m'); await wait(200);
await page.fill('#f_fname', 'getVoti');
await page.click('.modal button:has-text("+ Aggiungi valore restituito")'); await wait(80);
const r2 = page.locator('.modal .params').nth(1).locator('.prow').first();
await r2.locator('input').fill('voti'); await wait(60);
ok('attributo array: forma bloccata su ' + await r2.locator('select[aria-label^="Forma"]').inputValue(), (await r2.locator('select[aria-label^="Forma"]').inputValue()) === '1' && await r2.locator('select[aria-label^="Forma"]').isDisabled());
await page.click('.modal footer .btn.primary'); await wait(200);
ok('metodo creato: ' + (await page.locator('.ubox:has(.uname:text-is("Classe"))').textContent()).match(/\+ getVoti\(\)[^+]*/)?.[0], /getVoti\(\): Intero\[\]/.test(await page.locator('.ubox:has(.uname:text-is("Classe"))').textContent()));
console.log('ERR', errs);
await browser.close();
