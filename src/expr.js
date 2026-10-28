/* ==========================================================================
   FlowLab — motore delle espressioni
   Lessico, parser (precedenze compatibili con i file .fprg), valori tipizzati,
   funzioni integrate, valutatore a generatore (per eseguire funzioni utente
   passo-passo dentro le espressioni) e inferenza statica dei tipi.
   ========================================================================== */
'use strict';

class FlowError extends Error {
  constructor(msg, extra) { super(msg); Object.assign(this, extra || {}); }
}

const TYPES = ['Integer', 'Real', 'String', 'Boolean'];
const TYPE_IT = { Integer: 'Intero', Real: 'Reale', String: 'Stringa', Boolean: 'Booleano', None: 'Nessuno', Object: 'Oggetto' };
/* nome leggibile di un tipo: i tipi base in italiano, le classi con il loro nome */
const typeName = (t) => TYPE_IT[t] || t;
const isBaseType = (t) => TYPES.includes(t);

/* ---------------------------- Lessico ---------------------------------- */
const SYM = [
  ['<=', '<='], ['>=', '>='], ['==', '=='], ['!=', '!='], ['<>', '!='], ['&&', 'and'], ['||', 'or'],
  ['≤', '<='], ['≥', '>='], ['≠', '!='], ['∧', 'and'], ['∨', 'or'], ['¬', 'not'],
  ['×', '*'], ['∗', '*'], ['÷', '/'], ['⁄', '/'], ['∕', '/'], ['↑', '^'], ['⭡', '^'], ['−', '-'],
  ['(', '('], [')', ')'], ['[', '['], [']', ']'], [',', ','], ['<', '<'], ['>', '>'], ['=', '=='],
  ['&', '&'], ['+', '+'], ['-', '-'], ['*', '*'], ['/', '/'], ['%', '%'], ['^', '^'], ['!', 'not'], ['.', '.'],
];
const WORD_OPS = { and: 'and', or: 'or', not: 'not', mod: '%' };

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
      i++;
      let s = '';
      while (i < n && src[i] !== c) s += src[i++];
      if (i >= n) throw new FlowError('Stringa non terminata: manca la virgoletta di chiusura ' + c, { pos: start });
      i++;
      toks.push({ k: 'str', v: s, pos: start });
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
    if (!matched) throw new FlowError(`Carattere non valido "${c}"`, { pos: start });
  }
  toks.push({ k: 'eof', pos: n });
  return toks;
}

/* ----------------------------- Parser ---------------------------------- */
/* Precedenze (dalla più bassa):
   or < and < not < relazionali < & < + - < * / % < ^ < meno unario     */
function parseExpr(src) {
  if (src == null || String(src).trim() === '') throw new FlowError('Espressione vuota');
  const toks = tokenize(String(src));
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v) => toks[p].k === 'op' && toks[p].v === v;
  const eat = (v) => {
    if (!isOp(v)) {
      const t = toks[p];
      throw new FlowError(t.k === 'eof' ? `Manca "${v}" alla fine dell'espressione` : `Atteso "${v}" ma trovato "${t.text ?? t.v}"`, { pos: t.pos });
    }
    return toks[p++];
  };
  const node = (o, t) => { o.pos = t ? t.pos : 0; return o; };

  function orE() {
    let l = andE();
    while (isOp('or')) { const t = toks[p++]; l = node({ k: 'bin', op: 'or', l, r: andE() }, t); }
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
    // indici: v[i]  m[i, j]  m[i][j]  (anche misti)
    const indices = [];
    while (isOp('[')) {
      p++;
      indices.push(orE());
      while (isOp(',')) { p++; indices.push(orE()); }
      eat(']');
    }
    return indices;
  }
  /* atomo seguito da accessi con il punto: p.x  p.sposta(1, 2)  v[i].nome  this.dati[k] */
  function primary() {
    let e = atom();
    while (isOp('.')) {
      p++;
      const t = peek();
      if (t.k !== 'id') throw new FlowError('Dopo il punto serve il nome di un attributo o di un metodo', { pos: t.pos });
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
        return node({ k: 'new', cls: c.v, args: isOp('(') ? args() : [] }, t);
      }
      if (low === 'super') {
        if (isOp('(')) return node({ k: 'supercall', args: args() }, t);
        if (isOp('.')) return node({ k: 'super' }, t);
        throw new FlowError('super si usa come super(...) all\'inizio di un costruttore oppure come super.metodo(...)', { pos: t.pos });
      }
      if (isOp('(')) return node({ k: 'call', name: t.v, args: args() }, t);
      if (isOp('[')) { const indices = indexList(); return node({ k: 'var', name: t.v, index: indices[0], indices }, t); }
      return node({ k: 'var', name: t.v }, t);
    }
    if (t.k === 'eof') throw new FlowError("L'espressione termina in modo inatteso", { pos: t.pos });
    throw new FlowError(`Simbolo inatteso "${t.text ?? t.v}"`, { pos: t.pos });
  }

  const e = orE();
  if (peek().k !== 'eof') {
    const t = peek();
    throw new FlowError(`Simbolo inatteso "${t.text ?? t.v}" dopo la fine dell'espressione`, { pos: t.pos });
  }
  return e;
}

