/* ==========================================================================
   FlowLab — modello del programma e formato file .fprg (XML)
   ========================================================================== */
'use strict';

/* elemento radice del formato .fprg (fa parte del formato: va scritto così) */
const FPRG_ROOT = 'flowgorithm';

let __id = 1;
const newId = () => 's' + (__id++);

/* Definizione dei tipi di blocco: campi salvati nel file e valori di default */
const KINDS = {
  declare:    { fields: { name: '', type: 'Integer', array: false, size: '' } },
  assign:     { fields: { variable: '', expression: '' } },
  input:      { fields: { variable: '' } },
  output:     { fields: { expression: '', newline: true } },
  if:         { fields: { expression: '' }, blocks: ['then', 'else'] },
  while:      { fields: { expression: '' }, blocks: ['body'] },
  for:        { fields: { variable: '', start: '', end: '', direction: 'inc', step: '1' }, blocks: ['body'] },
  do:         { fields: { expression: '' }, blocks: ['body'] },
  call:       { fields: { expression: '' } },
  comment:    { fields: { text: '' } },
  breakpoint: { fields: { expression: '', always: true } },
  open:       { fields: { expression: '', mode: 'read' } },
  close:      { fields: { mode: 'read' } },
  read:       { fields: { variable: '' } },
  write:      { fields: { expression: '' } },
};

function makeStmt(kind, props) {
  const def = KINDS[kind];
  const s = { id: newId(), kind };
  for (const [k, v] of Object.entries(def.fields)) s[k] = v;
  for (const b of def.blocks || []) s[b] = [];
  if (props) Object.assign(s, props);
  return s;
}

function makeFunction(name, props) {
  return Object.assign({ id: newId(), name, type: 'None', variable: '', params: [], body: [] }, props || {});
}

/* Valori restituiti da una funzione: [{name, type}] (vuoto = procedura).
   type/variable restano allineati al primo valore, come nel formato .fprg. */
function rets(f) {
  if (Array.isArray(f.returns) && f.returns.length) return f.returns;
  return f.type && f.type !== 'None' ? [{ name: f.variable || '', type: f.type }] : [];
}
function setRets(f, list) {
  f.returns = list.map((r) => ({ name: r.name, type: r.type }));
  f.type = list.length ? list[0].type : 'None';
  f.variable = list.length ? list[0].name : '';
}

function newProgram() {
  return {
    attrs: { name: '', authors: '', about: '', created: '', edited: '' },
    functions: [makeFunction('Main')],
  };
}

/* Copia profonda con nuovi id (per copia/incolla) */
function cloneStmt(s, keepIds) {
  const c = JSON.parse(JSON.stringify(s));
  if (!keepIds) reId(c);
  return c;
}
function reId(s) {
  s.id = newId();
  for (const b of KINDS[s.kind].blocks || []) s[b].forEach(reId);
}

/* Visita ricorsiva di tutti i blocchi */
function walk(stmts, fn, parent) {
  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i];
    fn(s, stmts, i, parent);
    for (const b of KINDS[s.kind].blocks || []) walk(s[b], fn, s);
  }
}
function findStmt(prog, id) {
  for (const f of prog.functions) {
    let found = null;
    walk(f.body, (s, arr, i) => { if (s.id === id) found = { stmt: s, arr, index: i, func: f }; });
    if (found) return found;
  }
  return null;
}

/* ------------------------------ XML ------------------------------------ */
const boolAttr = (v, d) => (v == null ? d : String(v).toLowerCase() === 'true');

function parseFprg(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error('Il file non è un XML valido.');
  const root = doc.documentElement;
  if (root.nodeName.toLowerCase() !== FPRG_ROOT) throw new Error('Il file non è un programma .fprg valido (elemento principale mancante).');
  _skipped = [];
  const prog = { attrs: { name: '', authors: '', about: '', created: '', edited: '' }, functions: [], fileversion: root.getAttribute('fileversion') || '' };
  for (const el of root.children) {
    const tag = el.nodeName.toLowerCase();
    if (tag === 'attributes') {
      for (const a of el.children) {
        const n = (a.getAttribute('name') || '').toLowerCase();
        if (n in prog.attrs || n === 'saved') prog.attrs[n] = a.getAttribute('value') || '';
      }
    } else if (tag === 'function') {
      const f = makeFunction(el.getAttribute('name') || 'Main', {
        type: normType(el.getAttribute('type'), true),
        variable: el.getAttribute('variable') || '',
      });
      // estensione FlowLab: più valori restituiti, "nome:Tipo;nome:Tipo"
      const multi = el.getAttribute('flowlab-returns');
      if (multi) {
        const list = multi.split(';').map((x) => x.trim()).filter(Boolean).map((x) => { const [n, t] = x.split(':'); return { name: (n || '').trim(), type: normType(t) }; }).filter((r) => r.name);
        if (list.length > 1) setRets(f, list);
      }
      for (const c of el.children) {
        const ct = c.nodeName.toLowerCase();
        if (ct === 'parameters') {
          for (const p of c.children) {
            f.params.push({ name: p.getAttribute('name') || '', type: normType(p.getAttribute('type')), array: boolAttr(p.getAttribute('array'), false) });
          }
        } else if (ct === 'body') {
          f.body = parseBlock(c);
        }
      }
      prog.functions.push(f);
    }
  }
  prog.skipped = _skipped;
  if (!prog.functions.length) prog.functions.push(makeFunction('Main'));
  const mi = prog.functions.findIndex((f) => f.name.toLowerCase() === 'main');
  if (mi > 0) prog.functions.unshift(prog.functions.splice(mi, 1)[0]);
  if (mi < 0) prog.functions.unshift(makeFunction('Main'));
  return prog;
}

