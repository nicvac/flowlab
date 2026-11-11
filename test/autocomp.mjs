// Autocompletamento dopo il punto: metodi e attributi dell'oggetto o della classe
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
const wait = (ms = 120) => page.waitForTimeout(ms);
const ok = (n, c) => console.log(`${c ? 'ok  ' : 'FAIL'} ${n}`);
const items = () => page.locator('#acPop .aclabel').allTextContents();
await page.evaluate(() => { localStorage.clear(); FlowLab.loadExample('forme'); FlowLab.showFunc(0); }); await wait(200);
// Main: d è un Disegno
await page.locator('#chart .ins').last().click(); await wait(80); await page.click('#pop .insbtn[title="Output"]'); await wait(150);
await page.locator('#f_expression').pressSequentially('d.', { delay: 20 }); await wait(150);
ok('d. → ' + (await items()).join(' | '), (await items()).some((x) => /^areaTotale\(\): Reale/.test(x)) && !(await items()).some((x) => /^forme/.test(x)));
ok('intestazione: ' + await page.locator('#acPop .achead').textContent(), /Membri di Disegno/.test(await page.locator('#acPop .achead').textContent()));
await page.keyboard.type('ar'); await wait(100);
ok('filtrato con "ar": ' + (await items()).join(' | '), (await items()).length === 1);
await page.keyboard.press('Enter'); await wait(100);
ok('inserito: ' + await page.inputValue('#f_expression'), (await page.inputValue('#f_expression')) === 'd.areaTotale()' && (await page.locator('.modal').count()) === 1);
await page.keyboard.press('Escape'); await wait(100);
// dentro Cerchio.area: this. vede anche i privati e i protetti ereditati
const ai = await page.evaluate(() => FlowLab.state.prog.functions.findIndex((f) => f.name === 'area' && ModelLib.classOf(FlowLab.state.prog, f).name === 'Cerchio'));
await page.evaluate((i) => FlowLab.showFunc(i), ai); await wait(150);
await page.locator('#chart .ins').first().click(); await wait(80); await page.click('#pop .insbtn[title="Assegna"]'); await wait(150);
await page.locator('#f_expression').pressSequentially('this.', { delay: 20 }); await wait(150);
const t = await items();
ok('this. in Cerchio: ' + t.join(' | '), t.some((x) => /^raggio/.test(x)) && t.some((x) => /^nome/.test(x)));
ok('ereditati segnati: ' + (await page.locator('#acPop .acowner').allTextContents()).join(', '), (await page.locator('#acPop .acowner').count()) > 0);
await page.keyboard.press('ArrowDown'); await page.keyboard.press('Tab'); await wait(100);
ok('scelto con freccia e Tab: ' + await page.inputValue('#f_expression'), /^this\.\w+/.test(await page.inputValue('#f_expression')));
await page.keyboard.press('Escape'); await wait(80); await page.keyboard.press('Escape'); await wait(80);
// classe generica: ArrayList<Intero> -> add(x: Intero)
await page.evaluate(() => {
  const M = ModelLib, p = FlowLab.state.prog;
  const lib = ModuleLibrary.find((m) => m.id === 'ArrayList');
  return lib;
});
await page.keyboard.press('Control+i'); await wait(150);
await page.evaluate(() => document.querySelectorAll('.modal details').forEach((d) => { d.open = true; })); await wait(100);
await page.waitForFunction(() => ![...document.querySelectorAll('.modsrc')].some((d) => /Caricamento/.test(d.innerText)), null, { timeout: 30000 });
await page.evaluate(() => document.querySelectorAll('.modal details').forEach((d) => { d.open = true; })); await wait(100);
await page.locator('.modsrc .modrow', { hasText: 'ArrayList' }).first().locator('button').click(); await wait(250);
await page.evaluate(() => { const M = ModelLib, p = FlowLab.state.prog; p.functions[0].body.unshift(M.makeStmt('declare', { name: 'lista', type: 'ArrayList<Integer>' })); FlowLab.showFunc(0); });
await wait(150);
await page.locator('#chart .ins').last().click(); await wait(80); await page.click('#pop .insbtn[title="Chiama"]'); await wait(150);
await page.locator('#f_expression').pressSequentially('lista.a', { delay: 20 }); await wait(150);
ok('lista.a → ' + (await items()).join(' | '), (await items()).includes('add(x: Intero)') && (await items()).includes('add(i: Intero, x: Intero)'));
ok('i privati del modulo non compaiono', !(await items()).some((x) => /cresci|elementi/.test(x)));
await page.keyboard.press('Escape'); await wait(80);
ok('Esc chiude solo l\'elenco', (await page.locator('.modal').count()) === 1 && await page.locator('#acPop').isHidden());
await page.keyboard.press('Escape'); await wait(80);
// statici: NomeClasse.
await page.locator('#chart .ins').last().click(); await wait(80); await page.click('#pop .insbtn[title="Output"]'); await wait(150);
await page.evaluate(() => { const c = FlowLab.state.prog.classes.find((x) => x.name === 'Disegno'); c.attributes.push(ModelLib.makeAttribute({ name: 'creati', type: 'Integer', static: true, visibility: 'public' })); });
await page.locator('#f_expression').pressSequentially('Disegno.', { delay: 20 }); await wait(150);
ok('Disegno. → ' + (await items()).join(' | ') + ' · ' + await page.locator('#acPop .achead').textContent(), (await items()).join() === 'creati: Intero');
console.log('ERR', errs);
await browser.close();
