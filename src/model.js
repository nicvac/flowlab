/* ==========================================================================
   FlowLab — program model and .fprg file format (XML)
   ========================================================================== */
'use strict';
if (typeof L === 'undefined' && typeof require !== 'undefined') require('./i18n.js'); // testi tradotti (in Node: italiano)

/* root element of the .fprg format (it is part of the format: it must be written like this) */
const FPRG_ROOT = 'flowgorithm';

let __id = 1;
const newId = () => 's' + (__id++);

/* Definition of the block kinds: fields saved in the file and default values */
const KINDS = {
  declare:    { fields: { name: '', type: 'Integer', array: false, size: '', init: '' } },
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
  // exceptions: Try with the body, one or more Catches (catches: [{ id, type, variable, body }]) and optional Finally
  try:        { fields: { hasFinally: false }, blocks: ['body', 'finally'], catches: true },
  throw:      { fields: { expression: '' } },
};
const makeCatch = (props) => Object.assign({ id: newId(), type: 'Exception', variable: 'e', body: [] }, props || {});

/* Predefined exceptions: they are used as classes (also in the Functions view) and can be extended.
   The errors of the interpreter become exceptions of these types. */
const EXCEPTIONS = [
  ['Exception', '', L('model.anyException')],
  ['DivisionByZero', 'Exception', L('model.divisionOrModByZero')],
  ['IndexOutOfRange', 'Exception', L('model.indexOutsideTheArray')],
  // as in Java, a conversion error is a wrong argument (NumberFormatException is an IllegalArgumentException)
  ['InvalidArgument', 'Exception', L('model.invalidArgument')],
  ['InvalidConversion', 'InvalidArgument', L('model.textThatIsNotANumber')],
  ['NullReference', 'Exception', L('model.useOfAnObjectThatIs')],
  ['FileError', 'Exception', L('model.fileError')],
  ['EmptyStack', 'Exception', L('model.emptyStack')],
  ['NoSuchElement', 'Exception', L('model.noSuchElement')],
];
const EXC_CLASSES = EXCEPTIONS.map(([name, parent, doc]) => ({
  id: 'exc:' + name, name, parent, doc, abstract: false, tparams: [], module: null, builtin: true, x: 0, y: 0,
  attributes: [{ name: 'message', type: 'String', array: false, size: '', visibility: 'public', static: false, init: '', readonly: true }],
}));
const excClass = (name) => EXC_CLASSES.find((c) => c.name.toLowerCase() === String(name || '').toLowerCase()) || null;
/* child blocks of a block (for the Try: body, Catch branches, Finally) */
function childArrays(s) {
  const out = (KINDS[s.kind].blocks || []).map((b) => s[b]);
  if (s.kind === 'try') out.splice(1, 0, ...(s.catches || []).map((c) => c.body));
  return out;
}

function makeStmt(kind, props) {
  const def = KINDS[kind];
  const s = { id: newId(), kind };
  for (const [k, v] of Object.entries(def.fields)) s[k] = v;
  for (const b of def.blocks || []) s[b] = [];
  if (def.catches) s.catches = [makeCatch()];
  if (props) Object.assign(s, props);
  return s;
}

function makeFunction(name, props) {
  return Object.assign({ id: newId(), name, type: 'None', variable: '', params: [], body: [] }, props || {});
}

/* Values returned by a function: [{name, type, array?, dims?}] (empty = procedure).
   type/variable stay aligned with the first value, as in the .fprg format. */
function rets(f) {
  if (Array.isArray(f.returns) && f.returns.length) return f.returns;
  return f.type && f.type !== 'None' ? [{ name: f.variable || '', type: f.type }] : [];
}
function setRets(f, list) {
  f.returns = list.map((r) => (r.array ? { name: r.name, type: r.type, array: true, dims: r.dims || 1 } : { name: r.name, type: r.type }));
  f.type = list.length ? list[0].type : 'None';
  f.variable = list.length ? list[0].name : '';
}