/* Riferimento modificabile: nome, nome[indice] oppure attributo di un oggetto (p.x, this.v[i]) */
function parseLValue(src) {
  const e = parseExpr(src);
  const inner = e.k === 'par' ? e.e : e;
  if (inner.k !== 'var' && inner.k !== 'member') throw new FlowError('Serve il nome di una variabile (eventualmente con indice, es. v[i]) o di un attributo (es. p.x)');
  return inner;
}

/* Divide "a, b[i], c" sulle virgole di primo livello (non dentro parentesi o virgolette) */
function splitTop(src) {
  const out = []; let depth = 0, cur = '', q = null;
  for (const ch of String(src)) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}
function parseLValueList(src) {
  const parts = splitTop(src);
  if (parts.some((p) => !p)) throw new FlowError('Manca il nome di una variabile tra due virgole');
  const lvs = parts.map((p) => parseLValue(p));
  if (lvs.length > 1) {
    const seen = new Set();
    for (const lv of lvs) { if (lv.k !== 'var' || lv.index) continue; const k = lv.name.toLowerCase(); if (seen.has(k)) throw new FlowError(`La variabile "${lv.name}" compare più volte`); seen.add(k); }
  }
  return lvs;
}

function validIdent(s) { return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(s); }

const RESERVED = new Set(['and', 'or', 'not', 'mod', 'true', 'false', 'pi', 'π', 'integer', 'real', 'string', 'boolean', 'if', 'while', 'do', 'for', 'main', 'new', 'this', 'super', 'null']);

/* ------------------------------ Valori --------------------------------- */
const V = {
  int: (v) => ({ t: 'Integer', v }),
  real: (v) => ({ t: 'Real', v }),
  str: (v) => ({ t: 'String', v }),
  bool: (v) => ({ t: 'Boolean', v }),
  obj: (o) => ({ t: 'Object', v: o }), // riferimento a un oggetto (o = null per null)
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
  return x.t === 'String' ? '"' + x.v + '"' : fmtValue(x);
}
function checkInt(v, node) {
  if (!Number.isSafeInteger(v)) throw new FlowError('Overflow: il risultato intero è troppo grande', { node });
  return V.int(v);
}

/* Conversione per assegnamento/parametri */
/* isA(classeOggetto, nomeTipo): verifica di compatibilità per i tipi classe (fornita dall'interprete) */
function coerce(val, type, what, isA) {
  if (!isBaseType(type)) {
    if (val.t !== 'Object') throw new FlowError(`Tipi incompatibili: ${what || 'il valore'} è ${typeName(val.t)} ma serve un oggetto ${type}`);
    if (val.v && isA && !isA(val.v.cls, type)) throw new FlowError(`Tipi incompatibili: ${what || 'il valore'} è un oggetto ${val.v.cls.name}, che non è un ${type}`);
    return val;
  }
  if (val.t === type) return val;
  if (type === 'Real' && val.t === 'Integer') return V.real(val.v);
  if (type === 'Integer' && val.t === 'Real') return V.int(Math.trunc(val.v));
  const got = val.t === 'Object' ? (val.v ? `un oggetto ${val.v.cls.name}` : 'null') : typeName(val.t);
  throw new FlowError(`Tipi incompatibili: ${what || 'il valore'} è ${got} ma serve ${typeName(type)}`);
}

