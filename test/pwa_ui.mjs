// Installazione come app (PWA): manifest, service worker, voce del menu File, funzionamento senza rete
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const srv = spawn('python3', ['-m', 'http.server', '8766'], { cwd: 'dist', stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
const ok = (name, cond) => console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
try {
  await page.goto('http://localhost:8766/FlowLab.html'); await page.waitForTimeout(1500);
  const st = await page.evaluate(async () => ({ manifest: document.querySelector('link[rel=manifest]')?.getAttribute('href'), sw: !!(await navigator.serviceWorker.getRegistration()) }));
  ok('manifest e service worker: ' + JSON.stringify(st), st.manifest === 'manifest.webmanifest' && st.sw);
  const m = await (await page.request.get('http://localhost:8766/manifest.webmanifest')).json();
  ok(`manifest: ${m.name}, ${m.display}, ${m.icons.length} icone`, m.start_url === './FlowLab.html' && m.display === 'standalone' && m.icons.some((i) => i.sizes === '512x512'));
  await page.reload(); await page.waitForTimeout(800);
  ok('pagina servita dal service worker', await page.evaluate(() => !!navigator.serviceWorker.controller));
  // la proposta di Chrome si usa dal menu File
  await page.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = () => { window.__prompted = true; }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); dispatchEvent(e); });
  await page.click('#fileBtn'); await page.waitForTimeout(150);
  const item = page.locator('.ctxmenu button.install');
  ok('voce nel menu File, in evidenza: ' + await item.evaluate((b) => getComputedStyle(b).backgroundColor), (await item.count()) === 1 && (await item.evaluate((b) => getComputedStyle(b).backgroundColor)) !== 'rgba(0, 0, 0, 0)');
  await item.click(); await page.waitForTimeout(150);
  ok('dialogo di installazione di Chrome', await page.evaluate(() => !!window.__prompted));
  // senza rete la pagina si apre dalla copia salvata
  await ctx.setOffline(true);
  await page.reload(); await page.waitForTimeout(800);
  ok('senza rete: ' + await page.title(), (await page.locator('#runBtn').count()) === 1);
  await ctx.setOffline(false);
  // copia scaricata (file://): la voce spiega dove installare
  const p2 = await ctx.newPage();
  await p2.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await p2.waitForTimeout(300);
  await p2.click('#fileBtn'); await p2.waitForTimeout(100); await p2.click('.ctxmenu button.install'); await p2.waitForTimeout(150);
  ok('copia scaricata: ' + (await p2.locator('.modal .confirm').textContent()).slice(0, 70), /versione online/.test(await p2.locator('.modal .confirm').textContent()));
} finally {
  console.log('ERR', errs);
  await browser.close(); srv.kill();
}
