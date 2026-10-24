/* ==========================================================================
   FlowLab — interprete
   Esegue il modello come generatore: ogni istruzione produce un evento
   ('stmt', 'input', 'break') così l'interfaccia può eseguire a velocità
   variabile, passo-passo, evidenziare il blocco corrente e chiedere input.
   ========================================================================== */
'use strict';

const _E = (typeof module !== 'undefined') ? require('./expr.js') : ExprLib;
const _M = (typeof module !== 'undefined') ? require('./model.js') : ModelLib;

class Interpreter {
  constructor(prog, env) {
    this.prog = prog;
    this.env = env;
    this.stack = [];
    this.maxDepth = 1000;
    this.cache = new Map(); // espressioni già analizzate
    this.funcs = new Map();
    for (const f of prog.functions) this.funcs.set(f.name, f);
    const self = this;
    this.ctx = {
      getVar: (name, node) => self.getVar(name, node),
      hasUser: (name) => !!self.findFunc(name),
      callUser: (name, args, node) => self.callUser(name, args, node, false),
      env: {
        eof: (node) => env.eof(node),
      },
    };
  }

  findFunc(name) {
    if (this.funcs.has(name)) return this.funcs.get(name);
    const l = name.toLowerCase();
    for (const f of this.prog.functions) if (f.name.toLowerCase() === l) return f;
    return null;
  }

  get frame() { return this.stack[this.stack.length - 1]; }

  parse(src, what) {
    const key = what + '\u0000' + src;
    if (this.cache.has(key)) return this.cache.get(key);
    let r;
    try {
      r = what === 'lv' ? _E.parseLValue(src) : _E.parseExpr(src);
    } catch (e) {
      throw new _E.FlowError(`Errore di sintassi in "${src}": ${e.message}`);
    }
    this.cache.set(key, r);
    return r;
  }

  getVar(name, node) {
    const f = this.frame;
    const cell = f.vars.get(name);
    if (cell) return cell;
    if (this.findFunc(name)) throw new _E.FlowError(`"${name}" è una funzione: per chiamarla scrivi ${name}(...)`, { node });
    throw new _E.FlowError(`La variabile "${name}" non è stata dichiarata`, { node });
  }

  *run() {
    const main = this.prog.functions[0];
    if (main.params.length) throw new _E.FlowError('La funzione Main non può avere parametri');
    yield* this.invoke(main, [], null);
  }

  *invoke(func, args, node) {
    if (this.stack.length >= this.maxDepth) throw new _E.FlowError(`Stack overflow: più di ${this.maxDepth} chiamate annidate (ricorsione infinita?)`, { node });
    const frame = { func, vars: new Map(), depth: this.stack.length };
    func.params.forEach((p, i) => {
      if (p.array) frame.vars.set(p.name, { name: p.name, type: p.type, array: true, items: args[i].items, param: true });
      else frame.vars.set(p.name, { name: p.name, type: p.type, array: false, value: args[i], param: true });
    });
    this.stack.push(frame);
    yield { type: 'stmt', stmt: { id: 'start:' + func.id, kind: 'start' }, frame };
    yield* this.block(func.body);
    yield { type: 'stmt', stmt: { id: 'end:' + func.id, kind: 'end' }, frame };
    let ret;
    if (func.type !== 'None') {
      const cell = frame.vars.get(func.variable);
      if (!func.variable || !cell) {
        this.stack.pop();
        throw new _E.FlowError(`La funzione ${func.name} deve restituire un valore, ma la variabile di ritorno "${func.variable}" non è stata dichiarata`, { node, stmtId: 'end:' + func.id });
      }
      if (cell.array || cell.value === undefined) {
        this.stack.pop();
        throw new _E.FlowError(`La funzione ${func.name} termina senza aver assegnato un valore a "${func.variable}"`, { node, stmtId: 'end:' + func.id });
      }
      ret = _E.coerce(cell.value, func.type, 'il valore restituito');
    }
    this.stack.pop();
    return ret;
  }

  *callUser(name, argNodes, node, asStatement) {
    const func = this.findFunc(name);
    if (!asStatement && func.type === 'None') throw new _E.FlowError(`La funzione ${func.name} non restituisce alcun valore: non si può usare in un'espressione`, { node });
    if (argNodes.length !== func.params.length) throw new _E.FlowError(`${func.name} richiede ${func.params.length} argomenti, ne sono stati passati ${argNodes.length}`, { node });
    const args = [];
    for (let i = 0; i < argNodes.length; i++) {
      const p = func.params[i];
      const a = argNodes[i];
      if (p.array) {
        const inner = a.k === 'par' ? a.e : a;
        if (inner.k !== 'var' || inner.index) throw new _E.FlowError(`Il parametro "${p.name}" di ${func.name} è un array: passa il nome di un array`, { node });
        const cell = this.getVar(inner.name, inner);
        if (!cell.array) throw new _E.FlowError(`"${inner.name}" non è un array, ma ${func.name} si aspetta un array`, { node });
        if (cell.type !== p.type) throw new _E.FlowError(`L'array "${inner.name}" è di tipo ${_E.TYPE_IT[cell.type]}, ma il parametro "${p.name}" è ${_E.TYPE_IT[p.type]}`, { node });
        args.push(cell);
      } else {
        const v = yield* _E.evalE(a, this.ctx);
        args.push(_E.coerce(v, p.type, `l'argomento "${p.name}" di ${func.name}`));
      }
    }
    return yield* this.invoke(func, args, node);
  }

