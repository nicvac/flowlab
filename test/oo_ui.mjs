// Vista Oggetti nel browser: diagramma delle classi, metodi, cambio vista, dialoghi, variabili
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const url = 'file://' + process.cwd() + '/dist/FlowLab.html';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
await page.goto(url); await page.waitForTimeout(400);
await page.evaluate(() => { localStorage.clear(); const s = document.querySelector('#speed'); s.value = 0; s.dispatchEvent(new Event('input')); });
const say = (...a) => console.log(...a);
const wait = (ms = 120) => page.waitForTimeout(ms);

// 1. esempio con ereditarietà: si apre il diagramma delle classi
await page.evaluate(() => FlowLab.loadExample('forme')); await wait(300);
say('vista:', await page.evaluate(() => FlowLab.state.view), '· uml:', await page.evaluate(() => FlowLab.state.uml));
say('classi nel diagramma:', await page.locator('#chart svg.uml .ubox').count(), '· relazioni:', await page.locator('#chart .urel').count(), '· etichette:', await page.locator('#chart .ulab').allTextContents());
await page.screenshot({ path: 'test/oo1_uml.png' });

// 2. esecuzione
await page.click('#runBtn'); await wait(400);
say('output:', (await page.innerText('#conOut')).split('\n').slice(1, -1).join(' | '));

// 3. doppio clic su un metodo: si apre il suo diagramma di flusso
const area = page.locator('.ubox:has(.uname:text-is("Cerchio")) .urow.method', { hasText: 'area' });
await area.dblclick(); await wait(200);
say('dopo doppio clic: uml =', await page.evaluate(() => FlowLab.state.uml), '· barra:', await page.innerText('#crumbBar'), '· inizio:', await page.locator('#chart .shape[data-id^="start:"] text').first().textContent());
await page.screenshot({ path: 'test/oo2_method.png' });
await page.click('#backUml'); await wait(150);
say('ritorno al diagramma:', await page.evaluate(() => FlowLab.state.uml));

// 4. vista funzioni non disponibile con più classi
await page.click('#viewFn'); await wait(150);
say('messaggio:', await page.locator('.modal .confirm').textContent());
await page.screenshot({ path: 'test/oo3_noview.png' });
await page.click('.modal footer .btn.primary'); await wait(80);

