// Esci dalla funzione (Maiusc+F8): esegue il resto della funzione e si ferma dopo la chiamata
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
const wait = (ms = 80) => page.waitForTimeout(ms);
const ok = (n, c) => console.log(`${c ? 'ok  ' : 'FAIL'} ${n}`);
const where = () => page.evaluate(() => { const r = FlowLab.run; const f = r.curFrame; return `${f ? f.func.name : '-'}#${r.curId && document.querySelector(`#chart .shape[data-id="${r.curId}"] text`)?.textContent}`; });
await page.evaluate(() => { localStorage.clear(); FlowLab.loadExample('bolle'); }); await wait(200);
ok('pulsante accanto a Passo sopra', await page.evaluate(() => document.querySelector('#overBtn').nextElementSibling.id === 'outBtn'));
// passo passo fino a entrare in Ordina
for (let i = 0; i < 80 && !(await where()).startsWith('Ordina#'); i++) { await page.click('#stepBtn'); await wait(15); }
for (let i = 0; i < 6; i++) { await page.click('#stepBtn'); await wait(15); }
const dentro = await where();
ok('dentro Ordina: ' + dentro, dentro.startsWith('Ordina#'));
await page.click('#outBtn'); await wait(400);
const fuori = await where();
ok('dopo Esci dalla funzione: ' + fuori, fuori.startsWith('Main#') && /Dopo/.test(fuori));
ok('stato: ' + await page.evaluate(() => FlowLab.run.state), (await page.evaluate(() => FlowLab.run.state)) === 'paused');
// con il tasto: si entra in Stampa e si esce con Maiusc+F8
await page.click('#stepBtn'); await wait(30); await page.click('#stepBtn'); await wait(30);
for (let i = 0; i < 10 && !(await where()).startsWith('Stampa#'); i++) { await page.click('#stepBtn'); await wait(15); }
ok('dentro Stampa: ' + await where(), (await where()).startsWith('Stampa#'));
await page.keyboard.press('Shift+F8'); await wait(400);
ok('Maiusc+F8: ' + await where() + ' · ' + await page.evaluate(() => FlowLab.run.state), (await where()).startsWith('Main#') || (await page.evaluate(() => FlowLab.run.state)) === 'done');
// nel Main: esegue fino alla fine
await page.keyboard.press('Shift+F8'); await wait(400);
ok('dal Main: ' + await page.evaluate(() => FlowLab.run.state), (await page.evaluate(() => FlowLab.run.state)) === 'done');
// senza esecuzione in corso parte passo passo
await page.click('#outBtn'); await wait(150);
ok('da fermo parte passo passo: ' + await where(), (await page.evaluate(() => FlowLab.run.state)) === 'paused');
console.log('ERR', errs);
await browser.close();
