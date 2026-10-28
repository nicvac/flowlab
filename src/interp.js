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
    // programmazione a oggetti: classi, metodi e costruttori per classe
    this.oo = _M.hasClasses(prog);
    this.objCount = 0; // numero unico di ogni oggetto (uso interno)
    this.classCount = new Map(); // numerazione mostrata: progressiva per classe, Cerchio#1, Cerchio#2…
    this.statics = new Map(); // id classe -> Map(nome minuscolo -> cella)
    this.byName = new Map();
    this.methods = new Map();
    this.ctors = new Map();
    this.superFirst = new Map();
    if (this.oo) {
      for (const c of prog.classes) { this.byName.set(c.name.toLowerCase(), c); this.methods.set(c.id, []); this.ctors.set(c.id, []); }
      for (const f of prog.functions) {
        if (!this.methods.has(f.cls)) continue;
        (f.ctor ? this.ctors : this.methods).get(f.cls).push(f);
      }
    }
    const self = this;
    this.ctx = {
      getVar: (name, node) => self.getVar(name, node),
      hasUser: (name) => self.hasUser(name),
      callUser: (name, args, node) => self.callUser(name, args, node, false),
      cellOf: (node) => self.cellOf(node),
      oo: this.oo ? (node) => self.ooEval(node) : null,
      env: {
        eof: (node) => env.eof(node),
      },
    };
  }

  /* ----------------------------- classi --------------------------------- */
  classById(id) { return this.oo ? this.prog.classes.find((c) => c.id === id) || null : null; }
  parentOf(c) { return c && c.parent ? this.byName.get(c.parent.toLowerCase()) || null : null; }
  chain(c) { const out = []; while (c && !out.includes(c)) { out.push(c); c = this.parentOf(c); } return out; }
  isA(c, of) { return this.chain(c).includes(of); }
  coerceTo(val, type, what) {
    return _E.coerce(val, type, what, (oc, tn) => { const t = this.byName.get(String(tn).toLowerCase()); return !!t && this.isA(oc, t); });
  }
  /* attributo cercato nella classe e nelle classi madri: { attr, owner } */
  fieldLookup(c, low) {
    for (const k of this.chain(c)) { const a = k.attributes.find((x) => x.name.toLowerCase() === low); if (a) return { attr: a, owner: k }; }
    return null;
  }
  /* metodi con quel nome, dal più derivato: una versione per ogni firma (override) */
  methodCands(c, low) {
    const out = [], seen = new Set();
    for (const k of this.chain(c)) {
      for (const f of this.methods.get(k.id) || []) {
        if (f.name.toLowerCase() !== low) continue;
        const sig = f.params.map((p) => p.type.toLowerCase() + (p.array ? '[' + (p.dims || 1) : '')).join(',');
        if (seen.has(sig)) continue;
        seen.add(sig); out.push(f);
      }
    }
    return out;
  }
  checkAccess(vis, owner, what, name) {
    if (!vis || vis === 'public') return;
    const from = this.frame && this.frame.cls;
    if (vis === 'private' && from !== owner) throw new _E.FlowError(`${what} "${name}" di ${owner.name} è privato: si può usare solo dentro la classe ${owner.name}`);
    if (vis === 'protected' && !(from && this.isA(from, owner))) throw new _E.FlowError(`${what} "${name}" di ${owner.name} è protetto: si può usare solo in ${owner.name} e nelle sue sottoclassi`);
  }
  label(n) {
    if (!n) return '';
    switch (n.k) {
      case 'par': return this.label(n.e);
      case 'var': return n.name + (n.indices ? '[…]' : '');
      case 'this': return 'this';
      case 'member': return this.label(n.obj) + '.' + n.name + (n.indices ? '[…]' : '');
      case 'mcall': return this.label(n.obj) + '.' + n.name + '(…)';
      case 'call': return n.name + '(…)';
      case 'new': return 'new ' + n.cls + '(…)';
    }
    return 'l\'espressione';
  }
  defaultOf(t) {
    switch (t) {
      case 'Integer': return _E.V.int(0);
      case 'Real': return _E.V.real(0);
      case 'String': return _E.V.str('');
      case 'Boolean': return _E.V.bool(false);
    }
    return _E.V.obj(null);
  }
  checkType(t) {
    if (this.oo && !_E.isBaseType(t) && !this.byName.has(String(t).toLowerCase())) throw new _E.FlowError(`Il tipo "${t}" non esiste: crea la classe ${t} nel diagramma delle classi`);
  }
  /* esegue fn in una chiamata "di servizio" per inizializzare gli attributi di una classe */
  *withInit(c, obj, fn) {
    const frame = { func: { id: 'init:' + c.id, name: c.name + ' (attributi)', params: [], body: [] }, vars: new Map(), depth: this.stack.length, cls: c, self: obj, executed: 0, init: true };
    this.stack.push(frame);
    try { return yield* fn(); } finally { this.stack.pop(); }
  }
  /* cella di un attributo: valore iniziale come in Java (0, "", false, null) oppure quello indicato */
  *attrCell(a, owner) {
    this.checkType(a.type);
    const cell = { name: a.name, type: a.type, array: !!a.array, field: true, owner, visibility: a.visibility, static: !!a.static };
    try {
      if (a.array) {
        const dims = [];
        for (const part of _E.splitTop(a.size)) {
          const sv = yield* _E.evalE(this.parse(part, 'e'), this.ctx);
          if (sv.t !== 'Integer' || sv.v < 0) throw new _E.FlowError('la dimensione deve essere un intero non negativo');
          dims.push(sv.v);
        }
        const n = dims.reduce((x, y) => x * y, 1);
        if (n > 1e7) throw new _E.FlowError('array troppo grande');
        cell.dims = dims; cell.items = new Array(n).fill(this.defaultOf(a.type));
      } else {
        cell.value = this.defaultOf(a.type);
        if (String(a.init || '').trim()) cell.value = this.coerceTo(yield* _E.evalE(this.parse(a.init, 'e'), this.ctx), a.type, `il valore iniziale di ${owner.name}.${a.name}`);
      }
    } catch (e) {
      if (e instanceof _E.FlowError && !e.attrDone) { e.message = `Attributo ${owner.name}.${a.name}: ${e.message}`; e.attrDone = true; }
      throw e;
    }
    return cell;
  }
  *initStatics() {
    for (const c of this.prog.classes) this.statics.set(c.id, new Map());
    for (const c of this.prog.classes) {
      const statics = c.attributes.filter((a) => a.static);
      if (!statics.length) continue;
      yield* this.withInit(c, null, function* () {
        for (const a of statics) this.statics.get(c.id).set(a.name.toLowerCase(), yield* this.attrCell(a, c));
      }.bind(this));
    }
  }
  staticCell(owner, attr) {
    const cell = this.statics.get(owner.id) && this.statics.get(owner.id).get(attr.name.toLowerCase());
    if (!cell) throw new _E.FlowError(`L'attributo statico ${owner.name}.${attr.name} non è ancora inizializzato`);
    return cell;
  }
  /* attributo usato con il solo nome dentro un metodo (come this.x in Java) */
  implicitField(low, node) {
    const fr = this.frame;
    if (!fr.cls) return null;
    const hit = this.fieldLookup(fr.self ? fr.self.cls : fr.cls, low) || this.fieldLookup(fr.cls, low);
    if (!hit) return null;
    this.checkAccess(hit.attr.visibility, hit.owner, 'L\'attributo', hit.attr.name);
    if (hit.attr.static) return this.staticCell(hit.owner, hit.attr);
    if (!fr.self) throw new _E.FlowError(`"${hit.attr.name}" è un attributo d'istanza: in un metodo statico non c'è nessun oggetto (this)`, { node });
    return fr.self.fields.get(low);
  }
  isVarName(name) {
    const low = name.toLowerCase(), fr = this.frame;
    if (fr.vars.has(low)) return true;
    return !!(fr.cls && (this.fieldLookup(fr.self ? fr.self.cls : fr.cls, low) || this.fieldLookup(fr.cls, low)));
  }
  /* bersaglio a sinistra del punto: un oggetto oppure una classe (accesso statico) */
  *target(objNode) {
    const o = objNode.k === 'par' ? objNode.e : objNode;
    if (o.k === 'super') {
      if (!this.frame.self) throw new _E.FlowError('super si usa nei metodi non statici e nei costruttori');
      return { obj: this.frame.self };
    }
    if (o.k === 'var' && !o.indices && !this.isVarName(o.name) && this.byName.has(o.name.toLowerCase())) return { cls: this.byName.get(o.name.toLowerCase()) };
    const v = yield* _E.evalE(objNode, this.ctx);
    if (v.t !== 'Object') throw new _E.FlowError(`"${this.label(objNode)}" non è un oggetto (è ${_E.typeName(v.t)}): il punto si usa con gli oggetti`, { node: objNode });
    if (v.v === null) throw new _E.FlowError(`"${this.label(objNode)}" vale null: non indica nessun oggetto (crealo con new)`, { node: objNode });
    return { obj: v.v };
  }
  fieldCell(tg, name, node) {
    const low = name.toLowerCase();
    if (tg.cls) {
      const hit = this.fieldLookup(tg.cls, low);
      if (!hit) throw new _E.FlowError(`La classe ${tg.cls.name} non ha un attributo "${name}"`, { node });
      if (!hit.attr.static) throw new _E.FlowError(`"${hit.attr.name}" è un attributo d'istanza di ${hit.owner.name}: serve un oggetto, es. obj.${hit.attr.name}`, { node });
      this.checkAccess(hit.attr.visibility, hit.owner, 'L\'attributo', hit.attr.name);
      return this.staticCell(hit.owner, hit.attr);
    }
    const hit = this.fieldLookup(tg.obj.cls, low);
    if (!hit) {
      const isMethod = this.methodCands(tg.obj.cls, low).length;
      throw new _E.FlowError(isMethod ? `"${name}" è un metodo di ${tg.obj.cls.name}: per chiamarlo scrivi ${name}(...)` : `Gli oggetti ${tg.obj.cls.name} non hanno un attributo "${name}"`, { node });
    }
    this.checkAccess(hit.attr.visibility, hit.owner, 'L\'attributo', hit.attr.name);
    return hit.attr.static ? this.staticCell(hit.owner, hit.attr) : tg.obj.fields.get(low);
  }
  /* cella indicata da una variabile o da un attributo (p.x, this.v) */
  *cellOf(lv) {
    if (lv.k === 'var') return this.getVar(lv.name, lv);
    if (lv.k === 'member') return this.fieldCell(yield* this.target(lv.obj), lv.name, lv);
    throw new _E.FlowError('Serve una variabile o un attributo');
  }
  *readCell(cell, node) {
    const nm = this.label(node).replace(/\[…\]$/, '');
    if (cell.array) {
      if (!node.indices) throw new _E.FlowError(`"${nm}" è un array: serve un indice, es. ${nm}[${(cell.dims || [0]).map(() => 0).join(', ')}]`, { node });
      const ivs = [];
      for (const ix of node.indices) ivs.push(yield* _E.evalE(ix, this.ctx));
      const item = cell.items[_E.arrOffset(ivs, cell, { name: nm })];
      if (item === undefined) throw new _E.FlowError(`L'elemento ${nm}[${ivs.map((x) => x.v).join(', ')}] non ha ancora un valore`, { node });
      return item;
    }
    if (node.indices) throw new _E.FlowError(`"${nm}" non è un array`, { node });
    if (cell.value === undefined) throw new _E.FlowError(`"${nm}" non ha ancora un valore`, { node });
    return cell.value;
  }
  *ooEval(node) {
    switch (node.k) {
      case 'this':
        if (!this.frame.self) throw new _E.FlowError('this si usa solo nei metodi non statici e nei costruttori', { node });
        return _E.V.obj(this.frame.self);
      case 'new': return yield* this.construct(node);
      case 'member': return yield* this.readCell(yield* this.cellOf(node), node);
      case 'mcall': return yield* this.mcall(node, {});
    }
    throw new _E.FlowError('Espressione non riconosciuta');
  }

  /* ------------------------- argomenti e chiamate ------------------------ */
  /* valuta gli argomenti una volta sola: gli array passano come riferimento alla cella */
  *prepArgs(argNodes) {
    const out = [];
    for (const a of argNodes) {
      const inner = a.k === 'par' ? a.e : a;
      if (inner.k === 'var' && !inner.index) {
        let c = null;
        try { c = this.getVar(inner.name, inner); } catch (e) { c = null; }
        if (c && c.array) { out.push({ node: a, cell: c }); continue; }
      }
      if (inner.k === 'member' && !inner.index) {
        const c = yield* this.cellOf(inner);
        out.push(c.array ? { node: a, cell: c } : { node: a, val: yield* this.readCell(c, inner) });
        continue;
      }
      out.push({ node: a, val: yield* _E.evalE(a, this.ctx) });
    }
    return out;
  }
  /* overloading: sceglie la versione più adatta agli argomenti */
  pick(cands, pre, name, node) {
    if (cands.length === 1) return cands[0];
    const score = (f) => {
      if (f.params.length !== pre.length) return -1;
      let tot = 0;
      for (let i = 0; i < pre.length; i++) {
        const p = f.params[i], a = pre[i];
        if (p.array) {
          if (!a.cell || a.cell.type.toLowerCase() !== p.type.toLowerCase() || (a.cell.dims || [0]).length !== (p.dims || 1)) return -1;
          tot += 3; continue;
        }
        if (a.cell) return -1;
        const v = a.val;
        if (_E.isBaseType(p.type)) {
          if (v.t === p.type) tot += 3;
          else if (p.type === 'Real' && v.t === 'Integer') tot += 2;
          else if (p.type === 'Integer' && v.t === 'Real') tot += 1;
          else return -1;
        } else {
          const t = this.byName.get(p.type.toLowerCase());
          if (v.t !== 'Object' || !t) return -1;
          if (v.v === null) tot += 2;
          else if (v.v.cls === t) tot += 3;
          else if (this.isA(v.v.cls, t)) tot += 2;
          else return -1;
        }
      }
      return tot;
    };
    let best = null, bs = -1;
    for (const f of cands) { const sc = score(f); if (sc > bs) { bs = sc; best = f; } }
    if (best) return best;
    const got = pre.map((a) => (a.cell ? `array di ${_E.typeName(a.cell.type)}` : a.val.t === 'Object' ? (a.val.v ? a.val.v.cls.name : 'null') : _E.typeName(a.val.t))).join(', ');
    const vers = cands.map((f) => `${f.name}(${f.params.map((p) => _E.typeName(p.type) + (p.array ? '[]' : '')).join(', ')})`).join(' · ');
    throw new _E.FlowError(`Nessuna versione di ${name} accetta questi argomenti (${got || 'nessuno'}). Versioni disponibili: ${vers}`, { node });
  }
  bindArgs(func, pre, node) {
    const args = [];
    for (let i = 0; i < pre.length; i++) {
      const p = func.params[i], a = pre[i];
      if (p.array) {
        const inner = a.node.k === 'par' ? a.node.e : a.node;
        if (!a.cell) {
          if (inner.k === 'var' && !inner.index) throw new _E.FlowError(`"${inner.name}" non è un array, ma ${func.name} si aspetta un array`, { node });
          throw new _E.FlowError(`Il parametro "${p.name}" di ${func.name} è un array: passa il nome di un array`, { node });
        }
        const cell = a.cell;
        if (cell.type !== p.type) throw new _E.FlowError(`L'array "${cell.name}" è di tipo ${_E.typeName(cell.type)}, ma il parametro "${p.name}" è ${_E.typeName(p.type)}`, { node });
        const nd = (cell.dims || [0]).length, pd = p.dims || 1;
        if (nd !== pd) throw new _E.FlowError(`L'array "${cell.name}" ha ${nd} ${nd === 1 ? 'dimensione' : 'dimensioni'}, ma il parametro "${p.name}" ne vuole ${pd}`, { node });
        args.push(cell);
      } else {
        if (a.cell) throw new _E.FlowError(`"${a.cell.name}" è un array: il parametro "${p.name}" di ${func.name} vuole un singolo valore`, { node });
        args.push(this.coerceTo(a.val, p.type, `l'argomento "${p.name}" di ${func.name}`));
      }
    }
    return args;
  }
  /* uso del valore restituito: in un'espressione serve un valore, in a, b ← f() ne servono tanti quante le variabili */
  checkRetUse(func, opts, node) {
    const nr = _M.rets(func).length;
    if (opts.allowMulti) {
      if (nr !== opts.allowMulti) throw new _E.FlowError(`${func.name} restituisce ${nr} ${nr === 1 ? 'valore' : 'valori'}, ma a sinistra ci sono ${opts.allowMulti} variabili`, { node });
      return;
    }
    if (opts.asStatement) return;
    if (nr === 0) throw new _E.FlowError(`${func.ctor ? 'Il costruttore' : 'La funzione'} ${func.name} non restituisce alcun valore: non si può usare in un'espressione`, { node });
    if (nr > 1) {
      const ph = _M.rets(func).map((r) => r.name).join(', ');
      throw new _E.FlowError(`La funzione ${func.name} restituisce ${nr} valori: va usata in un'assegnazione con ${nr} variabili, es. ${ph} ← ${func.name}(...)`, { node });
    }
  }
  *callCands(cands, name, argNodes, node, opts) {
    if (cands.length === 1) {
      const f = cands[0];
      this.checkRetUse(f, opts, node);
      if (argNodes.length !== f.params.length) throw new _E.FlowError(`${f.name} richiede ${f.params.length} argomenti, ne sono stati passati ${argNodes.length}`, { node });
    }
    const pre = yield* this.prepArgs(argNodes);
    const f = this.pick(cands, pre, name, node);
    this.checkRetUse(f, opts, node);
    let self = null;
    if (this.oo) {
      const owner = this.classById(f.cls);
      this.checkAccess(f.visibility, owner, 'Il metodo', f.name);
      if (!f.static) {
        if (!opts.self) throw new _E.FlowError(opts.viaClass ? `${f.name} non è un metodo statico: serve un oggetto, es. obj.${f.name}(...)` : `Da un metodo statico non si può chiamare il metodo d'istanza ${f.name} senza un oggetto`, { node });
        self = opts.self;
      }
    }
    return yield* this.invoke(f, this.bindArgs(f, pre, node), node, { self });
  }
  *mcall(node, opts) {
    const low = node.name.toLowerCase();
    let cands, self = null, cls, viaClass = false;
    if (node.obj.k === 'super') {
      const fr = this.frame;
      cls = this.parentOf(fr.cls);
      if (!cls) throw new _E.FlowError(`${fr.cls ? fr.cls.name : 'Questa classe'} non ha una classe madre: super non si può usare`, { node });
      if (!fr.self) throw new _E.FlowError('super.metodo(...) si usa nei metodi non statici e nei costruttori', { node });
      self = fr.self;
    } else {
      const tg = yield* this.target(node.obj);
      if (tg.cls) { cls = tg.cls; viaClass = true; } else { cls = tg.obj.cls; self = tg.obj; }
    }
    cands = this.methodCands(cls, low);
    if (!cands.length) {
      const isField = this.fieldLookup(cls, low);
      throw new _E.FlowError(isField ? `"${node.name}" è un attributo di ${cls.name}, non un metodo: si usa senza parentesi` : `La classe ${cls.name} non ha un metodo "${node.name}"`, { node });
    }
    return yield* this.callCands(cands, node.name, node.args, node, { ...opts, self, viaClass });
  }
  /* new Classe(...): attributi con i valori iniziali, poi il costruttore */
  *construct(node) {
    const cls = this.byName.get(node.cls.toLowerCase());
    if (!cls) throw new _E.FlowError(`La classe "${node.cls}" non esiste`, { node });
    const n = (this.classCount.get(cls.id) || 0) + 1;
    this.classCount.set(cls.id, n);
    const obj = { id: n, uid: ++this.objCount, cls, fields: new Map() };
    for (const c of this.chain(cls).reverse()) {
      const attrs = c.attributes.filter((a) => !a.static);
      if (!attrs.length) continue;
      yield* this.withInit(c, obj, function* () {
        for (const a of attrs) obj.fields.set(a.name.toLowerCase(), yield* this.attrCell(a, c));
      }.bind(this));
    }
    yield* this.runCtor(cls, node.args, obj, node);
    return _E.V.obj(obj);
  }
  *runCtor(cls, argNodes, obj, node) {
    const ctors = this.ctors.get(cls.id) || [];
    if (!ctors.length) {
      if (argNodes.length) throw new _E.FlowError(`${cls.name} non ha costruttori con parametri: si crea con new ${cls.name}() senza argomenti`, { node });
      const parent = this.parentOf(cls);
      if (parent) yield* this.runCtor(parent, [], obj, node);
      return;
    }
    let cands = ctors;
    if (ctors.length > 1 || ctors[0].params.length !== argNodes.length) {
      cands = ctors.filter((f) => f.params.length === argNodes.length);
      if (!cands.length) {
        const vers = ctors.map((f) => `${cls.name}(${f.params.map((p) => _E.typeName(p.type) + (p.array ? '[]' : '')).join(', ')})`).join(' · ');
        throw new _E.FlowError(`${cls.name} non ha un costruttore con ${argNodes.length} ${argNodes.length === 1 ? 'argomento' : 'argomenti'}. Costruttori disponibili: ${vers}`, { node });
      }
    }
    const pre = yield* this.prepArgs(argNodes);
    const f = this.pick(cands, pre, cls.name, node);
    this.checkAccess(f.visibility, cls, 'Il costruttore', cls.name);
    yield* this.invoke(f, this.bindArgs(f, pre, node), node, { self: obj });
  }
  /* il primo blocco eseguibile del costruttore è super(...)? */
  startsWithSuper(func) {
    if (this.superFirst.has(func.id)) return this.superFirst.get(func.id);
    const first = func.body.find((s) => s.kind !== 'comment');
    let r = false;
    if (first && first.kind === 'call') { try { const e = _E.parseExpr(first.expression); r = e.k === 'supercall'; } catch (e) { r = false; } }
    this.superFirst.set(func.id, r);
    return r;
  }
  hasUser(name) {
    if (!this.oo) return !!this.findFunc(name);
    const fr = this.frame; if (!fr || !fr.cls) return false;
    const low = name.toLowerCase();
    return this.methodCands(fr.self ? fr.self.cls : fr.cls, low).length > 0 || this.methodCands(fr.cls, low).length > 0;
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
    const low = name.toLowerCase();
    const cell = f.vars.get(low);
    if (cell) return cell;
    if (this.oo) {
      const fc = this.implicitField(low, node);
      if (fc) return fc;
      if (this.byName.has(low)) throw new _E.FlowError(`"${name}" è una classe: usa ${name}.attributo, ${name}.metodo(...) oppure new ${name}(...)`, { node });
      if (f.cls && this.methodCands(f.self ? f.self.cls : f.cls, low).length) throw new _E.FlowError(`"${name}" è un metodo: per chiamarlo scrivi ${name}(...)`, { node });
    } else if (this.findFunc(name)) throw new _E.FlowError(`"${name}" è una funzione: per chiamarla scrivi ${name}(...)`, { node });
    throw new _E.FlowError(`La variabile "${name}" non è stata dichiarata`, { node });
  }

  *run() {
    const main = this.prog.functions[0];
    if (main.params.length) throw new _E.FlowError('La funzione Main non può avere parametri');
    if (this.oo) yield* this.initStatics();
    yield* this.invoke(main, [], null);
  }

  *invoke(func, args, node, opts) {
    if (this.stack.length >= this.maxDepth) throw new _E.FlowError(`Stack overflow: più di ${this.maxDepth} chiamate annidate (ricorsione infinita?)`, { node });
    const cls = this.oo ? this.classById(func.cls) : null;
    const frame = { func, vars: new Map(), depth: this.stack.length, cls, self: (opts && opts.self) || null, executed: 0 };
    func.params.forEach((p, i) => {
      if (p.array) frame.vars.set(p.name.toLowerCase(), { name: p.name, type: p.type, array: true, dims: args[i].dims || [args[i].items.length], items: args[i].items, param: true });
      else frame.vars.set(p.name.toLowerCase(), { name: p.name, type: p.type, array: false, value: args[i], param: true });
    });
    this.stack.push(frame);
    yield { type: 'stmt', stmt: { id: 'start:' + func.id, kind: 'start' }, frame };
    if (func.ctor && cls && this.parentOf(cls) && !this.startsWithSuper(func)) {
      // come in Java: senza super(...) esplicito si chiama il costruttore senza parametri della classe madre
      const parent = this.parentOf(cls);
      const pc = this.ctors.get(parent.id) || [];
      if (pc.length && !pc.some((f) => !f.params.length)) {
        this.stack.pop();
        throw new _E.FlowError(`Il costruttore di ${cls.name} deve iniziare con un blocco Chiamata super(...): ${parent.name} non ha un costruttore senza parametri`, { node, stmtId: 'start:' + func.id, funcId: func.id });
      }
      yield* this.runCtor(parent, [], frame.self, node);
    }
    yield* this.block(func.body);
    yield { type: 'stmt', stmt: { id: 'end:' + func.id, kind: 'end' }, frame };
    let ret;
    const rs = _M.rets(func);
    if (rs.length) {
      const vals = [];
      for (const r of rs) {
        const cell = frame.vars.get(r.name.toLowerCase());
        if (!r.name || !cell) {
          this.stack.pop();
          throw new _E.FlowError(`La funzione ${func.name} deve restituire "${r.name}", ma questa variabile non è stata dichiarata`, { node, stmtId: 'end:' + func.id });
        }
        if (cell.array || cell.value === undefined) {
          this.stack.pop();
          throw new _E.FlowError(`La funzione ${func.name} termina senza aver assegnato un valore a "${r.name}"`, { node, stmtId: 'end:' + func.id });
        }
        vals.push(this.coerceTo(cell.value, r.type, `il valore restituito "${r.name}"`));
      }
      ret = rs.length === 1 ? vals[0] : { t: 'Tuple', items: vals };
    }
    this.stack.pop();
    return ret;
  }

  *callUser(name, argNodes, node, asStatement, allowMulti) {
    let cands, self = null;
    if (!this.oo) cands = [this.findFunc(name)];
    else {
      const fr = this.frame, low = name.toLowerCase();
      cands = this.methodCands(fr.self ? fr.self.cls : fr.cls, low);
      if (!cands.length) cands = this.methodCands(fr.cls, low);
      self = fr.self;
    }
    return yield* this.callCands(cands, name, argNodes, node, { asStatement, allowMulti, self });
  }

  *block(stmts) {
    for (const s of stmts) yield* this.stmt(s);
  }

  *stmt(s) {
    if (s.kind === 'comment') return;
    const frame = this.frame;
    frame.executed++;
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
        let size = 0, dims = null;
        if (s.array) {
          // una o più dimensioni: "10" oppure "3, 4"
          dims = [];
          for (const part of _E.splitTop(s.size)) {
            const sv = yield* ev(part);
            if (sv.t !== 'Integer') throw new _E.FlowError(`La dimensione dell'array deve essere un intero, non ${_E.TYPE_IT[sv.t]}`);
            if (sv.v < 0) throw new _E.FlowError('La dimensione dell\'array non può essere negativa');
            dims.push(sv.v);
          }
          size = dims.reduce((a, b) => a * b, 1);
          if (size > 1e7) throw new _E.FlowError('Array troppo grande (massimo 10 milioni di elementi)');
        }
        this.checkType(s.type);
        for (const n of names) {
          if (!_E.validIdent(n)) throw new _E.FlowError(`"${n}" non è un nome di variabile valido`);
          if (_E.RESERVED.has(n.toLowerCase())) throw new _E.FlowError(`"${n}" è una parola riservata`);
          const key = n.toLowerCase();
          if (frame.vars.has(key) && frame.vars.get(key).constant) throw new _E.FlowError(`Il nome "${n}" è già usato dalla costante "${frame.vars.get(key).name}"`);
          if (frame.vars.has(key)) throw new _E.FlowError(frame.vars.get(key).name === n ? `La variabile "${n}" è già stata dichiarata` : `La variabile "${n}" è già stata dichiarata come "${frame.vars.get(key).name}" (maiuscole e minuscole non contano)`);
          if (s.array) frame.vars.set(key, { name: n, type: s.type, array: true, dims: dims.slice(), items: new Array(size).fill(undefined) });
          else frame.vars.set(key, { name: n, type: s.type, array: false, value: undefined });
        }
        return;
      }
      case 'const': {
        yield { type: 'stmt', stmt: s, frame };
        const n = s.name.trim();
        if (!_E.validIdent(n)) throw new _E.FlowError(`"${n}" non è un nome valido per una costante`);
        if (_E.RESERVED.has(n.toLowerCase())) throw new _E.FlowError(`"${n}" è una parola riservata`);
        const key = n.toLowerCase();
        if (frame.vars.has(key)) throw new _E.FlowError(`Il nome "${n}" è già usato da ${frame.vars.get(key).constant ? 'un\'altra costante' : 'una variabile'}`);
        const v = yield* ev(s.expression);
        frame.vars.set(key, { name: n, type: s.type, array: false, value: this.coerceTo(v, s.type, `il valore della costante "${n}"`), constant: true });
        return;
      }
      case 'assign': {
        yield { type: 'stmt', stmt: s, frame };
        const targets = _E.splitTop(s.variable);
        if (targets.length > 1) {
          // a, b, c ← funzione(...) : assegnazione multipla
          let e = this.parse(s.expression, 'e');
          while (e.k === 'par') e = e.e;
          if (!((e.k === 'call' && this.hasUser(e.name)) || e.k === 'mcall')) throw new _E.FlowError('Per assegnare più variabili insieme, a destra serve la chiamata di una funzione che restituisce più valori');
          const lvs = _E.parseLValueList(s.variable);
          const tup = e.k === 'call' ? yield* this.callUser(e.name, e.args, e, false, targets.length) : yield* this.mcall(e, { allowMulti: targets.length });
          for (let i = 0; i < lvs.length; i++) yield* this.store(lvs[i], tup.items[i]);
          return;
        }
        const lv = this.parse(s.variable, 'lv');
        const val = yield* ev(s.expression);
        yield* this.store(lv, val);
        return;
      }
      case 'input': {
        yield { type: 'stmt', stmt: s, frame };
        const lv = this.parse(s.variable, 'lv');
        const cell = yield* this.cellOf(lv);
        if (cell.constant) throw new _E.FlowError(`"${cell.name}" è una costante: non si può leggere un nuovo valore`);
        if (cell.array && !lv.index) throw new _E.FlowError(`"${lv.name}" è un array: indica l'elemento, es. ${lv.name}[i]`);
        // verifica l'indice prima di chiedere il valore
        if (cell.array) { const ivs = []; for (const ix of lv.indices) ivs.push(yield* _E.evalE(ix, this.ctx)); _E.arrOffset(ivs, cell, lv); }
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
        const cell = yield* this.cellOf(lv);
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
        while (e.k === 'par') e = e.e;
        if (e.k === 'var' && !e.index) e = { k: 'call', name: e.name, args: [] };
        if (e.k === 'supercall') {
          if (!frame.func.ctor) throw new _E.FlowError('super(...) si può usare solo in un costruttore');
          if (frame.executed !== 1) throw new _E.FlowError('super(...) deve essere il primo blocco del costruttore');
          const parent = this.parentOf(frame.cls);
          if (!parent) throw new _E.FlowError(`${frame.cls.name} non ha una classe madre: super(...) non serve`);
          yield* this.runCtor(parent, e.args, frame.self, e);
          return;
        }
        if (e.k === 'mcall') { yield* this.mcall(e, { asStatement: true }); return; }
        if (e.k === 'new') { yield* _E.evalE(e, this.ctx); return; }
        if (e.k !== 'call') throw new _E.FlowError(this.oo ? 'Il blocco Chiamata deve contenere la chiamata di un metodo, es. Stampa(x) oppure p.sposta(1, 2)' : 'Il blocco Chiamata deve contenere una chiamata di funzione, es. Stampa(x)');
        if (this.hasUser(e.name)) yield* this.callUser(e.name, e.args, e, true);
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
        const cell = yield* this.cellOf(lv);
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
    const cell = yield* this.cellOf(lv);
    const nm = lv.k === 'var' ? lv.name : this.label(lv).replace(/\[…\]$/, '');
    if (cell.constant) throw new _E.FlowError(`"${cell.name}" è una costante: il suo valore non si può modificare`);
    if (cell.array) {
      if (!lv.index) throw new _E.FlowError(`"${nm}" è un array: indica l'elemento da modificare, es. ${nm}[i]`);
      const ivs = [];
      for (const ix of lv.indices) ivs.push(yield* _E.evalE(ix, this.ctx));
      const off = _E.arrOffset(ivs, cell, { name: nm });
      cell.items[off] = this.coerceTo(val, cell.type, `il valore assegnato a ${nm}[${ivs.map((x) => x.v).join(', ')}]`);
      cell.lastWrite = off;
      cell.writes = (cell.writes || 0) + 1;
    } else {
      if (lv.index) throw new _E.FlowError(`"${nm}" non è un array`);
      cell.value = this.coerceTo(val, cell.type, `il valore assegnato a "${nm}"`);
      cell.writes = (cell.writes || 0) + 1;
    }
  }
}

if (typeof module !== 'undefined') module.exports = { Interpreter };
