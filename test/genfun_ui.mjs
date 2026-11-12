// Funzioni generiche: creazione dal dialogo, T nei menu dei tipi, esecuzione, salvataggio, codice Java
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
await page.fill('#f_fname', 'massimo');
ok('nessun campo per i tipi', (await page.locator('#f_ftp').count()) === 0);
await page.click('.modal button:has-text("+ Aggiungi parametro")'); await wait(80);
const row1 = page.locator('.modal .params').first().locator('.prow').nth(0);
await row1.locator('input').fill('v');
const opts = await row1.locator('.tpick select').first().locator('option').allTextContents();
ok('Nuovo Tipo Generico nel menu del parametro', opts.includes('Nuovo Tipo Generico'));
await row1.locator('.tpick select').first().selectOption({ label: 'Nuovo Tipo Generico' }); await wait(80);
ok('nome assegnato: ' + await page.locator('.modal .params').first().locator('.prow').nth(0).locator('.tpick select').first().inputValue(), (await page.locator('.modal .params').first().locator('.prow').nth(0).locator('.tpick select').first().inputValue()) === 'T');
await page.locator('.modal .params').first().locator('.prow').nth(0).locator('select[aria-label^="Forma"]').selectOption('1');
await page.click('.modal button:has-text("+ Aggiungi parametro")'); await wait(80);
await page.locator('.modal .params').first().locator('.prow').nth(1).locator('input').fill('n');
await page.click('.modal button:has-text("+ Aggiungi valore restituito")'); await wait(80);
const rrow = page.locator('.modal .params').nth(1).locator('.prow').first();
await rrow.locator('input').fill('m');
const ropts = await rrow.locator('.tpick select').first().locator('option').allTextContents();
ok('valore restituito: T sì, nuovo no', ropts.includes('T (Tipo Generico)') && !ropts.includes('Nuovo Tipo Generico'));
await rrow.locator('.tpick select').first().selectOption('T');
await page.screenshot({ path: 'test/genfun1_dialog.png' });
await page.click('.modal footer .btn.primary'); await wait(200);
const f = await page.evaluate(() => { const g = FlowLab.state.prog.functions.find((x) => x.name === 'massimo'); return g && { tp: g.tparams, ps: g.params.map((p) => p.name + ':' + p.type + (p.array ? '[]' : '')), rt: g.type }; });
ok('funzione creata: ' + JSON.stringify(f), f && f.tp.join() === 'T' && f.ps.join() === 'v:T[],n:Integer' && f.rt === 'T');
const startTxt = await page.locator('#chart .shape[data-id^="start:"]').first().textContent();
ok('blocco di inizio: ' + startTxt, /massimo<T>\(v\[\]: T/.test(startTxt));
ok('nel menu delle funzioni', (await page.locator('#funcSel option').allTextContents()).some((o) => o.startsWith('massimo<T>(v, n)')));
// T nella dichiarazione dentro la funzione
await page.locator('#chart .shape[data-kind=declare]').first().dblclick(); await wait(150);
const dopts = await page.locator('#f_type option').allTextContents();
ok('T nella dichiarazione: ' + dopts.filter((o) => /Generico/.test(o)).join(', '), dopts.includes('T (Tipo Generico)'));
await page.keyboard.press('Escape'); await wait(80);

// corpo e Main
await page.evaluate(() => {
  const M = ModelLib, p = FlowLab.state.prog, g = p.functions.find((x) => x.name === 'massimo');
  g.body.push(M.makeStmt('declare', { name: 'i', type: 'Integer' }), M.makeStmt('assign', { variable: 'm', expression: 'v[0]' }),
    M.makeStmt('for', { variable: 'i', start: '1', end: 'n - 1', direction: 'inc', step: '1', body: [M.makeStmt('if', { expression: 'v[i] > m', then: [M.makeStmt('assign', { variable: 'm', expression: 'v[i]' })], else: [] })] }));
  p.functions[0].body = [M.makeStmt('declare', { name: 'a', type: 'Integer', array: true, size: '3' }), M.makeStmt('declare', { name: 's', type: 'String', array: true, size: '2' }),
    M.makeStmt('assign', { variable: 'a[0]', expression: '4' }), M.makeStmt('assign', { variable: 'a[1]', expression: '9' }), M.makeStmt('assign', { variable: 'a[2]', expression: '2' }),
    M.makeStmt('assign', { variable: 's[0]', expression: '"pera"' }), M.makeStmt('assign', { variable: 's[1]', expression: '"uva"' }),
    M.makeStmt('output', { expression: 'massimo(a, 3) & " " & massimo(s, 2)' })];
  FlowLab.showFunc(0); FlowLab.render();
});
await page.click('#runBtn'); await wait(500);
ok('esecuzione: ' + await out(), (await out()).includes('9 uva'));
// codice Java: Integer[] e Comparable
const java = await page.evaluate(() => CodeGen.generate(FlowLab.state.prog, 'java'));
ok('Java: firma generica', /public static <T extends Comparable<T>> T massimo\(T\[\] v, int n\)/.test(java) && /Integer\[\] a = new Integer\[3\]/.test(java) && /compareTo\(m\) > 0/.test(java));
// salvataggio e riapertura
const xml = await page.evaluate(() => FlowLab.serialize());
ok('nel file: flowlab-tparams', /flowlab-tparams="T"/.test(xml) && /<parameter name="v" type="T" array="True"/.test(xml));
await page.evaluate((x) => FlowLab.loadText(x, 'gen.fprg'), xml); await wait(250);
await page.click('#runBtn'); await wait(500);
ok('dopo la riapertura: ' + await out(), (await out()).includes('9 uva'));
// se nessun parametro usa più T, il valore restituito non può essere T
const mi = await page.evaluate(() => FlowLab.state.prog.functions.findIndex((x) => x.name === 'massimo'));
await page.evaluate((i) => FlowLab.showFunc(i), mi); await wait(150);
await page.keyboard.press('F2'); await wait(200);
await page.locator('.modal .params').first().locator('.prow').nth(0).locator('.tpick select').first().selectOption('Integer'); await wait(80);
await page.click('.modal footer .btn.primary'); await wait(150);
ok('errore: ' + await page.locator('.modal .formerr').textContent(), /deve comparire anche in un parametro/.test(await page.locator('.modal .formerr').textContent()));
await page.keyboard.press('Escape'); await wait(80);

// vista Oggetti: solo i metodi statici possono essere generici
await page.evaluate(() => { FlowLab.loadExample('tabellina'); FlowLab.setView('objects'); }); await wait(250);
const objs = await page.evaluate(() => FlowLab.state.prog.classes && FlowLab.state.prog.classes.length);
if (objs) {
  await page.evaluate(() => FlowLab.showUml()); await wait(150);
  await page.locator('.ubox .uhit.head').first().click(); await wait(80);
  await page.keyboard.press('m'); await wait(200);
  await page.click('.modal button:has-text("+ Aggiungi parametro")'); await wait(80);
  const has = async () => (await page.locator('.modal .params').first().locator('.prow').nth(0).locator('.tpick select').first().locator('option').allTextContents()).includes('Nuovo Tipo Generico');
  const en1 = await has();
  await page.locator('#f_fstatic').uncheck(); await wait(80);
  const en2 = await has();
  ok(`classe principale: statico ${en1}, non statico ${en2}`, en1 && !en2);
  await page.keyboard.press('Escape');
}
// metodo non statico di un'altra classe: il Tipo Generico è della classe; eliminando il metodo la classe lo perde
await page.evaluate(() => FlowLab.showUml()); await wait(150);
await page.keyboard.press('n'); await wait(150);
await page.fill('#f_cname', 'Coppia'); await page.click('.modal footer .btn.primary'); await wait(150);
await page.locator('.ubox:has(.uname:text-is("Coppia")) .uhit.head').click(); await wait(60);
await page.keyboard.press('m'); await wait(200);
await page.fill('#f_fname', 'metti');
await page.click('.modal button:has-text("+ Aggiungi parametro")'); await wait(80);
await page.locator('.modal .params').first().locator('.prow input').first().fill('x');
await page.locator('.modal .params').first().locator('.prow').nth(0).locator('.tpick select').first().selectOption({ label: 'Nuovo Tipo Generico' }); await wait(80);
await page.click('.modal footer .btn.primary'); await wait(200);
ok('classe dal metodo: ' + (await page.locator('.uname').allTextContents()).join(', '), (await page.locator('.uname').allTextContents()).includes('Coppia<T>'));
ok('metodo nell\'UML: ' + (await page.locator('.ubox:has(.uname:text-is("Coppia<T>"))').textContent()).replace(/\n/g, ' '), /metti\(x: T\)/.test(await page.locator('.ubox:has(.uname:text-is("Coppia<T>"))').textContent()));
await page.evaluate(() => { const p = FlowLab.state.prog; const f = p.functions.find((x) => x.name === 'metti'); const c = p.classes.find((k) => k.name === 'Coppia'); FlowLab.state.usel = { cls: c.id, kind: 'method', fid: f.id }; FlowLab.render(); }); await wait(100);
await page.keyboard.press('Shift+Delete'); await wait(150);
if (await page.locator('.modal footer .btn.primary').count()) { await page.click('.modal footer .btn.primary'); await wait(150); }
ok('dopo l\'eliminazione: ' + (await page.locator('.uname').allTextContents()).join(', '), (await page.locator('.uname').allTextContents()).includes('Coppia'));
console.log('ERR', errs);
await browser.close();
