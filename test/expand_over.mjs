// Blocchi con testo troncato espandibili con + · Passo sopra
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 820 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
const wait = (ms = 120) => page.waitForTimeout(ms);
await page.evaluate(() => { localStorage.clear(); FlowLab.loadExample('lista'); FlowLab.showFunc(0); });
await wait(200);
const out = page.locator('#chart .shape[data-kind=output]').last();
const box0 = await out.boundingBox();
console.log('pulsanti +:', await page.locator('#chart .shape:not(.comment) .ctoggle').count(), '· testo chiuso:', await out.locator('text').first().textContent());
await out.locator('.ctoggle').click(); await wait(150);
const outO = page.locator('#chart .shape[data-kind=output]').last();
console.log('aperto: righe', await outO.locator('text:not(.badge)').allTextContents(), '· altezza', Math.round(box0.height), '→', Math.round((await outO.boundingBox()).height));
await page.screenshot({ path: 'test/exp1.png', clip: { x: 150, y: 380, width: 700, height: 260 } });
// una condizione lunga in un Se
await page.evaluate(() => { const p = FlowLab.state.prog; p.functions[0].body.push(ModelLib.makeStmt('if', { expression: 'lista.contiene(9) and lista.contiene(16) and not lista.contiene(10) and lista.contiene(25) or lista.contiene(1)', then: [ModelLib.makeStmt('output', { expression: '"sì"' })] })); FlowLab.render(); });
await wait(150);
const iff = page.locator('#chart .shape[data-kind=if]').last();
await iff.locator('.ctoggle').click(); await wait(150);
console.log('Se aperto: righe', await page.locator('#chart .shape[data-kind=if] text').allTextContents());
await page.screenshot({ path: 'test/exp2.png', fullPage: false });
await page.locator('#chart .shape[data-kind=if] .ctoggle').click(); await wait(100);
console.log('Se richiuso:', await page.locator('#chart .shape[data-kind=if] text').count(), 'riga');

// Passo sopra
await page.evaluate(() => FlowLab.loadExample('bolle')); await wait(200);
const cur = () => page.evaluate(() => { const r = FlowLab.run; const f = r.curFrame; return `${f ? f.func.name : '-'}#${r.curId && document.querySelector(`#chart .shape[data-id="${r.curId}"] text`)?.textContent}`; });
const trace = [];
for (let i = 0; i < 6; i++) { await page.click('#stepBtn'); await wait(40); trace.push(await cur()); }
console.log('passi:', trace.join(' | '));
for (let i = 0; i < 60 && !(await cur()).includes('Stampa(dati)'); i++) { await page.click('#overBtn'); await wait(30); }
console.log('fermo su:', await cur());
await page.click('#stepBtn'); await wait(80); console.log('Passo entra:', await cur());
for (let i = 0; i < 60 && !(await cur()).includes('Ordina(dati)'); i++) { await page.click('#overBtn'); await wait(30); }
console.log('dopo Passo sopra dentro Stampa si torna a:', await cur());
await page.click('#overBtn'); await wait(200); console.log('Passo sopra su Ordina(dati):', await cur());
await page.screenshot({ path: 'test/over.png' });
console.log('output:', (await page.innerText('#conOut')).split('\n').slice(1).join(' / '));
await page.keyboard.press('F8'); await wait(150); console.log('F8:', await cur());
console.log('ERR', errs);
await browser.close();
