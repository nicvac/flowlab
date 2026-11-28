// Module with only functions imported into a program with classes: outside the classes, a box of its own in the class diagram,
// callable from every class; the menu of the diagrams shows it apart
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
const page = await browser.newPage({ locale: 'it-IT', viewport: { width: 1440, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.route(/github(usercontent)?\.com/, (r) => r.abort());
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.clear(); const s = document.querySelector('#speed'); s.value = 3; s.dispatchEvent(new Event('input')); });
const wait = (ms = 150) => page.waitForTimeout(ms);
const ok = (name, cond) => console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
const out = async () => (await page.innerText('#conOut')).split('\n').filter((l) => l && !/^(Programma|▶|■|Esecuzione)/.test(l)).join(' | ');
const importMod = async (name) => {
  await page.keyboard.press('Control+i'); await wait(250);
  await page.evaluate(() => document.querySelectorAll('.modal details').forEach((d) => { d.open = true; })); await wait(100);
  await page.locator('.modsrc .modrow', { hasText: name }).locator('button').click(); await wait(300);
};

// a program with a class Parola, then the module Strings
await page.evaluate(() => {
  FlowLab.loadExample('times_table');
});
await wait(200);
await page.evaluate(() => {
  const M = ModelLib, p = FlowLab.state.prog;
  M.wrapInClass(p);
  const c = M.makeClass('Parola', { attributes: [M.makeAttribute({ name: 'testo', type: 'String' })], x: 40, y: 260 });
  p.classes.push(c);
  const f = M.makeFunction('corta', { cls: c.id, visibility: 'public', static: false, ctor: false, body: [M.makeStmt('declare', { name: 'r', type: 'String' }), M.makeStmt('assign', { variable: 'r', expression: 'ToUpper(Substring(Trim(testo), 0, 4))' })] });
  M.setRets(f, [{ name: 'r', type: 'String' }]);
  const k = M.makeFunction('Parola', { cls: c.id, visibility: 'public', static: false, ctor: true, params: [{ name: 't', type: 'String', array: false }], body: [M.makeStmt('assign', { variable: 'testo', expression: 't' })] });
  p.functions.push(k, f);
  p.functions[0].body = [M.makeStmt('declare', { name: 'w', type: 'Parola' }), M.makeStmt('assign', { variable: 'w', expression: 'new Parola("  ciao mondo")' }), M.makeStmt('output', { expression: 'w.corta() & " " & IndexOf("abc", "c")' })];
  FlowLab.setView ? FlowLab.setView('objects') : null;
  FlowLab.render();
});
await page.keyboard.press('Control+Alt+o'); await wait(250);
await importMod('Strings');
const st = await page.evaluate(() => { const p = FlowLab.state.prog; return { view: FlowLab.state.view, fns: p.functions.filter((f) => f.module).map((f) => f.cls || '-').join(''), main: p.classes.map((c) => c.name + ':' + ModelLib.membersOf(p, c).length).join(' ') }; });
ok('importate fuori dalle classi: ' + JSON.stringify(st), st.view === 'objects' && /^-+$/.test(st.fns) && st.fns.length === 12);

// class diagram: the box of the module with its functions
await page.evaluate(() => FlowLab.showUml && FlowLab.showUml()); await wait(250);
const box = await page.evaluate(() => { const g = document.querySelector('#chart .umodf'); return g ? { label: g.querySelector('.umodlab').textContent, rows: [...g.querySelectorAll('.urow .umem')].map((t) => t.textContent) } : null; });
ok('riquadro del modulo: ' + JSON.stringify(box && { label: box.label, n: box.rows.length, first: box.rows[0] }), box && box.label === 'modulo Strings' && box.rows.length === 12 && /^Substring\(s: Stringa, beginIndex: Intero, endIndex: Intero\): Stringa$/.test(box.rows[0]));
await page.screenshot({ path: 'test/fmod_oo1.png' });
// double click on a function: its flowchart, read-only, with «modulo Strings» in the bar
await page.locator('#chart .umodf .urow', { hasText: 'Split' }).dblclick(); await wait(250);
ok('diagramma di Split: ' + await page.innerText('#crumbWhere'), /^Split\(\) · modulo Strings/.test(await page.innerText('#crumbWhere')) && /sola lettura/.test(await page.innerText('#crumbWhere')));
// collapse and expand from the + button of the box
await page.evaluate(() => FlowLab.showUml && FlowLab.showUml()); await wait(200);
await page.locator('#chart .umodf .umodtog').click(); await wait(200);
ok('compresso: ' + await page.locator('#chart .umodf .umodcls').textContent(), (await page.locator('#chart .umodf .urow').count()) === 0 && (await page.locator('#chart .umodf .umodcls').textContent()) === '12 funzioni');
await page.locator('#chart .umodf .umodtog').click(); await wait(200);
// dragged: it moves
const b0 = await page.locator('#chart .umodf .umodbg').boundingBox();
await page.mouse.move(b0.x + 40, b0.y + 12); await page.mouse.down(); await page.mouse.move(b0.x + 80, b0.y + 52); await page.mouse.move(b0.x + 120, b0.y + 92); await page.mouse.up(); await wait(200);
const b1 = await page.locator('#chart .umodf .umodbg').boundingBox();
ok(`trascinato: ${Math.round(b1.x - b0.x)}, ${Math.round(b1.y - b0.y)}`, Math.abs(b1.x - b0.x - 80) < 4 && Math.abs(b1.y - b0.y - 80) < 4);

// the program runs: a method of Parola calls the functions of the module
await page.click('#runBtn'); await wait(700);
ok('esecuzione: ' + await out(), (await out()).includes('CIAO 2'));
// code: methods of String, no Strings class
const java = await page.evaluate(() => CodeGen.generate(FlowLab.state.prog, 'java'));
ok('Java: ' + (java.match(/return .*;|String r = .*;/) || [''])[0], /testo\.trim\(\)\.substring\(0, 4\)\.toUpperCase\(\)/.test(java) && !/class Strings/.test(java));

// menu of the diagrams: classes, then the module apart
await page.click('#funcSel'); await wait(150);
const it = await page.$$eval('#pop .fmenu > *', (es) => es.map((e) => e.textContent));
ok('menu: ' + it.join(' | '), it.some((x) => /^\+modulo Strings12$/.test(x)) && it.indexOf('Classe Parola') < it.findIndex((x) => /modulo Strings/.test(x)));
await page.keyboard.press('Escape');

// saved and reopened: still outside the classes
const xml = await page.evaluate(() => FlowLab.serialize());
const back = await page.evaluate((x) => { const p = ModelLib.parseFprg(x); return p.functions.filter((f) => f.module).map((f) => (f.cls ? 'C' : '-')).join(''); }, xml);
ok('riaperto: ' + back, /^-{12}$/.test(back));
// a file saved before (functions of the module inside the main class): they come out of the class
const old = await page.evaluate((x) => { const y = x.replace(/(flowlab-module="Strings"[^>]*flowlab-class=")"/g, '$1Tabellina"'); const p = ModelLib.parseFprg(y); return p.functions.filter((f) => f.module).map((f) => (f.cls ? 'C' : '-')).join(''); }, xml);
ok('file precedente: ' + old, /^-{12}$/.test(old));
console.log('ERR', errs);
await browser.close();
