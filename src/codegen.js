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
  for (const p of func.params) vars.set(p.name, { type: p.type, array: p.array });
  _CM.walk(func.body, (s) => {
    if (s.kind === 'declare') for (const n of s.name.split(',').map((x) => x.trim()).filter(Boolean)) vars.set(n, { type: s.type, array: s.array });
  });
  const funcs = new Map();
  for (const f of prog.functions) funcs.set(f.name, { type: f.type });
  return { vars, funcs, func };
}

function tryParse(src) { try { return _CE.parseExpr(src); } catch (e) { return null; } }
const strip = (n) => (n && n.k === 'par' ? strip(n.e) : n);

/* --------------------------- Linguaggi ----------------------------------- */
const LANGS = {};

function escStr(s, q) { return q + s.replace(/\\/g, '\\\\').replace(new RegExp(q, 'g'), '\\' + q) + q; }

/* Stampa generica di espressioni, con regole per linguaggio */
function exprPrinter(L) {
  function pr(n, sc) {
    switch (n.k) {
      case 'par': return pr(n.e, sc);
      case 'num': return { s: n.t === 'Real' ? (n.text && /[.eE]/.test(n.text) ? n.text : String(n.v) + '.0') : String(n.v), p: P.atom };
      case 'str': return { s: L.str(n.v), p: P.atom };
      case 'bool': return { s: n.v ? L.T : L.F, p: P.atom };
      case 'pi': L.use && L.use('pi'); return { s: L.pi, p: P.atom };
      case 'var': return { s: n.index ? `${n.name}[${pr(n.index, sc).s}]` : n.name, p: P.atom };
      case 'un':
        if (n.op === 'neg') { const e = pr(n.e, sc); return { s: '-' + (e.p < P.un ? `(${e.s})` : e.s), p: P.un }; }
        { const np = L.notPrec; const e = pr(n.e, sc); return { s: L.not + (e.p < np || (np === P.un && e.p === P.un && e.s[0] === '-') ? `(${e.s})` : e.s), p: np }; }
      case 'call': return L.call(n, sc, pr);
      case 'bin': return bin(n, sc);
    }
    return { s: '?', p: P.atom };
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
  keywords: ['ALGORITMO', 'FINE', 'FUNZIONE', 'PROCEDURA', 'VARIABILI', 'SE', 'ALLORA', 'ALTRIMENTI', 'MENTRE', 'ESEGUI', 'PER', 'DA', 'A', 'PASSO', 'RIPETI', 'LEGGI', 'SCRIVI', 'CHIAMA', 'RESTITUISCI', 'AND', 'OR', 'NOT', 'MOD', 'VERO', 'FALSO', 'DICHIARA', 'ARRAY', 'DI', 'INDIETRO', 'APRI', 'CHIUDI', 'IN', 'LETTURA', 'SCRITTURA'],
  generate(prog) {
    const L = {
      str: (s) => '"' + s + '"', T: 'VERO', F: 'FALSO', pi: 'π', not: 'NOT ', notPrec: P.un, or: 'OR', and: 'AND', mod: 'MOD', pow: '^',
      rel: { '==': '=', '!=': '≠', '<': '<', '<=': '≤', '>': '>', '>=': '≥' },
      call: (n, sc, pr) => ({ s: `${_CE.BUILTIN_NAMES[n.name.toLowerCase()] && !sc.funcs.has(n.name) ? _CE.BUILTIN_NAMES[n.name.toLowerCase()] : n.name}(${n.args.map((a) => pr(a, sc).s).join(', ')})`, p: P.atom }),
      bin: (n, sc, pr, generic) => (n.op === '&' ? generic(n, sc, '&', P.add - 0.5, 'left') : null),
    };
    const pr = exprPrinter(L);
    const o = new Out('   ');
    const E = (src, sc) => { const t = tryParse(src); return t ? pr(t, sc).s : src; };
    const block = (stmts, sc) => {
      for (const s of stmts) {
        switch (s.kind) {
          case 'declare': o.line(`DICHIARA ${s.array ? `ARRAY ${s.name.split(',').map((x) => x.trim() + '[' + E(s.size, sc) + ']').join(', ')} DI ${TIPO[s.type]}` : `${s.name} : ${TIPO[s.type]}`}`); break;
          case 'assign': o.line(`${E(s.variable, sc)} ← ${E(s.expression, sc)}`); break;
          case 'input': o.line(`LEGGI ${s.variable}`); break;
          case 'output': o.line(`SCRIVI ${E(s.expression, sc)}${s.newline ? '' : '   // senza a capo'}`); break;
          case 'if':
            o.line(`SE ${E(s.expression, sc)} ALLORA`); o.in(); block(s.then, sc); o.out();
            if (s.else.length) { o.line('ALTRIMENTI'); o.in(); block(s.else, sc); o.out(); }
            o.line('FINE SE'); break;
          case 'while': o.line(`MENTRE ${E(s.expression, sc)} ESEGUI`); o.in(); block(s.body, sc); o.out(); o.line('FINE MENTRE'); break;
          case 'do': o.line('RIPETI'); o.in(); block(s.body, sc); o.out(); o.line(`MENTRE ${E(s.expression, sc)}`); break;
          case 'for': {
            const st = String(s.step).trim();
            o.line(`PER ${s.variable} DA ${E(s.start, sc)} A ${E(s.end, sc)}${s.direction === 'dec' ? ' INDIETRO' : ''}${st && st !== '1' ? ' PASSO ' + E(st, sc) : ''} ESEGUI`);
            o.in(); block(s.body, sc); o.out(); o.line('FINE PER'); break;
          }
          case 'call': o.line(`CHIAMA ${/\(/.test(s.expression) ? E(s.expression, sc) : s.expression + '()'}`); break;
          case 'comment': for (const l of String(s.text).split('\n')) o.line('// ' + l); break;
          case 'breakpoint': o.line(`// punto di interruzione${s.always ? '' : ' se ' + s.expression}`); break;
          case 'open': o.line(`APRI ${E(s.expression, sc)} IN ${s.mode === 'read' ? 'LETTURA' : 'SCRITTURA'}`); break;
          case 'close': o.line(`CHIUDI FILE IN ${s.mode === 'read' ? 'LETTURA' : 'SCRITTURA'}`); break;
          case 'read': o.line(`LEGGI ${s.variable} DAL FILE`); break;
          case 'write': o.line(`SCRIVI ${E(s.expression, sc)} NEL FILE`); break;
        }
      }
    };
    prog.functions.forEach((f, i) => {
      const sc = buildScope(prog, f);
      if (i > 0) o.line('');
      if (i === 0) o.line(`ALGORITMO ${prog.attrs.name ? prog.attrs.name.replace(/\s+/g, '_') : 'Main'}`);
      else {
        const ps = f.params.map((p) => `${p.name} : ${p.array ? 'array di ' : ''}${TIPO[p.type]}`).join(', ');
        o.line(f.type === 'None' ? `PROCEDURA ${f.name}(${ps})` : `FUNZIONE ${f.name}(${ps}) : ${TIPO[f.type]}`);
      }
      o.in(); block(f.body, sc);
      if (i > 0 && f.type !== 'None') o.line(`RESTITUISCI ${f.variable}`);
      o.out();
      o.line(i === 0 ? 'FINE' : (f.type === 'None' ? 'FINE PROCEDURA' : 'FINE FUNZIONE'));
    });
    return o.text();
  },
};

/* =============================== PYTHON ================================== */
LANGS.python = {
  label: 'Python', ext: 'py', comment: '#',
  keywords: ['def', 'return', 'if', 'elif', 'else', 'while', 'for', 'in', 'range', 'and', 'or', 'not', 'True', 'False', 'import', 'break', 'print', 'input', 'int', 'float', 'str', 'len', 'None', 'pass', 'global', 'open', 'with', 'as'],
  generate(prog) {
    const used = new Set();
    const L = {
      str: (s) => escStr(s, '"'), T: 'True', F: 'False', pi: 'math.pi', use: (x) => used.add(x === 'pi' ? 'math' : x), not: 'not ', notPrec: P.notLow, or: 'or', and: 'and', pow: '**',
      rel: { '==': '==', '!=': '!=', '<': '<', '<=': '<=', '>': '>', '>=': '>=' },
      bin(n, sc, pr) {
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
        if (sc.funcs.has(n.name)) return { s: `${n.name}(${a.map((x) => x.s).join(', ')})`, p: P.atom };
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
          case 'len': case 'size': return { s: `len(${A(0)})`, p: P.atom };
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
    const CAST = { Integer: 'int(input())', Real: 'float(input())', String: 'input()', Boolean: 'input().strip().lower() == "true"' };
    const lvType = (v, sc) => { const t = tryParse(v); const x = t && strip(t); return x && sc.vars.get(x.name) ? sc.vars.get(x.name).type : 'String'; };
    const body = new Out();
    const block = (stmts, sc, o) => {
      const start = o.lines.length;
      for (const s of stmts) {
        switch (s.kind) {
          case 'declare':
            for (const nm of s.name.split(',').map((x) => x.trim()).filter(Boolean)) o.line(s.array ? `${nm} = [${DEF[s.type]}] * (${E(s.size, sc)})` : `${nm} = ${DEF[s.type]}`);
            break;
          case 'assign': o.line(`${E(s.variable, sc)} = ${E(s.expression, sc)}`); break;
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
              o.line(`${s.variable} = ${E(s.start, sc)}`);
              o.line(`while ${s.variable} ${s.direction === 'dec' ? '>=' : '<='} ${E(s.end, sc)}:`); o.in(); block(s.body, sc, o);
              o.line(`${s.variable} ${s.direction === 'dec' ? '-=' : '+='} ${E(step, sc)}`); o.out();
            } else {
              const endT = tryParse(s.end); const endP = endT ? pr(endT, sc) : { s: s.end, p: 0 };
              const endS = endP.p < P.add ? `(${endP.s})` : endP.s;
              const lim = s.direction === 'dec' ? `${endS} - 1` : `${endS} + 1`;
              const stepS = step === '1' ? '' : `, ${s.direction === 'dec' ? '-' : ''}${E(step, sc)}`;
              o.line(`for ${s.variable} in range(${E(s.start, sc)}, ${lim}${s.direction === 'dec' && step === '1' ? ', -1' : stepS}):`);
              o.in(); block(s.body, sc, o); o.out();
            }
            break;
          }
          case 'call': o.line(/\(/.test(s.expression) ? E(s.expression, sc) : s.expression + '()'); break;
          case 'comment': for (const l of String(s.text).split('\n')) o.line('# ' + l); break;
          case 'breakpoint': o.line(`# punto di interruzione${s.always ? '' : ': ' + s.expression}`); break;
          case 'open': used.add('files'); o.line(s.mode === 'read' ? `file_lettura = open(${E(s.expression, sc)}, "r")` : `file_scrittura = open(${E(s.expression, sc)}, "w")`); break;
          case 'close': used.add('files'); o.line(s.mode === 'read' ? 'file_lettura.close()' : 'file_scrittura.close()'); break;
          case 'read': {
            used.add('files'); const t = lvType(s.variable, sc);
            const raw = 'file_lettura.readline().rstrip("\\n")';
            o.line(`${s.variable} = ${t === 'Integer' ? `int(${raw})` : t === 'Real' ? `float(${raw})` : t === 'Boolean' ? `${raw}.lower() == "true"` : raw}`);
            break;
          }
          case 'write': used.add('files'); o.line(`file_scrittura.write(str(${E(s.expression, sc)}) + "\\n")`); break;
        }
      }
      if (o.lines.length === start) o.line('pass');
    };
    const funcs = new Out();
    prog.functions.slice(1).forEach((f) => {
      const sc = buildScope(prog, f);
      funcs.line(`def ${f.name}(${f.params.map((p) => p.name).join(', ')}):`);
      funcs.in();
      const before = funcs.lines.length;
      block(f.body, sc, funcs);
      if (f.type !== 'None' && f.variable) {
        if (funcs.lines.length === before + 1 && funcs.lines[funcs.lines.length - 1].trim() === 'pass') funcs.lines.pop();
        funcs.line(`return ${f.variable}`);
      }
      funcs.out(); funcs.line(''); funcs.line('');
    });
    const main = prog.functions[0];
    block(main.body, buildScope(prog, main), body);
    const head = [];
    if (prog.attrs.name) head.push(`# ${prog.attrs.name}`);
    if (used.has('math')) head.push('import math');
    if (used.has('random')) head.push('import random');
    if (head.length) head.push('');
    if (used.has('eof')) head.push('def fine_file():', '    pos = file_lettura.tell()', '    riga = file_lettura.readline()', '    file_lettura.seek(pos)', '    return riga == ""', '', '');
    let txt = head.join('\n') + (head.length ? '\n' : '') + (funcs.lines.length ? funcs.text() : '') + '# Main\n' + body.text();
    return txt;
  },
};

/* ======================== Famiglia C (C++, Java, C#, JS) ================= */
function cFamily(cfg) {
  return {
    label: cfg.label, ext: cfg.ext, comment: '//', keywords: cfg.keywords,
    generate(prog) {
      const used = new Set();
      const L = {
        str: (s) => cfg.strLit(s), T: 'true', F: 'false', pi: cfg.pi, use: () => used.add('pi'),
        not: '!', notPrec: P.un, or: '||', and: '&&', pow: '**',
        rel: { '==': cfg.eq || '==', '!=': cfg.neq || '!=', '<': '<', '<=': '<=', '>': '>', '>=': '>=' },
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
          if (sc.funcs.has(n.name)) return { s: `${n.name}(${a.map((x) => x.s).join(', ')})`, p: P.atom };
          const low = n.name.toLowerCase();
          const r = cfg.builtin(low, a, n, sc, used);
          if (r) return typeof r === 'string' ? { s: r, p: P.atom } : r;
          return { s: `${n.name}(${a.map((x) => x.s).join(', ')})`, p: P.atom };
        },
      };
      const pr = exprPrinter(L);
      const E = (src, sc) => { const t = tryParse(src); return t ? pr(t, sc).s : src; };
      const lvInfo = (v, sc) => { const t = tryParse(v); const x = t && strip(t); return (x && sc.vars.get(x.name)) || { type: 'String' }; };
      const blk = (o, stmts, sc) => { o.in(); block(o, stmts, sc); o.out(); };
      const unsupported = (o, what) => o.line(`// [${what}: non disponibile in ${cfg.label}]`);
      function block(o, stmts, sc) {
        for (const s of stmts) {
          switch (s.kind) {
            case 'declare':
              for (const nm of s.name.split(',').map((x) => x.trim()).filter(Boolean)) o.line(cfg.declare(nm, s.type, s.array, s.array ? E(s.size, sc) : null));
              break;
            case 'assign': o.line(`${E(s.variable, sc)} = ${E(s.expression, sc)};`); break;
            case 'input': cfg.input(o, E(s.variable, sc), lvInfo(s.variable, sc).type, used); break;
            case 'output': o.line(cfg.output(E(s.expression, sc), s.newline) + ';'); break;
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
              const v = s.variable, step = String(s.step).trim() || '1', dec = s.direction === 'dec';
              const inc = step === '1' ? (dec ? `${v}--` : `${v}++`) : `${v} ${dec ? '-=' : '+='} ${E(step, sc)}`;
              o.line(`for (${v} = ${E(s.start, sc)}; ${v} ${dec ? '>=' : '<='} ${E(s.end, sc)}; ${inc}) {`); blk(o, s.body, sc); o.line('}');
              break;
            }
            case 'call': o.line((/\(/.test(s.expression) ? E(s.expression, sc) : s.expression + '()') + ';'); break;
            case 'comment': for (const l of String(s.text).split('\n')) o.line('// ' + l); break;
            case 'breakpoint': o.line(`// punto di interruzione${s.always ? '' : ': ' + s.expression}`); break;
            case 'open': case 'close': case 'read': case 'write':
              if (cfg.files) cfg.files(o, s, E, sc, lvInfo, used); else unsupported(o, `file: ${s.kind} ${s.expression || s.variable || s.mode}`);
              break;
          }
        }
      }
      return cfg.program(prog, { block, E, buildScope: (f) => buildScope(prog, f), used, Out });
    },
  };
}

const T_CPP = { Integer: 'int', Real: 'double', String: 'string', Boolean: 'bool', None: 'void' };
LANGS.cpp = cFamily({
  label: 'C++', ext: 'cpp', intDiv: true, fmod: true, powFn: 'pow', intCast: '(int) ',
  keywords: ['int', 'double', 'string', 'bool', 'void', 'return', 'if', 'else', 'while', 'for', 'do', 'true', 'false', 'using', 'namespace', 'std', 'include', 'cout', 'cin', 'endl', 'vector', 'const', 'main'],
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
      case 'size': return `(int) ${At(0)}.size()`;
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
  declare: (n, t, arr, size) => (arr ? `vector<${T_CPP[t]}> ${n}(${size});` : `${T_CPP[t]} ${n};`),
  input: (o, v, t) => { if (t === 'String') o.line(`getline(cin >> ws, ${v});`); else o.line(`cin >> ${v};`); },
  output: (e, nl) => `cout << ${e}${nl ? ' << endl' : ''}`,
  files(o, s, E, sc, lvInfo, used) {
    used.add('fstream');
    if (s.kind === 'open') o.line(s.mode === 'read' ? `fileLettura.open(${E(s.expression, sc)});` : `fileScrittura.open(${E(s.expression, sc)});`);
    if (s.kind === 'close') o.line(s.mode === 'read' ? 'fileLettura.close();' : 'fileScrittura.close();');
    if (s.kind === 'read') { const t = lvInfo(s.variable, sc).type; if (t === 'String') o.line(`getline(fileLettura, ${s.variable});`); else { o.line(`fileLettura >> ${s.variable};`); o.line('fileLettura >> ws;'); } }
    if (s.kind === 'write') o.line(`fileScrittura << ${E(s.expression, sc)} << endl;`);
  },
  program(prog, g) {
    const o = new g.Out();
    const sig = (f) => `${T_CPP[f.type]} ${f.name}(${f.params.map((p) => (p.array ? `vector<${T_CPP[p.type]}>& ${p.name}` : `${T_CPP[p.type]} ${p.name}`)).join(', ')})`;
    const fns = prog.functions.slice(1);
    const bodyOut = new g.Out();
    for (const f of fns) {
      const sc = g.buildScope(f);
      bodyOut.line(''); bodyOut.line(sig(f) + ' {'); bodyOut.in(); g.block(bodyOut, f.body, sc);
      if (f.type !== 'None' && f.variable) { bodyOut.line(''); bodyOut.line(`return ${f.variable};`); }
      bodyOut.out(); bodyOut.line('}');
    }
    const mainOut = new g.Out();
    mainOut.in(); g.block(mainOut, prog.functions[0].body, g.buildScope(prog.functions[0])); mainOut.out();
    const u = g.used;
    o.line('#include <iostream>'); o.line('#include <string>'); o.line('#include <vector>'); o.line('#include <cmath>');
    if (u.has('rand')) { o.line('#include <cstdlib>'); o.line('#include <ctime>'); }
    if (u.has('fmt') || u.has('fixed')) { o.line('#include <sstream>'); o.line('#include <iomanip>'); }
    if (u.has('fstream')) o.line('#include <fstream>');
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
});

const T_JAVA = { Integer: 'int', Real: 'double', String: 'String', Boolean: 'boolean', None: 'void' };
const DEF_C = { Integer: '0', Real: '0.0', String: '""', Boolean: 'false' };
LANGS.java = cFamily({
  label: 'Java', ext: 'java', intDiv: true, powFn: 'Math.pow', intCast: '(int) ', concatPrefix: '""',
  keywords: ['public', 'static', 'void', 'class', 'int', 'double', 'String', 'boolean', 'return', 'if', 'else', 'while', 'for', 'do', 'true', 'false', 'new', 'import', 'Scanner', 'System', 'Math'],
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
      case 'size': return `${At(0)}.length`;
      case 'char': return `String.valueOf(${At(0)}.charAt(${A(1)}))`;
      case 'tochar': return `String.valueOf((char) ${At(0)})`;
      case 'tocode': return { s: `(int) ${At(0)}.charAt(0)`, p: P.un };
      case 'tofixed': return `String.format(java.util.Locale.US, "%." + ${At(1)} + "f", ${A(0)})`;
      case 'tointeger': return `Integer.parseInt(${A(0)})`;
      case 'toreal': return `Double.parseDouble(${A(0)})`;
      case 'tostring': return `String.valueOf(${A(0)})`;
      case 'eof': return '!fileLettura.hasNextLine()';
    }
    return null;
  },
  declare: (n, t, arr, size) => (arr ? `${T_JAVA[t]}[] ${n} = new ${T_JAVA[t]}[${size}];` : `${T_JAVA[t]} ${n} = ${DEF_C[t]};`),
  input: (o, v, t) => o.line(`${v} = ${t === 'Integer' ? 'Integer.parseInt(input.nextLine().trim())' : t === 'Real' ? 'Double.parseDouble(input.nextLine().trim())' : t === 'Boolean' ? 'Boolean.parseBoolean(input.nextLine().trim())' : 'input.nextLine()'};`),
  output: (e, nl) => `System.out.${nl ? 'println' : 'print'}(${e})`,
  files(o, s, E, sc, lvInfo, used) {
    used.add('files');
    if (s.kind === 'open') o.line(s.mode === 'read' ? `fileLettura = new Scanner(new java.io.File(${E(s.expression, sc)}));` : `fileScrittura = new java.io.PrintWriter(${E(s.expression, sc)});`);
    if (s.kind === 'close') o.line(s.mode === 'read' ? 'fileLettura.close();' : 'fileScrittura.close();');
    if (s.kind === 'read') { const t = lvInfo(s.variable, sc).type; o.line(`${s.variable} = ${t === 'Integer' ? 'Integer.parseInt(fileLettura.nextLine().trim())' : t === 'Real' ? 'Double.parseDouble(fileLettura.nextLine().trim())' : t === 'Boolean' ? 'Boolean.parseBoolean(fileLettura.nextLine().trim())' : 'fileLettura.nextLine()'};`); }
    if (s.kind === 'write') o.line(`fileScrittura.println(${E(s.expression, sc)});`);
  },
  program(prog, g) {
    const o = new g.Out();
    const inner = new g.Out(); inner.lvl = 1;
    const main = new g.Out(); main.lvl = 2;
    g.block(main, prog.functions[0].body, g.buildScope(prog.functions[0]));
    for (const f of prog.functions.slice(1)) {
      const sc = g.buildScope(f);
      inner.line('');
      inner.line(`public static ${T_JAVA[f.type]} ${f.name}(${f.params.map((p) => `${T_JAVA[p.type]}${p.array ? '[]' : ''} ${p.name}`).join(', ')})${g.used.has('files') ? ' throws Exception' : ''} {`);
      inner.in(); g.block(inner, f.body, sc);
      if (f.type !== 'None' && f.variable) { inner.line(''); inner.line(`return ${f.variable};`); }
      inner.out(); inner.line('}');
    }
    o.line('import java.util.*;'); o.line('');
    o.line('public class Main {');
    o.line('    private static Scanner input = new Scanner(System.in);');
    if (g.used.has('files')) { o.line('    private static Scanner fileLettura;'); o.line('    private static java.io.PrintWriter fileScrittura;'); }
    o.line('');
    o.line(`    public static void main(String[] args)${g.used.has('files') ? ' throws Exception' : ''} {`);
    o.lines.push(...main.lines);
    o.line('    }');
    o.lines.push(...inner.lines);
    o.line('}');
    return o.text();
  },
});