function normType(t, allowNone) {
  const l = String(t || '').toLowerCase();
  if (l === 'integer') return 'Integer';
  if (l === 'real') return 'Real';
  if (l === 'string') return 'String';
  if (l === 'boolean') return 'Boolean';
  return allowNone ? 'None' : 'Integer';
}

let _skipped = [];
function parseBlock(el) {
  const out = [];
  for (const c of el.children) {
    const s = parseStmt(c);
    if (s) out.push(s); else _skipped.push(c.nodeName);
  }
  return out;
}

function parseStmt(el) {
  const tag = el.nodeName.toLowerCase();
  const A = (n) => el.getAttribute(n);
  const S = (n) => A(n) ?? '';
  switch (tag) {
    case 'declare': return makeStmt('declare', { name: S('name'), type: normType(A('type')), array: boolAttr(A('array'), false), size: S('size') });
    case 'assign': return makeStmt('assign', { variable: S('variable'), expression: S('expression') });
    case 'input': return makeStmt('input', { variable: S('variable') });
    case 'output': return makeStmt('output', { expression: S('expression'), newline: boolAttr(A('newline'), true) });
    case 'if': {
      const s = makeStmt('if', { expression: S('expression') });
      for (const c of el.children) {
        const t = c.nodeName.toLowerCase();
        if (t === 'then') s.then = parseBlock(c);
        else if (t === 'else') s.else = parseBlock(c);
      }
      return s;
    }
    case 'while': return makeStmt('while', { expression: S('expression'), body: parseBlock(el) });
    case 'do': return makeStmt('do', { expression: S('expression'), body: parseBlock(el) });
    case 'for': return makeStmt('for', {
      variable: S('variable'), start: S('start'), end: S('end'),
      direction: (A('direction') || 'inc').toLowerCase() === 'dec' ? 'dec' : 'inc',
      step: A('step') ?? '1', body: parseBlock(el),
    });
    case 'call': return makeStmt('call', { expression: S('expression') });
    case 'comment': return makeStmt('comment', { text: S('text') });
    case 'breakpoint': return makeStmt('breakpoint', { expression: S('expression'), always: boolAttr(A('always'), !S('expression')) });
    case 'open': return makeStmt('open', { expression: S('expression'), mode: (A('mode') || 'read').toLowerCase() === 'write' ? 'write' : 'read' });
    case 'close': return makeStmt('close', { mode: (A('mode') || 'read').toLowerCase() === 'write' ? 'write' : 'read' });
    case 'read': return makeStmt('read', { variable: S('variable') });
    case 'write': return makeStmt('write', { expression: S('expression') });
  }
  return null; // elemento sconosciuto: ignorato
}

/* Serializzazione */
const _MX = (typeof module !== 'undefined') ? require('./expr.js') : ExprLib;
/* il formato .fprg prevede solo stringhe tra virgolette doppie: 'testo' diventa "testo" */
function fgExpr(src) {
  const s = String(src ?? '');
  if (!s.includes("'")) return s;
  let toks;
  try { toks = _MX.tokenize(s); } catch (e) { return s; }
  let out = s;
  for (const t of toks.filter((x) => x.k === 'str').reverse()) {
    if (s[t.pos] !== "'" || t.v.includes('"')) continue;
    out = out.slice(0, t.pos) + '"' + t.v + '"' + out.slice(t.pos + t.v.length + 2);
  }
  return out;
}
const EXPR_ATTRS = new Set(['expression', 'variable', 'start', 'end', 'step', 'size']);
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r/g, '&#13;').replace(/\n/g, '&#10;');
const TF = (b) => (b ? 'True' : 'False');

