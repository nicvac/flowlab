// Raccolte di moduli da GitHub, pulsante "Importa modulo", moduli di sole funzioni nella vista Funzioni
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
const browser = await chromium.launch(proxy ? { proxy } : {});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.clear(); const s = document.querySelector('#speed'); s.value = 0; s.dispatchEvent(new Event('input')); });
const wait = (ms = 150) => page.waitForTimeout(ms);
const ok = (name, cond) => console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
const out = async () => (await page.innerText('#conOut')).split('\n').filter((l) => l && !/^(▶|■)/.test(l)).join(' | ');

await page.evaluate(() => FlowLab.loadExample('bolle')); await wait(200);
// pulsante nella barra
ok('pulsante: ' + await page.locator('#modBtn').getAttribute('title'), (await page.locator('#modBtn .lbl').textContent()) === 'Importa modulo');
await page.click('#modBtn'); await wait(300);
await page.evaluate(() => document.querySelectorAll('.modal details').forEach((d) => { d.open = true; })); await page.waitForTimeout(100);
await page.waitForFunction(() => ![...document.querySelectorAll('.modsrc')].some((d) => /Caricamento/.test(d.innerText)), null, { timeout: 30000 });
await page.evaluate(() => document.querySelectorAll('.modal details').forEach((d) => { d.open = true; })); await page.waitForTimeout(100);

const off = await page.locator('.modsrc').first().innerText();
ok('raccolta ufficiale: ' + off.split('\n').slice(0, 3).join(' / '), /nicvac\/flowlab\/moduli/.test(off) && (await page.locator('.modsrc').first().locator('.modrow').count()) === 5);
ok('argomenti: ' + (await page.locator('.modsrc').first().locator('.modtname').allTextContents()).join(', '), (await page.locator('.modsrc .modtname').allTextContents()).includes('Strutture dati'));
// aggiungo come raccolta la cartella esempi del repository
await page.fill('#f_msrc', 'https://github.com/nicvac/flowlab/tree/main/esempi'); await page.click('.modal button:has-text("Aggiungi la raccolta")'); await wait(300);
await page.evaluate(() => document.querySelectorAll('.modal details').forEach((d) => { d.open = true; })); await page.waitForTimeout(100);
await page.waitForFunction(() => document.querySelectorAll('.modsrc').length === 2 && !/Caricamento/.test(document.querySelectorAll('.modsrc')[1].innerText), null, { timeout: 30000 });
await page.evaluate(() => document.querySelectorAll('.modal details').forEach((d) => { d.open = true; })); await page.waitForTimeout(100);

const second = page.locator('.modsrc').nth(1);
ok('raccolta aggiunta: ' + (await second.locator('.modtname').allTextContents()).join(', ') + ' · ' + (await second.locator('.modrow').count()) + ' moduli', (await second.locator('.modrow').count()) > 5);
await page.screenshot({ path: 'test/modgh1.png' });
ok('salvata tra le raccolte', (await page.evaluate(() => JSON.parse(localStorage.getItem('flowlab:moduleSources')))).length === 2);
// modulo di sole funzioni (bolle: Ordina, Stampa) in un programma a funzioni
await page.keyboard.press('Escape'); await wait(100);
await page.evaluate(() => FlowLab.loadExample('minmax')); await wait(150);
await page.click('#modBtn'); await wait(300);
await page.evaluate(() => document.querySelectorAll('.modal details').forEach((d) => { d.open = true; })); await page.waitForTimeout(100);
await page.waitForFunction(() => document.querySelectorAll('.modsrc').length === 2 && !/Caricamento/.test(document.querySelectorAll('.modsrc')[1].innerText), null, { timeout: 30000 });
await page.evaluate(() => document.querySelectorAll('.modal details').forEach((d) => { d.open = true; })); await page.waitForTimeout(100);

const bolleRow = page.locator('.modsrc').nth(1).locator('.modrow', { hasText: 'Ordinamento a bolle' });
ok('riga del modulo a funzioni: ' + (await bolleRow.locator('.modcls').textContent()), /Ordina\(\)/.test(await bolleRow.locator('.modcls').textContent()));
await bolleRow.locator('button').click(); await wait(300);
ok('vista dopo l\'importazione: ' + await page.evaluate(() => FlowLab.state.view), (await page.evaluate(() => FlowLab.state.view)) === 'functions');
ok('funzioni: ' + (await page.locator('#funcSel option').allTextContents()).join(' | '), (await page.locator('#funcSel option').allTextContents()).some((o) => /Ordina\(v\) · modulo Ordinamento a bolle/.test(o)));
// la funzione del modulo si usa dal Main
await page.evaluate(() => {
  const M = ModelLib, p = FlowLab.state.prog;
  p.functions[0].body = [M.makeStmt('declare', { name: 'v', type: 'Integer', array: true, size: '8' }), M.makeStmt('declare', { name: 'i', type: 'Integer' }),
    M.makeStmt('for', { variable: 'i', start: '0', end: '7', direction: 'inc', step: '1', body: [M.makeStmt('assign', { variable: 'v[i]', expression: '(i * 5) mod 8' })] }),
    M.makeStmt('call', { expression: 'Ordina(v)' }), M.makeStmt('call', { expression: 'Stampa(v)' })];
  FlowLab.showFunc(0); FlowLab.render();
});
await page.click('#runBtn'); await wait(500);
ok('esecuzione: ' + await out(), (await out()).includes('0 1 2 3 4 5 6 7'));
// sola lettura nella vista funzioni
const oi = await page.evaluate(() => FlowLab.state.prog.functions.findIndex((f) => f.name === 'Ordina'));
await page.evaluate((i) => FlowLab.showFunc(i), oi); await wait(150);
ok('barra: ' + await page.innerText('#crumbWhere'), /sola lettura/.test(await page.innerText('#crumbWhere')) && !(await page.locator('#backUml').isVisible()));
await page.keyboard.press('a'); await wait(120);
ok('modifica bloccata: ' + await page.locator('.toast').textContent(), (await page.locator('.modal').count()) === 0);
await page.keyboard.press('F2'); await wait(120);
ok('F2 bloccato', (await page.locator('.modal').count()) === 0);
// salvataggio e riapertura: resta un programma a funzioni con il modulo
const xml = await page.evaluate(() => FlowLab.serialize());
ok('nel file: flowlab-module, nessuna classe', /flowlab-module="Ordinamento a bolle"/.test(xml) && !/flowlab-classes/.test(xml));
await page.evaluate((x) => FlowLab.loadText(x, 'p.fprg'), xml); await wait(200);
ok('riaperto in vista ' + await page.evaluate(() => FlowLab.state.view), (await page.evaluate(() => FlowLab.state.view)) === 'functions');
// moduli nel programma: rimozione dal dialogo
await page.click('#modBtn'); await wait(200);
ok('sezione moduli nel programma', (await page.locator('.modal h3', { hasText: 'Moduli nel programma' }).count()) === 1);
await page.locator('.modrow', { hasText: 'Ordinamento a bolle' }).first().locator('button:has-text("Rimuovi")').click(); await wait(150);
ok('conferma: ' + (await page.locator('.modal .confirm').textContent()).slice(0, 90), /Il programma le usa/.test(await page.locator('.modal .confirm').textContent()));
await page.click('.modal footer .btn.primary'); await wait(150);
ok('rimosso', !(await page.locator('#funcSel option').allTextContents()).some((o) => /modulo/.test(o)));
console.log('ERR', errs);
await browser.close();
