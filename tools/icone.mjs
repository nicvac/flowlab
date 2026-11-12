// Icone dell'app (PWA): src/pwa/icona.svg -> src/pwa/icona-192.png, icona-512.png
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
const svg = fs.readFileSync('src/pwa/icona.svg', 'utf8');
const browser = await chromium.launch();
for (const n of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: n, height: n } });
  await page.setContent(`<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${n}" height="${n}" `)}</body></html>`);
  await page.screenshot({ path: `src/pwa/icona-${n}.png`, omitBackground: false });
  await page.close();
}
await browser.close();