function pad2(n) { return String(n).padStart(2, '0'); }
function stamp(d) {
  let h = d.getHours(); const ampm = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(h)}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())} ${ampm}`;
}
function b64(s) { try { return btoa(unescape(encodeURIComponent(s))); } catch (e) { return ''; } }

function serializeFprg(prog) {
  const now = new Date();
  const created = prog.attrs.created || b64(`flowlab;browser;${stamp(now)};1`);
  const edited = b64(`flowlab;browser;${stamp(now)};1`);
  const L = [];
  L.push('<?xml version="1.0"?>');
  L.push(`<${FPRG_ROOT} fileversion="4.2">`);
  L.push('    <attributes>');
  L.push(`        <attribute name="name" value="${xmlEsc(prog.attrs.name || '')}"/>`);
  L.push(`        <attribute name="authors" value="${xmlEsc(prog.attrs.authors || '')}"/>`);
  L.push(`        <attribute name="about" value="${xmlEsc(prog.attrs.about || '')}"/>`);
  L.push(`        <attribute name="saved" value="${xmlEsc(stamp(now))}"/>`);
  L.push(`        <attribute name="created" value="${xmlEsc(created)}"/>`);
  L.push(`        <attribute name="edited" value="${xmlEsc(edited)}"/>`);
  L.push('    </attributes>');
  for (const f of prog.functions) {
    const rs = rets(f);
    const extra = rs.length > 1 ? ` flowlab-returns="${xmlEsc(rs.map((r) => r.name + ':' + r.type).join(';'))}"` : '';
    // per le procedure si conserva il nome eventualmente lasciato in "variable" da altri editor
    L.push(`    <function name="${xmlEsc(f.name)}" type="${rs.length ? rs[0].type : 'None'}" variable="${xmlEsc(rs.length ? rs[0].name : (f.variable || ''))}"${extra}>`);
    if (f.params.length) {
      L.push('        <parameters>');
      for (const p of f.params) L.push(`            <parameter name="${xmlEsc(p.name)}" type="${p.type}" array="${TF(p.array)}"/>`);
      L.push('        </parameters>');
    } else L.push('        <parameters/>');
    if (f.body.length) {
      L.push('        <body>');
      writeBlock(f.body, L, 3);
      L.push('        </body>');
    } else L.push('        <body/>');
    L.push('    </function>');
  }
  L.push(`</${FPRG_ROOT}>`);
  return L.join('\n') + '\n';
}

function writeBlock(stmts, L, depth) {
  const ind = '    '.repeat(depth);
  const open = (tag, attrs, children) => {
    const a = attrs.map(([k, v]) => ` ${k}="${xmlEsc(EXPR_ATTRS.has(k) ? fgExpr(v) : v)}"`).join('');
    if (!children) { L.push(`${ind}<${tag}${a}/>`); return; }
    L.push(`${ind}<${tag}${a}>`);
    children();
    L.push(`${ind}</${tag}>`);
  };
  const sub = (arr) => (arr.length ? () => writeBlock(arr, L, depth + 1) : null);
  for (const s of stmts) {
    switch (s.kind) {
      case 'declare': open('declare', [['name', s.name], ['type', s.type], ['array', TF(s.array)], ['size', s.array ? s.size : '']]); break;
      case 'assign': open('assign', [['variable', s.variable], ['expression', s.expression]]); break;
      case 'input': open('input', [['variable', s.variable]]); break;
      case 'output': open('output', [['expression', s.expression], ['newline', TF(s.newline)]]); break;
      case 'if':
        L.push(`${ind}<if expression="${xmlEsc(fgExpr(s.expression))}">`);
        for (const [tag, arr] of [['then', s.then], ['else', s.else]]) {
          if (arr.length) { L.push(`${ind}    <${tag}>`); writeBlock(arr, L, depth + 2); L.push(`${ind}    </${tag}>`); }
          else L.push(`${ind}    <${tag}/>`);
        }
        L.push(`${ind}</if>`);
        break;
      case 'while': open('while', [['expression', s.expression]], sub(s.body)); break;
      case 'do': open('do', [['expression', s.expression]], sub(s.body)); break;
      case 'for': open('for', [['variable', s.variable], ['start', s.start], ['end', s.end], ['direction', s.direction], ['step', s.step]], sub(s.body)); break;
      case 'call': open('call', [['expression', s.expression]]); break;
      case 'comment': open('comment', [['text', s.text]]); break;
      case 'breakpoint': open('breakpoint', [['expression', s.always ? '' : s.expression], ['always', TF(s.always)]]); break;
      case 'open': open('open', [['expression', s.expression], ['mode', s.mode]]); break;
      case 'close': open('close', [['mode', s.mode]]); break;
      case 'read': open('read', [['variable', s.variable]]); break;
      case 'write': open('write', [['expression', s.expression]]); break;
    }
  }
}

/* Completezza di un blocco (campi obbligatori compilati) */
function isIncomplete(s) {
  switch (s.kind) {
    case 'declare': return !s.name.trim() || (s.array && !String(s.size).trim());
    case 'assign': return !s.variable.trim() || !s.expression.trim();
    case 'input': case 'read': return !s.variable.trim();
    case 'output': case 'if': case 'while': case 'do': case 'call': case 'open': case 'write':
      return !String(s.expression).trim();
    case 'for': return !s.variable.trim() || !s.start.trim() || !s.end.trim();
    case 'breakpoint': return !s.always && !s.expression.trim();
    default: return false;
  }
}

const ModelLib = { FPRG_ROOT, KINDS, rets, setRets, fgExpr, newId, makeStmt, makeFunction, newProgram, cloneStmt, reId, walk, findStmt, parseFprg, serializeFprg, isIncomplete, normType };
if (typeof module !== 'undefined') module.exports = ModelLib;
