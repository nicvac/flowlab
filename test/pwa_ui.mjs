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
  // app installata: un file .fprg aperto dal sistema arriva con launchQueue e Ctrl+S lo salva lì
  const p3 = await ctx.newPage();
  const xml = await page.evaluate(() => { FlowLab.loadExample('fattoriale'); const x = FlowLab.serialize(); FlowLab.loadExample('media'); return x; });
  await p3.addInitScript((x) => {
    window.__written = null;
    const fh = { name: 'Fattoriale.fprg', getFile: async () => new File([x], 'Fattoriale.fprg'), queryPermission: async () => 'granted', requestPermission: async () => 'granted',
      createWritable: async () => { let buf = ''; return { write: async (t) => { buf += t; }, close: async () => { window.__written = buf; } }; } };
    Object.defineProperty(window, 'launchQueue', { configurable: true, value: { setConsumer: (cb) => setTimeout(() => cb({ files: [fh] }), 50) } });
  }, xml);
  await p3.goto('http://localhost:8766/FlowLab.html'); await p3.waitForTimeout(800);
  ok('file aperto dal sistema: ' + await p3.locator('#progName').textContent(), /Fattoriale/i.test(await p3.locator('#progName').textContent()));
  await p3.click('#chart'); await p3.keyboard.press('Control+s'); await p3.waitForTimeout(400);
  const wr = await p3.evaluate(() => window.__written || ''); ok('Ctrl+S lo salva nello stesso file: ' + wr.length + ' caratteri, toast ' + await p3.locator('.toast').last().textContent(), wr.includes('Fattoriale'));
  const mf = await (await page.request.get('http://localhost:8766/manifest.webmanifest')).json();
  ok('manifest: apre i .fprg', mf.file_handlers[0].accept['application/x-fprg'][0] === '.fprg');
  // copia scaricata (file://): la voce spiega dove installare
  const p2 = await ctx.newPage();
  await p2.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await p2.waitForTimeout(300);
  await p2.click('#fileBtn'); await p2.waitForTimeout(100); await p2.click('.ctxmenu button.install'); await p2.waitForTimeout(150);
  ok('copia scaricata: ' + (await p2.locator('.modal .confirm').textContent()).slice(0, 70), /versione online/.test(await p2.locator('.modal .confirm').textContent()));
} finally {
  console.log('ERR', errs);
  await browser.close(); srv.kill();
}
