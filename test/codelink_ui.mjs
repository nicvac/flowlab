// Link between flowchart and code: block → lines, line → blocks, running block → line
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
const page = await browser.newPage({ locale: 'it-IT', viewport: { width: 1440, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.clear(); const s = document.querySelector('#speed'); s.value = 3; s.dispatchEvent(new Event('input')); FlowLab.loadExample('bubble_sort'); });
const wait = (ms = 150) => page.waitForTimeout(ms);
const ok = (name, cond) => console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
await wait(250);
await page.evaluate(() => FlowLab.setTab('code')); await page.selectOption('#langSel', 'java'); await wait(200);
const linked = () => page.evaluate(() => [...document.querySelectorAll('#codeOut .cl.linked')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()));
// 1. block → lines: the For of the Main lights its header and its closing brace
await page.locator('#chart .shape[data-kind=for]').first().click(); await wait(150);
let L1 = await linked();
ok('Per → righe: ' + JSON.stringify(L1), L1.length === 2 && /for \(i = 0/.test(L1[0]) && /^\d*\}$/.test(L1[1]));
// a declaration followed by an assignment: one line, two blocks
await page.locator('#chart .shape[data-kind=declare]').nth(1).click(); await wait(150);
L1 = await linked();
ok('Dichiara → riga unita: ' + JSON.stringify(L1), L1.length === 1 && /int i = 0;/.test(L1[0]));
// 2. line → blocks
await page.locator('#codeOut .cl', { hasText: 'final int' }).first().click(); await wait(150);
let lb = await page.evaluate(() => [...document.querySelectorAll('#chart .shape.linked')].map((g) => g.dataset.kind));
ok('riga della costante → blocco: ' + lb, lb.length === 1 && lb[0] === 'const');
// a line of another function: the sheet goes to that function
await page.locator('#codeOut .cl', { hasText: 't = v[j];' }).first().click(); await wait(250);
const fsel = await page.locator('#funcSel option:checked').textContent();
const lb2 = await page.evaluate(() => [...document.querySelectorAll('#chart .shape.linked')].map((g) => g.textContent.trim()));
ok(`riga di Ordina → foglio su ${fsel}, blocco ${lb2}`, /Ordina/.test(fsel) && lb2.length === 1 && /t ← v\[j\]/.test(lb2[0]));
// the signature line → Start block
await page.locator('#codeOut .cl', { hasText: 'public static void Stampa' }).first().click(); await wait(250);
const lb3 = await page.evaluate(() => [...document.querySelectorAll('#chart .shape.linked')].map((g) => g.dataset.id));
ok('firma → Inizio: ' + lb3, lb3.length === 1 && /^start:/.test(lb3[0]));
// a declaration followed by its assignment becomes one line: the line lights both blocks
await page.evaluate(() => { const S = ModelLib.makeStmt, p = FlowLab.state.prog; FlowLab.showFunc(0); p.functions[0].body.unshift(S('declare', { name: 'k', type: 'Integer' }), S('assign', { variable: 'k', expression: '5' })); FlowLab.render(); }); await wait(200);
await page.locator('#codeOut .cl', { hasText: 'int k = 5;' }).first().click(); await wait(150);
lb = await page.evaluate(() => [...document.querySelectorAll('#chart .shape.linked')].map((g) => g.dataset.kind));
ok('riga int k = 5; → blocchi: ' + lb, lb.length === 2 && lb.includes('declare') && lb.includes('assign'));
await page.locator('#chart .shape[data-kind=assign]').first().click(); await wait(150);
ok('Assegna k → riga unita: ' + JSON.stringify(await linked()), JSON.stringify(await linked()) === '["int k = 5;"]');
// 3. execution: the line of the running block
await page.evaluate(() => FlowLab.showFunc(0)); await wait(150);
for (let i = 0; i < 4; i++) { await page.click('#stepBtn'); await wait(120); }
const ex = await page.evaluate(() => ({ block: document.querySelector('#chart .shape.exec')?.textContent.trim(), lines: [...document.querySelectorAll('#codeOut .cl.exec')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()) }));
ok('esecuzione: blocco ' + ex.block + ' → righe ' + JSON.stringify(ex.lines), ex.lines.length >= 1 && !!ex.block);
await page.screenshot({ path: 'test/codelink.png' });
// other languages: python and pseudocode have the map too
for (const lg of ['python', 'pseudo', 'cpp', 'csharp', 'javascript']) {
  await page.selectOption('#langSel', lg); await wait(150);
  const n = await page.evaluate(() => document.querySelectorAll('#codeOut .cl.src').length);
  ok(`${lg}: righe collegate ${n}`, n > 10);
}
await page.click('#stopBtn').catch(() => {});
console.log('ERR', errs);
await browser.close();
