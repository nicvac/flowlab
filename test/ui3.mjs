import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const url = 'file://' + process.cwd() + '/dist/FlowLab.html';
const browser = await chromium.launch();
const errs = [];
const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, colorScheme: 'dark' });
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERR ' + e.message));
await page.goto(url); await page.waitForTimeout(400);
await page.evaluate(() => FlowLab.loadExample('indovina'));
await page.waitForTimeout(200);
const ins = await page.$$('#chart .ins'); await ins[2].click();
await page.waitForTimeout(150);
await page.screenshot({ path: 'test/d1.png' });
await page.keyboard.press('Escape');
await page.click('#helpBtn'); await page.waitForTimeout(150);
await page.screenshot({ path: 'test/d2.png' });
await page.keyboard.press('Escape');
await page.dblclick('#chart .shape[data-kind=for], #chart .shape[data-kind=do]');
await page.waitForTimeout(150);
await page.screenshot({ path: 'test/d3.png' });
await page.keyboard.press('Escape');
// mobile
const m = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
m.on('pageerror', e => errs.push('M PAGEERR ' + e.message));
await m.goto(url); await m.waitForTimeout(400);
await m.screenshot({ path: 'test/m1.png' });
const sw = await m.evaluate(() => [document.documentElement.scrollWidth, document.body.scrollWidth, innerWidth]);
console.log('mobile widths', sw);
// a hand-written Flowgorithm-style file
await page.evaluate(() => FlowLab.loadText(`<?xml version="1.0"?>
<flowgorithm fileversion="3.0">
    <attributes>
        <attribute name="name" value="Area cerchio"/>
        <attribute name="authors" value="prof"/>
        <attribute name="about" value=""/>
        <attribute name="saved" value="2023-02-01 09:12:44 AM"/>
        <attribute name="created" value="cHJvZjtQQzsyMDIzLTAyLTAxOyIwOToxMDowMSBBTSI7MjgyNg=="/>
        <attribute name="edited" value="cHJvZjtQQzsyMDIzLTAyLTAxOyIwOToxMjo0NCBBTSI7MTsyOTM2"/>
    </attributes>
    <function name="Main" type="None" variable="">
        <parameters/>
        <body>
            <declare name="raggio" type="Real" array="False" size=""/>
            <declare name="area" type="Real" array="False" size=""/>
            <assign variable="raggio" expression="2.5"/>
            <assign variable="area" expression="Area(raggio)"/>
            <output expression="&quot;Area = &quot; &amp; ToFixed(area, 3)" newline="True"/>
            <comment text="Fine &#10; due righe"/>
            <breakpoint expression="" always="True"/>
            <output expression="area &gt;= 19.6 &amp;&amp; area ≤ 19.7" newline="True"/>
        </body>
    </function>
    <function name="Area" type="Real" variable="a">
        <parameters>
            <parameter name="r" type="Real" array="False"/>
        </parameters>
        <body>
            <declare name="a" type="Real" array="False" size=""/>
            <assign variable="a" expression="Pi * r ^ 2"/>
        </body>
    </function>
</flowgorithm>`, 'area.fprg'));
await page.evaluate(() => { const s=document.querySelector('#speed'); s.value=0; s.dispatchEvent(new Event('input')); });
await page.click('#runBtn'); await page.waitForTimeout(300);
console.log('state', await page.evaluate(() => FlowLab.run.state));
await page.click('#runBtn'); await page.waitForTimeout(300);
console.log((await page.innerText('#conOut')));
await page.screenshot({ path: 'test/d4.png' });
console.log('ERRORS', errs);
await browser.close();
