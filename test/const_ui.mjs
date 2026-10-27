import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1366, height: 860 } });
const errs=[]; page.on('pageerror', e => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.clear(); const s=document.querySelector('#speed'); s.value=0; s.dispatchEvent(new Event('input')); FlowLab.loadExample('bolle'); });
await page.click('#runBtn'); await page.waitForTimeout(400);
console.log('bolle:', (await page.innerText('#conOut')).split('\n').slice(1, 3).join(' | '));
// inserimento dal menu
const ins = await page.$$('#chart .ins'); await ins[0].click();
await page.click('.insbtn[title="Costante"]');
await page.fill('#f_name', 'SOGLIA'); await page.click('label[for="f_type_Real"]'); await page.fill('#f_expression', '6.5');
await page.click('.modal footer .btn.primary'); await page.waitForTimeout(150);
const shape = await page.$eval('#chart .shape[data-kind=const]', g => [...g.querySelectorAll('text')].map(t => t.textContent).join(' | '));
console.log('blocco nel diagramma:', shape);
await page.screenshot({ path: 'test/k1.png', clip: { x: 0, y: 40, width: 940, height: 420 } });
// .fprg: come lo vedono gli altri editor e come lo rilegge FlowLab
const r = await page.evaluate(() => {
  const x = FlowLab.serialize();
  const lines = x.split('\n').filter((l) => /SOGLIA|DIM/.test(l)).map((l) => l.trim());
  FlowLab.loadText(x, 'k.fprg');
  return { lines, same: FlowLab.serialize().replace(/name="(saved|edited)" value="[^"]*"/g, '') === x.replace(/name="(saved|edited)" value="[^"]*"/g, ''), kinds: FlowLab.state.prog.functions[0].body.map((s) => s.kind).slice(0, 4).join(',') };
});
console.log(r.lines.join('\n')); console.log('riapertura identica:', r.same, '| blocchi:', r.kinds);
// variabili: tag cost
await page.click('#stepBtn'); await page.click('#stepBtn'); await page.click('#stepBtn'); await page.waitForTimeout(700);
await page.click('.tabw[data-tab=vars] [role=tab]'); await page.waitForTimeout(100);
console.log('variabili:', (await page.innerText('#varsBody')).replace(/\n/g, ' '));
// tentativo di modifica della costante
await page.evaluate(() => { const S = ModelLib.makeStmt; FlowLab.state.prog.functions[0].body.splice(3, 0, S('assign', { variable: 'DIM', expression: '3' })); FlowLab.render(); });
await page.click('#stopBtn').catch(() => {}); await page.click('#runBtn'); await page.waitForTimeout(400);
await page.click('.tabw[data-tab=console] [role=tab]');
console.log('modifica:', (await page.innerText('#conOut')).split('\n').filter(l => l.includes('Errore'))[0]);
console.log('ERR', errs); await browser.close();
