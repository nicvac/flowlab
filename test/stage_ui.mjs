// Stage: a program names its stages (.flstage in the same folder, or a web address). Without stages the module is not
// loaded; collapsed to the title bar the stage is unloaded (no iframe, the program runs as without it); expanded it follows
// the variables and the program waits for the animations. The .fprg saves the names, the bindings, the active stage and
// the collapse; the files not at hand are asked for; a program and its stages can be opened together, or from an address.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
import path from 'path';
// GSAP from the CDN: here served from a local copy of the npm package (GSAP_DIR), when the CDN cannot be reached
const GSAP = process.env.GSAP_DIR || '/tmp/claude-0/-home-claude/a3dfa59b-97d5-5c46-98cc-6343d78b4caa/scratchpad/gsap/package';
const browser = await chromium.launch();
const page = await browser.newPage({ locale: 'it-IT', viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
if (fs.existsSync(GSAP)) await page.route('https://cdn.jsdelivr.net/npm/gsap@3.12.5/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(path.join(GSAP, new URL(r.request().url()).pathname.split('/gsap@3.12.5/')[1])) }));
// a site with a program and its stage next to it
await page.route('https://scuola.example/prog/**', (r) => {
  const f = new URL(r.request().url()).pathname.split('/').pop();
  const src = f === 'ordina.fprg' ? 'examples/it/bubble_sort.fprg' : 'examples/it/' + f;
  if (!fs.existsSync(src)) return r.fulfill({ status: 404, body: 'no' });
  r.fulfill({ status: 200, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(src, 'utf8') });
});
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(400);
const wait = (ms = 150) => page.waitForTimeout(ms);
const ok = (name, cond) => console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
const out = async () => (await page.innerText('#conOut')).split('\n').filter((l) => l && !/^(Programma|▶|■|Esecuzione)/.test(l)).join(' | ');
const stageFrame = () => page.frames().find((f) => f !== page.mainFrame() && f.url() === 'about:srcdoc');
const ready = () => page.waitForFunction(() => FlowLab.stage && FlowLab.stage.info() && FlowLab.stage.info().ready, null, { timeout: 15000 });
const win = () => page.evaluate(() => { const w = document.querySelector('.stagewin'); return w ? { min: w.classList.contains('min'), opts: [...w.querySelectorAll('.stage-sel option')].map((o) => o.textContent), sel: w.querySelector('.stage-sel').value, iframe: !!w.querySelector('iframe'), missing: (w.querySelector('.stage-missing') || {}).innerText || '' } : null; });
const choose = async (title) => { const i = (await win()).opts.indexOf(title); await page.selectOption('.stagewin .stage-sel', String(i)); await wait(100); };
const expand = async () => { if ((await win()).min) await page.click('.stagewin .minbtn'); await wait(100); };
const fast = async () => { await page.locator('.stagewin .stage-speed').fill('7'); await page.locator('.stagewin .stage-speed').dispatchEvent('input'); };
const runToEnd = async (re) => { const t0 = Date.now(); await page.click('#runBtn'); await page.waitForFunction((r) => new RegExp(r).test(document.querySelector('#conOut').innerText), re, { timeout: 120000 }); return Date.now() - t0; };
const speed0 = () => page.evaluate(() => { const s = document.querySelector('#speed'); s.value = 3; s.dispatchEvent(new Event('input')); });
const fprgStages = () => page.evaluate(() => (FlowLab.serialize().match(/<flowlab-stages[\s\S]*?<\/flowlab-stages>/) || [''])[0]);

ok('modulo non caricato all\'avvio (programma senza stage)', await page.evaluate(() => typeof window.FlowLabStage === 'undefined' && !FlowLab.stage && !document.querySelector('.stagewin')));
// the list of the examples: the icon of the stage next to those linked to stages
await page.click('#exBtn'); await page.waitForTimeout(150);
const exs = await page.$$eval('#pop .ctxmenu button', (bs) => bs.map((b) => [b.querySelector('.ex-title').textContent.trim(), !!b.querySelector('.ex-stage svg')]));
const withIcon = exs.filter((x) => x[1]).map((x) => x[0]);
ok('esempi con l\'icona dello stage: ' + withIcon.join(', '), withIcon.length === 4 && exs.length > 10 && withIcon.some((t) => /bolle/i.test(t)) && withIcon.some((t) => /Euclide/i.test(t)));
await page.keyboard.press('Escape'); await page.mouse.click(600, 600); await page.waitForTimeout(100);
// an example with its stages: the window is there, collapsed: nothing loaded, the program runs as without stages
await page.evaluate(() => FlowLab.loadExample('bubble_sort')); await wait(300);
let w = await win();
ok(`esempio con i suoi stage: ${w.opts.join(' / ')}, ridotta, senza iframe`, w.min && !w.iframe && w.opts.join('|') === 'La fila dei pinguini' && !(await page.evaluate(() => FlowLab.stage.isOpen())));
await speed0();
const tNo = await runToEnd('Dopo');
// the other stage, expanded: it follows the variables with the bindings of the program
await choose('La fila dei pinguini'); await expand();
await ready(); await wait(300);
const info = await page.evaluate(() => FlowLab.stage.info());
ok('stage pronto, agganci del programma: ' + JSON.stringify(info.bindings), info.ready && info.bindings.fila === 'Main.dati' && info.bindings.j === 'Ordina.j' && (await page.locator('.modal').count()) === 0);
ok('finestra staccata, iframe isolato', await page.locator('.fwin.stagewin iframe[sandbox="allow-scripts"]').count() === 1);
await fast();
const t0 = Date.now(); await page.click('#runBtn');
await wait(2500);
const mid = await page.evaluate(() => document.body.dataset.run);
ok('dopo 2,5 s il programma è ancora in corso (aspetta le animazioni): ' + mid, mid === 'running');
await page.waitForFunction(() => /Dopo/.test(document.querySelector('#conOut').innerText), null, { timeout: 120000 });
const tYes = Date.now() - t0;
ok(`tempo con lo stage ridotto ${tNo} ms, aperto ${tYes} ms`, tYes > tNo + 2000);
await wait(600);
const kids = await stageFrame().evaluate(() => [...document.querySelectorAll('.kid')].filter((k) => +getComputedStyle(k).opacity > 0.5 && k.getCTM().f < 400).map((k) => [k.getCTM().e, +k.querySelector('text').textContent]).sort((a, b) => a[0] - b[0]).map((x) => x[1]));
const sorted = (await out()).split('|').find((l) => /Dopo/.test(l)).replace(/Dopo:\s*/, '').trim().split(/\s+/).map(Number);
ok('i pinguini in fila ordinati come l\'array: ' + kids.join(',') + ' / ' + sorted.join(','), kids.join(',') === sorted.join(','));
// collapsed again: unloaded
await page.click('.stagewin .minbtn'); await wait(150);
const tAfter = await runToEnd('Dopo');
ok(`ridotto: niente iframe, tempo ${tAfter} ms`, tAfter < tNo + 1500 && !(await win()).iframe && !(await page.evaluate(() => FlowLab.stage.isOpen())));
// the .fprg: names, bindings, active, collapsed; an edit and Undo do not touch the stages
let x = await fprgStages();
ok('salvato nel .fprg: attivo 0, ridotto, il nome e gli agganci', /active="0" collapsed="True"/.test(x) && /<stage file="bubble_sort_ice.flstage">/.test(x) && !/<stage file="bubble_sort.flstage">/.test(x) && /<bind slot="fila" variable="Main.dati"\/>/.test(x) && !/export/.test(x));
await page.keyboard.press('Control+z'); await wait(100);
ok('Annulla non tocca gli stage', (await fprgStages()) === x);

// the same program opened from a file: its stages are not at hand, the window asks for them
const xml = await page.evaluate(() => FlowLab.serialize());
await page.evaluate((t) => { FlowLab.state.dirty = false; FlowLab.loadText(t, 'ordina.fprg'); }, xml); await wait(300);
w = await win();
ok(`aperto da file: stesso stage, ridotto (${w.opts.join(' / ')})`, w.min && w.sel === '0' && w.opts.length === 1);
await expand(); await wait(300);
w = await win();
ok('il file non c\'è: ' + w.missing.replace(/\n+/g, ' '), /Non trovo il file bubble_sort_ice\.flstage/.test(w.missing) && /stessa cartella/.test(w.missing));
const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('.stagewin .stage-missing button')]);
await fc.setFiles(['examples/it/bubble_sort_ice.flstage']);
await ready(); await wait(200);
ok('scelti i file: lo stage parte (' + (await page.evaluate(() => FlowLab.stage.info().name)) + ')', (await page.evaluate(() => FlowLab.stage.info().name)) === 'La fila dei pinguini');

// a program and its stages opened together (Open with several files)
fs.mkdirSync('test/out', { recursive: true });
fs.writeFileSync('test/out/ordina.fprg', xml.replace('collapsed="True"', 'collapsed="False"'));
await page.evaluate(() => { FlowLab.state.dirty = false; location.hash = ''; }); await page.reload(); await page.waitForTimeout(500);
await page.evaluate(() => localStorage.removeItem('flowlab.stageCache'));
await page.setInputFiles('#fileInput', ['test/out/ordina.fprg', 'examples/it/bubble_sort_ice.flstage']);
await ready(); await wait(200);
ok('aperti insieme programma e stage: parte subito ' + (await page.evaluate(() => FlowLab.stage.info().name)), (await page.evaluate(() => FlowLab.stage.info().name)) === 'La fila dei pinguini' && !(await win()).missing);

// reloading the page: the program comes back (saved automatically) and its stages too (a copy kept by the browser)
await page.reload(); await page.waitForTimeout(500); await expand(); await ready();
ok('ricaricata la pagina: programma e stage di nuovo lì (' + (await page.evaluate(() => FlowLab.stage.info().name)) + ')', (await page.evaluate(() => FlowLab.stage.info().name)) === 'La fila dei pinguini');
// from a web address: the stages next to the program are downloaded
await page.evaluate(() => { FlowLab.state.dirty = false; }); await page.evaluate(() => FlowLab.openUrl('https://scuola.example/prog/ordina.fprg'));
await wait(300); await expand(); await ready();
ok('da indirizzo: lo stage accanto al programma scaricato da solo (' + (await page.evaluate(() => FlowLab.stage.info().name)) + ')', (await page.evaluate(() => FlowLab.stage.info().name)) === 'La fila dei pinguini');

// a stage whose variables are not in the program: the dialog to bind them, and the bindings go in the .fprg
await page.evaluate(() => { FlowLab.state.dirty = false; FlowLab.loadExample('gcd'); }); await wait(300);
await page.click('#fileBtn'); await wait(100); await page.click('#pop button:has-text("Stage")'); await wait(100);
const items = await page.$$eval('#pop .ctxmenu button', (bs) => bs.map((b) => b.textContent));
ok('menu File › Stage: ' + items.join(' | '), items.some((t) => /Collega file di stage/.test(t)) && items.some((t) => /indirizzo web/.test(t)) && items.some((t) => /Mostra lo stage/.test(t)) && items.some((t) => /Scollega/.test(t)));
const [fc2] = await Promise.all([page.waitForEvent('filechooser'), page.click('#pop button:has-text("Collega file di stage")')]);
await fc2.setFiles(['examples/it/bubble_sort_ice.flstage']);
await ready(); await wait(300);
ok('dialogo degli agganci: ' + await page.locator('.modal h2').textContent().catch(() => '—'), /variabili/.test(await page.locator('.modal h2').textContent().catch(() => '')) && /nessuna variabile di questo tipo/.test(await page.locator('.modal').innerText()));
await page.click('.modal footer .btn:not(.primary)'); await wait(100);
w = await win();
ok(`collegato al programma come terzo stage, attivo: ${w.opts.join(' / ')}`, w.opts.length === 3 && w.sel === '2' && (await page.evaluate(() => FlowLab.state.dirty)));
// unlinked: back to the two of the example
await page.click('.stagewin button[aria-label="Scollega lo stage dal programma"]'); await wait(300);
w = await win();
ok(`scollegato: ${w.opts.join(' / ')}`, w.opts.length === 2 && !/bubble_sort_ice\.flstage/.test(await fprgStages()));
// the right stage for gcd: the input from the keyboard, the sticks move
await choose('I bastoncini di Euclide'); await expand(); await ready(); await wait(300); await fast();
await page.click('#runBtn'); await wait(300);
await page.fill('#conInput', '84'); await page.keyboard.press('Enter'); await wait(600);
await page.fill('#conInput', '36'); await page.keyboard.press('Enter');
await page.waitForFunction(() => /MCD = 12/.test(document.querySelector('#conOut').innerText), null, { timeout: 60000 }); await wait(1500);
const banner = await stageFrame().evaluate(() => [...document.querySelectorAll('text')].map((t) => t.textContent).find((x) => /MCD/.test(x)));
ok('bastoncini: ' + banner, banner === 'MCD = 12');
// download of the stage: its file, with the bindings as defaults
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.stagewin button[aria-label="Salva lo stage (con gli agganci)"]')]);
const saved = fs.readFileSync(await dl.path(), 'utf8');
ok('salvato: ' + dl.suggestedFilename() + ' ' + saved.split('\n').find((l) => /export const bindings/.test(l)), dl.suggestedFilename() === 'gcd.flstage' && /export const bindings = \{"a":"Main.a","b":"Main.b","r":"Main.r"\};/.test(saved));
// all unlinked: no window, nothing in the .fprg
await page.click('.stagewin button[aria-label="Scollega lo stage dal programma"]'); await wait(200);
await page.click('.stagewin button[aria-label="Scollega lo stage dal programma"]'); await wait(200);
ok('tutti scollegati: niente finestra, niente stage nel .fprg', !(await page.locator('.stagewin').count()) && !(await fprgStages()) && !(await page.evaluate(() => FlowLab.stage.isOpen())));
// a program without stages after one with stages: the window goes away
await page.evaluate(() => { FlowLab.state.dirty = false; FlowLab.loadExample('factorial'); }); await wait(300);
const hadWin = !!(await win());
await page.evaluate(() => { FlowLab.state.dirty = false; FlowLab.loadExample('even_odd'); }); await wait(300);
ok('programma senza stage: la finestra se ne va', hadWin && !(await win()));
console.log('ERR', errs);
await browser.close();
