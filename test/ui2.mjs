import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const url = 'file://' + process.cwd() + '/dist/FlowLab.html';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERR ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('ERR_TUNNEL')) errs.push(m.text()); });
await page.goto(url); await page.waitForTimeout(500);
// nuovo programma
await page.evaluate(() => { localStorage.clear(); });
await page.click('#fileBtn'); await page.click('text=Nuovo programma');
await page.waitForTimeout(200);
// clic sulla freccia -> menu -> Dichiara
let ins = await page.$$('#chart .ins'); console.log('ins points', ins.length);
await ins[0].click(); await page.click('.insbtn[title="Dichiara"]');
await page.fill('#f_name', 'a, b'); await page.click('.modal footer .btn.primary');
ins = await page.$$('#chart .ins'); await ins[1].click(); await page.click('.insbtn[title="Input"]');
await page.fill('#f_variable', 'a'); await page.press('#f_variable', 'Enter');
ins = await page.$$('#chart .ins'); await ins[2].click(); await page.click('.insbtn[title="Assegna"]');
await page.fill('#f_variable', 'b'); await page.fill('#f_expression', 'a * (2 +'); await page.click('.modal footer .btn.primary');
console.log('form error:', await page.innerText('.formerr'));
await page.fill('#f_expression', 'a * 2 + 1'); await page.click('.modal footer .btn.primary');
ins = await page.$$('#chart .ins'); await ins[3].click(); await page.click('.insbtn[title="Se"]');
await page.fill('#f_expression', 'b > 10'); await page.click('.modal footer .btn.primary');
// if creates 2 more ins (then/else) - add output in then branch: find ins in order
ins = await page.$$('#chart .ins'); console.log('ins after if', ins.length);
await ins[4].click(); await page.click('.insbtn[title="Output"]');
await page.fill('#f_expression', '"grande: " & b'); await page.click('.modal footer .btn.primary');
ins = await page.$$('#chart .ins'); await ins[6].click(); await page.click('.insbtn[title="Output"]');
await page.fill('#f_expression', '"piccolo: " & b'); await page.click('.modal footer .btn.primary');
await page.screenshot({ path: 'test/e1.png' });
console.log(await page.evaluate(() => FlowLab.serialize()));
// esecuzione passo-passo
for (let i=0;i<4;i++) await page.click('#stepBtn');
await page.waitForSelector('#conInput:not([disabled])'); await page.fill('#conInput', '7'); await page.press('#conInput', 'Enter');
await page.click('#tabs [data-tab=vars]');
await page.click('#stepBtn'); await page.click('#stepBtn');
await page.screenshot({ path: 'test/e2.png' });
console.log('VARS:', (await page.innerText('#varsBody')).replace(/\n/g,' | '));
await page.click('#runBtn'); await page.waitForTimeout(500);
console.log('OUT:', (await page.innerText('#conOut')).replace(/\n/g,' | '));
// undo / redo
const before = await page.evaluate(() => FlowLab.state.prog.functions[0].body.length);
await page.click('#chart .shape[data-kind=if]'); await page.keyboard.press('Delete');
const after = await page.evaluate(() => FlowLab.state.prog.functions[0].body.length);
await page.keyboard.press('Control+z');
const undone = await page.evaluate(() => FlowLab.state.prog.functions[0].body.length);
console.log('delete/undo', before, after, undone);
// drag: sposta "Leggi a" dopo l'assegnamento
const src = await page.$('#chart .shape[data-kind=input]'); const sb = await src.boundingBox();
ins = await page.$$('#chart .ins'); const tb = await ins[3].boundingBox();
await page.mouse.move(sb.x + sb.width/2, sb.y + sb.height/2); await page.mouse.down();
await page.mouse.move(sb.x + sb.width/2 + 20, sb.y + 40, { steps: 5 });
await page.mouse.move(tb.x + tb.width/2, tb.y + tb.height/2, { steps: 8 }); await page.mouse.up();
console.log('order after drag:', await page.evaluate(() => FlowLab.state.prog.functions[0].body.map(s => s.kind).join(',')));
// errore di runtime: variabile non inizializzata
await page.evaluate(() => { const s=document.querySelector('#speed'); s.value=0; s.dispatchEvent(new Event('input')); });
await page.click('#tabs [data-tab=console]');
await page.click('#runBtn'); await page.waitForTimeout(400);
console.log('ERR OUT:', (await page.innerText('#conOut')).replace(/\n/g,' | '));
console.log('err shape:', await page.$eval('#chart .shape.err', e => e.dataset.kind).catch(() => 'none'));
await page.screenshot({ path: 'test/e3.png' });
// nuova funzione
await page.click('#funcAdd'); await page.fill('#f_fname', 'Doppio'); await page.click('text=+ Aggiungi valore restituito'); await page.fill('.rrow input', 'r');
await page.click('text=+ Aggiungi parametro'); await page.fill('.prow input[type=text]', 'x');
await page.click('.modal footer .btn.primary');
console.log('functions:', await page.evaluate(() => FlowLab.state.prog.functions.map(f => f.name + ':' + f.type + ':' + f.params.map(p=>p.name)).join(' ')));
await page.screenshot({ path: 'test/e4.png' });
console.log('ERRORS:', errs);
await browser.close();