/* Conversione testo digitato dall'utente */
function parseInputText(text, type) {
  const s = String(text).trim();
  switch (type) {
    case 'Integer':
      if (!/^[-+]?\d+$/.test(s)) throw new FlowError(`"${text}" non è un numero intero valido`);
      return checkInt(parseInt(s, 10));
    case 'Real': {
      const t = s.replace(',', '.');
      if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) throw new FlowError(`"${text}" non è un numero reale valido`);
      return V.real(parseFloat(t));
    }
    case 'Boolean': {
      const l = s.toLowerCase();
      if (['true', 'vero', 'v', 't', '1', 'sì', 'si', 'yes'].includes(l)) return V.bool(true);
      if (['false', 'falso', 'f', '0', 'no'].includes(l)) return V.bool(false);
      throw new FlowError(`"${text}" non è un valore booleano (usa true o false)`);
    }
    case 'String': return V.str(String(text));
    default: throw new FlowError(`Non si può leggere da tastiera un oggetto ${type}: leggi i singoli valori e crea l'oggetto con new`);
  }
}

/* ------------------------- Funzioni integrate -------------------------- */
const N = 'Number';
function num(x) { return x.v; }
function realRes(v, node) {
  if (isNaN(v)) throw new FlowError('Valore non valido per la funzione (risultato indefinito)', { node });
  return V.real(v);
}
const BUILTINS = {
  abs:      { sig: [N], ret: (a) => a[0], fn: (a) => (a[0].t === 'Integer' ? V.int(Math.abs(a[0].v)) : V.real(Math.abs(a[0].v))), doc: 'Abs(n) — valore assoluto' },
  arccos:   { sig: [N], ret: 'Real', fn: (a, n) => realRes(Math.acos(num(a[0])), n), doc: 'Arccos(n) — arcocoseno (radianti)' },
  arcsin:   { sig: [N], ret: 'Real', fn: (a, n) => realRes(Math.asin(num(a[0])), n), doc: 'Arcsin(n) — arcoseno (radianti)' },
  arctan:   { sig: [N], ret: 'Real', fn: (a) => V.real(Math.atan(num(a[0]))), doc: 'Arctan(n) — arcotangente (radianti)' },
  cos:      { sig: [N], ret: 'Real', fn: (a) => V.real(Math.cos(num(a[0]))), doc: 'Cos(n) — coseno (radianti)' },
  sin:      { sig: [N], ret: 'Real', fn: (a) => V.real(Math.sin(num(a[0]))), doc: 'Sin(n) — seno (radianti)' },
  tan:      { sig: [N], ret: 'Real', fn: (a) => V.real(Math.tan(num(a[0]))), doc: 'Tan(n) — tangente (radianti)' },
  cosh:     { sig: [N], ret: 'Real', fn: (a) => V.real(Math.cosh(num(a[0]))), doc: 'Cosh(n) — coseno iperbolico' },
  sinh:     { sig: [N], ret: 'Real', fn: (a) => V.real(Math.sinh(num(a[0]))), doc: 'Sinh(n) — seno iperbolico' },
  tanh:     { sig: [N], ret: 'Real', fn: (a) => V.real(Math.tanh(num(a[0]))), doc: 'Tanh(n) — tangente iperbolica' },
  arccosh:  { sig: [N], ret: 'Real', fn: (a, n) => realRes(Math.acosh(num(a[0])), n), doc: 'Arccosh(n)' },
  arcsinh:  { sig: [N], ret: 'Real', fn: (a) => V.real(Math.asinh(num(a[0]))), doc: 'Arcsinh(n)' },
  arctanh:  { sig: [N], ret: 'Real', fn: (a, n) => realRes(Math.atanh(num(a[0])), n), doc: 'Arctanh(n)' },
  int:      { sig: [N], ret: 'Integer', fn: (a, n) => checkInt(Math.trunc(num(a[0])), n), doc: 'Int(n) — parte intera (tronca i decimali)' },
  ln:       { sig: [N], ret: 'Real', fn: (a, n) => { if (num(a[0]) <= 0) throw new FlowError('Ln: l\'argomento deve essere positivo', { node: n }); return V.real(Math.log(num(a[0]))); }, doc: 'Ln(n) — logaritmo naturale' },
  log:      { sig: [N], ret: 'Real', fn: (a, n) => { if (num(a[0]) <= 0) throw new FlowError('Log: l\'argomento deve essere positivo', { node: n }); return V.real(Math.log(num(a[0]))); }, doc: 'Log(n) — logaritmo naturale' },
  log10:    { sig: [N], ret: 'Real', fn: (a, n) => { if (num(a[0]) <= 0) throw new FlowError('Log10: l\'argomento deve essere positivo', { node: n }); return V.real(Math.log10(num(a[0]))); }, doc: 'Log10(n) — logaritmo in base 10' },
  sgn:      { sig: [N], ret: 'Integer', fn: (a) => V.int(Math.sign(num(a[0])) | 0), doc: 'Sgn(n) — segno: -1, 0 oppure 1' },
  sqrt:     { sig: [N], ret: 'Real', fn: (a, n) => { if (num(a[0]) < 0) throw new FlowError('Sqrt: radice quadrata di un numero negativo', { node: n }); return V.real(Math.sqrt(num(a[0]))); }, doc: 'Sqrt(n) — radice quadrata' },
  random:   { sig: ['Integer'], ret: 'Integer', fn: (a, n) => { if (a[0].v <= 0) throw new FlowError('Random: l\'argomento deve essere maggiore di 0', { node: n }); return V.int(Math.floor(Math.random() * a[0].v)); }, doc: 'Random(n) — intero casuale da 0 a n-1' },
  len:      { sig: ['String'], ret: 'Integer', fn: (a) => V.int([...a[0].v].length), doc: 'Len(s) — lunghezza della stringa' },
  char:     { sig: ['String', 'Integer'], ret: 'String', fn: (a, n) => { const ch = [...a[0].v]; const i = a[1].v; if (i < 0 || i >= ch.length) throw new FlowError(`Char: indice ${i} fuori dalla stringa (lunghezza ${ch.length})`, { node: n }); return V.str(ch[i]); }, doc: 'Char(s, i) — carattere in posizione i (da 0)' },
  tochar:   { sig: ['Integer'], ret: 'String', fn: (a) => V.str(String.fromCodePoint(a[0].v)), doc: 'ToChar(n) — carattere con codice n' },
  tocode:   { sig: ['String'], ret: 'Integer', fn: (a, n) => { if (!a[0].v.length) throw new FlowError('ToCode: stringa vuota', { node: n }); return V.int(a[0].v.codePointAt(0)); }, doc: 'ToCode(s) — codice del primo carattere' },
  tofixed:  { sig: [N, 'Integer'], ret: 'String', fn: (a) => V.str(Number(num(a[0])).toFixed(Math.max(0, Math.min(20, a[1].v)))), doc: 'ToFixed(r, d) — numero come testo con d decimali' },
  tointeger:{ sig: ['String'], ret: 'Integer', fn: (a, n) => { try { return parseInputText(a[0].v, 'Integer'); } catch (e) { throw new FlowError(`ToInteger: ${e.message}`, { node: n }); } }, doc: 'ToInteger(s) — converte testo in intero' },
  toreal:   { sig: ['String'], ret: 'Real', fn: (a, n) => { try { return parseInputText(a[0].v, 'Real'); } catch (e) { throw new FlowError(`ToReal: ${e.message}`, { node: n }); } }, doc: 'ToReal(s) — converte testo in reale' },
  tostring: { sig: ['Any'], ret: 'String', fn: (a) => V.str(fmtValue(a[0])), doc: 'ToString(x) — converte in testo' },
  size:     { sig: ['Array'], ret: 'Integer', fn: null, doc: 'Size(a) — numero di elementi dell\'array; Size(m, d) — elementi della dimensione d (da 0)' },
  eof:      { sig: [], ret: 'Boolean', fn: null, doc: 'EOF() — vero se il file in lettura è finito' },
};
const BUILTIN_NAMES = { abs: 'Abs', arccos: 'Arccos', arcsin: 'Arcsin', arctan: 'Arctan', cos: 'Cos', sin: 'Sin', tan: 'Tan', cosh: 'Cosh', sinh: 'Sinh', tanh: 'Tanh', arccosh: 'Arccosh', arcsinh: 'Arcsinh', arctanh: 'Arctanh', int: 'Int', ln: 'Ln', log: 'Log', log10: 'Log10', sgn: 'Sgn', sqrt: 'Sqrt', random: 'Random', len: 'Len', char: 'Char', tochar: 'ToChar', tocode: 'ToCode', tofixed: 'ToFixed', tointeger: 'ToInteger', toreal: 'ToReal', tostring: 'ToString', size: 'Size', eof: 'EOF' };

