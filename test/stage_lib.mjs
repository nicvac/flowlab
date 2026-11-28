// The stages of the examples: each one with its example, run to the end without errors of the stage
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
import path from 'path';
const GSAP = process.env.GSAP_DIR || '/tmp/claude-0/-home-claude/a3dfa59b-97d5-5c46-98cc-6343d78b4caa/scratchpad/gsap/package';
const browser = await chromium.launch();
const page = await browser.newPage({ locale: 'it-IT', viewport: { width: 1440, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
if (fs.existsSync(GSAP)) await page.route('https://cdn.jsdelivr.net/npm/gsap@3.12.5/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(path.join(GSAP, new URL(r.request().url()).pathname.split('/gsap@3.12.5/')[1])) }));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('flowlab.stageSpeed', '7'); }); await page.reload(); await page.waitForTimeout(400);
const wait = (ms = 150) => page.waitForTimeout(ms);
const ok = (name, cond) => console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
const con = () => page.innerText('#conOut');
const frame = () => page.frames().find((f) => f !== page.mainFrame() && f.url() === 'about:srcdoc');
const msg = () => page.evaluate(() => { const m = document.querySelector('.stagewin .stage-msg'); return m && !m.hidden ? m.textContent : ''; });
/* a stage of the example (linked to it): chosen in the title bar of its window and expanded */
async function useStage(title) {
  await page.waitForSelector('.stagewin');
  const i = await page.evaluate((t) => [...document.querySelectorAll('.stagewin .stage-sel option')].findIndex((o) => o.textContent === t), title);
  await page.selectOption('.stagewin .stage-sel', String(i)); await page.waitForTimeout(100);
  if (await page.evaluate(() => document.querySelector('.stagewin').classList.contains('min'))) await page.click('.stagewin .minbtn');
  await page.waitForFunction((t) => FlowLab.stage.info() && FlowLab.stage.info().ready && FlowLab.stage.info().name === t, title, { timeout: 15000 });
}
async function open(ex, title) {
  await page.evaluate((x) => FlowLab.loadExample(x), ex); await wait(200);
  await page.evaluate(() => { const s = document.querySelector('#speed'); s.value = 3; s.dispatchEvent(new Event('input')); });
  await useStage(title); await wait(200);
  await page.locator('.stagewin .stage-speed').fill('7'); await page.locator('.stagewin .stage-speed').dispatchEvent('input');
}
const inputReady = () => page.waitForFunction(() => !document.querySelector('#conInput').disabled || /Fine del programma/.test(document.querySelector('#conOut').innerText), null, { timeout: 60000 });


// recursive factorial: the pile of plates
await open('factorial', 'La torre delle chiamate');
await page.click('#runBtn'); await inputReady();
await page.fill('#conInput', '5'); await page.keyboard.press('Enter');
let shot = false;
for (let i = 0; i < 80 && !/Fine del programma/.test(await con()); i++) {
  await wait(250);
  if (!shot && (await frame().evaluate(() => document.querySelectorAll('.slab, g[filter]').length)) >= 9) { await page.screenshot({ path: 'test/stage_fact1.png' }); shot = true; }
}
await wait(2500);
const fin = await frame().evaluate(() => [...document.querySelectorAll('text')].map((t) => t.textContent).filter((x) => /!/.test(x)));
ok('torre delle chiamate: ' + fin.join(' | ') + ' ' + await msg(), fin.includes('5! = 120') && !fin.includes('5! = ?') && !(await msg()));
await page.screenshot({ path: 'test/stage_fact2.png' });
// the penguin row: at the end the piles are in the order of the sorted array
await open('bubble_sort', 'La fila dei pinguini');
await page.click('#runBtn');
await page.waitForFunction(() => /Dopo/.test(document.querySelector('#conOut').innerText), null, { timeout: 120000 }); await wait(1500);
const row = await frame().evaluate(() => [...document.querySelectorAll('.kid')].map((k) => [k.getCTM().e, +k.querySelector('text').textContent]).sort((a, b) => a[0] - b[0]).map((x) => x[1]));
const want = (await con()).split('\n').find((l) => /Dopo/.test(l)).replace(/Dopo:\s*/, '').trim().split(/\s+/).map(Number);
ok('fila dei pinguini: ' + row.join(',') + ' / ' + want.join(',') + ' ' + await msg(), row.join(',') === want.join(',') && !(await msg()));
// the penguin row with repeated values: every exchange moves the two piles of j and j + 1 (no pile is made again), and the
// arrows always stand on the piles at j and j + 1
await page.evaluate(() => { const seq = [0.5, 0.2, 0.5, 0.2, 0.1, 0.5, 0.2, 0.1]; let n = 0; Math.random = () => seq[n++ % seq.length]; });
await open('bubble_sort', 'La fila dei pinguini');
await page.click('#runBtn');
let badArrows = 0;
for (let k = 0; k < 400 && !/Dopo/.test(await con()); k++) {
  badArrows += await frame().evaluate(() => {
    // when nothing moves, each arrow is above the pile it was put on, and that pile is at the arrow's place
    const m = (el) => { const t = el.transform.baseVal.consolidate(); return t ? t.matrix : { e: 0, f: 0 }; };
    const kids = [...document.querySelectorAll('.kid')], arrows = [...document.querySelectorAll('.arrow')];
    if (kids.some((k) => Math.abs(m(k).f) > 0.5)) return 0;
    window.__checked = (window.__checked || 0) + (arrows.length ? 1 : 0);
    return arrows.filter((a) => { const k = kids.find((x) => x.dataset.born === a.dataset.born); return !k || Math.abs(m(k).e - m(a).e) > 1; }).length;
  });
  await wait(100);
}
await wait(1500);
const ice = await frame().evaluate(() => [...document.querySelectorAll('.kid')].map((k) => [k.getCTM().e, +k.querySelector('text').textContent, +k.dataset.born]).sort((a, b) => a[0] - b[0]));
const want2 = (await con()).split('\n').find((l) => /Dopo/.test(l)).replace(/Dopo:\s*/, '').trim().split(/\s+/).map(Number);
ok('pinguini con valori ripetuti: ' + ice.map((x) => x[1]).join(',') + ' / ' + want2.join(',') + ' nati ' + ice.map((x) => x[2]).join(',') + ' frecce fuori posto ' + badArrows + ' su ' + await frame().evaluate(() => window.__checked), ice.map((x) => x[1]).join(',') === want2.join(',') && ice.every((x) => x[2] < 8) && !badArrows && !(await msg()));
// the ice versions of the other stages
async function guessRun(title) {
  await open('guess_number', title);
  await page.click('#runBtn');
  let lo = 1, hi = 100, g = 0;
  for (let k = 0; k < 10; k++) {
    await inputReady();
    if (/Indovinato/.test(await con())) break;
    const text = await con();
    if (/Più alto\s*$/.test(text.trim())) lo = g + 1; else if (/Più basso\s*$/.test(text.trim())) hi = g - 1;
    g = Math.floor((lo + hi) / 2);
    await page.fill('#conInput', String(g)); await page.keyboard.press('Enter'); await wait(200);
  }
  await page.waitForFunction(() => /Indovinato/.test(document.querySelector('#conOut').innerText), null, { timeout: 60000 }); await wait(2500);
  return { texts: await frame().evaluate(() => [...document.querySelectorAll('text')].map((t) => t.textContent)), secret: (await con()).match(/(\d+)\s*\n?\s*Indovinato/)?.[1] };
}
const fish = await guessRun('La pesca nel ghiaccio');
ok('pesca nel ghiaccio: ' + fish.texts.filter((x) => /INDOVINATO|TENTATIVI/.test(x)).join(' | ') + ' ' + await msg(), fish.texts.includes('INDOVINATO!') && !(await msg()));
const neon = await guessRun('Notte a Neon Bay');
const board = await frame().evaluate(() => [...document.querySelectorAll('text')].map((t) => t.textContent));
ok('Neon Bay: ' + neon.texts.filter((x) => /INDOVINATO|TENTATIVI/.test(x)).join(' | ') + ' · cartellone ' + board.filter((x) => /^\d+$/.test(x)).slice(-1) + ' ' + await msg(), neon.texts.includes('INDOVINATO!') && neon.texts.some((x) => /^TENTATIVI: \d+$/.test(x)) && !(await msg()));
await open('gcd', 'I blocchi di Euclide');
await page.click('#runBtn'); await inputReady();
await page.fill('#conInput', '84'); await page.keyboard.press('Enter'); await inputReady();
await page.fill('#conInput', '36'); await page.keyboard.press('Enter');
await page.waitForFunction(() => /MCD = 12/.test(document.querySelector('#conOut').innerText), null, { timeout: 60000 }); await wait(2000);
const mcd = await frame().evaluate(() => [...document.querySelectorAll('text')].map((t) => t.textContent).find((x) => /MCD/.test(x)));
ok('blocchi di Euclide: ' + mcd + ' ' + await msg(), mcd === 'MCD = 12' && !(await msg()));
await open('factorial', 'La torre di ghiaccio');
await page.click('#runBtn'); await inputReady();
await page.fill('#conInput', '5'); await page.keyboard.press('Enter');
await page.waitForFunction(() => /Fine del programma/.test(document.querySelector('#conOut').innerText), null, { timeout: 60000 }); await wait(2500);
const tower = await frame().evaluate(() => [...document.querySelectorAll('text')].map((t) => t.textContent).filter((x) => /!/.test(x)));
ok('torre di ghiaccio: ' + tower.join(' | ') + ' ' + await msg(), tower.includes('5! = 120') && !tower.some((x) => /\?/.test(x)) && !(await msg()));
console.log('ERR', errs);
await browser.close();
