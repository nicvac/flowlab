// Banco di prova di compatibilità .fprg — uso: node test/compat.mjs <cartella con file .fprg>
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'fs'; import path from 'path';
const dir = process.argv[2];
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) { if (f !== '.git') walk(p); } else if (/\.fprg$/i.test(f)) files.push(p); } })(dir);
const browser = await chromium.launch(); const page = await browser.newPage();
await page.goto('file://' + process.cwd() + '/dist/FlowLab.html'); await page.waitForTimeout(300);
const inputs = files.map((f) => ({ name: path.relative(dir, f), xml: fs.readFileSync(f, 'utf8') }));
const report = await page.evaluate((inputs) => {
  // elementi e attributi del formato .fprg standard (versioni 2.x–4.x)
  const SCHEMA = {
    [ModelLib.FPRG_ROOT]: ['fileversion'], attributes: [], attribute: ['name', 'value'], function: ['name', 'type', 'variable'], parameters: [], parameter: ['name', 'type', 'array'], body: [],
    declare: ['name', 'type', 'array', 'size'], assign: ['variable', 'expression'], input: ['variable'], output: ['expression', 'newline'],
    if: ['expression'], then: [], else: [], while: ['expression'], do: ['expression'], for: ['variable', 'start', 'end', 'direction', 'step'],
    call: ['expression'], comment: ['text'], breakpoint: ['expression', 'always'], open: ['expression', 'mode'], close: ['mode'], read: ['variable'], write: ['expression'],
  };
  const TURTLE = new Set(['forward', 'turn', 'home', 'clear', 'pen', 'color']);
  const STMT = new Set(['declare', 'assign', 'input', 'output', 'if', 'while', 'do', 'for', 'call', 'comment', 'breakpoint', 'open', 'close', 'read', 'write']);
  const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'id' || k === 'skipped' || k === 'saved' || k === 'edited' || k === 'fileversion' ? undefined : v)));
  const out = [];
  for (const { name, xml } of inputs) {
    const r = { name, problems: [] };
    let p;
    try { p = ModelLib.parseFprg(xml); } catch (e) { r.problems.push('apertura: ' + e.message); out.push(r); continue; }
    // 1. ogni blocco letto
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const counts = {}; for (const el of doc.querySelectorAll('*')) { const t = el.nodeName.toLowerCase(); if (STMT.has(t)) counts[t] = (counts[t] || 0) + 1; }
    const got = {}; for (const f of p.functions) ModelLib.walk(f.body, (s) => { got[s.kind] = (got[s.kind] || 0) + 1; });
    for (const k of Object.keys(counts)) if (counts[k] !== (got[k] || 0)) r.problems.push(`blocchi ${k}: nel file ${counts[k]}, letti ${got[k] || 0}`);
    r.blocks = Object.values(got).reduce((a, b) => a + b, 0);
    r.ignored = (p.skipped || []).filter((t) => t !== 'more');
    // 2. espressioni e 3. nomi
    let exprs = 0, caseFix = 0;
    for (const f of p.functions) {
      const declared = new Map(); f.params.forEach((x) => declared.set(x.name.toLowerCase(), x.name));
      ModelLib.walk(f.body, (s) => { if (s.kind === 'declare') s.name.split(',').map((x) => x.trim()).filter(Boolean).forEach((n) => declared.set(n.toLowerCase(), n)); });
      const funcs = new Set(p.functions.map((g) => g.name.toLowerCase()));
      const visit = (n) => {
        if (!n || typeof n !== 'object') return;
        if (n.k === 'var') {
          const d = declared.get(n.name.toLowerCase());
          if (!d && !funcs.has(n.name.toLowerCase())) r.problems.push(`${f.name}: nome "${n.name}" non dichiarato`);
          else if (d && d !== n.name) caseFix++;
        }
        for (const v of Object.values(n)) if (v && typeof v === 'object') visit(v);
      };
      ModelLib.walk(f.body, (s) => {
        const fields = { assign: ['expression'], output: ['expression'], if: ['expression'], while: ['expression'], do: ['expression'], call: ['expression'], for: ['start', 'end', 'step'], declare: s.array ? ['size'] : [], write: ['expression'], open: ['expression'] }[s.kind] || [];
        for (const k of fields) { if (!String(s[k]).trim()) continue; exprs++; try { visit(ExprLib.parseExpr(s[k])); } catch (e) { r.problems.push(`${f.name}: espressione ${JSON.stringify(s[k])}: ${e.message}`); } }
        for (const k of ['variable']) if (s[k] !== undefined && String(s[k]).trim()) { exprs++; try { ExprLib.parseLValueList(s[k]).forEach(visit); } catch (e) { r.problems.push(`${f.name}: variabile ${JSON.stringify(s[k])}: ${e.message}`); } }
      });
    }
    r.exprs = exprs; r.caseFix = caseFix;
    // 4. salvataggio e riapertura
    const s1 = ModelLib.serializeFprg(p); const p2 = ModelLib.parseFprg(s1); const s2 = ModelLib.serializeFprg(p2);
    if (JSON.stringify(strip(p)) !== JSON.stringify(strip(p2))) r.problems.push('salva+riapri: il programma cambia');
    const norm = (x) => x.replace(/name="(saved|edited)" value="[^"]*"/g, '');
    if (norm(s1) !== norm(s2)) r.problems.push('salva+riapri: il file cambia');
    // 5. solo formato originale nel file salvato
    const d1 = new DOMParser().parseFromString(s1, 'application/xml');
    for (const el of d1.querySelectorAll('*')) {
      const t = el.nodeName; if (!SCHEMA[t]) { r.problems.push(`file salvato: elemento non originale <${t}>`); continue; }
      for (const a of el.attributes) if (!SCHEMA[t].includes(a.name)) r.problems.push(`file salvato: attributo non originale ${t}@${a.name}`);
    }
    // 6. esecuzione con input automatici
    try {
      let typed = 0;
      const env = { output() {}, eof: () => true, fileOpen() { throw new Error('file non disponibile nel test'); }, fileClose() {}, fileRead() { return ''; }, fileWrite() {} };
      const g = new Interpreter(JSON.parse(JSON.stringify(p)), env).run();
      let st = g.next(), steps = 0;
      while (!st.done && steps < 20000) {
        steps++;
        if (st.value.type === 'input') { typed++; const t = st.value.varType; st = g.next(typed > 60 ? (t === 'String' ? 'n' : t === 'Boolean' ? 'false' : '0') : (t === 'String' ? (typed % 2 ? 'y' : 'Ani') : t === 'Boolean' ? 'true' : String(1 + (typed % 4)))); }
        else st = g.next();
      }
      r.run = st.done ? `terminato (${steps} passi, ${typed} input)` : `fermato dopo ${steps} passi`;
    } catch (e) { r.run = 'ERRORE: ' + e.message; }
    out.push(r);
  }
  return out;
}, inputs);
let bad = 0;
for (const r of report) {
  const ok = !r.problems.length;
  if (!ok) bad++;
  console.log(`${ok ? '✔' : '✖'} ${r.name} — ${r.blocks} blocchi, ${r.exprs} espressioni${r.caseFix ? `, ${r.caseFix} nomi con maiuscole diverse` : ''}${r.ignored && r.ignored.length ? `, ignorati: ${r.ignored.join(',')}` : ''} · esecuzione: ${r.run}`);
  for (const p of r.problems) console.log('     · ' + p);
}
console.log(`\n${report.length - bad}/${report.length} file senza problemi`);
await browser.close();
