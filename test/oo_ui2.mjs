// Vista Oggetti: ridenominazione, eliminazioni, tastiera, salvataggio e riapertura
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 820 } });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.clear(); const s = document.querySelector('#speed'); s.value = 0; s.dispatchEvent(new Event('input')); });
const wait = (ms = 120) => page.waitForTimeout(ms);
const out = async () => (await page.innerText('#conOut')).split('\n').slice(1, -1).join(' | ');
const head = (name) => page.locator(`.ubox:has(.uname:text-is("${name}")) .uhit.head`);

await page.evaluate(() => FlowLab.loadExample('forme')); await wait(250);
await page.click('#runBtn'); await wait(300);
const before = await out();
await page.evaluate(() => FlowLab.showUml()); await wait(100);

// rinomina Forma → Figura: tipi, classe madre, new e accessi statici si aggiornano
await head('Forma').dblclick(); await wait(100);
await page.fill('#f_cname', 'Figura'); await page.press('#f_cname', 'Enter'); await wait(150);
const xml = await page.evaluate(() => FlowLab.serialize());
console.log('rinomina: Forma rimasto nel file?', /"Forma"|Forma\(|extends Forma/.test(xml), '· padri:', await page.evaluate(() => FlowLab.state.prog.classes.map((c) => c.name + '<' + (c.parent || '-')).join(' ')));
await page.click('#runBtn'); await wait(300);
console.log('stesso output dopo la rinomina:', (await out()) === before);
await page.evaluate(() => FlowLab.showUml()); await wait(100);

// eliminazioni bloccate
await head('Figura').click(); await wait(60);
await page.keyboard.press('Delete'); await wait(100);
console.log('classe con sottoclassi:', await page.locator('.modal .confirm').textContent());
await page.click('.modal footer .btn.primary'); await wait(60);
await head('FormeGeometriche').click(); await page.click('#funcDel'); await wait(100);
console.log('classe principale:', await page.locator('.modal .confirm').textContent());
await page.click('.modal footer .btn.primary'); await wait(60);

// Canc su un attributo, poi annulla
await page.locator('.ubox:has(.uname:text-is("Cerchio")) .urow[data-kind=attr]').click(); await wait(60);
await page.keyboard.press('Delete'); await wait(100);
console.log('attributi di Cerchio dopo Canc:', await page.evaluate(() => FlowLab.state.prog.classes.find((c) => c.name === 'Cerchio').attributes.length));
await page.keyboard.press('Control+z'); await wait(100);
console.log('dopo Ctrl+Z:', await page.evaluate(() => FlowLab.state.prog.classes.find((c) => c.name === 'Cerchio').attributes.map((a) => a.name).join(',')));

// eliminare una classe senza sottoclassi (Quadrato) e annullare
await head('Quadrato').click({ button: 'right' }); await wait(60);
await page.click('#pop button:has-text("Elimina la classe")'); await wait(80);
await page.click('.modal footer .btn.primary'); await wait(120);
console.log('classi dopo eliminazione:', await page.locator('.uname').allTextContents());
await page.keyboard.press('Control+z'); await wait(100);
console.log('dopo annulla:', await page.locator('.uname').count(), 'classi');

// nuovo metodo dalla vista del metodo: si apre subito
await page.locator('.ubox:has(.uname:text-is("Cerchio")) .urow.method', { hasText: 'area' }).dblclick(); await wait(120);
await page.click('#funcAdd'); await wait(80);
console.log('titolo:', await page.locator('.modal h2').textContent());
await page.fill('#f_fname', 'diametro');
await page.click('.modal button:has-text("Aggiungi valore restituito")'); await page.fill('.modal .rrow input', 'd');
await page.selectOption('.modal .rrow select', 'Real');
await page.click('.modal footer .btn.primary'); await wait(120);
console.log('aperto:', await page.innerText('#crumbWhere'), '· blocchi:', await page.locator('#chart .shape').count());
// stesso nome e stessi parametri: rifiutato
await page.click('#funcAdd'); await wait(80);
await page.fill('#f_fname', 'area');
await page.click('.modal button:has-text("Aggiungi valore restituito")'); await page.fill('.modal .rrow input', 'a'); await page.selectOption('.modal .rrow select', 'Integer');
await page.click('.modal footer .btn.primary'); await wait(80);
console.log('errore:', await page.locator('.modal .formerr').textContent());
await page.click('.modal footer .btn:not(.primary)'); await wait(60);

// salvataggio esteso e riapertura
const ext = await page.evaluate(() => ModelLib.extendedFeatures(FlowLab.state.prog));
const x2 = await page.evaluate(() => FlowLab.serialize());
await page.evaluate(() => { FlowLab.setView('functions'); }); await wait(80);
console.log('vista funzioni rifiutata:', await page.locator('.modal').count() === 1);
await page.click('.modal footer .btn.primary'); await wait(60);
await page.evaluate((x) => FlowLab.loadText(x, 'prova.fprg'), x2); await wait(200);
console.log('formato:', ext.join(', '), '· riaperto in vista', await page.evaluate(() => FlowLab.state.view), '· classi', await page.locator('.uname').count());
await page.click('#runBtn'); await wait(300);
console.log('esecuzione dopo riapertura uguale:', (await out()) === before);

// proprietà del programma: la classe predefinita segue il nome
await page.evaluate(() => FlowLab.loadExample('tabellina')); await wait(100);
await page.click('#viewOo'); await wait(100);
await page.click('#progName'); await wait(80);
await page.fill('#f_pname', 'Tabelline della scuola'); await page.press('#f_pname', 'Enter'); await wait(120);
console.log('classe:', await page.locator('.uname').allTextContents(), '· file standard:', await page.evaluate(() => !/flowlab-classes/.test(FlowLab.serialize())));
await page.click('#helpBtn'); await wait(100);
console.log('guida con gli oggetti:', await page.locator('.modal h3').allTextContents());
console.log('ERR', errs);
await browser.close();
