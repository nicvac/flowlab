// Moduli nel diagramma delle classi: condensati ed espansi (pulsante, tasto sul riquadro, doppio clic, Maiusc+M)
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
const wait = (ms = 150) => page.waitForTimeout(ms);
const ok = (n, c) => console.log(`${c ? 'ok  ' : 'FAIL'} ${n}`);
await page.evaluate(() => { localStorage.clear(); FlowLab.loadExample('forme'); });
for (const id of ['ArrayList', 'Queue']) {
  await page.keyboard.press('Control+i'); await wait(150);
  if (!(await page.locator('details.modsrc').first().getAttribute('open') !== null)) { await page.locator('.modsrc > summary').first().click(); await wait(100); }
  await page.waitForFunction(() => !/Caricamento/.test(document.querySelector('.modsrc').innerText), null, { timeout: 20000 });
  while (await page.locator('.modsrc details.modtopic:not([open]) > summary').count()) { await page.locator('.modsrc details.modtopic:not([open]) > summary').first().click(); await wait(50); }
  if (id === 'ArrayList') await page.screenshot({ path: 'test/modtree.png' });
  await page.locator('.modsrc .modrow', { hasText: id }).first().locator('button').click(); await wait(250);
}
// una classe del programma usa ArrayList
await page.evaluate(() => { const p = FlowLab.state.prog; const d = p.classes.find((c) => c.name === 'Disegno'); d.attributes.push(ModelLib.makeAttribute({ name: 'storia', type: 'ArrayList<String>' })); FlowLab.render(); });
await wait(150);
await page.screenshot({ path: 'test/modcoll1.png' });
ok('pulsante: ' + await page.locator('#modToggle').textContent(), await page.locator('#modBar').isVisible());
await page.locator('.umod[data-module="Queue"] .umodtog').click(); await wait(150);
ok('Queue condensato: ' + (await page.locator('.umodc .umodcls').allTextContents()).join(', '), (await page.locator('.umodc').count()) === 1);
await page.click('#modToggle'); await wait(150);
ok('tutti condensati: ' + await page.locator('.umodc').count() + ' · pulsante ' + await page.locator('#modToggle').textContent(), (await page.locator('.umodc').count()) === 2 && /Espandi/.test(await page.locator('#modToggle').textContent()));
await page.screenshot({ path: 'test/modcoll2.png' });
await page.locator('.umodc[data-module="ArrayList"] .umodlab').dblclick({ force: true }); await wait(150);
ok('doppio clic espande ArrayList', (await page.locator('.umodc').count()) === 1);
await page.keyboard.press('Shift+M'); await wait(150);
ok('Maiusc+M: espansi tutti? ' + await page.locator('.umodc').count(), (await page.locator('.umodc').count()) === 2 || (await page.locator('.umodc').count()) === 0);
// trascinamento: il riquadro del modulo sposta tutte le sue classi
const pos = () => page.evaluate(() => FlowLab.state.prog.classes.filter((c) => c.module && c.module.name === 'Queue').map((c) => [c.x, c.y]));
const p0 = await pos();
const tab = await page.locator('.umod[data-module="Queue"] .umodlab').boundingBox();
await page.mouse.move(tab.x + 5, tab.y + 5); await page.mouse.down(); await page.mouse.move(tab.x + 60, tab.y + 85, { steps: 6 }); await page.mouse.up(); await wait(150);
const p1 = await pos();
ok('modulo trascinato: ' + JSON.stringify(p0) + ' → ' + JSON.stringify(p1), p1.every((p, i) => p[0] - p0[i][0] === p1[0][0] - p0[0][0] && p[1] - p0[i][1] === p1[0][1] - p0[0][1]) && p1[0][0] !== p0[0][0]);
await page.keyboard.press('Control+z'); await wait(150);
ok('Ctrl+Z lo riporta', JSON.stringify(await pos()) === JSON.stringify(p0));
// condensato: si trascina il riquadro compatto
if (!(await page.locator('.umodc[data-module="Queue"]').count())) { await page.locator('.umod[data-module="Queue"] .umodtog').click(); await wait(150); }
const cb = await page.locator('.umodc[data-module="Queue"] .umodbg').boundingBox();
await page.mouse.move(cb.x + 40, cb.y + 50); await page.mouse.down(); await page.mouse.move(cb.x + 140, cb.y + 50, { steps: 6 }); await page.mouse.up(); await wait(150);
const p2 = await pos();
ok('condensato trascinato: ' + JSON.stringify(p2), p2[0][0] === p0[0][0] + 100 && p2[1][0] === p0[1][0] + 100 && (await page.locator('.umodc').count()) >= 1);
// espanso: si trascina dal bordo del riquadro
await page.locator('.umodc[data-module="Queue"] .umodtog').click(); await wait(150);
const before = await pos(), nClassi = await page.evaluate(() => FlowLab.state.prog.classes.length);
const fr = await page.locator('.umod[data-module="Queue"] .umodbg').boundingBox();
await page.mouse.move(fr.x + 6, fr.y + fr.height / 2); await page.mouse.down(); await page.mouse.move(fr.x + 6, fr.y + fr.height / 2 + 40, { steps: 5 }); await page.mouse.up(); await wait(150);
const after = await pos();
ok('espanso trascinato dal bordo: ' + JSON.stringify(before) + ' → ' + JSON.stringify(after), after[0][1] === before[0][1] + 40 && after[1][1] === before[1][1] + 40);
await page.mouse.dblclick(fr.x + 6, fr.y + fr.height / 2 + 40); await wait(150);
ok('nessuna nuova classe dal doppio clic sul riquadro', (await page.locator('.modal').count()) === 0 && (await page.evaluate(() => FlowLab.state.prog.classes.length)) === nClassi);
console.log('ERR', errs); await browser.close();
