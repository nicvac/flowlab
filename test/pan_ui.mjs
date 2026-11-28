// Pan of the sheet: Space + drag, middle button, the hand (button and H), the arrows with nothing selected; also a small
// diagram can be moved; each diagram is found again where it was left; Fit goes back to the start; Ctrl+wheel zooms
// keeping the point under the cursor; the selection rectangle and the dragging of the classes keep working
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
const page = await browser.newPage({ locale: 'it-IT', viewport: { width: 1440, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.route(/github(usercontent)?\.com/, (r) => r.abort());
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(400);
const wait = (ms = 120) => page.waitForTimeout(ms);
const ok = (name, cond) => console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
const svgBox = () => page.evaluate(() => { const r = document.querySelector('#chart svg').getBoundingClientRect(), w = document.querySelector('#canvasWrap').getBoundingClientRect(); return { x: Math.round(r.left - w.left), y: Math.round(r.top - w.top), w: Math.round(r.width), ww: Math.round(w.width) }; });
const wrapBox = () => page.evaluate(() => { const r = document.querySelector('#canvasWrap').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const near = (a, b, d = 3) => Math.abs(a - b) <= d;

await page.evaluate(() => FlowLab.loadExample('even_odd')); await wait(300);
const W = await wrapBox();
let b0 = await svgBox();
ok(`all'inizio il disegno è in alto e al centro (${b0.x}, ${b0.y}, largo ${b0.w} su ${b0.ww})`, near(b0.y, 12, 4) && near(b0.x + b0.w / 2, b0.ww / 2, 10));
// Space + drag on empty paper: the drawing follows the mouse (also a small drawing, also to the right and down)
const px = W.x + 60, py = W.y + 300;
await page.mouse.move(px, py);
await page.keyboard.down('Space'); await wait(60);
ok('con Spazio il cursore è la manina', await page.evaluate(() => document.body.classList.contains('panready')));
await page.mouse.down(); await page.mouse.move(px + 300, py + 150, { steps: 8 }); await page.mouse.up();
await page.keyboard.up('Space');
let b1 = await svgBox();
ok(`Spazio + trascina: il disegno si sposta di (${b1.x - b0.x}, ${b1.y - b0.y})`, near(b1.x - b0.x, 300) && near(b1.y - b0.y, 150) && !(await page.evaluate(() => document.querySelector('.selband'))) && !(await page.evaluate(() => document.body.classList.contains('panready'))));
// without Space: the selection rectangle, the sheet does not move
await page.mouse.move(W.x + 160, W.y + 120); await page.mouse.down(); await page.mouse.move(W.x + W.w - 40, W.y + W.h - 40, { steps: 8 });
const banding = await page.evaluate(() => !!document.querySelector('.selband'));
await page.mouse.up();
const b2 = await svgBox();
ok(`senza Spazio: rettangolo di selezione (${banding}), il foglio non si muove, blocchi selezionati ${await page.evaluate(() => FlowLab.state.msel ? FlowLab.state.msel.size : 0)}`, banding && b2.x === b1.x && b2.y === b1.y);
await page.keyboard.press('Escape'); await page.mouse.click(W.x + 20, W.y + W.h - 60); await wait();
// the middle button
await page.mouse.move(W.x + 200, W.y + 200); await page.mouse.down({ button: 'middle' }); await page.mouse.move(W.x + 120, W.y + 140, { steps: 6 }); await page.mouse.up({ button: 'middle' });
const b3 = await svgBox();
ok(`tasto centrale: (${b3.x - b2.x}, ${b3.y - b2.y})`, near(b3.x - b2.x, -80) && near(b3.y - b2.y, -60));
// the hand: from the button, then H; Esc leaves it
await page.click('#panBtn');
ok('pulsante mano acceso', await page.evaluate(() => document.querySelector('#panBtn').getAttribute('aria-pressed') === 'true' && document.body.classList.contains('handtool')));
await page.mouse.move(W.x + 300, W.y + 300); await page.mouse.down(); await page.mouse.move(W.x + 260, W.y + 380, { steps: 6 }); await page.mouse.up();
const b4 = await svgBox();
ok(`con la mano il trascinamento sposta il foglio: (${b4.x - b3.x}, ${b4.y - b3.y})`, near(b4.x - b3.x, -40) && near(b4.y - b3.y, 80));
await page.keyboard.press('Escape');
ok('Esc spegne la mano', !(await page.evaluate(() => document.body.classList.contains('handtool'))));
await page.keyboard.press('h');
const hOn = await page.evaluate(() => document.body.classList.contains('handtool'));
await page.keyboard.press('h');
ok('H accende e spegne la mano', hOn && !(await page.evaluate(() => document.body.classList.contains('handtool'))));
// the arrows with nothing selected
await page.evaluate(() => { FlowLab.state.sel = null; FlowLab.state.msel = null; document.activeElement.blur(); });
await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown'); await wait(400);
const b5 = await svgBox();
ok(`frecce senza selezione: (${b5.x - b4.x}, ${b5.y - b4.y})`, near(b5.x - b4.x, -60) && near(b5.y - b4.y, -60));
// another diagram starts at the start; coming back, the first is where it was
await page.evaluate(() => { FlowLab.loadExample('bubble_sort'); }); await wait(300);
const m0 = await svgBox();
await page.mouse.move(W.x + 100, W.y + 400); await page.keyboard.down('Space'); await page.mouse.down(); await page.mouse.move(W.x + 250, W.y + 300, { steps: 6 }); await page.mouse.up(); await page.keyboard.up('Space');
const m1 = await svgBox();
await page.evaluate(() => FlowLab.showFunc(1)); await wait(200);
const o0 = await svgBox();
ok(`un altro diagramma parte dall'inizio (${o0.x}, ${o0.y})`, near(o0.y, 12, 4) && near(o0.x + o0.w / 2, o0.ww / 2, 10));
await page.evaluate(() => FlowLab.showFunc(0)); await wait(200);
const m2 = await svgBox();
ok(`tornando al primo è dove era (${m2.x - m0.x}, ${m2.y - m0.y})`, m2.x === m1.x && m2.y === m1.y && near(m1.x - m0.x, 150) && near(m1.y - m0.y, -100));
// Fit: back to the start
await page.keyboard.press('Shift+Digit1'); await wait(200);
const f = await svgBox();
ok(`Adatta: il disegno torna in alto e al centro (${f.x}, ${f.y})`, near(f.y, 12, 4) && near(f.x + f.w / 2, f.ww / 2, 10));
// Ctrl+wheel: the point under the cursor stays still
const pt = await page.evaluate(() => { const s = document.querySelector('#chart svg .shape').getBoundingClientRect(); return { x: s.left + s.width / 2, y: s.top + s.height / 2 }; });
const id = await page.evaluate((p) => document.elementFromPoint(p.x, p.y).closest('.shape').dataset.id, pt);
await page.mouse.move(pt.x, pt.y); await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await wait(100); await page.mouse.wheel(0, -100); await page.keyboard.up('Control'); await wait(200);
const after = await page.evaluate((i) => { const s = document.querySelector(`#chart .shape[data-id="${i}"]`).getBoundingClientRect(); return { x: s.left + s.width / 2, y: s.top + s.height / 2 }; }, id);
ok(`Ctrl+rotella: zoom ${await page.evaluate(() => FlowLab.state.zoom)}, il blocco sotto il cursore resta lì (${Math.round(after.x - pt.x)}, ${Math.round(after.y - pt.y)})`, (await page.evaluate(() => FlowLab.state.zoom)) > 1 && near(after.x, pt.x, 6) && near(after.y, pt.y, 6));
await page.click('#zoomVal'); await wait(100);
// class diagram: the sheet moves with Space; a class is still dragged without Space
await page.evaluate(() => { FlowLab.state.dirty = false; FlowLab.loadExample('shapes'); }); await wait(300);
await page.evaluate(() => FlowLab.showUml()); await wait(300);
const u0 = await svgBox();
await page.mouse.move(W.x + W.w - 60, W.y + W.h - 80); await page.keyboard.down('Space'); await page.mouse.down(); await page.mouse.move(W.x + W.w - 260, W.y + W.h - 180, { steps: 6 }); await page.mouse.up(); await page.keyboard.up('Space');
const u1 = await svgBox();
ok(`diagramma delle classi: il foglio si sposta (${u1.x - u0.x}, ${u1.y - u0.y})`, near(u1.x - u0.x, -200) && near(u1.y - u0.y, -100));
const head = await page.evaluate(() => { const c = document.querySelector('#chart .ubox'); const r = c.getBoundingClientRect(); return { id: c.dataset.cls, x: r.left + r.width / 2, y: r.top + 12 }; });
const before = await page.evaluate((i) => { const c = FlowLab.state.prog.classes.find((k) => k.id === i); return [c.x, c.y]; }, head.id);
await page.mouse.move(head.x, head.y); await page.mouse.down(); await page.mouse.move(head.x + 60, head.y + 40, { steps: 6 }); await page.mouse.up(); await wait(200);
const moved = await page.evaluate((i) => { const c = FlowLab.state.prog.classes.find((k) => k.id === i); return [c.x, c.y]; }, head.id);
ok(`senza Spazio la classe si trascina ancora (${before} → ${moved})`, moved[0] - before[0] === 60 && moved[1] - before[1] === 40);
// dragging a class against the right edge: the sheet scrolls and the class goes on with it
const h2 = await page.evaluate((i) => { const c = document.querySelector(`#chart .ubox[data-cls="${i}"]`); const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 12 }; }, head.id);
const sl0 = await page.evaluate(() => document.querySelector('#canvasWrap').scrollLeft);
const x0c = (await page.evaluate((i) => FlowLab.state.prog.classes.find((k) => k.id === i).x, head.id));
await page.mouse.move(h2.x, h2.y); await page.mouse.down();
await page.mouse.move(W.x + W.w - 10, h2.y, { steps: 10 });
for (let i = 0; i < 12; i++) await page.mouse.move(W.x + W.w - 10 + (i % 2), h2.y, { steps: 1 });
await page.mouse.up(); await wait(200);
const sl1 = await page.evaluate(() => document.querySelector('#canvasWrap').scrollLeft);
const x1c = (await page.evaluate((i) => FlowLab.state.prog.classes.find((k) => k.id === i).x, head.id));
const cr = await page.evaluate((i) => { const r = document.querySelector(`#chart .ubox[data-cls="${i}"]`).getBoundingClientRect(); return r.left + r.width / 2; }, head.id);
ok(`classe trascinata contro il bordo: il foglio scorre di ${sl1 - sl0}, la classe va da x ${x0c} a ${x1c} e resta sotto il puntatore`, sl1 - sl0 > 100 && x1c - x0c > (W.x + W.w - 10 - h2.x) + 80 && Math.abs(cr - (W.x + W.w - 10)) < 20);
// during a run the block in execution is brought into view also after a pan far away
await page.evaluate(() => { FlowLab.state.dirty = false; FlowLab.loadExample('bubble_sort'); }); await wait(300);
await page.mouse.move(W.x + 300, W.y + 300); await page.keyboard.down('Space'); await page.mouse.down(); await page.mouse.move(W.x + 300 + 600, W.y + 300 + 500, { steps: 6 }); await page.mouse.up(); await page.keyboard.up('Space');
for (let i = 0; i < 3; i++) { await page.click('#stepBtn'); await wait(250); }
const vis = await page.evaluate(() => { const e = document.querySelector('#chart .shape.exec'), w = document.querySelector('#canvasWrap').getBoundingClientRect(); if (!e) return null; const r = e.getBoundingClientRect(); return r.top >= w.top && r.bottom <= w.bottom && r.left >= w.left && r.right <= w.right; });
ok('passo passo: il blocco in esecuzione torna in vista', vis === true);
// a «Continue» view: linked to the sheet only vertically. At the start the drawing is in its middle; horizontally it
// moves by itself (and does not follow the sheet); dragging it vertically scrolls the main sheet, as the wheel does
await page.click('#stopBtn').catch(() => {}); await wait(150);
await page.evaluate(() => { FlowLab.state.dirty = false; FlowLab.loadExample('bubble_sort'); }); await wait(300);
await page.evaluate(() => { document.querySelector('.canvas-col').style.height = '420px'; }); await wait(150);
await page.click('#viewAdd'); await wait(200);
if (!(await page.locator('.auxwin.sync').count())) await page.click('.auxwin .vsync');
await wait(300);
const vw = () => page.evaluate(() => { const w = document.querySelector('.auxwin .vwrap'), r = w.getBoundingClientRect(), s = w.querySelector('svg').getBoundingClientRect(); return { mid: Math.round(s.left + s.width / 2 - (r.left + w.clientLeft + w.clientWidth / 2)), x: Math.round(s.left - r.left), sl: w.scrollLeft, top: Math.round(s.top - r.top) }; });
const mw = () => page.evaluate(() => { const w = document.querySelector('#canvasWrap'); return { sl: w.scrollLeft, st: w.scrollTop }; });
let qc0 = await vw();
ok(`vista «Continua»: il disegno al centro della vista (scarto ${qc0.mid})`, Math.abs(qc0.mid) <= 2);
// the main sheet moved horizontally: the view stays where it is
const qM = await page.locator('#canvasWrap').boundingBox();
await page.mouse.move(qM.x + 150, qM.y + 200); await page.keyboard.down('Space'); await page.mouse.down(); await page.mouse.move(qM.x + 350, qM.y + 200, { steps: 6 }); await page.mouse.up(); await page.keyboard.up('Space'); await wait(200);
let qc1 = await vw();
ok(`foglio spostato in orizzontale: la vista non lo segue (posizione ${qc0.x} → ${qc1.x})`, qc1.x === qc0.x);
// the view moved horizontally by itself
const qA = await page.locator('.auxwin .vwrap').boundingBox();
const qm0 = await mw();
await page.mouse.move(qA.x + 100, qA.y + 100); await page.keyboard.down('Space'); await page.mouse.down(); await page.mouse.move(qA.x + 220, qA.y + 100, { steps: 6 }); await page.mouse.up(); await page.keyboard.up('Space'); await wait(200);
const qc2 = await vw(), qm1 = await mw();
ok(`vista spostata in orizzontale da sola: ${qc1.x} → ${qc2.x}, foglio fermo (${qm0.sl} → ${qm1.sl})`, qc2.x - qc1.x === 120 && qm1.sl === qm0.sl && qm1.st === qm0.st);
// dragged vertically in the view: the main sheet scrolls
await page.mouse.move(qA.x + 100, qA.y + 200); await page.keyboard.down('Space'); await page.mouse.down(); await page.mouse.move(qA.x + 100, qA.y + 120, { steps: 6 }); await page.mouse.up(); await page.keyboard.up('Space'); await wait(250);
const qm2 = await mw(), qc3 = await vw();
ok(`trascinata in verticale nella vista: il foglio scorre di ${qm2.st - qm1.st}, la vista resta nella sua colonna (${qc3.x})`, Math.abs(qm2.st - qm1.st - 80) <= 2 && qc3.x === qc2.x);
// the wheel on the view: vertically the sheet, with Shift horizontally the view
const qm3 = await mw();
await page.mouse.move(qA.x + 100, qA.y + 150); await page.mouse.wheel(0, 120); await wait(250);
const qm4 = await mw(), qc4 = await vw();
ok(`rotella sulla vista: il foglio scorre (${qm3.st} → ${qm4.st}), la vista non si sposta in orizzontale`, qm4.st > qm3.st && qc4.x === qc3.x);
await page.keyboard.down('Shift'); await page.mouse.wheel(0, 120); await page.keyboard.up('Shift'); await wait(250);
const qm5 = await mw(), qc5 = await vw();
ok(`Maiusc+rotella sulla vista: la vista si sposta in orizzontale (${qc4.x} → ${qc5.x}), il foglio no (${qm4.st} → ${qm5.st})`, qc5.x < qc4.x && qm5.st === qm4.st);
console.log('ERR', errs);
await browser.close();
