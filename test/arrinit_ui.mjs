// Arrays with their initial values between braces: dialog, diagram, execution, checks
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
const page = await browser.newPage({ locale: 'it-IT', viewport: { width: 1440, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.clear(); const s = document.querySelector('#speed'); s.value = 3; s.dispatchEvent(new Event('input')); const p = FlowLab.state.prog; p.functions[0].body = [ModelLib.makeStmt('output', { expression: '"ok"' })]; FlowLab.render(); });
const wait = (ms = 150) => page.waitForTimeout(ms);
const ok = (name, cond) => console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
const out = async () => (await page.innerText('#conOut')).split('\n').filter((l) => l && !/^(▶|■)/.test(l)).join(' | ');
// new declaration from the keyboard: D after the output block
await page.locator('#chart .shape[data-kind=output]').click(); await page.keyboard.press('d'); await wait();
await page.fill('.modal #f_name', 'v');
await page.locator('.modal #f_array').check(); await wait();
ok('un solo campo per numero di elementi o valori: ' + await page.locator('.modal label[for=f_size]').textContent(), /valori iniziali/.test(await page.locator('.modal label[for=f_size]').textContent()) && !(await page.locator('.modal #f_init').isVisible()));
// wrong values: rows of different length
await page.fill('.modal #f_size', '{{1, 2}, {3}}'); await page.locator('.modal .btn.primary').click(); await wait();
ok('righe diverse: ' + await page.locator('.modal').textContent().then((t) => (t.match(/Tutte le righe[^.]*/) || [''])[0]), /stesso numero/.test(await page.locator('.modal').textContent()));
await page.fill('.modal #f_size', '{1, 2, 3}'); await page.locator('.modal .btn.primary').click(); await wait(200);
ok('dialogo chiuso', (await page.locator('.modal').count()) === 0);
const txt = await page.locator('#chart .shape[data-kind=declare]').textContent();
ok('diagramma: ' + txt, /v\[3\]: Intero ← \{1, 2, 3\}/.test(txt));
// a 2D array and an output
await page.evaluate(() => { const S = ModelLib.makeStmt, b = FlowLab.state.prog.functions[0].body; b.push(S('declare', { name: 'm', type: 'Integer', array: true, size: '', init: '{{1, 2}, {3, 4}}' }), S('output', { expression: 'v[2] + m[1, 0] & " " & Size(m, 1)' })); FlowLab.render(); });
await page.click('#runBtn'); await wait(500);
ok('esecuzione: ' + await out(), /6 \| 2|6 2/.test(await out()) || (await out()).includes('6 2'));
// reopen the dialog: the values are in their field
await page.locator('#chart .shape[data-kind=declare]').first().dblclick(); await wait();
ok('riaperto: ' + await page.inputValue('.modal #f_size'), (await page.inputValue('.modal #f_size')) === '{1, 2, 3}');
// a number in the same field is the size, as before
await page.fill('.modal #f_size', '5'); await page.locator('.modal .btn.primary').click(); await wait(200);
ok('numero: ' + await page.locator('#chart .shape[data-kind=declare]').first().textContent(), /v\[5\]: Intero$/.test((await page.locator('#chart .shape[data-kind=declare]').first().textContent()).trim()) && (await page.evaluate(() => FlowLab.state.prog.functions[0].body.find((x) => x.kind === 'declare').init)) === '');
await page.keyboard.press('Escape');
console.log('ERR', errs);
await browser.close();
