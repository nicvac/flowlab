// Escape sequences and Enter in the Output dialog: Enter inside a string goes to a new line, and the string contains the
// line break (outside a string Enter confirms the dialog); the sequences are red in the field, in the diagram and in the code
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch(); const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1366, height: 860 }, deviceScaleFactor: 1 });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
const ok = (name, cond) => console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('flowlab.lang', 'en'); }); await page.reload(); await page.waitForTimeout(400);
await page.evaluate(() => { FlowLab.state.dirty = false; const p = ModelLib.newProgram(); FlowLab.loadText(ModelLib.serializeFprg(p), 'e.fprg'); const s = document.querySelector('#speed'); s.value = s.max; s.dispatchEvent(new Event('input')); });
await page.waitForTimeout(200);
const ins = await page.$$('#chart .ins'); await ins[0].click();
await page.click('.insbtn[title="Output"]'); await page.waitForTimeout(150);
await page.click('#f_expression');
await page.keyboard.type('"Hello');
await page.keyboard.press('Enter');
ok('Enter inside the string goes to a new line, the dialog stays open', (await page.inputValue('#f_expression')) === '"Hello\n' && await page.isVisible('.modal') && await page.$eval('#f_expression', (t) => t.rows) === 2);
await page.keyboard.type('world\\ttab\\n" & Max(3, 8)');
const mir = await page.evaluate(() => { const m = document.querySelector('.escbox'); return { on: m.classList.contains('on'), red: [...m.querySelectorAll('.tesc')].map((x) => x.textContent), color: getComputedStyle(document.querySelector('#f_expression')).color, txt: m.querySelector('.escmirror').textContent }; });
ok('field: the sequences in red ' + JSON.stringify(mir), mir.on && mir.red.join(',') === '\\t,\\n' && mir.color === 'rgba(0, 0, 0, 0)' && mir.txt.trim() === '"Hello\nworld\\ttab\\n" & Max(3, 8)');
await page.screenshot({ path: 'test/esc1.png', clip: await page.locator('.modal').boundingBox() });
// the caret after the string: Enter confirms
await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
ok('Enter outside the string confirms the dialog', !(await page.isVisible('.modal')));
const sh = await page.evaluate(() => { const g = document.querySelector('#chart .shape[data-kind=output]'); return { red: [...g.querySelectorAll('.escseq')].map((x) => x.textContent), fill: getComputedStyle(g.querySelector('.escseq')).fill, lines: [...g.querySelectorAll('text:not(.badge)')].map((t) => t.textContent) }; });
ok('diagram, two lines: ' + JSON.stringify(sh), sh.red.join(',') === '\\t,\\n' && /rgb\(2[0-9][0-9], [0-9]+, [0-9]+\)/.test(sh.fill) && sh.lines.join('|') === '"Hello|world\\ttab\\n" & Max(3, 8)');
await page.screenshot({ path: 'test/esc2.png', clip: { x: 0, y: 40, width: 900, height: 360 } });
await page.click('#runBtn'); await page.waitForFunction(() => /End of program/.test(document.querySelector('#conOut').innerText), null, { timeout: 20000 });
const con = await page.innerText('#conOut');
ok('console: ' + JSON.stringify(con.split('\n').slice(0, 3)), /Hello\nworld\ttab\n8/.test(con));
// the .fprg: the line break as &#10;, in the extended format
const fx = await page.evaluate(() => ({ x: FlowLab.serialize(), ext: ModelLib.extendedFeatures(FlowLab.state.prog).join(' | ') }));
ok('fprg: ' + fx.ext, fx.x.includes('Hello&#10;world') && /several lines/.test(fx.ext));
// the code: the sequences red in the strings
await page.click('.tabw[data-tab=code] [role=tab]'); await page.waitForTimeout(200);
const code = await page.evaluate(() => [...document.querySelectorAll('.tesc')].filter((x) => x.closest('.ts')).map((x) => x.textContent));
const pyline = await page.evaluate(() => [...document.querySelectorAll('.cl')].map((x) => x.textContent).find((x) => x.includes('Hello')));
ok('code: ' + code.join(',') + ' · ' + pyline, code.includes('\\n') && code.includes('\\t') && pyline.includes('"Hello\\nworld\\ttab\\n"'));
// a string without sequences: the field is normal (no copy over it)
await page.dblclick('#chart .shape[data-kind=output]'); await page.waitForTimeout(150);
ok('the field shows the string on two lines', (await page.inputValue('#f_expression')).includes('Hello\nworld'));
await page.fill('#f_expression', '"no escapes"'); await page.waitForTimeout(50);
ok('field without sequences is normal', await page.evaluate(() => !document.querySelector('.escbox').classList.contains('on') && getComputedStyle(document.querySelector('#f_expression')).color !== 'rgba(0, 0, 0, 0)'));
await page.keyboard.press('Escape');
console.log('ERR', errs); await browser.close();
