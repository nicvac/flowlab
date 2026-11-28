// Stage and step by step: the cursor stops on every block (also on the one that makes the animation), the steps asked
// during an animation do not pile up, the block lit during the animation is the one that made it, and Pause / Continue
// during an animation do not make the program run twice
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
const random = () => page.evaluate(() => { let n = 0; const s = [0.5, 0.2, 0.9, 0.1, 0.7, 0.3, 0.6, 0.4]; Math.random = () => s[n++ % s.length]; });
const speed = (v) => page.evaluate((x) => { const s = document.querySelector('#speed'); s.value = 3 - x; s.dispatchEvent(new Event('input')); }, v);
/* a stage of the example (linked to it): chosen in the title bar of its window and expanded */
async function useStage(title) {
  await page.waitForSelector('.stagewin');
  const i = await page.evaluate((t) => [...document.querySelectorAll('.stagewin .stage-sel option')].findIndex((o) => o.textContent === t), title);
  await page.selectOption('.stagewin .stage-sel', String(i)); await page.waitForTimeout(100);
  if (await page.evaluate(() => document.querySelector('.stagewin').classList.contains('min'))) await page.click('.stagewin .minbtn');
  await page.waitForFunction((t) => FlowLab.stage.info() && FlowLab.stage.info().ready && FlowLab.stage.info().name === t, title, { timeout: 15000 });
}
await page.evaluate(() => FlowLab.loadExample('bubble_sort')); await wait(200);
await speed(0);

// with the stage of the penguins at 1×, and a hurried user: Step pressed every 120 ms (and sometimes after 700 ms)
await random();
await useStage('La fila dei pinguini'); await wait(200);
await page.locator('.stagewin .stage-speed').fill('3'); await page.locator('.stagewin .stage-speed').dispatchEvent('input');
let heldOk = 0, heldBad = 0, taken = 0, ignored = 0, wrong = 0, s34shown = 0;
const swapBlock = await page.evaluate(() => { const f = FlowLab.state.prog.functions.find((x) => x.name === 'Ordina'); const s = JSON.stringify(f); return (s.match(/"id":"(s\d+)","kind":"assign","variable":"v\[j \+ 1\]"/) || [])[1]; });
for (let k = 0; k < 260; k++) {
  const before = await page.evaluate(() => ({ steps: FlowLab.run.steps, wait: !!FlowLab.run.stageWait, st: FlowLab.run.state }));
  if (before.st === 'done') break;
  await page.click('#stepBtn');
  const s = await page.evaluate(() => ({ steps: FlowLab.run.steps, wait: !!FlowLab.run.stageWait, lit: document.querySelector('#chart .shape.exec')?.dataset.id, cur: FlowLab.run.curId }));
  // a step asked during an animation is not taken; otherwise exactly one step
  // (with the animation ending just before the click the step is taken: that is right too)
  if (s.steps === before.steps) { if (before.wait) ignored++; else if (k) wrong++; } else if (k === 0 || s.steps === before.steps + 1) taken++; else wrong++;
  // during an animation the lit block is the one that made it (the one before the current one)
  if (s.wait) { if (s.lit !== s.cur) heldOk++; else heldBad++; }
  await wait(k % 3 ? 120 : 700);
  if (await page.evaluate((b) => !FlowLab.run.stageWait && FlowLab.run.curId === b && document.querySelector('#chart .shape.exec')?.dataset.id === b, swapBlock)) s34shown++;
}
const last = await page.evaluate(() => FlowLab.run.steps);
await page.waitForFunction(() => !FlowLab.run.stageWait, null, { timeout: 20000 }); await wait(500);
ok(`passo passo con lo stage: ${taken} passi fatti, ${ignored} ignorati durante le animazioni, ${wrong} sbagliati; nessun passo dopo l'ultimo clic (${last} → ${await page.evaluate(() => FlowLab.run.steps)})`, taken > 100 && ignored > 0 && wrong === 0 && last === (await page.evaluate(() => FlowLab.run.steps)));
ok(`il cursore si ferma su v[j + 1] ← t (${swapBlock}): ${s34shown} volte`, s34shown >= 2);
ok(`durante le animazioni è acceso il blocco che le ha fatte: ${heldOk} sì, ${heldBad} no`, heldOk > 0 && heldBad === 0);
await page.click('#stopBtn'); await wait(300);

// Run at a visible speed (280 ms a step), with Pause and Continue pressed during the animations: the program never goes
// on twice (two steps closer than the speed allows, without an animation between them)
await random(); await speed(2);
await page.evaluate(() => {
  window.__steps = []; let last = -1;
  const tick = () => { const r = FlowLab.run; if (r.steps !== last) { window.__steps.push([performance.now(), r.steps, !!r.stageWait]); last = r.steps; } if (!window.__stop) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
await page.click('#runBtn');
let toggles = 0;
for (let k = 0; k < 300 && toggles < 15; k++) {
  await wait(60);
  if (await page.evaluate(() => !!FlowLab.run.stageWait && FlowLab.run.state === 'running')) { await page.click('#pauseBtn'); await wait(30); await page.click('#runBtn'); toggles++; }
}
// then it runs alone for a while: one step at a time, never closer than the speed (280 ms) when there is no animation
const from = await page.evaluate(() => { window.__steps = []; return FlowLab.run.steps; });
await wait(6000);
await page.click('#pauseBtn').catch(() => {});
await page.evaluate(() => { window.__stop = true; });
const steps = await page.evaluate(() => window.__steps);
if (process.env.DBG) console.log(JSON.stringify(steps.map((x, i) => [Math.round(x[0] - (i ? steps[i - 1][0] : x[0])), x[1], x[2]])));
let tooFast = 0;
for (let i = 1; i < steps.length; i++) if (steps[i][1] - steps[i - 1][1] > 1 || (steps[i][0] - steps[i - 1][0] < 200 && !steps[i - 1][2])) tooFast++;
ok(`esegui con ${toggles} pause e riprese durante le animazioni: ${steps.length} passi, ${tooFast} troppo veloci`, toggles > 3 && steps.length >= 6 && tooFast === 0);
// a stage expanded during the execution starts from the values of that moment (the row and j are there at once)
await page.click('#stopBtn').catch(() => {}); await wait(200);
// collapsed: the stage is unloaded
await page.click('.stagewin .minbtn'); await wait(200);
await random(); await speed(0);
for (let i = 0; i < 70; i++) { await page.click('#stepBtn'); await wait(15); }
await page.click('.stagewin .minbtn');
await page.waitForFunction(() => FlowLab.stage.info() && FlowLab.stage.info().ready, null, { timeout: 15000 }); await wait(400);
const fr = page.frames().find((f) => f !== page.mainFrame() && f.url() === 'about:srcdoc');
const mid = await fr.evaluate(() => ({ kids: document.querySelectorAll('.kid').length, arrows: document.querySelectorAll('.arrow').length }));
const before = await page.evaluate(() => FlowLab.run.steps);
await page.click('#stepBtn'); await wait(100);
ok(`stage riaperto a metà esecuzione: ${mid.kids} pile, ${mid.arrows} frecce, poi il passo ${before} → ${await page.evaluate(() => FlowLab.run.steps)}`, mid.kids === 8 && mid.arrows === 2 && (await page.evaluate(() => FlowLab.run.steps)) === before + 1);
console.log('ERR', errs);
await browser.close();