  *block(stmts) {
    for (const s of stmts) yield* this.stmt(s);
  }

  *stmt(s) {
    if (s.kind === 'comment') return;
    const frame = this.frame;
    if (_M.isIncomplete(s)) {
      yield { type: 'stmt', stmt: s, frame };
      throw this.tag(new _E.FlowError('Blocco incompleto: fai doppio clic per completarlo'), s, frame);
    }
    try {
      yield* this.exec(s, frame);
    } catch (e) {
      throw this.tag(e, s, frame);
    }
  }

  tag(e, s, frame) {
    if (!(e instanceof _E.FlowError)) {
      const w = new _E.FlowError(e && e.message ? e.message : String(e));
      e = w;
    }
    if (!e.stmtId) { e.stmtId = s.id; e.funcId = frame.func.id; }
    return e;
  }

  *exec(s, frame) {
    const env = this.env;
    const ev = (src) => _E.evalE(this.parse(src, 'e'), this.ctx);
    switch (s.kind) {
      case 'declare': {
        yield { type: 'stmt', stmt: s, frame };
        const names = s.name.split(',').map((x) => x.trim()).filter(Boolean);
        let size = 0;
        if (s.array) {
          const sv = yield* ev(s.size);
          if (sv.t !== 'Integer') throw new _E.FlowError(`La dimensione dell'array deve essere un intero, non ${_E.TYPE_IT[sv.t]}`);
          if (sv.v < 0) throw new _E.FlowError('La dimensione dell\'array non può essere negativa');
          if (sv.v > 1e7) throw new _E.FlowError('Array troppo grande (massimo 10 milioni di elementi)');
          size = sv.v;
        }
        for (const n of names) {
          if (!_E.validIdent(n)) throw new _E.FlowError(`"${n}" non è un nome di variabile valido`);
          if (_E.RESERVED.has(n.toLowerCase())) throw new _E.FlowError(`"${n}" è una parola riservata`);
          if (frame.vars.has(n)) throw new _E.FlowError(`La variabile "${n}" è già stata dichiarata`);
          if (s.array) frame.vars.set(n, { name: n, type: s.type, array: true, items: new Array(size).fill(undefined) });
          else frame.vars.set(n, { name: n, type: s.type, array: false, value: undefined });
        }
        return;
      }
      case 'assign': {
        yield { type: 'stmt', stmt: s, frame };
        const lv = this.parse(s.variable, 'lv');
        const val = yield* ev(s.expression);
        yield* this.store(lv, val);
        return;
      }
      case 'input': {
        yield { type: 'stmt', stmt: s, frame };
        const lv = this.parse(s.variable, 'lv');
        const cell = this.getVar(lv.name, lv);
        if (cell.array && !lv.index) throw new _E.FlowError(`"${lv.name}" è un array: indica l'elemento, es. ${lv.name}[i]`);
        // verifica l'indice prima di chiedere il valore
        if (cell.array) { const iv = yield* _E.evalE(lv.index, this.ctx); _E.arrIndex(iv, cell, lv); }
        for (;;) {
          const text = yield { type: 'input', stmt: s, frame, varType: cell.type, varName: s.variable };
          if (text === null || text === undefined) throw new _E.FlowError('Input annullato');
          try {
            const v = _E.parseInputText(text, cell.type);
            yield* this.store(lv, v);
            break;
          } catch (e) {
            env.output(e.message + '. Riprova.', true, 'error');
          }
        }
        return;
      }
      case 'output': {
        yield { type: 'stmt', stmt: s, frame };
        const v = yield* ev(s.expression);
        env.output(_E.fmtValue(v), s.newline);
        return;
      }
      case 'if': {
        yield { type: 'stmt', stmt: s, frame };
        const c = yield* ev(s.expression);
        if (c.t !== 'Boolean') throw new _E.FlowError(`La condizione deve essere vera o falsa, invece è ${_E.TYPE_IT[c.t]}`);
        yield { type: 'branch', stmt: s, frame, taken: c.v };
        yield* this.block(c.v ? s.then : s.else);
        return;
      }
      case 'while': {
        for (;;) {
          yield { type: 'stmt', stmt: s, frame };
          const c = yield* ev(s.expression);
          if (c.t !== 'Boolean') throw new _E.FlowError(`La condizione deve essere vera o falsa, invece è ${_E.TYPE_IT[c.t]}`);
          if (!c.v) break;
          yield* this.block(s.body);
        }
        return;
      }
      case 'do': {
        for (;;) {
          yield* this.block(s.body);
          yield { type: 'stmt', stmt: s, frame };
          const c = yield* ev(s.expression);
          if (c.t !== 'Boolean') throw new _E.FlowError(`La condizione deve essere vera o falsa, invece è ${_E.TYPE_IT[c.t]}`);
          if (!c.v) break;
        }
        return;
      }
      case 'for': {
        yield { type: 'stmt', stmt: s, frame };
        const lv = this.parse(s.variable, 'lv');
        const cell = this.getVar(lv.name, lv);
        if (cell.array && !lv.index) throw new _E.FlowError(`La variabile del ciclo "${lv.name}" non può essere un array`);
        if (cell.type !== 'Integer' && cell.type !== 'Real') throw new _E.FlowError(`La variabile del ciclo "${lv.name}" deve essere numerica`);
        const a = yield* ev(s.start), b = yield* ev(s.end);
        const st = yield* ev(String(s.step).trim() || '1');
        for (const [v, n] of [[a, 'iniziale'], [b, 'finale'], [st, 'del passo']]) if (!_E.isNum(v)) throw new _E.FlowError(`Il valore ${n} del ciclo deve essere un numero`);
        if (st.v === 0) throw new _E.FlowError('Il passo del ciclo non può essere zero');
        if (st.v < 0) throw new _E.FlowError('Il passo deve essere positivo: per contare all\'indietro scegli "decrescente"');
        const dec = s.direction === 'dec';
        const mk = (x) => (cell.type === 'Integer' ? _E.V.int(Math.trunc(x)) : _E.V.real(x));
        let i = a.v;
        yield* this.store(lv, mk(i));
        let first = true;
        for (;;) {
          if (!first) yield { type: 'stmt', stmt: s, frame };
          first = false;
          const cur = (yield* _E.evalE(lv, this.ctx)).v;
          if (dec ? cur < b.v : cur > b.v) break;
          yield* this.block(s.body);
          const now = (yield* _E.evalE(lv, this.ctx)).v;
          yield* this.store(lv, mk(dec ? now - st.v : now + st.v));
        }
        return;
      }
      case 'call': {
        yield { type: 'stmt', stmt: s, frame };
        let e = this.parse(s.expression, 'e');
        if (e.k === 'var' && !e.index) e = { k: 'call', name: e.name, args: [] };
        if (e.k !== 'call') throw new _E.FlowError('Il blocco Chiamata deve contenere una chiamata di funzione, es. Stampa(x)');
        if (this.findFunc(e.name)) yield* this.callUser(e.name, e.args, e, true);
        else yield* _E.evalE(e, this.ctx);
        return;
      }
      case 'breakpoint': {
        yield { type: 'stmt', stmt: s, frame };
        let hit = s.always;
        if (!hit) {
          const c = yield* ev(s.expression);
          if (c.t !== 'Boolean') throw new _E.FlowError('La condizione del punto di interruzione deve essere booleana');
          hit = c.v;
        }
        if (hit) yield { type: 'break', stmt: s, frame };
        return;
      }
      case 'open': {
        yield { type: 'stmt', stmt: s, frame };
        const n = yield* ev(s.expression);
        env.fileOpen(_E.fmtValue(n), s.mode);
        return;
      }
      case 'close': yield { type: 'stmt', stmt: s, frame }; env.fileClose(s.mode); return;
      case 'read': {
        yield { type: 'stmt', stmt: s, frame };
        const lv = this.parse(s.variable, 'lv');
        const cell = this.getVar(lv.name, lv);
        const line = env.fileRead();
        let v;
        try { v = _E.parseInputText(line, cell.type); } catch (e) { throw new _E.FlowError(`Lettura dal file: ${e.message}`); }
        yield* this.store(lv, v);
        return;
      }
      case 'write': {
        yield { type: 'stmt', stmt: s, frame };
        const v = yield* ev(s.expression);
        env.fileWrite(_E.fmtValue(v));
        return;
      }
    }
  }

  *store(lv, val) {
    const cell = this.getVar(lv.name, lv);
    if (cell.array) {
      if (!lv.index) throw new _E.FlowError(`"${lv.name}" è un array: indica l'elemento da modificare, es. ${lv.name}[i]`);
      const iv = yield* _E.evalE(lv.index, this.ctx);
      const i = _E.arrIndex(iv, cell, lv);
      cell.items[i] = _E.coerce(val, cell.type, `il valore assegnato a ${lv.name}[${i}]`);
    } else {
      if (lv.index) throw new _E.FlowError(`"${lv.name}" non è un array`);
      cell.value = _E.coerce(val, cell.type, `il valore assegnato a "${lv.name}"`);
    }
  }
}

if (typeof module !== 'undefined') module.exports = { Interpreter };