/* ------------------------- Classes (Objects view) ------------------------
   prog.classes = [{ id, name, parent, attributes: [...], x, y }]
   attribute: { name, type, array, size, visibility, static, init }
   The methods stay in prog.functions (so editor and interpreter treat them
   as functions) with: cls = id of the class, visibility, static, ctor.
   Main stays prog.functions[0]: it is the static method of the main class. */
const VISIBILITY = { public: '+', private: '-', protected: '#' };
const VIS_IT = { public: L('model.public'), private: L('model.private'), protected: L('model.protected') };

/* tparams: type parameters of a generic class (e.g. ["T"]);
   module: { name, src } if the class comes from an imported module (read-only) */
function makeClass(name, props) {
  return Object.assign({ id: newId(), name, parent: '', abstract: false, tparams: [], module: null, attributes: [], x: 40, y: 40 }, props || {});
}
/* is "T" a type parameter of class c? */
const isTypeParam = (c, t) => !!c && (c.tparams || []).some((p) => p.toLowerCase() === String(t).toLowerCase());
/* name of the class with the type parameters: ArrayList<T> */
const classTitle = (c) => (c.tparams && c.tparams.length ? `${c.name}<${c.tparams.join(', ')}>` : c.name);
/* parent class with its type arguments: Lista<T>, Lista<Integer> (c.pargs: types written with the Generic Types of c) */
const parentTitle = (c) => (c.parent ? c.parent + ((c.pargs || []).length ? `<${c.pargs.join(', ')}>` : '') : '');
/* type with the names of the map replaced (keys in lowercase): T -> Integer, ArrayList<T> -> ArrayList<Integer> */
const substT = (t, map) => (map ? String(t).replace(/[A-Za-z_]\w*/g, (w) => (Object.prototype.hasOwnProperty.call(map, w.toLowerCase()) ? map[w.toLowerCase()] : w)) : String(t));
/* inheritance with Generic Types: for c and each of its parent classes, the meaning of their Generic Types written with
   those of c (Pila<T> extends Lista<T>: for Lista T -> T; ListaInteri extends Lista<Integer>: for Lista T -> Integer).
   Map class id -> { lowercase name of the Generic Type -> type }; for c itself the map is empty */
