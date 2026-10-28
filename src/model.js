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
  const:      { fields: { name: '', type: 'Integer', expression: '' } },
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

/* ------------------------- Classi (vista Oggetti) ------------------------
   prog.classes = [{ id, name, parent, attributes: [...], x, y }]
   attributo: { name, type, array, size, visibility, static, init }
   I metodi restano in prog.functions (così editor e interprete li trattano
   come funzioni) con: cls = id della classe, visibility, static, ctor.
   Main resta prog.functions[0]: è il metodo statico della classe principale. */
const VISIBILITY = { public: '+', private: '-', protected: '#' };
const VIS_IT = { public: 'pubblico', private: 'privato', protected: 'protetto' };

function makeClass(name, props) {
  return Object.assign({ id: newId(), name, parent: '', abstract: false, attributes: [], x: 40, y: 40 }, props || {});
}
function makeAttribute(props) {
  return Object.assign({ name: '', type: 'Integer', array: false, size: '', visibility: 'private', static: false, init: '' }, props || {});
}
const hasClasses = (prog) => Array.isArray(prog.classes) && prog.classes.length > 0;
function classById(prog, id) { return hasClasses(prog) ? prog.classes.find((c) => c.id === id) || null : null; }
function classByName(prog, name) {
  if (!hasClasses(prog) || !name) return null;
  const l = String(name).toLowerCase();
  return prog.classes.find((c) => c.name.toLowerCase() === l) || null;
}
const classOf = (prog, f) => classById(prog, f.cls);
const mainClass = (prog) => classOf(prog, prog.functions[0]);
const membersOf = (prog, c) => prog.functions.filter((f) => f.cls === c.id);
/* catena di ereditarietà: la classe, poi il padre, il nonno... (si ferma sui cicli) */
function chainOf(prog, c) {
  const out = [];
  while (c && !out.includes(c)) { out.push(c); c = classByName(prog, c.parent); }
  return out;
}
const isSubclass = (prog, c, of) => chainOf(prog, c).includes(of);
/* nome di classe ricavato dal nome del programma: "Media dei voti" -> "MediaDeiVoti" */
function defaultClassName(prog) {
  const words = String(prog.attrs.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^A-Za-z0-9_]+/).filter(Boolean);
  let n = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  if (!/^[A-Za-z_]/.test(n)) n = '';
  return n || 'Programma';
}
/* vista Oggetti: tutte le funzioni diventano metodi statici di un'unica classe */
function wrapInClass(prog) {
  const c = makeClass(defaultClassName(prog));
  prog.classes = [c];
  for (const f of prog.functions) Object.assign(f, { cls: c.id, visibility: 'public', static: true, ctor: false });
  return c;
}
/* una sola classe con soli metodi statici pubblici: equivale al programma a funzioni */
function isTrivialOO(prog) {
  if (!hasClasses(prog)) return true;
  if (prog.classes.length !== 1) return false;
  const c = prog.classes[0];
  if (c.parent || c.abstract || c.attributes.length) return false;
  return prog.functions.every((f) => f.cls === c.id && f.static && !f.ctor && (f.visibility || 'public') === 'public');
}
/* come sopra e con il nome predefinito: si salva nel formato standard senza perdere nulla */
/* metodi astratti ereditati e non ancora definiti: [{ f, owner }] (per una classe concreta devono essere zero) */
function missingAbstract(prog, c) {
  const sig = (f) => f.name.toLowerCase() + '(' + f.params.map((p) => p.type.toLowerCase() + (p.array ? '[' + (p.dims || 1) : '')).join(',') + ')';
  const best = new Map(); // firma -> versione più derivata
  for (const k of chainOf(prog, c)) for (const f of membersOf(prog, k)) if (!f.ctor && !f.static && !best.has(sig(f))) best.set(sig(f), { f, owner: k });
  return [...best.values()].filter((x) => x.f.abstract);
}
const isPlainOO = (prog) => isTrivialOO(prog) && (!hasClasses(prog) || prog.classes[0].name === defaultClassName(prog));
function unwrapClasses(prog) {
  delete prog.classes;
  for (const f of prog.functions) { delete f.cls; delete f.visibility; delete f.static; delete f.ctor; }
}
/* tipi utilizzabili: i quattro di base e, nella vista Oggetti, le classi */
const typeList = (prog) => ['Integer', 'Real', 'String', 'Boolean', ...(hasClasses(prog) ? prog.classes.map((c) => c.name) : [])];

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
  _classNames = new Map();
  const prog = { attrs: { name: '', authors: '', about: '', created: '', edited: '' }, functions: [], fileversion: root.getAttribute('fileversion') || '' };
  // estensione FlowLab: classi (lette per prime, perché i tipi le possono nominare)
  const clsEl = [...root.children].find((el) => el.nodeName.toLowerCase() === 'flowlab-classes');
  if (clsEl) {
    prog.classes = [];
    for (const c of clsEl.children) if (c.nodeName.toLowerCase() === 'class') {
      const cl = makeClass((c.getAttribute('name') || '').trim(), { parent: (c.getAttribute('parent') || '').trim(), abstract: boolAttr(c.getAttribute('abstract'), false), x: +c.getAttribute('x') || 40, y: +c.getAttribute('y') || 40 });
      if (!cl.name || _classNames.has(cl.name.toLowerCase())) continue;
      _classNames.set(cl.name.toLowerCase(), cl.name);
      prog.classes.push(cl);
      cl._attrEls = [...c.children].filter((a) => a.nodeName.toLowerCase() === 'attribute');
    }
    for (const cl of prog.classes) {
      cl.attributes = cl._attrEls.map((a) => makeAttribute({
        name: a.getAttribute('name') || '', type: normType(a.getAttribute('type')), array: boolAttr(a.getAttribute('array'), false), size: a.getAttribute('size') || '',
        visibility: VISIBILITY[(a.getAttribute('visibility') || '').toLowerCase()] ? a.getAttribute('visibility').toLowerCase() : 'private',
        static: boolAttr(a.getAttribute('static'), false), init: a.getAttribute('init') || '',
      }));
      delete cl._attrEls;
      const par = _classNames.get(cl.parent.toLowerCase()); cl.parent = par && par.toLowerCase() !== cl.name.toLowerCase() ? par : '';
    }
    if (!prog.classes.length) delete prog.classes;
  }
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
      if (prog.classes) {
        const owner = classByName(prog, el.getAttribute('flowlab-class'));
        if (owner) f.cls = owner.id;
        const vis = (el.getAttribute('flowlab-visibility') || 'public').toLowerCase();
        f.visibility = VISIBILITY[vis] ? vis : 'public';
        f.static = boolAttr(el.getAttribute('flowlab-static'), false);
        f.ctor = boolAttr(el.getAttribute('flowlab-ctor'), false);
        f.abstract = !f.ctor && !f.static && boolAttr(el.getAttribute('flowlab-abstract'), false);
      }
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
            const dims = parseInt(p.getAttribute('flowlab-dims') || '1', 10) || 1;
            f.params.push({ name: p.getAttribute('name') || '', type: normType(p.getAttribute('type')), array: boolAttr(p.getAttribute('array'), false), dims: boolAttr(p.getAttribute('array'), false) ? dims : 1 });
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
  const mi = prog.functions.findIndex((f) => f.name.toLowerCase() === 'main' && !f.ctor);
  if (mi > 0) prog.functions.unshift(prog.functions.splice(mi, 1)[0]);
  if (mi < 0) prog.functions.unshift(makeFunction('Main'));
  if (prog.classes) {
    // metodi senza classe: vanno nella classe del Main (o nella prima)
    const home = classOf(prog, prog.functions[0]) || prog.classes[0];
    for (const f of prog.functions) if (!classById(prog, f.cls)) Object.assign(f, { cls: home.id, static: f.static || f === prog.functions[0], ctor: false });
    Object.assign(prog.functions[0], { static: true, ctor: false, visibility: 'public' });
  }
  _classNames = new Map();
  return prog;
}

