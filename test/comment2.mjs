import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1300, height: 800 } });
const errs=[]; page.on('pageerror', e => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(400);
const texts = ['Primo prodotto', 'Ok', 'Secondo prodotto da leggere', 'Vincoli: nomeProdotto non vuoto, prezzoEuro positivo (si rifiutano i valori minori o uguali a zero), quantità intera', 'riga uno\nriga due', 'Unaparolalunghissimasenzaspaziunaparolalunghissimasenzaspaziunaparolalunghissimasenzaspaziunaparola'];
const res = await page.evaluate((texts) => {
  const xml = `<?xml version="1.0"?><flowgorithm fileversion="4.2"><attributes/><function name="Main" type="None" variable=""><parameters/><body>${texts.map(t => `<comment text="${t.replace(/\n/g,'&#10;')}"/>`).join('')}</body></function></flowgorithm>`;
  FlowLab.loadText(xml, 'c.fprg');
  return [...document.querySelectorAll('#chart .shape.comment')].map(g => {
    const t = g.querySelector('text').textContent; return { shown: t, truncated: t.endsWith('…'), toggle: !!g.querySelector('.ctoggle') };
  });
}, texts);
for (const [i, r] of res.entries()) console.log(JSON.stringify(texts[i].slice(0,30)), '→', JSON.stringify(r.shown.slice(0,40)), 'troncato', r.truncated, '+', r.toggle, r.truncated && !r.toggle ? '  <<< ERRORE' : '');
await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(300);
await page.evaluate(() => FlowLab.render());
const bad = await page.$$eval('#chart .shape.comment', gs => gs.filter(g => g.querySelector('text').textContent.endsWith('…') && !g.querySelector('.ctoggle')).length);
console.log('dopo caricamento font, troncati senza +:', bad, 'ERR', errs);
await page.screenshot({ path: 'test/c3.png', clip: { x: 0, y: 40, width: 880, height: 520 } });
await browser.close();