function chainMap(prog, c) {
  const out = new Map(), seen = new Set();
  let k = c, map = {};
  while (k && !seen.has(k)) {
    seen.add(k); out.set(k.id, map);
    const par = classByName(prog, k.parent);
    if (!par) break;
    const next = {};
    (par.tparams || []).forEach((p, i) => { next[p.toLowerCase()] = substT((k.pargs || [])[i] || p, map); });
    k = par; map = next;
  }
  return out;
}
/* imported modules: { name, src, classes: [...], funcs: [...] } (a module with only functions has only funcs) */
function modulesOf(prog) {
  const out = new Map();
  const get = (m) => { if (!out.has(m.name)) out.set(m.name, { name: m.name, src: m.src, classes: [], funcs: [] }); return out.get(m.name); };
  for (const c of prog.classes || []) if (c.module) get(c.module).classes.push(c);
  for (const f of prog.functions) if (f.module) get(f.module).funcs.push(f);
  return [...out.values()];
}
/* module a function or method comes from (null if it belongs to the program) */
const moduleOfFunc = (prog, f) => { if (!f) return null; if (f.module) return f.module; const c = classOf(prog, f); return c && c.module ? c.module : null; };
const isModuleFunc = (prog, f) => !!moduleOfFunc(prog, f);
function makeAttribute(props) {
  return Object.assign({ name: '', type: 'Integer', array: false, size: '', visibility: 'private', static: false, init: '' }, props || {});
}
const hasClasses = (prog) => Array.isArray(prog.classes) && prog.classes.length > 0;
function classById(prog, id) { return hasClasses(prog) ? prog.classes.find((c) => c.id === id) || null : null; }
function classByName(prog, name) {
  if (!name) return null;
  // Lista<T> is the class Lista
  const l = String(name).replace(/<.*$/s, '').trim().toLowerCase();
  // the predefined exceptions are classes always available
  return (hasClasses(prog) && prog.classes.find((c) => c.name.toLowerCase() === l)) || excClass(l);
}
/* is the class (or the name) an exception? */
const isExcClass = (prog, c) => { const k = typeof c === 'string' ? classByName(prog, c) : c; return !!k && chainOf(prog, k).some((x) => x.builtin && x.name === 'Exception'); };
const classOf = (prog, f) => classById(prog, f.cls);
const mainClass = (prog) => classOf(prog, prog.functions[0]);
const membersOf = (prog, c) => prog.functions.filter((f) => f.cls === c.id);
/* Objects view: the functions of a module with only functions belong to no class, and can be called from every class */
const isGlobalFunc = (prog, f) => !!f && !!f.module && !f.cls && hasClasses(prog);
const globalFuncs = (prog) => (hasClasses(prog) ? prog.functions.filter((f) => f.module && !f.cls) : []);
/* inheritance chain: the class, then the parent, the grandparent... (stops on cycles) */
function chainOf(prog, c) {
  const out = [];
  while (c && !out.includes(c)) { out.push(c); c = classByName(prog, c.parent); }
  return out;
}
const isSubclass = (prog, c, of) => chainOf(prog, c).includes(of);
/* class name derived from the program name: "Grade average" -> "GradeAverage" */
function defaultClassName(prog) {
  const words = String(prog.attrs.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^A-Za-z0-9_]+/).filter(Boolean);
  let n = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  if (!/^[A-Za-z_]/.test(n)) n = '';
  return n || L('model.program');
}
/* Objects view: all the functions become static methods of a single class */
function wrapInClass(prog) {
  const c = makeClass(defaultClassName(prog));
  prog.classes = [c];
  for (const f of prog.functions) if (!f.module) Object.assign(f, { cls: c.id, visibility: 'public', static: true, ctor: false });
  return c;
}
/* a single class with only public static methods: equivalent to the program with functions */
function isTrivialOO(prog) {
  if (!hasClasses(prog)) return true;
  if (prog.classes.length !== 1) return false;
  const c = prog.classes[0];
  if (c.parent || c.abstract || c.attributes.length || (c.tparams || []).length || c.module) return false;
  return prog.functions.every((f) => (f.module && !f.cls) || f.cls === c.id && f.static && !f.ctor && (f.visibility || 'public') === 'public');
}
/* as above and with the default name: it is saved in the standard format without losing anything */
/* inherited abstract methods not defined yet: [{ f, owner }] (for a concrete class they must be zero) */
function missingAbstract(prog, c) {
  // the types of the parent classes written with the Generic Types of c (add(x: T) of Lista<T> is add(x: Integer) for ListaInteri)
  const cm = chainMap(prog, c);
  const sig = (f, k) => f.name.toLowerCase() + '(' + f.params.map((p) => substT(p.type, cm.get(k.id)).toLowerCase().replace(/\s+/g, '') + (p.array ? '[' + (p.dims || 1) : '')).join(',') + ')';
  const best = new Map(); // signature -> most derived version
  for (const k of chainOf(prog, c)) for (const f of membersOf(prog, k)) if (!f.ctor && !f.static && !best.has(sig(f, k))) best.set(sig(f, k), { f, owner: k });
  return [...best.values()].filter((x) => x.f.abstract);
}
const isPlainOO = (prog) => isTrivialOO(prog) && (!hasClasses(prog) || prog.classes[0].name === defaultClassName(prog));
function unwrapClasses(prog) {
  delete prog.classes;
  for (const f of prog.functions) { delete f.cls; delete f.visibility; delete f.static; delete f.ctor; }
}
/* usable types: the four base ones and, in the Objects view, the classes */
const typeList = (prog) => ['Integer', 'Real', 'String', 'Boolean', ...(hasClasses(prog) ? prog.classes.map((c) => c.name) : [])];