LANGS.csharp = cFamily({
  label: 'C#', ext: 'cs', intDiv: true, powFn: 'Math.Pow', intCast: '(int) ',
  keywords: ['using', 'class', 'static', 'void', 'int', 'double', 'string', 'bool', 'return', 'if', 'else', 'while', 'for', 'do', 'true', 'false', 'new', 'Console', 'Math', 'System', 'public'],
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
      case 'random': used.add('rnd'); return `rnd.Next(${A(0)})`;
      case 'len': case 'size': return `${At(0)}.Length`;
      case 'char': return `${At(0)}[${A(1)}].ToString()`;
      case 'tochar': return `((char) ${At(0)}).ToString()`;
      case 'tocode': return { s: `(int) ${At(0)}[0]`, p: P.un };
      case 'tofixed': return `${At(0)}.ToString("F" + ${At(1)}, System.Globalization.CultureInfo.InvariantCulture)`;
      case 'tointeger': return `int.Parse(${A(0)})`;
      case 'toreal': return `double.Parse(${A(0)}, System.Globalization.CultureInfo.InvariantCulture)`;
      case 'tostring': return `Convert.ToString(${A(0)})`;
      case 'eof': return 'fileLettura.EndOfStream';
    }
    return null;
  },
  declare: (n, t, arr, size) => (arr ? `${T_CPP[t]}[] ${n} = new ${T_CPP[t]}[${size}];` : `${T_CPP[t]} ${n} = ${DEF_C[t]};`),
  input: (o, v, t) => o.line(`${v} = ${t === 'Integer' ? 'int.Parse(Console.ReadLine())' : t === 'Real' ? 'double.Parse(Console.ReadLine())' : t === 'Boolean' ? 'bool.Parse(Console.ReadLine())' : 'Console.ReadLine()'};`),
  output: (e, nl) => `Console.${nl ? 'WriteLine' : 'Write'}(${e})`,
  files(o, s, E, sc, lvInfo, used) {
    used.add('files');
    if (s.kind === 'open') o.line(s.mode === 'read' ? `fileLettura = new System.IO.StreamReader(${E(s.expression, sc)});` : `fileScrittura = new System.IO.StreamWriter(${E(s.expression, sc)});`);
    if (s.kind === 'close') o.line(s.mode === 'read' ? 'fileLettura.Close();' : 'fileScrittura.Close();');
    if (s.kind === 'read') { const t = lvInfo(s.variable, sc).type; o.line(`${s.variable} = ${t === 'Integer' ? 'int.Parse(fileLettura.ReadLine())' : t === 'Real' ? 'double.Parse(fileLettura.ReadLine())' : t === 'Boolean' ? 'bool.Parse(fileLettura.ReadLine())' : 'fileLettura.ReadLine()'};`); }
    if (s.kind === 'write') o.line(`fileScrittura.WriteLine(${E(s.expression, sc)});`);
  },
  program(prog, g) {
    const o = new g.Out();
    const inner = new g.Out(); inner.lvl = 1;
    const main = new g.Out(); main.lvl = 2;
    g.block(main, prog.functions[0].body, g.buildScope(prog.functions[0]));
    for (const f of prog.functions.slice(1)) {
      const sc = g.buildScope(f);
      inner.line('');
      inner.line(`static ${T_CPP[f.type]} ${f.name}(${f.params.map((p) => `${T_CPP[p.type]}${p.array ? '[]' : ''} ${p.name}`).join(', ')}) {`);
      inner.in(); g.block(inner, f.body, sc);
      if (f.type !== 'None' && f.variable) { inner.line(''); inner.line(`return ${f.variable};`); }
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
});

