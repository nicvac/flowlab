/* ==========================================================================
   FlowLab — generatori di codice sorgente
   Pseudocodice (italiano), Python, C++, Java, C#, JavaScript.
   Tutti partono dall'albero sintattico delle espressioni e da un'inferenza
   statica dei tipi, così divisioni, concatenazioni e confronti tra stringhe
   vengono tradotti correttamente in ogni linguaggio.
   ========================================================================== */
'use strict';

const _CE = (typeof module !== 'undefined') ? require('./expr.js') : ExprLib;
const _CM = (typeof module !== 'undefined') ? require('./model.js') : ModelLib;

const P = { or: 1, and: 2, notLow: 3, rel: 4, add: 5, mul: 6, un: 7, pow: 8, atom: 10 };
const REL = ['==', '!=', '<', '<=', '>', '>='];

function buildScope(prog, func) {
  const vars = new Map();
  for (const p of func.params) vars.set(p.name.toLowerCase(), { type: p.type, array: p.array, dims: p.array ? (p.dims || 1) : 0, name: p.name });
  _CM.walk(func.body, (s) => {
    if (s.kind === 'const' && s.name.trim() && !vars.has(s.name.trim().toLowerCase())) vars.set(s.name.trim().toLowerCase(), { type: s.type, array: false, name: s.name.trim(), constant: true });
    if (s.kind === 'declare') for (const n of s.name.split(',').map((x) => x.trim()).filter(Boolean)) if (!vars.has(n.toLowerCase())) vars.set(n.toLowerCase(), { type: s.type, array: s.array, dims: s.array ? _CE.splitTop(s.size).length : 0, name: n });
  });
  const funcs = new Map();
  const ooMode = _CM.hasClasses(prog);
  const cls = ooMode ? _CM.classOf(prog, func) : null;
  if (!ooMode) for (const f of prog.functions) funcs.set(f.name.toLowerCase(), { type: f.type, rets: _CM.rets(f), f, name: f.name });
  else for (const k of _CM.chainOf(prog, cls)) for (const f of _CM.membersOf(prog, k)) if (!f.ctor && !funcs.has(f.name.toLowerCase())) funcs.set(f.name.toLowerCase(), { type: f.type, rets: _CM.rets(f), f, name: f.name, owner: k });
  const sc = { vars, funcs, func, prog, cls, ooMode };
  if (ooMode) ooScope(prog, sc);
  return sc;
}

/* Strumenti per le classi: attributi e metodi ereditati, accessi statici, tipi delle espressioni */
function ooScope(prog, sc) {
  const classNamed = (n) => _CM.classByName(prog, n);
  const fieldHit = (c, low) => { for (const k of _CM.chainOf(prog, c)) { const a = k.attributes.find((x) => x.name.toLowerCase() === low); if (a) return { attr: a, owner: k }; } return null; };
  const methodHit = (c, low) => { for (const k of _CM.chainOf(prog, c)) { const f = _CM.membersOf(prog, k).find((x) => !x.ctor && x.name.toLowerCase() === low); if (f) return { f, owner: k }; } return null; };
  const implicitField = (name) => { const low = String(name).toLowerCase(); return !sc.vars.has(low) && sc.cls ? fieldHit(sc.cls, low) : null; };
  const classRef = (node) => { const n = strip(node); if (!n || n.k !== 'var' || n.indices) return null; const low = n.name.toLowerCase(); if (sc.vars.has(low) || (sc.cls && fieldHit(sc.cls, low))) return null; return classNamed(n.name); };
  const objClass = (node) => { const r = classRef(node); if (r) return r; const n = strip(node); if (n && n.k === 'super') return classNamed(sc.cls && sc.cls.parent); return classNamed(_CE.inferType(node, sc)); };
  Object.assign(sc, {
    classNamed, fieldHit, methodHit, implicitField, classRef, objClass,
    oo(node) {
      switch (node.k) {
        case 'var': { const h = implicitField(node.name); return h ? h.attr.type : 'Unknown'; }
        case 'this': return sc.cls ? sc.cls.name : 'Unknown';
        case 'new': { const c = classNamed(node.cls); return c ? c.name : node.cls; }
        case 'member': { const c = objClass(node.obj); const h = c && fieldHit(c, node.name.toLowerCase()); return h ? h.attr.type : 'Unknown'; }
        case 'mcall': { const c = objClass(node.obj); const h = c && methodHit(c, node.name.toLowerCase()); return h ? h.f.type : 'Unknown'; }
      }
      return undefined;
    },
  });
}

function tryParse(src) { try { return _CE.parseExpr(src); } catch (e) { return null; } }
const strip = (n) => (n && n.k === 'par' ? strip(n.e) : n);
/* destinazioni di un'assegnazione (più di una se la funzione restituisce più valori) */
const targetsOf = (s) => _CE.splitTop(s.variable);
function isLiteralExpr(src) {
  const ok = (n) => !!n && (['num', 'str', 'bool'].includes(n.k) || (n.k === 'par' && ok(n.e)) || (n.k === 'un' && ok(n.e)) || (n.k === 'bin' && n.op !== '&' && ok(n.l) && ok(n.r)));
  return ok(tryParse(src));
}
/* funzione chiamata a destra di un'assegnazione multipla */
function calleeOf(s, sc) {
  const e = strip(tryParse(s.expression));
  if (e && e.k === 'mcall' && sc.objClass) { const c = sc.objClass(e.obj); const h = c && sc.methodHit(c, e.name.toLowerCase()); return h ? h.f : null; }
  const g = e && e.k === 'call' && sc.funcs.get(e.name.toLowerCase()); return g ? g.f : null;
}
/* nome come è stato dichiarato (il formato .fprg non distingue maiuscole e minuscole, i linguaggi sì) */
const vname = (n, sc) => { const v = sc.vars.get(String(n).toLowerCase()); return v ? v.name : n; };
const fname = (n, sc) => { const f = sc.funcs.get(String(n).toLowerCase()); return f ? f.name : n; };

/* ------------------------------ Classi -------------------------------------- */
const OO = {
  /* classi in ordine: la madre prima delle figlie; la principale il più tardi possibile (o per prima) */
  ordered(prog, mainFirst) {
    const main = _CM.mainClass(prog);
    const out = [], done = new Set();
    const visit = (c) => { if (!c || done.has(c)) return; done.add(c); visit(_CM.classByName(prog, c.parent)); out.push(c); };
    const rest = prog.classes.filter((c) => c !== main);
    if (mainFirst) { visit(main); rest.forEach(visit); } else { rest.forEach(visit); visit(main); }
    return out;
  },
  methods: (prog, c) => _CM.membersOf(prog, c).filter((f) => !f.ctor),
  ctors: (prog, c) => _CM.membersOf(prog, c).filter((f) => f.ctor),
  isMain: (prog, f) => f === prog.functions[0],
  sig: (f) => f.params.map((p) => p.type.toLowerCase() + (p.array ? '[' + (p.dims || 1) : '')).join(','),
  /* il metodo ridefinisce un metodo di una classe madre? */
  overrides(prog, f) {
    const c = _CM.classOf(prog, f);
    for (const k of _CM.chainOf(prog, c).slice(1)) if (OO.methods(prog, k).some((g) => !g.static && g.name.toLowerCase() === f.name.toLowerCase() && OO.sig(g) === OO.sig(f))) return true;
    return false;
  },
  /* il metodo è ridefinito in una sottoclasse? */
  overridden(prog, f) {
    const c = _CM.classOf(prog, f);
    return prog.classes.some((k) => k !== c && _CM.isSubclass(prog, k, c) && OO.methods(prog, k).some((g) => !g.static && g.name.toLowerCase() === f.name.toLowerCase() && OO.sig(g) === OO.sig(f)));
  },
  hasChildren: (prog, c) => prog.classes.some((k) => k !== c && (k.parent || '').toLowerCase() === c.name.toLowerCase()),
  /* super(...) come primo blocco del costruttore: { args, rest } */
  splitSuper(f) {
    const i = f.body.findIndex((s) => s.kind !== 'comment');
    const first = f.body[i];
    if (first && first.kind === 'call') { const e = strip(tryParse(first.expression)); if (e && e.k === 'supercall') return { args: e.args, rest: f.body.filter((_, k) => k !== i) }; }
    return { args: null, rest: f.body };
  },
  classScope: (prog, c, isStatic) => buildScope(prog, { params: [], body: [], cls: c.id, static: isStatic }),
  /* gruppi di metodi con lo stesso nome (overloading) */
  groups(list) { const m = new Map(); for (const f of list) { const k = f.name.toLowerCase(); if (!m.has(k)) m.set(k, []); m.get(k).push(f); } return [...m.values()]; },
  tag: (v) => ({ public: 'pubblico', private: 'privato', protected: 'protetto' }[v || 'public']),
};
/* Python e JavaScript non hanno l'overloading: un solo metodo che sceglie la versione dagli argomenti */
function dispatchCond(f, group, n, test) {
  const conds = [test.len(f.params.length)];
  if (group.filter((g) => g.params.length === f.params.length).length > 1) f.params.forEach((p, i) => conds.push(test.type(p, i)));
  return conds.join(n);
}

/* --------------------------- Linguaggi ----------------------------------- */
const LANGS = {};

function escStr(s, q) { return q + s.replace(/\\/g, '\\\\').replace(new RegExp(q, 'g'), '\\' + q) + q; }

const idxBrackets = (nm, ix) => nm + ix.map((i) => `[${i}]`).join('');
const idxComma = (nm, ix) => `${nm}[${ix.join(', ')}]`;
/* Size(a) e Size(m, d): dimensione richiesta (solo come numero scritto nel programma) e dimensioni dell'array */
function sizeInfo(n, sc) {
  const a = strip(n.args[0]); const dn = n.args[1] ? strip(n.args[1]) : null;
  let nd = 1;
  if (a && a.k === 'var') {
    const v = sc.vars.get(a.name.toLowerCase());
    if (v && v.dims) nd = v.dims;
    else if (!v && sc.implicitField) { const h = sc.implicitField(a.name); if (h && h.attr.array) nd = _CE.splitTop(h.attr.size).length; }
  } else if (a && a.k === 'member' && sc.objClass) {
    const c = sc.objClass(a.obj); const h = c && sc.fieldHit(c, a.name.toLowerCase());
    if (h && h.attr.array) nd = _CE.splitTop(h.attr.size).length;
  }
  return { d: dn && dn.k === 'num' ? dn.v : 0, nd };
}
const dimsOf = (s, E, sc) => _CE.splitTop(s.size).map((x) => E(x, sc));