function newProgram() {
  return {
    attrs: { name: '', authors: '', about: '', created: '', edited: '' },
    functions: [makeFunction('Main')],
  };
}

/* Deep copy with new ids (for copy/paste) */
function cloneStmt(s, keepIds) {
  const c = JSON.parse(JSON.stringify(s));
  if (!keepIds) reId(c);
  return c;
}
function reId(s) {
  s.id = newId();
  if (s.catches) s.catches.forEach((c) => { c.id = newId(); });
  for (const arr of childArrays(s)) arr.forEach(reId);
}

/* Recursive visit of all the blocks */
function walk(stmts, fn, parent) {
  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i];
    fn(s, stmts, i, parent);
    for (const arr of childArrays(s)) walk(arr, fn, s);
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
  if (err) throw new Error(L('model.theFileIsNotValidXml'));
  const root = doc.documentElement;
  if (root.nodeName.toLowerCase() !== FPRG_ROOT) throw new Error(L('model.theFileIsNotAValid'));
  _skipped = [];
  _classNames = new Map(); _typeParams = new Set();
  const prog = { attrs: { name: '', authors: '', about: '', created: '', edited: '' }, functions: [], fileversion: root.getAttribute('fileversion') || '' };
  // FlowLab extension: classes (read first, because the types can name them)
  const clsEl = [...root.children].find((el) => el.nodeName.toLowerCase() === 'flowlab-classes');
  if (clsEl) {
    prog.classes = [];
    for (const c of clsEl.children) if (c.nodeName.toLowerCase() === 'class') {
      const tp = (c.getAttribute('tparams') || '').split(',').map((x) => x.trim()).filter((x) => /^[A-Za-z_]\w*$/.test(x));
      const mod = (c.getAttribute('module') || '').trim();
      const cl = makeClass((c.getAttribute('name') || '').trim(), { parent: (c.getAttribute('parent') || '').trim(), _pargs: c.getAttribute('parent-args') || '', abstract: boolAttr(c.getAttribute('abstract'), false), tparams: tp, module: mod ? { name: mod, src: c.getAttribute('module-src') || '' } : null, x: +c.getAttribute('x') || 40, y: +c.getAttribute('y') || 40 });
      for (const t of tp) _typeParams.add(t.toLowerCase());
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
      // the parent class can also be a predefined exception
      const par = _classNames.get(cl.parent.toLowerCase()) || (excClass(cl.parent) || {}).name; cl.parent = par && par.toLowerCase() !== cl.name.toLowerCase() ? par : '';
      // type arguments of a generic parent class (Lista<T>): separated by ;
      const pa = cl._pargs.split(';').map((x) => x.trim()).filter(Boolean);
      if (cl.parent && pa.length) cl.pargs = pa.map((t) => normType(t));
      delete cl._pargs;
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
      // function imported from a module with only functions
      const fm = (el.getAttribute('flowlab-module') || '').trim();
      if (fm) f.module = { name: fm, src: el.getAttribute('flowlab-module-src') || '' };
      // generic function: type parameters, valid in its parameters and in its body
      const ftp = (el.getAttribute('flowlab-tparams') || '').split(',').map((x) => x.trim()).filter((x) => /^[A-Za-z_]\w*$/.test(x));
      const savedTP = _typeParams;
      if (ftp.length) { f.tparams = ftp;  _typeParams = new Set([..._typeParams, ...ftp.map((t) => t.toLowerCase())]); f.type = normType(el.getAttribute('type'), true); }
      if (prog.classes) {
        // the functions of a module with only functions stay outside the classes (also those saved inside the main class)
        const owner = !f.module && classByName(prog, el.getAttribute('flowlab-class'));
        if (owner) f.cls = owner.id;
        const vis = (el.getAttribute('flowlab-visibility') || 'public').toLowerCase();
        f.visibility = VISIBILITY[vis] ? vis : 'public';
        f.static = boolAttr(el.getAttribute('flowlab-static'), false);
        f.ctor = boolAttr(el.getAttribute('flowlab-ctor'), false);
        f.abstract = !f.ctor && !f.static && boolAttr(el.getAttribute('flowlab-abstract'), false);
      }
      // FlowLab extension: several return values, "name:Type;name:Type"
      const multi = el.getAttribute('flowlab-returns');
      if (multi) {
        // a return value can be an array: "v:Integer[]", "m:Real[,]"
        const list = multi.split(';').map((x) => x.trim()).filter(Boolean).map((x) => {
          const k = x.indexOf(':'); const n = k < 0 ? x : x.slice(0, k); let t = k < 0 ? '' : x.slice(k + 1).trim();
          const am = /\[(,*)\]$/.exec(t); if (am) t = t.slice(0, am.index);
          return am ? { name: n.trim(), type: normType(t), array: true, dims: am[1].length + 1 } : { name: n.trim(), type: normType(t) };
        }).filter((r) => r.name);
        if (list.length > 1 || list.some((r) => r.array)) setRets(f, list);
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
      _typeParams = savedTP;
      prog.functions.push(f);
    }
  }
  prog.skipped = _skipped;
  if (!prog.functions.length) prog.functions.push(makeFunction('Main'));
  const mi = prog.functions.findIndex((f) => f.name.toLowerCase() === 'main' && !f.ctor);
  if (mi > 0) prog.functions.unshift(prog.functions.splice(mi, 1)[0]);
  if (mi < 0) prog.functions.unshift(makeFunction('Main'));
  if (prog.classes) {
    // methods without a class: they go in the class of the Main (or in the first one)
    const home = classOf(prog, prog.functions[0]) || prog.classes[0];
    for (const f of prog.functions) if (!f.module && !classById(prog, f.cls)) Object.assign(f, { cls: home.id, static: f.static || f === prog.functions[0], ctor: false });
    Object.assign(prog.functions[0], { static: true, ctor: false, visibility: 'public' });
  }
  _classNames = new Map();
  _typeParams = new Set();
  return prog;
}

