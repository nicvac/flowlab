// Viste ausiliarie: finestre mobili con un altro diagramma, modifica, «Continua», esecuzione, salvataggio
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
const page = await browser.newPage({ locale: 'it-IT', viewport: { width: 1440, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.clear(); const s = document.querySelector('#speed'); s.value = 3; s.dispatchEvent(new Event('input')); FlowLab.loadExample('bubble_sort'); });
const wait = (ms = 150) => page.waitForTimeout(ms);
const ok = (name, cond) => console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
await wait(250);
const nf = await page.evaluate(() => FlowLab.state.prog.functions.length);
// the top of the drawing in the sheet (around the drawing there is a margin of empty paper for the pan): «sheet at the
// top» is this scroll, not 0
const home = "(() => { const w = document.querySelector('#canvasWrap'), s = document.querySelector('#chart svg'); return Math.round(s.getBoundingClientRect().top - w.getBoundingClientRect().top - w.clientTop + w.scrollTop - 12); })()";

// 1. nuova vista dal pulsante accanto allo zoom
// the dot: only when at least one whole block is cut off at the top (not for the part beyond the bottom)
const dotOn = async () => (await page.locator('#viewAdd.notify').count()) === 1;
const topBlock = async () => page.evaluate(() => { const w = document.querySelector('#canvasWrap'), s = document.querySelector('#chart svg'); const sh = [...s.querySelectorAll('.shape')].map((e) => e.getBoundingClientRect()).sort((a, b) => a.top - b.top); const t = s.getBoundingClientRect().top; return { start: w.getBoundingClientRect().top + w.clientTop - t, first: [Math.round(sh[0].top - t), Math.round(sh[0].bottom - t)] }; });
const z0 = await page.evaluate(() => FlowLab.state.zoom);
await page.evaluate(() => { document.querySelector('.canvas-col').style.height = '420px'; }); await page.click('#zoomVal'); await wait(200);
const fb = (await topBlock()).first;
ok('foglio in cima, il fondo non si vede: pallino spento', !(await dotOn()));
await page.evaluate((y) => { document.querySelector('#canvasWrap').scrollTop += y; }, fb[1] - 6 - (await topBlock()).start); await wait(150);
ok(`primo blocco tagliato solo in parte (${JSON.stringify(await topBlock())}): pallino spento`, !(await dotOn()));
await page.evaluate((y) => { document.querySelector('#canvasWrap').scrollTop += y; }, fb[1] + 4 - (await topBlock()).start); await wait(150);
ok(`primo blocco tutto fuori in alto (${JSON.stringify(await topBlock())}): pallino acceso`, await dotOn());
await page.click('#viewAdd'); await wait(200);
ok('pallino acceso: la vista si apre «Continua» e mostra l\'inizio; il pallino si spegne', (await page.locator('.auxwin.sync.above').count()) === 1 && !(await dotOn()));
await page.click('.auxwin .vsync'); await wait(100); // vista libera
ok('vista libera: il pallino si riaccende', await dotOn());
await page.evaluate((home) => { document.querySelector('#canvasWrap').scrollTop = eval(home); document.querySelector('.canvas-col').style.height = ''; document.querySelector('.auxwin').style.height = '771px'; }, home); await wait(150);
ok('una vista aperta, attiva, con il diagramma', (await page.locator('.auxwin').count()) === 1 && (await page.locator('.auxwin.vactive').count()) === 1 && (await page.locator('.auxwin .vchart svg .shape').count()) > 3);
// 2. un altro diagramma nella vista; il foglio principale resta sul Main
const opts = await page.locator('.auxwin .vsel option').allTextContents();
await page.locator('.auxwin .vsel').selectOption({ index: 1 }); await wait(150);
ok(`vista su ${opts[1]}, foglio principale su ${await page.locator('#funcSel option:checked').textContent()}`, (await page.locator('#funcSel').inputValue()) === '0' && (await page.locator('.auxwin .vchart .shape[data-id^="start:"]').count()) === 1 && (await page.evaluate(() => FlowLab.views[1].state.fi ?? FlowLab.state.fi)) === 1);
// 3. modifica nella vista: duplica un blocco con Ctrl+D
const len0 = await page.evaluate(() => FlowLab.state.prog.functions[1].body.length);
const main0 = await page.locator('#chart .shape').count();
await page.locator('.auxwin .vchart .shape[data-kind]:not([data-kind=comment])').first().click(); await wait(80);
await page.keyboard.press('Control+d'); await wait(200);
const len1 = await page.evaluate(() => FlowLab.state.prog.functions[1].body.length);
ok(`modifica nella vista: blocchi ${len0} → ${len1}, foglio principale invariato`, len1 === len0 + 1 && (await page.locator('#chart .shape').count()) === main0);
await page.keyboard.press('Control+z'); await wait(200);
ok('Annulla nella vista', (await page.evaluate(() => FlowLab.state.prog.functions[1].body.length)) === len0);
// 4. PagGiù nella vista attiva cambia il suo diagramma
await page.locator('.auxwin .vwrap').click({ position: { x: 5, y: 5 } }); await wait(60);
await page.keyboard.press('PageDown'); await wait(150);
ok('PagGiù nella vista: ' + await page.locator('.auxwin .vsel option:checked').textContent(), (await page.locator('.auxwin .vsel').inputValue()) === String(2 % nf) && (await page.locator('#funcSel').inputValue()) === '0');
// 5. trascinamento di un blocco dal foglio principale alla vista
await page.locator('.auxwin .vsel').selectOption({ index: 1 }); await wait(150);
const before = await page.evaluate(() => [FlowLab.state.prog.functions[0], FlowLab.state.prog.functions[1]].map((f) => { let n = 0; ModelLib.walk(f.body, () => n++); return n; }));
const src = await page.locator('#chart .shape[data-kind=output]').first().boundingBox();
const dst = await page.locator('.auxwin .vchart .ins').last().boundingBox();
await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2); await page.mouse.down();
await page.mouse.move(src.x + 40, src.y + 40, { steps: 4 });
await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height / 2, { steps: 8 }); await page.mouse.up(); await wait(200);
const after = await page.evaluate(() => [FlowLab.state.prog.functions[0], FlowLab.state.prog.functions[1]].map((f) => { let n = 0; ModelLib.walk(f.body, () => n++); return n; }));
ok(`blocco spostato dal Main alla vista: ${before} → ${after}`, after[0] === before[0] - 1 && after[1] === before[1] + 1);
await page.keyboard.press('Control+z'); await wait(200);

