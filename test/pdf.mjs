// Esportazione di tutto il progetto in PDF
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 820 }, acceptDownloads: true });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
fs.mkdirSync('test/out', { recursive: true });
for (const [ex, lang] of [[process.argv[2] || 'forme', 'java'], ['bolle', 'python']]) {
  await page.evaluate(([ex, lang]) => { localStorage.clear(); window.showSaveFilePicker = undefined; FlowLab.loadExample(ex); FlowLab.state.lang = lang; window.__lastPdf = null; }, [ex, lang]);
  await page.waitForTimeout(200);
  const dl = page.waitForEvent('download', { timeout: 20000 });
  await page.click('#fileBtn'); await page.click('#pop button:has-text("Esporta tutto il progetto in PDF")');
  const d = await dl;
  const file = `test/out/${ex}.pdf`;
  await d.saveAs(file);
  console.log(ex, '→', d.suggestedFilename(), fs.statSync(file).size, 'byte');
}
console.log('ERR', errs);
await browser.close();