/* Stampa generica di espressioni, con regole per linguaggio */
function exprPrinter(L) {
  function pr(n, sc) {
    switch (n.k) {
      case 'par': return pr(n.e, sc);
      case 'num': return { s: n.t === 'Real' ? (n.text && /[.eE]/.test(n.text) ? n.text : String(n.v) + '.0') : String(n.v), p: P.atom };
      case 'str': return { s: L.str(n.v), p: P.atom };
      case 'bool': return { s: n.v ? L.T : L.F, p: P.atom };
      case 'pi': L.use && L.use('pi'); return { s: L.pi, p: P.atom };
      case 'var': {
        let nm = vname(n.name, sc);
        // attributo usato con il solo nome dentro un metodo
        const h = sc.implicitField && sc.implicitField(n.name);
        if (h) nm = L.field ? L.field(h, sc) : h.attr.name;
        return { s: n.indices ? (L.idx || idxBrackets)(nm, n.indices.map((ix) => pr(ix, sc).s)) : nm, p: P.atom };
      }
      case 'null': return { s: L.nul || 'null', p: P.atom };
      case 'this': return { s: L.self || 'this', p: P.atom };
      case 'new': {
        const c = sc.classNamed ? sc.classNamed(n.cls) : null; const nm = c ? c.name : n.cls;
        const a = n.args.map((x) => pr(x, sc).s).join(', ');
        return { s: L.newObj ? L.newObj(nm, a) : `new ${nm}(${a})`, p: P.atom };
      }
      case 'supercall': { const a = n.args.map((x) => pr(x, sc).s).join(', '); return { s: L.superCtor ? L.superCtor(a, sc) : `super(${a})`, p: P.atom }; }
      case 'member': {
        const ref = objRef(n.obj, sc);
        const c = ref.cls || (sc.objClass && sc.objClass(n.obj));
        const h = c && sc.fieldHit(c, n.name.toLowerCase());
        const nm = h ? h.attr.name : n.name;
        let s = ref.cls ? (L.staticSep ? L.staticSep(ref.cls.name, nm) : `${ref.cls.name}.${nm}`) : `${ref.s}${L.arrow || '.'}${nm}`;
        if (n.indices) s = (L.idx || idxBrackets)(s, n.indices.map((ix) => pr(ix, sc).s));
        return { s, p: P.atom };
      }
      case 'mcall': {
        const a = n.args.map((x) => pr(x, sc).s).join(', ');
        const o = strip(n.obj);
        if (o.k === 'super') {
          const par = sc.classNamed && sc.classNamed(sc.cls && sc.cls.parent); const h = par && sc.methodHit(par, n.name.toLowerCase());
          const nm = h ? h.f.name : n.name;
          return { s: L.superMethod ? L.superMethod(nm, a, par) : `super.${nm}(${a})`, p: P.atom };
        }
        const ref = objRef(n.obj, sc);
        const c = ref.cls || (sc.objClass && sc.objClass(n.obj));
        const h = c && sc.methodHit(c, n.name.toLowerCase());
        const nm = h ? h.f.name : n.name;
        return { s: ref.cls ? `${L.staticSep ? L.staticSep(ref.cls.name, nm) : ref.cls.name + '.' + nm}(${a})` : `${ref.s}${L.arrow || '.'}${nm}(${a})`, p: P.atom };
      }
      case 'un':
        if (n.op === 'neg') { const e = pr(n.e, sc); return { s: '-' + (e.p < P.un ? `(${e.s})` : e.s), p: P.un }; }
        { const np = L.notPrec; const e = pr(n.e, sc); return { s: L.not + (e.p < np || (np === P.un && e.p === P.un && e.s[0] === '-') ? `(${e.s})` : e.s), p: np }; }
      case 'call': return L.call(n, sc, pr);
      case 'bin': return bin(n, sc);
    }
    return { s: '?', p: P.atom };
  }
  /* oggetto a sinistra del punto: una classe (accesso statico) oppure un'espressione */
  function objRef(objNode, sc) {
    const c = sc.classRef && sc.classRef(objNode);
    if (c) return { cls: c };
    const o = strip(objNode);
    if (o.k === 'this') return { s: L.self || 'this' };
    const e = pr(objNode, sc);
    return { s: e.p < P.atom ? `(${e.s})` : e.s };
  }
  function wrap(x, cond) { return cond ? `(${x.s})` : x.s; }
  function generic(n, sc, opText, prec, assoc) {
    const l = pr(n.l, sc), r = pr(n.r, sc);
    const ls = wrap(l, assoc === 'right' ? l.p <= prec : (assoc === 'none' ? l.p <= prec : l.p < prec));
    const rs = wrap(r, assoc === 'right' ? r.p < prec : r.p <= prec);
    return { s: `${ls} ${opText} ${rs}`, p: prec };
  }
  function bin(n, sc) {
    const op = n.op;
    if (L.bin) { const r = L.bin(n, sc, pr, generic); if (r) return r; }
    if (op === 'or') return generic(n, sc, L.or, P.or, 'left');
    if (op === 'and') return generic(n, sc, L.and, P.and, 'left');
    if (REL.includes(op)) return generic(n, sc, L.rel[op], P.rel, 'none');
    if (op === '+' || op === '-') return generic(n, sc, op, P.add, 'left');
    if (op === '*') return generic(n, sc, '*', P.mul, 'left');
    if (op === '/') return generic(n, sc, '/', P.mul, 'left');
    if (op === '%') return generic(n, sc, L.mod || '%', P.mul, 'left');
    if (op === '^') return generic(n, sc, L.pow, P.pow, 'right');
    return { s: '?', p: P.atom };
  }
  return pr;
}

/* Python e JavaScript: i metodi della classe si chiamano con self./this. oppure Classe. (statici) */
function ucall(entry, sc, self) {
  if (!sc.ooMode || !entry || !entry.owner) return '';
  return entry.f.static ? entry.owner.name + '.' : self + '.';
}
/* dichiarazione seguita subito dall'assegnazione della stessa variabile: diventa una
   dichiarazione con valore iniziale (double a = 0.0;). Restituisce l'espressione o null. */
function initOf(s, next) {
  if (!next || next.kind !== 'assign' || s.array) return null;
  const names = s.name.split(',').map((x) => x.trim()).filter(Boolean);
  if (names.length !== 1) return null;
  const tg = targetsOf(next); if (tg.length !== 1) return null;
  const lv = strip(tryParse(tg[0]));
  const low = names[0].toLowerCase();
  if (!lv || lv.k !== 'var' || lv.indices || lv.name.toLowerCase() !== low) return null;
  const e = tryParse(next.expression); if (!e) return null;
  let uses = false; // a ← a + 1 non si può unire
  const visit = (n) => { if (!n || typeof n !== 'object' || uses) return; if (n.k === 'var' && n.name.toLowerCase() === low) uses = true; Object.values(n).forEach(visit); };
  visit(e);
  return uses ? null : next.expression;
}
/* valore per una variabile reale: un intero scritto (0, -3) diventa 0.0, -3.0 */
function asReal(src, type, E, sc) {
  const s = E(src, sc);
  if (type !== 'Real') return s;
  const n = strip(tryParse(src));
  const intLit = (x) => !!x && x.k === 'num' && x.t === 'Integer';
  return n && (intLit(n) || (n.k === 'un' && n.op === 'neg' && intLit(strip(n.e)))) ? s + '.0' : s;
}

/* tipo di un riferimento modificabile (variabile, elemento, attributo) */
function lvTypeOf(v, sc) { const t = tryParse(v); const x = t && strip(t); return x ? _CE.inferType(x, sc) : 'String'; }

/* Elenco piatto degli operandi di una catena di & */
function concatParts(n) {
  n = strip(n);
  if (n.k === 'bin' && n.op === '&') return [...concatParts(n.l), ...concatParts(n.r)];
  return [n];
}

/* ------------------------------ Emettitore ------------------------------- */
class Out {
  constructor(ind) { this.lines = []; this.lvl = 0; this.ind = ind || '    '; }
  line(s) { this.lines.push(s === '' ? '' : this.ind.repeat(this.lvl) + s); }
  in() { this.lvl++; } out() { this.lvl--; }
  text() { return this.lines.join('\n') + '\n'; }
}

/* ============================ PSEUDOCODICE =============================== */
const TIPO = { Integer: 'intero', Real: 'reale', String: 'stringa', Boolean: 'booleano' };
LANGS.pseudo = {
  label: 'Pseudocodice', ext: 'txt', comment: '//',
  keywords: ['ALGORITMO', 'FINE', 'FUNZIONE', 'PROCEDURA', 'VARIABILI', 'SE', 'ALLORA', 'ALTRIMENTI', 'MENTRE', 'ESEGUI', 'PER', 'DA', 'A', 'PASSO', 'RIPETI', 'LEGGI', 'SCRIVI', 'CHIAMA', 'RESTITUISCI', 'AND', 'OR', 'NOT', 'MOD', 'VERO', 'FALSO', 'DICHIARA', 'ARRAY', 'DI', 'INDIETRO', 'APRI', 'CHIUDI', 'IN', 'LETTURA', 'SCRITTURA', 'CLASSE', 'EREDITA', 'ATTRIBUTI', 'METODO', 'STATICO', 'COSTRUTTORE', 'NUOVO', 'QUESTO', 'NULLO', 'SUPER', 'ASTRATTA', 'ASTRATTO'],
  generate(prog) {
    const L = {
      idx: idxComma, str: (s) => '"' + s + '"', T: 'VERO', F: 'FALSO', pi: 'π', not: 'NOT ', notPrec: P.un, or: 'OR', and: 'AND', mod: 'MOD', pow: '^',
      rel: { '==': '=', '!=': '≠', '<': '<', '<=': '≤', '>': '>', '>=': '≥' },
      call: (n, sc, pr) => ({ s: `${_CE.BUILTIN_NAMES[n.name.toLowerCase()] && !sc.funcs.has(n.name.toLowerCase()) ? _CE.BUILTIN_NAMES[n.name.toLowerCase()] : fname(n.name, sc)}(${n.args.map((a) => pr(a, sc).s).join(', ')})`, p: P.atom }),
      nul: 'NULLO', self: 'QUESTO', newObj: (c, a) => `NUOVO ${c}(${a})`, superCtor: (a) => `SUPER(${a})`, superMethod: (m, a) => `SUPER.${m}(${a})`,
      bin: (n, sc, pr, generic) => (n.op === '&' ? generic(n, sc, '&', P.add - 0.5, 'left') : null),
    };
    const pr = exprPrinter(L);
    const o = new Out('   ');
    const E = (src, sc) => { const t = tryParse(src); return t ? pr(t, sc).s : src; };
    const block = (stmts, sc) => {
      for (const s of stmts) {
        switch (s.kind) {
          case 'const': o.line(`COSTANTE ${s.name} : ${TIPO[s.type] || s.type} = ${E(s.expression, sc)}`); break;
          case 'declare': o.line(`DICHIARA ${s.array ? `ARRAY ${s.name.split(',').map((x) => x.trim() + '[' + dimsOf(s, E, sc).join(', ') + ']').join(', ')} DI ${TIPO[s.type] || s.type}` : `${s.name} : ${TIPO[s.type] || s.type}`}`); break;
          case 'assign': o.line(`${targetsOf(s).map((x) => E(x, sc)).join(', ')} ← ${E(s.expression, sc)}`); break;
          case 'input': o.line(`LEGGI ${E(s.variable, sc)}`); break;
          case 'output': o.line(`SCRIVI ${E(s.expression, sc)}${s.newline ? '' : '   // senza a capo'}`); break;
          case 'if':
            o.line(`SE ${E(s.expression, sc)} ALLORA`); o.in(); block(s.then, sc); o.out();
            if (s.else.length) { o.line('ALTRIMENTI'); o.in(); block(s.else, sc); o.out(); }
            o.line('FINE SE'); break;
          case 'while': o.line(`MENTRE ${E(s.expression, sc)} ESEGUI`); o.in(); block(s.body, sc); o.out(); o.line('FINE MENTRE'); break;
          case 'do': o.line('RIPETI'); o.in(); block(s.body, sc); o.out(); o.line(`MENTRE ${E(s.expression, sc)}`); break;
          case 'for': {
            const st = String(s.step).trim();
            o.line(`PER ${E(s.variable, sc)} DA ${E(s.start, sc)} A ${E(s.end, sc)}${s.direction === 'dec' ? ' INDIETRO' : ''}${st && st !== '1' ? ' PASSO ' + E(st, sc) : ''} ESEGUI`);
            o.in(); block(s.body, sc); o.out(); o.line('FINE PER'); break;
          }
          case 'call': o.line(`CHIAMA ${/\(/.test(s.expression) ? E(s.expression, sc) : fname(s.expression.trim(), sc) + '()'}`); break;
          case 'comment': for (const l of String(s.text).split('\n')) o.line('// ' + l); break;
          case 'breakpoint': o.line(`// punto di interruzione${s.always ? '' : ' se ' + s.expression}`); break;
          case 'open': o.line(`APRI ${E(s.expression, sc)} IN ${s.mode === 'read' ? 'LETTURA' : 'SCRITTURA'}`); break;
          case 'close': o.line(`CHIUDI FILE IN ${s.mode === 'read' ? 'LETTURA' : 'SCRITTURA'}`); break;
          case 'read': o.line(`LEGGI ${E(s.variable, sc)} DAL FILE`); break;
          case 'write': o.line(`SCRIVI ${E(s.expression, sc)} NEL FILE`); break;
        }
      }
    };
    const T = (t) => TIPO[t] || t;
    const psig = (f) => f.params.map((p) => `${p.name} : ${p.array ? ((p.dims || 1) > 1 ? `array a ${p.dims} dimensioni di ` : 'array di ') : ''}${T(p.type)}`).join(', ');
    if (_CM.hasClasses(prog)) {
      const main = _CM.mainClass(prog);
      const V = (v) => _CM.VISIBILITY[v || 'public'];
      OO.ordered(prog, true).forEach((c, ci) => {
        if (ci) o.line('');
        o.line(`${c.abstract ? 'CLASSE ASTRATTA' : 'CLASSE'} ${c.name}${c.parent ? ' EREDITA DA ' + c.parent : ''}${c === main ? '   // classe principale: il programma parte da Main' : ''}`);
        o.in();
        if (c.attributes.length) {
          o.line('ATTRIBUTI'); o.in();
          for (const a of c.attributes) {
            const sc = OO.classScope(prog, c, a.static);
            o.line(`${V(a.visibility)} ${a.name}${a.array ? '[' + _CE.splitTop(a.size).map((x) => E(x, sc)).join(', ') + ']' : ''} : ${T(a.type)}${a.static ? ' STATICO' : ''}${String(a.init || '').trim() ? ' = ' + E(a.init, sc) : ''}`);
          }
          o.out();
        }
        for (const f of [...OO.ctors(prog, c), ...OO.methods(prog, c)]) {
          const sc = buildScope(prog, f);
          const rl = _CM.rets(f);
          o.line('');
          const kw = f.ctor ? 'COSTRUTTORE' : (f.static ? 'METODO STATICO' : f.abstract ? 'METODO ASTRATTO' : 'METODO');
          if (f.abstract) { o.line(`${kw} ${V(f.visibility)} ${f.name}(${psig(f)})${rl.length ? ' : ' + rl.map((r) => T(r.type)).join(', ') : ''}   // senza corpo: lo definiscono le sottoclassi`); continue; }
          o.line(`${kw} ${V(f.visibility)} ${f.name}(${psig(f)})${rl.length ? ' : ' + rl.map((r) => T(r.type)).join(', ') : ''}`);
          o.in(); block(f.body, sc);
          if (rl.length) o.line(`RESTITUISCI ${rl.map((r) => r.name).join(', ')}`);
          o.out(); o.line(f.ctor ? 'FINE COSTRUTTORE' : 'FINE METODO');
        }
        o.out(); o.line('FINE CLASSE');
      });
      return o.text();
    }
    prog.functions.forEach((f, i) => {
      const sc = buildScope(prog, f);
      if (i > 0) o.line('');
      if (i === 0) o.line(`ALGORITMO ${prog.attrs.name ? prog.attrs.name.replace(/\s+/g, '_') : 'Main'}`);
      else {
        const ps = f.params.map((p) => `${p.name} : ${p.array ? ((p.dims || 1) > 1 ? `array a ${p.dims} dimensioni di ` : 'array di ') : ''}${TIPO[p.type]}`).join(', ');
        const rl = _CM.rets(f);
        o.line(!rl.length ? `PROCEDURA ${f.name}(${ps})` : `FUNZIONE ${f.name}(${ps}) : ${rl.map((r) => TIPO[r.type]).join(', ')}`);
      }
      o.in(); block(f.body, sc);
      if (i > 0 && _CM.rets(f).length) o.line(`RESTITUISCI ${_CM.rets(f).map((r) => r.name).join(', ')}`);
      o.out();
      o.line(i === 0 ? 'FINE' : (!_CM.rets(f).length ? 'FINE PROCEDURA' : 'FINE FUNZIONE'));
    });
    return o.text();
  },
};