let _classNames = new Map();
function normType(t, allowNone) {
  const l = String(t || '').toLowerCase();
  if (_classNames.has(l)) return _classNames.get(l);
  if (l === 'integer') return 'Integer';
  if (l === 'real') return 'Real';
  if (l === 'string') return 'String';
  if (l === 'boolean') return 'Boolean';
  return allowNone ? 'None' : 'Integer';
}

let _skipped = [];
function parseBlock(el) {
  const out = [];
  const kids = [...el.children];
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i];
    // estensione FlowLab: costante = <declare flowlab-const="True"/> seguita dall'assegnamento del valore
    if (c.nodeName.toLowerCase() === 'declare' && String(c.getAttribute('flowlab-const')).toLowerCase() === 'true') {
      const name = (c.getAttribute('name') || '').trim();
      const nx = kids[i + 1];
      let expression = '';
      if (nx && nx.nodeName.toLowerCase() === 'assign' && (nx.getAttribute('variable') || '').trim().toLowerCase() === name.toLowerCase()) { expression = nx.getAttribute('expression') || ''; i++; }
      out.push(makeStmt('const', { name, type: normType(c.getAttribute('type')), expression }));
      continue;
    }
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
  // una classe che contiene solo funzioni statiche si salva nel formato standard
  const oo = !isPlainOO(prog);
  if (oo) {
    L.push('    <flowlab-classes>');
    for (const c of prog.classes) {
      const head = `        <class name="${xmlEsc(c.name)}" parent="${xmlEsc(c.parent || '')}"${c.abstract ? ' abstract="True"' : ''} x="${Math.round(c.x || 0)}" y="${Math.round(c.y || 0)}"`;
      if (!c.attributes.length) { L.push(head + '/>'); continue; }
      L.push(head + '>');
      for (const a of c.attributes) L.push(`            <attribute name="${xmlEsc(a.name)}" type="${xmlEsc(a.type)}" array="${TF(a.array)}" size="${xmlEsc(a.array ? fgExpr(a.size) : '')}" visibility="${a.visibility}" static="${TF(a.static)}" init="${xmlEsc(fgExpr(a.init || ''))}"/>`);
      L.push('        </class>');
    }
    L.push('    </flowlab-classes>');
  }
  for (const f of prog.functions) {
    const rs = rets(f);
    let extra = rs.length > 1 ? ` flowlab-returns="${xmlEsc(rs.map((r) => r.name + ':' + r.type).join(';'))}"` : '';
    if (oo) { const c = classOf(prog, f); extra += ` flowlab-class="${xmlEsc(c ? c.name : '')}" flowlab-visibility="${f.visibility || 'public'}" flowlab-static="${TF(!!f.static)}"${f.ctor ? ' flowlab-ctor="True"' : ''}${f.abstract ? ' flowlab-abstract="True"' : ''}`; }
    // per le procedure si conserva il nome eventualmente lasciato in "variable" da altri editor
    L.push(`    <function name="${xmlEsc(f.name)}" type="${rs.length ? rs[0].type : 'None'}" variable="${xmlEsc(rs.length ? rs[0].name : (f.variable || ''))}"${extra}>`);
    if (f.params.length) {
      L.push('        <parameters>');
      for (const p of f.params) L.push(`            <parameter name="${xmlEsc(p.name)}" type="${p.type}" array="${TF(p.array)}"${p.array && (p.dims || 1) > 1 ? ` flowlab-dims="${p.dims}"` : ''}/>`);
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
      case 'const':
        // gli altri editor vedono una variabile dichiarata e assegnata: il programma resta eseguibile
        open('declare', [['name', s.name], ['type', s.type], ['array', 'False'], ['size', ''], ['flowlab-const', 'True']]);
        open('assign', [['variable', s.name], ['expression', s.expression]]);
        break;
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

/* Funzionalità del formato .fprg esteso usate dal programma */
function extendedFeatures(prog) {
  const out = new Set();
  if (!isPlainOO(prog)) out.add('classi e oggetti');
  for (const f of prog.functions) {
    if (rets(f).length > 1) out.add('funzioni con più valori restituiti');
    if (f.params.some((p) => p.array && (p.dims || 1) > 1)) out.add('array a più dimensioni');
    walk(f.body, (s) => {
      if (s.kind === 'const') out.add('costanti');
      if (s.kind === 'declare' && s.array && _MX.splitTop(s.size).length > 1) out.add('array a più dimensioni');
      for (const k of ['variable', 'expression', 'start', 'end', 'step']) {
        if (typeof s[k] !== 'string' || !s[k].includes('[')) continue;
        try { const visit = (n) => { if (!n || typeof n !== 'object') return; if (n.k === 'var' && n.indices && n.indices.length > 1) out.add('array a più dimensioni'); Object.values(n).forEach(visit); }; (k === 'variable' ? _MX.parseLValueList(s[k]) : [_MX.parseExpr(s[k])]).forEach(visit); } catch (e) { /* espressione incompleta */ }
      }
    });
  }
  return [...out];
}

/* Completezza di un blocco (campi obbligatori compilati) */
function isIncomplete(s) {
  switch (s.kind) {
    case 'declare': return !s.name.trim() || (s.array && !String(s.size).trim());
    case 'const': return !s.name.trim() || !String(s.expression).trim();
    case 'assign': return !s.variable.trim() || !s.expression.trim();
    case 'input': case 'read': return !s.variable.trim();
    case 'output': case 'if': case 'while': case 'do': case 'call': case 'open': case 'write':
      return !String(s.expression).trim();
    case 'for': return !s.variable.trim() || !s.start.trim() || !s.end.trim();
    case 'breakpoint': return !s.always && !s.expression.trim();
    default: return false;
  }
}

const ModelLib = { FPRG_ROOT, KINDS, VISIBILITY, VIS_IT, makeClass, makeAttribute, hasClasses, classById, classByName, classOf, mainClass, membersOf, chainOf, isSubclass, defaultClassName, wrapInClass, isTrivialOO, isPlainOO, missingAbstract, unwrapClasses, typeList, extendedFeatures, rets, setRets, fgExpr, newId, makeStmt, makeFunction, newProgram, cloneStmt, reId, walk, findStmt, parseFprg, serializeFprg, isIncomplete, normType };
if (typeof module !== 'undefined') module.exports = ModelLib;