let _classNames = new Map();
let _typeParams = new Set(); // type parameters of the generic classes of the file
function normType(t, allowNone) {
  // generic type: ArrayList<Integer>, Pair<T, String>
  const g = _MX.splitType(t);
  if (g.args.length) return _MX.joinType(normType(g.base), g.args.map((a) => normType(a)));
  const l = String(t || '').trim().toLowerCase();
  if (_typeParams.has(l)) return String(t).trim();
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
    // FlowLab extension: constant = <declare flowlab-const="True"/> followed by the assignment of the value
    if (c.nodeName.toLowerCase() === 'declare' && String(c.getAttribute('flowlab-const')).toLowerCase() === 'true') {
      const name = (c.getAttribute('name') || '').trim();
      const nx = kids[i + 1];
      let expression = '';
      if (nx && nx.nodeName.toLowerCase() === 'assign' && (nx.getAttribute('variable') || '').trim().toLowerCase() === name.toLowerCase()) { expression = nx.getAttribute('expression') || ''; i++; }
      out.push(makeStmt('const', { name, type: normType(c.getAttribute('type')), expression }));
      continue;
    }
    // FlowLab extension: declaration with initial value = <declare flowlab-init="True"/> followed
    // by an assignment for each name, all with the same expression
    if (c.nodeName.toLowerCase() === 'declare' && String(c.getAttribute('flowlab-init')).toLowerCase() === 'true' && !boolAttr(c.getAttribute('array'), false)) {
      const names = (c.getAttribute('name') || '').split(',').map((x) => x.trim()).filter(Boolean);
      const as = kids.slice(i + 1, i + 1 + names.length);
      const expr = as[0] ? as[0].getAttribute('expression') || '' : '';
      if (names.length && as.length === names.length && as.every((a, k) => a.nodeName.toLowerCase() === 'assign' && (a.getAttribute('variable') || '').trim().toLowerCase() === names[k].toLowerCase() && (a.getAttribute('expression') || '') === expr)) {
        const d = parseStmt(c); d.init = expr; out.push(d); i += names.length;
        continue;
      }
    }
    // FlowLab extension: array with its values = <declare flowlab-values="{…}"/> followed by an assignment for each element
    if (c.nodeName.toLowerCase() === 'declare' && c.getAttribute('flowlab-values') != null && boolAttr(c.getAttribute('array'), false)) {
      const d = parseStmt(c), vals = c.getAttribute('flowlab-values') || '';
      d.init = vals;
      if (String(c.getAttribute('flowlab-autosize')).toLowerCase() === 'true') d.size = '';
      let n = 0; try { n = _MX.parseArrayLit(vals).leaves.length * d.name.split(',').filter((x) => x.trim()).length; } catch (e) { n = 0; }
      let k = 0; while (k < n && kids[i + 1 + k] && kids[i + 1 + k].nodeName.toLowerCase() === 'assign') k++;
      out.push(d); i += k;
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
    // FlowLab extension: exceptions
    case 'throw': return makeStmt('throw', { expression: S('expression') });
    case 'try': {
      const s = makeStmt('try', { catches: [] });
      for (const c of el.children) {
        const t = c.nodeName.toLowerCase();
        if (t === 'body') s.body = parseBlock(c);
        else if (t === 'catch') s.catches.push(makeCatch({ type: (c.getAttribute('type') || 'Exception').trim(), variable: (c.getAttribute('variable') || 'e').trim(), body: parseBlock(c) }));
        else if (t === 'finally') { s.hasFinally = true; s.finally = parseBlock(c); }
      }
      if (!s.catches.length && !s.hasFinally) s.catches.push(makeCatch());
      return s;
    }
  }
  return null; // unknown element: ignored
}

