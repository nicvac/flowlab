// Classi e metodi astratti nell'interfaccia
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
const wait = (ms = 130) => page.waitForTimeout(ms);
const head = (n) => page.locator(`.ubox:has(.uname:text-is("${n}")) .uhit.head`);
await page.evaluate(() => { localStorage.clear(); const s = document.querySelector('#speed'); s.value = 0; s.dispatchEvent(new Event('input')); FlowLab.loadExample('animali'); });
await wait(250);
console.log('stereotipi:', await page.locator('.ustereo').allTextContents(), '· astratti:', await page.locator('.urow.abs .umem').allTextContents());
await page.screenshot({ path: 'test/abs1.png' });
await page.locator('.ubox:has(.uname:text-is("Animale")) .urow.abs').dblclick(); await wait();
console.log('scheda:', (await page.innerText('.abscard')).replace(/\n+/g, ' | '));
await page.screenshot({ path: 'test/abs2.png' });
await page.click('.abscard button:has-text("Gatto.verso")'); await wait();
console.log('aperto:', await page.innerText('#crumbWhere'));
await page.click('#runBtn'); await wait(300);
console.log('output:', (await page.evaluate(() => document.querySelector('#conOut').textContent)));
// classe astratta: niente new
await page.evaluate(() => { const m = FlowLab.state.prog.functions[0]; m.body.push(ModelLib.makeStmt('assign', { variable: 'a', expression: 'new Animale("x")' })); FlowLab.render(); });
await page.click('#runBtn'); await wait(300);
console.log('errore:', (await page.evaluate(() => document.querySelector('#conOut').textContent)).split('✖')[1]);
await page.keyboard.press('Control+z');
await page.evaluate(() => FlowLab.showUml()); await wait();
// togliere «astratta» con metodi astratti: rifiutato
await head('Animale').dblclick(); await wait();
await page.uncheck('#f_cabs'); await page.click('.modal footer .btn.primary'); await wait(80);
console.log('rifiuto:', await page.locator('.modal .formerr').textContent());
await page.click('.modal footer .btn:not(.primary)'); await wait(60);
// nuova sottoclasse senza verso(): segnalata
await page.click('#funcAdd'); await wait(80);
await page.fill('#f_cname', 'Pesce'); await page.selectOption('#f_cpar', 'Animale'); await page.click('.modal footer .btn.primary'); await wait(150);
console.log('avviso su Pesce:', await page.locator('.ubox.warn .uname').allTextContents());
// metodo astratto in una classe concreta: la classe diventa astratta
await head('Pesce').click({ button: 'right' }); await wait(60);
await page.click('#pop button:has-text("Nuovo metodo")'); await wait(80);
await page.fill('#f_fname', 'nuota'); await page.check('#f_fabs');
console.log('statico disabilitato:', await page.isDisabled('#f_fstatic'));
await page.click('.modal footer .btn.primary'); await wait(150);
console.log('Pesce astratta:', await page.evaluate(() => FlowLab.state.prog.classes.find((c) => c.name === 'Pesce').abstract), '· avviso:', await page.locator('.ubox.warn').count(), '· toast:', await page.innerText('#toast'));
const xml = await page.evaluate(() => FlowLab.serialize());
await page.evaluate((x) => FlowLab.loadText(x, 'a.fprg'), xml); await wait(150);
console.log('riaperto: astratte', await page.evaluate(() => FlowLab.state.prog.classes.filter((c) => c.abstract).map((c) => c.name).join(',')), '· metodi astratti', await page.evaluate(() => FlowLab.state.prog.functions.filter((f) => f.abstract).map((f) => f.name).join(',')));
await page.screenshot({ path: 'test/abs3.png' });
console.log('ERR', errs);
await browser.close();
