// The stages speak the language of FlowLab: in English the names in the title bar, the labels of the slots and the texts
// of the scenes are in English (the stage file has the texts of each language); in Italian they stay Italian
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
import path from 'path';
const GSAP = process.env.GSAP_DIR || '/tmp/claude-0/-home-claude/a3dfa59b-97d5-5c46-98cc-6343d78b4caa/scratchpad/gsap/package';
const browser = await chromium.launch();
const ok = (name, cond) => console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
const errs = [];
async function session(lang) {
  const page = await browser.newPage({ locale: lang === 'it' ? 'it-IT' : 'en-US', viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errs.push(e.message));
  if (fs.existsSync(GSAP)) await page.route('https://cdn.jsdelivr.net/npm/gsap@3.12.5/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(path.join(GSAP, new URL(r.request().url()).pathname.split('/gsap@3.12.5/')[1])) }));
  await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
  await page.evaluate((l) => { localStorage.clear(); localStorage.setItem('flowlab.lang', l); localStorage.setItem('flowlab.stageSpeed', '7'); }, lang); await page.reload(); await page.waitForTimeout(400);
  return page;
}
const texts = (page) => page.frames().find((f) => f !== page.mainFrame() && f.url() === 'about:srcdoc').evaluate(() => [...document.querySelectorAll('text')].map((t) => t.textContent).filter((x) => /[A-Za-z!]/.test(x)));
async function play(page, ex, i, inputs) {
  await page.evaluate((x) => { FlowLab.state.dirty = false; FlowLab.loadExample(x); }, ex); await page.waitForTimeout(300);
  await page.evaluate(() => { const s = document.querySelector('#speed'); s.value = 3; s.dispatchEvent(new Event('input')); });
  const names = await page.$$eval('.stagewin .stage-sel option', (o) => o.map((x) => x.textContent));
  await page.selectOption('.stagewin .stage-sel', String(i)); await page.waitForTimeout(100);
  if (await page.evaluate(() => document.querySelector('.stagewin').classList.contains('min'))) await page.click('.stagewin .minbtn');
  await page.waitForFunction(() => FlowLab.stage.info() && FlowLab.stage.info().ready, null, { timeout: 15000 }); await page.waitForTimeout(200);
  await page.click('#runBtn');
  let lo = 1, hi = 100, g = 0;
  for (let k = 0; k < 12 && !/(Fine del programma|End of program)/.test(await page.innerText('#conOut')); k++) {
    const can = await page.waitForFunction(() => !document.querySelector('#conInput').disabled || /(Fine del programma|End of program)/.test(document.querySelector('#conOut').innerText), null, { timeout: 90000 }).then(() => page.evaluate(() => !document.querySelector('#conInput').disabled));
    if (!can) break;
    let v = inputs.shift();
    if (v === undefined) { const t = (await page.innerText('#conOut')).trim(); if (/(higher|alto)\s*$/i.test(t)) lo = g + 1; else if (/(lower|basso)\s*$/i.test(t)) hi = g - 1; g = Math.floor((lo + hi) / 2); v = String(g); }
    await page.fill('#conInput', v); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
  }
  await page.waitForFunction(() => /(Fine del programma|End of program)/.test(document.querySelector('#conOut').innerText), null, { timeout: 120000 }); await page.waitForTimeout(2500);
  return { names, info: await page.evaluate(() => FlowLab.stage.info()), texts: await texts(page), slots: await page.evaluate(() => FlowLab.stage.info() && Object.values(FlowLab.stage.info().name ? {} : {})) };
}
// English
let page = await session('en');
let r = await play(page, 'bubble_sort', 0, []);
ok('en, bubble sort: ' + r.names.join(' / ') + ' · ' + r.texts.filter((x) => !/^\[/.test(x)).join(' | '), r.names.join('|') === 'The penguin row' && r.texts.includes('THE PENGUIN ROW'));
r = await play(page, 'guess_number', 0, []);
ok('en, guess: ' + r.names.join(' / ') + ' · ' + r.texts.join(' | '), r.names.join('|') === 'Ice fishing|Neon Bay nights' && r.texts.includes('GUESSED!') && r.texts.some((x) => /^ICE FISHING · ATTEMPTS: \d+$/.test(x)));
r = await play(page, 'guess_number', 1, []);
ok('en, Neon Bay: ' + r.texts.join(' | '), r.texts.includes('GUESSED!') && r.texts.some((x) => /^ATTEMPTS: \d+$/.test(x)));
r = await play(page, 'gcd', 0, ['84', '36']);
ok('en, gcd: ' + r.names.join(' / ') + ' · ' + r.texts.join(' | '), r.names.join('|') === "Euclid's ice blocks|Euclid's sticks" && r.texts.includes('GCD = 12') && r.texts.includes("EUCLID'S ICE BLOCKS"));
r = await play(page, 'gcd', 1, ['84', '36']);
ok('en, sticks: ' + r.texts.join(' | '), r.texts.includes('GCD = 12') && r.texts.includes("Euclid's sticks"));
r = await play(page, 'factorial', 0, ['5']);
ok('en, factorial: ' + r.names.join(' / ') + ' · ' + r.texts.join(' | '), r.names.join('|') === 'The ice tower|The tower of the calls' && r.texts.includes('5! = 120') && r.texts.includes('THE ICE TOWER'));
// the labels of the slots in the dialog of the bindings
await page.click('.stagewin button[aria-label="Bind the variables…"], .stagewin button[title^="Bind"]'); await page.waitForTimeout(200);
const dlg = await page.locator('.modal').innerText();
ok('en, bindings dialog: ' + dlg.replace(/\s+/g, ' ').slice(0, 160), /The parameter of the recursive function \(k\)/.test(dlg) && /The result of the call/.test(dlg) && !/Il parametro/.test(dlg));
await page.keyboard.press('Escape');
await page.close();
// Italian: the same stages in Italian
page = await session('it');
r = await play(page, 'factorial', 1, ['5']);
ok('it, fattoriale: ' + r.names.join(' / ') + ' · ' + r.texts.join(' | '), r.names.join('|') === 'La torre di ghiaccio|La torre delle chiamate' && r.texts.includes('5! = 120') && r.texts.includes('La torre delle chiamate'));
r = await play(page, 'gcd', 0, ['84', '36']);
ok('it, mcd: ' + r.texts.join(' | '), r.texts.includes('MCD = 12') && r.texts.includes('I BLOCCHI DI EUCLIDE'));
console.log('ERR', errs);
await browser.close();
