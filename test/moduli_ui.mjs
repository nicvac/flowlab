// Moduli: importazione dalla libreria, uso di una classe generica, sola lettura, salvataggio, aggiornamento e rimozione
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.clear(); const s = document.querySelector('#speed'); s.value = 0; s.dispatchEvent(new Event('input')); });
const wait = (ms = 150) => page.waitForTimeout(ms);
const ok = (name, cond) => console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
const out = async () => (await page.innerText('#conOut')).split('\n').filter((l) => l && !/^(Programma|▶|■|Esecuzione)/.test(l)).join(' | ');

// programma nuovo, vista funzioni: Ctrl+I apre la libreria
await page.evaluate(() => FlowLab.loadExample('tabellina')); await wait(200);
await page.keyboard.press('Control+i'); await wait(200);
await page.evaluate(() => document.querySelectorAll('.modal details').forEach((d) => { d.open = true; })); await page.waitForTimeout(100);
await page.waitForFunction(() => ![...document.querySelectorAll('.modsrc')].some((d) => /Caricamento/.test(d.innerText)), null, { timeout: 30000 });
await page.evaluate(() => document.querySelectorAll('.modal details').forEach((d) => { d.open = true; })); await page.waitForTimeout(100);

ok('dialogo dei moduli: ' + (await page.locator('.modtname').allTextContents()).join(', '), (await page.locator('.modsrc .modrow').count()) === 5);
await page.screenshot({ path: 'test/mod1_dialog.png' });
await page.locator('.modsrc .modrow', { hasText: 'ArrayList' }).locator('button').click(); await wait(250);
ok('importato: vista ' + await page.evaluate(() => FlowLab.state.view) + ', classi ' + (await page.locator('.uname').allTextContents()).join(', '), (await page.locator('.uname').allTextContents()).includes('ArrayList<T>'));
ok('riquadro del modulo', (await page.locator('.umod .umodlab').textContent()) === 'modulo ArrayList');
await page.screenshot({ path: 'test/mod2_uml.png' });

// il Main usa l'ArrayList
await page.evaluate(() => {
  const M = ModelLib, p = FlowLab.state.prog;
  p.functions[0].body = [
    M.makeStmt('declare', { name: 'l', type: 'ArrayList<Integer>' }), M.makeStmt('declare', { name: 'i', type: 'Integer' }),
    M.makeStmt('assign', { variable: 'l', expression: 'new ArrayList<Intero>()' }),
    M.makeStmt('for', { variable: 'i', start: '1', end: '12', direction: 'inc', step: '1', body: [M.makeStmt('call', { expression: 'l.add(i * 2)' })] }),
    M.makeStmt('output', { expression: '"Elementi: " & l.size() & ", ultimo: " & l.get(l.size() - 1)' }),
  ];
  FlowLab.render();
});
await page.click('#runBtn'); await wait(500);
ok('esecuzione: ' + await out(), (await out()).includes('Elementi: 12, ultimo: 24'));
// il tipo nel menu delle dichiarazioni
await page.evaluate(() => FlowLab.showFunc(0)); await wait(150);
await page.locator('#chart .shape[data-kind=declare]').first().dblclick(); await wait(150);
const opts = await page.locator('#f_type option').allTextContents();
ok('tipi nel menu: ' + opts.filter((o) => /ArrayList/.test(o)).join(' · '), opts.includes('ArrayList<T> (modulo)') && opts.filter((o) => /ArrayList/.test(o)).length === 1);
ok('il menu di T mostra Intero', (await page.$$eval('.modal .tpick select', (ss) => ss.map((x) => x.value))).join(',') === 'ArrayList,Integer');
await page.keyboard.press('Escape'); await wait(80);

// sola lettura: metodo del modulo
const addIdx = await page.evaluate(() => FlowLab.state.prog.functions.findIndex((f) => f.name === 'add'));
await page.evaluate((i) => FlowLab.showFunc(i), addIdx); await wait(150);
ok('barra: ' + await page.innerText('#crumbWhere'), (await page.innerText('#crumbWhere')).includes('sola lettura'));
ok('nessun punto di inserimento visibile', !(await page.locator('#chart .ins').first().isVisible()));
await page.locator('#chart .shape[data-kind=assign]').first().dblclick(); await wait(150);
ok('modifica bloccata: ' + await page.locator('.toast').textContent(), (await page.locator('.modal').count()) === 0);
await page.keyboard.press('a'); await wait(120);
ok('tasto A bloccato', (await page.locator('.modal').count()) === 0);
await page.screenshot({ path: 'test/mod3_method.png' });