/* =============================== PYTHON ================================== */
LANGS.python = {
  label: 'Python', ext: 'py', comment: '#',
  keywords: ['def', 'return', 'if', 'elif', 'else', 'while', 'for', 'in', 'range', 'and', 'or', 'not', 'True', 'False', 'import', 'break', 'print', 'input', 'int', 'float', 'str', 'len', 'None', 'pass', 'global', 'open', 'with', 'as', 'class', 'self', 'super', 'is', 'elif', 'staticmethod', 'isinstance', 'raise', 'type', 'args', 'abstractmethod', 'from'],
  generate(prog) {
    const used = new Set();
    const L = {
      str: (s) => escStr(s, '"'), T: 'True', F: 'False', pi: 'math.pi', use: (x) => used.add(x === 'pi' ? 'math' : x), not: 'not ', notPrec: P.notLow, or: 'or', and: 'and', pow: '**',
      rel: { '==': '==', '!=': '!=', '<': '<', '<=': '<=', '>': '>', '>=': '>=' },
      nul: 'None', self: 'self', newObj: (c, a) => `${c}(${a})`, superCtor: (a) => `super().__init__(${a})`, superMethod: (m, a) => `super().${m}(${a})`,
      field: (h, sc) => (h.attr.static ? `${h.owner.name}.${h.attr.name}` : `self.${h.attr.name}`),
      bin(n, sc, pr, generic) {
        // confronto con None: is / is not
        if ((n.op === '==' || n.op === '!=') && (strip(n.l).k === 'null' || strip(n.r).k === 'null')) return generic(n, sc, n.op === '==' ? 'is' : 'is not', P.rel, 'none');
        if (n.op === '&') {
          const parts = concatParts(n).map((x) => { const t = _CE.inferType(x, sc); const e = pr(x, sc); return t === 'String' ? (e.p <= P.add ? `(${e.s})` : e.s) : `str(${e.s})`; });
          return { s: parts.join(' + '), p: P.add };
        }
        return null;
      },
      call(n, sc, pr) {
        const a = n.args.map((x) => pr(x, sc));
        const A = (i) => (a[i] ? a[i].s : '');
        const At = (i) => (a[i] ? (a[i].p < P.atom ? `(${a[i].s})` : a[i].s) : '');
        if (sc.funcs.has(n.name.toLowerCase())) return { s: `${ucall(sc.funcs.get(n.name.toLowerCase()), sc, 'self')}${fname(n.name, sc)}(${a.map((x) => x.s).join(', ')})`, p: P.atom };
        const low = n.name.toLowerCase();
        const M = (f) => { used.add('math'); return { s: `math.${f}(${A(0)})`, p: P.atom }; };
        switch (low) {
          case 'abs': return { s: `abs(${A(0)})`, p: P.atom };
          case 'arccos': return M('acos'); case 'arcsin': return M('asin'); case 'arctan': return M('atan');
          case 'cos': case 'sin': case 'tan': case 'cosh': case 'sinh': case 'tanh': case 'sqrt': case 'log10': return M(low);
          case 'arccosh': return M('acosh'); case 'arcsinh': return M('asinh'); case 'arctanh': return M('atanh');
          case 'ln': case 'log': return M('log');
          case 'int': return { s: `int(${A(0)})`, p: P.atom };
          case 'sgn': return { s: `((${A(0)} > 0) - (${A(0)} < 0))`, p: P.atom };
          case 'random': used.add('random'); return { s: `random.randrange(${A(0)})`, p: P.atom };
          case 'len': return { s: `len(${A(0)})`, p: P.atom };
          case 'size': return { s: `len(${A(0)}${'[0]'.repeat(sizeInfo(n, sc).d)})`, p: P.atom };
          case 'char': return { s: `${At(0)}[${A(1)}]`, p: P.atom };
          case 'tochar': return { s: `chr(${A(0)})`, p: P.atom };
          case 'tocode': return { s: `ord(${A(0)})`, p: P.atom };
          case 'tofixed': return { s: `"{:.{}f}".format(${A(0)}, ${A(1)})`, p: P.atom };
          case 'tointeger': return { s: `int(${A(0)})`, p: P.atom };
          case 'toreal': return { s: `float(${A(0)})`, p: P.atom };
          case 'tostring': return { s: `str(${A(0)})`, p: P.atom };
          case 'eof': used.add('eof'); return { s: 'fine_file()', p: P.atom };
        }
        return { s: `${n.name}(${a.map((x) => x.s).join(', ')})`, p: P.atom };
      },
    };
    const pr = exprPrinter(L);
    const E = (src, sc) => { const t = tryParse(src); return t ? pr(t, sc).s : src; };
    const DEF = { Integer: '0', Real: '0.0', String: '""', Boolean: 'False' };
    const DEFT = (t) => DEF[t] || 'None';
    const CAST = { Integer: 'int(input())', Real: 'float(input())', String: 'input()', Boolean: 'input().strip().lower() == "true"' };
    const lvType = (v, sc) => lvTypeOf(v, sc);
    const body = new Out();
    const block = (stmts, sc, o) => {
      const start = o.lines.length;
      for (let si = 0; si < stmts.length; si++) {
        const s = stmts[si];
        switch (s.kind) {
          case 'const': o.line(`${vname(s.name.trim(), sc)} = ${E(s.expression, sc)}  # costante`); break;
          case 'declare': {
            const init = initOf(s, stmts[si + 1]);
            if (init != null) { o.line(`${s.name.trim()} = ${asReal(init, s.type, E, sc)}`); si++; break; }
            for (const nm of s.name.split(',').map((x) => x.trim()).filter(Boolean)) {
              if (!s.array) { o.line(`${nm} = ${DEFT(s.type)}`); continue; }
              const D = dimsOf(s, E, sc);
              let init = `[${DEFT(s.type)}] * (${D[D.length - 1]})`;
              for (let k = D.length - 2; k >= 0; k--) init = `[${init} for _ in range(${D[k]})]`;
              o.line(`${nm} = ${init}`);
            }
            break;
          }
          case 'assign': { const tg = targetsOf(s); o.line(`${tg.map((x) => E(x, sc)).join(', ')} = ${tg.length === 1 ? asReal(s.expression, lvType(s.variable, sc), E, sc) : E(s.expression, sc)}`); break; }
          case 'input': o.line(`${E(s.variable, sc)} = ${CAST[lvType(s.variable, sc)]}`); break;
          case 'output': o.line(s.newline ? `print(${E(s.expression, sc)})` : `print(${E(s.expression, sc)}, end="")`); break;
          case 'if': {
            o.line(`if ${E(s.expression, sc)}:`); o.in(); block(s.then, sc, o); o.out();
            if (s.else.length === 1 && s.else[0].kind === 'if') {
              // catena elif
              let cur = s.else[0];
              for (;;) {
                o.line(`elif ${E(cur.expression, sc)}:`); o.in(); block(cur.then, sc, o); o.out();
                if (cur.else.length === 1 && cur.else[0].kind === 'if') { cur = cur.else[0]; continue; }
                if (cur.else.length) { o.line('else:'); o.in(); block(cur.else, sc, o); o.out(); }
                break;
              }
            } else if (s.else.length) { o.line('else:'); o.in(); block(s.else, sc, o); o.out(); }
            break;
          }
          case 'while': o.line(`while ${E(s.expression, sc)}:`); o.in(); block(s.body, sc, o); o.out(); break;
          case 'do': {
            o.line('while True:'); o.in(); block(s.body, sc, o);
            const t = tryParse(s.expression); const c = t ? pr(t, sc) : { s: s.expression, p: 0 };
            o.line(`if not ${c.p <= P.notLow ? '(' + c.s + ')' : c.s}:`); o.in(); o.line('break'); o.out(); o.out();
            break;
          }
          case 'for': {
            const step = String(s.step).trim() || '1';
            const isReal = lvType(s.variable, sc) === 'Real';
            if (isReal) {
              o.line(`${E(s.variable, sc)} = ${E(s.start, sc)}`);
              o.line(`while ${E(s.variable, sc)} ${s.direction === 'dec' ? '>=' : '<='} ${E(s.end, sc)}:`); o.in(); block(s.body, sc, o);
              o.line(`${E(s.variable, sc)} ${s.direction === 'dec' ? '-=' : '+='} ${E(step, sc)}`); o.out();
            } else {
              const endT = tryParse(s.end); const endP = endT ? pr(endT, sc) : { s: s.end, p: 0 };
              const endS = endP.p < P.add ? `(${endP.s})` : endP.s;
              const lim = s.direction === 'dec' ? `${endS} - 1` : `${endS} + 1`;
              const stepS = step === '1' ? '' : `, ${s.direction === 'dec' ? '-' : ''}${E(step, sc)}`;
              o.line(`for ${E(s.variable, sc)} in range(${E(s.start, sc)}, ${lim}${s.direction === 'dec' && step === '1' ? ', -1' : stepS}):`);
              o.in(); block(s.body, sc, o); o.out();
            }
            break;
          }
          case 'call': o.line(/\(/.test(s.expression) ? E(s.expression, sc) : fname(s.expression.trim(), sc) + '()'); break;
          case 'comment': for (const l of String(s.text).split('\n')) o.line('# ' + l); break;
          case 'breakpoint': o.line(`# punto di interruzione${s.always ? '' : ': ' + s.expression}`); break;
          case 'open': used.add('files'); o.line(s.mode === 'read' ? `file_lettura = open(${E(s.expression, sc)}, "r")` : `file_scrittura = open(${E(s.expression, sc)}, "w")`); break;
          case 'close': used.add('files'); o.line(s.mode === 'read' ? 'file_lettura.close()' : 'file_scrittura.close()'); break;
          case 'read': {
            used.add('files'); const t = lvType(s.variable, sc);
            const raw = 'file_lettura.readline().rstrip("\\n")';
            o.line(`${E(s.variable, sc)} = ${t === 'Integer' ? `int(${raw})` : t === 'Real' ? `float(${raw})` : t === 'Boolean' ? `${raw}.lower() == "true"` : raw}`);
            break;
          }
          case 'write': used.add('files'); o.line(`file_scrittura.write(str(${E(s.expression, sc)}) + "\\n")`); break;
        }
      }
      if (o.lines.length === start) o.line('pass');
    };
    const pyArr = (D, def) => { let init = `[${def}] * (${D[D.length - 1]})`; for (let k = D.length - 2; k >= 0; k--) init = `[${init} for _ in range(${D[k]})]`; return init; };
    const head = () => {
      const hd = [];
      if (prog.attrs.name) hd.push(`# ${prog.attrs.name}`);
      if (used.has('math')) hd.push('import math');
      if (used.has('random')) hd.push('import random');
      if (used.has('abc')) hd.push('from abc import ABC, abstractmethod');
      if (hd.length) hd.push('');
      if (used.has('eof')) hd.push('def fine_file():', '    pos = file_lettura.tell()', '    riga = file_lettura.readline()', '    file_lettura.seek(pos)', '    return riga == ""', '', '');
      return hd.join('\n') + (hd.length ? '\n' : '');
    };
    if (_CM.hasClasses(prog)) {
      // ---------------- programma a oggetti ----------------
      const o = new Out();
      const main = _CM.mainClass(prog);
      const attrInit = (a, sc) => (a.array ? pyArr(_CE.splitTop(a.size).map((x) => E(x, sc)), DEFT(a.type)) : (String(a.init || '').trim() ? E(a.init, sc) : DEFT(a.type)));
      const pyType = { Integer: (x) => `type(${x}) is int`, Real: (x) => `isinstance(${x}, (int, float))`, String: (x) => `isinstance(${x}, str)`, Boolean: (x) => `isinstance(${x}, bool)` };
      const test = { len: (n) => `len(args) == ${n}`, type: (p, i) => (p.array ? `isinstance(args[${i}], list)` : (pyType[p.type] || ((x) => `isinstance(${x}, ${p.type})`))(`args[${i}]`)) };
      for (const c of OO.ordered(prog, false)) {
        // classe astratta: deriva da ABC (se la madre non lo è già)
        const par = _CM.classByName(prog, c.parent);
        const bases = [...(c.parent ? [c.parent] : []), ...(c.abstract && !(par && _CM.chainOf(prog, par).some((k) => k.abstract)) ? ['ABC'] : [])];
        if (c.abstract) used.add('abc');
        o.line(`class ${c.name}${bases.length ? `(${bases.join(', ')})` : ''}:`); o.in();
        const start = o.lines.length;
        for (const a of c.attributes.filter((x) => x.static)) o.line(`${a.name} = ${attrInit(a, OO.classScope(prog, c, true))}  # statico, ${OO.tag(a.visibility)}`);
        const inst = c.attributes.filter((x) => !x.static);
        const fieldLines = (out) => { const sc = OO.classScope(prog, c, false); for (const a of inst) out.line(`self.${a.name} = ${attrInit(a, sc)}${a.visibility !== 'public' ? '  # ' + OO.tag(a.visibility) : ''}`); };
        // corpo di un costruttore: super, attributi, blocchi
        const ctorBody = (f, out) => {
          const sp = OO.splitSuper(f); const sc = buildScope(prog, f);
          if (sp.args) out.line(`super().__init__(${sp.args.map((x) => pr(x, sc).s).join(', ')})`);
          else if (c.parent) out.line('super().__init__()');
          fieldLines(out);
          block(sp.rest, sc, out);
          if (out.lines[out.lines.length - 1].trim() === 'pass' && out.lines.length > 1 && /self\.|super\(\)/.test(out.lines[out.lines.length - 2])) out.lines.pop();
        };
        const methodBody = (f, out) => {
          if (f.abstract) { out.line(`raise NotImplementedError("${f.name}() è astratto: lo definiscono le sottoclassi")`); return; }
          const before = out.lines.length;
          block(f.body, buildScope(prog, f), out);
          const rl = _CM.rets(f);
          if (rl.length) {
            if (out.lines.length === before + 1 && out.lines[out.lines.length - 1].trim() === 'pass') out.lines.pop();
            out.line(`return ${rl.map((r) => r.name).join(', ')}`);
          }
        };
        const ctors = OO.ctors(prog, c);
        if (!ctors.length && (inst.length || c.parent)) {
          if (o.lines.length > start) o.line('');
          o.line('def __init__(self):'); o.in(); if (c.parent) o.line('super().__init__()'); fieldLines(o); o.out();
        }
        const emitGroup = (group, isCtor) => {
          if (o.lines.length > start) o.line('');
          const f0 = group[0];
          const isStatic = !isCtor && f0.static;
          const name = isCtor ? '__init__' : (OO.isMain(prog, f0) ? 'main' : f0.name);
          const note = (f) => ((f.visibility || 'public') !== 'public' ? '  # ' + OO.tag(f.visibility) : '');
          if (isStatic) o.line('@staticmethod');
          if (group.length === 1 && f0.abstract) {
            used.add('abc');
            o.line('@abstractmethod');
            o.line(`def ${name}(${['self', ...f0.params.map((x) => x.name)].join(', ')}):${note(f0)}`);
            o.in(); o.line('pass'); o.out();
            return;
          }
          if (group.length === 1) {
            o.line(`def ${name}(${[...(isStatic ? [] : ['self']), ...f0.params.map((x) => x.name)].join(', ')}):${note(f0)}`);
            o.in(); (isCtor ? ctorBody : methodBody)(f0, o); o.out();
            return;
          }
          // overloading: si sceglie la versione dal numero e dal tipo degli argomenti
          o.line(`def ${name}(${isStatic ? '' : 'self, '}*args):  # ${group.length} versioni${note(f0)}`); o.in();
          group.forEach((f, k) => {
            o.line(`${k ? 'elif' : 'if'} ${dispatchCond(f, group, ' and ', test)}:`); o.in();
            if (f.params.length) o.line(`${f.params.map((x) => x.name).join(', ')}${f.params.length === 1 ? ',' : ''} = args`);
            (isCtor ? ctorBody : methodBody)(f, o); o.out();
          });
          o.line('else:'); o.in(); o.line(`raise TypeError("${isCtor ? c.name : f0.name}: nessuna versione accetta questi argomenti")`); o.out();
          o.out();
        };
        if (ctors.length) emitGroup(ctors, true);
        for (const g of OO.groups(OO.methods(prog, c))) emitGroup(g, false);
        if (o.lines.length === start) o.line('pass');
        o.out(); o.line(''); o.line('');
      }
      o.line(`${main.name}.main()`);
      return head() + o.text();
    }
    const funcs = new Out();
    prog.functions.slice(1).forEach((f) => {
      const sc = buildScope(prog, f);
      funcs.line(`def ${f.name}(${f.params.map((p) => p.name).join(', ')}):`);
      funcs.in();
      const before = funcs.lines.length;
      block(f.body, sc, funcs);
      const rl = _CM.rets(f);
      if (rl.length) {
        if (funcs.lines.length === before + 1 && funcs.lines[funcs.lines.length - 1].trim() === 'pass') funcs.lines.pop();
        funcs.line(`return ${rl.map((r) => r.name).join(', ')}`);
      }
      funcs.out(); funcs.line(''); funcs.line('');
    });
    const main = prog.functions[0];
    block(main.body, buildScope(prog, main), body);
    return head() + (funcs.lines.length ? funcs.text() : '') + '# Main\n' + body.text();
  },
};

/* ======================== Famiglia C (C++, Java, C#, JS) ================= */
function cFamily(cfg) {
  return {
    label: cfg.label, ext: cfg.ext, comment: '//', keywords: cfg.keywords,
    generate(prog) {
      const used = new Set();
      const L = {
        idx: cfg.idx, str: (s) => cfg.strLit(s), T: 'true', F: 'false', pi: cfg.pi, use: () => used.add('pi'),
        not: '!', notPrec: P.un, or: '||', and: '&&', pow: '**',
        rel: { '==': cfg.eq || '==', '!=': cfg.neq || '!=', '<': '<', '<=': '<=', '>': '>', '>=': '>=' },
        nul: cfg.nul, self: cfg.self, arrow: cfg.arrow, staticSep: cfg.staticSep, newObj: cfg.newObj, superCtor: cfg.superCtor, superMethod: cfg.superMethod, field: cfg.field,
        bin(n, sc, pr) {
          const lt = _CE.inferType(n.l, sc), rt = _CE.inferType(n.r, sc);
          if (n.op === '&') {
            const parts = concatParts(n).map((x) => cfg.toStr(x, _CE.inferType(x, sc), pr(x, sc), used));
            if (cfg.concatPrefix && _CE.inferType(concatParts(n)[0], sc) !== 'String') parts.unshift(cfg.concatPrefix);
            return { s: parts.join(' + '), p: P.add };
          }
          if (n.op === '/' && cfg.intDiv && lt !== 'Real' && rt !== 'Real') {
            const l = pr(n.l, sc), r = pr(n.r, sc);
            return { s: `(double) ${l.p < P.atom ? '(' + l.s + ')' : l.s} / ${r.p <= P.mul ? '(' + r.s + ')' : r.s}`, p: P.mul };
          }
          if (n.op === '%' && cfg.fmod && (lt === 'Real' || rt === 'Real')) return { s: `fmod(${pr(n.l, sc).s}, ${pr(n.r, sc).s})`, p: P.atom };
          if (n.op === '^' && cfg.powFn) {
            const s = `${cfg.powFn}(${pr(n.l, sc).s}, ${pr(n.r, sc).s})`;
            return _CE.inferType(n, sc) === 'Integer' && cfg.intCast ? { s: `${cfg.intCast}${s}`, p: P.un } : { s, p: P.atom };
          }
          if (n.op === '^') { // JavaScript **
            const l = pr(n.l, sc), r = pr(n.r, sc);
            return { s: `${l.p <= P.pow ? '(' + l.s + ')' : l.s} ** ${r.p < P.pow ? '(' + r.s + ')' : r.s}`, p: P.pow };
          }
          if (REL.includes(n.op) && lt === 'String' && rt === 'String' && cfg.strCmp) return cfg.strCmp(n.op, pr(n.l, sc), pr(n.r, sc));
          return null;
        },
        call(n, sc, pr) {
          const a = n.args.map((x) => pr(x, sc));
          if (sc.funcs.has(n.name.toLowerCase())) return { s: `${cfg.qualifyCalls ? ucall(sc.funcs.get(n.name.toLowerCase()), sc, 'this') : ''}${fname(n.name, sc)}(${a.map((x) => x.s).join(', ')})`, p: P.atom };
          const low = n.name.toLowerCase();
          const r = cfg.builtin(low, a, n, sc, used);
          if (r) return typeof r === 'string' ? { s: r, p: P.atom } : r;
          return { s: `${n.name}(${a.map((x) => x.s).join(', ')})`, p: P.atom };
        },
      };
      const pr = exprPrinter(L);
      const E = (src, sc) => { const t = tryParse(src); return t ? pr(t, sc).s : src; };
      const lvInfo = (v, sc) => ({ type: lvTypeOf(v, sc) });
      const blk = (o, stmts, sc) => { o.in(); block(o, stmts, sc); o.out(); };
      const unsupported = (o, what) => o.line(`// [${what}: non disponibile in ${cfg.label}]`);
      function block(o, stmts, sc) {
        for (let si = 0; si < stmts.length; si++) {
          const s = stmts[si];
          switch (s.kind) {
            case 'const': o.line(cfg.constDecl(s.name.trim(), s.type, E(s.expression, sc), isLiteralExpr(s.expression))); break;
            case 'declare': {
              const init = initOf(s, stmts[si + 1]);
              if (init != null && cfg.declareInit) { o.line(cfg.declareInit(s.name.trim(), s.type, asReal(init, s.type, E, sc))); si++; break; }
              for (const nm of s.name.split(',').map((x) => x.trim()).filter(Boolean)) o.line(cfg.declare(nm, s.type, s.array, s.array ? dimsOf(s, E, sc) : null, used));
              break;
            }
            case 'assign': {
              const tg = targetsOf(s);
              if (tg.length > 1) cfg.multiAssign(o, tg.map((x) => E(x, sc)), E(s.expression, sc), calleeOf(s, sc), sc, used);
              else o.line(`${E(s.variable, sc)} = ${asReal(s.expression, lvInfo(s.variable, sc).type, E, sc)};`);
              break;
            }
            case 'input': cfg.input(o, E(s.variable, sc), lvInfo(s.variable, sc).type, used); break;
            case 'output': {
              // in C++ << lega più dei confronti: cout << (a == b)
              const x = tryParse(s.expression); const ex = x ? pr(x, sc) : { s: s.expression, p: P.atom };
              o.line(cfg.output(cfg.wrapOut && ex.p <= P.rel ? `(${ex.s})` : ex.s, s.newline) + ';');
              break;
            }
            case 'if': {
              o.line(`if (${E(s.expression, sc)}) {`); blk(o, s.then, sc);
              let cur = s;
              while (cur.else.length === 1 && cur.else[0].kind === 'if') {
                cur = cur.else[0];
                o.line(`} else if (${E(cur.expression, sc)}) {`); blk(o, cur.then, sc);
              }
              if (cur.else.length) { o.line('} else {'); blk(o, cur.else, sc); }
              o.line('}');
              break;
            }
            case 'while': o.line(`while (${E(s.expression, sc)}) {`); blk(o, s.body, sc); o.line('}'); break;
            case 'do': o.line('do {'); blk(o, s.body, sc); o.line(`} while (${E(s.expression, sc)});`); break;
            case 'for': {
              const v = E(s.variable, sc), step = String(s.step).trim() || '1', dec = s.direction === 'dec';
              const inc = step === '1' ? (dec ? `${v}--` : `${v}++`) : `${v} ${dec ? '-=' : '+='} ${E(step, sc)}`;
              o.line(`for (${v} = ${E(s.start, sc)}; ${v} ${dec ? '>=' : '<='} ${E(s.end, sc)}; ${inc}) {`); blk(o, s.body, sc); o.line('}');
              break;
            }
            case 'call': o.line((/\(/.test(s.expression) ? E(s.expression, sc) : fname(s.expression.trim(), sc) + '()') + ';'); break;
            case 'comment': for (const l of String(s.text).split('\n')) o.line('// ' + l); break;
            case 'breakpoint': o.line(`// punto di interruzione${s.always ? '' : ': ' + s.expression}`); break;
            case 'open': case 'close': case 'read': case 'write':
              if (cfg.files) cfg.files(o, s, E, sc, lvInfo, used); else unsupported(o, `file: ${s.kind} ${s.expression || s.variable || s.mode}`);
              break;
          }
        }
      }
      const g = { block, E, pr, buildScope: (f) => buildScope(prog, f), used, Out };
      if (_CM.hasClasses(prog) && cfg.programOO) return cfg.programOO(prog, g);
      return cfg.program(prog, g);
    },
  };
}

const T_CPP = { Integer: 'int', Real: 'double', String: 'string', Boolean: 'bool', None: 'void' };
const tCpp = (t) => T_CPP[t] || t + '*'; // gli oggetti in C++ sono puntatori (creati con new)
const DEF_CPP = { Integer: '0', Real: '0.0', String: '""', Boolean: 'false' };
const usesFiles = (prog) => prog.functions.some((f) => { let u = false; _CM.walk(f.body, (s) => { if (['open', 'close', 'read', 'write'].includes(s.kind)) u = true; }); return u; });
const cap = (n) => n[0].toUpperCase() + n.slice(1);
/* parti di una dichiarazione C++: tipo e inizializzazione (vector annidati per gli array) */
function cppParts(t, arr, D) {
  if (!arr) return { ty: tCpp(t), init: null };
  const ty = (k) => 'vector<'.repeat(D.length - k) + tCpp(t) + '>'.repeat(D.length - k);
  const init = (k) => (k === D.length - 1 ? D[k] : `${D[k]}, ${ty(k + 1)}(${init(k + 1)})`);
  return { ty: ty(0), args: init(0) };
}
LANGS.cpp = cFamily({
  label: 'C++', ext: 'cpp', intDiv: true, fmod: true, powFn: 'pow', intCast: '(int) ', wrapOut: true,
  keywords: ['int', 'double', 'string', 'bool', 'void', 'return', 'if', 'else', 'while', 'for', 'do', 'true', 'false', 'using', 'namespace', 'std', 'include', 'cout', 'cin', 'endl', 'vector', 'const', 'main', 'class', 'public', 'private', 'protected', 'static', 'virtual', 'new', 'this', 'nullptr'],
  pi: 'PI',
  strLit: (s) => escStr(s, '"'),
  toStr(x, t, e, used) {
    if (t === 'String') return x.k === 'str' ? `string(${e.s})` : (e.p <= P.add ? `(${e.s})` : e.s);
    if (t === 'Boolean') return `string(${e.s} ? "true" : "false")`;
    if (t === 'Real') { used.add('fmt'); return `formatta(${e.s})`; }
    return `to_string(${e.s})`;
  },
  builtin(low, a, n, sc, used) {
    const A = (i) => (a[i] ? a[i].s : '');
    const At = (i) => (a[i] ? (strip(n.args[i]).k === 'str' ? `string(${a[i].s})` : a[i].p < P.atom ? `(${a[i].s})` : a[i].s) : '');
    const map = { abs: 'abs', arccos: 'acos', arcsin: 'asin', arctan: 'atan', cos: 'cos', sin: 'sin', tan: 'tan', cosh: 'cosh', sinh: 'sinh', tanh: 'tanh', arccosh: 'acosh', arcsinh: 'asinh', arctanh: 'atanh', ln: 'log', log: 'log', log10: 'log10', sqrt: 'sqrt' };
    if (map[low]) return `${map[low]}(${A(0)})`;
    switch (low) {
      case 'int': return { s: `(int) ${At(0)}`, p: P.un };
      case 'sgn': return `((${A(0)} > 0) - (${A(0)} < 0))`;
      case 'random': used.add('rand'); return { s: `rand() % ${At(0)}`, p: P.mul };
      case 'len': return `(int) ${At(0)}.length()`;
      case 'size': return `(int) ${At(0)}${'[0]'.repeat(sizeInfo(n, sc).d)}.size()`;
      case 'char': return `string(1, ${At(0)}[${A(1)}])`;
      case 'tochar': return `string(1, (char) ${At(0)})`;
      case 'tocode': return `(int) ${At(0)}[0]`;
      case 'tofixed': used.add('fixed'); return `aDecimali(${A(0)}, ${A(1)})`;
      case 'tointeger': return `stoi(${A(0)})`;
      case 'toreal': return `stod(${A(0)})`;
      case 'tostring': { const t = _CE.inferType(n.args[0], sc); if (t === 'String') return A(0); if (t === 'Real') { used.add('fmt'); return `formatta(${A(0)})`; } if (t === 'Boolean') return `string(${A(0)} ? "true" : "false")`; return `to_string(${A(0)})`; }
      case 'eof': return 'fileLettura.peek() == EOF';
    }
    return null;
  },
  declare: (n, t, arr, D) => {
    if (!arr) return T_CPP[t] ? `${T_CPP[t]} ${n};` : `${tCpp(t)} ${n} = nullptr;`;
    const c = cppParts(t, arr, D);
    return `${c.ty} ${n}(${c.args});`;
  },
  constDecl: (n, t, e) => `const ${tCpp(t)} ${n} = ${e};`,
  declareInit: (n, t, e) => `${tCpp(t)} ${n} = ${e};`,
  nul: 'nullptr', self: 'this', arrow: '->', staticSep: (c, m) => `${c}::${m}`,
  superMethod: (m, a, par) => `${par ? par.name : 'Base'}::${m}(${a})`,
  input: (o, v, t) => { if (t === 'String') o.line(`getline(cin >> ws, ${v});`); else o.line(`cin >> ${v};`); },
  output: (e, nl) => `cout << ${e}${nl ? ' << endl' : ''}`,
  files(o, s, E, sc, lvInfo, used) {
    used.add('fstream');
    if (s.kind === 'open') o.line(s.mode === 'read' ? `fileLettura.open(${E(s.expression, sc)});` : `fileScrittura.open(${E(s.expression, sc)});`);
    if (s.kind === 'close') o.line(s.mode === 'read' ? 'fileLettura.close();' : 'fileScrittura.close();');
    if (s.kind === 'read') { const t = lvInfo(s.variable, sc).type; if (t === 'String') o.line(`getline(fileLettura, ${E(s.variable, sc)});`); else { o.line(`fileLettura >> ${E(s.variable, sc)};`); o.line('fileLettura >> ws;'); } }
    if (s.kind === 'write') { const x = strip(tryParse(s.expression)); const low = x && x.k === 'bin' && (REL.includes(x.op) || x.op === 'and' || x.op === 'or'); o.line(`fileScrittura << ${low ? `(${E(s.expression, sc)})` : E(s.expression, sc)} << endl;`); }
  },
  multiAssign(o, tg, call, f, sc, used) { used.add('tuple'); o.line(`tie(${tg.join(', ')}) = ${call};`); },
  program(prog, g) {
    const o = new g.Out();
    const retT = (f) => { const rl = _CM.rets(f); if (rl.length > 1) { g.used.add('tuple'); return `tuple<${rl.map((r) => tCpp(r.type)).join(', ')}>`; } return f.type === 'None' ? 'void' : tCpp(f.type); };
    const sig = (f) => `${retT(f)} ${f.name}(${f.params.map((p) => (p.array ? `${'vector<'.repeat(p.dims || 1)}${tCpp(p.type)}${'>'.repeat(p.dims || 1)}& ${p.name}` : `${tCpp(p.type)} ${p.name}`)).join(', ')})`;
    const fns = prog.functions.slice(1);
    const bodyOut = new g.Out();
    for (const f of fns) {
      const sc = g.buildScope(f);
      bodyOut.line(''); bodyOut.line(sig(f) + ' {'); bodyOut.in(); g.block(bodyOut, f.body, sc);
      const rl = _CM.rets(f);
      if (rl.length) { bodyOut.line(rl.length > 1 ? `return make_tuple(${rl.map((r) => r.name).join(', ')});` : `return ${rl[0].name};`); }
      bodyOut.out(); bodyOut.line('}');
    }
    const mainOut = new g.Out();
    mainOut.in(); g.block(mainOut, prog.functions[0].body, g.buildScope(prog.functions[0])); mainOut.out();
    const u = g.used;
    o.line('#include <iostream>'); o.line('#include <string>'); o.line('#include <vector>'); o.line('#include <cmath>');
    if (u.has('rand')) { o.line('#include <cstdlib>'); o.line('#include <ctime>'); }
    if (u.has('fmt') || u.has('fixed')) { o.line('#include <sstream>'); o.line('#include <iomanip>'); }
    if (u.has('fstream')) o.line('#include <fstream>');
    if (u.has('tuple')) o.line('#include <tuple>');
    o.line(''); o.line('using namespace std;'); o.line('');
    if (u.has('pi')) o.line('const double PI = 3.14159265358979323846;');
    if (u.has('fstream')) { o.line('ifstream fileLettura;'); o.line('ofstream fileScrittura;'); }
    if (u.has('fmt')) { o.line(''); o.line('string formatta(double x) {'); o.line('    ostringstream s;'); o.line('    s << setprecision(15) << x;'); o.line('    return s.str();'); o.line('}'); }
    if (u.has('fixed')) { o.line(''); o.line('string aDecimali(double x, int cifre) {'); o.line('    ostringstream s;'); o.line('    s << fixed << setprecision(cifre) << x;'); o.line('    return s.str();'); o.line('}'); }
    if (fns.length) { o.line(''); o.line('// Prototipi'); for (const f of fns) o.line(sig(f) + ';'); }
    o.line(''); o.line('int main() {');
    if (u.has('rand')) o.line('    srand(time(0));');
    o.line('    cout << boolalpha;');
    o.lines.push(...mainOut.lines);
    o.line('    return 0;'); o.line('}');
    o.lines.push(...bodyOut.lines);
    return o.text();
  },
  programOO(prog, g) {
    const main = _CM.mainClass(prog);
    const retT = (f) => { const rl = _CM.rets(f); if (rl.length > 1) { g.used.add('tuple'); return `tuple<${rl.map((r) => tCpp(r.type)).join(', ')}>`; } return f.type === 'None' ? 'void' : tCpp(f.type); };
    const params = (f) => f.params.map((p) => (p.array ? `${'vector<'.repeat(p.dims || 1)}${tCpp(p.type)}${'>'.repeat(p.dims || 1)}& ${p.name}` : `${tCpp(p.type)} ${p.name}`)).join(', ');
    const decls = new g.Out(), statics = [], defs = new g.Out();
    const ordered = OO.ordered(prog, false);
    for (const c of ordered) {
      const poly = !!c.parent || OO.hasChildren(prog, c);
      const sec = { public: [], protected: [], private: [] };
      const vis = (v) => sec[v || 'public'];
      for (const f of OO.ctors(prog, c)) vis(f.visibility).push(`${c.name}(${params(f)});`);
      for (const a of c.attributes) {
        const sc = OO.classScope(prog, c, a.static);
        const pt = cppParts(a.type, a.array, a.array ? _CE.splitTop(a.size).map((x) => g.E(x, sc)) : null);
        const init = a.array ? `${pt.ty}(${pt.args})` : (String(a.init || '').trim() ? g.E(a.init, sc) : (DEF_CPP[a.type] || 'nullptr'));
        if (a.static) { vis(a.visibility).push(`static ${pt.ty} ${a.name};`); statics.push(`${pt.ty} ${c.name}::${a.name} = ${init};`); }
        else vis(a.visibility).push(`${pt.ty} ${a.name} = ${init};`);
      }
      for (const f of OO.methods(prog, c)) {
        const nm = OO.isMain(prog, f) ? 'Main' : f.name;
        // metodo astratto: virtuale puro, senza definizione
        vis(f.visibility).push(`${f.static ? 'static ' : (poly || f.abstract ? 'virtual ' : '')}${retT(f)} ${nm}(${params(f)})${f.abstract ? ' = 0' : ''};`);
      }
      decls.line('');
      decls.line(`class ${c.name}${c.parent ? ' : public ' + c.parent : ''} {${c.abstract ? ' // classe astratta' : ''}`);
      for (const v of ['public', 'protected', 'private']) if (sec[v].length) { decls.line(v + ':'); decls.in(); sec[v].forEach((l) => decls.line(l)); decls.out(); }
      decls.line('};');
      // definizioni di costruttori e metodi
      for (const f of [...OO.ctors(prog, c), ...OO.methods(prog, c)]) {
        if (f.abstract) continue;
        const sc = g.buildScope(f);
        defs.line('');
        if (f.ctor) {
          const sp = OO.splitSuper(f);
          defs.line(`${c.name}::${c.name}(${params(f)})${sp.args ? ` : ${c.parent}(${sp.args.map((x) => g.pr(x, sc).s).join(', ')})` : ''} {`);
          defs.in(); g.block(defs, sp.rest, sc); defs.out(); defs.line('}');
          continue;
        }
        defs.line(`${retT(f)} ${c.name}::${OO.isMain(prog, f) ? 'Main' : f.name}(${params(f)}) {`);
        defs.in(); g.block(defs, f.body, sc);
        const rl = _CM.rets(f);
        if (rl.length) { defs.line(rl.length > 1 ? `return make_tuple(${rl.map((r) => r.name).join(', ')});` : `return ${rl[0].name};`); }
        defs.out(); defs.line('}');
      }
    }
    const o = new g.Out(); const u = g.used;
    o.line('#include <iostream>'); o.line('#include <string>'); o.line('#include <vector>'); o.line('#include <cmath>');
    if (u.has('rand')) { o.line('#include <cstdlib>'); o.line('#include <ctime>'); }
    if (u.has('fmt') || u.has('fixed')) { o.line('#include <sstream>'); o.line('#include <iomanip>'); }
    if (u.has('fstream')) o.line('#include <fstream>');
    if (u.has('tuple')) o.line('#include <tuple>');
    o.line(''); o.line('using namespace std;'); o.line('');
    if (u.has('pi')) o.line('const double PI = 3.14159265358979323846;');
    if (u.has('fstream')) { o.line('ifstream fileLettura;'); o.line('ofstream fileScrittura;'); }
    if (u.has('fmt')) { o.line(''); o.line('string formatta(double x) {'); o.line('    ostringstream s;'); o.line('    s << setprecision(15) << x;'); o.line('    return s.str();'); o.line('}'); }
    if (u.has('fixed')) { o.line(''); o.line('string aDecimali(double x, int cifre) {'); o.line('    ostringstream s;'); o.line('    s << fixed << setprecision(cifre) << x;'); o.line('    return s.str();'); o.line('}'); }
    o.line(''); o.line('// Classi (gli oggetti si creano con new e si usano tramite puntatori)');
    o.line(ordered.map((c) => `class ${c.name};`).join(' '));
    o.lines.push(...decls.lines);
    if (statics.length) { o.line(''); o.line('// Attributi statici'); statics.forEach((l) => o.line(l)); }
    o.line(''); o.line('int main() {');
    if (u.has('rand')) o.line('    srand(time(0));');
    o.line('    cout << boolalpha;');
    o.line(`    ${main.name}::Main();`);
    o.line('    return 0;'); o.line('}');
    o.lines.push(...defs.lines);
    return o.text();
  },
});

const T_JAVA = { Integer: 'int', Real: 'double', String: 'String', Boolean: 'boolean', None: 'void' };
const tJava = (t) => T_JAVA[t] || t;
let J_PFX = ''; // dalle altre classi lo Scanner e i file stanno nella classe principale
const DEF_C = { Integer: '0', Real: '0.0', String: '""', Boolean: 'false' };
LANGS.java = cFamily({
  label: 'Java', ext: 'java', intDiv: true, powFn: 'Math.pow', intCast: '(int) ', concatPrefix: '""',
  keywords: ['public', 'static', 'void', 'class', 'int', 'double', 'String', 'boolean', 'return', 'if', 'else', 'while', 'for', 'do', 'true', 'false', 'new', 'import', 'Scanner', 'System', 'Math', 'private', 'protected', 'extends', 'this', 'super', 'null', 'final', 'record', 'throws', 'abstract'],
  pi: 'Math.PI',
  strLit: (s) => escStr(s, '"'),
  toStr: (x, t, e) => (e.p <= P.add ? `(${e.s})` : e.s),
  strCmp(op, l, r) {
    const ls = l.p < P.atom ? `(${l.s})` : l.s;
    if (op === '==') return { s: `${ls}.equals(${r.s})`, p: P.atom };
    if (op === '!=') return { s: `!${ls}.equals(${r.s})`, p: P.un };
    return { s: `${ls}.compareTo(${r.s}) ${op} 0`, p: P.rel };
  },
  builtin(low, a, n, sc) {
    const A = (i) => (a[i] ? a[i].s : ''); const At = (i) => (a[i] ? (a[i].p < P.atom ? `(${a[i].s})` : a[i].s) : '');
    const map = { abs: 'abs', arccos: 'acos', arcsin: 'asin', arctan: 'atan', cos: 'cos', sin: 'sin', tan: 'tan', cosh: 'cosh', sinh: 'sinh', tanh: 'tanh', ln: 'log', log: 'log', log10: 'log10', sqrt: 'sqrt' };
    if (map[low]) return `Math.${map[low]}(${A(0)})`;
    switch (low) {
      case 'arcsinh': return `Math.log(${At(0)} + Math.sqrt(${At(0)} * ${At(0)} + 1))`;
      case 'arccosh': return `Math.log(${At(0)} + Math.sqrt(${At(0)} * ${At(0)} - 1))`;
      case 'arctanh': return `0.5 * Math.log((1 + ${At(0)}) / (1 - ${At(0)}))`;
      case 'int': return { s: `(int) ${At(0)}`, p: P.un };
      case 'sgn': return { s: `(int) Math.signum(${A(0)})`, p: P.un };
      case 'random': return { s: `(int) (Math.random() * ${At(0)})`, p: P.un };
      case 'len': return `${At(0)}.length()`;
      case 'size': return `${At(0)}${'[0]'.repeat(sizeInfo(n, sc).d)}.length`;
      case 'char': return `String.valueOf(${At(0)}.charAt(${A(1)}))`;
      case 'tochar': return `String.valueOf((char) ${At(0)})`;
      case 'tocode': return { s: `(int) ${At(0)}.charAt(0)`, p: P.un };
      case 'tofixed': return `String.format(java.util.Locale.US, "%." + ${At(1)} + "f", ${A(0)})`;
      case 'tointeger': return `Integer.parseInt(${A(0)})`;
      case 'toreal': return `Double.parseDouble(${A(0)})`;
      case 'tostring': return `String.valueOf(${A(0)})`;
      case 'eof': return `!${J_PFX}fileLettura.hasNextLine()`;
    }
    return null;
  },
  declare: (n, t, arr, D) => (arr ? `${tJava(t)}${'[]'.repeat(D.length)} ${n} = new ${tJava(t)}${D.map((d) => `[${d}]`).join('')};` : `${tJava(t)} ${n} = ${DEF_C[t] || 'null'};`),
  constDecl: (n, t, e) => `final ${tJava(t)} ${n} = ${e};`,
  declareInit: (n, t, e) => `${tJava(t)} ${n} = ${e};`,
  input: (o, v, t) => { const i = J_PFX + 'input'; o.line(`${v} = ${t === 'Integer' ? `Integer.parseInt(${i}.nextLine().trim())` : t === 'Real' ? `Double.parseDouble(${i}.nextLine().trim())` : t === 'Boolean' ? `Boolean.parseBoolean(${i}.nextLine().trim())` : `${i}.nextLine()`};`); },
  nul: 'null', self: 'this',
  output: (e, nl) => `System.out.${nl ? 'println' : 'print'}(${e})`,
  files(o, s, E, sc, lvInfo, used) {
    used.add('files');
    const R = J_PFX + 'fileLettura', W = J_PFX + 'fileScrittura';
    if (s.kind === 'open') o.line(s.mode === 'read' ? `${R} = new Scanner(new java.io.File(${E(s.expression, sc)}));` : `${W} = new java.io.PrintWriter(${E(s.expression, sc)});`);
    if (s.kind === 'close') o.line(s.mode === 'read' ? `${R}.close();` : `${W}.close();`);
    if (s.kind === 'read') { const t = lvInfo(s.variable, sc).type; o.line(`${E(s.variable, sc)} = ${t === 'Integer' ? `Integer.parseInt(${R}.nextLine().trim())` : t === 'Real' ? `Double.parseDouble(${R}.nextLine().trim())` : t === 'Boolean' ? `Boolean.parseBoolean(${R}.nextLine().trim())` : `${R}.nextLine()`};`); }
    if (s.kind === 'write') o.line(`${W}.println(${E(s.expression, sc)});`);
  },
  multiAssign(o, tg, call, f, sc) {
    const rl = f ? _CM.rets(f) : [];
    const owner = f && sc.ooMode ? _CM.classOf(sc.prog, f) : null;
    const rec = (owner && owner !== sc.cls ? owner.name + '.' : '') + 'Risultato' + (f ? f.name[0].toUpperCase() + f.name.slice(1) : '');
    let k = 1; while (sc.vars.has('ris' + k) || (sc.tmpUsed && sc.tmpUsed.has('ris' + k))) k++;
    const tmp = 'ris' + k; (sc.tmpUsed = sc.tmpUsed || new Set()).add(tmp);
    o.line(`${rec} ${tmp} = ${call};`);
    tg.forEach((t, i) => o.line(`${t} = ${tmp}.${rl[i] ? rl[i].name : 'v' + i}();`));
  },
  program(prog, g) {
    const o = new g.Out();
    const inner = new g.Out(); inner.lvl = 1;
    const main = new g.Out(); main.lvl = 2;
    const recName = (f) => 'Risultato' + f.name[0].toUpperCase() + f.name.slice(1);
    const records = prog.functions.slice(1).filter((f) => _CM.rets(f).length > 1);
    g.block(main, prog.functions[0].body, g.buildScope(prog.functions[0]));
    for (const f of prog.functions.slice(1)) {
      const sc = g.buildScope(f);
      const rl = _CM.rets(f);
      inner.line('');
      inner.line(`public static ${rl.length > 1 ? recName(f) : tJava(f.type)} ${f.name}(${f.params.map((p) => `${tJava(p.type)}${p.array ? '[]'.repeat(p.dims || 1) : ''} ${p.name}`).join(', ')})${g.used.has('files') ? ' throws Exception' : ''} {`);
      inner.in(); g.block(inner, f.body, sc);
      if (rl.length) { inner.line(rl.length > 1 ? `return new ${recName(f)}(${rl.map((r) => r.name).join(', ')});` : `return ${rl[0].name};`); }
      inner.out(); inner.line('}');
    }
    if (records.length) o.line('// Richiede Java 16 o successivo: le funzioni con più valori restituiscono un record');
    o.line('import java.util.*;'); o.line('');
    o.line('public class Main {');
    o.line('    private static Scanner input = new Scanner(System.in);');
    for (const f of records) o.line(`    record ${recName(f)}(${_CM.rets(f).map((r) => `${tJava(r.type)} ${r.name}`).join(', ')}) {}`);
    if (g.used.has('files')) { o.line('    private static Scanner fileLettura;'); o.line('    private static java.io.PrintWriter fileScrittura;'); }
    o.line('');
    o.line(`    public static void main(String[] args)${g.used.has('files') ? ' throws Exception' : ''} {`);
    o.lines.push(...main.lines);
    o.line('    }');
    o.lines.push(...inner.lines);
    o.line('}');
    return o.text();
  },
  programOO(prog, g) {
    const main = _CM.mainClass(prog);
    const files = usesFiles(prog);
    const thr = files ? ' throws Exception' : '';
    const params = (f) => f.params.map((p) => `${tJava(p.type)}${p.array ? '[]'.repeat(p.dims || 1) : ''} ${p.name}`).join(', ');
    const recName = (f) => 'Risultato' + cap(f.name);
    const V = (v) => (v || 'public') + ' ';
    const parts = [];
    let records = false;
    for (const c of OO.ordered(prog, true)) {
      J_PFX = c === main ? '' : main.name + '.';
      const o = new g.Out(); o.lvl = 1;
      if (c === main) {
        o.line('static Scanner input = new Scanner(System.in);');
        if (files) { o.line('static Scanner fileLettura;'); o.line('static java.io.PrintWriter fileScrittura;'); }
      }
      for (const f of OO.methods(prog, c)) if (_CM.rets(f).length > 1) { records = true; o.line(`record ${recName(f)}(${_CM.rets(f).map((r) => `${tJava(r.type)} ${r.name}`).join(', ')}) {}`); }
      for (const a of c.attributes) {
        const sc = OO.classScope(prog, c, a.static);
        const D = a.array ? _CE.splitTop(a.size).map((x) => g.E(x, sc)) : null;
        const init = a.array ? ` = new ${tJava(a.type)}${D.map((d) => `[${d}]`).join('')}` : (String(a.init || '').trim() ? ' = ' + g.E(a.init, sc) : (a.type === 'String' ? ' = ""' : ''));
        o.line(`${V(a.visibility)}${a.static ? 'static ' : ''}${tJava(a.type)}${a.array ? '[]'.repeat(D.length) : ''} ${a.name}${init};`);
      }
      for (const f of [...OO.ctors(prog, c), ...OO.methods(prog, c)]) {
        const sc = g.buildScope(f);
        const rl = _CM.rets(f);
        if (o.lines.length) o.line('');
        if (f.abstract) { o.line(`${V(f.visibility)}abstract ${rl.length > 1 ? recName(f) : tJava(f.type)} ${f.name}(${params(f)});`); continue; }
        if (f.ctor) o.line(`${V(f.visibility)}${c.name}(${params(f)})${thr} {`);
        else if (OO.isMain(prog, f)) o.line(`public static void main(String[] args)${thr} {`);
        else o.line(`${V(f.visibility)}${f.static ? 'static ' : ''}${rl.length > 1 ? recName(f) : tJava(f.type)} ${f.name}(${params(f)})${thr} {`);
        o.in(); g.block(o, f.body, sc);
        if (rl.length) { o.line(rl.length > 1 ? `return new ${recName(f)}(${rl.map((r) => r.name).join(', ')});` : `return ${rl[0].name};`); }
        o.out(); o.line('}');
      }
      parts.push({ c, lines: o.lines });
    }
    J_PFX = '';
    const o = new g.Out();
    if (records) o.line('// Richiede Java 16 o successivo: i metodi con più valori restituiscono un record');
    o.line('import java.util.*;');
    for (const { c, lines } of parts) {
      o.line('');
      o.line(`${c === main ? 'public ' : ''}${c.abstract ? 'abstract ' : ''}class ${c.name}${c.parent ? ' extends ' + c.parent : ''} {`);
      o.lines.push(...lines);
      o.line('}');
    }
    return o.text();
  },
});

const tCs = (t) => T_CPP[t] || t;
let CS_PFX = '';
LANGS.csharp = cFamily({
  label: 'C#', ext: 'cs', intDiv: true, powFn: 'Math.Pow', intCast: '(int) ',
  keywords: ['using', 'class', 'static', 'void', 'int', 'double', 'string', 'bool', 'return', 'if', 'else', 'while', 'for', 'do', 'true', 'false', 'new', 'Console', 'Math', 'System', 'public', 'private', 'protected', 'this', 'base', 'null', 'virtual', 'override', 'const', 'abstract'],
  pi: 'Math.PI',
  strLit: (s) => escStr(s, '"'),
  concatPrefix: '""',
  toStr: (x, t, e) => (e.p <= P.add ? `(${e.s})` : e.s),
  strCmp(op, l, r) {
    if (op === '==' || op === '!=') return null;
    return { s: `string.Compare(${l.s}, ${r.s}, StringComparison.Ordinal) ${op} 0`, p: P.rel };
  },
  builtin(low, a, n, sc, used) {
    const A = (i) => (a[i] ? a[i].s : ''); const At = (i) => (a[i] ? (a[i].p < P.atom ? `(${a[i].s})` : a[i].s) : '');
    const map = { abs: 'Abs', arccos: 'Acos', arcsin: 'Asin', arctan: 'Atan', cos: 'Cos', sin: 'Sin', tan: 'Tan', cosh: 'Cosh', sinh: 'Sinh', tanh: 'Tanh', arccosh: 'Acosh', arcsinh: 'Asinh', arctanh: 'Atanh', ln: 'Log', log: 'Log', log10: 'Log10', sqrt: 'Sqrt', sgn: 'Sign' };
    if (map[low]) return `Math.${map[low]}(${A(0)})`;
    switch (low) {
      case 'int': return { s: `(int) ${At(0)}`, p: P.un };
      case 'random': used.add('rnd'); return `${CS_PFX}rnd.Next(${A(0)})`;
      case 'len': return `${At(0)}.Length`;
      case 'size': { const z = sizeInfo(n, sc); return z.nd > 1 ? `${At(0)}.GetLength(${z.d})` : `${At(0)}.Length`; }
      case 'char': return `${At(0)}[${A(1)}].ToString()`;
      case 'tochar': return `((char) ${At(0)}).ToString()`;
      case 'tocode': return { s: `(int) ${At(0)}[0]`, p: P.un };
      case 'tofixed': return `${At(0)}.ToString("F" + ${At(1)}, System.Globalization.CultureInfo.InvariantCulture)`;
      case 'tointeger': return `int.Parse(${A(0)})`;
      case 'toreal': return `double.Parse(${A(0)}, System.Globalization.CultureInfo.InvariantCulture)`;
      case 'tostring': return `Convert.ToString(${A(0)})`;
      case 'eof': return `${CS_PFX}fileLettura.EndOfStream`;
    }
    return null;
  },
  idx: idxComma,
  declare: (n, t, arr, D) => (arr ? `${tCs(t)}[${','.repeat(D.length - 1)}] ${n} = new ${tCs(t)}[${D.join(', ')}];` : `${tCs(t)} ${n} = ${DEF_C[t] || 'null'};`),
  // in C# const vuole un valore noto in compilazione; altrimenti una variabile normale
  constDecl: (n, t, e, lit) => (lit ? `const ${tCs(t)} ${n} = ${e};` : `${tCs(t)} ${n} = ${e}; // costante`),
  declareInit: (n, t, e) => `${tCs(t)} ${n} = ${e};`,
  nul: 'null', self: 'this', superMethod: (m, a) => `base.${m}(${a})`,
  input: (o, v, t) => o.line(`${v} = ${t === 'Integer' ? 'int.Parse(Console.ReadLine())' : t === 'Real' ? 'double.Parse(Console.ReadLine())' : t === 'Boolean' ? 'bool.Parse(Console.ReadLine())' : 'Console.ReadLine()'};`),
  output: (e, nl) => `Console.${nl ? 'WriteLine' : 'Write'}(${e})`,
  multiAssign(o, tg, call) { o.line(`(${tg.join(', ')}) = ${call};`); },
  files(o, s, E, sc, lvInfo, used) {
    used.add('files');
    const R = CS_PFX + 'fileLettura', W = CS_PFX + 'fileScrittura';
    if (s.kind === 'open') o.line(s.mode === 'read' ? `${R} = new System.IO.StreamReader(${E(s.expression, sc)});` : `${W} = new System.IO.StreamWriter(${E(s.expression, sc)});`);
    if (s.kind === 'close') o.line(s.mode === 'read' ? `${R}.Close();` : `${W}.Close();`);
    if (s.kind === 'read') { const t = lvInfo(s.variable, sc).type; o.line(`${E(s.variable, sc)} = ${t === 'Integer' ? `int.Parse(${R}.ReadLine())` : t === 'Real' ? `double.Parse(${R}.ReadLine())` : t === 'Boolean' ? `bool.Parse(${R}.ReadLine())` : `${R}.ReadLine()`};`); }
    if (s.kind === 'write') o.line(`${W}.WriteLine(${E(s.expression, sc)});`);
  },
  program(prog, g) {
    const o = new g.Out();
    const inner = new g.Out(); inner.lvl = 1;
    const main = new g.Out(); main.lvl = 2;
    g.block(main, prog.functions[0].body, g.buildScope(prog.functions[0]));
    for (const f of prog.functions.slice(1)) {
      const sc = g.buildScope(f);
      inner.line('');
      const rl = _CM.rets(f);
      const rt = rl.length > 1 ? `(${rl.map((r) => tCs(r.type)).join(', ')})` : tCs(f.type);
      inner.line(`static ${rt} ${f.name}(${f.params.map((p) => `${tCs(p.type)}${p.array ? `[${','.repeat((p.dims || 1) - 1)}]` : ''} ${p.name}`).join(', ')}) {`);
      inner.in(); g.block(inner, f.body, sc);
      if (rl.length) { inner.line(rl.length > 1 ? `return (${rl.map((r) => r.name).join(', ')});` : `return ${rl[0].name};`); }
      inner.out(); inner.line('}');
    }
    o.line('using System;'); o.line('');
    o.line('class Program {');
    if (g.used.has('rnd')) o.line('    static Random rnd = new Random();');
    if (g.used.has('files')) { o.line('    static System.IO.StreamReader fileLettura;'); o.line('    static System.IO.StreamWriter fileScrittura;'); }
    o.line('    static void Main() {');
    o.lines.push(...main.lines);
    o.line('    }');
    o.lines.push(...inner.lines);
    o.line('}');
    return o.text();
  },
  programOO(prog, g) {
    const main = _CM.mainClass(prog);
    const params = (f) => f.params.map((p) => `${tCs(p.type)}${p.array ? `[${','.repeat((p.dims || 1) - 1)}]` : ''} ${p.name}`).join(', ');
    const V = (v) => (v || 'public') + ' ';
    const parts = [];
    for (const c of OO.ordered(prog, true)) {
      CS_PFX = c === main ? '' : main.name + '.';
      const o = new g.Out(); o.lvl = 1;
      for (const a of c.attributes) {
        const sc = OO.classScope(prog, c, a.static);
        const D = a.array ? _CE.splitTop(a.size).map((x) => g.E(x, sc)) : null;
        const init = a.array ? ` = new ${tCs(a.type)}[${D.join(', ')}]` : (String(a.init || '').trim() ? ' = ' + g.E(a.init, sc) : (a.type === 'String' ? ' = ""' : ''));
        o.line(`${V(a.visibility)}${a.static ? 'static ' : ''}${tCs(a.type)}${a.array ? `[${','.repeat(D.length - 1)}]` : ''} ${a.name}${init};`);
      }
      for (const f of [...OO.ctors(prog, c), ...OO.methods(prog, c)]) {
        const sc = g.buildScope(f);
        const rl = _CM.rets(f);
        if (o.lines.length) o.line('');
        let body = f.body;
        if (f.abstract) { o.line(`${V(f.visibility)}abstract ${rl.length > 1 ? `(${rl.map((r) => tCs(r.type)).join(', ')})` : tCs(f.type)} ${f.name}(${params(f)});`); continue; }
        if (f.ctor) {
          const sp = OO.splitSuper(f); body = sp.rest;
          o.line(`${V(f.visibility)}${c.name}(${params(f)})${sp.args ? ` : base(${sp.args.map((x) => g.pr(x, sc).s).join(', ')})` : ''} {`);
        } else if (OO.isMain(prog, f)) o.line('public static void Main() {');
        else {
          // polimorfismo: virtual nella classe madre, override nelle sottoclassi
          const vo = f.static ? 'static ' : OO.overrides(prog, f) ? 'override ' : OO.overridden(prog, f) ? 'virtual ' : '';
          const rt = rl.length > 1 ? `(${rl.map((r) => tCs(r.type)).join(', ')})` : tCs(f.type);
          o.line(`${V(f.visibility)}${vo}${rt} ${f.name}(${params(f)}) {`);
        }
        o.in(); g.block(o, body, sc);
        if (rl.length) { o.line(rl.length > 1 ? `return (${rl.map((r) => r.name).join(', ')});` : `return ${rl[0].name};`); }
        o.out(); o.line('}');
      }
      parts.push({ c, lines: o.lines });
    }
    CS_PFX = '';
    const o = new g.Out();
    o.line('using System;');
    for (const { c, lines } of parts) {
      o.line('');
      o.line(`${c.abstract ? 'abstract ' : ''}class ${c.name}${c.parent ? ' : ' + c.parent : ''} {`);
      if (c === main) {
        if (g.used.has('rnd')) o.line('    public static Random rnd = new Random();');
        if (g.used.has('files')) { o.line('    public static System.IO.StreamReader fileLettura;'); o.line('    public static System.IO.StreamWriter fileScrittura;'); }
        if ((g.used.has('rnd') || g.used.has('files')) && lines.length) o.line('');
      }
      o.lines.push(...lines);
      o.line('}');
    }
    return o.text();
  },
});

LANGS.javascript = cFamily({
  label: 'JavaScript', ext: 'js',
  keywords: ['let', 'const', 'function', 'return', 'if', 'else', 'while', 'for', 'do', 'true', 'false', 'new', 'Math', 'console', 'prompt', 'parseInt', 'parseFloat', 'String', 'Array', 'class', 'extends', 'constructor', 'static', 'this', 'super', 'null', 'throw', 'args', 'typeof', 'instanceof'],
  pi: 'Math.PI', eq: '===', neq: '!==', concatPrefix: '""',
  strLit: (s) => escStr(s, '"'),
  toStr: (x, t, e) => (e.p <= P.add ? `(${e.s})` : e.s),
  builtin(low, a, n, sc) {
    const A = (i) => (a[i] ? a[i].s : ''); const At = (i) => (a[i] ? (a[i].p < P.atom ? `(${a[i].s})` : a[i].s) : '');
    const map = { abs: 'abs', arccos: 'acos', arcsin: 'asin', arctan: 'atan', cos: 'cos', sin: 'sin', tan: 'tan', cosh: 'cosh', sinh: 'sinh', tanh: 'tanh', arccosh: 'acosh', arcsinh: 'asinh', arctanh: 'atanh', ln: 'log', log: 'log', log10: 'log10', sqrt: 'sqrt', sgn: 'sign', int: 'trunc' };
    if (map[low]) return `Math.${map[low]}(${A(0)})`;
    switch (low) {
      case 'random': return `Math.floor(Math.random() * ${At(0)})`;
      case 'len': return `${At(0)}.length`;
      case 'size': return `${At(0)}${'[0]'.repeat(sizeInfo(n, sc).d)}.length`;
      case 'char': return `${At(0)}.charAt(${A(1)})`;
      case 'tochar': return `String.fromCharCode(${A(0)})`;
      case 'tocode': return `${At(0)}.charCodeAt(0)`;
      case 'tofixed': return `${At(0)}.toFixed(${A(1)})`;
      case 'tointeger': return `parseInt(${A(0)})`;
      case 'toreal': return `parseFloat(${A(0)})`;
      case 'tostring': return `String(${A(0)})`;
    }
    return null;
  },
  declare: (n, t, arr, D, used) => { if (!arr) return `let ${n};`; if (D.length === 1) return `let ${n} = new Array(${D[0]});`; used.add('creaArray'); return `let ${n} = creaArray([${D.join(', ')}]);`; },
  constDecl: (n, t, e) => `const ${n} = ${e};`,
  declareInit: (n, t, e) => `let ${n} = ${e};`,
  nul: 'null', self: 'this', qualifyCalls: true,
  field: (h) => (h.attr.static ? `${h.owner.name}.${h.attr.name}` : `this.${h.attr.name}`),
  input: (o, v, t) => o.line(`${v} = ${t === 'Integer' ? 'parseInt(prompt())' : t === 'Real' ? 'parseFloat(prompt())' : t === 'Boolean' ? 'prompt() === "true"' : 'prompt()'};`),
  output: (e, nl) => `output(${e}, ${nl})`,
  multiAssign(o, tg, call) { o.line(`[${tg.join(', ')}] = ${call};`); },
  program(prog, g) {
    const o = new g.Out();
    o.line('// Funziona in un browser: input con prompt(), output nella console');
    o.line('let rigaCorrente = "";');
    o.line('function output(valore, aCapo) {');
    o.line('    rigaCorrente += String(valore);');
    o.line('    if (aCapo) { console.log(rigaCorrente); rigaCorrente = ""; }');
    o.line('}');
    for (const f of prog.functions.slice(1)) {
      const sc = g.buildScope(f);
      o.line('');
      o.line(`function ${f.name}(${f.params.map((p) => p.name).join(', ')}) {`);
      o.in(); g.block(o, f.body, sc);
      const rl = _CM.rets(f);
      if (rl.length) { o.line(rl.length > 1 ? `return [${rl.map((r) => r.name).join(', ')}];` : `return ${rl[0].name};`); }
      o.out(); o.line('}');
    }
    o.line(''); o.line('// Main');
    g.block(o, prog.functions[0].body, g.buildScope(prog.functions[0]));
    o.line('if (rigaCorrente) console.log(rigaCorrente);');
    if (g.used.has('creaArray')) {
      o.line('');
      o.line('// array a più dimensioni: creaArray([3, 4]) crea una matrice 3 × 4');
      o.line('function creaArray(dimensioni) {');
      o.line('    if (dimensioni.length === 1) return new Array(dimensioni[0]);');
      o.line('    return Array.from({ length: dimensioni[0] }, () => creaArray(dimensioni.slice(1)));');
      o.line('}');
    }
    return o.text();
  },
  programOO(prog, g) {
    const main = _CM.mainClass(prog);
    const DEF_JS = { Integer: '0', Real: '0', String: '""', Boolean: 'false' };
    const o = new g.Out();
    o.line('// Funziona in un browser: input con prompt(), output nella console');
    o.line('let rigaCorrente = "";');
    o.line('function output(valore, aCapo) {');
    o.line('    rigaCorrente += String(valore);');
    o.line('    if (aCapo) { console.log(rigaCorrente); rigaCorrente = ""; }');
    o.line('}');
    const test = {
      len: (n) => `args.length === ${n}`,
      type: (p, i) => { const a = `args[${i}]`; if (p.array) return `Array.isArray(${a})`; return { Integer: `Number.isInteger(${a})`, Real: `typeof ${a} === "number"`, String: `typeof ${a} === "string"`, Boolean: `typeof ${a} === "boolean"` }[p.type] || `${a} instanceof ${p.type}`; },
    };
    let multiDim = false;
    for (const c of OO.ordered(prog, false)) {
      o.line('');
      o.line(`class ${c.name}${c.parent ? ' extends ' + c.parent : ''} {${c.abstract ? ' // classe astratta: non si creano oggetti' : ''}`); o.in();
      const start = o.lines.length;
      for (const a of c.attributes) {
        const sc = OO.classScope(prog, c, a.static);
        let init;
        if (a.array) { const D = _CE.splitTop(a.size).map((x) => g.E(x, sc)); if (D.length > 1) multiDim = true; init = D.length > 1 ? `creaArray([${D.join(', ')}], ${DEF_JS[a.type] || 'null'})` : `new Array(${D[0]}).fill(${DEF_JS[a.type] || 'null'})`; }
        else init = String(a.init || '').trim() ? g.E(a.init, sc) : (DEF_JS[a.type] || 'null');
        o.line(`${a.static ? 'static ' : ''}${a.name} = ${init};${a.visibility !== 'public' ? ' // ' + OO.tag(a.visibility) : ''}`);
      }
      // corpo di un costruttore: in una sottoclasse super(...) va chiamato prima di usare this
      const ctorBody = (f) => { const sc = g.buildScope(f); const sp = OO.splitSuper(f); if (c.parent && !sp.args) o.line('super();'); g.block(o, f.body, sc); };
      const methodBody = (f) => { if (f.abstract) { o.line(`throw new Error("${f.name}() è astratto: lo definiscono le sottoclassi");`); return; } g.block(o, f.body, g.buildScope(f)); const rl = _CM.rets(f); if (rl.length) o.line(rl.length > 1 ? `return [${rl.map((r) => r.name).join(', ')}];` : `return ${rl[0].name};`); };
      const emit = (group, isCtor) => {
        if (o.lines.length > start) o.line('');
        const f0 = group[0];
        const head = isCtor ? 'constructor' : `${f0.static ? 'static ' : ''}${OO.isMain(prog, f0) ? 'main' : f0.name}`;
        const note = ((f0.visibility || 'public') !== 'public' ? ' // ' + OO.tag(f0.visibility) : '') + (group.length === 1 && f0.abstract ? ' // astratto' : '');
        if (group.length === 1) { o.line(`${head}(${f0.params.map((p) => p.name).join(', ')}) {${note}`); o.in(); (isCtor ? ctorBody : methodBody)(f0); o.out(); o.line('}'); return; }
        o.line(`${head}(...args) { // ${group.length} versioni${note}`); o.in();
        group.forEach((f, k) => {
          o.line(`${k ? '} else if' : 'if'} (${dispatchCond(f, group, ' && ', test)}) {`); o.in();
          if (f.params.length) o.line(`let [${f.params.map((p) => p.name).join(', ')}] = args;`);
          (isCtor ? ctorBody : methodBody)(f); o.out();
        });
        o.line('} else {'); o.in(); o.line(`throw new Error("${isCtor ? c.name : f0.name}: nessuna versione accetta questi argomenti");`); o.out(); o.line('}');
        o.out(); o.line('}');
      };
      const ctors = OO.ctors(prog, c);
      if (ctors.length) emit(ctors, true);
      for (const gr of OO.groups(OO.methods(prog, c))) emit(gr, false);
      o.out(); o.line('}');
    }
    o.line(''); o.line('// Main');
    o.line(`${main.name}.main();`);
    o.line('if (rigaCorrente) console.log(rigaCorrente);');
    if (g.used.has('creaArray') || multiDim) {
      o.line('');
      o.line('// array a più dimensioni: creaArray([3, 4]) crea una matrice 3 × 4');
      o.line('function creaArray(dimensioni, valore) {');
      o.line('    if (dimensioni.length === 1) return new Array(dimensioni[0]).fill(valore);');
      o.line('    return Array.from({ length: dimensioni[0] }, () => creaArray(dimensioni.slice(1), valore));');
      o.line('}');
    }
    return o.text();
  },
});

// Le dichiarazioni del ciclo "per" in C++/Java/C#/JS usano variabili già dichiarate.
const CodeGen = {
  LANGS,
  generate(prog, lang) {
    try { return LANGS[lang].generate(prog); } catch (e) { return `// Impossibile generare il codice: ${e.message}\n`; }
  },
};
if (typeof module !== 'undefined') module.exports = CodeGen;
