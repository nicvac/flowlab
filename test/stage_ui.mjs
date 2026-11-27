// Stage: the module is not loaded until a stage is opened; the stage follows the variables and the program waits for the animations
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
import path from 'path';
// GSAP from the CDN: here served from a local copy of the npm package (GSAP_DIR), when the CDN cannot be reached
const GSAP = process.env.GSAP_DIR || '/tmp/claude-0/-home-claude/a3dfa59b-97d5-5c46-98cc-6343d78b4caa/scratchpad/gsap/package';
const browser = await chromium.launch();
const page = await browser.newPage({ locale: 'it-IT', viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
if (fs.existsSync(GSAP)) await page.route('https://cdn.jsdelivr.net/npm/gsap@3.12.5/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(path.join(GSAP, new URL(r.request().url()).pathname.split('/gsap@3.12.5/')[1])) }));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(400);
const wait = (ms = 150) => page.waitForTimeout(ms);
const ok = (name, cond) => console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
const out = async () => (await page.innerText('#conOut')).split('\n').filter((l) => l && !/^(Programma|▶|■|Esecuzione)/.test(l)).join(' | ');
const stageFrame = () => page.frames().find((f) => f !== page.mainFrame() && f.url() === 'about:srcdoc');
const ready = () => page.waitForFunction(() => FlowLab.stage && FlowLab.stage.info() && FlowLab.stage.info().ready, null, { timeout: 15000 });

ok('modulo non caricato all\'avvio', await page.evaluate(() => typeof window.FlowLabStage === 'undefined' && !FlowLab.stage));
await page.evaluate(() => FlowLab.loadExample('bubble_sort')); await wait(250);
// without stage: the time of the run (Istantanea)
await page.evaluate(() => { const s = document.querySelector('#speed'); s.value = 0; s.dispatchEvent(new Event('input')); });
let t0 = Date.now(); await page.click('#runBtn'); await page.waitForFunction(() => /Dopo/.test(document.querySelector('#conOut').innerText)); const tNo = Date.now() - t0;
// the stage from the menu
await page.click('#stageBtn'); await wait(120);
const items = await page.$$eval('#pop .ctxmenu button', (bs) => bs.map((b) => b.textContent));
ok('menu: ' + items.join(' | '), items.some((x) => /La fila dei ragazzi/.test(x)) && items.some((x) => /Apri un file di stage/.test(x)));
await page.click('#pop button:has-text("La fila dei ragazzi")');
await ready(); await wait(300);
const info = await page.evaluate(() => FlowLab.stage.info());
ok('stage pronto, agganci: ' + JSON.stringify(info.bindings), info.ready && info.bindings.fila === 'Main.dati' && !('t' in info.bindings) && (await page.locator('.modal').count()) === 0);
ok('finestra staccata', await page.locator('.fwin.stagewin iframe[sandbox="allow-scripts"]').count() === 1);
// run with the stage at the fastest speed: the program waits for the animations
await page.locator('.stagewin .stage-speed').fill('7'); await page.locator('.stagewin .stage-speed').dispatchEvent('input');
t0 = Date.now(); await page.click('#runBtn');
await wait(2500);
await page.screenshot({ path: 'test/stage1.png' });
const mid = await page.evaluate(() => FlowLab.state && document.body.dataset.run);
ok('dopo 2,5 s il programma è ancora in corso (aspetta le animazioni): ' + mid, mid === 'running');
await page.waitForFunction(() => /Dopo/.test(document.querySelector('#conOut').innerText), null, { timeout: 120000 });
const tYes = Date.now() - t0;
ok(`tempo senza stage ${tNo} ms, con stage ${tYes} ms`, tYes > tNo + 2000);
await wait(600);
const kids = await stageFrame().evaluate(() => [...document.querySelectorAll('.kid')].filter((k) => +getComputedStyle(k).opacity > 0.5 && k.getCTM().f < 400).map((k) => [k.getCTM().e, +k.querySelector('text').textContent]).sort((a, b) => a[0] - b[0]).map((x) => x[1]));
const sorted = (await out()).split('|').find((l) => /Dopo/.test(l)).replace(/Dopo:\s*/, '').trim().split(/\s+/).map(Number);
ok('i ragazzi in fila ordinati come l\'array: ' + kids.join(',') + ' / ' + sorted.join(','), kids.join(',') === sorted.join(','));
await page.screenshot({ path: 'test/stage2.png' });
// step by step: Passo while the animation runs waits for it
// closing the stage: the module stays loaded but nothing follows the execution any more
await page.click('.stagewin button[aria-label="Chiudi lo stage"]'); await wait(150);
t0 = Date.now(); await page.click('#runBtn'); await page.waitForFunction(() => /Dopo/.test(document.querySelector('#conOut').innerText)); const tAfter = Date.now() - t0;
ok(`chiuso: tempo ${tAfter} ms`, tAfter < tNo + 1500 && (await page.locator('.stagewin').count()) === 0);

// a stage whose variables are not in the program: the dialog to bind them
await page.evaluate(() => FlowLab.loadExample('gcd')); await wait(200);
await page.click('#stageBtn'); await wait(120); await page.click('#pop button:has-text("La fila dei ragazzi")');
await ready(); await wait(300);
ok('dialogo degli agganci: ' + await page.locator('.modal h2').textContent().catch(() => '—'), /variabili/.test(await page.locator('.modal h2').textContent().catch(() => '')) && /nessuna variabile di questo tipo/.test(await page.locator('.modal').innerText()));
await page.click('.modal footer .btn:not(.primary)'); await wait(100);
// the right stage for gcd: the input from the keyboard, the sticks move
await page.click('#stageBtn'); await wait(120); await page.click('#pop button:has-text("I bastoncini di Euclide")');
await ready(); await wait(300);
await page.locator('.stagewin .stage-speed').fill('7'); await page.locator('.stagewin .stage-speed').dispatchEvent('input');
await page.click('#runBtn'); await wait(300);
await page.fill('#conInput', '84'); await page.keyboard.press('Enter'); await wait(600);
await page.fill('#conInput', '36'); await page.keyboard.press('Enter');
await page.waitForFunction(() => /MCD = 12/.test(document.querySelector('#conOut').innerText), null, { timeout: 60000 }); await wait(1500);
const banner = await stageFrame().evaluate(() => [...document.querySelectorAll('text')].map((t) => t.textContent).find((x) => /MCD/.test(x)));
ok('bastoncini: ' + banner, banner === 'MCD = 12');
await page.screenshot({ path: 'test/stage3.png' });
// save: the file with the bindings
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.stagewin button[aria-label="Salva lo stage (con gli agganci)"]')]);
const saved = fs.readFileSync(await dl.path(), 'utf8');
ok('salvato: ' + dl.suggestedFilename() + ' ' + saved.split('\n').find((l) => /export const bindings/.test(l)), dl.suggestedFilename() === 'gcd.flstage' && /export const bindings = \{"a":"Main.a","b":"Main.b","r":"Main.r"\};/.test(saved));
console.log('ERR', errs);
await browser.close();