// salvataggio e riapertura
const xml = await page.evaluate(() => FlowLab.serialize());
ok('nel file: module e tparams', /module="ArrayList"/.test(xml) && /tparams="T"/.test(xml) && /ArrayList&lt;Integer&gt;/.test(xml));
await page.evaluate((x) => FlowLab.loadText(x, 'prova.fprg'), xml); await wait(250);
await page.click('#runBtn'); await wait(500);
ok('dopo la riapertura: ' + await out(), (await out()).includes('Elementi: 12, ultimo: 24'));

// menu del modulo e rimozione
await page.evaluate(() => FlowLab.showUml()); await wait(150);
await page.locator('.ubox.mod .uhit.head').first().click({ button: 'right' }); await wait(100);
ok('menu della classe del modulo: ' + (await page.locator('#pop button').allTextContents()).join(' · '), (await page.locator('#pop button', { hasText: 'Rimuovi il modulo' }).count()) === 1);
await page.click('#pop button:has-text("Aggiorna il modulo")'); await wait(200);
ok('aggiornato: ' + await page.locator('.toast').textContent(), (await page.locator('.uname').allTextContents()).filter((n) => n === 'ArrayList<T>').length === 1);
await page.locator('.ubox.mod .uhit.head').first().click({ button: 'right' }); await wait(100);
await page.click('#pop button:has-text("Rimuovi il modulo")'); await wait(100);
ok('conferma: ' + (await page.locator('.modal .confirm').textContent()).slice(0, 80), true);
await page.click('.modal footer .btn.primary'); await wait(150);
ok('rimosso', !(await page.locator('.uname').allTextContents()).includes('ArrayList<T>'));
await page.keyboard.press('Control+z'); await wait(150);
ok('Ctrl+Z lo riporta', (await page.locator('.uname').allTextContents()).includes('ArrayList<T>'));

// coda con Nodo<T>
await page.keyboard.press('Control+i'); await wait(150);
await page.evaluate(() => document.querySelectorAll('.modal details').forEach((d) => { d.open = true; })); await page.waitForTimeout(100);
await page.waitForFunction(() => ![...document.querySelectorAll('.modsrc')].some((d) => /Caricamento/.test(d.innerText)), null, { timeout: 30000 });
await page.evaluate(() => document.querySelectorAll('.modal details').forEach((d) => { d.open = true; })); await page.waitForTimeout(100);

await page.locator('.modsrc .modrow', { hasText: 'Queue' }).locator('button').click(); await wait(250);
ok('Queue: ' + (await page.locator('.umod .umodlab').allTextContents()).join(', '), (await page.locator('.umod').count()) === 2);
await page.screenshot({ path: 'test/mod4_two.png' });
// moduli di sole funzioni (Ordinamento, Ricerca) in un programma a funzioni: la vista non cambia
await page.evaluate(() => { FlowLab.loadExample('tabellina'); FlowLab.setView('functions'); }); await wait(200);
for (const id of ['Ordinamento', 'Ricerca']) {
  await page.keyboard.press('Control+i'); await wait(150);
  await page.evaluate(() => document.querySelectorAll('.modal details').forEach((d) => { d.open = true; })); await page.waitForTimeout(100);
  await page.waitForFunction(() => ![...document.querySelectorAll('.modsrc')].some((d) => /Caricamento/.test(d.innerText)), null, { timeout: 30000 });
  await page.evaluate(() => document.querySelectorAll('.modal details').forEach((d) => { d.open = true; })); await page.waitForTimeout(100);
  await page.locator('.modsrc .modrow', { hasText: id }).first().locator('button').click(); await wait(250);
}
ok('vista dopo l\'importazione: ' + await page.evaluate(() => FlowLab.state.view), (await page.evaluate(() => FlowLab.state.view)) === 'functions' && !(await page.evaluate(() => !!FlowLab.state.prog.classes)));
ok('funzioni: ' + (await page.locator('#funcSel option').allTextContents()).slice(1).join(' | '), (await page.locator('#funcSel option').count()) === 6);
await page.evaluate(() => {
  const M = ModelLib, p = FlowLab.state.prog;
  p.functions[0].body = [M.makeStmt('declare', { name: 'v', type: 'Integer', array: true, size: '6' }), M.makeStmt('declare', { name: 'i', type: 'Integer' }),
    M.makeStmt('for', { variable: 'i', start: '0', end: '5', direction: 'inc', step: '1', body: [M.makeStmt('assign', { variable: 'v[i]', expression: '(i * 7) mod 6' })] }),
    M.makeStmt('call', { expression: 'bubbleSort(v, 6)' }),
    M.makeStmt('output', { expression: '"Ordinato, il 4 è in posizione " & ricercaBinaria(v, 6, 4)' })];
  FlowLab.showFunc(0); FlowLab.render();
});
await page.click('#runBtn'); await wait(500);
ok('uso dal Main: ' + await out(), (await out()).includes('il 4 è in posizione 4'));
console.log('ERR', errs);
await browser.close();
