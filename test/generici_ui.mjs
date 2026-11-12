// Classe generica creata con i dialoghi e modulo scritto "da uno studente" importato da file
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.clear(); const s = document.querySelector('#speed'); s.value = 0; s.dispatchEvent(new Event('input')); });
const wait = (ms = 150) => page.waitForTimeout(ms);
const ok = (name, cond) => console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
const out = async () => (await page.innerText('#conOut')).split('\n').filter((l) => l && !/^(▶|■)/.test(l)).join(' | ');

// 1. classe Scatola<T> con i dialoghi: il Tipo Generico nasce dall'attributo
await page.evaluate(() => FlowLab.loadExample('tabellina')); await wait(150);
await page.click('#viewOo'); await wait(150);
await page.keyboard.press('n'); await wait(120);
ok('nessun campo per i tipi nel dialogo della classe', (await page.locator('#f_ctp').count()) === 0);
await page.fill('#f_cname', 'Scatola'); await page.click('.modal footer .btn.primary'); await wait(150);
await page.locator('.ubox:has(.uname:text-is("Scatola")) .uhit.head').click(); await wait(60);
await page.keyboard.press('a'); await wait(120);
const aopts = await page.locator('#f_atype option').allTextContents();
ok('nel menu del tipo: Nuovo Tipo Generico', aopts.includes('Nuovo Tipo Generico'));
await page.fill('#f_aname', 'contenuto'); await page.selectOption('#f_atype', { label: 'Nuovo Tipo Generico' }); await wait(60);
ok('nome assegnato: ' + await page.$eval('#f_atype', (s) => s.value), (await page.$eval('#f_atype', (s) => s.value)) === 'T');
await page.click('.modal footer .btn.primary'); await wait(150);
ok('classe: ' + (await page.locator('.uname').allTextContents()).join(', '), (await page.locator('.uname').allTextContents()).includes('Scatola<T>'));
await page.locator('.ubox:has(.uname:text-is("Scatola<T>")) .uhit.head').click(); await wait(60);
// metodo metti(x: T) e prendi(): T
await page.keyboard.press('m'); await wait(120);
await page.fill('#f_fname', 'metti');
await page.click('.modal button:has-text("Aggiungi parametro")'); await page.fill('.modal .prow input', 'x');
ok('T nel menu del parametro: ' + (await page.locator('.modal .prow select').first().locator('option').allTextContents()).filter((o) => /Generico/.test(o)).join(', '), (await page.locator('.modal .prow select').first().locator('option').allTextContents()).includes('T (Tipo Generico)'));
await page.selectOption('.modal .prow select', 'T');
await page.click('.modal footer .btn.primary'); await wait(150);
await page.evaluate(() => { const p = FlowLab.state.prog; const f = p.functions.find((x) => x.name === 'metti'); f.body = [ModelLib.makeStmt('assign', { variable: 'contenuto', expression: 'x' })]; });
await page.evaluate(() => FlowLab.showUml()); await wait(100);
await page.locator('.ubox:has(.uname:text-is("Scatola<T>")) .uhit.head').click(); await wait(60);
await page.keyboard.press('m'); await wait(120);
await page.fill('#f_fname', 'prendi');
await page.click('.modal button:has-text("Aggiungi valore restituito")'); await page.fill('.modal .rrow input', 'contenuto'); await wait(60);
await page.click('.modal footer .btn.primary'); await wait(150);
// Main
await page.evaluate(() => {
  const M = ModelLib, p = FlowLab.state.prog;
  p.functions[0].body = [
    M.makeStmt('declare', { name: 's', type: 'Scatola<String>' }), M.makeStmt('assign', { variable: 's', expression: 'new Scatola<>()' }),
    M.makeStmt('call', { expression: 's.metti("ciao")' }), M.makeStmt('output', { expression: 's.prendi() & "!"' }),
    M.makeStmt('call', { expression: 's.metti(3)' }),
  ];
  FlowLab.showFunc(0);
});
await wait(150);
await page.click('#runBtn'); await wait(500);
ok('esecuzione e controllo del tipo: ' + await out(), (await out()).includes('ciao!') && /l'argomento "x" di metti è Intero ma serve Stringa/.test(await out()));
await page.evaluate(() => FlowLab.setTab('code')); await page.selectOption('#langSel', 'java'); await wait(200);
const java = await page.locator('#codeOut').innerText();
ok('Java: ' + java.split('\n').filter((l) => /class Scatola|Scatola<String> s|new Scatola/.test(l)).map((l) => l.trim()).join(' · '), /class Scatola<T>/.test(java) && /Scatola<String> s = new Scatola<(String)?>\(\)/.test(java));
await page.selectOption('#langSel', 'cpp'); await wait(200);
const cpp = await page.locator('#codeOut').innerText();
ok('C++: template', /template <typename T>\s*\n\s*class Scatola/.test(cpp) && /Scatola<string>\* s = new Scatola<string>\(\);/.test(cpp));
// a una classe già usata non si aggiunge un altro Tipo Generico
await page.evaluate(() => FlowLab.showUml()); await wait(100);
await page.locator('.ubox:has(.uname:text-is("Scatola<T>")) .uhit.head').click(); await wait(60);
await page.keyboard.press('a'); await wait(120);
await page.fill('#f_aname', 'altro'); await page.selectOption('#f_atype', { label: 'Nuovo Tipo Generico' }); await wait(60);
ok('secondo Tipo Generico: ' + await page.$eval('#f_atype', (s) => s.value), (await page.$eval('#f_atype', (s) => s.value)) === 'S');
await page.click('.modal footer .btn.primary'); await wait(100);
ok('classe usata: ' + await page.locator('.modal .formerr').textContent(), /già usata/.test(await page.locator('.modal .formerr').textContent()));
await page.keyboard.press('Escape'); await wait(80);

// 2. modulo di uno studente: un programma a funzioni salvato come file
const xmlStud = await page.evaluate(() => {
  const M = ModelLib; const p = M.newProgram(); p.attrs.name = 'Statistiche'; p.attrs.about = 'Media e massimo di un array';
  const media = M.makeFunction('media', { params: [{ name: 'v', type: 'Integer', array: true }, { name: 'n', type: 'Integer', array: false }] });
  M.setRets(media, [{ name: 'm', type: 'Real' }]);
  media.body = [M.makeStmt('declare', { name: 'i', type: 'Integer' }), M.makeStmt('declare', { name: 'm', type: 'Real' }), M.makeStmt('assign', { variable: 'm', expression: '0' }),
    M.makeStmt('for', { variable: 'i', start: '0', end: 'n - 1', direction: 'inc', step: '1', body: [M.makeStmt('assign', { variable: 'm', expression: 'm + v[i]' })] }),
    M.makeStmt('assign', { variable: 'm', expression: 'm / n' })];
  p.functions.push(media);
  p.functions[0].body = [M.makeStmt('output', { expression: '"prova"' })];
  return M.serializeFprg(p);
});
fs.writeFileSync('test/out/Statistiche.fprg', xmlStud);
await page.keyboard.press('Control+i'); await wait(150);
await page.evaluate(() => document.querySelectorAll('.modal details').forEach((d) => { d.open = true; })); await page.waitForTimeout(100);
await page.waitForFunction(() => ![...document.querySelectorAll('.modsrc')].some((d) => /Caricamento/.test(d.innerText)), null, { timeout: 30000 });
await page.evaluate(() => document.querySelectorAll('.modal details').forEach((d) => { d.open = true; })); await page.waitForTimeout(100);

const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.modal button:has-text("Importa da un file")')]);
await chooser.setFiles('test/out/Statistiche.fprg'); await wait(300);
ok('modulo da file: ' + await page.locator('.toast').textContent(), /Statistiche importato: media\(\)/.test(await page.locator('.toast').textContent()));
await page.evaluate(() => {
  const M = ModelLib, p = FlowLab.state.prog;
  p.functions[0].body = [M.makeStmt('declare', { name: 'v', type: 'Integer', array: true, size: '3' }), M.makeStmt('assign', { variable: 'v[0]', expression: '4' }), M.makeStmt('assign', { variable: 'v[1]', expression: '5' }), M.makeStmt('assign', { variable: 'v[2]', expression: '9' }),
    M.makeStmt('output', { expression: '"Media: " & media(v, 3)' })];
  FlowLab.showFunc(0);
});
await page.click('#runBtn'); await wait(400);
ok('uso del modulo: ' + await out(), (await out()).includes('Media: 6'));
console.log('ERR', errs);
await browser.close();
