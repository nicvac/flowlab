/* ==========================================================================
   FlowLab — expression engine
   Lexer, parser (precedences compatible with the .fprg files), typed values,
   built-in functions, generator-based evaluator (to run user functions
   step by step inside the expressions) and static type inference.
   ========================================================================== */
'use strict';
if (typeof L === 'undefined' && typeof require !== 'undefined') require('./i18n.js'); // testi tradotti (in Node: italiano)

class FlowError extends Error {
  constructor(msg, extra) { super(msg); Object.assign(this, extra || {}); }
}

const TYPES = ['Integer', 'Real', 'String', 'Boolean'];
const TYPE_IT = { Integer: L('expr.integer'), Real: L('expr.real'), String: L('expr.string'), Boolean: L('expr.boolean'), None: L('expr.none'), Object: L('expr.object') };
/* ---- generic types: "ArrayList<Integer>", "Pair<String, Point>"; "T" is a type parameter ---- */
const BASE_OF = { intero: 'Integer', reale: 'Real', stringa: 'String', booleano: 'Boolean', integer: 'Integer', real: 'Real', string: 'String', boolean: 'Boolean' };
/* splits at the first level on the commas: "String, Pair<A, B>" -> ["String", "Pair<A, B>"] */
function splitTypeList(s) {
  const out = []; let d = 0, cur = '';
  for (const ch of String(s)) {
    if (ch === '<') d++;
    if (ch === '>') d--;
    if (ch === ',' && d === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
/* { base, args }: "ArrayList<Integer>" -> { base: "ArrayList", args: ["Integer"] } */
function splitType(t) {
  const s = String(t == null ? '' : t).trim(), i = s.indexOf('<');
  if (i < 0 || !s.endsWith('>')) return { base: s, args: [] };
  return { base: s.slice(0, i).trim(), args: splitTypeList(s.slice(i + 1, -1)) };
}
const joinType = (base, args) => (args && args.length ? `${base}<${args.join(', ')}>` : base);
const isGenericType = (t) => splitType(t).args.length > 0;
/* readable name of a type: the base types in the chosen language, the classes with their name */
function typeName(t) {
  const { base, args } = splitType(t);
  const b = TYPE_IT[base] || base;
  return args.length ? `${b}<${args.map(typeName).join(', ')}>` : b;
}
/* type written by the user (in any language) -> internal form: "ArrayList<intero>" -> "ArrayList<Integer>" */
function normTypeText(t) {
  const { base, args } = splitType(t);
  return joinType(BASE_OF[base.toLowerCase()] || base, args.map(normTypeText));
}
/* replaces the type parameters: subst("T[]"...) with map { t: "Integer" } (lowercase keys) */
function substType(t, map) {
  if (!map) return t;
  const { base, args } = splitType(t);
  if (!args.length) { const v = map[base.toLowerCase()]; return v !== undefined && v !== null ? v : t; }
  return joinType(base, args.map((a) => substType(a, map)));
}
/* same type (case does not matter) */
function sameType(a, b) {
  const x = splitType(a), y = splitType(b);
  if (x.base.toLowerCase() !== y.base.toLowerCase() || x.args.length !== y.args.length) return false;
  return x.args.every((t, i) => sameType(t, y.args[i]));
}
const isBaseType = (t) => TYPES.includes(t);

/* ---------------------------- Lexer ---------------------------------- */
const SYM = [
  ['<=', '<='], ['>=', '>='], ['==', '=='], ['!=', '!='], ['<>', '!='], ['&&', 'and'], ['||', 'or'],
  ['≤', '<='], ['≥', '>='], ['≠', '!='], ['∧', 'and'], ['∨', 'or'], ['⊕', 'xor'], ['⊻', 'xor'], ['¬', 'not'],
  ['×', '*'], ['∗', '*'], ['÷', '/'], ['⁄', '/'], ['∕', '/'], ['↑', '^'], ['⭡', '^'], ['−', '-'],
  ['(', '('], [')', ')'], ['[', '['], [']', ']'], [',', ','], ['<', '<'], ['>', '>'], ['=', '=='],
  ['&', '&'], ['+', '+'], ['-', '-'], ['*', '*'], ['/', '/'], ['%', '%'], ['^', '^'], ['!', 'not'], ['.', '.'],
];
const WORD_OPS = { and: 'and', or: 'or', xor: 'xor', not: 'not', mod: '%' };

/* the escape sequences of the strings: the character after the backslash -> the character it means */
const ESCAPES = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', "'": "'" };
/* a text written again as the inside of a string literal between double quotes (the escapes back) */
const escapeText = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r');
function tokenize(src) {
  const toks = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const start = i;
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let s = '';
      while (i < n && /[0-9]/.test(src[i])) s += src[i++];
      let real = false;
      if (src[i] === '.' && /[0-9]/.test(src[i + 1] || '')) {
        real = true; s += src[i++];
        while (i < n && /[0-9]/.test(src[i])) s += src[i++];
      } else if (src[i] === '.' && !/[A-Za-z_]/.test(src[i + 1] || '')) {
        real = true; i++; // "3." -> 3.0
      }
      if (/[eE]/.test(src[i] || '') && /[-+0-9]/.test(src[i + 1] || '')) {
        let j = i + 1; let e = 'e';
        if (/[-+]/.test(src[j])) e += src[j++];
        if (/[0-9]/.test(src[j] || '')) {
          while (j < n && /[0-9]/.test(src[j])) e += src[j++];
          s += e; i = j; real = true;
        }
      }
      toks.push({ k: 'num', v: Number(s), real, pos: start, text: s });
      continue;
    }
    if (c === '"' || c === "'") {
      // escape sequences: \n new line, \t tab, \r, \\ backslash, \" and \' the quotes (any other \x stays as it is)
      i++;
      let s = '';
      while (i < n && src[i] !== c) {
        if (src[i] === '\\' && i + 1 < n && ESCAPES[src[i + 1]] !== undefined) { s += ESCAPES[src[i + 1]]; i += 2; continue; }
        s += src[i++];
      }
      if (i >= n) throw new FlowError(L('expr.unterminatedStringTheClosingQuoteIs') + c, { pos: start });
      i++;
      toks.push({ k: 'str', v: s, pos: start, end: i, raw: src.slice(start + 1, i - 1) });
      continue;
    }
    if (/[\p{L}_]/u.test(c)) {
      let s = '';
      while (i < n && /[\p{L}\p{N}_]/u.test(src[i])) s += src[i++];
      const low = s.toLowerCase();
      if (WORD_OPS[low]) toks.push({ k: 'op', v: WORD_OPS[low], pos: start, text: s });
      else toks.push({ k: 'id', v: s, pos: start });
      continue;
    }
    let matched = false;
    for (const [sym, op] of SYM) {
      if (src.startsWith(sym, i)) {
        toks.push({ k: 'op', v: op, pos: start, text: sym });
        i += sym.length; matched = true; break;
      }
    }
    if (!matched) throw new FlowError(L('expr.invalidCharacter', { c }), { pos: start });
  }
  toks.push({ k: 'eof', pos: n });
  return toks;
}

/* ----------------------------- Parser ---------------------------------- */
/* Precedences (from the lowest):
   or < and < not < relational < & < + - < * / % < ^ < unary minus     */
function parseExpr(src) {
  if (src == null || String(src).trim() === '') throw new FlowError(L('expr.emptyExpression'));
  const toks = tokenize(String(src));
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v) => toks[p].k === 'op' && toks[p].v === v;
  const eat = (v) => {
    if (!isOp(v)) {
      const t = toks[p];
      throw new FlowError(t.k === 'eof' ? L('expr.isMissingAtTheEndOf', { v }) : L('expr.expectedButFound', { v, value: t.text ?? t.v }), { pos: t.pos });
    }
    return toks[p++];
  };
  const node = (o, t) => { o.pos = t ? t.pos : 0; return o; };

  function orE() {
    let l = xorE();
    while (isOp('or')) { const t = toks[p++]; l = node({ k: 'bin', op: 'or', l, r: xorE() }, t); }
    return l;
  }
  // xor: true when exactly one of the two is true; between or and and (a or b xor c and d = a or (b xor (c and d)))
  function xorE() {
    let l = andE();
    while (isOp('xor')) { const t = toks[p++]; l = node({ k: 'bin', op: 'xor', l, r: andE() }, t); }
    return l;
  }
  function andE() {
    let l = notE();
    while (isOp('and')) { const t = toks[p++]; l = node({ k: 'bin', op: 'and', l, r: notE() }, t); }
    return l;
  }
  function notE() {
    if (isOp('not')) { const t = toks[p++]; return node({ k: 'un', op: 'not', e: notE() }, t); }
    return relE();
  }
  function relE() {
    let l = catE();
    while (['==', '!=', '<', '<=', '>', '>='].some(isOp)) {
      const t = toks[p++]; l = node({ k: 'bin', op: t.v, l, r: catE() }, t);
    }
    return l;
  }
  function catE() {
    let l = addE();
    while (isOp('&')) { const t = toks[p++]; l = node({ k: 'bin', op: '&', l, r: addE() }, t); }
    return l;
  }
  function addE() {
    let l = mulE();
    while (isOp('+') || isOp('-')) { const t = toks[p++]; l = node({ k: 'bin', op: t.v, l, r: mulE() }, t); }
    return l;
  }
  function mulE() {
    let l = powE();
    while (isOp('*') || isOp('/') || isOp('%')) { const t = toks[p++]; l = node({ k: 'bin', op: t.v, l, r: powE() }, t); }
    return l;
  }
  function powE() {
    const l = unE();
    if (isOp('^')) { const t = toks[p++]; return node({ k: 'bin', op: '^', l, r: powE() }, t); }
    return l;
  }
  function unE() {
    if (isOp('-')) { const t = toks[p++]; return node({ k: 'un', op: 'neg', e: unE() }, t); }
    if (isOp('+')) { p++; return unE(); }
    if (isOp('not')) { const t = toks[p++]; return node({ k: 'un', op: 'not', e: unE() }, t); }
    return primary();
  }
  function args() {
    eat('(');
    const out = [];
    if (!isOp(')')) {
      out.push(orE());
      while (isOp(',')) { p++; out.push(orE()); }
    }
    eat(')');
    return out;
  }
  function indexList() {
    // indices: v[i]  m[i, j]  m[i][j]  (also mixed)
    const indices = [];
    while (isOp('[')) {
      p++;
      indices.push(orE());
      while (isOp(',')) { p++; indices.push(orE()); }
      eat(']');
    }
    return indices;
  }
  /* type arguments after "<": Integer, Pair<String, Point> ... up to ">" */
  function typeArg() {
    const t = peek();
    if (t.k !== 'id') throw new FlowError(L('expr.typesAreNeededBetweenAndE'), { pos: t.pos });
    p++;
    let s = BASE_OF[t.v.toLowerCase()] || t.v;
    if (isOp('<')) { p++; s = joinType(s, typeArgs()); }
    return s;
  }
  function typeArgs() {
    const out = [typeArg()];
    while (isOp(',')) { p++; out.push(typeArg()); }
    eat('>');
    return out;
  }
  /* atom followed by accesses with the dot: p.x  p.move(1, 2)  v[i].name  this.data[k] */
  function primary() {
    let e = atom();
    while (isOp('.')) {
      p++;
      const t = peek();
      if (t.k !== 'id') throw new FlowError(L('expr.afterTheDotTheNameOf'), { pos: t.pos });
      p++;
      if (isOp('(')) { e = node({ k: 'mcall', obj: e, name: t.v, args: args() }, t); continue; }
      if (isOp('[')) { const indices = indexList(); e = node({ k: 'member', obj: e, name: t.v, index: indices[0], indices }, t); continue; }
      e = node({ k: 'member', obj: e, name: t.v }, t);
    }
    return e;
  }
  function atom() {
    const t = peek();
    if (t.k === 'num') { p++; return node({ k: 'num', v: t.v, t: t.real ? 'Real' : 'Integer', text: t.text }, t); }
    if (t.k === 'str') { p++; return node({ k: 'str', v: t.v }, t); }
    if (isOp('(')) { p++; const e = orE(); eat(')'); return node({ k: 'par', e }, t); }
    if (t.k === 'id') {
      p++;
      const low = t.v.toLowerCase();
      if (low === 'true' || low === 'false') return node({ k: 'bool', v: low === 'true' }, t);
      if ((low === 'pi' || t.v === 'π') && !isOp('(')) return node({ k: 'pi' }, t);
      // programmazione a oggetti
      if (low === 'null') return node({ k: 'null' }, t);
      if (low === 'this') return node({ k: 'this' }, t);
      if (low === 'new' && peek().k === 'id') {
        const c = toks[p++];
        // new ArrayList<Integer>()  ·  new ArrayList<>() (type derived from the variable)
        let targs = null;
        if (isOp('<')) { p++; targs = typeArgs(); } else if (isOp('!=') && toks[p].text === '<>') { p++; targs = []; }
        return node({ k: 'new', cls: c.v, targs, args: isOp('(') ? args() : [] }, t);
      }
      if (low === 'super') {
        if (isOp('(')) return node({ k: 'supercall', args: args() }, t);
        if (isOp('.')) return node({ k: 'super' }, t);
        throw new FlowError(L('expr.superIsUsedAsSuperAt'), { pos: t.pos });
      }
      if (isOp('(')) return node({ k: 'call', name: t.v, args: args() }, t);
      if (isOp('[')) { const indices = indexList(); return node({ k: 'var', name: t.v, index: indices[0], indices }, t); }
      return node({ k: 'var', name: t.v }, t);
    }
    if (t.k === 'eof') throw new FlowError(L('expr.theExpressionEndsUnexpectedly'), { pos: t.pos });
    throw new FlowError(L('expr.unexpectedSymbol', { value: t.text ?? t.v }), { pos: t.pos });
  }

  const e = orE();
  if (peek().k !== 'eof') {
    const t = peek();
    throw new FlowError(L('expr.unexpectedSymbolAfterTheEndOf', { value: t.text ?? t.v }), { pos: t.pos });
  }
  return e;
}