LANGS.javascript = cFamily({
  label: 'JavaScript', ext: 'js',
  keywords: ['let', 'const', 'function', 'return', 'if', 'else', 'while', 'for', 'do', 'true', 'false', 'new', 'Math', 'console', 'prompt', 'parseInt', 'parseFloat', 'String', 'Array'],
  pi: 'Math.PI', eq: '===', neq: '!==', concatPrefix: '""',
  strLit: (s) => escStr(s, '"'),
  toStr: (x, t, e) => (e.p <= P.add ? `(${e.s})` : e.s),
  builtin(low, a) {
    const A = (i) => (a[i] ? a[i].s : ''); const At = (i) => (a[i] ? (a[i].p < P.atom ? `(${a[i].s})` : a[i].s) : '');
    const map = { abs: 'abs', arccos: 'acos', arcsin: 'asin', arctan: 'atan', cos: 'cos', sin: 'sin', tan: 'tan', cosh: 'cosh', sinh: 'sinh', tanh: 'tanh', arccosh: 'acosh', arcsinh: 'asinh', arctanh: 'atanh', ln: 'log', log: 'log', log10: 'log10', sqrt: 'sqrt', sgn: 'sign', int: 'trunc' };
    if (map[low]) return `Math.${map[low]}(${A(0)})`;
    switch (low) {
      case 'random': return `Math.floor(Math.random() * ${At(0)})`;
      case 'len': case 'size': return `${At(0)}.length`;
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
  declare: (n, t, arr, size) => (arr ? `let ${n} = new Array(${size});` : `let ${n};`),
  input: (o, v, t) => o.line(`${v} = ${t === 'Integer' ? 'parseInt(prompt())' : t === 'Real' ? 'parseFloat(prompt())' : t === 'Boolean' ? 'prompt() === "true"' : 'prompt()'};`),
  output: (e, nl) => `output(${e}, ${nl})`,
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
      if (f.type !== 'None' && f.variable) { o.line(''); o.line(`return ${f.variable};`); }
      o.out(); o.line('}');
    }
    o.line(''); o.line('// Main');
    g.block(o, prog.functions[0].body, g.buildScope(prog.functions[0]));
    o.line('if (rigaCorrente) console.log(rigaCorrente);');
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
