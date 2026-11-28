// Inheritance with Generic Types: Pila<T> extends Lista<T>, ListaInteri extends Lista<Integer>; file, run, class diagram, dialog
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
import { createRequire } from 'module';
{ const req = createRequire(import.meta.url); const M = req('../src/model.js'), G = req('./gen_progs.js'); fs.mkdirSync('test/out', { recursive: true }); fs.writeFileSync('test/out/geninh.fprg', M.serializeFprg(G.geninh())); }
const browser = await chromium.launch();
const page = await browser.newPage({ locale: 'it-IT', viewport: { width: 1440, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.clear(); const s = document.querySelector('#speed'); s.value = 3; s.dispatchEvent(new Event('input')); });
const wait = (ms = 150) => page.waitForTimeout(ms);
const ok = (name, cond) => console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
const out = async () => (await page.innerText('#conOut')).split('\n').filter((l) => l && !/^(Programma|▶|■|Esecuzione)/.test(l)).join(' | ');
const cls = () => page.evaluate(() => FlowLab.state.prog.classes.map((c) => ModelLib.classTitle(c) + (c.parent ? ' > ' + ModelLib.parentTitle(c) : '')).join('; '));

await page.evaluate((x) => FlowLab.loadText(x, 'geninh.fprg'), fs.readFileSync('test/out/geninh.fprg', 'utf8')); await wait(300);
ok('dal file: ' + await cls(), /Pila<T> > Lista<T>/.test(await cls()) && /ListaInteri > Lista<Integer>/.test(await cls()) && /Coppia<K, V> > Lista<V>/.test(await cls()));
await page.click('#runBtn'); await wait(800);
ok('esecuzione: ' + await out(), (await out()) === 'cb 1 lista di 1 | somma 7 su 2, primo 3 | q 8 2 | q 3 5 | k 1.5 2.25 max 2.25 5');

// class diagram: the inheritance arrows with the types given to Lista
await page.evaluate(() => { FlowLab.state.prog.classes.forEach((c, i) => { c.x = 40 + (i % 3) * 330; c.y = 40 + Math.floor(i / 3) * 300; }); FlowLab.showUml(); FlowLab.render(); }); await wait(250);
const binds = await page.$$eval('#chart .ubind', (es) => es.map((e) => e.textContent));
ok('frecce: ' + binds.join(' | '), binds.includes('«bind» T→Intero') && binds.includes('«bind» T→V') && binds.length === 2);
await page.screenshot({ path: 'test/geninh1.png' });

// new class Coda that inherits from Lista with a new Generic Type
await page.click('#funcAdd'); await wait(120);
await page.fill('#f_cname', 'Coda'); await page.selectOption('#f_cpar', 'Lista'); await wait(80);
const picks = await page.locator('.modal .pargs select').count();
ok('tipo per la classe madre: ' + picks, picks === 1);
await page.locator('.modal .pargs select').first().selectOption({ label: 'Nuovo Tipo Generico…' }).catch(async () => {
  const v = await page.$$eval('.modal .pargs select option', (os) => os.filter((o) => o.classList.contains('newgen')).map((o) => o.value)); await page.locator('.modal .pargs select').first().selectOption(v[0]);
});
await wait(80);
await page.screenshot({ path: 'test/geninh2.png' });
await page.click('.modal footer .btn.primary'); await wait(200);
ok('Coda: ' + await cls(), /Coda<T> > Lista<T>/.test(await cls()));
// ListaInteri: Lista<String> (the class is used, but its Generic Types do not change)
await page.locator('.ubox:has(.uname:text-is("ListaInteri")) .uhit.head').dblclick(); await wait(150);
ok('dialogo di ListaInteri: ' + await page.locator('.modal .pargs select').first().inputValue(), (await page.locator('.modal .pargs select').first().inputValue()) === 'Integer');
await page.locator('.modal .pargs select').first().selectOption('String'); await page.click('.modal footer .btn.primary'); await wait(200);
ok('ListaInteri: ' + await cls(), /ListaInteri > Lista<String>/.test(await cls()));
await page.keyboard.press('Control+z'); await wait(150);
// Pila used in the program: it cannot lose its Generic Type T by inheriting from Lista<Integer>… but T is in push(x: T), so it stays
await page.locator('.ubox:has(.uname:text-is("Pila<T>")) .uhit.head').dblclick(); await wait(150);
await page.locator('.modal .pargs select').first().selectOption('Integer'); await page.click('.modal footer .btn.primary'); await wait(200);
ok('Pila<T> > Lista<Integer>: ' + await cls(), /Pila<T> > Lista<Integer>/.test(await cls()));
await page.keyboard.press('Control+z'); await wait(150);
// Lista gets a second Generic Type: the subclasses pass it on (Pila<T, S> extends Lista<T, S>) — refused, Pila is used
// saved and reopened: the parent types stay
const xml = await page.evaluate(() => FlowLab.serialize());
ok('nel file: parent-args', /parent="Lista" parent-args="T"/.test(xml) && /parent-args="Integer"/.test(xml));
await page.locator('.ubox:has(.uname:text-is("Lista<T>")) .uadd[data-add=attr]').click(); await wait(150);
await page.fill('#f_aname', 'extra');
{ const v = await page.$$eval('#f_atype option', (os) => os.filter((o) => o.classList.contains('newgen')).map((o) => o.value)); await page.selectOption('#f_atype', v[0]); }
await page.click('.modal footer .btn.primary'); await wait(150);
const err = await page.locator('.modal .formerr').textContent().catch(() => '');
ok('Lista<T, S> con sottoclassi già usate: ' + err, /già usata/.test(err));
await page.click('.modal footer .btn:not(.primary)'); await wait(80);
// a subclass not used yet follows: Coda<T, S> extends Lista<T, S>
await page.evaluate(() => {
  const p = FlowLab.state.prog; const used = ['Pila', 'ListaInteri', 'Coppia'];
  p.classes = p.classes.filter((c) => !used.includes(c.name)); p.functions = p.functions.filter((f) => !f.cls || p.classes.some((c) => c.id === f.cls));
  p.functions[0].body = []; FlowLab.render();
});
await wait(150);
await page.locator('.ubox:has(.uname:text-is("Lista<T>")) .uadd[data-add=attr]').click(); await wait(150);
await page.fill('#f_aname', 'extra');
{ const v = await page.$$eval('#f_atype option', (os) => os.filter((o) => o.classList.contains('newgen')).map((o) => o.value)); await page.selectOption('#f_atype', v[0]); }
await page.click('.modal footer .btn.primary'); await wait(200);
ok('la sottoclasse segue: ' + await cls(), /Lista<T, S>/.test(await cls()) && /Coda<T, S> > Lista<T, S>/.test(await cls()));
console.log('ERR', errs);
await browser.close();