/* Modifiable reference: name, name[index] or attribute of an object (p.x, this.v[i]) */
function parseLValue(src) {
  const e = parseExpr(src);
  const inner = e.k === 'par' ? e.e : e;
  if (inner.k !== 'var' && inner.k !== 'member') throw new FlowError(L('expr.theNameOfAVariablePossibly'));
  return inner;
}

/* Splits "a, b[i], c" on the first-level commas (not inside parentheses or quotes) */
function splitTop(src) {
  const out = []; let depth = 0, cur = '', q = null, esc = false;
  for (const ch of String(src)) {
    // inside a string: a quote after a backslash does not close it
    if (q) { cur += ch; if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}
/* initial values of an array, between braces: "{1, 2, 3}", "{{1, 2}, {3, 4}}" ->
   { dims: [2, 2], leaves: ["1", "2", "3", "4"] } (texts of the expressions, row by row); every row of the same length */
function parseArrayLit(src) {
  const s = String(src || '').trim();
  const node = (t) => {
    t = t.trim();
    if (!t.startsWith('{')) { if (!t) throw new FlowError(L('expr.aValueIsMissingInThe')); return t; }
    if (!t.endsWith('}')) throw new FlowError(L('expr.theValuesOfAnArrayGo'));
    const inner = t.slice(1, -1).trim();
    return inner ? splitTop(inner).map(node) : [];
  };
  if (!s.startsWith('{')) throw new FlowError(L('expr.theValuesOfAnArrayGo'));
  let level = [node(s)];
  const dims = [];
  while (level.length && Array.isArray(level[0])) {
    const n = level[0].length;
    if (level.some((x) => !Array.isArray(x) || x.length !== n)) throw new FlowError(L('expr.theRowsOfTheValuesMust'));
    dims.push(n);
    level = level.flat();
    if (!n) break;
  }
  if (level.some(Array.isArray)) throw new FlowError(L('expr.theRowsOfTheValuesMust'));
  return { dims, leaves: level };
}
function parseLValueList(src) {
  const parts = splitTop(src);
  if (parts.some((p) => !p)) throw new FlowError(L('expr.theNameOfAVariableIs'));
  const lvs = parts.map((p) => parseLValue(p));
  if (lvs.length > 1) {
    const seen = new Set();
    for (const lv of lvs) { if (lv.k !== 'var' || lv.index) continue; const k = lv.name.toLowerCase(); if (seen.has(k)) throw new FlowError(L('expr.theVariableAppearsMoreThanOnce', { name: lv.name })); seen.add(k); }
  }
  return lvs;
}

function validIdent(s) { return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(s); }

const RESERVED = new Set(['and', 'or', 'xor', 'not', 'mod', 'true', 'false', 'pi', 'π', 'integer', 'real', 'string', 'boolean', 'if', 'while', 'do', 'for', 'main', 'new', 'this', 'super', 'null']);

/* ------------------------------ Values --------------------------------- */
const V = {
  int: (v) => ({ t: 'Integer', v }),
  real: (v) => ({ t: 'Real', v }),
  str: (v) => ({ t: 'String', v }),
  bool: (v) => ({ t: 'Boolean', v }),
  obj: (o) => ({ t: 'Object', v: o }), // reference to an object (o = null for null)
};
const isNum = (x) => x.t === 'Integer' || x.t === 'Real';

function fmtReal(x) {
  if (!isFinite(x)) return isNaN(x) ? 'NaN' : (x > 0 ? 'Infinity' : '-Infinity');
  const r = Number(x.toPrecision(15));
  let s = String(r);
  if (/e/.test(s)) {
    const [m, ex] = s.split('e');
    s = m + 'E' + (ex[0] === '-' ? '-' : '+') + ex.replace(/^[-+]/, '').padStart(2, '0');
  }
  return s;
}
function fmtValue(x) {
  if (x == null) return '';
  switch (x.t) {
    case 'Integer': return String(x.v);
    case 'Real': return fmtReal(x.v);
    case 'Boolean': return x.v ? 'true' : 'false';
    case 'Object': return x.v ? `${x.v.cls.name}#${x.v.id}` : 'null';
    default: return String(x.v);
  }
}
function literalOf(x) {
  return x.t === 'String' ? '"' + escapeText(x.v) + '"' : fmtValue(x);
}
function checkInt(v, node) {
  if (!Number.isSafeInteger(v)) throw new FlowError(L('expr.overflowTheIntegerResultIsToo'), { node });
  return V.int(v);
}

/* Conversion for assignment/parameters */
/* isA(objectClass, typeName): compatibility check for class types (provided by the interpreter) */
function coerce(val, type, what, isA) {
  if (!isBaseType(type)) {
    if (val.t !== 'Object') throw new FlowError(L('expr.incompatibleTypesIsButAnObject', { value: what || L('expr.theValue'), t: typeName(val.t), type }));
    if (val.v && isA && !isA(val.v.cls, type)) throw new FlowError(L('expr.incompatibleTypesIsAnObjectWhich', { value: what || L('expr.theValue'), name: val.v.cls.name, type }));
    return val;
  }
  if (val.t === type) return val;
  if (type === 'Real' && val.t === 'Integer') return V.real(val.v);
  if (type === 'Integer' && val.t === 'Real') return V.int(Math.trunc(val.v));
  const got = val.t === 'Object' ? (val.v ? L('expr.anObject', { name: val.v.cls.name }) : 'null') : typeName(val.t);
  throw new FlowError(L('expr.incompatibleTypesIsButIsNeeded', { value: what || L('expr.theValue'), got, type: typeName(type) }));
}

/* Conversion of the text typed by the user */
function parseInputText(text, type) {
  const s = String(text).trim();
  switch (type) {
    case 'Integer':
      if (!/^[-+]?\d+$/.test(s)) throw new FlowError(L('expr.isNotAValidInteger', { text }));
      return checkInt(parseInt(s, 10));
    case 'Real': {
      const t = s.replace(',', '.');
      if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) throw new FlowError(L('expr.isNotAValidRealNumber', { text }));
      return V.real(parseFloat(t));
    }
    case 'Boolean': {
      const l = s.toLowerCase();
      if (['true', 'vero', 'v', 't', '1', 'sì', 'si', 'yes'].includes(l)) return V.bool(true);
      if (['false', 'falso', 'f', '0', 'no'].includes(l)) return V.bool(false);
      throw new FlowError(L('expr.isNotABooleanValueUse', { text }));
    }
    case 'String': return V.str(String(text));
    default: throw new FlowError(L('expr.anObjectCannotBeReadFrom', { type }));
  }
}

/* ------------------------- Built-in functions -------------------------- */
const N = 'Number';
function num(x) { return x.v; }
function realRes(v, node) {
  if (isNaN(v)) throw new FlowError(L('expr.invalidValueForTheFunctionUndefined'), { node });
  return V.real(v);
}
/* the smallest (or largest) of the numbers: Integer if they are all Integer */
function pickNum(a, better) {
  let best = a[0];
  for (const x of a.slice(1)) if (better(num(best), num(x))) best = x;
  return a.every((x) => x.t === 'Integer') ? V.int(best.v) : V.real(num(best));
}
/* soft: a function added after the first versions; a function of the program with the same name (written before) wins */
const BUILTINS = {
  abs:      { sig: [N], ret: (a) => a[0], fn: (a) => (a[0].t === 'Integer' ? V.int(Math.abs(a[0].v)) : V.real(Math.abs(a[0].v))), doc: L('expr.absNAbsoluteValue') },
  arccos:   { sig: [N], ret: 'Real', fn: (a, n) => realRes(Math.acos(num(a[0])), n), doc: L('expr.arccosNArcCosineRadians') },
  arcsin:   { sig: [N], ret: 'Real', fn: (a, n) => realRes(Math.asin(num(a[0])), n), doc: L('expr.arcsinNArcSineRadians') },
  arctan:   { sig: [N], ret: 'Real', fn: (a) => V.real(Math.atan(num(a[0]))), doc: L('expr.arctanNArcTangentRadians') },
  cos:      { sig: [N], ret: 'Real', fn: (a) => V.real(Math.cos(num(a[0]))), doc: L('expr.cosNCosineRadians') },
  sin:      { sig: [N], ret: 'Real', fn: (a) => V.real(Math.sin(num(a[0]))), doc: L('expr.sinNSineRadians') },
  tan:      { sig: [N], ret: 'Real', fn: (a) => V.real(Math.tan(num(a[0]))), doc: L('expr.tanNTangentRadians') },
  cosh:     { sig: [N], ret: 'Real', fn: (a) => V.real(Math.cosh(num(a[0]))), doc: L('expr.coshNHyperbolicCosine') },
  sinh:     { sig: [N], ret: 'Real', fn: (a) => V.real(Math.sinh(num(a[0]))), doc: L('expr.sinhNHyperbolicSine') },
  tanh:     { sig: [N], ret: 'Real', fn: (a) => V.real(Math.tanh(num(a[0]))), doc: L('expr.tanhNHyperbolicTangent') },
  arccosh:  { sig: [N], ret: 'Real', fn: (a, n) => realRes(Math.acosh(num(a[0])), n), doc: 'Arccosh(n)' },
  arcsinh:  { sig: [N], ret: 'Real', fn: (a) => V.real(Math.asinh(num(a[0]))), doc: 'Arcsinh(n)' },
  arctanh:  { sig: [N], ret: 'Real', fn: (a, n) => realRes(Math.atanh(num(a[0])), n), doc: 'Arctanh(n)' },
  int:      { sig: [N], ret: 'Integer', fn: (a, n) => checkInt(Math.trunc(num(a[0])), n), doc: L('expr.intNIntegerPartTruncatesThe') },
  ln:       { sig: [N], ret: 'Real', fn: (a, n) => { if (num(a[0]) <= 0) throw new FlowError(L('expr.lnTheArgumentMustBePositive'), { node: n }); return V.real(Math.log(num(a[0]))); }, doc: L('expr.lnNNaturalLogarithm') },
  log:      { sig: [N], ret: 'Real', fn: (a, n) => { if (num(a[0]) <= 0) throw new FlowError(L('expr.logTheArgumentMustBePositive'), { node: n }); return V.real(Math.log(num(a[0]))); }, doc: L('expr.logNNaturalLogarithm') },
  log10:    { sig: [N], ret: 'Real', fn: (a, n) => { if (num(a[0]) <= 0) throw new FlowError(L('expr.log10TheArgumentMustBePositive'), { node: n }); return V.real(Math.log10(num(a[0]))); }, doc: L('expr.log10NBase10Logarithm') },
  // Min and Max: two or more numbers; Integer if they are all Integer, otherwise Real
  min:      { soft: true, sig: [N, N], variadic: true, ret: 'IntIfAll', fn: (a) => pickNum(a, (x, y) => y < x), doc: L('expr.minAB') },
  max:      { soft: true, sig: [N, N], variadic: true, ret: 'IntIfAll', fn: (a) => pickNum(a, (x, y) => y > x), doc: L('expr.maxAB') },
  // Pow as the operator ^: Integer with an Integer base and an Integer exponent not negative
  pow:      { soft: true, sig: [N, N], ret: 'IntIfAll', fn: (a, n) => { const v = Math.pow(num(a[0]), num(a[1])); if (isNaN(v)) throw new FlowError(L('expr.powerNotDefinedNegativeBaseWith'), { node: n }); return a[0].t === 'Integer' && a[1].t === 'Integer' && a[1].v >= 0 ? checkInt(v, n) : V.real(v); }, doc: L('expr.powBE') },
  // the roundings give an Integer; Round: the half goes up (2.5 → 3, -2.5 → -2)
  round:    { soft: true, sig: [N], ret: 'Integer', fn: (a, n) => checkInt(Math.floor(num(a[0]) + 0.5), n), doc: L('expr.roundN') },
  floor:    { soft: true, sig: [N], ret: 'Integer', fn: (a, n) => checkInt(Math.floor(num(a[0])), n), doc: L('expr.floorN') },
  ceil:     { soft: true, sig: [N], ret: 'Integer', fn: (a, n) => checkInt(Math.ceil(num(a[0])), n), doc: L('expr.ceilN') },
  sgn:      { sig: [N], ret: 'Integer', fn: (a) => V.int(Math.sign(num(a[0])) | 0), doc: L('expr.sgnNSign10Or') },
  sqrt:     { sig: [N], ret: 'Real', fn: (a, n) => { if (num(a[0]) < 0) throw new FlowError(L('expr.sqrtSquareRootOfANegative'), { node: n }); return V.real(Math.sqrt(num(a[0]))); }, doc: L('expr.sqrtNSquareRoot') },
  random:   { sig: ['Integer'], ret: 'Integer', fn: (a, n) => { if (a[0].v <= 0) throw new FlowError(L('expr.randomTheArgumentMustBeGreater'), { node: n }); return V.int(Math.floor(Math.random() * a[0].v)); }, doc: L('expr.randomNRandomIntegerFrom0') },
  len:      { sig: ['String'], ret: 'Integer', fn: (a) => V.int([...a[0].v].length), doc: L('expr.lenSLengthOfTheString') },
  char:     { sig: ['String', 'Integer'], ret: 'String', fn: (a, n) => { const ch = [...a[0].v]; const i = a[1].v; if (i < 0 || i >= ch.length) throw new FlowError(L('expr.charIndexOutsideTheStringLength', { i, chCount: ch.length }), { node: n, exc: 'IndexOutOfRange' }); return V.str(ch[i]); }, doc: L('expr.charSICharacterAtPosition') },
  tochar:   { sig: ['Integer'], ret: 'String', fn: (a) => V.str(String.fromCodePoint(a[0].v)), doc: L('expr.tocharNCharacterWithCodeN') },
  tocode:   { sig: ['String'], ret: 'Integer', fn: (a, n) => { if (!a[0].v.length) throw new FlowError(L('expr.tocodeEmptyString'), { node: n }); return V.int(a[0].v.codePointAt(0)); }, doc: L('expr.tocodeSCodeOfTheFirst') },
  tofixed:  { sig: [N, 'Integer'], ret: 'String', fn: (a) => V.str(Number(num(a[0])).toFixed(Math.max(0, Math.min(20, a[1].v)))), doc: L('expr.tofixedRDNumberAsText') },
  tointeger:{ sig: ['String'], ret: 'Integer', fn: (a, n) => { try { return parseInputText(a[0].v, 'Integer'); } catch (e) { throw new FlowError(`ToInteger: ${e.message}`, { node: n, exc: 'InvalidConversion' }); } }, doc: L('expr.tointegerSConvertsTextToInteger') },
  toreal:   { sig: ['String'], ret: 'Real', fn: (a, n) => { try { return parseInputText(a[0].v, 'Real'); } catch (e) { throw new FlowError(`ToReal: ${e.message}`, { node: n, exc: 'InvalidConversion' }); } }, doc: L('expr.torealSConvertsTextToReal') },
  tostring: { sig: ['Any'], ret: 'String', fn: (a) => V.str(fmtValue(a[0])), doc: L('expr.tostringXConvertsToText') },
  size:     { sig: ['Array'], ret: 'Integer', fn: null, doc: L('expr.sizeANumberOfElementsOf') },
  eof:      { sig: [], ret: 'Boolean', fn: null, doc: L('expr.eofTrueIfTheFileBeing') },
};
const BUILTIN_NAMES = { abs: 'Abs', arccos: 'Arccos', arcsin: 'Arcsin', arctan: 'Arctan', cos: 'Cos', sin: 'Sin', tan: 'Tan', cosh: 'Cosh', sinh: 'Sinh', tanh: 'Tanh', arccosh: 'Arccosh', arcsinh: 'Arcsinh', arctanh: 'Arctanh', int: 'Int', ln: 'Ln', log: 'Log', log10: 'Log10', sgn: 'Sgn', min: 'Min', max: 'Max', pow: 'Pow', round: 'Round', floor: 'Floor', ceil: 'Ceil', sqrt: 'Sqrt', random: 'Random', len: 'Len', char: 'Char', tochar: 'ToChar', tocode: 'ToCode', tofixed: 'ToFixed', tointeger: 'ToInteger', toreal: 'ToReal', tostring: 'ToString', size: 'Size', eof: 'EOF' };

/* --------------------- Valutatore (a generatore) ----------------------- */
/* ctx: { getVar(name,node) -> cell, callUser*(name, argNodes, node) -> Value,
          hasUser(name), env: {eof()} }               */
function* evalE(node, ctx) {
  switch (node.k) {
    case 'num': return node.t === 'Integer' ? checkInt(node.v, node) : V.real(node.v);
    case 'str': return V.str(node.v);
    case 'bool': return V.bool(node.v);
    case 'pi': return V.real(Math.PI);
    case 'par': return yield* evalE(node.e, ctx);
    case 'null': return V.obj(null);
    case 'this': case 'member': case 'mcall': case 'new':
      if (!ctx.oo) throw new FlowError(L('expr.objectsNewAndThisAreUsed'), { node });
      return yield* ctx.oo(node);
    case 'super': throw new FlowError(L('expr.superIsUsedAsSuperMethod'), { node });
    case 'supercall': throw new FlowError(L('expr.superIsUsedOnlyInA'), { node });
    case 'var': {
      const cell = ctx.getVar(node.name, node);
      if (cell.array) {
        if (!node.index) throw new FlowError(L('expr.isAnArrayAnIndexIs', { name: node.name, name2: node.name, list: (cell.dims || [0]).map(() => 0).join(', ') }), { node });
        const ivs = [];
        for (const ix of node.indices) ivs.push(yield* evalE(ix, ctx));
        const off = arrOffset(ivs, cell, node);
        const item = cell.items[off];
        if (item === undefined) throw new FlowError(L('expr.theElementHasNoValueYet', { name: node.name, list: ivs.map((x) => x.v).join(', ') }), { node });
        return item;
      }
      if (node.index) throw new FlowError(L('expr.isNotAnArray', { name: node.name }), { node });
      if (cell.value === undefined) throw new FlowError(L('expr.theVariableHasNoValueYet', { name: node.name }), { node });
      return cell.value;
    }
    case 'un': {
      const x = yield* evalE(node.e, ctx);
      if (node.op === 'neg') {
        if (!isNum(x)) throw new FlowError(L('expr.theMinusSignAppliesOnlyTo', { value: TYPE_IT[x.t] }), { node });
        return x.t === 'Integer' ? checkInt(-x.v, node) : V.real(-x.v);
      }
      if (x.t !== 'Boolean') throw new FlowError(L('expr.notAppliesOnlyToBooleanValues', { value: TYPE_IT[x.t] }), { node });
      return V.bool(!x.v);
    }
    case 'bin': return yield* evalBin(node, ctx);
    case 'call': return yield* evalCall(node, ctx);
  }
  throw new FlowError(L('expr.unrecognizedExpression'));
}

/* position in the flat list of the elements (row order) */
function arrOffset(ivs, cell, node) {
  const dims = cell.dims || [cell.items.length];
  if (ivs.length !== dims.length) {
    throw new FlowError(dims.length === 1 ? L('expr.hasOnlyOneDimensionOnlyOne', { name: node.name, name2: node.name }) : L('expr.hasDimensionsIndicesAreNeededE', { name: node.name, dimsCount: dims.length, dimsCount2: dims.length, name2: node.name, list: dims.map((_, k) => 'ijklmn'[k] || 'x').join(', ') }), { node });
  }
  let off = 0;
  for (let k = 0; k < dims.length; k++) {
    const iv = ivs[k];
    if (iv.t !== 'Integer') throw new FlowError(L('expr.theIndicesOfMustBeIntegers', { name: node.name, value: TYPE_IT[iv.t] }), { node });
    if (iv.v < 0 || iv.v >= dims[k]) {
      throw new FlowError(dims.length === 1 ? L('expr.indexOutOfBoundsHasElements', { v: iv.v, name: node.name, value: dims[0], value2: dims[0] - 1 }) : L('expr.indexOutOfBoundsInDimension', { v: iv.v, value: k + 1, name: node.name, value2: dims[k] - 1 }), { node, exc: 'IndexOutOfRange' });
    }
    off = off * dims[k] + iv.v;
  }
  return off;
}
function arrIndex(iv, cell, node) {
  if (iv.t !== 'Integer') throw new FlowError(L('expr.theIndexOfMustBeAn', { name: node.name, value: TYPE_IT[iv.t] }), { node });
  if (iv.v < 0 || iv.v >= cell.items.length) throw new FlowError(L('expr.indexOutOfBoundsHasElements', { v: iv.v, name: node.name, value: cell.items.length, value2: cell.items.length - 1 }), { node, exc: 'IndexOutOfRange' });
  return iv.v;
}

const REL_OPS = ['==', '!=', '<', '<=', '>', '>='];
function* evalBin(node, ctx) {
  const op = node.op;
  if (op === 'and' || op === 'or') {
    const l = yield* evalE(node.l, ctx);
    if (l.t !== 'Boolean') throw new FlowError(L('expr.requiresBooleanValuesOnTheLeft', { op, value: TYPE_IT[l.t] }), { node });
    if (op === 'and' && !l.v) return V.bool(false);
    if (op === 'or' && l.v) return V.bool(true);
    const r = yield* evalE(node.r, ctx);
    if (r.t !== 'Boolean') throw new FlowError(L('expr.requiresBooleanValuesOnTheRight', { op, value: TYPE_IT[r.t] }), { node });
    return V.bool(r.v);
  }
  if (op === 'xor') {
    // between booleans: true when exactly one is true; between integers: bit by bit (6 xor 3 = 5). Both sides are always evaluated
    const l = yield* evalE(node.l, ctx);
    const r = yield* evalE(node.r, ctx);
    if (l.t === 'Boolean' && r.t === 'Boolean') return V.bool(l.v !== r.v);
    if (l.t === 'Integer' && r.t === 'Integer') return V.int(Number(BigInt(l.v) ^ BigInt(r.v)));
    throw new FlowError(L('expr.xorNeedsTwoBooleansOrTwo', { left: TYPE_IT[l.t] || typeName(l.t), right: TYPE_IT[r.t] || typeName(r.t) }), { node });
  }
  const l = yield* evalE(node.l, ctx);
  const r = yield* evalE(node.r, ctx);
  if ((l.t === 'Object' || r.t === 'Object') && op !== '&') {
    // between references: only equality (same object) and inequality
    if (op !== '==' && op !== '!=') throw new FlowError(REL_OPS.includes(op) ? L('expr.objectsCanOnlyBeComparedWith') : L('expr.theOperatorDoesNotApplyTo', { op }), { node });
    if (l.t !== r.t) throw new FlowError(L('expr.cannotCompareWith', { t: typeName(l.t), t2: typeName(r.t) }), { node });
    return V.bool(op === '==' ? l.v === r.v : l.v !== r.v);
  }
  switch (op) {
    case '&': return V.str(fmtValue(l) + fmtValue(r));
    case '+': case '-': case '*': case '%': case '/': case '^': {
      if (!isNum(l) || !isNum(r)) {
        const hint = op === '+' && (l.t === 'String' || r.t === 'String') ? L('expr.toJoinTextsUse') : '';
        throw new FlowError(L('expr.theOperatorWorksOnlyWithNumbers', { op, hint }), { node });
      }
      const bothInt = l.t === 'Integer' && r.t === 'Integer';
      switch (op) {
        case '+': return bothInt ? checkInt(l.v + r.v, node) : V.real(l.v + r.v);
        case '-': return bothInt ? checkInt(l.v - r.v, node) : V.real(l.v - r.v);
        case '*': return bothInt ? checkInt(l.v * r.v, node) : V.real(l.v * r.v);
        case '/':
          if (r.v === 0) throw new FlowError(L('expr.divisionByZero'), { node, exc: 'DivisionByZero' });
          return V.real(l.v / r.v);
        case '%':
          if (r.v === 0) throw new FlowError(L('expr.moduloByZero'), { node, exc: 'DivisionByZero' });
          return bothInt ? V.int(l.v % r.v) : V.real(l.v % r.v);
        case '^': {
          const v = Math.pow(l.v, r.v);
          if (isNaN(v)) throw new FlowError(L('expr.powerNotDefinedNegativeBaseWith'), { node });
          return bothInt && r.v >= 0 ? checkInt(v, node) : V.real(v);
        }
      }
      break;
    }
    case '==': case '!=': case '<': case '<=': case '>': case '>=': {
      let a, b;
      if (isNum(l) && isNum(r)) { a = l.v; b = r.v; }
      else if (l.t === r.t) { a = l.v; b = r.v; }
      else throw new FlowError(L('expr.cannotCompareWith', { t: TYPE_IT[l.t], t2: TYPE_IT[r.t] }), { node });
      if (l.t === 'Boolean' && !['==', '!='].includes(op)) throw new FlowError(L('expr.booleanValuesCanOnlyBeCompared'), { node });
      let res;
      switch (op) {
        case '==': res = a === b; break;
        case '!=': res = a !== b; break;
        case '<': res = a < b; break;
        case '<=': res = a <= b; break;
        case '>': res = a > b; break;
        case '>=': res = a >= b; break;
      }
      return V.bool(res);
    }
  }
  throw new FlowError(L('expr.unknownOperator') + op);
}

function* evalCall(node, ctx) {
  const low = node.name.toLowerCase();
  if (ctx.hasUser(node.name)) return yield* ctx.callUser(node.name, node.args, node);
  const b = BUILTINS[low];
  if (!b) throw new FlowError(L('expr.functionNotDefined', { name: node.name }), { node });
  if (low === 'size') {
    // Size(a) = elements of the first dimension; Size(m, d) = elements of dimension d (from 0)
    if (node.args.length < 1 || node.args.length > 2) throw new FlowError(L('expr.sizeRequiresTheNameOfAn'), { node });
    const a = node.args[0];
    const inner = a.k === 'par' ? a.e : a;
    if ((inner.k !== 'var' && inner.k !== 'member') || inner.index) throw new FlowError(L('expr.sizeRequiresTheNameOfAn2'), { node });
    const cell = inner.k === 'var' ? ctx.getVar(inner.name, inner) : yield* ctx.cellOf(inner);
    if (!cell.array) throw new FlowError(L('expr.isNotAnArray', { name: inner.name }), { node });
    const dims = cell.dims || [cell.items.length];
    let d = 0;
    if (node.args.length === 2) {
      const dv = yield* evalE(node.args[1], ctx);
      if (dv.t !== 'Integer' || dv.v < 0 || dv.v >= dims.length) throw new FlowError(L('expr.sizeHasTheDimensionGoesFrom', { name: inner.name, dimsCount: dims.length, text: dims.length === 1 ? L('expr.dimension') : L('expr.dimensions'), value: dims.length - 1 }), { node });
      d = dv.v;
    }
    return V.int(dims[d]);
  }
  if (b.variadic ? node.args.length < b.sig.length : node.args.length !== b.sig.length) throw new FlowError(L(b.variadic ? 'expr.requiresAtLeastArgumentsWerePassed' : 'expr.requiresArgumentsWerePassed', { value: BUILTIN_NAMES[low], sigCount: b.sig.length, argsCount: node.args.length }), { node });
  if (low === 'eof') return V.bool(ctx.env.eof(node));
  const args = [];
  for (let i = 0; i < node.args.length; i++) {
    const v = yield* evalE(node.args[i], ctx);
    const want = b.sig[Math.min(i, b.sig.length - 1)];
    if (want === N && !isNum(v)) throw new FlowError(L('expr.argumentMustBeANumberNot', { value: BUILTIN_NAMES[low], value2: i + 1, value3: TYPE_IT[v.t] }), { node });
    if (want === 'Integer' && v.t !== 'Integer') {
      if (v.t === 'Real') { args.push(V.int(Math.trunc(v.v))); continue; }
      throw new FlowError(L('expr.argumentMustBeAnIntegerNot', { value: BUILTIN_NAMES[low], value2: i + 1, value3: TYPE_IT[v.t] }), { node });
    }
    if (want === 'String' && v.t !== 'String') throw new FlowError(L('expr.argumentMustBeAStringNot', { value: BUILTIN_NAMES[low], value2: i + 1, value3: TYPE_IT[v.t] }), { node });
    args.push(v);
  }
  return b.fn(args, node);
}

/* -------------------- Static type inference ----------------------- */
/* generic function: T derived from the types of the arguments, e.g. maximum(v, n) with v array of Integer -> { t: 'Integer' } */
function genericMap(f, args, scope) {
  const low = (f.tparams || []).map((t) => t.toLowerCase()), map = {};
  const unify = (pt, at) => {
    if (!at || at === 'Unknown' || at === 'Null') return;
    const gp = splitType(pt), ga = splitType(at), k = gp.base.toLowerCase();
    if (!gp.args.length && low.includes(k)) { if (map[k] === undefined) map[k] = at; return; }
    if (gp.args.length && ga.args.length === gp.args.length) gp.args.forEach((x, j) => unify(x, ga.args[j]));
  };
  f.params.forEach((p, i) => { if (args[i]) unify(p.type, inferType(args[i], scope)); });
  return map;
}
/* scope: { vars: Map(name -> {type, array}), funcs: Map(name -> {type}) } */
/* a negative number written in the program (2 ^ -1): the power is Real */
const negLit = (n) => { while (n && n.k === 'paren') n = n.e; return !!n && n.k === 'un' && n.op === 'neg' && n.e && n.e.k === 'num' && n.e.v > 0; };
function inferType(node, scope) {
  switch (node.k) {
    case 'num': return node.t;
    case 'str': return 'String';
    case 'bool': return 'Boolean';
    case 'pi': return 'Real';
    case 'par': return inferType(node.e, scope);
    case 'var': { const v = scope.vars.get(node.name.toLowerCase()); return v ? v.type : (scope.oo ? scope.oo(node) : 'Unknown'); }
    case 'null': return 'Null';
    case 'this': case 'member': case 'mcall': case 'new': return scope.oo ? scope.oo(node) : 'Unknown';
    case 'un': return node.op === 'not' ? 'Boolean' : inferType(node.e, scope);
    case 'bin': {
      const op = node.op;
      if (op === 'xor') { const lt = inferType(node.l, scope); return lt === 'Integer' && inferType(node.r, scope) === 'Integer' ? 'Integer' : 'Boolean'; }
      if (['and', 'or', '==', '!=', '<', '<=', '>', '>='].includes(op)) return 'Boolean';
      if (op === '&') return 'String';
      if (op === '/') return 'Real';
      const a = inferType(node.l, scope), b = inferType(node.r, scope);
      if (a === 'Real' || b === 'Real' || (op === '^' && negLit(node.r))) return 'Real';
      if (a === 'Integer' && b === 'Integer') return 'Integer';
      return a === 'Unknown' ? b : a;
    }
    case 'call': {
      const f = scope.funcs.get(node.name.toLowerCase()) || (scope.oo && scope.oo(node, true));
      if (f) return f.f && (f.f.tparams || []).length ? substType(f.type, genericMap(f.f, node.args, scope)) : f.type;
      const b = BUILTINS[node.name.toLowerCase()];
      if (!b) return 'Unknown';
      if (typeof b.ret === 'function') return node.args[0] ? inferType(node.args[0], scope) : 'Real';
      if (b.ret === 'IntIfAll') {
        const ts = node.args.map((x) => inferType(x, scope));
        // (Pow as the operator ^)
        if (node.name.toLowerCase() === 'pow' && negLit(node.args[1])) return 'Real';
        return ts.length && ts.every((t) => t === 'Integer') ? 'Integer' : ts.some((t) => t === 'Unknown') ? 'Unknown' : 'Real';
      }
      return b.ret;
    }
  }
  return 'Unknown';
}

const ExprLib = { ESCAPES, escapeText, FlowError, TYPES, TYPE_IT, typeName, splitType, splitTypeList, joinType, isGenericType, normTypeText, substType, sameType, isBaseType, tokenize, parseExpr, parseLValue, splitTop, parseArrayLit, parseLValueList, arrOffset, validIdent, RESERVED, V, isNum, fmtValue, fmtReal, literalOf, checkInt, coerce, parseInputText, BUILTINS, BUILTIN_NAMES, evalE, arrIndex, inferType, genericMap };
if (typeof module !== 'undefined') module.exports = ExprLib;
