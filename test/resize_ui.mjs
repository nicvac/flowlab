// Floating windows resized from every edge and corner; the auxiliary view is dragged also from its top left corner
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
const page = await browser.newPage({ locale: 'it-IT', viewport: { width: 1440, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.clear(); }); await page.reload(); await page.waitForTimeout(400);
const ok = (name, cond) => console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
const box = (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; }, sel);
const drag = async (x, y, dx, dy) => { await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx / 2, y + dy / 2); await page.mouse.move(x + dx, y + dy); await page.mouse.up(); await page.waitForTimeout(120); };
const cursorAt = (x, y) => page.evaluate(([x, y]) => { document.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true })); const e = document.elementFromPoint(x, y); e.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true })); return document.documentElement.dataset.rs || ''; }, [x, y]);

for (const [name, sel, open] of [
  ['vista', '.auxwin', async () => { await page.evaluate(() => FlowLab.openView()); }],
  ['console', '.fwin[data-win=console]', async () => { await page.click('.tabw[data-tab=console] .detach'); }],
  ['array', '.avwin', async () => {
    await page.evaluate(() => FlowLab.loadExample('bubble_sort')); await page.waitForTimeout(150);
    await page.evaluate(() => { const s = document.querySelector('#speed'); s.value = 3; s.dispatchEvent(new Event('input')); });
    await page.click('#stepBtn'); for (let i = 0; i < 9; i++) { await page.click('#stepBtn'); await page.waitForTimeout(40); }
    await page.click('.tabw[data-tab=vars] [role=tab]'); await page.waitForTimeout(300);
    await page.locator('#varsBody .avopen').first().click(); await page.waitForTimeout(200);
  }],
]) {
  // the windows already tried go out of the way
  await page.evaluate(() => document.querySelectorAll('.fwin').forEach((w) => Object.assign(w.style, { left: '0px', top: '640px', width: '300px', height: '200px' })));
  await open(); await page.waitForTimeout(250);
  if (!(await page.locator(sel).count())) { ok(name + ': finestra aperta', false); continue; }
  // place it in the middle of the screen
  await page.evaluate((s) => Object.assign(document.querySelector(s).style, { left: '400px', top: '200px', width: '420px', height: '320px' }), sel); await page.waitForTimeout(250);
  let b = await box(sel);
  ok(`${name}: cursore sul bordo sinistro ${await cursorAt(b.x + 1, b.y + b.h / 2)}, angolo in alto a sinistra ${await cursorAt(b.x - 2, b.y - 2)}, dentro ${await cursorAt(b.x + 60, b.y + b.h / 2) || '–'}`,
    (await cursorAt(b.x + 1, b.y + b.h / 2)) === 'ew' && (await cursorAt(b.x - 2, b.y - 2)) === 'nwse' && (await cursorAt(b.x + 60, b.y + b.h / 2)) === '');
  await drag(b.x + 1, b.y + b.h / 2, -60, 0); let a = await box(sel);
  ok(`${name}: sinistra ${JSON.stringify(b)} -> ${JSON.stringify(a)}`, Math.abs(a.x - (b.x - 60)) <= 2 && Math.abs(a.w - (b.w + 60)) <= 2 && a.y === b.y && a.h === b.h);
  b = a; await drag(b.x + b.w / 2, b.y + 1, 0, -40); a = await box(sel);
  ok(`${name}: sopra -> ${JSON.stringify(a)}`, Math.abs(a.y - (b.y - 40)) <= 2 && Math.abs(a.h - (b.h + 40)) <= 2 && a.x === b.x);
  b = a; await drag(b.x + b.w - 1, b.y + b.h / 2, 50, 0); a = await box(sel);
  ok(`${name}: destra -> ${JSON.stringify(a)}`, Math.abs(a.w - (b.w + 50)) <= 2 && a.x === b.x);
  b = a; await drag(b.x + b.w / 2, b.y + b.h - 1, 0, 30); a = await box(sel);
  ok(`${name}: sotto -> ${JSON.stringify(a)}`, Math.abs(a.h - (b.h + 30)) <= 2 && a.y === b.y);
  b = a; await drag(b.x - 2, b.y - 2, 30, 20); a = await box(sel);
  ok(`${name}: angolo in alto a sinistra -> ${JSON.stringify(a)}`, Math.abs(a.x - (b.x + 30)) <= 2 && Math.abs(a.y - (b.y + 20)) <= 2 && Math.abs(a.w - (b.w - 30)) <= 2);
  b = a; await drag(b.x + b.w + 2, b.y + b.h + 2, -500, -500); a = await box(sel);
  ok(`${name}: non sotto la dimensione minima -> ${JSON.stringify(a)}`, a.w >= 150 && a.h >= 100 && a.x === b.x && a.y === b.y);
}
// view: dragged from the grip at the top left of the header
await page.evaluate(() => FlowLab.openView()); await page.waitForTimeout(200);
await page.evaluate(() => Object.assign(document.querySelector('.auxwin').style, { left: '400px', top: '200px', height: '300px', zIndex: 999 }));
const v = await box('.auxwin');
await drag(v.x + 10, v.y + 12, 80, 50); const v2 = await box('.auxwin');
ok(`vista trascinata dalla presa a sinistra: ${JSON.stringify(v)} -> ${JSON.stringify(v2)}`, v2.x === v.x + 80 && v2.y === v.y + 50 && v2.w === v.w);
await page.screenshot({ path: 'test/resize.png', clip: { x: v2.x - 10, y: v2.y - 10, width: 460, height: 60 } });
console.log('ERR', errs);
await browser.close();
