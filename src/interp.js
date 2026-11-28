/* ==========================================================================
   FlowLab — interpreter
   Runs the model as a generator: each statement produces an event
   ('stmt', 'input', 'break') so the interface can run at variable
   speed, step by step, highlight the current block and ask for input.
   ========================================================================== */
'use strict';
if (typeof L === 'undefined' && typeof require !== 'undefined') require('./i18n.js'); // testi tradotti (in Node: italiano)

const _E = (typeof module !== 'undefined') ? require('./expr.js') : ExprLib;
const _M = (typeof module !== 'undefined') ? require('./model.js') : ModelLib;

class Interpreter {
  constructor(prog, env) {
    this.prog = prog;
    this.env = env;
    this.stack = [];
    this.maxDepth = 1000;
    this.cache = new Map(); // expressions already parsed
    this.funcs = new Map();
    for (const f of prog.functions) this.funcs.set(f.name, f);
    // object-oriented programming: classes, methods and constructors by class
    this.oo = _M.hasClasses(prog);
    this.objCount = 0; // unique number of each object (internal use)
    this.classCount = new Map(); // numbering shown: progressive per class, Circle#1, Circle#2…
    this.statics = new Map(); // class id -> Map(lowercase name -> cell)
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
    // Objects view: functions of the modules with only functions, callable from every class
    this.globals = _M.globalFuncs(prog);
    // predefined exceptions: classes available also in the Functions view
    for (const c of _M.EXC_CLASSES) if (!this.byName.has(c.name.toLowerCase())) { this.byName.set(c.name.toLowerCase(), c); this.methods.set(c.id, []); this.ctors.set(c.id, []); }
    // type parameters of the classes and of the generic functions
    this.tparamNames = new Set([...(prog.classes || []).flatMap((c) => c.tparams || []), ...prog.functions.flatMap((f) => f.tparams || [])].map((t) => t.toLowerCase()));
    const self = this;
    this.ctx = {
      getVar: (name, node) => self.getVar(name, node),
      hasUser: (name) => self.hasUser(name),
      callUser: (name, args, node) => self.callUser(name, args, node, false),
      cellOf: (node) => self.cellOf(node),
      oo: (node) => self.ooEval(node),
      env: {
        eof: (node) => env.eof(node),
      },
    };
  }