/* Serialization */
const _MX = (typeof module !== 'undefined') ? require('./expr.js') : ExprLib;
/* the .fprg format only allows strings between double quotes: 'text' becomes "text" */
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
  // a class that contains only static functions is saved in the standard format
  const oo = !isPlainOO(prog);
  if (oo) {
    L.push('    <flowlab-classes>');
    for (const c of prog.classes) {
      const gen = (c.tparams || []).length ? ` tparams="${xmlEsc(c.tparams.join(','))}"` : '';
      const mod = c.module ? ` module="${xmlEsc(c.module.name)}" module-src="${xmlEsc(c.module.src || '')}"` : '';
      const pa = c.parent && (c.pargs || []).length ? ` parent-args="${xmlEsc(c.pargs.join(';'))}"` : '';
      const head = `        <class name="${xmlEsc(c.name)}" parent="${xmlEsc(c.parent || '')}"${pa}${c.abstract ? ' abstract="True"' : ''}${gen}${mod} x="${Math.round(c.x || 0)}" y="${Math.round(c.y || 0)}"`;
      if (!c.attributes.length) { L.push(head + '/>'); continue; }
      L.push(head + '>');
      for (const a of c.attributes) L.push(`            <attribute name="${xmlEsc(a.name)}" type="${xmlEsc(a.type)}" array="${TF(a.array)}" size="${xmlEsc(a.array ? fgExpr(a.size) : '')}" visibility="${a.visibility}" static="${TF(a.static)}" init="${xmlEsc(fgExpr(a.init || ''))}"/>`);
      L.push('        </class>');
    }
    L.push('    </flowlab-classes>');
  }
  for (const f of prog.functions) {
    const rs = rets(f);
    let extra = rs.length > 1 || rs.some((r) => r.array) ? ` flowlab-returns="${xmlEsc(rs.map((r) => r.name + ':' + r.type + (r.array ? `[${','.repeat((r.dims || 1) - 1)}]` : '')).join(';'))}"` : '';
    if ((f.tparams || []).length) extra += ` flowlab-tparams="${xmlEsc(f.tparams.join(','))}"`;
    if (f.module) extra += ` flowlab-module="${xmlEsc(f.module.name)}" flowlab-module-src="${xmlEsc(f.module.src || '')}"`;
    if (oo) { const c = classOf(prog, f); extra += ` flowlab-class="${xmlEsc(c ? c.name : '')}" flowlab-visibility="${f.visibility || 'public'}" flowlab-static="${TF(!!f.static)}"${f.ctor ? ' flowlab-ctor="True"' : ''}${f.abstract ? ' flowlab-abstract="True"' : ''}`; }
    // for procedures the name possibly left in "variable" by other editors is kept
    L.push(`    <function name="${xmlEsc(f.name)}" type="${xmlEsc(rs.length ? rs[0].type : 'None')}" variable="${xmlEsc(rs.length ? rs[0].name : (f.variable || ''))}"${extra}>`);
    if (f.params.length) {
      L.push('        <parameters>');
      for (const p of f.params) L.push(`            <parameter name="${xmlEsc(p.name)}" type="${xmlEsc(p.type)}" array="${TF(p.array)}"${p.array && (p.dims || 1) > 1 ? ` flowlab-dims="${p.dims}"` : ''}/>`);
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
      case 'declare':
        if (!s.array && String(s.init || '').trim()) {
          // the other editors see the declaration and an assignment for each variable
          open('declare', [['name', s.name], ['type', s.type], ['array', 'False'], ['size', ''], ['flowlab-init', 'True']]);
          for (const n of s.name.split(',').map((x) => x.trim()).filter(Boolean)) open('assign', [['variable', n], ['expression', s.init]]);
        } else if (s.array && String(s.init || '').trim()) {
          // array with its values: the other editors see the declaration with the size and an assignment for each element
          let lit = null; try { lit = _MX.parseArrayLit(s.init); } catch (e) { lit = null; }
          const auto = !String(s.size || '').trim();
          open('declare', [['name', s.name], ['type', s.type], ['array', 'True'], ['size', auto && lit ? lit.dims.join(', ') : s.size], ['flowlab-init', 'True'], ['flowlab-values', s.init], ...(auto ? [['flowlab-autosize', 'True']] : [])]);
          if (lit) for (const n of s.name.split(',').map((x) => x.trim()).filter(Boolean)) {
            lit.leaves.forEach((v, k) => {
              const ix = []; let r = k; for (let d = lit.dims.length - 1; d >= 0; d--) { ix.unshift(r % lit.dims[d]); r = Math.floor(r / lit.dims[d]); }
              open('assign', [['variable', `${n}[${ix.join(', ')}]`], ['expression', v]]);
            });
          }
        } else open('declare', [['name', s.name], ['type', s.type], ['array', TF(s.array)], ['size', s.array ? s.size : '']]);
        break;
      case 'assign': open('assign', [['variable', s.variable], ['expression', s.expression]]); break;
      case 'const':
        // the other editors see a declared and assigned variable: the program stays runnable
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
      case 'throw': open('throw', [['expression', s.expression]]); break;
      case 'try': {
        const tag = (t, arr, attrs) => {
          const a = (attrs || []).map(([k, v]) => ` ${k}="${xmlEsc(v)}"`).join('');
          if (!arr.length) { L.push(`${ind}    <${t}${a}/>`); return; }
          L.push(`${ind}    <${t}${a}>`); writeBlock(arr, L, depth + 2); L.push(`${ind}    </${t}>`);
        };
        L.push(`${ind}<try>`);
        tag('body', s.body);
        for (const c of s.catches || []) tag('catch', c.body, [['type', c.type], ['variable', c.variable]]);
        if (s.hasFinally) tag('finally', s.finally);
        L.push(`${ind}</try>`);
        break;
      }
    }
  }
}

