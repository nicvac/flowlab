// Scorciatoie da tastiera: blocchi, funzioni, diagramma delle classi, vista, file
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.clear(); window.showSaveFilePicker = undefined; const s = document.querySelector('#speed'); s.value = 0; s.dispatchEvent(new Event('input')); });
const wait = (ms = 120) => page.waitForTimeout(ms);
const key = async (k) => { await page.keyboard.press(k); await wait(); };
const title = () => page.locator('.modal h2').textContent().catch(() => null);
const cancel = async () => { await page.keyboard.press('Escape'); await wait(80); };
const kinds = () => page.evaluate(() => FlowLab.state.prog.functions[FlowLab.state.fi].body.map((s) => s.kind).join(','));
const ok = (name, cond) => console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);

// programma nuovo: i tasti aggiungono i blocchi in fondo
await page.evaluate(() => FlowLab.loadExample('tabellina')); await wait(200);
await page.evaluate(() => { FlowLab.state.prog.functions[0].body = []; FlowLab.state.sel = null; FlowLab.render(); });
await page.locator('#chart').click({ position: { x: 5, y: 5 } }); await wait(60);
await key('d'); ok('D apre Dichiara', (await title()) === 'Nuovo blocco: Dichiarazione');
await page.fill('#f_name', 'x'); await page.keyboard.press('Enter'); await wait();
await key('a'); await page.fill('#f_variable', 'x'); await page.fill('#f_expression', '5'); await page.keyboard.press('Enter'); await wait();
await key('o'); await page.fill('#f_expression', 'x * 2'); await page.keyboard.press('Enter'); await wait();
ok('D, A, O aggiungono in ordine: ' + await kinds(), (await kinds()) === 'declare,assign,output');
// con un blocco selezionato il nuovo blocco va dopo di lui
await page.evaluate(() => { FlowLab.state.sel = FlowLab.state.prog.functions[0].body[0].id; FlowLab.render(); });
await key('/'); await page.fill('.modal textarea', 'nota'); await page.click('.modal footer .btn.primary'); await wait();
ok('/ aggiunge un commento dopo il blocco selezionato: ' + await kinds(), (await kinds()) === 'declare,comment,assign,output');
await key('Shift+a'); ok('Maiusc+A apre «Apri file»', (await title()) === 'Nuovo blocco: Apri file'); await cancel();
await key('s'); ok('S apre Se', (await title()) === 'Nuovo blocco: Se'); await cancel();
// Alt+↓ sposta il blocco selezionato
await key('Alt+ArrowDown'); ok('Alt+↓ sposta: ' + await kinds(), (await kinds()) === 'declare,assign,comment,output');
await key('Alt+ArrowUp'); ok('Alt+↑ lo riporta: ' + await kinds(), (await kinds()) === 'declare,comment,assign,output');
// menu «Aggiungi un blocco» aperto: la lettera sceglie il blocco
await page.click('#chart .ins >> nth=0'); await wait(80);
ok('il menu mostra i tasti', (await page.locator('#pop .ikey').count()) === 16);
await key('i'); ok('I nel menu apre Input', (await title()) === 'Nuovo blocco: Input'); await cancel();
// esecuzione F5
await key('F5'); await wait(300);
ok('F5 esegue: ' + (await page.innerText('#conOut')).split('\n').filter((l) => /^\d/.test(l)).join(' '), (await page.innerText('#conOut')).includes('10'));
// menu contestuale del blocco con i tasti
await page.locator('#chart .shape[data-kind=assign]').click({ button: 'right' }); await wait(80);
ok('menu del blocco: ' + (await page.locator('#pop kbd').allTextContents()).join(' '), (await page.locator('#pop kbd').allTextContents()).includes('Alt+↑'));
await cancel();

// funzioni: N, F2, Pag↓
await key('n'); ok('N: nuova funzione', (await title()) === 'Nuova funzione'); await cancel();
await page.evaluate(() => FlowLab.loadExample('fattoriale')); await wait(200);
await key('PageDown'); ok('Pag↓: diagramma successivo', (await page.evaluate(() => FlowLab.state.fi)) === 1);
await key('F2'); ok('F2: modifica la funzione', /Modifica/.test(await title())); await cancel();
await key('PageUp'); ok('Pag↑: torna a Inizio', (await page.evaluate(() => FlowLab.state.fi)) === 0);

// diagramma delle classi
await page.evaluate(() => { FlowLab.loadExample('forme'); FlowLab.showUml(); }); await wait(200);
await key('a'); ok('A senza classe selezionata: avviso', (await page.locator('.toast').textContent()).includes('Seleziona'));
await page.locator('.ubox:has(.uname:text-is("Cerchio")) .uhit.head').click(); await wait(80);
await key('a'); ok('A: nuovo attributo', /attributo/i.test(await title())); await cancel();
await key('m'); ok('M: nuovo metodo', (await title()) === 'Nuovo metodo in Cerchio'); await cancel();
await key('c'); ok('C: nuovo costruttore', (await title()) === 'Nuovo costruttore di Cerchio'); await cancel();
await key('n'); ok('N: nuova classe', (await title()) === 'Nuova classe'); await cancel();
await page.locator('.ubox:has(.uname:text-is("Cerchio")) .uhit.head').click({ button: 'right' }); await wait(80);
ok('menu della classe: ' + (await page.locator('#pop kbd').allTextContents()).join(' '), (await page.locator('#pop kbd').allTextContents()).join(' ') === 'A M C Invio Canc');
await cancel();
await page.locator('.ubox:has(.uname:text-is("Cerchio")) .urow.method', { hasText: 'area' }).click(); await wait(60);
await key('Enter'); ok('Invio su un metodo: apre il diagramma', (await page.evaluate(() => FlowLab.state.uml)) === false);
await key('u'); ok('U: torna al diagramma delle classi', (await page.evaluate(() => FlowLab.state.uml)) === true);

// vista e schede
await page.evaluate(() => FlowLab.loadExample('tabellina')); await wait(200);
await key('Control+Alt+o'); ok('Ctrl+Alt+O: vista Oggetti', (await page.evaluate(() => FlowLab.state.view)) === 'objects');
await key('Control+Alt+f'); ok('Ctrl+Alt+F: vista Funzioni', (await page.evaluate(() => FlowLab.state.view)) === 'functions');
await key('Alt+3'); ok('Alt+3: scheda Codice', (await page.locator('.tabw:has([aria-selected=true])').getAttribute('data-tab')) === 'code');
await key('Control+0'); await key('Control+='); ok('Ctrl+0 e Ctrl++: zoom ' + await page.evaluate(() => FlowLab.state.zoom), (await page.evaluate(() => FlowLab.state.zoom)) === 1.15);
await key('Control+0');
await key('F1'); ok('F1: guida', (await title()) === 'Guida rapida');
ok('guida: gruppi ' + (await page.locator('.modal tr.kgroup').count()), (await page.locator('.modal tr.kgroup').count()) === 6);
await cancel();
// file
const dl = page.waitForEvent('download', { timeout: 15000 });
await key('Control+Shift+s'); ok('Ctrl+Maiusc+S: scarica il codice ' + (await dl).suggestedFilename(), true);
await page.click('#fileBtn'); await wait(80);
ok('menu File: ' + (await page.locator('#pop kbd').count()) + ' tasti', (await page.locator('#pop kbd').count()) === 11);
await cancel();
console.log('ERR', errs);
await browser.close();
