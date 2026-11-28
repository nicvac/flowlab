// Breakpoints marked on the blocks (also with a condition) and «Run to here»
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
const page = await browser.newPage({ locale: 'it-IT', viewport: { width: 1440, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.clear(); const s = document.querySelector('#speed'); s.value = 3; s.dispatchEvent(new Event('input')); FlowLab.loadExample('times_table'); });
const wait = (ms = 150) => page.waitForTimeout(ms);
const ok = (name, cond) => console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
const out = async () => (await page.innerText('#conOut')).split('\n').filter((l) => l && !/^(▶|■)/.test(l));
const status = () => page.locator('#status').innerText().catch(() => '');
const menu = async (sel, text) => { await page.locator(sel).last().click({ button: 'right' }); await wait(120); await page.locator('.ctxmenu button', { hasText: text }).first().click(); await wait(120); };
await wait(250);
const outBlock = '#chart .shape[data-kind=output]';
// 1. F9 on the selected block: red dot; Run stops there
await page.locator(outBlock).last().click(); await page.keyboard.press('F9'); await wait(100);
ok('pallino rosso con F9', (await page.locator('#chart .bpmark').count()) === 1);
await page.click('#runBtn');
for (const v of ['3']) { await wait(300); await page.evaluate((x) => FlowLab.submitInput(x), v).catch(() => {}); }
await wait(1500);
const exec1 = await page.evaluate(() => document.querySelector('#chart .shape.exec')?.dataset.id);
const lastOut = await page.evaluate(() => [...document.querySelectorAll('#chart .shape[data-kind=output]')].pop().dataset.id);
ok(`si ferma sul blocco segnato (${exec1}): ${(await out()).slice(-2).join(' / ')}`, exec1 === lastOut);
// Continue: stops again at the next iteration
const n1 = (await out()).length;
await page.click('#runBtn'); await wait(1500);
ok(`Continua: si ferma di nuovo (righe ${n1} → ${(await out()).length})`, (await page.evaluate(() => document.querySelector('#chart .shape.exec')?.dataset.id)) === lastOut && (await out()).length > n1);
// 2. condition: remove the plain mark (F9) and put a condition on the same block
await page.locator(outBlock).last().click(); await page.keyboard.press('F9'); await wait(80);
ok('F9 di nuovo: pallino tolto', (await page.locator('#chart .bpmark').count()) === 0);
await page.click('#stopBtn'); await wait(200);
await page.locator(outBlock).last().click({ button: 'right' }); await wait(120);
ok('programma fermo: niente voci di debug nel menu', (await page.locator('.ctxmenu button', { hasText: 'Esegui fino a qui' }).count()) === 0);
await page.keyboard.press('Escape'); await wait(80);
// started step by step (paused at the first block): the debug items are there
await page.click('#stepBtn'); await wait(300);
await menu(outBlock, 'con condizione');
await page.locator('.modal input, .modal textarea').first().fill('i = 7'); await page.locator('.modal .btn.primary').click(); await wait(150);
ok('pallino con ?: ' + await page.locator('#chart .bpmark text').count(), (await page.locator('#chart .bpmark text').count()) === 1);
await page.click('#runBtn'); await wait(300); await page.evaluate(() => FlowLab.submitInput('3')).catch(() => {}); await wait(800);
const vars = await page.evaluate(() => { const f = FlowLab.state && document.querySelector('#varsBody'); return document.querySelector('#conOut').innerText.split('\n').slice(-2).join(' / '); });
ok('condizione i = 7: ' + vars + ' · ' + await status(), /7/.test(vars) && /i = 7/.test(await status()));
await page.click('#stopBtn'); await wait(200);
// wrong condition: it stops and says why
await page.click('#stepBtn'); await wait(300);
await menu(outBlock, 'con condizione');
await page.locator('.modal input, .modal textarea').first().fill('nonesiste > 1'); await page.locator('.modal .btn.primary').click(); await wait(150);
await page.click('#runBtn'); await wait(300); await page.evaluate(() => FlowLab.submitInput('3')).catch(() => {}); await wait(500);
ok('condizione con errore: ' + (await out()).slice(-2).join(' / '), (await out()).slice(-2).join(' ').includes('nonesiste') && (await page.evaluate(() => !!document.querySelector('#chart .shape.exec'))));
await page.click('#stopBtn'); await wait(200);
// remove from the dialog
await page.click('#stepBtn'); await wait(300);
await menu(outBlock, 'con condizione');
await page.locator('.modal footer button', { hasText: 'Togli' }).click(); await wait(150);
ok('tolto dal dialogo', (await page.locator('#chart .bpmark').count()) === 0);
// 3. «Run to here» while paused at the start: runs and stops on the block
await menu(outBlock, 'Esegui fino a qui');
await wait(300); await page.evaluate(() => FlowLab.submitInput('3')).catch(() => {}); await wait(1500);
ok('Esegui fino a qui: ' + await status(), (await page.evaluate(() => document.querySelector('#chart .shape.exec')?.dataset.id)) === lastOut && /scelto/.test(await status()));
// inside a loop, paused: run to the block after the loop
const after = await page.evaluate(() => { const g = [...document.querySelectorAll('#chart .shape')]; return g[g.length - 2].dataset.id; });
await page.locator(`#chart .shape[data-id="${after}"]`).click({ button: 'right' }); await wait(100);
await page.locator('.ctxmenu button', { hasText: 'Esegui fino a qui' }).click(); await wait(600);
ok(`dal ciclo fino al blocco dopo (${after}): ${await status()} · righe ${(await out()).length}`, (await page.evaluate(() => document.querySelector('#chart .shape.exec')?.dataset.id)) === after || /terminato|finished/i.test(await status()));
// marks are not saved in the file
ok('non nel file', !/bpmark|breakpoint-mark/.test(await page.evaluate(() => FlowLab.serialize())));
// 4. another program: marks cleared
await page.click('#stopBtn').catch(() => {}); await wait(100);
await page.locator(outBlock).last().click(); await page.keyboard.press('F9'); await wait(80);
await page.evaluate(() => FlowLab.loadExample('gcd')); await wait(200);
ok('altro programma: nessun segno', (await page.locator('#chart .bpmark').count()) === 0);
await page.screenshot({ path: 'test/bpmarks.png' });
console.log('ERR', errs);
await browser.close();
