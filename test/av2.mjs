import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs=[]; page.on('pageerror', e => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.clear(); });
await page.reload(); await page.waitForTimeout(300);
// 1D lungo: 200 elementi riempiti uno alla volta
await page.evaluate(() => { const S = ModelLib.makeStmt; const p = ModelLib.newProgram(); p.attrs.name = 'Striscia';
  p.functions[0].body = [S('declare', { name: 'v', type: 'Integer', array: true, size: '200' }), S('declare', { name: 'i', type: 'Integer' }), S('for', { variable: 'i', start: '0', end: '199', body: [S('assign', { variable: 'v[i]', expression: 'i * i' })] })];
  FlowLab.loadText(ModelLib.serializeFprg(p), 's.fprg'); const s=document.querySelector('#speed'); s.value=3; s.dispatchEvent(new Event('input')); });
await page.click('.tabw[data-tab=vars] [role=tab]');
for (let i = 0; i < 4; i++) { await page.click('#stepBtn'); await page.waitForTimeout(30); }
await page.waitForTimeout(600);
await (await page.$$('#varsBody .avlink'))[0].click();
await page.evaluate(() => { const w = document.querySelector('.avwin'); Object.assign(w.style, { left: '40px', top: '120px', width: '640px', height: '200px' }); });
await page.click('#runBtn'); await page.waitForTimeout(6000); await page.click('#pauseBtn').catch(() => {}); await page.waitForTimeout(500);
const s = await page.evaluate(() => { const w = document.querySelector('.avwin'); const b = w.querySelector('.av-body'); const cs = getComputedStyle(b);
  const vis = [...w.querySelectorAll('.av-c')].map(c => +c.dataset.off); return { modo: w.dataset.mode, primo: Math.min(...vis), ultimo: Math.max(...vis), focus: w.querySelector('.av-c.focus')?.dataset.off, sfumaSx: cs.getPropertyValue('--fl'), sfumaDx: cs.getPropertyValue('--fr') }; });
console.log('striscia durante il run:', JSON.stringify(s));
await page.screenshot({ path: 'test/av4.png', clip: { x: 20, y: 100, width: 700, height: 240 } });
// allargando la finestra si vedono più celle
await page.evaluate(() => { document.querySelector('.avwin').style.width = '1100px'; }); await page.waitForTimeout(400);
console.log('celle visibili dopo allargamento:', await page.$$eval('.avwin .av-c', c => c.length));
// matrici: tavola e cubo aperti a programma finito
await page.click('#stopBtn').catch(() => {});
await page.evaluate(() => { document.querySelectorAll('.avwin').forEach((w) => w.remove()); FlowLab.loadExample('matrici'); const s=document.querySelector('#speed'); s.value=0; s.dispatchEvent(new Event('input')); });
await page.click('#runBtn'); await page.waitForTimeout(800);
const btns = await page.$$('#varsBody .avlink'); for (const b of btns) await b.click();
await page.evaluate(() => { const ws = [...document.querySelectorAll('.avwin')]; const pos = [[20, 60, 520, 380], [560, 60, 560, 400], [560, 480, 620, 390]]; ws.forEach((w, i) => { const p = pos[i]; Object.assign(w.style, { left: p[0] + 'px', top: p[1] + 'px', width: p[2] + 'px', height: p[3] + 'px' }); }); });
await page.waitForTimeout(600);
console.log('finestre:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.avwin')].map(w => ({ t: w.querySelector('.fwin-title').textContent, pagina: w.querySelector('.av-pagestep .av-idx')?.textContent, lead: [...w.querySelectorAll('.av-lead .av-idx')].map(x => x.textContent).join(','), celle: w.querySelectorAll('.av-c').length })))));
await page.screenshot({ path: 'test/av5.png' });
console.log('ERR', errs); await browser.close();
