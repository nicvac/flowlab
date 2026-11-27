// «Notte a Neon Bay» checked in its geometry: the crowns of the palms stay on their trunks while they sway, the car
// lights the road in front of it in both directions, the wheels turn on their axles, the dark begins half way between
// the last number excluded and the first one possible (on both sides)
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'fs'; import path from 'path';
const GSAP = process.env.GSAP_DIR || '/tmp/claude-0/-home-claude/a3dfa59b-97d5-5c46-98cc-6343d78b4caa/scratchpad/gsap/package';
const errs = [];
const browser = await chromium.launch();
const page = await browser.newPage({ locale: 'it-IT', viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errs.push(e.message));
if (fs.existsSync(GSAP)) await page.route('https://cdn.jsdelivr.net/npm/gsap@3.12.5/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(path.join(GSAP, new URL(r.request().url()).pathname.split('/gsap@3.12.5/')[1])) }));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(400);
await page.evaluate(() => FlowLab.loadExample('guess_number')); await page.waitForTimeout(300);
await page.evaluate(() => { Math.random = () => 0.36; const s = document.querySelector('#speed'); s.value = 0; s.dispatchEvent(new Event('input')); });
await page.selectOption('.stagewin .stage-sel', '2'); await page.waitForTimeout(100); await page.click('.stagewin .minbtn');
await page.waitForFunction(() => FlowLab.stage.info() && FlowLab.stage.info().ready);
const fr = () => page.frames().find((f) => f.url() === 'about:srcdoc');
const ok = (n, c) => console.log((c ? 'ok   ' : 'FAIL ') + n);
// in the coordinates of the stage (800 × 450)
const probe = () => fr().evaluate(() => {
  const svg = document.getElementById('stage'), inv = svg.getScreenCTM().inverse();
  const P = (el, x, y) => { const m = inv.multiply(el.getScreenCTM()); return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]; };
  const out = {};
  // palms: the base of the crown (0, 0 of the crown) against the top of the trunk (14, -120 of the palm)
  out.palms = [...svg.querySelectorAll('g[transform^="translate"][transform*="scale"]')].map((g) => { const top = g.children[1], crown = top.children[0]; const a = P(crown, 0, 0), b = P(g, 14, -120); return Math.hypot(a[0] - b[0], a[1] - b[1]); });
  // the car: the headlight (48, -16) and the tail light (-46, -16) in the stage, and the axles of the wheels
  const tilt = [...svg.querySelectorAll('g')].find((g) => g.querySelector(':scope > path[fill="url(#beam)"]'));
  out.head = P(tilt, 46, -15); out.tail = P(tilt, -47, -16); out.beamEnd = P(tilt, 150, -14);
  // the cabin (the windows) is set back from the middle: on the side of the tail, not of the headlights
  out.darkY = [...svg.querySelectorAll('rect[fill="#05010c"]')].map((r) => [+r.getAttribute('y'), +r.getAttribute('height'), +r.getAttribute('opacity')]);
  const cab = tilt.querySelector('.cabin').getBBox(); out.cabin = P(tilt, cab.x + cab.width / 2, cab.y + cab.height / 2); out.mid = P(tilt, 0, -16);
  const rims = [...tilt.querySelectorAll(':scope > g')];
  out.rims = rims.map((r) => { const ls = r.querySelectorAll('line'); const l = ls[0]; const x = (+l.getAttribute('x1') + +l.getAttribute('x2')) / 2, y = (+l.getAttribute('y1') + +l.getAttribute('y2')) / 2; return P(r, x, y).concat(P(tilt, x, y)); });
  const d = [...svg.querySelectorAll('rect[fill="#05010c"]')];
  out.dark = d.map((r) => [+r.getAttribute('x'), +r.getAttribute('width')]);
  return out;
});
const xOf = (v) => 90 + ((v - 1) * 640) / 99;
// the secret is 37: first too high, then too low, then a little too low, a little too high, right
const attempts = [50, 25, 30, 40, 37];
await page.click('#runBtn');
let prevX = 38, maxPalm = 0, lo = 1, hi = 100;
for (const g of attempts) {
  await page.waitForFunction(() => !document.querySelector('#conInput').disabled, null, { timeout: 60000 });
  await page.fill('#conInput', String(g)); await page.keyboard.press('Enter');
  // during the drive: the palms stay attached, the wheels stay on their axles
  for (let i = 0; i < 6; i++) { await page.waitForTimeout(120); const p = await probe(); maxPalm = Math.max(maxPalm, ...p.palms); const rimOff = Math.max(...p.rims.map((r) => Math.hypot(r[0] - r[2], r[1] - r[3]))); if (rimOff > 0.5) ok(`ruota fuori asse di ${rimOff.toFixed(1)}`, false); }
  await page.waitForFunction(() => !FlowLab.run.stageWait, null, { timeout: 20000 }); await page.waitForTimeout(300);
  const p = await probe(), x = xOf(g), right = x >= prevX;
  const fwd = right ? 1 : -1;
  ok(`verso ${g} (${right ? 'destra' : 'sinistra'}): faro a ${p.head[0].toFixed(0)}, fanale a ${p.tail[0].toFixed(0)}, fascio verso ${p.beamEnd[0].toFixed(0)}, abitacolo a ${p.cabin[0].toFixed(0)} (centro ${p.mid[0].toFixed(0)})`,
    (p.head[0] - p.tail[0]) * fwd > 0 && (p.beamEnd[0] - p.head[0]) * fwd > 0 && (p.mid[0] - p.cabin[0]) * fwd > 0);
  prevX = x;
  // the dark: on the left up to half way between lo - 1 and lo, on the right from half way between hi and hi + 1
  if (g < 37) lo = g + 1; else if (g > 37) hi = g - 1;
  const wantL = lo > 1 ? (xOf(lo - 1) + xOf(lo)) / 2 : 76, wantR = hi < 100 ? (xOf(hi) + xOf(hi + 1)) / 2 : 744;
  const gotL = p.dark[0][0] + p.dark[0][1], gotR = p.dark[1][0];
  if (g !== 37) ok('la banda scura copre solo i numeri sotto la strada, semitrasparente (y+h, alpha: ' + p.darkY.map((d) => `${d[0]}+${d[1]}, ${d[2]}`).join(' / ') + ')', p.darkY.every(([y, h, a]) => y >= 397 && y + h <= 440 && a <= 0.6));
  if (g !== 37) ok(`buio dopo ${g}: possibili ${lo}–${hi}, bordi ${gotL.toFixed(1)} e ${gotR.toFixed(1)}`, Math.abs(gotL - wantL) < 0.5 && Math.abs(gotR - wantR) < 0.5);
}
await page.waitForFunction(() => /Indovinato/.test(document.querySelector('#conOut').innerText), null, { timeout: 60000 }); await page.waitForTimeout(500);
ok(`palme attaccate al tronco (scarto massimo ${maxPalm.toFixed(2)})`, maxPalm < 0.5);
console.log('ERR', errs);
await browser.close();
