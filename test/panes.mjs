import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1366, height: 820 } });
const errs=[]; page.on('pageerror', e => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
await page.evaluate(() => { localStorage.clear(); }); await page.reload(); await page.waitForTimeout(300);
const tabs = async () => page.$$eval('#tabs [role=tab]', b => b.map(x => x.textContent + (x.getAttribute('aria-selected')==='true'?'*':'')).join(','));
console.log('iniziale:', await tabs());
// riordina: trascina File prima di Console
await page.dragAndDrop('.tabw[data-tab=files] [role=tab]', '.tabw[data-tab=console]', { targetPosition: { x: 5, y: 10 } });
console.log('dopo riordino:', await tabs());
// sgancia Console e Variabili
await page.click('.tabw[data-tab=console] .detach');
await page.click('.tabw[data-tab=vars] .detach');
console.log('dopo sgancio:', await tabs(), '| finestre:', await page.$$eval('.fwin', w => w.map(x => x.dataset.win).join(',')));
// sposta la finestra console
const head = await page.$('.fwin[data-win=console] .fwin-head'); const hb = await head.boundingBox();
await page.mouse.move(hb.x + 40, hb.y + 10); await page.mouse.down(); await page.mouse.move(hb.x - 500, hb.y + 250, { steps: 8 }); await page.mouse.up();
const pos = await page.$eval('.fwin[data-win=console]', w => [w.offsetLeft, w.offsetTop]);
console.log('console spostata a', pos);
// esegue un programma con input nella console flottante
await page.evaluate(() => { FlowLab.loadExample('parita'); const s=document.querySelector('#speed'); s.value=0; s.dispatchEvent(new Event('input')); });
await page.click('#runBtn'); await page.waitForSelector('#conInput:not([disabled])'); await page.fill('#conInput','12'); await page.press('#conInput','Enter'); await page.waitForTimeout(200);
console.log('output:', (await page.innerText('#conOut')).replace(/\n/g,' / '));
console.log('vars visibili:', await page.isVisible('#varsBody table'));
await page.screenshot({ path: 'test/p1.png' });
// ricarica: disposizione ricordata
await page.reload(); await page.waitForTimeout(400);
console.log('dopo ricarica:', await tabs(), '| finestre:', await page.$$eval('.fwin', w => w.map(x => x.dataset.win + '@' + x.offsetLeft + ',' + x.offsetTop).join(' ')));
// sgancia tutto -> pannello laterale sparisce
await page.click('.tabw[data-tab=files] .detach'); await page.click('.tabw[data-tab=code] .detach');
console.log('side-empty:', await page.evaluate(() => document.body.classList.contains('side-empty')), 'codice renderizzato:', (await page.innerText('#codeOut')).length > 10);
await page.screenshot({ path: 'test/p2.png' });
// riaggancia console
await page.click('.fwin[data-win=console] .dock');
console.log('dopo riaggancio:', await tabs(), 'side-empty:', await page.evaluate(() => document.body.classList.contains('side-empty')));
console.log('ERR', errs); await browser.close();