/* Features of the extended .fprg format used by the program */
function extendedFeatures(prog) {
  const out = new Set();
  if (!isPlainOO(prog)) out.add(L('model.classesAndObjects'));
  if ((prog.classes || []).some((c) => (c.tparams || []).length)) out.add(L('model.classesWithGenericTypes'));
  if (prog.functions.some((f) => (f.tparams || []).length)) out.add(L('model.functionsWithGenericTypes'));
  if ((prog.classes || []).some((c) => c.module) || prog.functions.some((f) => f.module)) out.add(L('model.importedModules'));
  for (const f of prog.functions) {
    if (rets(f).length > 1) out.add(L('model.functionsWithSeveralReturnValues'));
    if (rets(f).some((r) => r.array)) out.add(L('model.functionsReturningArrays'));
    walk(f.body, (s) => { if (s.kind === 'try' || s.kind === 'throw') out.add(L('model.exceptionsTryCatchFinallyThrow')); });
    if (f.params.some((p) => p.array && (p.dims || 1) > 1)) out.add(L('model.multiDimensionalArrays'));
    walk(f.body, (s) => {
      if (s.kind === 'const') out.add(L('model.constants'));
      if (s.kind === 'declare' && String(s.init || '').trim()) out.add(L('model.declarationsWithAnInitialValue'));
      if (s.kind === 'declare' && s.array && (_MX.splitTop(s.size || '').length > 1 || (() => { try { return _MX.parseArrayLit(s.init || '').dims.length > 1; } catch (e) { return false; } })())) out.add(L('model.multiDimensionalArrays'));
      for (const k of ['variable', 'expression', 'start', 'end', 'step', 'size']) {
        // xor is not part of the standard format
        if (typeof s[k] === 'string' && /xor|⊕|⊻/i.test(s[k])) { try { if (_MX.tokenize(s[k]).some((t) => t.k === 'op' && t.v === 'xor')) out.add(L('model.theXorOperator')); } catch (e) { /* incomplete expression */ } }
        if (typeof s[k] !== 'string' || !s[k].includes('[')) continue;
        try { const visit = (n) => { if (!n || typeof n !== 'object') return; if (n.k === 'var' && n.indices && n.indices.length > 1) out.add(L('model.multiDimensionalArrays')); Object.values(n).forEach(visit); }; (k === 'variable' ? _MX.parseLValueList(s[k]) : [_MX.parseExpr(s[k])]).forEach(visit); } catch (e) { /* incomplete expression */ }
      }
    });
  }
  return [...out];
}