// 5. programma a funzioni → Oggetti → Funzioni: stesso file standard
await page.evaluate(() => FlowLab.loadExample('fattoriale')); await wait(200);
await page.evaluate(() => { FlowLab.setView('functions'); }); await wait(100);
const before = await page.evaluate(() => FlowLab.serialize().replace(/(saved|edited|created)" value="[^"]*"/g, ''));
await page.click('#viewOo'); await wait(200);
say('classe predefinita:', await page.locator('.uname').allTextContents(), '· metodi:', await page.locator('.urow.method .umem').allTextContents());
const inOO = await page.evaluate(() => FlowLab.serialize().replace(/(saved|edited|created)" value="[^"]*"/g, ''));
await page.click('#viewFn'); await wait(200);
const after = await page.evaluate(() => FlowLab.serialize().replace(/(saved|edited|created)" value="[^"]*"/g, ''));
say('file standard invariato in vista Oggetti:', before === inOO, '· dopo il ritorno:', before === after, '· vista:', await page.evaluate(() => FlowLab.state.view));

// 6. costruire una classe con i dialoghi
await page.click('#viewOo'); await wait(150);
await page.evaluate(() => { FlowLab.state.prog.functions[0].body = []; FlowLab.render(); });
await page.click('#funcAdd'); await wait(100);
await page.fill('#f_cname', 'Punto'); await page.press('#f_cname', 'Enter'); await wait(150);
const punto = page.locator('.ubox:has(.uname:text-is("Punto"))');
say('nuova classe:', await punto.count());
await punto.locator('.uhit.head').click({ button: 'right' }); await wait(80);
await page.click('#pop button:has-text("Nuovo attributo")'); await wait(80);
await page.fill('#f_aname', 'x'); await page.press('#f_aname', 'Enter'); await wait(120);
await punto.locator('.uhit.head').click({ button: 'right' }); await wait(80);
await page.click('#pop button:has-text("Nuovo costruttore")'); await wait(80);
await page.click('.modal button:has-text("Aggiungi parametro")'); await page.fill('.modal .prow input', 'v');
await page.click('.modal footer .btn.primary'); await wait(120);
await punto.locator('.uhit.head').click({ button: 'right' }); await wait(80);
await page.click('#pop button:has-text("Nuovo metodo")'); await wait(80);
await page.fill('#f_fname', 'getX');
await page.click('.modal button:has-text("Aggiungi valore restituito")'); await page.fill('.modal .rrow input', 'r');
await page.click('.modal footer .btn.primary'); await wait(120);
say('membri di Punto:', await punto.locator('.umem').allTextContents());
// il costruttore: x ← v
await punto.locator('.urow.ctor').dblclick(); await wait(150);
await page.click('#chart .ins >> nth=0'); await wait(80);
await page.click('#pop .insbtn[title="Assegna"]'); await wait(80);
await page.fill('#f_variable', 'x'); await page.fill('#f_expression', 'v'); await page.press('#f_expression', 'Enter'); await wait(100);
// getX: r ← x
await page.selectOption('#funcSel', { label: 'getX()' }); await wait(120);
await page.click('#chart .ins >> nth=1'); await wait(80);
await page.click('#pop .insbtn[title="Assegna"]'); await wait(80);
await page.fill('#f_variable', 'r'); await page.fill('#f_expression', 'x * 10'); await page.press('#f_expression', 'Enter'); await wait(100);
// Main: p: Punto; p ← new Punto(4); output p.getX()
await page.selectOption('#funcSel', { label: 'Inizio (principale)' }); await wait(120);
const addAt = async (kind, fill) => {
  const n = await page.locator('#chart .ins').count();
  await page.click(`#chart .ins >> nth=${n - 1}`); await wait(60);
  await page.click(`#pop .insbtn[title="${kind}"]`); await wait(60);
  for (const [k, v] of Object.entries(fill)) { if (k === 'type') await page.selectOption('#f_type', v); else await page.fill('#f_' + k, v); }
  await page.click('.modal footer .btn.primary'); await wait(100);
};
await addAt('Dichiara', { name: 'p', type: 'Punto' });
await addAt('Assegna', { variable: 'p', expression: 'new Punto(4)' });
await addAt('Output', { expression: '"p.getX() = " & p.getX()' });
await page.click('#runBtn'); await wait(400);
say('esecuzione della classe costruita a mano:', (await page.innerText('#conOut')).split('\n').slice(-2, -1)[0]);
// accesso privato da fuori
await addAt('Output', { expression: 'p.x' });
await page.click('#runBtn'); await wait(400);
say('errore atteso:', (await page.innerText('#conOut')).split('\n').filter((l) => l.startsWith('✖'))[0]);
await page.click('#viewOo'); await wait(100);
await page.screenshot({ path: 'test/oo4_built.png' });

// 7. trascinare una classe
const b = await punto.locator('.uhit.head').boundingBox();
const x0 = await page.evaluate(() => FlowLab.state.prog.classes.find((c) => c.name === 'Punto').x);
await page.mouse.move(b.x + 5, b.y + 5); await page.mouse.down(); await page.mouse.move(b.x + 80, b.y + 60, { steps: 6 }); await page.mouse.up(); await wait(100);
say('spostamento classe:', x0, '→', await page.evaluate(() => FlowLab.state.prog.classes.find((c) => c.name === 'Punto').x));
await page.keyboard.press('Control+z'); await wait(100);
say('annulla spostamento:', await page.evaluate(() => FlowLab.state.prog.classes.find((c) => c.name === 'Punto').x));
say('formato esteso:', await page.evaluate(() => /flowlab-classes/.test(FlowLab.serialize())));

// 8. variabili con oggetti: passo dopo passo nella lista collegata
await page.evaluate(() => FlowLab.loadExample('lista')); await wait(200);
await page.evaluate(() => FlowLab.setTab('vars'));
for (let i = 0; i < 30; i++) { await page.click('#stepBtn'); await wait(15); }
say('in esecuzione:', await page.evaluate(() => FlowLab.run.state), '· metodo:', await page.innerText('#crumbWhere').catch(() => ''));
say('righe variabili:', (await page.locator('#varsBody tbody tr').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ')).join(' / '));
// apre gli oggetti
for (let k = 0; k < 3; k++) { const c = page.locator('#varsBody tr.objrow .caret:not(.open)').first(); if (await c.count()) { await c.click(); await wait(60); } }
say('dopo aver aperto:', (await page.locator('#varsBody tbody tr').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ')).join(' / '));
await page.screenshot({ path: 'test/oo5_vars.png' });

// 9. tema scuro del diagramma
await page.evaluate(() => FlowLab.loadExample('forme')); await wait(150);
await page.click('#themeBtn'); await wait(150);
await page.screenshot({ path: 'test/oo6_dark.png' });
await page.click('#themeBtn');

// 10. codice generato dalla vista Oggetti
await page.evaluate(() => FlowLab.setTab('code'));
await page.selectOption('#langSel', 'java'); await wait(200);
say('java:', (await page.locator('#codeOut').innerText()).split('\n').filter((l) => /class /.test(l)).join(' | '));
say('ERRORI', errs);
await browser.close();
