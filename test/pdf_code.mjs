// Pagine del codice nel PDF: A4 orizzontale, colorato come nella scheda Codice
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
const browser = await chromium.launch();
const page = await browser.newPage({ acceptDownloads: true });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
fs.mkdirSync('test/out', { recursive: true });
for (const [ex, lang] of [['forme', 'java'], ['bolle', 'python'], ['lista', 'cpp']]) {
  await page.evaluate(([ex, lang]) => { window.showSaveFilePicker = undefined; FlowLab.loadExample(ex); FlowLab.state.lang = lang; }, [ex, lang]);
  const dl = page.waitForEvent('download', { timeout: 30000 });
  await page.click('#fileBtn'); await page.click('#pop button:has-text("Esporta tutto il progetto in PDF")');
  await (await dl).saveAs(`test/out/code_${ex}_${lang}.pdf`);
  console.log(ex, lang, 'ok');
}
console.log('ERR', errs);
await browser.close();