// 6. «Continua»: la vista mostra quello che il foglio principale non mostra
await page.locator('.auxwin .vclose').click(); await wait(100);
await page.evaluate(() => { document.querySelector('.canvas-col').style.height = '420px'; });
await page.click('#zoomVal'); await wait(200);
ok('il diagramma non sta nel foglio, ma l\'inizio si vede: pallino spento', !(await dotOn()));
await page.keyboard.press('Control+Alt+v'); await wait(250);
await page.locator('.auxwin .vsync').click(); await wait(250);
const geo = async () => page.evaluate(() => {
  const m = (x) => { const r = x.getBoundingClientRect(), s = x.querySelector('svg').getBoundingClientRect(); return { top: Math.round(r.top + x.clientTop - s.top), end: Math.round(r.top + x.clientTop + x.clientHeight - s.top) }; };
  const w = [...document.querySelectorAll('.auxwin .vwrap')].map(m);
  return { main: m(document.querySelector('#canvasWrap')), w, above: [...document.querySelectorAll('.auxwin')].map((x) => x.classList.contains('above')), sel: document.querySelector('.auxwin .vsel').value };
});
let g = await geo();
ok(`aperta già «Continua», mostra il seguito: fine del foglio ${g.main.end}, inizio della vista ${g.w[0].top}`, (await page.locator('.auxwin.sync').count()) === 1 && Math.abs(g.main.end - g.w[0].top) <= 1 && g.sel === '0');
// punto in comune: riga tratteggiata in fondo al foglio e in cima alla vista, stesso numero
const lk = async () => page.evaluate(() => [...document.querySelectorAll('.vlink:not([hidden])')].map((x) => { const r = x.getBoundingClientRect(); return { where: x.closest('.auxwin') ? 'vista' : 'foglio', edge: x.classList.contains('top') ? 'top' : 'bottom', y: Math.round(r.top), t: x.textContent }; }));
let L = await lk();
const mw = await page.locator('#canvasWrap').boundingBox(), aw = await page.locator('.auxwin .vwrap').boundingBox();
ok('punto in comune: ' + JSON.stringify(L), L.length === 2 && L.some((x) => x.where === 'foglio' && x.edge === 'bottom' && Math.abs(x.y - (mw.y + mw.height)) < 20 && x.t === '⇣ 1') && L.some((x) => x.where === 'vista' && x.edge === 'top' && Math.abs(x.y - aw.y) < 3 && x.t === '⇣ 1'));
// foglio scorso in giù: la vista mostra la parte tagliata in alto
await page.evaluate((home) => { document.querySelector('#canvasWrap').scrollTop = eval(home) + 450; }, home); await wait(150);
g = await geo();
ok(`foglio scorso in giù: inizio del foglio ${g.main.top}, fine della vista ${g.w[0].end}`, g.above[0] && Math.abs(g.main.top - g.w[0].end) <= 1);
// la rotella sulla vista fa scorrere il foglio principale
const st0 = await page.evaluate(() => document.querySelector('#canvasWrap').scrollTop);
const ab = await page.locator('.auxwin .vwrap').boundingBox();
await page.mouse.move(ab.x + ab.width / 2, ab.y + ab.height / 2); await page.mouse.wheel(0, 120); await wait(200);
g = await geo();
ok(`rotella sulla vista: foglio ${st0} → ${await page.evaluate(() => document.querySelector('#canvasWrap').scrollTop)}, ancora allineata`, (await page.evaluate(() => document.querySelector('#canvasWrap').scrollTop)) > st0 && Math.abs(g.main.top - g.w[0].end) <= 1);
// lo zoom del foglio vale anche per la vista
await page.click('#zoomOut'); await wait(200);
g = await geo();
ok(`zoom del foglio: ${await page.locator('#zoomVal').textContent()}, allineata ${g.main.top} / ${g.w[0].end}`, Math.abs(g.main.top - g.w[0].end) <= 1 && (await page.evaluate(() => document.querySelector('.auxwin .vchart svg').getAttribute('height') === document.querySelector('#chart svg').getAttribute('height'))));
// the top is shown by the view above: dot off even if the bottom is not seen; the second view shows the rest
g = await geo();
ok(`pallino solo se la vista sopra non mostra tutto l'inizio: inizio del foglio ${g.main.top}, vista alta ${g.w[0].end - g.w[0].top}`, (await dotOn()) === (g.main.top - (g.w[0].end - g.w[0].top) > 74));
await page.keyboard.press('Control+Alt+v'); await wait(250);
g = await geo();
ok(`due viste: sopra (fine ${g.w[0].end} = inizio del foglio ${g.main.top}), sotto (inizio ${g.w[1].top} = fine del foglio ${g.main.end})`, g.above[0] && !g.above[1] && Math.abs(g.main.top - g.w[0].end) <= 1 && Math.abs(g.main.end - g.w[1].top) <= 1);
// foglio in cima: tutte e due mostrano il seguito, in fila
await page.evaluate((home) => { document.querySelector('#canvasWrap').scrollTop = eval(home); }, home); await wait(200);
g = await geo();
ok(`foglio in cima: in fila ${g.main.end}/${g.w[0].top}, ${g.w[0].end}/${g.w[1].top}`, !g.above[0] && Math.abs(g.main.end - g.w[0].top) <= 1 && Math.abs(g.w[0].end - g.w[1].top) <= 1);
ok('tutto visibile: pallino spento', (await page.locator('#viewAdd.notify').count()) === 0);
await page.screenshot({ path: 'test/views1.png' });
// dal menu della vista «Continua» si apre un altro diagramma: «Continua» si spegne, il segno scompare
await page.locator('.auxwin').nth(1).locator('.vsel').selectOption('2'); await wait(200);
ok('altro diagramma dal menu: Continua spenta', (await page.locator('.auxwin').nth(1).locator('.vsync').getAttribute('aria-pressed')) === 'false' && (await page.locator('.auxwin').nth(1).locator('.vsel').inputValue()) === '2');
L = await lk();
ok('resta solo il segno della prima vista: ' + L.map((x) => x.where + ' ' + x.t).join(', '), L.length === 2 && L.every((x) => x.t === '⇣ 1'));
await page.locator('.auxwin').nth(1).locator('.vsync').click(); await wait(200);
// cambiando diagramma nel foglio, la vista «Continua» lo segue
await page.locator('#funcSel').selectOption('1'); await wait(200);
ok('segue il foglio: ' + await page.locator('.auxwin .vsel').first().inputValue(), (await page.locator('.auxwin .vsel').first().inputValue()) === '1');
await page.locator('#funcSel').selectOption('0'); await wait(200);
await page.locator('.auxwin').nth(1).locator('.vclose').click(); await wait(150);
ok('vista chiusa', (await page.locator('.auxwin').count()) === 1);

