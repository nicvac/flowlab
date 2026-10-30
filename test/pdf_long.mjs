// PDF a modulo continuo: ogni diagramma su una pagina larga come un A4 e alta quanto serve
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 820 }, acceptDownloads: true });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
fs.mkdirSync('test/out', { recursive: true });
const files = process.argv.slice(2);
for (const f of files) {
  const txt = fs.readFileSync(f, 'utf8');
  await page.evaluate((t) => { localStorage.clear(); window.showSaveFilePicker = undefined; FlowLab.loadText(t, 'x.fprg'); }, txt);
  await page.waitForTimeout(200);
  const dl = page.waitForEvent('download', { timeout: 30000 });
  await page.click('#fileBtn'); await page.click('#pop button:has-text("Esporta tutto il progetto in PDF")');
  const out = 'test/out/' + f.split('/').pop().replace('.fprg', '.pdf');
  await (await dl).saveAs(out);
  console.log(out, fs.statSync(out).size, 'byte');
}
console.log('ERR', errs);
await browser.close();