/* --------------------- Valutatore (a generatore) ----------------------- */
/* ctx: { getVar(name,node) -> cella, callUser*(name, argNodes, node) -> Value,
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
      if (!ctx.oo) throw new FlowError('Oggetti, new e this si usano nella vista Oggetti', { node });
      return yield* ctx.oo(node);
    case 'super': throw new FlowError('super si usa come super.metodo(...)', { node });
    case 'supercall': throw new FlowError('super(...) si usa solo in un blocco Chiamata, come primo blocco di un costruttore', { node });
    case 'var': {
      const cell = ctx.getVar(node.name, node);
      if (cell.array) {
        if (!node.index) throw new FlowError(`"${node.name}" è un array: serve un indice, es. ${node.name}[${(cell.dims || [0]).map(() => 0).join(', ')}]`, { node });
        const ivs = [];
        for (const ix of node.indices) ivs.push(yield* evalE(ix, ctx));
        const off = arrOffset(ivs, cell, node);
        const item = cell.items[off];
        if (item === undefined) throw new FlowError(`L'elemento ${node.name}[${ivs.map((x) => x.v).join(', ')}] non ha ancora un valore`, { node });
        return item;
      }
      if (node.index) throw new FlowError(`"${node.name}" non è un array`, { node });
      if (cell.value === undefined) throw new FlowError(`La variabile "${node.name}" non ha ancora un valore`, { node });
      return cell.value;
    }
    case 'un': {
      const x = yield* evalE(node.e, ctx);
      if (node.op === 'neg') {
        if (!isNum(x)) throw new FlowError(`Il segno meno si applica solo ai numeri, non a ${TYPE_IT[x.t]}`, { node });
        return x.t === 'Integer' ? checkInt(-x.v, node) : V.real(-x.v);
      }
      if (x.t !== 'Boolean') throw new FlowError(`"not" si applica solo a valori booleani, non a ${TYPE_IT[x.t]}`, { node });
      return V.bool(!x.v);
    }
    case 'bin': return yield* evalBin(node, ctx);
    case 'call': return yield* evalCall(node, ctx);
  }
  throw new FlowError('Espressione non riconosciuta');
}

/* posizione nell'elenco piatto degli elementi (ordine per righe) */
function arrOffset(ivs, cell, node) {
  const dims = cell.dims || [cell.items.length];
  if (ivs.length !== dims.length) {
    throw new FlowError(dims.length === 1 ? `"${node.name}" ha una sola dimensione: serve un solo indice, es. ${node.name}[i]` : `"${node.name}" ha ${dims.length} dimensioni: servono ${dims.length} indici, es. ${node.name}[${dims.map((_, k) => 'ijklmn'[k] || 'x').join(', ')}]`, { node });
  }
  let off = 0;
  for (let k = 0; k < dims.length; k++) {
    const iv = ivs[k];
    if (iv.t !== 'Integer') throw new FlowError(`Gli indici di "${node.name}" devono essere interi, non ${TYPE_IT[iv.t]}`, { node });
    if (iv.v < 0 || iv.v >= dims[k]) {
      throw new FlowError(dims.length === 1 ? `Indice ${iv.v} fuori dai limiti: "${node.name}" ha ${dims[0]} elementi (indici da 0 a ${dims[0] - 1})` : `Indice ${iv.v} fuori dai limiti nella dimensione ${k + 1} di "${node.name}" (indici da 0 a ${dims[k] - 1})`, { node });
    }
    off = off * dims[k] + iv.v;
  }
  return off;
}
function arrIndex(iv, cell, node) {
  if (iv.t !== 'Integer') throw new FlowError(`L'indice di "${node.name}" deve essere intero, non ${TYPE_IT[iv.t]}`, { node });
  if (iv.v < 0 || iv.v >= cell.items.length) throw new FlowError(`Indice ${iv.v} fuori dai limiti: "${node.name}" ha ${cell.items.length} elementi (indici da 0 a ${cell.items.length - 1})`, { node });
  return iv.v;
}

