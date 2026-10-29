// All'apertura: vista Funzioni sul Main (vista Oggetti solo se serve, comunque sul Main)
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 820 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
const base = 'file://' + process.cwd() + '/dist/FlowLab.html';
const where = () => page.evaluate(() => `${FlowLab.state.view} · ${FlowLab.state.uml ? 'diagramma delle classi' : 'diagramma di ' + (FlowLab.state.fi === 0 ? 'Main' : FlowLab.state.prog.functions[FlowLab.state.fi].name)}`);
await page.goto(base); await page.waitForTimeout(300);
// programma a funzioni lasciato su un'altra funzione in vista Oggetti
await page.evaluate(() => { FlowLab.loadExample('fattoriale'); FlowLab.setView('objects'); FlowLab.showFunc(1); });
await page.waitForTimeout(300);
console.log('prima di ricaricare:', await where());
await page.reload(); await page.waitForTimeout(400);
console.log('dopo:', await where());
// programma con più classi
await page.evaluate(() => FlowLab.loadExample('forme')); await page.waitForTimeout(300);
console.log('prima di ricaricare:', await where());
await page.reload(); await page.waitForTimeout(400);
console.log('dopo:', await where());
// apertura da indirizzo
const { spawn } = await import('child_process');
const srv = spawn('python3', ['-m', 'http.server', '8766', '--bind', '127.0.0.1'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
for (const ex of ['animali', 'fattoriale']) { await page.goto(`http://127.0.0.1:8766/dist/FlowLab.html?url=../esempi/${ex}.fprg`); await page.waitForTimeout(700); console.log(`?url=${ex}:`, await where()); }
srv.kill();
// dagli esempi
for (const ex of ['forme', 'fattoriale', 'animali', 'media']) { await page.evaluate((e) => { FlowLab.state.dirty = false; FlowLab.loadExample(e); }, ex); await page.waitForTimeout(150); console.log(`esempio ${ex}:`, await where()); }
console.log('ERR', errs);
await browser.close();
