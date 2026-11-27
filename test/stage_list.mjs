// Stage on an ArrayList of the modules: the changes are seen only at the end of each method (insert, remove), and Passo
// waits for the animation
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
const page = await browser.newPage({ locale: 'it-IT', viewport: { width: 1440, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.route(/github(usercontent)?\.com/, (r) => r.abort());
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.clear(); const s = document.querySelector('#speed'); s.value = 0; s.dispatchEvent(new Event('input')); });
const wait = (ms = 150) => page.waitForTimeout(ms);
const ok = (name, cond) => console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
await page.evaluate(() => FlowLab.loadExample('times_table')); await wait(200);
await page.keyboard.press('Control+i'); await wait(250);
await page.evaluate(() => document.querySelectorAll('.modal details').forEach((d) => { d.open = true; })); await wait(100);
await page.locator('.modsrc .modrow', { hasText: 'ArrayList' }).locator('button').click(); await wait(300);
await page.evaluate(() => {
  const M = ModelLib, p = FlowLab.state.prog, S = M.makeStmt;
  p.functions[0].body = [S('declare', { name: 'l', type: 'ArrayList<Integer>' }), S('assign', { variable: 'l', expression: 'new ArrayList<Integer>()' }),
    S('call', { expression: 'l.add(5)' }), S('call', { expression: 'l.add(7)' }), S('call', { expression: 'l.add(0, 3)' }), S('call', { expression: 'l.remove(1)' }), S('output', { expression: '"fine " & l.size()' })];
  FlowLab.showFunc(0); FlowLab.render();
});
// a stage without libraries: it writes the events it receives; each animation lasts 0.3 s
const text = `export const bindings = {"lista":"Tabellina.Main.l"};
export default {
  name: 'Registro', slots: { lista: { type: 'List<Integer>', label: 'Lista' } },
  setup(stage) { stage.el('text', { id: 'log', x: 10, y: 20, text: '' }); },
  reset(stage) { document.getElementById('log').textContent = ''; },
  async update(stage, events) { for (const e of events) document.getElementById('log').textContent += e.kind + (e.index != null ? '@' + e.index : '') + (e.value != null && !Array.isArray(e.value) ? '=' + e.value : '') + ' '; await new Promise((r) => setTimeout(r, 300)); },
};`;
await page.evaluate((t) => FlowLab.openStage(t, 'registro.flstage'), text);
await page.waitForFunction(() => FlowLab.stage.info() && FlowLab.stage.info().ready, null, { timeout: 10000 }); await wait(200);
ok('aggancio valido, nessun dialogo', (await page.locator('.modal').count()) === 0);
await page.click('#runBtn');
await page.waitForFunction(() => /fine 2/.test(document.querySelector('#conOut').innerText), null, { timeout: 20000 }); await wait(400);
const frame = page.frames().find((f) => f !== page.mainFrame() && f.url() === 'about:srcdoc');
const log = (await frame.evaluate(() => document.getElementById('log').textContent)).trim();
ok('eventi: ' + log, log === 'appear value insert@0=5 insert@1=7 insert@0=3 remove@1=5');
// step by step: a Passo pressed during the animation is ignored (the steps do not pile up); pressed after it, it goes on
await page.click('#stepBtn'); await wait(50);
let ignored = 0;
for (let i = 0; i < 40 && (await page.evaluate(() => FlowLab.run.state)) !== 'done'; i++) {
  const before = await page.evaluate(() => ({ steps: FlowLab.run.steps, wait: !!FlowLab.run.stageWait }));
  await page.click('#stepBtn'); await wait(30);
  if (before.wait && (await page.evaluate(() => FlowLab.run.steps)) === before.steps) ignored++;
  await page.waitForFunction(() => !FlowLab.run.stageWait, null, { timeout: 5000 }); await wait(30);
  if (i % 4 === 0) { await page.click('#stepBtn'); await page.click('#stepBtn'); await wait(30); if (await page.evaluate(() => !!FlowLab.run.stageWait)) ignored++; await page.waitForFunction(() => !FlowLab.run.stageWait, null, { timeout: 5000 }); }
}
const log2 = (await frame.evaluate(() => document.getElementById('log').textContent)).trim();
ok('passo passo: ' + log2 + ` (${ignored} Passo ignorati durante le animazioni)`, log2 === 'appear value insert@0=5 insert@1=7 insert@0=3 remove@1=5' && ignored > 0);
console.log('ERR', errs);
await browser.close();