const REL_OPS = ['==', '!=', '<', '<=', '>', '>='];
function* evalBin(node, ctx) {
  const op = node.op;
  if (op === 'and' || op === 'or') {
    const l = yield* evalE(node.l, ctx);
    if (l.t !== 'Boolean') throw new FlowError(`"${op}" richiede valori booleani, a sinistra c'è ${TYPE_IT[l.t]}`, { node });
    if (op === 'and' && !l.v) return V.bool(false);
    if (op === 'or' && l.v) return V.bool(true);
    const r = yield* evalE(node.r, ctx);
    if (r.t !== 'Boolean') throw new FlowError(`"${op}" richiede valori booleani, a destra c'è ${TYPE_IT[r.t]}`, { node });
    return V.bool(r.v);
  }
  const l = yield* evalE(node.l, ctx);
  const r = yield* evalE(node.r, ctx);
  if ((l.t === 'Object' || r.t === 'Object') && op !== '&') {
    // tra riferimenti: solo uguaglianza (stesso oggetto) e diversità
    if (op !== '==' && op !== '!=') throw new FlowError(REL_OPS.includes(op) ? 'Gli oggetti si possono solo confrontare con = oppure != (stesso oggetto o no)' : `L'operatore ${op} non si applica agli oggetti`, { node });
    if (l.t !== r.t) throw new FlowError(`Impossibile confrontare ${typeName(l.t)} con ${typeName(r.t)}`, { node });
    return V.bool(op === '==' ? l.v === r.v : l.v !== r.v);
  }
  switch (op) {
    case '&': return V.str(fmtValue(l) + fmtValue(r));
    case '+': case '-': case '*': case '%': case '/': case '^': {
      if (!isNum(l) || !isNum(r)) {
        const hint = op === '+' && (l.t === 'String' || r.t === 'String') ? ' (per unire testi usa &)' : '';
        throw new FlowError(`L'operatore ${op} funziona solo con numeri${hint}`, { node });
      }
      const bothInt = l.t === 'Integer' && r.t === 'Integer';
      switch (op) {
        case '+': return bothInt ? checkInt(l.v + r.v, node) : V.real(l.v + r.v);
        case '-': return bothInt ? checkInt(l.v - r.v, node) : V.real(l.v - r.v);
        case '*': return bothInt ? checkInt(l.v * r.v, node) : V.real(l.v * r.v);
        case '/':
          if (r.v === 0) throw new FlowError('Divisione per zero', { node });
          return V.real(l.v / r.v);
        case '%':
          if (r.v === 0) throw new FlowError('Modulo per zero', { node });
          return bothInt ? V.int(l.v % r.v) : V.real(l.v % r.v);
        case '^': {
          const v = Math.pow(l.v, r.v);
          if (isNaN(v)) throw new FlowError('Potenza non definita (base negativa con esponente non intero)', { node });
          return bothInt && r.v >= 0 ? checkInt(v, node) : V.real(v);
        }
      }
      break;
    }
    case '==': case '!=': case '<': case '<=': case '>': case '>=': {
      let a, b;
      if (isNum(l) && isNum(r)) { a = l.v; b = r.v; }
      else if (l.t === r.t) { a = l.v; b = r.v; }
      else throw new FlowError(`Impossibile confrontare ${TYPE_IT[l.t]} con ${TYPE_IT[r.t]}`, { node });
      if (l.t === 'Boolean' && !['==', '!='].includes(op)) throw new FlowError('I valori booleani si possono solo confrontare con = oppure !=', { node });
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
  throw new FlowError('Operatore sconosciuto ' + op);
}

function* evalCall(node, ctx) {
  const low = node.name.toLowerCase();
  if (ctx.hasUser(node.name)) return yield* ctx.callUser(node.name, node.args, node);
  const b = BUILTINS[low];
  if (!b) throw new FlowError(`Funzione "${node.name}" non definita`, { node });
  if (low === 'size') {
    // Size(a) = elementi della prima dimensione; Size(m, d) = elementi della dimensione d (da 0)
    if (node.args.length < 1 || node.args.length > 2) throw new FlowError('Size richiede il nome di un array e, per più dimensioni, il numero della dimensione: Size(m, 1)', { node });
    const a = node.args[0];
    const inner = a.k === 'par' ? a.e : a;
    if ((inner.k !== 'var' && inner.k !== 'member') || inner.index) throw new FlowError('Size richiede il nome di un array', { node });
    const cell = inner.k === 'var' ? ctx.getVar(inner.name, inner) : yield* ctx.cellOf(inner);
    if (!cell.array) throw new FlowError(`"${inner.name}" non è un array`, { node });
    const dims = cell.dims || [cell.items.length];
    let d = 0;
    if (node.args.length === 2) {
      const dv = yield* evalE(node.args[1], ctx);
      if (dv.t !== 'Integer' || dv.v < 0 || dv.v >= dims.length) throw new FlowError(`Size: "${inner.name}" ha ${dims.length} ${dims.length === 1 ? 'dimensione' : 'dimensioni'}, la dimensione va da 0 a ${dims.length - 1}`, { node });
      d = dv.v;
    }
    return V.int(dims[d]);
  }
  if (node.args.length !== b.sig.length) throw new FlowError(`${BUILTIN_NAMES[low]} richiede ${b.sig.length} argomenti, ne sono stati passati ${node.args.length}`, { node });
  if (low === 'eof') return V.bool(ctx.env.eof(node));
  const args = [];
  for (let i = 0; i < node.args.length; i++) {
    const v = yield* evalE(node.args[i], ctx);
    const want = b.sig[i];
    if (want === N && !isNum(v)) throw new FlowError(`${BUILTIN_NAMES[low]}: l'argomento ${i + 1} deve essere un numero, non ${TYPE_IT[v.t]}`, { node });
    if (want === 'Integer' && v.t !== 'Integer') {
      if (v.t === 'Real') { args.push(V.int(Math.trunc(v.v))); continue; }
      throw new FlowError(`${BUILTIN_NAMES[low]}: l'argomento ${i + 1} deve essere intero, non ${TYPE_IT[v.t]}`, { node });
    }
    if (want === 'String' && v.t !== 'String') throw new FlowError(`${BUILTIN_NAMES[low]}: l'argomento ${i + 1} deve essere una stringa, non ${TYPE_IT[v.t]}`, { node });
    args.push(v);
  }
  return b.fn(args, node);
}

/* -------------------- Inferenza statica dei tipi ----------------------- */
/* scope: { vars: Map(name -> {type, array}), funcs: Map(name -> {type}) } */
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
      if (['and', 'or', '==', '!=', '<', '<=', '>', '>='].includes(op)) return 'Boolean';
      if (op === '&') return 'String';
      if (op === '/') return 'Real';
      const a = inferType(node.l, scope), b = inferType(node.r, scope);
      if (a === 'Real' || b === 'Real') return 'Real';
      if (a === 'Integer' && b === 'Integer') return 'Integer';
      return a === 'Unknown' ? b : a;
    }
    case 'call': {
      const f = scope.funcs.get(node.name.toLowerCase()) || (scope.oo && scope.oo(node, true));
      if (f) return f.type;
      const b = BUILTINS[node.name.toLowerCase()];
      if (!b) return 'Unknown';
      if (typeof b.ret === 'function') return node.args[0] ? inferType(node.args[0], scope) : 'Real';
      return b.ret;
    }
  }
  return 'Unknown';
}

const ExprLib = { FlowError, TYPES, TYPE_IT, typeName, isBaseType, tokenize, parseExpr, parseLValue, splitTop, parseLValueList, arrOffset, validIdent, RESERVED, V, isNum, fmtValue, fmtReal, literalOf, checkInt, coerce, parseInputText, BUILTINS, BUILTIN_NAMES, evalE, arrIndex, inferType };
if (typeof module !== 'undefined') module.exports = ExprLib;
