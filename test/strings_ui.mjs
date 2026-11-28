// Strings module: imported from the modules dialog in a program with functions; the code uses the functions of the language
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
const page = await browser.newPage({ locale: 'it-IT', viewport: { width: 1440, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
// the collection built into the page (the one on GitHub may be older than this build)
await page.route(/github(usercontent)?\.com/, (r) => r.abort());
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.clear(); const s = document.querySelector('#speed'); s.value = 3; s.dispatchEvent(new Event('input')); });
const wait = (ms = 150) => page.waitForTimeout(ms);
const ok = (name, cond) => console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
const out = async () => (await page.innerText('#conOut')).split('\n').filter((l) => l && !/^(Programma|▶|■|Esecuzione)/.test(l)).join(' | ');

await page.evaluate(() => FlowLab.loadExample('times_table')); await wait(200);
await page.keyboard.press('Control+i'); await wait(200);
await page.waitForFunction(() => ![...document.querySelectorAll('.modsrc')].some((d) => /Caricamento/.test(d.innerText)), null, { timeout: 30000 });
await page.evaluate(() => document.querySelectorAll('.modal details').forEach((d) => { d.open = true; })); await wait(100);
const row = page.locator('.modsrc .modrow', { hasText: 'Strings' });
ok('Strings nella libreria: ' + (await row.innerText()).replace(/\s+/g, ' ').slice(0, 90), (await row.count()) === 1);
await row.locator('button').click(); await wait(250);
const st = await page.evaluate(() => ({ view: FlowLab.state.view, fns: FlowLab.state.prog.functions.filter((f) => f.module).map((f) => f.name) }));
ok('importato: vista ' + st.view + ', funzioni ' + st.fns.join(' '), st.view !== 'objects' && st.fns.includes('Substring') && st.fns.includes('Split'));

await page.evaluate(() => {
  const M = ModelLib, p = FlowLab.state.prog;
  p.functions[0].body = [
    M.makeStmt('declare', { name: 'nome', type: 'String' }), M.makeStmt('declare', { name: 'parti', type: 'String', array: true, size: '1' }),
    M.makeStmt('assign', { variable: 'nome', expression: 'Trim("  Ada Lovelace ")' }),
    M.makeStmt('assign', { variable: 'parti', expression: 'Split(nome, " ")' }),
    M.makeStmt('output', { expression: 'ToUpper(Substring(nome, 0, 3)) & " " & Size(parti) & " " & IndexOf(nome, "Love") & " " & Contains(nome, "Ada")' }),
  ];
  FlowLab.render();
});
await page.click('#runBtn'); await wait(600);
ok('esecuzione: ' + await out(), (await out()).includes('ADA 2 4 true'));
const code = await page.evaluate(() => Object.fromEntries(['java', 'python', 'cpp', 'csharp', 'javascript'].map((l) => [l, CodeGen.generate(FlowLab.state.prog, l)])));
ok('Java: metodi di String, nessuna funzione del modulo', /nome\.substring\(0, 3\)\.toUpperCase\(\)/.test(code.java) && /\.split\(/.test(code.java) && !/static \S+ Substring\(/.test(code.java));
ok('Python: ' + (code.python.match(/print\(.*\)/) || [''])[0], /nome\[0:3\]\.upper\(\)/.test(code.python) && !/def Substring/.test(code.python));
ok('C++: substr e helper', /nome\.substr\(0, 3 - 0\)/.test(code.cpp) && /vector<string> splitStr/.test(code.cpp) && !/Substring\(/.test(code.cpp));
ok('C#: Substring di string', /nome\.Substring\(0, 3 - 0\)\.ToUpperInvariant\(\)/.test(code.csharp) && !/static string Substring/.test(code.csharp));
ok('JavaScript: includes', /nome\.includes\("Ada"\)/.test(code.javascript) && !/function Substring/.test(code.javascript));
// the pseudocode keeps the functions of the module
const ps = await page.evaluate(() => CodeGen.generate(FlowLab.state.prog, 'pseudo'));
ok('pseudocodice: le funzioni del modulo restano', /Substring/.test(ps) && /Split/.test(ps));
console.log('ERR', errs);
await browser.close();
