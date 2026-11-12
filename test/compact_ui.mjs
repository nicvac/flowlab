// Vista compatta dei diagrammi di flusso: pulsante, Maiusc+K, apertura sempre estesa, esportazione estesa
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.clear(); const s = document.querySelector('#speed'); s.value = 0; s.dispatchEvent(new Event('input')); FlowLab.loadExample('bolle'); });
const wait = (ms = 150) => page.waitForTimeout(ms);
const ok = (name, cond) => console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
const H = () => page.evaluate(() => +document.querySelector('#chart svg').dataset.h);
const nIns = () => page.locator('#chart .ins').count();
await wait(200);

ok('pulsante in alto a sinistra: ' + await page.locator('#compactBtn').textContent(), (await page.locator('#compactBtn').isVisible()) && (await page.locator('#compactBtn').textContent()) === 'Compatta');
const h0 = await H(), i0 = await nIns();
await page.click('#compactBtn'); await wait(150);
const h1 = await H(), i1 = await nIns();
ok(`compatto: altezza ${h0} → ${h1}, punti di inserimento ${i0} → ${i1} (${await page.locator('#chart .ins.zero').count()} tra blocchi che si toccano)`, h1 < h0 && i1 === i0 && (await page.locator('#chart .ins.zero').count()) > 0 && (await page.locator('#compactBtn').getAttribute('aria-pressed')) === 'true' && (await page.locator('#compactBtn').textContent()) === 'Estendi');
// blocchi accorpati: la Costante e le Dichiarazioni si toccano
const gap = await page.evaluate(() => { const r = [...document.querySelectorAll('#chart .shape[data-kind=declare], #chart .shape[data-kind=const]')].map((g) => g.getBBox()); return Math.round(r[1].y - (r[0].y + r[0].height)); });
ok('blocchi in sequenza a distanza ' + gap, gap <= 1);
// esecuzione in vista compatta
await page.click('#runBtn'); await wait(800);
ok('esecuzione: ' + (await page.innerText('#conOut')).split('\n').filter((l) => /Dopo/.test(l)).join(''), /Dopo/.test(await page.innerText('#conOut')));
// esportazione SVG: sempre estesa
await page.evaluate(() => { window.showSaveFilePicker = undefined; });
const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+Shift+G')]);
const svg = fs.readFileSync(await dl.path(), 'utf8');
const eh = +(/height="(\d+)"/.exec(svg) || [])[1];
ok(`SVG esportato alto ${eh} (esteso ${h0})`, eh === h0);
// Maiusc+K torna alla vista estesa e poi di nuovo compatta
await page.keyboard.press('Shift+K'); await wait(150);
ok('Maiusc+K: estesa', (await H()) === h0);
await page.keyboard.press('Shift+K'); await wait(150);
ok('Maiusc+K: compatta', (await H()) === h1);
// un diagramma appena aperto è esteso, anche tornando a quello di prima
await page.keyboard.press('PageDown'); await wait(150);
ok('altra funzione: ' + await page.locator('#compactBtn').getAttribute('aria-pressed'), (await page.locator('#compactBtn').getAttribute('aria-pressed')) === 'false');
await page.keyboard.press('PageUp'); await wait(150);
ok('tornando al Main è esteso', (await H()) === h0);
// + tra due blocchi che si toccano: aggiunge un blocco in quel punto
await page.click('#compactBtn'); await wait(100);
const z = await page.evaluate(() => { const g = [...document.querySelectorAll('#chart .ins.zero')].sort((a, b) => a.getBoundingClientRect().y - b.getBoundingClientRect().y)[0]; const r = g.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
await page.mouse.click(z[0], z[1]); await wait(150);
ok('menu di inserimento dal + tra blocchi compatti', await page.locator('.ctxmenu, .insmenu, #pop').first().isVisible());
await page.keyboard.press('Escape'); await wait(80);
await page.click('#compactBtn'); await wait(100);
// aggiunta di un blocco con la tastiera dopo il selezionato, in vista compatta
await page.click('#compactBtn'); await wait(100);
await page.locator('#chart .shape[data-kind=call]').first().click(); await wait(60);
await page.keyboard.press('o'); await wait(150);
ok('dialogo di un nuovo blocco: ' + await page.locator('.modal h2, .modal .mhead, .modal header').first().textContent(), (await page.locator('.modal').count()) === 1);
await page.keyboard.press('Escape'); await wait(80);
// diagramma delle classi: niente pulsante
await page.evaluate(() => FlowLab.loadExample('forme')); await wait(200);
await page.evaluate(() => FlowLab.showUml()); await wait(150);
ok('nascosto nel diagramma delle classi', !(await page.locator('#compactBtn').isVisible()));
await page.evaluate(() => FlowLab.showFunc(0)); await wait(150);
ok('visibile nel metodo, accanto alla barra della classe', (await page.locator('#compactBtn').isVisible()) && (await page.locator('#crumbBar').isVisible()));
await page.screenshot({ path: 'test/compact_oo.png' });
console.log('ERR', errs);
await browser.close();
