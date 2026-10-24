import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1366, height: 860 } });
const errs=[]; page.on('pageerror', e => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.clear(); FlowLab.loadExample('media'); });
const info = async () => page.evaluate(() => {
  const p = document.querySelector('#chart .trail-path'); const c = document.querySelector('#chart .trail-cursor');
  const t = FlowLab.run.trail;
  return { cur: document.querySelector('#chart .shape.exec')?.dataset.kind, from: t && t.from, len: p ? Math.round(p.getTotalLength()) : 0, cursor: c ? [Math.round(+c.getAttribute('cx')), Math.round(+c.getAttribute('cy'))] : null };
});
// passo-passo
const log = [];
for (let i = 0; i < 8; i++) {
  await page.click('#stepBtn'); await page.waitForTimeout(650);
  if (await page.evaluate(() => FlowLab.run.state) === 'input') { await page.fill('#conInput', i < 5 ? '2' : '7'); await page.press('#conInput','Enter'); await page.waitForTimeout(650); }
  log.push(JSON.stringify(await info()));
}
console.log(log.join('\n'));
await page.screenshot({ path: 'test/t1.png' });
// a metà animazione il cursore è a metà strada
await page.click('#stepBtn'); await page.waitForTimeout(200);
await page.screenshot({ path: 'test/t2.png' });
// Se con ramo vuoto: verifica il ramo seguito
const res = await page.evaluate(async () => {
  const xml = `<?xml version="1.0"?><flowgorithm fileversion="4.2"><attributes/><function name="Main" type="None" variable=""><parameters/><body><declare name="x" type="Integer" array="False" size=""/><assign variable="x" expression="5"/><if expression="x &gt; 3"><then/><else/></if><output expression="x" newline="True"/></body></function></flowgorithm>`;
  FlowLab.loadText(xml, 'r.fprg'); return true; });
await page.evaluate(() => { const s=document.querySelector('#speed'); s.value=3; s.dispatchEvent(new Event('input')); });
for (let i = 0; i < 5; i++) { await page.click('#stepBtn'); await page.waitForTimeout(600); }
const xs = await page.evaluate(() => { const d = document.querySelector('#chart .trail-path')?.getAttribute('d') || ''; return d; });
const ifx = await page.$eval('#chart .shape[data-kind=if]', g => { const b = g.getBBox(); return b.x + b.width / 2; });
const maxX = Math.max(...[...xs.matchAll(/[ML]([\d.]+) /g)].map(m => +m[1]));
console.log('Se con rami vuoti, x>3 vero: il percorso va a destra?', maxX > ifx + 30, '(', Math.round(maxX), '>', Math.round(ifx), ')');
// istantanea: niente cursore
await page.evaluate(() => { const s=document.querySelector('#speed'); s.value=0; s.dispatchEvent(new Event('input')); FlowLab.loadExample('mcd'); });
await page.click('#runBtn'); await page.waitForSelector('#conInput:not([disabled])'); await page.fill('#conInput','12'); await page.press('#conInput','Enter');
await page.waitForSelector('#conInput:not([disabled])'); await page.fill('#conInput','8'); await page.press('#conInput','Enter'); await page.waitForTimeout(300);
console.log('istantanea: trail vuoto =', await page.evaluate(() => !document.querySelector('#chart .trail-path')));
console.log('ERR', errs); await browser.close();