/* Completeness of a block (required fields filled in) */
function isIncomplete(s) {
  switch (s.kind) {
    case 'declare': return !s.name.trim() || (s.array && !String(s.size).trim() && !String(s.init || '').trim());
    case 'const': return !s.name.trim() || !String(s.expression).trim();
    case 'assign': return !s.variable.trim() || !s.expression.trim();
    case 'input': case 'read': return !s.variable.trim();
    case 'output': case 'if': case 'while': case 'do': case 'call': case 'open': case 'write': case 'throw':
      return !String(s.expression).trim();
    case 'for': return !s.variable.trim() || !s.start.trim() || !s.end.trim();
    case 'breakpoint': return !s.always && !s.expression.trim();
    default: return false;
  }
}

const ModelLib = { parentTitle, substT, chainMap, isGlobalFunc, globalFuncs, FPRG_ROOT, KINDS, EXCEPTIONS, EXC_CLASSES, excClass, isExcClass, childArrays, makeCatch, VISIBILITY, VIS_IT, makeClass, isTypeParam, classTitle, modulesOf, isModuleFunc, moduleOfFunc, makeAttribute, hasClasses, classById, classByName, classOf, mainClass, membersOf, chainOf, isSubclass, defaultClassName, wrapInClass, isTrivialOO, isPlainOO, missingAbstract, unwrapClasses, typeList, extendedFeatures, rets, setRets, fgExpr, newId, makeStmt, makeFunction, newProgram, cloneStmt, reId, walk, findStmt, parseFprg, serializeFprg, isIncomplete, normType };
if (typeof module !== 'undefined') module.exports = ModelLib;