  /* ----------------------------- classes --------------------------------- */
  classById(id) { return this.oo ? this.prog.classes.find((c) => c.id === id) || null : null; }
  parentOf(c) { return c && c.parent ? this.byName.get(c.parent.toLowerCase()) || null : null; }
  chain(c) { const out = []; while (c && !out.includes(c)) { out.push(c); c = this.parentOf(c); } return out; }
  isA(c, of) { return this.chain(c).includes(of); }
  /* ---- generics: an object of a generic class has its type arguments (obj.targs) ---- */
  /* type with the parameters replaced by those of the object: "T" -> "Integer" for an ArrayList<Integer> */
  resolve(type, obj) {
    const m = this.tmapOf(obj);
    return m ? _E.substType(type, m) : type;
  }
  /* meaning of the Generic Types in a context: an object (its type arguments), a generic call, or an object seen as one of
     its parent classes (viewAs): the types written in a method of Lista<T> run on an object Pila<Integer> */
  tmapOf(ctx) {
    if (!ctx) return null;
    if (ctx.view) {
      const P = ctx.as, cm = _M.chainMap(this.prog, ctx.view.cls).get(P.id) || {}, base = this.tmapOf(ctx.view), out = {};
      for (const p of P.tparams || []) { const t = cm[p.toLowerCase()] !== undefined ? cm[p.toLowerCase()] : p; out[p.toLowerCase()] = base ? _E.substType(t, base) : t; }
      return out;
    }
    if (!ctx.targs || !ctx.cls || !(ctx.cls.tparams || []).length) return null;
    if (!ctx._tmap) { ctx._tmap = {}; ctx.cls.tparams.forEach((p, i) => { ctx._tmap[p.toLowerCase()] = ctx.targs[i]; }); }
    return ctx._tmap;
  }
  /* the object seen from the class P it inherits from (for the Generic Types of P) */
  viewAs(obj, P) {
    if (!obj || !P || !obj.cls || obj.view || obj.cls === P || !(P.tparams || []).length || !this.isA(obj.cls, P)) return obj;
    return { view: obj, as: P, cls: P };
  }
  /* type arguments of the object as class P (null if not known yet) */
  targsAs(obj, P) {
    if (obj.cls === P) return obj.targs || null;
    const m = this.tmapOf(this.viewAs(obj, P)); if (!m) return null;
    const out = (P.tparams || []).map((p) => m[p.toLowerCase()]);
    return out.some((t) => this.unresolved(t)) ? null : out;
  }
  /* type parameter not known yet (object created without giving the type) */
  unresolved(t) { return !!this.tparamNames && this.tparamNames.has(_E.splitType(t).base.toLowerCase()); }
  /* conversion for assignments and parameters; ctx = object that gives the meaning to T (usually this) */
  coerceTo(val, type, what, ctx) {
    const t = this.resolve(type, ctx === undefined ? (this.frame ? this.frame.tctx : null) : ctx);
    if (this.unresolved(t)) return val;
    const isA = (oc, tn) => { const k = this.byName.get(String(tn).toLowerCase()); return !!k && this.isA(oc, k); };
    const g = _E.splitType(t);
    if (!g.args.length) return _E.coerce(val, t, what, isA);
    const v = _E.coerce(val, g.base, what, isA);
    const o = v.v;
    const B = o && this.byName.get(g.base.toLowerCase());
    if (o && B && o.cls !== B && (B.tparams || []).length) {
      // object of a subclass in a variable of the generic parent class: Lista<Integer> l <- new Pila<Integer>()
      const cm = _M.chainMap(this.prog, o.cls).get(B.id) || {};
      if (!o.targs && (o.cls.tparams || []).length && !g.args.some((a) => this.unresolved(a))) {
        // new Pila<>(): the Generic Types of Pila are derived from those of the parent class, where it passes them on
        const ta = o.cls.tparams.map(() => null);
        B.tparams.forEach((p, i) => { const k = o.cls.tparams.findIndex((x) => x.toLowerCase() === String(cm[p.toLowerCase()] || '').toLowerCase()); if (k >= 0) ta[k] = g.args[i]; });
        if (ta.every((x) => x)) { o.targs = ta; delete o._tmap; }
      }
      const have = this.targsAs(o, B);
      if (have && g.args.some((a, i) => !this.unresolved(a) && !_E.sameType(a, have[i]))) throw new _E.FlowError(L('run.incompatibleTypesIsAButIs', { value: what || L('expr.theValue'), joinType: _E.typeName(_E.joinType(B.name, have)), t: _E.typeName(t) }));
      return v;
    }
    if (o && (o.cls.tparams || []).length) {
      if (!o.targs) { if (!g.args.some((a) => this.unresolved(a))) { o.targs = g.args.slice(); delete o._tmap; } } // new C<>(): the type is derived from the variable
      else if (g.args.some((a, i) => !this.unresolved(a) && !_E.sameType(a, o.targs[i]))) throw new _E.FlowError(L('run.incompatibleTypesIsAButIs', { value: what || L('expr.theValue'), joinType: _E.typeName(_E.joinType(o.cls.name, o.targs)), t: _E.typeName(t) }));
    }
    return v;
  }
  /* type to show for a cell (T replaced, if known) */
  cellType(cell) { return this.resolve(cell.type, cell.ctx); }
  /* attribute looked up in the class and in the parent classes: { attr, owner } */
  fieldLookup(c, low) {
    for (const k of this.chain(c)) { const a = k.attributes.find((x) => x.name.toLowerCase() === low); if (a) return { attr: a, owner: k }; }
    return null;
  }
  /* methods with that name, from the most derived: one version per signature (override) */
  methodCands(c, low) {
    const out = [], seen = new Set(), cms = _M.chainMap(this.prog, c);
    for (const k of this.chain(c)) {
      for (const f of this.methods.get(k.id) || []) {
        if (f.name.toLowerCase() !== low) continue;
        // the types of a parent class written with those of c: add(x: T) of Lista<T> is overridden by add(x: Integer) of ListaInteri
        const cm = cms.get(k.id);
        const sig = f.params.map((p) => _M.substT(p.type, cm).toLowerCase().replace(/\s+/g, '') + (p.array ? '[' + (p.dims || 1) : '')).join(',');
        if (seen.has(sig)) continue;
        seen.add(sig); out.push(f);
      }
    }
    return out;
  }
  checkAccess(vis, owner, what, name) {
    if (!vis || vis === 'public') return;
    const from = this.frame && this.frame.cls;
    if (vis === 'private' && from !== owner) throw new _E.FlowError(L('run.ofIsPrivateItCanBe', { what, name, name2: owner.name, name3: owner.name }));
    if (vis === 'protected' && !(from && this.isA(from, owner))) throw new _E.FlowError(L('run.ofIsProtectedItCanBe', { what, name, name2: owner.name, name3: owner.name }));
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
    return L('run.theExpression');
  }
  defaultOf(t) {
    if (this.unresolved(t)) return undefined;
    switch (t) {
      case 'Integer': return _E.V.int(0);
      case 'Real': return _E.V.real(0);
      case 'String': return _E.V.str('');
      case 'Boolean': return _E.V.bool(false);
    }
    return _E.V.obj(null);
  }
  /* does the type exist? cls = class in which it is used, fn = function (for type parameters like T) */
  checkType(t, cls, fn) {
    if (!this.oo) return;
    const g = _E.splitType(t);
    if (fn === undefined) fn = this.frame && this.frame.func;
    if (!g.args.length && (_E.isBaseType(g.base) || _M.isTypeParam(cls, g.base) || _M.isTypeParam(fn, g.base))) return;
    const c = this.byName.get(g.base.toLowerCase());
    if (!c) throw new _E.FlowError(L('run.theTypeDoesNotExistCreate', { t: _E.typeName(t), base: g.base }));
    const np = (c.tparams || []).length;
    if (np !== g.args.length) {
      if (np && !g.args.length) throw new _E.FlowError(L('run.hasGenericTypesSpecifyTheTypes', { name: c.name, name2: c.name, list: c.tparams.map(() => L('expr.integer')).join(', ') }));
      if (!np) throw new _E.FlowError(L('run.hasNoGenericTypesItIs', { name: c.name }));
      throw new _E.FlowError(L('run.wantsTypesBetween', { c: _M.classTitle(c), np }));
    }
    for (const a of g.args) this.checkType(a, cls, fn);
  }
  /* runs fn in a "service" call to initialize the attributes of a class */
  *withInit(c, obj, fn) {
    const frame = { func: { id: 'init:' + c.id, name: c.name + L('run.attributes'), params: [], body: [] }, vars: new Map(), depth: this.stack.length, cls: c, self: obj, tctx: this.viewAs(obj, c), executed: 0, init: true };
    this.stack.push(frame);
    try { return yield* fn(); } finally { this.stack.pop(); }
  }
  /* cell of an attribute: initial value as in Java (0, "", false, null) or the one given */
  *attrCell(a, owner) {
    this.checkType(a.type, owner);
    const self = a.static ? null : this.frame.self;
    const cell = { name: a.name, type: a.type, array: !!a.array, field: true, owner, visibility: a.visibility, static: !!a.static, ctx: this.viewAs(self, owner) };
    const dt = this.resolve(a.type, cell.ctx);
    try {
      if (a.array) {
        const dims = [];
        for (const part of _E.splitTop(a.size)) {
          const sv = yield* _E.evalE(this.parse(part, 'e'), this.ctx);
          if (sv.t !== 'Integer' || sv.v < 0) throw new _E.FlowError(L('run.theDimensionMustBeANon'));
          dims.push(sv.v);
        }
        const n = dims.reduce((x, y) => x * y, 1);
        if (n > 1e7) throw new _E.FlowError(L('run.arrayTooLarge'));
        cell.dims = dims; cell.items = new Array(n).fill(this.defaultOf(dt));
      } else {
        cell.value = this.defaultOf(dt);
        if (a.readonly) cell.readonly = true; // message of the exceptions: set only when creating them
        if (String(a.init || '').trim()) cell.value = this.coerceTo(yield* _E.evalE(this.parse(a.init, 'e'), this.ctx), a.type, L('run.theInitialValueOf', { name: owner.name, name2: a.name }));
      }
    } catch (e) {
      if (e instanceof _E.FlowError && !e.attrDone) { e.message = L('run.attribute', { name: owner.name, name2: a.name, message: e.message }); e.attrDone = true; }
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
    if (!cell) throw new _E.FlowError(L('run.theStaticAttributeIsNotInitialized', { name: owner.name, name2: attr.name }));
    return cell;
  }
  /* attribute used with its name alone inside a method (like this.x in Java) */
  implicitField(low, node) {
    const fr = this.frame;
    if (!fr.cls) return null;
    const hit = this.fieldLookup(fr.self ? fr.self.cls : fr.cls, low) || this.fieldLookup(fr.cls, low);
    if (!hit) return null;
    this.checkAccess(hit.attr.visibility, hit.owner, L('run.theAttribute'), hit.attr.name);
    if (hit.attr.static) return this.staticCell(hit.owner, hit.attr);
    if (!fr.self) throw new _E.FlowError(L('run.isAnInstanceAttributeInA', { name: hit.attr.name }), { node });
    return fr.self.fields.get(low);
  }
  isVarName(name) {
    const low = name.toLowerCase(), fr = this.frame;
    if (fr.vars.has(low)) return true;
    return !!(fr.cls && (this.fieldLookup(fr.self ? fr.self.cls : fr.cls, low) || this.fieldLookup(fr.cls, low)));
  }
  /* target to the left of the dot: an object or a class (static access) */
  *target(objNode) {
    const o = objNode.k === 'par' ? objNode.e : objNode;
    if (o.k === 'super') {
      if (!this.frame.self) throw new _E.FlowError(L('run.superIsUsedInNonStatic'));
      return { obj: this.frame.self };
    }
    if (o.k === 'var' && !o.indices && !this.isVarName(o.name) && this.byName.has(o.name.toLowerCase())) return { cls: this.byName.get(o.name.toLowerCase()) };
    const v = yield* _E.evalE(objNode, this.ctx);
    if (v.t !== 'Object') throw new _E.FlowError(L('run.isNotAnObjectItIs', { label: this.label(objNode), t: _E.typeName(v.t) }), { node: objNode });
    if (v.v === null) throw new _E.FlowError(L('run.isNullItDoesNotRefer', { label: this.label(objNode) }), { node: objNode, exc: 'NullReference' });
    return { obj: v.v };
  }
  fieldCell(tg, name, node) {
    const low = name.toLowerCase();
    if (tg.cls) {
      const hit = this.fieldLookup(tg.cls, low);
      if (!hit) throw new _E.FlowError(L('run.theClassHasNoAttribute', { name: tg.cls.name, name2: name }), { node });
      if (!hit.attr.static) throw new _E.FlowError(L('run.isAnInstanceAttributeOfAn', { name: hit.attr.name, name2: hit.owner.name, name3: hit.attr.name }), { node });
      this.checkAccess(hit.attr.visibility, hit.owner, L('run.theAttribute'), hit.attr.name);
      return this.staticCell(hit.owner, hit.attr);
    }
    const hit = this.fieldLookup(tg.obj.cls, low);
    if (!hit) {
      const isMethod = this.methodCands(tg.obj.cls, low).length;
      throw new _E.FlowError(isMethod ? L('run.isAMethodOfToCall', { name, name2: tg.obj.cls.name, name3: name }) : L('run.objectsHaveNoAttribute', { name: tg.obj.cls.name, name2: name }), { node });
    }
    this.checkAccess(hit.attr.visibility, hit.owner, L('run.theAttribute'), hit.attr.name);
    return hit.attr.static ? this.staticCell(hit.owner, hit.attr) : tg.obj.fields.get(low);
  }
  /* cell given by a variable or by an attribute (p.x, this.v) */
  *cellOf(lv) {
    if (lv.k === 'var') return this.getVar(lv.name, lv);
    if (lv.k === 'member') return this.fieldCell(yield* this.target(lv.obj), lv.name, lv);
    throw new _E.FlowError(L('run.aVariableOrAnAttributeIs'));
  }
  *readCell(cell, node) {
    const nm = this.label(node).replace(/\[…\]$/, '');
    if (cell.array) {
      if (!node.indices) throw new _E.FlowError(L('expr.isAnArrayAnIndexIs', { name: nm, name2: nm, list: (cell.dims || [0]).map(() => 0).join(', ') }), { node });
      const ivs = [];
      for (const ix of node.indices) ivs.push(yield* _E.evalE(ix, this.ctx));
      const item = cell.items[_E.arrOffset(ivs, cell, { name: nm })];
      if (item === undefined) throw new _E.FlowError(L('expr.theElementHasNoValueYet', { name: nm, list: ivs.map((x) => x.v).join(', ') }), { node });
      return item;
    }
    if (node.indices) throw new _E.FlowError(L('expr.isNotAnArray', { name: nm }), { node });
    if (cell.value === undefined) throw new _E.FlowError(L('run.hasNoValueYet', { nm }), { node });
    return cell.value;
  }
  /* is the class an exception (Exception or one of its subclasses)? */
  isExc(c) { return !!c && this.isA(c, this.byName.get('exception')); }
  *ooEval(node) {
    if (!this.oo) {
      // Functions view: of the objects only the exceptions are used, new Exception("…") and e.message
      if (node.k === 'new' && this.isExc(this.byName.get(node.cls.toLowerCase()))) return yield* this.construct(node);
      if (node.k === 'member') { const tg = yield* this.target(node.obj); if (tg.obj && this.isExc(tg.obj.cls)) return yield* this.readCell(this.fieldCell(tg, node.name, node), node); }
      throw new _E.FlowError(L('run.objectsNewAndThisAreUsed'), { node });
    }
    switch (node.k) {
      case 'this':
        if (!this.frame.self) throw new _E.FlowError(L('run.thisIsUsedOnlyInNon'), { node });
        return _E.V.obj(this.frame.self);
      case 'new': return yield* this.construct(node);
      case 'member': return yield* this.readCell(yield* this.cellOf(node), node);
      case 'mcall': return yield* this.mcall(node, {});
    }
    throw new _E.FlowError(L('expr.unrecognizedExpression'));
  }

  /* ------------------------- arguments and calls ------------------------ */
  /* evaluates the arguments only once: arrays pass as a reference to the cell */
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
  /* overloading: chooses the version best suited to the arguments */
  pick(cands, pre, name, node, self) {
    if (cands.length === 1) return cands[0];
    const score = (f) => {
      if (f.params.length !== pre.length) return -1;
      let tot = 0;
      for (let i = 0; i < pre.length; i++) {
        const p = f.params[i], a = pre[i];
        const pt = this.resolve(p.type, this.viewAs(self, this.classById(f.cls)));
        if (p.array) {
          if (!a.cell || (a.cell.dims || [0]).length !== (p.dims || 1)) return -1;
          const at = this.cellType(a.cell);
          if (!this.unresolved(pt) && !this.unresolved(at) && !_E.sameType(at, pt)) return -1;
          tot += 3; continue;
        }
        if (a.cell) return -1;
        const v = a.val;
        if (this.unresolved(pt)) { tot += 2; continue; }
        if (_E.isBaseType(pt)) {
          if (v.t === pt) tot += 3;
          else if (pt === 'Real' && v.t === 'Integer') tot += 2;
          else if (pt === 'Integer' && v.t === 'Real') tot += 1;
          else return -1;
        } else {
          const t = this.byName.get(_E.splitType(pt).base.toLowerCase());
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
    const got = pre.map((a) => (a.cell ? L('run.arrayOf', { type: _E.typeName(a.cell.type) }) : a.val.t === 'Object' ? (a.val.v ? a.val.v.cls.name : 'null') : _E.typeName(a.val.t))).join(', ');
    const vers = cands.map((f) => `${f.name}(${f.params.map((p) => _E.typeName(this.resolve(p.type, this.viewAs(self, this.classById(f.cls)))) + (p.array ? '[]' : '')).join(', ')})`).join(' · ');
    throw new _E.FlowError(L('run.noVersionOfAcceptsTheseArguments', { name, value: got || L('run.none'), vers }), { node });
  }
  bindArgs(func, pre, node, self) {
    const args = [];
    for (let i = 0; i < pre.length; i++) {
      const p = func.params[i], a = pre[i];
      if (p.array) {
        const inner = a.node.k === 'par' ? a.node.e : a.node;
        if (!a.cell) {
          if (inner.k === 'var' && !inner.index) throw new _E.FlowError(L('run.isNotAnArrayButExpects', { name: inner.name, name2: func.name }), { node });
          throw new _E.FlowError(L('run.theParameterOfIsAnArray', { name: p.name, name2: func.name }), { node });
        }
        const cell = a.cell;
        const ct = this.cellType(cell), pt = this.resolve(p.type, self);
        if (!this.unresolved(ct) && !this.unresolved(pt) && !_E.sameType(ct, pt)) throw new _E.FlowError(L('run.theArrayIsOfTypeBut', { name: cell.name, ct: _E.typeName(ct), name2: p.name, pt: _E.typeName(pt) }), { node });
        const nd = (cell.dims || [0]).length, pd = p.dims || 1;
        if (nd !== pd) throw new _E.FlowError(L('run.theArrayHasButTheParameter', { name: cell.name, nd, text: nd === 1 ? L('expr.dimension') : L('expr.dimensions'), name2: p.name, pd }), { node });
        args.push(cell);
      } else {
        if (a.cell) throw new _E.FlowError(L('run.isAnArrayTheParameterOf', { name: a.cell.name, name2: p.name, name3: func.name }), { node });
        args.push(this.coerceTo(a.val, p.type, L('run.theArgumentOf', { name: p.name, name2: func.name }), self));
      }
    }
    return args;
  }
  /* use of the returned value: an expression needs one value, a, b ← f() needs as many as the variables */
  checkRetUse(func, opts, node) {
    const nr = _M.rets(func).length;
    if (opts.allowMulti) {
      if (nr !== opts.allowMulti) throw new _E.FlowError(L('run.returnsButOnTheLeftThere', { name: func.name, nr, text: nr === 1 ? L('run.value') : L('run.values'), allowMulti: opts.allowMulti }), { node });
      return;
    }
    if (opts.asStatement) return;
    if (nr === 1 && _M.rets(func)[0].array && !opts.allowArray) throw new _E.FlowError(L('run.returnsAnArrayItIsUsed', { name: func.name, name2: func.name }), { node });
    if (nr === 0) throw new _E.FlowError(L('run.doesNotReturnAnyValueIt', { text: func.ctor ? L('run.theConstructor') : L('run.theFunction'), name: func.name }), { node });
    if (nr > 1) {
      const ph = _M.rets(func).map((r) => r.name).join(', ');
      throw new _E.FlowError(L('run.theFunctionReturnsValuesItMust', { name: func.name, nr, nr2: nr, ph, name2: func.name }), { node });
    }
  }
  *callCands(cands, name, argNodes, node, opts) {
    if (cands.length === 1) {
      const f = cands[0];
      this.checkRetUse(f, opts, node);
      if (argNodes.length !== f.params.length) throw new _E.FlowError(L('expr.requiresArgumentsWerePassed', { value: f.name, sigCount: f.params.length, argsCount: argNodes.length }), { node });
    }
    const pre = yield* this.prepArgs(argNodes);
    const f = this.pick(cands, pre, name, node, opts.self);
    this.checkRetUse(f, opts, node);
    if (f.abstract) throw new _E.FlowError(L('run.isAnAbstractMethodOfIt', { name: f.name, name2: this.classById(f.cls).name }), { node });
    let self = null;
    if (this.oo && f.cls) { // (a function of a module belongs to no class: it is called without an object)
      const owner = this.classById(f.cls);
      this.checkAccess(f.visibility, owner, L('run.theMethod'), f.name);
      if (!f.static) {
        if (!opts.self) throw new _E.FlowError(opts.viaClass ? L('run.isNotAStaticMethodAn', { name: f.name, name2: f.name }) : L('run.fromAStaticMethodYouCannot', { name: f.name }), { node });
        self = opts.self;
      }
    }
    // generic function: T is derived from the arguments
    const tctx = (f.tparams || []).length ? this.inferTargs(f, pre, node, self) : this.viewAs(self, this.classById(f.cls));
    return yield* this.invoke(f, this.bindArgs(f, pre, node, tctx), node, { self, tctx });
  }
  /* type of a value, to deduce T: Integer, Real, Person, ArrayList<Integer>… (null if unknown) */
  valType(v) {
    if (!v) return null;
    if (v.t !== 'Object') return v.t;
    if (!v.v) return null;
    return v.v.targs ? _E.joinType(v.v.cls.name, v.v.targs) : (v.v.cls.tparams || []).length ? null : v.v.cls.name;
  }
  /* generic functions: compares the types of the parameters with those of the arguments and finds T.
     Returns the type context of the call (like an object with its type arguments) */
  inferTargs(f, pre, node, self) {
    const tp = f.tparams, low = tp.map((t) => t.toLowerCase()), map = {};
    const unify = (pt, at, p) => {
      if (!at || this.unresolved(at)) return;
      const gp = _E.splitType(pt), ga = _E.splitType(at), k = gp.base.toLowerCase();
      const i = gp.args.length ? -1 : low.indexOf(k);
      if (i >= 0) {
        const prev = map[k];
        if (prev === undefined || _E.sameType(prev, at)) { map[k] = at; return; }
        // objects of related classes: the parent class counts
        const a = this.byName.get(String(prev).toLowerCase()), b = this.byName.get(String(at).toLowerCase());
        if (a && b && this.isA(b, a)) return;
        if (a && b && this.isA(a, b)) { map[k] = at; return; }
        throw new _E.FlowError(L('run.theGenericTypeCannotBeBoth', { name: f.name, value: tp[i], prev: _E.typeName(prev), at: _E.typeName(at), name2: p.name }), { node });
      }
      if (gp.args.length && ga.args.length === gp.args.length) gp.args.forEach((x, j) => unify(x, ga.args[j], p));
    };
    f.params.forEach((p, i) => {
      const a = pre[i];
      if (!a) return;
      if (p.array) { if (a.cell) unify(p.type, this.cellType(a.cell), p); } else if (!a.cell) unify(p.type, this.valType(a.val), p);
    });
    const names = [], args = [];
    // a generic method of a generic object also sees the T of the class
    const sv = self && this.tmapOf(this.viewAs(self, this.classById(f.cls)));
    if (sv) for (const p of this.classById(f.cls).tparams || []) { names.push(p); args.push(sv[p.toLowerCase()]); }
    tp.forEach((t, i) => { names.push(t); args.push(map[low[i]] !== undefined ? map[low[i]] : t); });
    return { cls: { tparams: names }, targs: args, generic: f };
  }
  *mcall(node, opts) {
    const low = node.name.toLowerCase();
    let cands, self = null, cls, viaClass = false;
    if (node.obj.k === 'super') {
      const fr = this.frame;
      cls = this.parentOf(fr.cls);
      if (!cls) throw new _E.FlowError(L('run.hasNoParentClassSuperCannot', { text: fr.cls ? fr.cls.name : L('run.thisClass') }), { node });
      if (!fr.self) throw new _E.FlowError(L('run.superMethodIsUsedInNon'), { node });
      self = fr.self;
    } else {
      const tg = yield* this.target(node.obj);
      if (tg.cls) { cls = tg.cls; viaClass = true; } else { cls = tg.obj.cls; self = tg.obj; }
    }
    cands = this.methodCands(cls, low);
    if (!cands.length) {
      const isField = this.fieldLookup(cls, low);
      throw new _E.FlowError(isField ? L('run.isAnAttributeOfNotA', { name: node.name, name2: cls.name }) : L('run.theClassHasNoMethod', { name: cls.name, name2: node.name }), { node });
    }
    return yield* this.callCands(cands, node.name, node.args, node, { ...opts, self, viaClass });
  }
  /* new Class(...): attributes with the initial values, then the constructor */
  *construct(node) {
    const cls = this.byName.get(node.cls.toLowerCase());
    if (!cls) throw new _E.FlowError(L('run.theClassDoesNotExist', { cls: node.cls }), { node });
    if (cls.abstract) {
      const subs = this.prog.classes.filter((k) => k !== cls && !k.abstract && this.isA(k, cls)).map((k) => k.name);
      throw new _E.FlowError(L('run.isAnAbstractClassObjectsCannot', { name: cls.name, name2: cls.name, text: subs.length ? L('run.createAnObjectOfASubclass', { list: subs.join(', ') }) : '' }), { node });
    }
    const missing = _M.missingAbstract(this.prog, cls);
    if (missing.length) throw new _E.FlowError(L('run.doesNotDefineOfDefineIt', { name: cls.name, list: missing.map((m) => m.f.name + '()').join(', '), text: missing.length === 1 ? L('run.abstractMethod') : L('run.abstractMethods'), list2: [...new Set(missing.map((m) => m.owner.name))].join(', '), text2: missing.length === 1 ? 'lo' : 'li', name2: cls.name, name3: cls.name }), { node });
    // type arguments: new ArrayList<Integer>() (inside a generic class also new Node<T>(x))
    let targs = null;
    const np = (cls.tparams || []).length;
    if (node.targs && node.targs.length) {
      if (!np) throw new _E.FlowError(L('run.hasNoGenericTypesItIs2', { name: cls.name, name2: cls.name }), { node });
      if (node.targs.length !== np) throw new _E.FlowError(L('run.wantsTypesBetween', { c: _M.classTitle(cls), np }), { node });
      targs = node.targs.map((t) => this.resolve(t, this.frame.tctx));
      for (const t of targs) this.checkType(t, this.frame.cls);
      if (targs.some((t) => this.unresolved(t))) targs = null;
    }
    const n = (this.classCount.get(cls.id) || 0) + 1;
    this.classCount.set(cls.id, n);
    const obj = { id: n, uid: ++this.objCount, cls, fields: new Map(), targs };
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
    // predefined exception: new Exception() or new Exception("message"), also as super("message")
    if (cls.builtin) {
      if (argNodes.length > 1) throw new _E.FlowError(L('run.isCreatedWithTheMessageNew', { name: cls.name, name2: cls.name }), { node });
      const v = argNodes.length ? yield* _E.evalE(argNodes[0], this.ctx) : _E.V.str('');
      obj.fields.get('message').value = this.coerceTo(v, 'String', L('run.theMessageOf', { name: cls.name }), null);
      return;
    }
    const ctors = this.ctors.get(cls.id) || [];
    if (!ctors.length) {
      if (argNodes.length) throw new _E.FlowError(L('run.hasNoConstructorsWithParametersIt', { name: cls.name, name2: cls.name }), { node });
      const parent = this.parentOf(cls);
      if (parent) yield* this.runCtor(parent, [], obj, node);
      return;
    }
    let cands = ctors;
    if (ctors.length > 1 || ctors[0].params.length !== argNodes.length) {
      cands = ctors.filter((f) => f.params.length === argNodes.length);
      if (!cands.length) {
        const vers = ctors.map((f) => `${cls.name}(${f.params.map((p) => _E.typeName(p.type) + (p.array ? '[]' : '')).join(', ')})`).join(' · ');
        throw new _E.FlowError(L('run.hasNoConstructorWithAvailableConstructors', { name: cls.name, argNodesCount: argNodes.length, text: argNodes.length === 1 ? L('run.argument') : L('run.arguments'), vers }), { node });
      }
    }
    const pre = yield* this.prepArgs(argNodes);
    const f = this.pick(cands, pre, cls.name, node, obj);
    this.checkAccess(f.visibility, cls, L('run.theConstructor'), cls.name);
    yield* this.invoke(f, this.bindArgs(f, pre, node, obj), node, { self: obj });
  }
  /* is the first executable block of the constructor super(...)? */
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
    const fr = this.frame; if (!fr) return false;
    const low = name.toLowerCase();
    // without an object, the name of a built-in function always means the built-in function
    if (_E.BUILTINS[low] && !_E.BUILTINS[low].soft) return false;
    if (this.globalCands(low).length) return true;
    if (!fr.cls) return false;
    return this.methodCands(fr.self ? fr.self.cls : fr.cls, low).length > 0 || this.methodCands(fr.cls, low).length > 0;
  }
  globalCands(low) { return this.globals.filter((f) => f.name.toLowerCase() === low);
  }

  findFunc(name) {
    if (this.funcs.has(name)) return this.funcs.get(name);
    const l = name.toLowerCase();
    for (const f of this.prog.functions) if (f.name.toLowerCase() === l) return f;
    return null;
  }

  get frame() { return this.stack[this.stack.length - 1]; }

  /* value of an expression in the current call, all at once (condition of a breakpoint marked on a block);
     functions called by the expression run without steps */
  evalNow(src) {
    const g = _E.evalE(this.parse(src, 'e'), this.ctx);
    for (let r = g.next(); ; r = g.next()) {
      if (r.done) return r.value;
      if (r.value && r.value.type === 'input') throw new _E.FlowError(L('run.aBreakpointConditionCannotRead'));
    }
  }
  parse(src, what) {
    const key = what + '\u0000' + src;
    if (this.cache.has(key)) return this.cache.get(key);
    let r;
    try {
      r = what === 'lv' ? _E.parseLValue(src) : _E.parseExpr(src);
    } catch (e) {
      throw new _E.FlowError(L('run.syntaxErrorIn', { src, message: e.message }));
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
      if (this.byName.has(low)) throw new _E.FlowError(L('run.isAClassUseAttributeMethod', { name, name2: name, name3: name, name4: name }), { node });
      if (f.cls && this.methodCands(f.self ? f.self.cls : f.cls, low).length) throw new _E.FlowError(L('run.isAMethodToCallIt', { name, name2: name }), { node });
    } else if (this.findFunc(name)) throw new _E.FlowError(L('run.isAFunctionToCallIt', { name, name2: name }), { node });
    throw new _E.FlowError(L('run.theVariableHasNotBeenDeclared', { name }), { node });
  }

  *run() {
    const main = this.prog.functions[0];
    if (main.params.length) throw new _E.FlowError(L('run.theMainFunctionCannotHaveParameters'));
    if (this.oo) yield* this.initStatics();
    yield* this.invoke(main, [], null);
  }

  *invoke(func, args, node, opts) {
    if (this.stack.length >= this.maxDepth) throw new _E.FlowError(L('run.stackOverflowMoreThanNestedCalls', { maxDepth: this.maxDepth }), { node });
    const cls = this.oo ? this.classById(func.cls) : null;
    const self = (opts && opts.self) || null;
    const frame = { func, vars: new Map(), depth: this.stack.length, cls, self, tctx: (opts && opts.tctx) || self, executed: 0 };
    func.params.forEach((p, i) => {
      if (p.array) frame.vars.set(p.name.toLowerCase(), { name: p.name, type: p.type, array: true, dims: args[i].dims || [args[i].items.length], items: args[i].items, param: true, ctx: frame.tctx });
      else frame.vars.set(p.name.toLowerCase(), { name: p.name, type: p.type, array: false, value: args[i], param: true, ctx: frame.tctx });
    });
    this.stack.push(frame);
    yield { type: 'stmt', stmt: { id: 'start:' + func.id, kind: 'start' }, frame };
    if (func.ctor && cls && this.parentOf(cls) && !this.startsWithSuper(func)) {
      // as in Java: without an explicit super(...) the parameterless constructor of the parent class is called
      const parent = this.parentOf(cls);
      const pc = this.ctors.get(parent.id) || [];
      if (pc.length && !pc.some((f) => !f.params.length)) {
        this.stack.pop();
        throw new _E.FlowError(L('run.theConstructorOfMustStartWith', { name: cls.name, name2: parent.name }), { node, stmtId: 'start:' + func.id, funcId: func.id });
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
        let cell = frame.vars.get(r.name.toLowerCase());
        // a method can directly return an attribute of its class
        if (!cell && this.oo && r.name) { try { cell = this.implicitField(r.name.toLowerCase(), node); } catch (e) { cell = null; } }
        if (!r.name || !cell) {
          this.stack.pop();
          throw new _E.FlowError(L('run.theFunctionMustReturnButThis', { name: func.name, name2: r.name }), { node, stmtId: 'end:' + func.id });
        }
        // returned array: the caller receives the same array (as in Java)
        if (r.array || cell.array) {
          const bad = (msg) => { this.stack.pop(); return new _E.FlowError(msg, { node, stmtId: 'end:' + func.id }); };
          if (!cell.array) throw bad(L('run.theFunctionMustReturnAnArray', { name: func.name, name2: r.name }));
          if (!r.array) throw bad(L('run.isAnArrayToReturnIt', { name: r.name, name2: func.name }));
          const nd = (cell.dims || [0]).length;
          if (nd !== (r.dims || 1)) throw bad(L('run.hasButReturnsAnArrayWith', { name: r.name, nd, text: nd === 1 ? L('expr.dimension') : L('expr.dimensions'), name2: func.name, value: r.dims || 1 }));
          const ct = this.cellType(cell), rt = this.resolve(r.type, frame.tctx);
          if (!this.unresolved(ct) && !this.unresolved(rt) && !_E.sameType(ct, rt)) throw bad(L('run.isAnArrayOfButReturns', { name: r.name, ct: _E.typeName(ct), name2: func.name, rt: _E.typeName(rt) }));
          vals.push({ t: 'ArrRef', cell: { name: r.name, type: rt, ctx: null, items: cell.items, dims: (cell.dims || [cell.items.length]).slice() } });
          continue;
        }
        if (cell.value === undefined) {
          this.stack.pop();
          throw new _E.FlowError(L('run.theFunctionEndsWithoutAssigningA', { name: func.name, name2: r.name }), { node, stmtId: 'end:' + func.id });
        }
        vals.push(this.coerceTo(cell.value, r.type, L('run.theReturnValue', { name: r.name })));
      }
      ret = rs.length === 1 ? vals[0] : { t: 'Tuple', items: vals };
    }
    this.stack.pop();
    return ret;
  }

  *callUser(name, argNodes, node, asStatement, allowMulti, allowArray) {
    let cands, self = null;
    if (!this.oo) cands = [this.findFunc(name)];
    else {
      const fr = this.frame, low = name.toLowerCase();
      cands = fr.cls ? this.methodCands(fr.self ? fr.self.cls : fr.cls, low) : [];
      if (!cands.length && fr.cls) cands = this.methodCands(fr.cls, low);
      self = fr.self;
      // a function of a module: from every class, without an object
      if (!cands.length) { cands = this.globalCands(low); self = null; }
    }
    return yield* this.callCands(cands, name, argNodes, node, { asStatement, allowMulti, allowArray, self });
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
      throw this.tag(new _E.FlowError(L('run.incompleteBlockDoubleClickToComplete')), s, frame);
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
        // initial values of an array: {1, 2, 3}; the size can be left out
        const lit = s.array && String(s.init || '').trim() ? _E.parseArrayLit(s.init) : null;
        if (s.array) {
          // one or more dimensions: "10" or "3, 4"
          dims = [];
          for (const part of String(s.size || '').trim() ? _E.splitTop(s.size) : []) {
            const sv = yield* ev(part);
            if (sv.t !== 'Integer') throw new _E.FlowError(L('run.theArraySizeMustBeAn', { value: _E.TYPE_IT[sv.t] }));
            if (sv.v < 0) throw new _E.FlowError(L('run.theArraySizeCannotBeNegative'));
            dims.push(sv.v);
          }
          if (lit && !dims.length) dims = lit.dims.slice();
          if (lit && (dims.length !== lit.dims.length || dims.some((d, k) => d !== lit.dims[k]))) throw new _E.FlowError(L('run.theValuesOfTheArrayAre', { values: lit.dims.join(' × '), size: dims.join(' × ') }));
          size = dims.reduce((a, b) => a * b, 1);
          if (size > 1e7) throw new _E.FlowError(L('run.arrayTooLargeAtMost10'));
        }
        this.checkType(s.type, frame.cls, frame.func);
        for (const n of names) {
          if (!_E.validIdent(n)) throw new _E.FlowError(L('run.isNotAValidVariableName', { n }));
          if (_E.RESERVED.has(n.toLowerCase())) throw new _E.FlowError(L('run.isAReservedWord', { n }));
          const key = n.toLowerCase();
          if (frame.vars.has(key) && frame.vars.get(key).constant) throw new _E.FlowError(L('run.theNameIsAlreadyUsedBy', { n, name: frame.vars.get(key).name }));
          if (frame.vars.has(key)) throw new _E.FlowError(frame.vars.get(key).name === n ? L('run.theVariableHasAlreadyBeenDeclared', { n }) : L('run.theVariableHasAlreadyBeenDeclared2', { n, name: frame.vars.get(key).name }));
          if (s.array) frame.vars.set(key, { name: n, type: s.type, array: true, dims: dims.slice(), items: new Array(size).fill(undefined), ctx: frame.tctx });
          else frame.vars.set(key, { name: n, type: s.type, array: false, value: undefined, ctx: frame.tctx });
        }
        // initial value: it applies to all the variables of the block
        if (!s.array && String(s.init || '').trim()) for (const n of names) yield* this.store({ k: 'var', name: n }, yield* ev(s.init));
        if (lit) for (const n of names) {
          const cell = frame.vars.get(n.toLowerCase());
          for (let k = 0; k < lit.leaves.length; k++) cell.items[k] = this.coerceTo(yield* ev(lit.leaves[k]), s.type, L('run.theValueOfInTheArray', { k: k + 1, n }), frame.tctx);
        }
        return;
      }
      case 'const': {
        yield { type: 'stmt', stmt: s, frame };
        const n = s.name.trim();
        if (!_E.validIdent(n)) throw new _E.FlowError(L('run.isNotAValidNameFor', { n }));
        if (_E.RESERVED.has(n.toLowerCase())) throw new _E.FlowError(L('run.isAReservedWord', { n }));
        const key = n.toLowerCase();
        if (frame.vars.has(key)) throw new _E.FlowError(L('run.theNameIsAlreadyUsedBy2', { n, text: frame.vars.get(key).constant ? L('run.anotherConstant') : L('run.aVariable') }));
        const v = yield* ev(s.expression);
        frame.vars.set(key, { name: n, type: s.type, array: false, value: this.coerceTo(v, s.type, L('run.theValueOfTheConstant', { n })), constant: true, ctx: frame.tctx });
        return;
      }
      case 'assign': {
        yield { type: 'stmt', stmt: s, frame };
        const targets = _E.splitTop(s.variable);
        if (targets.length > 1) {
          // a, b, c ← function(...) : multiple assignment
          let e = this.parse(s.expression, 'e');
          while (e.k === 'par') e = e.e;
          if (!((e.k === 'call' && this.hasUser(e.name)) || e.k === 'mcall')) throw new _E.FlowError(L('run.toAssignSeveralVariablesTogetherThe'));
          const lvs = _E.parseLValueList(s.variable);
          const tup = e.k === 'call' ? yield* this.callUser(e.name, e.args, e, false, targets.length) : yield* this.mcall(e, { allowMulti: targets.length });
          for (let i = 0; i < lvs.length; i++) yield* this.store(lvs[i], tup.items[i]);
          return;
        }
        const lv = this.parse(s.variable, 'lv');
        // array ← otherArray: the array on the left becomes the same array (as in Java)
        let rx = this.parse(s.expression, 'e');
        while (rx.k === 'par') rx = rx.e;
        if (!lv.indices && (rx.k === 'var' || rx.k === 'member') && !rx.indices) {
          const tcell = yield* this.cellOf(lv);
          if (tcell.array) { yield* this.storeArray(tcell, lv, rx); return; }
        }
        // array ← function(...) that returns an array
        if (!lv.indices && ((rx.k === 'call' && this.hasUser(rx.name)) || rx.k === 'mcall')) {
          const tcell = yield* this.cellOf(lv);
          if (tcell.array) {
            const v = rx.k === 'call' ? yield* this.callUser(rx.name, rx.args, rx, false, undefined, true) : yield* this.mcall(rx, { allowArray: true });
            yield* this.store(lv, v);
            return;
          }
        }
        const val = yield* ev(s.expression);
        yield* this.store(lv, val);
        return;
      }
      case 'input': {
        yield { type: 'stmt', stmt: s, frame };
        const lv = this.parse(s.variable, 'lv');
        const cell = yield* this.cellOf(lv);
        if (cell.constant) throw new _E.FlowError(L('run.isAConstantANewValue', { name: cell.name }));
        if (cell.array && !lv.index) throw new _E.FlowError(L('run.isAnArraySpecifyTheElement', { name: lv.name, name2: lv.name }));
        // checks the index before asking for the value
        if (cell.array) { const ivs = []; for (const ix of lv.indices) ivs.push(yield* _E.evalE(ix, this.ctx)); _E.arrOffset(ivs, cell, lv); }
        for (;;) {
          const text = yield { type: 'input', stmt: s, frame, varType: cell.type, varName: s.variable };
          if (text === null || text === undefined) throw new _E.FlowError(L('run.inputCancelled'));
          try {
            const v = _E.parseInputText(text, cell.type);
            yield* this.store(lv, v);
            break;
          } catch (e) {
            env.output(e.message + L('run.tryAgain'), true, 'error');
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
        if (c.t !== 'Boolean') throw new _E.FlowError(L('run.theConditionMustBeTrueOr', { value: _E.TYPE_IT[c.t] }));
        yield { type: 'branch', stmt: s, frame, taken: c.v };
        yield* this.block(c.v ? s.then : s.else);
        return;
      }
      case 'while': {
        for (;;) {
          yield { type: 'stmt', stmt: s, frame };
          const c = yield* ev(s.expression);
          if (c.t !== 'Boolean') throw new _E.FlowError(L('run.theConditionMustBeTrueOr', { value: _E.TYPE_IT[c.t] }));
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
          if (c.t !== 'Boolean') throw new _E.FlowError(L('run.theConditionMustBeTrueOr', { value: _E.TYPE_IT[c.t] }));
          if (!c.v) break;
        }
        return;
      }
      case 'for': {
        yield { type: 'stmt', stmt: s, frame };
        const lv = this.parse(s.variable, 'lv');
        const cell = yield* this.cellOf(lv);
        if (cell.array && !lv.index) throw new _E.FlowError(L('run.theLoopVariableCannotBeAn', { name: lv.name }));
        if (cell.type !== 'Integer' && cell.type !== 'Real') throw new _E.FlowError(L('run.theLoopVariableMustBeNumeric', { name: lv.name }));
        const a = yield* ev(s.start), b = yield* ev(s.end);
        const st = yield* ev(String(s.step).trim() || '1');
        for (const [v, n] of [[a, L('run.start')], [b, L('run.end')], [st, L('run.step')]]) if (!_E.isNum(v)) throw new _E.FlowError(L('run.theValueOfTheLoopMust', { n }));
        if (st.v === 0) throw new _E.FlowError(L('run.theLoopStepCannotBeZero'));
        if (st.v < 0) throw new _E.FlowError(L('run.theStepMustBePositiveTo'));
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
          if (!frame.func.ctor) throw new _E.FlowError(L('run.superCanBeUsedOnlyIn'));
          if (frame.executed !== 1) throw new _E.FlowError(L('run.superMustBeTheFirstBlock'));
          const parent = this.parentOf(frame.cls);
          if (!parent) throw new _E.FlowError(L('run.hasNoParentClassSuperIs', { name: frame.cls.name }));
          yield* this.runCtor(parent, e.args, frame.self, e);
          return;
        }
        if (e.k === 'mcall') { yield* this.mcall(e, { asStatement: true }); return; }
        if (e.k === 'new') { yield* _E.evalE(e, this.ctx); return; }
        if (e.k !== 'call') throw new _E.FlowError(this.oo ? L('run.theCallBlockMustContainThe') : L('run.theCallBlockMustContainA'));
        if (this.hasUser(e.name)) yield* this.callUser(e.name, e.args, e, true);
        else yield* _E.evalE(e, this.ctx);
        return;
      }
      case 'breakpoint': {
        yield { type: 'stmt', stmt: s, frame };
        let hit = s.always;
        if (!hit) {
          const c = yield* ev(s.expression);
          if (c.t !== 'Boolean') throw new _E.FlowError(L('run.theBreakpointConditionMustBeBoolean'));
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
        try { v = _E.parseInputText(line, cell.type); } catch (e) { throw new _E.FlowError(L('run.readingFromFile', { message: e.message })); }
        yield* this.store(lv, v);
        return;
      }
      case 'write': {
        yield { type: 'stmt', stmt: s, frame };
        const v = yield* ev(s.expression);
        env.fileWrite(_E.fmtValue(v));
        return;
      }
      case 'throw': {
        yield { type: 'stmt', stmt: s, frame };
        const v = yield* ev(s.expression);
        if (v.t !== 'Object' || !v.v) throw new _E.FlowError(v.t === 'Object' ? L('run.throwTheExceptionIsNull') : L('run.throwWantsAnExceptionEG', { value: _E.TYPE_IT[v.t] || v.t }));
        if (!this.isExc(v.v.cls)) throw new _E.FlowError(L('run.throwIsNotAnExceptionAn', { name: v.v.cls.name }));
        throw this.excError(v.v);
      }
      case 'try': {
        yield { type: 'stmt', stmt: s, frame };
        const depth = this.stack.length;
        let pending = null, pendInfo = null;
        // exception arrived here: the functions called inside the Try are exited (lost: their names, for the cursor)
        const unwind = (e, obj) => { const lost = this.stack.slice(depth).filter((f) => !f.init).map((f) => f.func.name); this.stack.length = depth; return { type: obj.cls.name, lost }; };
        try {
          yield* this.block(s.body);
        } catch (e) {
          const obj = this.excOf(e);
          if (!obj) throw e; // error of the program, not an exception: everything stops
          const info = unwind(e, obj);
          const c = (s.catches || []).find((k) => { const t = this.byName.get(String(k.type).toLowerCase()); return t && this.isA(obj.cls, t); });
          if (!c) { pending = e; pendInfo = info; }
          else {
            const key = String(c.variable || 'e').toLowerCase(), old = frame.vars.get(key);
            if (old && !old.catchVar) throw this.tag(new _E.FlowError(L('run.catchTheVariableIsAlreadyUsed', { variable: c.variable })), s, frame);
            frame.vars.set(key, { name: c.variable, type: obj.cls.name, array: false, value: _E.V.obj(obj), catchVar: true, ctx: null });
            yield { type: 'stmt', stmt: { id: s.id + ':catch:' + c.id, kind: 'catch' }, frame, exc: info };
            try { yield* this.block(c.body); } catch (e2) {
              const o2 = this.excOf(e2);
              if (!o2) throw e2;
              pending = e2; pendInfo = unwind(e2, o2);
            }
          }
        }
        if (s.hasFinally) {
          // with a pending exception the cursor arrives with the red arrow; after the Finally the exception continues
          yield { type: 'stmt', stmt: { id: s.id + ':finally', kind: 'finally' }, frame, exc: pendInfo ? { ...pendInfo, pending: true } : undefined };
          yield* this.block(s.finally || []);
        }
        if (pending) throw pending;
        return;
      }
    }
  }

  /* ---- exceptions ---- */
  /* error carrying an exception thrown with Throw: if nobody catches it, the program stops with this message */
  excError(obj) {
    const msg = obj.fields.get('message').value.v;
    const where = this.stack.filter((f) => !f.init).map((f, i) => (i === 0 ? L('run.main') : f.func.name)).reverse();
    const e = new _E.FlowError(L('run.unhandledException', { name: obj.cls.name, text: msg ? ' — ' + msg : '', text2: where.length > 1 ? L('run.thrownInCalledFrom', { value: where[0], list: where.slice(1).join(' ← ') }) : '' }));
    e.thrown = obj;
    return e;
  }
  /* the exception carried by an error: thrown with Throw, or a runtime error (division by zero…).
     null for the errors of the program, which cannot be caught */
  excOf(e) {
    if (!(e instanceof _E.FlowError)) return null;
    if (e.thrown) return e.thrown;
    if (!e.exc) return null;
    const cls = this.byName.get(e.exc.toLowerCase());
    const n = (this.classCount.get(cls.id) || 0) + 1;
    this.classCount.set(cls.id, n);
    const obj = { id: n, uid: ++this.objCount, cls, fields: new Map([['message', { name: 'message', type: 'String', array: false, value: _E.V.str(e.message), field: true, owner: cls, visibility: 'public', readonly: true, ctx: null }]]), targs: null };
    e.thrown = obj;
    return obj;
  }
  *storeArray(tcell, lv, rx) {
    const nm = lv.k === 'var' ? lv.name : this.label(lv);
    const src = yield* this.cellOf(rx);
    if (!src.array) throw new _E.FlowError(L('run.isAnArrayTheRightSide', { nm, nm2: nm }));
    this.linkArray(tcell, nm, src, `"${this.label(rx)}"`);
  }
  /* the array on the left becomes the same array as src (as in Java) */
  linkArray(tcell, nm, src, what) {
    if (tcell.constant) throw new _E.FlowError(L('run.isAConstantItsValueCannot', { name: tcell.name }));
    const tt = this.cellType(tcell), st = this.cellType(src);
    if (!this.unresolved(tt) && !this.unresolved(st) && !_E.sameType(tt, st)) throw new _E.FlowError(L('run.incompatibleTypesIsAnArrayOf', { what, st: _E.typeName(st), nm, tt: _E.typeName(tt) }));
    const sd = src.dims || [src.items.length], td = tcell.dims || [tcell.items.length];
    if (sd.length !== td.length) throw new _E.FlowError(L('run.hasHas', { what, sdCount: sd.length, text: sd.length === 1 ? L('expr.dimension') : L('expr.dimensions'), nm, tdCount: td.length }));
    tcell.items = src.items; tcell.dims = sd.slice();
    tcell.lastWrite = undefined;
    tcell.writes = (tcell.writes || 0) + 1;
  }
  *store(lv, val) {
    const cell = yield* this.cellOf(lv);
    const nm = lv.k === 'var' ? lv.name : this.label(lv).replace(/\[…\]$/, '');
    if (cell.readonly) throw new _E.FlowError(L('run.ofAnExceptionCanOnlyBe', { name: cell.name }));
    if (cell.constant) throw new _E.FlowError(L('run.isAConstantItsValueCannot', { name: cell.name }));
    // array returned by a function
    if (val && val.t === 'ArrRef') {
      if (!cell.array || lv.index) throw new _E.FlowError(L('run.isNotAnArrayOnThe', { nm, type: _E.typeName(val.cell.type) }));
      this.linkArray(cell, nm, val.cell, L('run.theReturnValue2'));
      return;
    }
    if (cell.array) {
      if (!lv.index) throw new _E.FlowError(L('run.isAnArraySpecifyTheElement2', { nm, nm2: nm }));
      const ivs = [];
      for (const ix of lv.indices) ivs.push(yield* _E.evalE(ix, this.ctx));
      const off = _E.arrOffset(ivs, cell, { name: nm });
      cell.items[off] = this.coerceTo(val, cell.type, L('run.theValueAssignedTo', { nm, list: ivs.map((x) => x.v).join(', ') }), cell.ctx);
      cell.lastWrite = off;
      cell.writes = (cell.writes || 0) + 1;
    } else {
      if (lv.index) throw new _E.FlowError(L('expr.isNotAnArray', { name: nm }));
      cell.value = this.coerceTo(val, cell.type, L('run.theValueAssignedTo2', { nm }), cell.ctx);
      cell.writes = (cell.writes || 0) + 1;
    }
  }
}

if (typeof module !== 'undefined') module.exports = { Interpreter };
