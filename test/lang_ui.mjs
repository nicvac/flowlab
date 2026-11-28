// Languages: chosen from the browser, changed from the File menu; interface, diagrams, messages, examples, shortcuts and generated code in English, then back to Italian
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.clear(); }); await page.reload(); await page.waitForTimeout(400);
const wait = (ms = 150) => page.waitForTimeout(ms);
const ok = (name, cond) => console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
const out = async () => (await page.innerText('#conOut')).split('\n').filter((l) => l && !/^(▶|■)/.test(l)).join(' | ');

// 1. browser in inglese: interfaccia in inglese
ok('lingua del browser: ' + await page.evaluate(() => I18n.lang), (await page.evaluate(() => I18n.lang)) === 'en');
ok('barra: ' + (await page.locator('#runBtn').innerText()) + ' / ' + (await page.locator('#stepBtn').innerText()), (await page.locator('#runBtn').innerText()).includes('Run') && (await page.locator('#stepBtn').innerText()).includes('Step'));
ok('suggerimento: ' + await page.locator('.hint-add').textContent(), /Click an arrow/.test(await page.locator('.hint-add').textContent()));

// 2. tutti gli esempi: si aprono e si eseguono senza errori, con nomi e testi in inglese
const inputs = { grade_average: ['2', '7', '8'], even_odd: ['7'], times_table: ['3'], gcd: ['12', '18'], guess_number: [], factorial: ['5'] };
const ids = await page.evaluate(() => Examples.list.map((e) => e.id));
for (const id of ids) {
  await page.evaluate((x) => { const s = document.querySelector('#speed'); s.value = 3; s.dispatchEvent(new Event('input')); FlowLab.loadExample(x); }, id); await wait(150);
  if (id === 'indovina') { await page.evaluate(() => { Math.random = () => 0.41; }); }
  await page.click('#runBtn'); await wait(250);
  for (const v of id === 'guess_number' ? ['42'] : inputs[id] || []) { await page.evaluate((x) => FlowLab.submitInput(x), v); await wait(120); }
  await wait(250);
  const o = await out();
  ok(`${id}: ${o.slice(0, 150)}`, !/Error|Errore/.test(o) && !/[àèìòù]/.test(o.replace(/€/g, '')));
}
// nomi in inglese nel diagramma delle classi
await page.evaluate(() => FlowLab.loadExample('shapes')); await wait(200);
await page.evaluate(() => FlowLab.showUml()); await wait(150);
const names = await page.locator('.ubox .uname').allTextContents();
ok('classi: ' + names.join(', '), names.includes('Shape') && names.includes('Rectangle') && names.includes('Drawing'));
ok('stereotipi: ' + (await page.locator('.ustereo').allTextContents()).join(', '), (await page.locator('.ustereo').allTextContents()).includes('«main»'));

// 3. diagramma di flusso: etichette e tipi
await page.evaluate(() => FlowLab.loadExample('grade_average')); await wait(200);
const labels = await page.locator('#chart .labels text, #chart text.blabel').allTextContents();
const chartText = await page.locator('#chart svg').textContent();
ok('etichette: ' + [...new Set(labels)].join(', '), labels.includes('True') && labels.includes('False') && labels.includes('Repeat'));
ok('tipi e Main: ' + (/Integer/.test(chartText) && /Main/.test(chartText)), /Integer/.test(chartText) && /Main/.test(chartText) && !/Intero|Inizio/.test(chartText));
ok('ciclo: ' + (chartText.match(/i from 1 to n/) || ['?'])[0], /i from 1 to n/.test(chartText));

// 4. dialogo di un blocco e messaggio d'errore dell'esecuzione
await page.locator('#chart .shape[data-kind=declare]').first().dblclick(); await wait(150);
ok('dialogo: ' + await page.locator('.modal h2').textContent(), /Declaration/.test(await page.locator('.modal h2').textContent()));
await page.keyboard.press('Escape'); await wait(80);
await page.evaluate(() => { const p = FlowLab.state.prog; p.functions[0].body = [ModelLib.makeStmt('declare', { name: 'a', type: 'Integer' }), ModelLib.makeStmt('output', { expression: 'a + 1' })]; FlowLab.render(); });
await page.click('#runBtn'); await wait(400);
ok('errore: ' + await out(), /The variable "a" has no value yet/.test(await out()));

// 5. shortcuts of the blocks from the language file: W adds a While in English
await page.evaluate(() => FlowLab.loadExample('grade_average')); await wait(200);
await page.locator('#chart .shape[data-kind=declare]').first().click(); await wait(60);
await page.keyboard.press('w'); await wait(200);
ok('W: ' + await page.locator('.modal h2').textContent(), /While/.test(await page.locator('.modal h2').textContent()));
await page.keyboard.press('Escape'); await wait(80);
// generated code: comments and pseudocode in English
await page.evaluate(() => FlowLab.setTab('code')); await page.selectOption('#langSel', 'pseudo'); await wait(200);
const pseudo = await page.locator('#codeOut').innerText();
ok('pseudocode: ' + pseudo.split('\n').slice(0, 3).join(' / '), /ALGORITHM/.test(pseudo) && /FOR i FROM 1 TO n DO/.test(pseudo) && !/ALGORITMO|PER /.test(pseudo));
// 6. File menu: the language item opens the list of the languages; back to Italian
await page.click('#fileBtn'); await wait(120);
const item = page.locator('.ctxmenu button:has-text("Language")');
ok('menu item: ' + await item.textContent(), (await item.count()) === 1 && /Language: English/.test(await item.textContent()));
ok('tasti: ' + (await page.locator('.ctxmenu kbd').allTextContents()).filter((k) => /Shift|Maiusc/.test(k)).join(' '), (await page.locator('.ctxmenu kbd').allTextContents()).some((k) => /Shift/.test(k)) && !(await page.locator('.ctxmenu kbd').allTextContents()).some((k) => /Maiusc/.test(k)));
await item.click(); await wait(200);
const langs = await page.locator('.langitem b').allTextContents();
ok('languages: ' + langs.join(', '), langs.includes('English') && langs.includes('Italiano'));
const it = page.locator('.langitem:has-text("Italiano")');
const before = await page.evaluate(() => JSON.stringify(FlowLab.state.prog.functions[0].body.map((b) => b.kind)));
const missing = await page.evaluate(() => [...I18n.missing]);
ok('frasi senza traduzione: ' + missing.length + ' ' + JSON.stringify(missing.slice(0, 10)), missing.length === 0);
await page.screenshot({ path: 'test/lang_en.png' });
await Promise.all([page.waitForNavigation(), it.click()]); await page.waitForFunction(() => typeof FlowLab !== "undefined" && FlowLab.state, null, { timeout: 5000 }).catch(() => console.log("ERR after reload", errs)); await wait(200);
ok('dopo il cambio: ' + await page.evaluate(() => I18n.lang) + ', ' + (await page.locator('#runBtn').innerText()), (await page.evaluate(() => I18n.lang)) === 'it' && (await page.locator('#runBtn').innerText()).includes('Esegui'));
const after = await page.evaluate(() => JSON.stringify(FlowLab.state.prog.functions[0].body.map((b) => b.kind)));
ok('il programma resta: ' + after, after === before);
console.log('ERR', errs);
await browser.close();
