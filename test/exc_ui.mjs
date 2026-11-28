// Eccezioni: blocchi Try e Throw dal menu e dalla tastiera, dialoghi, esecuzione passo passo, eccezioni dell'utente
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
import { createRequire } from 'module';
// the test programs are written again from test/exc_progs.js (Italian messages)
process.env.FLOWLAB_LANG ||= 'it';
{ const req = createRequire(import.meta.url); const M = req('../src/model.js'), X = req('./exc_progs.js'); fs.mkdirSync('test/out', { recursive: true }); fs.writeFileSync('test/out/excfun.fprg', M.serializeFprg(X.excfun())); fs.writeFileSync('test/out/excoo.fprg', M.serializeFprg(X.excoo())); }
const browser = await chromium.launch();
const page = await browser.newPage({ locale: 'it-IT', viewport: { width: 1440, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.clear(); const s = document.querySelector('#speed'); s.value = 3; s.dispatchEvent(new Event('input')); });
const wait = (ms = 150) => page.waitForTimeout(ms);
const ok = (name, cond) => console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
const out = async () => (await page.innerText('#conOut')).split('\n').filter((l) => l && !/^(▶|■)/.test(l)).join(' | ');
const load = async (f) => { await page.evaluate((x) => FlowLab.loadText(x, 'p.fprg'), fs.readFileSync(f, 'utf8')); await wait(250); };

// 1. programma con Try/Catch/Finally (vista Funzioni)
await load('test/out/excfun.fprg');
ok('rami Catch e Finally nel diagramma: ' + await page.locator('#chart .shape[data-kind=catch]').count() + ' Catch, ' + await page.locator('#chart .shape[data-kind=finally]').count() + ' Finally', (await page.locator('#chart .shape[data-kind=catch]').count()) >= 6 && (await page.locator('#chart .shape[data-kind=finally]').count()) === 3);
await page.click('#runBtn'); await wait(700);
ok('esecuzione: ' + await out(), (await out()).includes('indice non valido | conversione non valida | finally 1') && (await out()).includes('esterno: interna | ok 14'));
// passo passo: il cursore passa sulle intestazioni dei Catch
const seen = new Set(), labels = [], paths = {};
await page.click('#stepBtn'); await wait(40);
for (let i = 0; i < 120 && (await page.evaluate(() => FlowLab.run.state)) === 'paused'; i++) {
  const id = await page.evaluate(() => FlowLab.run.curId); if (id) seen.add(String(id).replace(/^s\d+:/, '').replace(/:s\d+$/, ''));
  const lab = await page.evaluate(() => { const l = document.querySelector('#chart .exc-lab'); return l && document.querySelector('#chart .trail-path.exc') ? l.textContent : null; });
  if (lab) labels.push(lab);
  // towards a Catch the path goes up to the exception arrow of the Try and follows it: right, up, right, down
  if (lab && /IndexOutOfRange/.test(lab) && !paths.idx) paths.idx = await page.evaluate(() => [...document.querySelector('#chart .trail-path.exc').getAttribute('d').matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => [+m[1], +m[2]]));
  await page.click('#stepBtn'); await wait(15);
}
ok('freccia rossa dell\'eccezione: ' + labels.join(' | '), labels.some((l) => /Exception da media\(\)/.test(l)) && labels.some((l) => /DivisionByZero → Finally, poi prosegue/.test(l)) && labels.some((l) => /IndexOutOfRange/.test(l)));
{ const q = paths.idx || []; ok('percorso verso il Catch lungo la freccia del Try: ' + JSON.stringify(q), q.length === 5 && q[1][0] > q[0][0] && q[2][1] < q[1][1] && q[3][0] > q[2][0] && q[4][1] > q[3][1]); }
ok('passo passo su Catch e Finally: ' + [...seen].filter((x) => /catch|finally/.test(x)).join(', '), seen.has('catch') && seen.has('finally'));
ok('errori: ' + errs.length, errs.length === 0);

// 2. un Try nuovo dalla tastiera (T) dopo il blocco selezionato
await page.evaluate(() => FlowLab.loadExample('grade_average')); await wait(200);
await page.locator('#chart .shape[data-kind=declare]').first().click(); await wait(60);
await page.keyboard.press('t'); await wait(200);
ok('dialogo del Try: ' + await page.locator('.modal h2').textContent(), (await page.locator('.modal h2').textContent()) === 'Nuovo blocco: Try' && (await page.locator('.modal .catchrow').count()) === 1);
const types = await page.locator('.modal .catchrow select').first().locator('option').allTextContents();
ok('tipi di eccezione: ' + types.join(', '), types.includes('Exception') && types.includes('DivisionByZero') && types.includes('IndexOutOfRange'));
await page.click('.modal button:has-text("+ Aggiungi Catch")'); await wait(60);
await page.locator('.modal .catchrow').nth(1).locator('select').selectOption('DivisionByZero');
await page.click('.modal footer .btn.primary'); await wait(120);
ok('Catch irraggiungibile: ' + await page.locator('.modal .formerr').textContent(), /non verrebbe mai eseguito/.test(await page.locator('.modal .formerr').textContent()));
await page.locator('.modal .catchrow').nth(1).locator('button[aria-label="Sposta su"]').click(); await wait(60);
await page.locator('.modal label:has-text("Finally")').click();
await page.click('.modal footer .btn.primary'); await wait(200);
const t = await page.evaluate(() => { let r = null; ModelLib.walk(FlowLab.state.prog.functions[0].body, (s) => { if (s.kind === 'try') r = { c: s.catches.map((c) => c.type + ' ' + c.variable), f: s.hasFinally }; }); return r; });
ok('Try creato: ' + JSON.stringify(t), t && t.c.join() === 'DivisionByZero e,Exception e' && t.f);
await page.screenshot({ path: 'test/exc1_try.png' });
// doppio clic sull'intestazione di un Catch: si modifica il Try
await page.locator('#chart .shape[data-kind=catch]').first().dblclick(); await wait(150);
ok('doppio clic sul Catch apre il Try', (await page.locator('.modal h2').textContent()) === 'Try');
await page.keyboard.press('Escape'); await wait(80);
// Throw con Maiusc+T: scelta rapida del tipo
await page.locator('#chart .shape[data-kind=try]').click(); await wait(60);
await page.keyboard.press('Shift+T'); await wait(200);
ok('dialogo del Throw: ' + await page.inputValue('#f_expression'), (await page.inputValue('#f_expression')) === 'new Exception("")');
await page.selectOption('#f_exctype', 'InvalidConversion'); await wait(50);
await page.fill('#f_expression', (await page.inputValue('#f_expression')).replace('("")', '("prova")'));
ok('tipo cambiato: ' + await page.inputValue('#f_expression'), (await page.inputValue('#f_expression')) === 'new InvalidConversion("prova")');
await page.click('.modal footer .btn.primary'); await wait(200);
// eccezione non gestita: il programma si ferma con il tipo e il messaggio
await page.evaluate(() => { const p = FlowLab.state.prog; p.functions[0].body = [ModelLib.makeStmt('throw', { expression: 'new InvalidConversion("prova")' })]; FlowLab.render(); });
await page.click('#runBtn'); await wait(400);
ok('non gestita: ' + await out(), /Eccezione non gestita: InvalidConversion — prova/.test(await out()));

// 3. vista Oggetti: eccezione dell'utente
await load('test/out/excoo.fprg');
await page.evaluate(() => FlowLab.showUml()); await wait(150);
const box = await page.locator('.ubox:has(.uname:text-is("SaldoInsufficiente"))').textContent();
ok('UML: ' + box.match(/«[^»]+»/)?.[0], /«eccezione»/.test(box));
await page.locator('.ubox:has(.uname:text-is("SaldoInsufficiente")) .uhit.head').dblclick(); await wait(150);
ok('classe madre: ' + await page.$eval('#f_cpar', (s) => s.value), (await page.$eval('#f_cpar', (s) => s.value)) === 'Exception' && (await page.locator('#f_cpar option').allTextContents()).includes('DivisionByZero (eccezione predefinita)'));
await page.keyboard.press('Escape'); await wait(80);
// eccezione predefinita nel diagramma: Exception, sopra o accanto a SaldoInsufficiente, con freccia di ereditarietà
const bi = page.locator('.ubox.builtin');
ok('riquadro predefinito: ' + (await bi.allTextContents()).join(' / '), (await bi.count()) === 1 && /Exception\(message: Stringa\)/.test(await bi.textContent()) && (await page.locator('.ubox.exc:not(.builtin)').count()) === 1);
const ov = await page.evaluate(() => { const a = document.querySelector('.ubox.builtin .ubg').getBBox(); return [...document.querySelectorAll('.ubox:not(.builtin) .ubg')].map((x) => x.getBBox()).some((b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height); });
ok('la predefinita non copre altre classi', !ov);
await bi.locator('.uheadbg').dblclick(); await wait(150);
ok('doppio clic: ' + await page.locator('.modal h2').textContent(), /Exception · eccezione predefinita/.test(await page.locator('.modal h2').textContent()));
await page.keyboard.press('Escape'); await wait(80);
await bi.locator('.uheadbg').click({ button: 'right' }); await wait(120);
ok('menu: ' + (await page.locator('.ctxmenu button').allTextContents()).join(' · '), (await page.locator('.ctxmenu button:has-text("Nuova eccezione che eredita da Exception…")').count()) === 1);
await page.keyboard.press('Escape'); await wait(80);
// la posizione si calcola la prima volta; spostando la sottoclasse resta ferma
const bpos = () => page.evaluate(() => { const r = document.querySelector('.ubox.builtin .ubg').getBBox(); return [Math.round(r.x), Math.round(r.y)]; });
const p0 = await bpos();
await page.evaluate(() => { const c = FlowLab.state.prog.classes.find((k) => k.name === 'SaldoInsufficiente'); c.x = 600; c.y = 400; FlowLab.render(); }); await wait(150);
ok(`sottoclasse spostata: predefinita ferma ${p0} → ${await bpos()}`, (await bpos()).join() === p0.join());
// si sposta trascinandola, senza modificare il programma
const hb = await bi.locator('.uheadbg').boundingBox();
await page.mouse.move(hb.x + 30, hb.y + 10); await page.mouse.down(); await page.mouse.move(hb.x + 130, hb.y + 90, { steps: 6 }); await page.mouse.up(); await wait(150);
const p1 = await bpos();
ok(`trascinata: ${p0} → ${p1}, programma non modificato`, Math.abs(p1[0] - p0[0] - 100) <= 10 && Math.abs(p1[1] - p0[1] - 80) <= 10 && !(await page.evaluate(() => FlowLab.state.dirty)));
// riaprendo il programma la posizione si ricalcola
await page.evaluate(() => { FlowLab.loadText(FlowLab.serialize(), 'p.fprg'); FlowLab.showUml(); }); await wait(200);
ok('riaperto: posizione ricalcolata ' + await bpos(), (await bpos()).join() !== p1.join());
// nuova classe: niente eccezioni tra le classi madri
await page.locator('#chart svg').click({ button: 'right', position: { x: 4, y: 4 } }); await wait(120);
ok('menu: ' + (await page.locator('.ctxmenu button').allTextContents()).join(' · '), (await page.locator('.ctxmenu button:has-text("Nuova eccezione…")').count()) === 1);
await page.click('.ctxmenu button:has-text("Nuova classe…")'); await wait(150);
const cOpts = await page.locator('#f_cpar option').allTextContents();
ok('Nuova classe, madri possibili: ' + cOpts.join(', '), !cOpts.some((o) => /Exception|DivisionByZero|SaldoInsufficiente/.test(o)) && cOpts.includes('Conto'));
await page.keyboard.press('Escape'); await wait(80);
// Maiusc+E: nuova eccezione, solo eccezioni tra le madri
await page.keyboard.press('Shift+E'); await wait(150);
const eOpts = await page.locator('#f_cpar option').allTextContents();
ok(`${await page.locator('.modal h2').textContent()}: madre ${await page.$eval('#f_cpar', (x) => x.value)}, possibili ${eOpts.join(', ')}`, (await page.locator('.modal h2').textContent()) === 'Nuova eccezione' && (await page.$eval('#f_cpar', (x) => x.value)) === 'Exception' && eOpts.includes('SaldoInsufficiente') && !eOpts.includes('Conto') && !eOpts.some((o) => /nessuna/.test(o)));
await page.fill('#f_cname', 'ImportoNonValido'); await page.locator('#f_cpar').selectOption('SaldoInsufficiente');
await page.click('.modal footer .btn.primary'); await wait(150);
ok('eccezione creata: ' + await page.evaluate(() => { const c = FlowLab.state.prog.classes.find((k) => k.name === 'ImportoNonValido'); return c && c.parent; }), (await page.evaluate(() => { const c = FlowLab.state.prog.classes.find((k) => k.name === 'ImportoNonValido'); return c && c.parent; })) === 'SaldoInsufficiente');
await page.keyboard.press('Control+z'); await wait(150);
await page.evaluate(() => FlowLab.showFunc(0)); await wait(150);
await page.click('#runBtn'); await wait(600);
ok('esecuzione: ' + await out(), (await out()).includes('saldo insufficiente: mancano 430 (prelievo troppo grande) | saldo: 70 | generica: importo negativo'));
await page.evaluate(() => FlowLab.setTab('code')); await page.selectOption('#langSel', 'java'); await wait(200);
const java = await page.locator('#codeOut').innerText();
ok('Java: throws e catch', /void preleva\(int x\) throws Exception/.test(java) && /catch \(SaldoInsufficiente e\)/.test(java) && /class SaldoInsufficiente extends Exception/.test(java));
// salvataggio: formato esteso
const xml = await page.evaluate(() => FlowLab.serialize());
ok('nel file: <try>, <catch>, <finally>, <throw>', /<try>/.test(xml) && /<catch type="SaldoInsufficiente" variable="e">/.test(xml) && /<finally>/.test(xml) && /<throw expression=/.test(xml));
console.log('ERR', errs);
await browser.close();
