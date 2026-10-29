// Apertura di un .fprg da indirizzo web con ?url=
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
import { spawn } from 'child_process';
const fprg = fs.readFileSync('test/out/web.fprg', 'utf8');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 } });
// un finto GitHub: il link «blob» deve diventare raw.githubusercontent.com
let asked = [];
await ctx.route('https://raw.githubusercontent.com/**', (r) => { asked.push(r.request().url()); r.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain' }, body: fprg }); });
await ctx.route('https://esempio.invalid/**', (r) => r.abort());
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
const base = 'file://' + process.cwd() + '/dist/FlowLab.html';
await page.goto(base); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.setItem('flowlab:speed', '0'); FlowLab.loadExample('tabellina'); }); await page.waitForTimeout(300); // lavoro precedente (salvato in automatico)
await page.goto(base + '?url=' + encodeURIComponent('https://github.com/prof/esercizi/blob/main/cap1/web.fprg')); await page.waitForTimeout(800);
console.log('richiesto:', asked.join(', '));
console.log('aperto:', await page.innerText('#progName'), '· indirizzo ora:', page.url().includes('url=') ? 'con parametro' : 'senza parametro', '· avviso:', await page.innerText('#toast'));
await page.click('#runBtn'); await page.waitForTimeout(300);
console.log('esecuzione:', (await page.evaluate(() => document.querySelector('#conOut').textContent)));
await page.keyboard.press('Control+z'); await page.waitForTimeout(150);
console.log('dopo Ctrl+Z:', await page.innerText('#progName'));
// ricaricando si ritrova il lavoro, non il file del link
await page.keyboard.press('Control+y'); await page.waitForTimeout(150);
await page.reload(); await page.waitForTimeout(500);
console.log('dopo ricarica:', await page.innerText('#progName'));
// errore
await page.goto(base + '?url=' + encodeURIComponent('https://esempio.invalid/x.fprg')); await page.waitForTimeout(800);
console.log('errore:', await page.innerText('#toast'));
// indirizzo relativo da un server (come GitHub Pages)
const srv = spawn('python3', ['-m', 'http.server', '8765', '--bind', '127.0.0.1'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
await page.goto('http://127.0.0.1:8765/dist/FlowLab.html?url=../test/out/web.fprg'); await page.waitForTimeout(800);
console.log('relativo:', await page.innerText('#progName'));
// link di condivisione
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:8765' });
await page.click('#fileBtn'); await page.click('#pop button:has-text("Copia il link a questo programma")'); await page.waitForTimeout(150);
console.log('link:', await page.evaluate(() => navigator.clipboard.readText()));
srv.kill();
console.log('ERR', errs);
await browser.close();
