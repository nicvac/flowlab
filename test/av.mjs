import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs=[]; page.on('pageerror', e => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('flowlab:sideHidden', 'false'); });
await page.reload(); await page.waitForTimeout(300);
await page.evaluate(() => { const s=document.querySelector('#speed'); s.value=0; s.dispatchEvent(new Event('input')); FlowLab.loadExample('matrici'); });
await page.click('.tabw[data-tab=vars] [role=tab]');
// esegue passo-passo fino a dichiarare gli array
for (let i = 0; i < 9; i++) { await page.click('#stepBtn'); await page.waitForTimeout(40); }
await page.waitForTimeout(700);
const rows = await page.$$eval('#varsBody tr.arr', r => r.map(x => x.innerText.replace(/\s+/g, ' ')));
console.log('array nella scheda:', rows);
await (await page.$$('#varsBody .avlink'))[0].click();
await page.waitForTimeout(200);
// avanza: la tavola si riempie, la vista segue
for (let i = 0; i < 70; i++) { await page.click('#stepBtn'); await page.waitForTimeout(15); }
await page.waitForTimeout(800);
const v1 = await page.evaluate(() => { const w = document.querySelector('.avwin'); const b = w.querySelector('.av-body'); return { titolo: w.querySelector('.fwin-title').textContent, celle: w.querySelectorAll('.av-c').length, cambiate: [...w.querySelectorAll('.av-c.chg')].map(c => c.textContent), maschera: getComputedStyle(b).getPropertyValue('--fr') + '/' + getComputedStyle(b).getPropertyValue('--fb'), scroll: [b.scrollLeft, b.scrollTop] }; });
console.log('scacchiera:', JSON.stringify(v1));
await page.screenshot({ path: 'test/av1.png' });
// passa al cubo: esecuzione continua fino a metà
await page.evaluate(() => { const s=document.querySelector('#speed'); s.value=3; s.dispatchEvent(new Event('input')); });
const cuboBtn = await page.$$('#varsBody .avlink'); await cuboBtn[1].click(); await cuboBtn[2].click();
await page.evaluate(() => { const s=document.querySelector('#speed'); s.value=0; s.dispatchEvent(new Event('input')); });
await page.click('#runBtn'); await page.waitForTimeout(150); await page.click('#pauseBtn').catch(()=>{});
await page.waitForTimeout(500);
// ridimensiona e sposta le finestre per vederle tutte
await page.evaluate(() => { const ws = [...document.querySelectorAll('.avwin')]; const pos = [[20, 60, 520, 360], [560, 60, 520, 400], [560, 480, 600, 400]]; ws.forEach((w, i) => { const p = pos[i]; Object.assign(w.style, { left: p[0] + 'px', top: p[1] + 'px', width: p[2] + 'px', height: p[3] + 'px' }); }); });
await page.click('#runBtn'); await page.waitForTimeout(1500);
const v2 = await page.evaluate(() => [...document.querySelectorAll('.avwin')].map(w => ({ titolo: w.querySelector('.fwin-title').textContent, modo: w.dataset.mode, pagina: w.querySelector('.av-pagestep .av-idx')?.textContent, lead: [...w.querySelectorAll('.av-lead .av-idx')].map(x => x.textContent).join(','), stato: w.querySelector('.av-state').textContent })));
console.log('finestre:', JSON.stringify(v2));
await page.screenshot({ path: 'test/av2.png' });
// sfoglia il cubo: pagina successiva
const cube = (await page.$$('.avwin'))[1];
await (await cube.$('.av-pagestep button:last-of-type')).click(); await page.waitForTimeout(150);
await page.screenshot({ path: 'test/av3.png', clip: { x: 540, y: 40, width: 560, height: 440 } });
console.log('pagina dopo ›:', await cube.$eval('.av-pagestep .av-idx', x => x.textContent));
console.log('ERR', errs); await browser.close();