// 7. esecuzione: i blocchi si illuminano anche nella vista
await page.locator('.auxwin .vsync').click(); await wait(100); // non più «Continua»
await page.locator('.auxwin .vsel').selectOption('0'); await wait(150);
await page.click('#stepBtn'); await wait(60);
let lit = false;
for (let i = 0; i < 12 && !lit; i++) { await page.click('#stepBtn'); await wait(40); lit = (await page.locator('.auxwin .shape.exec').count()) === 1 && (await page.locator('#chart .shape.exec').count()) === 1; }
ok('passo passo: blocco acceso nel foglio e nella vista', lit);
await page.click('#stopBtn'); await wait(100);

// 8. le viste si ricordano con il programma aperto
await page.locator('.auxwin .vsel').selectOption('1'); await wait(150);
await page.locator('.auxwin .vsync').click(); await wait(100); await page.locator('.auxwin .vsync').click(); await wait(100);
await page.locator('.auxwin .vsel').selectOption('1'); await wait(500);
const pos = await page.locator('.auxwin').boundingBox();
await page.reload(); await wait(500);
const pos2 = await page.locator('.auxwin').boundingBox();
ok(`dopo il ricaricamento: ${await page.locator('.auxwin').count()} vista su ${await page.locator('.auxwin .vsel').inputValue()}, posizione ${Math.round(pos2.x)},${Math.round(pos2.y)}`, (await page.locator('.auxwin').count()) === 1 && (await page.locator('.auxwin .vsel').inputValue()) === '1' && Math.abs(pos.x - pos2.x) < 2 && Math.abs(pos.y - pos2.y) < 2);
// riduzione alla barra del titolo
await page.locator('.auxwin .minbtn').click(); await wait(100);
ok('ridotta', await page.locator('.auxwin.min').count() === 1);
await page.locator('.auxwin .minbtn').click(); await wait(100);
// 9. vista Oggetti: diagramma delle classi in una vista
await page.evaluate(() => FlowLab.loadExample('shapes')); await wait(250);
ok('altro programma: viste chiuse', (await page.locator('.auxwin').count()) === 0);
await page.evaluate(() => FlowLab.showFunc(1)); await wait(100);
await page.click('#viewAdd'); await wait(150);
await page.locator('.auxwin .vsel').selectOption('uml'); await wait(150);
ok('diagramma delle classi nella vista, metodo nel foglio', (await page.locator('.auxwin .ubox').count()) > 1 && (await page.locator('#chart .ubox').count()) === 0);
await page.locator('.auxwin .ubox .urow.method').first().dblclick(); await wait(150);
ok('doppio clic su un metodo: si apre nella vista', (await page.locator('.auxwin .vchart .shape').count()) > 1 && (await page.locator('.auxwin .vsel').inputValue()) !== 'uml');
await page.screenshot({ path: 'test/views2.png' });
console.log('ERR', errs);
await browser.close();
