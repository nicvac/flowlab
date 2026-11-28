/* ==========================================================================
   FlowLab — application (interface, editor, execution)
   ========================================================================== */
'use strict';

(() => {
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : k === 'title' || k === 'aria-label' ? I18n.keys(v) : v); // names of the keys in the chosen language
    }
    const isKey = tag === 'kbd' || /\bikey\b/.test((attrs && attrs.class) || '');
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(isKey ? I18n.keys(String(c)) : String(c)));
    return el;
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem('flowlab:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('flowlab:' + k, JSON.stringify(v)); } catch (e) { /* storage not available */ } },
  };
  const E = ExprLib, M = ModelLib;
  const TYPE_IT = E.TYPE_IT;

  /* ------------------------------ State --------------------------------- */
  const st = {
    prog: null, fi: 0, sel: null, msel: null, clip: null, undo: [], redo: [], dirty: false,
    zoom: store.get('zoom', 1), speed: store.get('speed', 2), lang: CodeGen.LANGS[store.get('lang', 'java')] ? store.get('lang', 'java') : 'java', tab: store.get('tab', 'console'),
    fileName: null, ins: [], expanded: new Set(), modCollapsed: new Set(store.get('modCollapsed', [])), varsOpen: new Set(), vfs: new Map(Object.entries(store.get('vfs', {}))),
    // Functions or Objects view; in the Objects view the sheet shows the class diagram (uml) or a method
    view: store.get('view', 'functions') === 'objects' ? 'objects' : 'functions', uml: true, usel: null,
    // positions of the predefined exceptions in the class diagram (only in memory, for the open program)
    excPos: new Map(),
    fmodPos: new Map(), // position of the boxes of the modules with only functions in the class diagram (session)
  };
  const SPEEDS = [{ ms: 0, label: L('ui.instant') }, { ms: 40, label: L('ui.fast') }, { ms: 280, label: L('ui.medium') }, { ms: 750, label: L('ui.slow') }];
  const renderer = new RenderLib.Renderer();
  /* ---- views: the main sheet (MAIN) and the auxiliary views, floating windows with another
     diagram or another part of the same one. The active view (V) keeps its state in st (diagram,
     selection, zoom, insertion points…); the others keep it aside in v.state */
  const VKEYS = ['fi', 'uml', 'sel', 'msel', 'mselAnchor', 'usel', 'zoom', 'ins', 'edges', 'compact', 'compactFid'];
  const FOLLOW = ['fi', 'uml', 'compact', 'compactFid', 'zoom']; // a «Continue» view copies these from the main sheet
  const MAIN = { main: true, id: 0, state: {}, chart: null, wrap: null, pans: new Map(), panKey: null };
  const views = [MAIN];
  let V = MAIN;

  /* ------------------------------ Utilities -------------------------------- */
  let toastTimer = null;
  function toast(msg, kind) {
    const t = $('#toast');
    t.textContent = msg; t.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = 'toast'; }, 3200);
  }
  const func = () => st.prog.functions[st.fi];
  const isOO = () => st.view === 'objects';
  const isUml = () => isOO() && st.uml;
  /* name shown: Main for Main, Class.method and new Class in the Objects view */
  const fname = (f) => {
    if (!f) return '';
    if (f.name.toLowerCase() === 'main' && !f.ctor) return L('run.main');
    const c = f.cls && M.classOf(st.prog, f);
    if (!c) return f.name;
    return f.ctor ? 'new ' + c.name : c.name + '.' + f.name;
  };
  const tplTxt = (f) => ((f.tparams || []).length ? `<${f.tparams.join(', ')}>` : '');
  const isRunning = () => ['running', 'paused', 'input'].includes(run.state);

  function snapshot() { return JSON.stringify({ prog: st.prog, fi: st.fi }); }
  function mutate(fn) {
    if (isRunning()) { toast(L('ui.stopTheProgramToEditThe'), 'warn'); return false; }
    st.undo.push(snapshot()); if (st.undo.length > 150) st.undo.shift();
    st.redo = [];
    fn();
    st.dirty = true;
    render();
    return true;
  }
  function restore(json) {
    const s = JSON.parse(json);
    // the stages linked are not part of the history of the edits: they stay as they are
    const stages = st.prog.stages;
    st.prog = s.prog; st.fi = Math.min(s.fi, st.prog.functions.length - 1);
    if (stages) st.prog.stages = stages; else delete st.prog.stages;
    st.sel = null;
    if (st.usel && !M.classById(st.prog, st.usel.cls)) st.usel = null;
    render();
  }
  function undo() { if (isRunning() || !st.undo.length) return; st.redo.push(snapshot()); restore(st.undo.pop()); st.dirty = true; }
  function redo() { if (isRunning() || !st.redo.length) return; st.undo.push(snapshot()); restore(st.redo.pop()); st.dirty = true; }

  function declaredNames(f) {
    const out = [];
    for (const p of f.params) out.push(p.name);
    M.walk(f.body, (s) => {
      if (s.kind === 'declare' || s.kind === 'const') s.name.split(',').map((x) => x.trim()).filter(Boolean).forEach((n) => out.push(n));
      if (s.kind === 'try') for (const c of s.catches || []) if (c.variable && !out.includes(c.variable)) out.push(c.variable); // variables of the Catches
    });
    // in the Objects view also the attributes of the class (and of its parents, if not private)
    const c = isOO() && M.classOf(st.prog, f);
    if (c) {
      M.chainOf(st.prog, c).forEach((k, i) => k.attributes.forEach((a) => { if ((i === 0 || a.visibility !== 'private') && (a.static || !f.static)) out.push(a.name); }));
      if (!f.static) out.push('this');
    }
    return [...new Set(out)];
  }
  /* choice of a type: a menu with the base types, the Generic Types (T) and the classes; for a
     class with Generic Types (Node<S, T>) the menus of its types appear beside it, also nested.
     ctx: { gens: [T, S…], allowNew, taken() } or the class in which the type is used;
     with allowNew there is the item «New Generic Type», which assigns a free name (T, S, V…).
     onChange(type) at every change */
  const NEW_GEN = '\u0000nuovo';
  function typePicker(value, ctx, onChange, aria) {
    const el = h('span', { class: 'tpick' });
    const sel = h('select', { 'aria-label': aria || L('win.type') });
    const sub = h('span', { class: 'tpargs' });
    const cs = M.hasClasses(st.prog) ? st.prog.classes : [];
    const tps = ctx ? ctx.gens || ctx.tparams || [] : [];
    const genOpt = (t) => h('option', { value: t, class: 'genopt', 'data-k': 'gen' }, L('ui.genericType', { t }));
    // groups divided by a line: base types, Generic Types, classes of the program, classes of the modules, exceptions of the program
    const isExc = (c) => M.isExcClass(st.prog, c);
    const groups = [
      E.TYPES.map((t) => [t, TYPE_IT[t], 'base']),
      [...tps.map((t) => [t, L('ui.genericType', { t }), 'gen']), ...(ctx && ctx.allowNew ? [[NEW_GEN, L('ui.newGenericType'), 'gen']] : [])],
      cs.filter((c) => !c.module && !isExc(c)).map((c) => [c.name, `${M.classTitle(c)} (${L('ui.class')})`, 'cls']),
      cs.filter((c) => c.module).map((c) => [c.name, `${M.classTitle(c)} (${L('ui.module')})`, 'mod']),
      cs.filter((c) => !c.module && isExc(c)).map((c) => [c.name, `${M.classTitle(c)} (${L('chart.exception')})`, 'exc']),
    ].filter((g) => g.length);
    // the menus of the same dialog see at once the Generic Types just created
    if (ctx && typeof ctx === 'object' && !ctx.id) (ctx._sels = ctx._sels || new Set()).add(sel);
    const genOf = (b) => { const c = M.classByName(st.prog, b); return c && (c.tparams || []).length ? c : null; };
    let kids = [];
    const get = () => { const c = genOf(sel.value); return c ? E.joinType(c.name, kids.map((k) => k.get())) : sel.value; };
    const fire = () => { if (onChange) onChange(get()); };
    const drawArgs = (args) => {
      sub.innerHTML = ''; kids = [];
      const c = genOf(sel.value); if (!c) return;
      c.tparams.forEach((p, i) => {
        const k = typePicker(args[i] || 'Integer', ctx, fire, `${aria || L('win.type')}: ${p} di ${c.name}`);
        kids.push(k);
        sub.append(h('span', { class: 'tparg' }, h('span', { class: 'tpname' }, p + ':'), k.el));
      });
    };
    const set = (v) => {
      const g = E.splitType(v || 'Integer');
      if (![...sel.options].some((o) => o.value.toLowerCase() === g.base.toLowerCase())) sel.append(/^[A-Z][0-9]*$/.test(g.base) ? genOpt(g.base) : h('option', { value: g.base }, E.typeName(g.base)));
      sel.value = [...sel.options].find((o) => o.value.toLowerCase() === g.base.toLowerCase()).value;
      drawArgs(g.args);
    };
    groups.forEach((g, i) => {
      if (i) sel.append(document.createElement('hr'));
      sel.append(...g.map(([v, l, k]) => h('option', { value: v, class: v === NEW_GEN ? 'newgen' : null, 'data-k': k }, l)));
    });
    sel.addEventListener('change', () => {
      if (sel.value === NEW_GEN) {
        const taken = new Set([...(ctx.taken ? ctx.taken() : []), ...tps].map((x) => x.toLowerCase()));
        const nm = nextGenName(taken);
        for (const x of ctx._sels || [sel]) {
          if (![...x.options].some((o) => o.value === nm)) {
            const nw = [...x.options].find((o) => o.value === NEW_GEN), o = genOpt(nm);
            if (nw) x.insertBefore(o, nw);
            else {
              // a menu without «New Generic Type»: after its Generic Types, or a new group after the base types
              const gens = [...x.options].filter((o2) => o2.dataset.k === 'gen');
              if (gens.length) gens[gens.length - 1].after(o);
              else { const lastBase = [...x.options].filter((o2) => o2.dataset.k === 'base').pop(); const line = document.createElement('hr'); lastBase.after(line); line.after(o); }
            }
          }
        }
        sel.value = nm;
        toast(L('ui.newGenericType2', { nm }));
      }
      drawArgs([]); fire();
    });
    el.append(sel, sub);
    set(value);
    return { el, sel, get, set, setDisabled(d) { el.querySelectorAll('select').forEach((x) => { x.disabled = d; }); } };
  }
  /* ---- Generic Types: FlowLab gives the names (T, S, V…) and derives them from where they are used ----
     in an attribute, in a constructor or in a non-static method they belong to the class (Pair<T>);
     in a function or in a static method to the function (maximum<T>) */
  const GEN_NAMES = ['T', 'S', 'V', 'U', 'W', 'K', 'E', 'R'];
  function nextGenName(taken) {
    const free = (n) => !taken.has(n.toLowerCase()) && !M.classByName(st.prog, n);
    for (const n of GEN_NAMES) if (free(n)) return n;
    let i = 1; while (!free('T' + i)) i++; return 'T' + i;
  }
  /* names of the Generic Types that appear in the types (known: those already known, also with long names) */
  function genNamesIn(types, known) {
    const kn = new Set((known || []).map((x) => x.toLowerCase()));
    const out = [];
    const add = (t) => {
      const g = E.splitType(t);
      const b = g.base;
      if (!g.args.length && b && !E.TYPES.includes(b) && !M.classByName(st.prog, b) && (kn.has(b.toLowerCase()) || /^[A-Z][0-9]*$/.test(b)) && !out.some((x) => x.toLowerCase() === b.toLowerCase())) out.push(b);
      g.args.forEach(add);
    };
    types.forEach(add);
    return out;
  }
  /* the order of the Generic Types already present stays (Pair<K, V>): the new ones go at the end */
  const orderGen = (old, used) => [...(old || []).filter((t) => used.some((u) => u.toLowerCase() === t.toLowerCase())), ...used.filter((u) => !(old || []).some((t) => t.toLowerCase() === u.toLowerCase()))];
  /* types that make a class generic: instance attributes, constructors, non-static methods (except skip) */
  function classTypes(c, skip) {
    // also the type arguments given to the parent class (Pila<T> extends Lista<T>)
    const out = skip === 'pargs' ? [] : [...(c.pargs || [])];
    for (const a of c.attributes) if (a !== skip && !a.static) out.push(a.type);
    for (const f of M.membersOf(st.prog, c)) if (f !== skip && (f.ctor || !f.static)) out.push(...f.params.map((p) => p.type), ...M.rets(f).map((r) => r.type));
    return out;
  }
  /* Generic Types of the class if those types are added (null if they do not change); error if the change cannot be made */
  function classGenChange(c, skip, extra) {
    const nu = orderGen(c.tparams, genNamesIn([...classTypes(c, skip), ...extra], c.tparams));
    if (nu.join(',') === (c.tparams || []).join(',')) return { nu: null };
    const added = nu.filter((t) => !(c.tparams || []).includes(t)), gone = (c.tparams || []).filter((t) => !nu.includes(t));
    const what = [added.length ? L('ui.theGenericTypeWouldBeAdded', { list: added.join(', ') }) : '', gone.length ? L('ui.theGenericTypeWouldBeRemoved', { list: gone.join(', ') }) : ''].filter(Boolean).join(' e ') || L('ui.theOrderOfTheGenericTypes');
    if (nu.length && c === M.mainClass(st.prog)) return { err: L('ui.isTheMainClassItCannot', { name: c.name }) };
    if (classUsed(c)) return { err: L('ui.isAlreadyUsedInTheProgram', { name: c.name, what, c: M.classTitle(c), text: nu.length ? `${c.name}<${nu.join(', ')}>` : c.name, name2: c.name }) };
    const subs = subGenChange(c, c.tparams || [], nu);
    if (subs.err) return subs;
    return { nu, subs };
  }
  /* the subclasses follow the Generic Types of the parent class: those kept keep their argument, a new one is
     passed on with the same name (Pila<T> extends Lista<T>), so the subclass gets it too. Returns [{ k, pargs, tparams }] */
  function subGenChange(c, old, nu, out) {
    out = out || [];
    for (const k of st.prog.classes.filter((x) => (x.parent || '').toLowerCase() === c.name.toLowerCase())) {
      const pargs = nu.map((t) => { const j = old.findIndex((o) => o.toLowerCase() === t.toLowerCase()); return j >= 0 && (k.pargs || [])[j] ? k.pargs[j] : t; });
      const kt = orderGen(k.tparams, genNamesIn([...classTypes(k, 'pargs'), ...pargs], k.tparams));
      const changed = kt.join(',') !== (k.tparams || []).join(',');
      if (changed && k === M.mainClass(st.prog)) return { err: L('ui.isTheMainClassItCannot', { name: k.name }) };
      if (changed && classUsed(k)) return { err: L('ui.theSubclassWouldChangeItsGeneric', { name: k.name, c: M.classTitle(k), text: kt.length ? `${k.name}<${kt.join(', ')}>` : k.name }) };
      out.push({ k, pargs, tparams: kt });
      if (changed) { const r = subGenChange(k, k.tparams || [], kt, out); if (r.err) return r; }
    }
    return out;
  }
  /* applies a change of the Generic Types of a class (and of its subclasses) */
  function applyGen(c, ch) {
    if (!ch || !ch.nu) return;
    c.tparams = ch.nu;
    for (const x of ch.subs || []) { x.k.pargs = x.pargs.length ? x.pargs : undefined; if (!x.pargs.length) delete x.k.pargs; x.k.tparams = x.tparams; }
  }
  /* Generic Types that can be used in a function: those of the class (non-static methods, constructors) or its own */
  function typeCtx(f) {
    const c = f && M.hasClasses(st.prog) ? M.classOf(st.prog, f) : null;
    const gens = c && (f.ctor || !f.static) ? c.tparams || [] : (f && f.tparams) || [];
    return gens.length ? { gens } : c;
  }
  /* ---- modules: their classes are read-only ---- */
  function roGuard(c) {
    if (c === undefined) {
      // open function or method: does it come from a module?
      if (isUml()) return false;
      const f = func(), m = M.moduleOfFunc(st.prog, f);
      if (m) { toast(L('ui.isPartOfTheModuleIt', { text: f.module ? f.name + '()' : M.classOf(st.prog, f).name, name: m.name }), 'warn'); return true; }
      return false;
    }
    if (c && c.module) { toast(L('ui.isPartOfTheModuleIt', { text: c.name, name: c.module.name }), 'warn'); return true; }
    return false;
  }
  /* function imported from a module with only functions */
  function roFunc(f) { if (f && f.module) { toast(L('ui.isPartOfTheModuleIt2', { name: f.name, name2: f.module.name }), 'warn'); return true; } return false; }
  /* type of a cell with the type parameters replaced (T -> Integer for an ArrayList<Integer>) */
  function cellT(c) { return run.interp && run.interp.cellType ? run.interp.cellType(c) : c.type; }

  /* ----------------------------- Views ----------------------------------- */
  /* the program must match the view: default class in the Objects view */
  function ensureView() {
    if (isOO() && !M.hasClasses(st.prog)) M.wrapInClass(st.prog);
    if (!isOO() && M.hasClasses(st.prog)) {
      if (M.isTrivialOO(st.prog)) M.unwrapClasses(st.prog);
      else { st.view = 'objects'; store.set('view', 'objects'); }
    }
  }
  function infoBox(title, text) { openModal({ title, body: h('p', { class: 'confirm' }, text), okText: L('ui.gotIt'), noCancel: true }); }
  function setView(v) {
    if (v === st.view) { if (v === 'objects' && !st.uml) showUml(); return; }
    if (isRunning()) { toast(L('ui.stopTheProgramToChangeView'), 'warn'); return; }
    if (v === 'functions' && M.hasClasses(st.prog)) {
      const cs = st.prog.classes;
      if (cs.length > 1) {
        infoBox(L('ui.functionsViewNotAvailable'), L('ui.youCannotOpenTheFunctionsView', { list: cs.map((c) => c.name).join(', ') }));
        return;
      }
      if (!M.isTrivialOO(st.prog)) {
        const c = cs[0], ms = M.membersOf(st.prog, c), why = [];
        if (c.attributes.length) why.push(L('ui.attributes'));
        if (ms.some((f) => f.ctor)) why.push(L('ui.constructors'));
        if (ms.some((f) => !f.ctor && !f.static)) why.push(L('ui.nonStaticMethods'));
        if (ms.some((f) => (f.visibility || 'public') !== 'public')) why.push(L('ui.privateOrProtectedMethods'));
        infoBox(L('ui.functionsViewNotAvailable'), L('ui.theClassHasTheFunctionsView', { name: c.name, list: why.join(', ') }));
        return;
      }
      M.unwrapClasses(st.prog);
    }
    st.view = v; store.set('view', v);
    st.sel = null; st.usel = null;
    st.uml = v === 'objects';
    if (v === 'objects') ensureView();
    forgetPans(V);
    render();
  }
  function renderViewSwitch() {
    $('#viewFn').setAttribute('aria-checked', String(!isOO()));
    $('#viewOo').setAttribute('aria-checked', String(isOO()));
    document.body.classList.toggle('oo', isOO());
    document.body.classList.toggle('umlmode', isUml());
    $('.hint-add').textContent = isUml() ? L('ui.doubleClickAMethodToDraw') : L('ui.clickAnArrowToAddA');
    const bar = $('#crumbBar');
    const fmod = !isUml() && func().module;
    bar.hidden = (!isOO() || st.uml) && !fmod;
    $('#backUml').hidden = !isOO();
    if (!bar.hidden) {
      const f = func(); const c = isOO() ? M.classOf(st.prog, f) : null; const m = M.moduleOfFunc(st.prog, f);
      $('#crumbWhere').textContent = isOO() && c ? `${M.classTitle(c)} › ${f === st.prog.functions[0] ? L('ui.mainStartOfTheProgram') : f.ctor ? L('uml.constructor') : f.name + '()'}${m ? L('ui.moduleReadOnly', { name: m.name }) : ''}` : L('ui.moduleReadOnly2', { name: f.name, name2: m.name });
    }
    document.body.classList.toggle('readonly', !bar.hidden && M.isModuleFunc(st.prog, func()));
    const mods = isUml() ? M.modulesOf(st.prog) : [];
    $('#modBar').hidden = !mods.length;
    document.body.classList.toggle('hasmods', !!mods.length);
    if (mods.length) { const anyOpen = mods.some((m) => !st.modCollapsed.has(m.name)); $('#modToggle').textContent = anyOpen ? L('ui.collapseModules') : L('ui.expandModules'); $('#modToggle').title = (anyOpen ? L('ui.showImportedModulesAsCompactBoxes') : L('ui.showAttributesAndMethodsOfThe')) + ' (Shift+M)'; }
  }
  /* abstract method: no flowchart, only the versions of the subclasses */
  function abstractCard(f) {
    st.ins = []; st.edges = [];
    const c = M.classOf(st.prog, f);
    const sig = (g) => g.params.map((p) => p.type.toLowerCase() + (p.array ? '[' + (p.dims || 1) : '')).join(',');
    const impls = st.prog.functions.filter((g) => g !== f && !g.ctor && !g.abstract && g.name.toLowerCase() === f.name.toLowerCase() && sig(g) === sig(f) && M.isSubclass(st.prog, M.classOf(st.prog, g), c));
    const card = h('div', { class: 'abscard', role: 'note' },
      h('div', { class: 'tag' }, L('run.abstractMethod')),
      h('h3', null, UmlLib.methodText(st.prog, f)),
      h('p', null, L('ui.inThisMethodHasNoBody', { name: c.name })),
      impls.length ? h('p', { class: 'muted small' }, L('ui.definedIn')) : h('p', { class: 'muted small' }, L('ui.noSubclassDefinesItYetAdd')),
      h('div', { class: 'impls' },
        ...impls.map((g) => h('button', { class: 'btn small', type: 'button', onclick: () => showFunc(st.prog.functions.indexOf(g)) }, `${M.classOf(st.prog, g).name}.${g.name}()`)),
        h('button', { class: 'btn small', type: 'button', onclick: () => { if (!isRunning()) editFunction(st.prog.functions.indexOf(f)); } }, L('ui.editTheMethod'))));
    const holder = V.chart; holder.innerHTML = ''; holder.append(card);
  }
  function showUml() { if (V.sync) setSync(V, false); st.uml = true; st.sel = null; render(); }
  /* modules collapsed in the class diagram (remembered by name) */
  function toggleModule(name) {
    if (st.modCollapsed.has(name)) st.modCollapsed.delete(name); else st.modCollapsed.add(name);
    store.set('modCollapsed', [...st.modCollapsed]); render();
  }
  function toggleAllModules() {
    const ms = M.modulesOf(st.prog).map((m) => m.name);
    const anyOpen = ms.some((n) => !st.modCollapsed.has(n));
    for (const n of ms) { if (anyOpen) st.modCollapsed.add(n); else st.modCollapsed.delete(n); }
    store.set('modCollapsed', [...st.modCollapsed]); render();
  }

  /* --------------------------- Drawing ----------------------------------- */
  let codeTimer = null;
  /* draws the diagram of the active view */
  function renderChart() {
    const holder = V.chart;
    if (isUml()) {
      const out = UmlLib.render(st.prog, st.usel, { collapsed: st.modCollapsed, excPos: st.excPos, fmodPos: st.fmodPos });
      st.ins = []; st.edges = [];
      holder.innerHTML = vsvg(out.svg);
      applyZoom();
    } else if (isOO() && func().abstract) {
      abstractCard(func());
    } else {
      const f = func();
      const c = isOO() ? M.classOf(st.prog, f) : null;
      // a newly opened diagram is always extended
      if (st.compactFid !== f.id) { st.compact = false; st.compactFid = f.id; }
      const out = renderer.func(f, st.expanded, Object.assign(isOO() ? { owner: c ? c.name : '', isMain: st.fi === 0 } : {}, { compact: !!st.compact }));
      st.ins = out.ins;
      st.edges = out.edges;
      holder.innerHTML = vsvg(out.svg);
      applyZoom();
    }
    if (!V.main) renderViewHead(V);
    placeSheet();
  }
  /* in the auxiliary views the arrow markers have their own ids */
  const vsvg = (s) => (V.main ? s : s.replace(/id="(ah|uml-inh|uml-open)"/g, `id="$1-v${V.id}"`).replace(/url\(#(ah|uml-inh|uml-open)\)/g, `url(#$1-v${V.id})`));
  function render() {
    ensureView();
    renderChart();
    // the parts of the interface outside the sheet (selector, view, Compact) always follow the main sheet
    withView(MAIN, () => { syncCompactBtn(); renderFuncSelect(); renderViewSwitch(); });
    for (const v of views) if (v !== V) withView(v, renderChart);
    decorate();
    $('#undoBtn').disabled = !st.undo.length;
    $('#redoBtn').disabled = !st.redo.length;
    $('#progName').textContent = st.prog.attrs.name || L('ui.untitledProgram');
    clearTimeout(codeTimer); codeTimer = setTimeout(() => { renderCode(); autosave(); }, 120);
    scheduleSync();
  }
  /* ---- change of the active view ---- */
  function saveViewState(v) {
    for (const k of VKEYS) v.state[k] = st[k];
    const f = st.prog && st.prog.functions[st.fi]; v.state.fid = f && f.id;
  }
  function loadViewState(v) {
    if (v.sync) {
      if (v.state.fid !== MAIN.state.fid || v.state.uml !== MAIN.state.uml) { v.state.sel = null; v.state.usel = null; }
      for (const k of FOLLOW) v.state[k] = MAIN.state[k];
      v.state.fid = MAIN.state.fid;
    }
    for (const k of VKEYS) st[k] = v.state[k];
    // the program may have changed (functions added or removed, Undo): the diagram is found again by its id
    const fs = st.prog.functions;
    let i = v.state.fid ? fs.findIndex((f) => f.id === v.state.fid) : -1;
    if (i < 0) i = Math.max(0, Math.min(st.fi || 0, fs.length - 1));
    st.fi = i;
  }
  function activate(v) {
    if (!v || v === V) return;
    saveViewState(V);
    V = v;
    loadViewState(v);
  }
  function withView(v, fn) {
    if (v === V) return fn();
    const prev = V;
    activate(v);
    try { return fn(); } finally { if (views.includes(prev)) activate(prev); else activate(MAIN); }
  }
  /* the view being worked on: clicks, keyboard and commands act on it */
  function focusView(v) {
    if (!v) return;
    activate(v);
    for (const x of views) if (!x.main) x.win.classList.toggle('vactive', x === V);
    document.body.classList.toggle('auxactive', !V.main);
  }
  /* view that contains an element of the page */
  const viewOfEl = (el) => views.find((v) => v.chart && v.chart.contains(el)) || null;
  /* state of a view also when it is not active */
  const vget = (v, k) => (v === V ? st[k] : v.state[k]);
  /* compact view: only for flowcharts; export is always extended */
  function syncCompactBtn() {
    const b = $('#compactBtn'); if (!b) return;
    b.hidden = isUml() || (isOO() && func().abstract);
    const on = !!st.compact && !b.hidden;
    b.setAttribute('aria-pressed', String(on));
    b.querySelector('.lbl').textContent = on ? L('ui.expand') : L('ui.compact');
    b.title = on ? L('ui.extendedViewArrowsBetweenAllBlocks') : L('ui.compactViewBlocksInSequenceTouch');
  }
  function toggleCompact() {
    if (V.sync) { withView(MAIN, toggleCompact); return; } // a «Continue» view follows the main sheet
    if (isUml() || (isOO() && func().abstract)) return;
    st.compact = !st.compact; st.compactFid = func().id;
    render();
  }
  function decorate() {
    // blocks of the clicked code line (until the selection changes elsewhere)
    if (link && link.from === 'code' && vget(V, 'sel') !== link.sel) link = null;
    const lk = link && link.from === 'code' ? link.ids : null;
    // during the cursor's trip the starting block stays lit
    // during an animation of the stage the block that made it stays lit
    const litId = run.stageHold || (run.hold ? run.holdFrom : run.curId);
    const on = run.state !== 'idle' && run.state !== 'done';
    for (const v of views) {
      if (!v.chart) continue;
      const sel = new Set(selIdsOf(v));
      $$('.shape', v.chart).forEach((g) => {
        const id = g.dataset.id;
        g.classList.toggle('sel', sel.has(id));
        // the block lights up only when the cursor has reached it
        g.classList.toggle('exec', id === litId && on);
        g.classList.toggle('err', id === run.errId);
        g.classList.toggle('linked', !!lk && lk.has(id));
        markDot(g, bpMarks.get(id));
      });
    }
    decorateCode();
  }
  function applyZoom() {
    const svg = $('svg', V.chart); if (!svg) return;
    svg.setAttribute('width', Math.round(svg.dataset.w * st.zoom));
    svg.setAttribute('height', Math.round(svg.dataset.h * st.zoom));
    const lab = V.main ? $('#zoomVal') : V.zoomVal;
    if (lab) lab.textContent = Math.round(st.zoom * 100) + '%';
  }
  function setZoom(z) {
    if (V.sync) { withView(MAIN, () => setZoom(z)); return; } // a «Continue» view follows the zoom of the main sheet
    st.zoom = Math.max(0.3, Math.min(2.5, Math.round(z * 100) / 100));
    if (V.main) store.set('zoom', st.zoom); else saveViewsSoon();
    applyZoom();
    if (V.main) for (const v of views) if (v.sync) withView(v, () => { applyZoom(); centerX(v); });
    scheduleSync();
  }
  function fitZoom() {
    if (V.sync) { withView(MAIN, fitZoom); return; }
    const svg = $('svg', V.chart); const wrap = V.wrap;
    if (!svg) return;
    const z = Math.min((wrap.clientWidth - 24) / svg.dataset.w, (wrap.clientHeight - 24) / svg.dataset.h, 1.4);
    setZoom(Math.max(0.3, z));
    home(V);
  }
  /* items of a diagram selector: functions, or class diagram and methods. First those of the program,
     then those of each imported module, in a group of the module (data-mod) that the menu shows collapsed */
  function fillFuncOptions(sel) {
    sel.innerHTML = '';
    const modGroup = (name) => h('optgroup', { label: L('ui.moduleGroup', { name }), 'data-mod': name });
    if (isOO()) {
      sel.append(h('option', { value: 'uml', selected: st.uml }, '▦ Classi (UML)'));
      // the classes of the program, then the modules: their classes and the functions imported into a class of the program
      const cs = st.prog.classes, mods = new Map();
      const modList = (name) => { if (!mods.has(name)) mods.set(name, []); return mods.get(name); };
      for (const c of [...cs.filter((x) => !x.module), ...cs.filter((x) => x.module)]) {
        const og = h('optgroup', { label: L('ui.class2') + M.classTitle(c) + (c.module ? L('ui.module2', { name: c.module.name }) : '') });
        if (c.module) { og.dataset.mod = c.module.name; og.dataset.cls = M.classTitle(c); }
        const ms = M.membersOf(st.prog, c);
        for (const f of [...ms.filter((x) => x.ctor), ...ms.filter((x) => !x.ctor)]) {
          const i = st.prog.functions.indexOf(f);
          const sig = i === 0 ? L('ui.mainStart') : f.ctor ? L('ui.newConstructor', { name: c.name, list: f.params.map((p) => p.name).join(', ') }) : `${f.name}${tplTxt(f)}(${f.params.map((p) => p.name).join(', ')})${f.abstract ? L('ui.abstract') : ''}`;
          const o = h('option', { value: i, selected: !st.uml && i === st.fi }, sig + (f.module ? L('ui.module3') + f.module.name : ''));
          if (f.module && !c.module) {
            // a function of a module of functions: in the group of the module
            o.dataset.short = sig;
            const l = modList(f.module.name);
            let g = l.find((x) => !x.dataset.cls);
            if (!g) { g = h('optgroup', { label: L('ui.moduleGroup', { name: f.module.name }), 'data-mod': f.module.name }); l.unshift(g); }
            g.append(o);
          } else og.append(o);
        }
        if (c.module) modList(c.module.name).push(og);
        else sel.append(og);
      }
      // the functions of the modules with only functions: outside the classes
      for (const f of M.globalFuncs(st.prog)) {
        const i = st.prog.functions.indexOf(f), sig = `${f.name}${tplTxt(f)}(${f.params.map((p) => p.name).join(', ')})`;
        const o = h('option', { value: i, selected: !st.uml && i === st.fi, 'data-short': sig }, sig + L('ui.module3') + f.module.name);
        const l = modList(f.module.name);
        let g = l.find((x) => !x.dataset.cls);
        if (!g) { g = h('optgroup', { label: L('ui.moduleGroup', { name: f.module.name }), 'data-mod': f.module.name }); l.unshift(g); }
        g.append(o);
      }
      mods.forEach((l) => l.forEach((g) => sel.append(g)));
      return;
    }
    const groups = new Map();
    st.prog.functions.forEach((f, i) => {
      const sig = i === 0 ? L('ui.mainStart') : `${f.name}${tplTxt(f)}(${f.params.map((p) => p.name).join(', ')})`;
      const o = h('option', { value: i, selected: i === st.fi }, sig + (f.module ? L('ui.module3') + f.module.name : ''));
      if (!f.module) { sel.append(o); return; }
      o.dataset.short = sig;
      if (!groups.has(f.module.name)) groups.set(f.module.name, modGroup(f.module.name));
      groups.get(f.module.name).append(o);
    });
    groups.forEach((g) => sel.append(g));
  }
  /* the menu of a diagram selector: like the list of the select, but each module is a group that opens with + */
  const modOpen = new Set();
  function funcMenu(sel) {
    const box = h('div', { class: 'ctxmenu fmenu', role: 'menu' });
    box.style.minWidth = sel.getBoundingClientRect().width + 'px';
    const cur = sel.selectedOptions[0];
    const curMod = cur && cur.parentElement.dataset && cur.parentElement.dataset.mod;
    if (curMod) modOpen.add(curMod);
    const item = (o, cls) => h('button', { type: 'button', role: 'menuitemradio', class: 'fitem' + (cls ? ' ' + cls : ''), 'aria-checked': String(o === cur),
      onclick: () => { closePop(); if (sel.value !== o.value) { sel.value = o.value; sel.dispatchEvent(new Event('change')); } sel.focus({ preventScroll: true }); } },
    h('span', { class: 'fcheck', 'aria-hidden': 'true' }, o === cur ? '✓' : ''), h('span', { class: 'ftxt' }, o.dataset.short || o.textContent));
    const build = (focusMod) => {
      box.innerHTML = '';
      const kids = [...sel.children];
      for (let k = 0; k < kids.length; k++) {
        const el = kids[k];
        if (el.tagName === 'OPTION') { box.append(item(el)); continue; }
        const mod = el.dataset.mod;
        if (!mod) { box.append(h('div', { class: 'fgroup' }, el.label)); [...el.children].forEach((o) => box.append(item(o, 'fin'))); continue; }
        // the groups of the same module (the classes of a module) go under one heading
        const gs = [el]; while (kids[k + 1] && kids[k + 1].dataset && kids[k + 1].dataset.mod === mod) gs.push(kids[++k]);
        const n = gs.reduce((a, g) => a + g.children.length, 0), open = modOpen.has(mod);
        const head = h('button', { type: 'button', class: 'fmod', 'aria-expanded': String(open), 'data-mod': mod, title: L('ui.showOrHideTheModule', { name: mod }),
          onclick: () => { if (modOpen.has(mod)) modOpen.delete(mod); else modOpen.add(mod); build(mod); } },
        h('span', { class: 'fplus', 'aria-hidden': 'true' }, open ? '−' : '+'), h('span', { class: 'ftxt' }, L('ui.moduleGroup', { name: mod })), h('span', { class: 'fcount' }, String(n)));
        box.append(head);
        if (!open) continue;
        for (const g of gs) {
          if (g.dataset.cls) box.append(h('div', { class: 'fgroup fin' }, L('ui.class2') + g.dataset.cls));
          [...g.children].forEach((o) => box.append(item(o, 'fin')));
        }
      }
      const f = focusMod ? box.querySelector(`.fmod[data-mod="${CSS.escape(focusMod)}"]`) : box.querySelector('.fitem[aria-checked=true]');
      if (f) setTimeout(() => { f.focus({ preventScroll: true }); f.scrollIntoView({ block: 'nearest' }); }, 0);
    };
    // arrows: previous and next item; right and left: open and close the module
    box.addEventListener('keydown', (e) => {
      const bs = [...box.querySelectorAll('button')], i = bs.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); const b = bs[(i + (e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length]; if (b) { b.focus(); b.scrollIntoView({ block: 'nearest' }); } return; }
      if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); e.stopPropagation(); const b = e.key === 'Home' ? bs[0] : bs[bs.length - 1]; if (b) b.focus(); return; }
      const a = document.activeElement;
      if (e.key === 'ArrowRight' || e.key === '+') { if (a.classList.contains('fmod') && a.getAttribute('aria-expanded') === 'false') { e.preventDefault(); a.click(); } return; }
      if (e.key === 'ArrowLeft' || e.key === '-') {
        let hd = a.classList.contains('fmod') ? a : null;
        if (!hd && a.classList.contains('fin')) for (let k = i; k >= 0; k--) if (bs[k].classList.contains('fmod')) { hd = bs[k]; break; }
        if (hd && hd.getAttribute('aria-expanded') === 'true') { e.preventDefault(); hd.click(); }
      }
    });
    build();
    return box;
  }
  /* a diagram selector opens the menu with the modules instead of the list of the browser */
  function enhanceSel(sel) {
    const open = () => { if (sel.disabled) return; const r = sel.getBoundingClientRect(); openPop(r.left, r.bottom + 4, funcMenu(sel)); $('#pop')._sel = sel; };
    sel.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); sel.focus({ preventScroll: true });
      const was = !$('#pop').hidden && $('#pop')._sel === sel;
      setTimeout(() => { if (!was) open(); else closePop(); }, 0);
    });
    sel.addEventListener('keydown', (e) => {
      const arrows = /Mac|iPhone|iPad/.test(navigator.platform) && (e.key === 'ArrowDown' || e.key === 'ArrowUp');
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'F4' || (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) || arrows) { e.preventDefault(); e.stopPropagation(); open(); }
    });
  }
  function renderFuncSelect() {
    const sel = $('#funcSel');
    fillFuncOptions(sel);
    const add = $('#funcAdd'), edit = $('#funcEdit'), del = $('#funcDel');
    if (isOO()) {
      // class diagram and, for each class, constructors and methods
      $('#funcLbl').textContent = L('ui.diagram');
      const cur = !st.uml && M.classOf(st.prog, func());
      add.title = (st.uml ? L('ui.newClass') : L('ui.newMethodInClass', { text: cur ? cur.name : '' })) + ' (N)';
      edit.title = (st.uml ? L('ui.editTheSelectedItemInThe') : L('ui.editTheMethod2')) + ' (F2)';
      del.title = st.uml ? L('ui.deleteTheSelectedItemInThe') : L('ui.deleteTheMethodShiftDel');
      del.disabled = st.uml ? !st.usel : st.fi === 0;
      edit.disabled = st.uml && !st.usel;
      return;
    }
    $('#funcLbl').textContent = L('ui.function');
    add.title = L('ui.newFunctionN'); edit.title = L('ui.editFunctionOrProgramPropertiesF2'); del.title = L('ui.deleteFunctionShiftDel');
    edit.disabled = false;
    del.disabled = st.fi === 0;
  }
  function showFunc(i) { if (i === st.fi && !st.uml) return; if (V.sync) setSync(V, false); st.fi = i; st.uml = false; st.sel = null; render(); }

  function autosave() {
    try { store.set('autosave', { xml: M.serializeFprg(st.prog), fi: withView(MAIN, () => st.fi), fileName: st.fileName, views: viewsData(), sourceUrl: st.sourceUrl || null, stageBase: st.stageBase || null }); } catch (e) { /* ignore */ }
  }

  /* ------------------------ Mini icons of the shapes ------------------------ */
  const ICON = {
    declare: '<rect x="3" y="5" width="26" height="16" rx="1.5"/><path class="inner" d="M7 5V21M3 9H29"/>',
    assign: '<rect x="3" y="5" width="26" height="16" rx="1.5"/>',
    const: '<rect x="3" y="5" width="26" height="16" rx="1.5"/><path class="inner" d="M7 5V21M3 9H29M14 13H22M14 17H22"/>',
    input: '<path d="M9 5H29L23 21H3Z"/><path class="inner" d="M12 13H20M17 10L20 13L17 16"/>',
    output: '<path d="M9 5H29L23 21H3Z"/><path class="inner" d="M20 13H12M15 10L12 13L15 16"/>',
    if: '<path d="M16 3L29 13L16 23L3 13Z"/>',
    while: '<path d="M16 3L29 13L16 23L3 13Z"/><path class="inner" d="M3 13H1V25H16"/>',
    for: '<path d="M8 5H24L29 13L24 21H8L3 13Z"/>',
    do: '<path d="M16 7L28 15L16 23L4 15Z"/><path class="inner" d="M4 15H1V2H16V7"/>',
    call: '<rect x="3" y="5" width="26" height="16" rx="1.5"/><path class="inner" d="M7 5V21M25 5V21"/>',
    comment: '<path d="M3 5H24L29 10V21H3Z" stroke-dasharray="3 2"/>',
    breakpoint: '<path d="M10 3H22L29 10V16L22 23H10L3 16V10Z"/>',
    open: '<path d="M3 4H29V19C22 16 14 26 3 19Z"/>',
    close: '<path d="M3 4H29V19C22 16 14 26 3 19Z"/>',
    read: '<path d="M3 4H29V19C22 16 14 26 3 19Z"/>',
    write: '<path d="M3 4H29V19C22 16 14 26 3 19Z"/>',
    try: '<rect x="3" y="4" width="26" height="18" rx="3"/><path class="inner" d="M3 9H29M20 13L16 17H20L16 21"/>',
    throw: '<path d="M3 5H22L29 13L22 21H3Z"/><path class="inner" d="M15 8L11 13H15L11 18"/>',
  };
  const CAT = { declare: 'decl', const: 'decl', assign: 'assign', input: 'in', output: 'out', if: 'cond', while: 'loop', for: 'loop', do: 'loop', call: 'call', comment: 'comment', breakpoint: 'brk', open: 'file', close: 'file', read: 'file', write: 'file', try: 'exc', throw: 'exc' };
  const icon = (k) => `<svg class="mini c-${CAT[k]}" viewBox="0 0 32 26" aria-hidden="true">${ICON[k]}</svg>`;

  const GROUPS = [
    ['Base', ['declare', 'const', 'assign', 'input', 'output', 'call']],
    [L('ui.control'), ['if', 'while', 'for', 'do']],
    [L('ui.other'), ['comment', 'breakpoint']],
    ['File', ['open', 'read', 'write', 'close']],
    [L('ui.exceptions'), ['try', 'throw']],
  ];

  /* keys to add the blocks: after the selected block, or at the end of the diagram */
  /* the letters come from the language file (shortcuts), e.g. declare: 'D', read: 'Shift+R' */
  const KIND_KEY = Object.fromEntries(['declare', 'const', 'assign', 'input', 'output', 'call', 'if', 'while', 'for', 'do', 'comment', 'breakpoint', 'open', 'read', 'write', 'close', 'try', 'throw'].map((k) => [k, I18n.shortcut(k)]));
  const KEY_KIND = Object.fromEntries(Object.entries(KIND_KEY).map(([k, v]) => [v, k]));
  const keysOf = (...kinds) => kinds.map((k) => KIND_KEY[k]).join('  ');
  /* the pressed key written as in KIND_KEY (letter, with Shift+ in front) */
  function keyLabel(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return null;
    if (e.key === '/') return '/';
    if (!/^Key[A-Z]$/.test(e.code)) return null;
    return (e.shiftKey ? 'Shift+' : '') + e.code.slice(3);
  }

  /* ------------------------------ Popover -------------------------------- */
  function closePop() { $('#pop').hidden = true; $('#pop').innerHTML = ''; $('#pop')._sel = null; }
  function openPop(x, y, content) {
    const p = $('#pop');
    p.innerHTML = ''; p.append(content); p.hidden = false;
    const r = p.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    p.style.left = Math.max(8, Math.min(x, vw - r.width - 8)) + 'px';
    p.style.top = Math.max(8, Math.min(y, vh - r.height - 8)) + 'px';
    const first = p.querySelector('button'); if (first) first.focus({ preventScroll: true });
  }
  function insertMenu(insIdx, x, y) {
    const target = st.ins[insIdx];
    const box = h('div', { class: 'insmenu', role: 'menu' });
    box._target = target; // to choose the block with the keyboard
    box.append(h('div', { class: 'pophead' }, L('ui.addABlock')));
    for (const [g, kinds] of GROUPS) {
      const row = h('div', { class: 'insgroup' }, h('div', { class: 'glabel' }, g));
      const grid = h('div', { class: 'insgrid' });
      for (const k of kinds) {
        grid.append(h('button', { class: 'insbtn', type: 'button', role: 'menuitem', title: RenderLib.KIND_IT[k], onclick: () => { closePop(); addStmt(target, k); } },
          h('span', { html: icon(k) }), h('span', { class: 'ilabel' }, RenderLib.KIND_IT[k]), h('kbd', { class: 'ikey' }, KIND_KEY[k])));
      }
      row.append(grid); box.append(row);
    }
    if (st.clip) box.append(h('button', { class: 'pastebtn', type: 'button', onclick: () => { closePop(); paste(target); } }, L('ui.pasteHereCtrlV', { value: clipLabel() })));
    openPop(x, y, box);
  }
  /* ---- breakpoints marked on the blocks (only for this session, not in the file) and «Run to here» ----
     bpMarks: block id → { cond } (empty condition: it always stops) */
  const bpMarks = new Map();
  let runTo = null;
  // only while the program runs (or is paused)
  function debugItems(id) {
    if (!isRunning()) return [];
    const m = bpMarks.get(id);
    const B = (text, fn, kbd, cls) => h('button', { type: 'button', class: cls || null, onclick: () => { closePop(); fn(); } }, h('span', null, text), kbd ? h('kbd', null, kbd) : null);
    return [
      B(L('ui.runToHere'), () => runToHere(id)),
      B((m && !m.cond ? '✓ ' : '') + L('ui.breakpointOnTheBlock'), () => toggleMark(id), 'F9'),
      B((m && m.cond ? '✓ ' : '') + L('ui.conditionalBreakpoint'), () => markDialog(id)),
      h('hr'),
    ];
  }
  // red dot on the left of a marked block (with «?» if it has a condition)
  function markDot(g, m) {
    let dot = g.querySelector(':scope > .bpmark');
    const want = m ? (m.cond ? 'c:' + m.cond : 'a') : '';
    if ((dot ? dot.dataset.m : '') === want) return;
    if (dot) dot.remove();
    if (!m) return;
    const NS = 'http://www.w3.org/2000/svg', b = g.getBBox();
    dot = document.createElementNS(NS, 'g'); dot.setAttribute('class', 'bpmark'); dot.dataset.m = want;
    const cx = b.x - 9, cy = b.y + Math.min(b.height / 2, 14);
    dot.innerHTML = `<title></title><circle cx="${cx}" cy="${cy}" r="6.5"/>` + (m.cond ? `<text x="${cx}" y="${cy + 3.5}">?</text>` : '');
    dot.querySelector('title').textContent = m.cond ? L('ui.conditionalBreakpoint').replace(/…$/, '') + ': ' + m.cond : L('ui.breakpointOnTheBlock');
    g.append(dot);
  }
  function toggleMark(id) {
    if (!id) return;
    if (bpMarks.has(id)) bpMarks.delete(id); else bpMarks.set(id, { cond: '' });
    decorate();
  }
  function markDialog(id) {
    const m = bpMarks.get(id);
    const c = field({ key: 'bpcond', label: L('ui.condition'), type: 'expr', placeholder: L('ui.eGI5'), hint: L('ui.theProgramStopsOnThisBlock') }, m ? m.cond : '');
    openModal({ title: L('ui.conditionalBreakpoint'), body: h('div', { class: 'fields' }, c), onOk: () => {
      const cond = c._get().trim();
      if (cond) { try { E.parseExpr(cond); } catch (e) { return e.message; } }
      bpMarks.set(id, { cond });
      decorate();
      return true;
    } });
    if (m) {
      // remove the mark from the same dialog
      const foot = $$('.modal footer').pop();
      if (foot) foot.prepend(h('button', { type: 'button', class: 'btn danger', style: 'margin-right:auto', onclick: () => { bpMarks.delete(id); modalStack[modalStack.length - 1](); decorate(); } }, L('ui.removeTheBreakpoint')));
    }
  }
  // runs without animation up to the first time the block is reached (in any call); not running: it starts
  function runToHere(id) {
    if (run.state === 'input') return;
    runTo = id;
    if (run.state === 'paused') { run.mode = 'run'; run.state = 'running'; setStatus('running', L('ui.running')); run.fast = true; pump(); return; }
    if (run.state === 'running') { run.fast = true; return; }
    run.errId = null; run.fast = true;
    startRun('run');
  }
  // a block reached while running: stop at a marked block (if its condition holds) or at the «Run to here» block
  function stopHere(ev) {
    const id = ev.stmt.id;
    if (runTo === id) { runTo = null; run.fast = false; return L('ui.pausedAtTheChosenBlock'); }
    const m = bpMarks.get(id);
    if (!m) return null;
    if (!m.cond) { runTo = null; run.fast = false; return L('ui.pausedAtTheBreakpoint'); }
    let v;
    try { v = run.interp.evalNow(m.cond); } catch (e) { runTo = null; run.fast = false; conWrite(L('ui.breakpointConditionError', { cond: m.cond, msg: e.message }), true, 'error'); return L('ui.pausedAtTheBreakpoint'); }
    if (v.t !== 'Boolean') { runTo = null; run.fast = false; conWrite(L('ui.breakpointConditionError', { cond: m.cond, msg: L('run.theBreakpointConditionMustBeBoolean') }), true, 'error'); return L('ui.pausedAtTheBreakpoint'); }
    if (!v.v) return null;
    runTo = null; run.fast = false;
    return L('ui.pausedAtTheBreakpointCondition', { cond: m.cond });
  }
  function shapeMenu(id, x, y) {
    if (id.startsWith('start:') || id.startsWith('end:')) {
      const box = h('div', { class: 'ctxmenu' }, ...debugItems(id),
        h('button', { type: 'button', onclick: () => { closePop(); st.fi === 0 ? editProgram() : editFunction(st.fi); } }, h('span', null, st.fi === 0 ? L('ui.programProperties') : isOO() ? L('ui.editTheMethod') : L('ui.editTheFunction')), h('kbd', null, 'F2')));
      openPop(x, y, box); return;
    }
    const box = h('div', { class: 'ctxmenu' }, ...debugItems(id),
      h('button', { type: 'button', onclick: () => { closePop(); editStmt(id); } }, h('span', null, L('ui.edit')), h('kbd', null, L('ui.enter'))),
      h('button', { type: 'button', onclick: () => { closePop(); copySel(false); } }, h('span', null, L('ui.copy')), h('kbd', null, 'Ctrl+C')),
      h('button', { type: 'button', onclick: () => { closePop(); copySel(true); } }, h('span', null, L('ui.cut')), h('kbd', null, 'Ctrl+X')),
      st.clip ? h('button', { type: 'button', onclick: () => { closePop(); paste(); } }, h('span', null, L('ui.pasteAfter')), h('kbd', null, 'Ctrl+V')) : null,
      h('button', { type: 'button', onclick: () => { closePop(); duplicate(); } }, h('span', null, L('ui.duplicate')), h('kbd', null, 'Ctrl+D')),
      h('hr'),
      h('button', { type: 'button', onclick: () => { closePop(); shiftSel(-1); } }, h('span', null, L('ui.moveUp')), h('kbd', null, 'Alt+↑')),
      h('button', { type: 'button', onclick: () => { closePop(); shiftSel(1); } }, h('span', null, L('ui.moveDown')), h('kbd', null, 'Alt+↓')),
      h('hr'),
      h('button', { type: 'button', class: 'danger', onclick: () => { closePop(); deleteSel(); } }, h('span', null, L('ui.delete')), h('kbd', null, L('ui.del'))));
    openPop(x, y, box);
  }

  /* ---------------------------- Changes -------------------------------- */
  function addStmt(target, kind) {
    const s = M.makeStmt(kind);
    if (isRunning()) { toast(L('ui.stopTheProgramToEditThe'), 'warn'); return; }
    if (roGuard()) return;
    stmtDialog(s, true, (vals) => mutate(() => { Object.assign(s, vals); target.arr.splice(target.idx, 0, s); setSel([s.id]); }));
  }
  function editStmt(id) {
    const f = M.findStmt(st.prog, id); if (!f) return;
    if (isRunning()) { toast(L('ui.stopTheProgramToEditThe'), 'warn'); return; }
    if (roGuard()) return;
    stmtDialog(f.stmt, false, (vals) => mutate(() => Object.assign(f.stmt, vals)));
  }
  /* ---- multiple selection: Shift+click (or Shift+↑/↓) selects the blocks between the selected one and the
     clicked one, in the same sequence; Ctrl+click adds or removes a block; Ctrl+A all the blocks of the diagram.
     st.sel is the main block (the last one chosen), st.msel all of them (valid while it contains st.sel) ---- */
  const selIdsOf = (v) => { const s = vget(v, 'sel'), m = vget(v, 'msel'); return !s ? [] : m && m.size > 1 && m.has(s) ? [...m] : [s]; };
  const selIds = () => selIdsOf(V);
  const setSel = (ids, main) => { st.sel = main || ids[ids.length - 1] || null; st.msel = ids.length > 1 ? new Set(ids) : null; };
  // the selected blocks in the order of the program, without those inside another selected one (an If takes its branches)
  function selStmts() {
    const ids = new Set(selIds()); if (!ids.size) return [];
    const out = [];
    const f = M.findStmt(st.prog, st.sel);
    M.walk(f ? f.func.body : func().body, (x, arr, i) => { if (ids.has(x.id)) out.push({ stmt: x, arr, index: i }); });
    return out.filter((o) => !out.some((p) => p !== o && containsArr(p.stmt, o.arr)));
  }
  // path of a block: the sequences and positions from the body of the function down to it
  function pathOf(id, arr, acc) {
    for (let i = 0; i < arr.length; i++) {
      const s = arr[i], here = [...acc, { arr, index: i, stmt: s }];
      if (s.id === id) return here;
      for (const a of M.childArrays(s)) { const r = pathOf(id, a, here); if (r) return r; }
    }
    return null;
  }
  // blocks between a and b in the deepest sequence that contains both (they can be inside an If or a loop)
  function rangeIds(a, b) {
    const body = func().body, pa = pathOf(a, body, []), pb = pathOf(b, body, []);
    if (!pa || !pb) return null;
    let d = 0;
    while (d + 1 < pa.length && d + 1 < pb.length && pa[d].stmt === pb[d].stmt && pa[d + 1].arr === pb[d + 1].arr) d++;
    if (pa[d].arr !== pb[d].arr) return null;
    const i = Math.min(pa[d].index, pb[d].index), j = Math.max(pa[d].index, pb[d].index);
    return { ids: pa[d].arr.slice(i, j + 1).map((s) => s.id), main: pb[d].stmt.id };
  }
  function selectClick(id, e) {
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.shiftKey && st.sel && id && !id.includes(':')) {
      const r = rangeIds(st.msel && st.msel.size > 1 ? (st.mselAnchor || st.sel) : st.sel, id);
      if (r) { const anchor = st.msel && st.msel.size > 1 ? st.mselAnchor : st.sel; setSel(r.ids, r.main); st.mselAnchor = anchor; return; }
    }
    if (ctrl && id && !id.includes(':')) {
      const cur = selIds(), has = cur.includes(id);
      const ids = has ? cur.filter((x) => x !== id) : [...cur, id];
      setSel(ids, has ? ids[ids.length - 1] : id); st.mselAnchor = st.sel;
      return;
    }
    setSel(id && !id.includes(':') ? [id] : []); st.mselAnchor = st.sel;
  }
  function selectAll() {
    if (isUml() || func().abstract) return;
    const ids = func().body.map((s) => s.id);
    if (ids.length) { setSel(ids, ids[ids.length - 1]); st.mselAnchor = ids[0]; decorate(); }
  }
  function deleteSel() {
    if (!st.sel || roGuard()) return;
    const items = selStmts(); if (!items.length) return;
    const last = items[items.length - 1];
    mutate(() => {
      for (const o of items) o.arr.splice(o.arr.indexOf(o.stmt), 1);
      const i = Math.min(last.index - items.filter((o) => o.arr === last.arr).length + 1, last.arr.length - 1);
      const next = last.arr[Math.max(0, i)];
      setSel(next ? [next.id] : []);
    });
  }
  function copySel(cut) {
    if (!st.sel) return;
    const items = selStmts(); if (!items.length) return;
    if (cut && roGuard()) return;
    st.clip = items.map((o) => M.cloneStmt(o.stmt, true));
    if (cut) mutate(() => { for (const o of items) o.arr.splice(o.arr.indexOf(o.stmt), 1); setSel([]); });
    else toast(st.clip.length > 1 ? L('ui.blocksCopiedClickAnArrow', { n: st.clip.length }) : L('ui.blockCopiedClickAnArrowAnd'));
  }
  // what is in the clipboard, for the «Paste here» item
  const clipLabel = () => (st.clip.length > 1 ? L('ui.nBlocks', { n: st.clip.length }) : RenderLib.KIND_IT[st.clip[0].kind]);
  function paste(target) {
    if (!st.clip || !st.clip.length || (!target && (isUml() || func().abstract)) || roGuard()) return;
    const cs = st.clip.map((x) => M.cloneStmt(x));
    if (!target) {
      // after the last selected block
      const items = selStmts(), o = items[items.length - 1];
      target = o ? { arr: o.arr, idx: o.arr.indexOf(o.stmt) + 1 } : { arr: func().body, idx: func().body.length };
    }
    mutate(() => { target.arr.splice(target.idx, 0, ...cs); setSel(cs.map((c) => c.id)); st.mselAnchor = cs[0].id; });
  }
  /* moves the selected block by one place (dir -1 up, +1 down) in the same sequence */
  function shiftSel(dir) {
    if (!st.sel || roGuard()) return;
    if (isRunning()) { toast(L('ui.stopTheProgramToEditThe'), 'warn'); return; }
    const items = selStmts(); if (!items.length) return;
    // several blocks: only if they are one after the other in the same sequence
    const arr = items[0].arr, idx = items.map((o) => arr.indexOf(o.stmt));
    if (items.some((o) => o.arr !== arr) || idx.some((x, k) => k && x !== idx[k - 1] + 1)) return;
    const a = idx[0], b = idx[idx.length - 1];
    if ((dir < 0 && a === 0) || (dir > 0 && b === arr.length - 1)) return;
    mutate(() => { const moved = arr.splice(a, b - a + 1); arr.splice(a + dir, 0, ...moved); });
  }
  /* new block from the keyboard: after the selected block or at the end of the diagram */
  function addByKey(kind) {
    if (isUml() || func().abstract) return;
    const f = st.sel && M.findStmt(st.prog, st.sel);
    addStmt(f ? { arr: f.arr, idx: f.index + 1 } : { arr: func().body, idx: func().body.length }, kind);
  }
  // a copy of the selected blocks just after the last one (the clipboard does not change)
  function duplicate() {
    if (!st.sel || roGuard()) return;
    const items = selStmts(); if (!items.length) return;
    const o = items[items.length - 1], cs = items.map((x) => M.cloneStmt(x.stmt));
    mutate(() => { o.arr.splice(o.arr.indexOf(o.stmt) + 1, 0, ...cs); setSel(cs.map((c) => c.id)); st.mselAnchor = cs[0].id; });
  }
  /* headers of the Catch and Finally branches: they belong to the Try block */
  const ownerOf = (id) => (/:(catch:|finally$)/.test(id) ? id.split(':')[0] : id);
  function containsArr(stmt, arr) {
    let found = false;
    const visit = (s) => { for (const a of M.childArrays(s)) { if (a === arr) found = true; a.forEach(visit); } };
    visit(stmt);
    return found;
  }
  function moveStmt(id, target) {
    const f = M.findStmt(st.prog, id); if (!f || roGuard()) return;
    if (containsArr(f.stmt, target.arr)) { toast(L('ui.youCannotMoveABlockInside'), 'warn'); return; }
    let idx = target.idx;
    if (target.arr === f.arr && f.index < idx) idx--;
    if (target.arr === f.arr && idx === f.index) return;
    mutate(() => { f.arr.splice(f.index, 1); target.arr.splice(idx, 0, f.stmt); setSel([id]); });
  }

  /* ------------------------------ Dialogs ------------------------------- */
  const modalStack = [];
  function openModal({ title, body, okText, onOk, wide, cancelText, danger, noCancel }) {
    const back = h('div', { class: 'modal-back' });
    const err = h('div', { class: 'formerr', role: 'alert' });
    const ok = h('button', { class: 'btn primary' + (danger ? ' danger' : ''), type: 'button', title: `${okText || 'OK'} (Shift+Enter)` }, okText || 'OK');
    const form = h('form', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('header', null, h('h2', null, title), h('button', { class: 'iconbtn', type: 'button', 'aria-label': L('win.close'), onclick: () => close() }, '✕')),
      h('div', { class: 'modal-body' }, body),
      err,
      h('footer', null, noCancel ? null : h('button', { class: 'btn', type: 'button', onclick: () => close() }, cancelText || L('ui.cancel')), ok));
    back.append(form);
    const submit = () => {
      if (!onOk) { close(); return; }
      const r = onOk();
      if (typeof r === 'string') { err.textContent = r; return; }
      if (r !== false) close();
    };
    // direct handling of click and Enter: in sandboxed pages the submit event does not arrive
    form.addEventListener('submit', (e) => e.preventDefault());
    ok.addEventListener('click', submit);
    form.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      // Shift+Enter confirms from any field (also a text area, a menu or with the suggestions open)
      if (e.shiftKey) { e.preventDefault(); e.stopPropagation(); acHide(); submit(); return; }
      const t = e.target;
      // (the expression of the Output is a text area: Enter outside the strings confirms)
      if ((t.tagName === 'TEXTAREA' && !t.classList.contains('exprarea')) || t.tagName === 'BUTTON' || t.tagName === 'SELECT') return;
      e.preventDefault(); e.stopPropagation(); submit();
    });
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
    function close() { back.remove(); modalStack.pop(); acHide(); }
    modalStack.push(close);
    document.body.append(back);
    setTimeout(() => { const f = form.querySelector('input:not([type=checkbox]):not([type=radio]), textarea, select'); (f || ok).focus(); if (f && f.select) f.select(); }, 0);
    return { close, form, err };
  }
  function confirmBox(title, text, okText, onOk) {
    openModal({ title, body: h('p', { class: 'confirm' }, text), okText, danger: true, onOk: () => { onOk(); } });
  }

  /* Fields */
  /* ---- autocompletion after the dot: methods and attributes of the object (or of the class) ---- */
  /* text before the cursor -> { from, typed, items } or null */
  function memberSuggestions(before, lvalueOnly) {
    if (!M.hasClasses(st.prog) || isUml()) return null;
    const mm = /\.([\p{L}_][\p{L}\p{N}_]*)?$/u.exec(before);
    if (!mm) return null;
    const dot = mm.index, typed = mm[1] || '';
    // expression to the left of the dot: names, dots and balanced parentheses (e.g. list.get(0).name)
    let i = dot - 1, depth = 0;
    for (; i >= 0; i--) {
      const ch = before[i];
      if (ch === ')' || ch === ']') depth++;
      else if (ch === '(' || ch === '[') { if (!depth) break; depth--; }
      else if (!depth && !/[\p{L}\p{N}_.]/u.test(ch)) break;
    }
    const objText = before.slice(i + 1, dot).trim();
    if (!objText || /^\d/.test(objText)) return null;
    let node; try { node = E.parseExpr(objText); } catch (e) { return null; }
    const f = func(), here = M.classOf(st.prog, f);
    let sc; try { sc = CodeGen.scopeFor(st.prog, f); } catch (e) { return null; }
    // ClassName. -> static members; object. -> instance members
    let c = null, statics = false, map = null;
    if (node.k === 'var' && !node.indices && !sc.vars.has(node.name.toLowerCase()) && !(sc.implicitField && sc.implicitField(node.name)) && M.classByName(st.prog, node.name)) { c = M.classByName(st.prog, node.name); statics = true; }
    else {
      let t; try { t = E.inferType(node, sc); } catch (e) { return null; }
      const g = E.splitType(t);
      c = M.classByName(st.prog, g.base);
      if (c && (c.tparams || []).length && g.args.length) { map = {}; c.tparams.forEach((p, k) => { map[p.toLowerCase()] = g.args[k]; }); }
    }
    if (!c) return null;
    // a member inherited from a generic parent class: first its types written with those of c (T of Lista<T> -> Integer for ListaInteri)
    const cm = M.chainMap(st.prog, c);
    let owner0 = c;
    const T = (x) => E.typeName(map ? E.substType(M.substT(x, cm.get(owner0.id)), map) : M.substT(x, cm.get(owner0.id)));
    const canSee = (vis, owner) => (vis || 'public') === 'public' || (vis === 'private' ? here === owner : !!here && M.isSubclass(st.prog, here, owner));
    const items = [], seen = new Set();
    for (const k of M.chainOf(st.prog, c)) {
      owner0 = k;
      for (const a of k.attributes) {
        if (!!a.static !== statics || !canSee(a.visibility, k) || seen.has('a:' + a.name.toLowerCase())) continue;
        seen.add('a:' + a.name.toLowerCase());
        items.push({ kind: 'a', name: a.name, label: `${a.name}: ${T(a.type)}${a.array ? '[]' : ''}`, insert: a.name, owner: k });
      }
      if (lvalueOnly) continue;
      for (const m of M.membersOf(st.prog, k)) {
        if (m.ctor || m === st.prog.functions[0] || !!m.static !== statics || !canSee(m.visibility, k)) continue;
        const sig = m.name.toLowerCase() + '(' + m.params.map((p) => M.substT(p.type, cm.get(k.id)).toLowerCase().replace(/\s+/g, '')).join(',');
        if (seen.has(sig)) continue; // overridden in a subclass
        seen.add(sig);
        const rl = M.rets(m);
        items.push({ kind: 'm', name: m.name, label: `${m.name}(${m.params.map((p) => `${p.name}: ${T(p.type)}${p.array ? '[]' : ''}`).join(', ')})${rl.length ? ': ' + rl.map((r) => T(r.type) + (r.array ? '[]' : '')).join(', ') : ''}`, insert: m.name + (m.params.length ? '(' : '()'), owner: k });
      }
    }
    const lo = typed.toLowerCase();
    const list = items.filter((x) => x.name.toLowerCase().startsWith(lo)).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'm' ? -1 : 1) || a.name.localeCompare(b.name));
    // attribute already written in full: no list, so Enter confirms the dialog
    if (list.length === 1 && list[0].kind === 'a' && list[0].name.toLowerCase() === lo) return null;
    return list.length ? { from: dot + 1, typed, items: list, cls: c, statics } : null;
  }
  let acCur = null; // { input, sug, sel }
  const acPop = () => $('#acPop') || document.body.appendChild(h('div', { id: 'acPop', class: 'acpop', role: 'listbox', hidden: true }));
  function acHide() { const p = $('#acPop'); if (p) p.hidden = true; acCur = null; }
  function acShow(input, sug) {
    const pop = acPop();
    acCur = { input, sug, sel: Math.min(acCur && acCur.input === input ? acCur.sel : 0, sug.items.length - 1) };
    pop.innerHTML = '';
    pop.append(h('div', { class: 'achead' }, `${sug.statics ? L('ui.staticsOf') : L('ui.membersOf')} ${M.classTitle(sug.cls)}${sug.cls.module ? L('ui.module3') + sug.cls.module.name : ''}`));
    sug.items.slice(0, 40).forEach((it, k) => pop.append(h('div', { class: 'acitem' + (k === acCur.sel ? ' sel' : ''), role: 'option', 'aria-selected': String(k === acCur.sel),
      onmousedown: (e) => { e.preventDefault(); acCur.sel = k; acApply(); } },
      h('span', { class: 'ackind ' + it.kind }, it.kind === 'm' ? 'm' : 'a'), h('span', { class: 'aclabel' }, it.label),
      it.owner !== sug.cls ? h('span', { class: 'acowner' }, 'da ' + it.owner.name) : null)));
    pop.append(h('div', { class: 'acfoot' }, L('ui.toChooseEnterOrTabTo')));
    // under the cursor in the field
    const r = input.getBoundingClientRect(), cs = getComputedStyle(input);
    const cv = acPop._cv || (acPop._cv = document.createElement('canvas').getContext('2d'));
    cv.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const x = r.left + parseFloat(cs.paddingLeft) + cv.measureText(input.value.slice(0, sug.from)).width - input.scrollLeft;
    pop.hidden = false;
    pop.style.left = Math.max(8, Math.min(x - 8, window.innerWidth - pop.offsetWidth - 8)) + 'px';
    pop.style.top = (r.bottom + 4 + pop.offsetHeight > window.innerHeight ? r.top - pop.offsetHeight - 4 : r.bottom + 4) + 'px';
    const s = pop.querySelector('.acitem.sel'); if (s) s.scrollIntoView({ block: 'nearest' });
  }
  function acUpdate(input, lvalueOnly) {
    const caret = input.selectionStart ?? input.value.length;
    if (input.selectionEnd !== caret) { acHide(); return; }
    const sug = memberSuggestions(input.value.slice(0, caret), lvalueOnly);
    if (sug) acShow(input, sug); else acHide();
  }
  function acApply() {
    if (!acCur) return;
    const { input, sug, sel } = acCur, it = sug.items[sel];
    const caret = input.selectionStart ?? input.value.length;
    input.value = input.value.slice(0, sug.from) + it.insert + input.value.slice(caret);
    const pos = sug.from + it.insert.length;
    input.focus(); input.setSelectionRange(pos, pos);
    acHide();
    input.dispatchEvent(new Event('input'));
  }
  /* attaches the autocompletion to a text field */
  function attachMemberAC(input, lvalueOnly) {
    input.addEventListener('input', () => acUpdate(input, lvalueOnly));
    input.addEventListener('click', () => acUpdate(input, lvalueOnly));
    input.addEventListener('blur', () => setTimeout(() => { if (acCur && acCur.input === input) acHide(); }, 120));
    input.addEventListener('keydown', (e) => {
      if (!acCur || acCur.input !== input) return;
      const n = acCur.sug.items.length;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); acCur.sel = (acCur.sel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; acShow(input, acCur.sug); return; }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); acApply(); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); acHide(); }
    });
    input.addEventListener('keyup', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') acUpdate(input, lvalueOnly); });
  }
  /* the quote of the string still open at the end of the text (null if the text is outside the strings) */
  function openQuote(t) {
    let q = null;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (q) { if (c === '\\') i++; else if (c === q) q = null; } else if (c === '"' || c === "'") q = c;
    }
    return q;
  }
  /* an expression field shows the escape sequences of its strings in red: a copy of the text, with the same font and
     padding, drawn over the field (the text of the field becomes transparent only while there is a sequence) */
  function escMirror(input) {
    const box = h('div', { class: 'escbox' + (input.tagName === 'TEXTAREA' ? ' area' : '') }), mir = h('div', { class: 'escmirror', 'aria-hidden': 'true' });
    input.before(box); box.append(input, mir);
    const escH = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const paint = () => {
      const v = input.value;
      let q = null, html = '', any = false;
      for (let i = 0; i < v.length; i++) {
        const c = v[i];
        if (q && c === '\\' && i + 1 < v.length && 'ntr\\"\''.includes(v[i + 1])) { html += `<span class="tesc">${escH(c + v[i + 1])}</span>`; i++; any = true; continue; }
        if (q) { if (c === '\\') { html += escH(c + (v[i + 1] || '')); i++; continue; } if (c === q) q = null; } else if (c === '"' || c === "'") q = c;
        html += escH(c);
      }
      box.classList.toggle('on', any);
      if (!any) { mir.textContent = ''; return; }
      const cs = getComputedStyle(input);
      for (const k of ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'borderLeftWidth', 'borderTopWidth', 'fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight']) mir.style[k] = cs[k];
      mir.innerHTML = html + ' ';
      mir.scrollLeft = input.scrollLeft; mir.scrollTop = input.scrollTop;
    };
    let last = null;
    const sync = () => { if (input.value !== last) { last = input.value; paint(); } else { mir.scrollLeft = input.scrollLeft; mir.scrollTop = input.scrollTop; } };
    input.addEventListener('input', () => { last = input.value; paint(); });
    for (const ev of ['scroll', 'keyup', 'keydown', 'select', 'click', 'mouseup', 'focus']) input.addEventListener(ev, () => requestAnimationFrame(sync));
    input._paint = paint;
    requestAnimationFrame(paint);
  }
  function field(spec, val, vars) {
    const id = 'f_' + spec.key;
    const wrap = h('div', { class: 'field' + (spec.inline ? ' inline' : '') });
    let input;
    if (spec.type === 'select') {
      input = h('select', { id }, spec.options.map(([v, l]) => h('option', { value: v, selected: v === val }, l)));
    } else if (spec.type === 'typepick') {
      const tpk = typePicker(val, spec.ctx, null, spec.label);
      tpk.sel.id = id;
      wrap.append(h('label', { class: 'flabel', for: id }, spec.label), tpk.el);
      wrap._get = tpk.get; wrap._input = tpk.sel; wrap._check = () => '';
      return wrap;
    } else if (spec.type === 'check') {
      input = h('input', { id, type: 'checkbox', checked: !!val });
      wrap.append(h('label', { class: 'check', for: id }, input, h('span', null, spec.label)));
      wrap._get = () => input.checked; wrap._input = input;
      return wrap;
    } else if (spec.type === 'seg') {
      const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': spec.label });
      spec.options.forEach(([v, l]) => {
        const rid = id + '_' + v;
        seg.append(h('input', { type: 'radio', name: id, id: rid, value: v, checked: v === val }), h('label', { for: rid }, l));
      });
      wrap.append(h('div', { class: 'flabel' }, spec.label), seg);
      wrap._get = () => (seg.querySelector('input:checked') || {}).value;
      wrap._input = seg;
      return wrap;
    } else if (spec.multiline) {
      // an expression on several lines: the strings can contain line breaks (Enter inside a string)
      input = h('textarea', { id, rows: 1, wrap: 'off', autocomplete: 'off', spellcheck: 'false', class: 'mono exprarea', placeholder: spec.placeholder || '' });
      input.value = val ?? '';
      const grow = () => { input.rows = Math.min(10, input.value.split('\n').length); };
      input.addEventListener('input', grow); grow();
    } else if (spec.type === 'textarea') {
      input = h('textarea', { id, rows: 4, spellcheck: 'true' });
      input.value = val;
    } else {
      input = h('input', { id, type: 'text', autocomplete: 'off', spellcheck: 'false', class: spec.type === 'text' || spec.type === 'plain' ? '' : 'mono', placeholder: spec.placeholder || '' });
      input.value = val ?? '';
    }
    wrap.append(h('label', { class: 'flabel', for: id }, spec.label), input);
    const msg = h('div', { class: 'fmsg' }, spec.hint || '');
    wrap.append(msg);
    if (['expr', 'exprlist', 'lvalue', 'lvalues'].includes(spec.type)) attachMemberAC(input, spec.type === 'lvalue' || spec.type === 'lvalues');
    if (['expr', 'exprlist'].includes(spec.type)) escMirror(input);
    // Output: Enter inside a string goes to a new line (the string contains the line break); elsewhere Enter confirms the dialog
    if (spec.multiline) input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.defaultPrevented || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const a = input.selectionStart ?? input.value.length;
      if (openQuote(input.value.slice(0, a))) e.stopPropagation(); // the text area writes the line break
      else e.preventDefault();
    });
    if (['expr', 'exprlist', 'lvalue', 'lvalues'].includes(spec.type) && vars && vars.length) {
      const chips = h('div', { class: 'chips', 'aria-label': L('ui.availableVariables') });
      const put = (v) => {
        const s = input.selectionStart ?? input.value.length, e = input.selectionEnd ?? s;
        input.value = input.value.slice(0, s) + v + input.value.slice(e);
        input.focus(); input.setSelectionRange(s + v.length, s + v.length); input.dispatchEvent(new Event('input'));
      };
      const btns = vars.map((v) => h('button', { type: 'button', class: 'chip', tabindex: '-1', onclick: () => put(v) }, v));
      // at most two rows: the last chip «…» opens the list of the variables that do not fit
      const more = h('button', { type: 'button', class: 'chip more', tabindex: '-1', hidden: true, title: L('ui.otherVariables'), 'aria-label': L('ui.otherVariables'), onclick: (ev) => {
        const r = more.getBoundingClientRect();
        openPop(r.left, r.bottom + 4, h('div', { class: 'ctxmenu chipmenu' }, btns.filter((b) => b.hidden).map((b) => h('button', { type: 'button', onclick: () => { closePop(); put(b.textContent); } }, h('span', { class: 'mono' }, b.textContent)))));
        ev.stopPropagation();
      } }, '…');
      chips.append(...btns, more);
      const fit = () => {
        if (!chips.isConnected || !chips.offsetWidth || !btns.length) return;
        btns.forEach((b) => { b.hidden = false; }); more.hidden = true;
        // rows measured from the top of the list (the dialog can move while the list changes height)
        const top = (el) => Math.round(el.getBoundingClientRect().top - chips.getBoundingClientRect().top);
        const tops = [...new Set(btns.map(top))].sort((a, b) => a - b);
        if (tops.length <= 2) return;
        const row2 = tops[1];
        btns.forEach((b) => { if (top(b) > row2) b.hidden = true; });
        more.hidden = false;
        const shown = btns.filter((b) => !b.hidden);
        while (top(more) > row2 && shown.length) shown.pop().hidden = true;
      };
      if (window.ResizeObserver) new ResizeObserver(() => fit()).observe(chips);
      requestAnimationFrame(fit);
      wrap.append(chips);
    }
    const check = () => {
      const v = input.value;
      let err = '';
      if (spec.required && !String(v).trim()) err = '';
      else if (String(v).trim()) {
        try {
          if (spec.type === 'expr') E.parseExpr(v);
          // an array: the number of elements or, between braces, its initial values
          if (spec.type === 'exprlist' && spec.values && String(v).trim().startsWith('{')) { const lit = E.parseArrayLit(v); lit.leaves.forEach((x) => E.parseExpr(x)); }
          else if (spec.type === 'exprlist') E.splitTop(v).forEach((x, i) => { if (!x) throw new Error(L('ui.dimensionIsMissing', { value: i + 1 })); E.parseExpr(x); });
          if (spec.type === 'lvalue') E.parseLValue(v);
          if (spec.type === 'lvalues') E.parseLValueList(v);
          if (spec.type === 'names') {
            for (const n of v.split(',').map((x) => x.trim())) {
              if (!n) throw new Error(L('ui.emptyNameBetweenTwoCommas'));
              if (!E.validIdent(n)) throw new Error(L('ui.isNotAValidNameUse', { n }));
              if (E.RESERVED.has(n.toLowerCase())) throw new Error(L('run.isAReservedWord', { n }));
            }
          }
          if (spec.type === 'ident') {
            if (!E.validIdent(v.trim())) throw new Error(L('ui.useLettersDigitsAndAndStart'));
            if (E.RESERVED.has(v.trim().toLowerCase())) throw new Error(L('ui.itIsAReservedWord'));
          }
        } catch (e) { err = e.message; }
      }
      msg.textContent = err || spec.hint || '';
      wrap.classList.toggle('bad', !!err);
      return err;
    };
    input.addEventListener('input', check);
    if (String(val ?? '').trim()) setTimeout(check, 0);
    wrap._get = () => input.value;
    wrap._check = () => {
      const e = check();
      if (e) return `${spec.label}: ${e}`;
      if (spec.required && !String(input.value).trim()) return L('ui.fillInTheField', { label: spec.label });
      return '';
    };
    wrap._input = input;
    return wrap;
  }

  const TYPE_OPTS = E.TYPES.map((t) => [t, TYPE_IT[t]]);
  const STMT_FORMS = {
    declare: { title: L('ui.declaration'), help: L('ui.createsOneOrMoreVariablesSeparate'), fields: [
      { key: 'name', label: L('ui.variableNames'), type: 'names', required: true, placeholder: L('ui.eGABTotal') },
      { key: 'type', label: L('win.type'), type: 'seg', options: TYPE_OPTS },
      { key: 'array', label: L('ui.arrayListOfValuesWithIndex'), type: 'check' },
      // array: the number of elements or its initial values between braces (which give the size too)
      { key: 'size', label: L('ui.numberOfElementsOrInitialValues'), type: 'exprlist', values: true, placeholder: L('ui.eG10Or34Or123'), hint: L('ui.theNumberOfElementsOrTheValues'), showIf: 'array' },
      { key: 'init', label: L('ui.initialValueOptional'), type: 'expr', placeholder: 'es. 0', hint: L('ui.withSeveralNamesAllTheVariables'), showIf: '!array' }] },
    const: { title: L('chart.constant'), help: L('ui.aNamedValueThatDoesNot'), fields: [
      { key: 'name', label: L('ui.constantName'), type: 'ident', required: true, placeholder: L('ui.eGMax') },
      { key: 'type', label: L('win.type'), type: 'seg', options: TYPE_OPTS },
      { key: 'expression', label: L('win.value'), type: 'expr', required: true, placeholder: 'es. 100' }] },
    assign: { title: L('ui.assignment'), help: L('ui.evaluatesTheExpressionAndPutsThe'), fields: [
      { key: 'variable', label: L('ui.variable'), type: 'lvalues', required: true, placeholder: L('ui.eGXOrVI'), hint: L('ui.forAFunctionThatReturnsSeveral') },
      { key: 'expression', label: L('ui.expression'), type: 'expr', required: true, placeholder: 'es. x + 1' }] },
    input: { title: 'Input', help: L('ui.asksTheUserForAValue'), fields: [
      { key: 'variable', label: L('ui.variableToRead'), type: 'lvalue', required: true }] },
    output: { title: 'Output', help: L('ui.writesAValueToTheConsole'), fields: [
      { key: 'expression', label: L('ui.expressionToWrite'), type: 'expr', required: true, placeholder: L('ui.eGTotalTotal'), multiline: true, hint: L('ui.enterInsideAStringGoesTo') },
      { key: 'newline', label: L('ui.newLineAfterWriting'), type: 'check' }] },
    if: { title: L('chart.if'), help: L('ui.choosesTheTrueOrFalseBranch'), fields: [
      { key: 'expression', label: L('ui.condition'), type: 'expr', required: true, placeholder: 'es. eta >= 18' }] },
    while: { title: L('chart.while'), help: L('ui.repeatsTheBodyWhileTheCondition'), fields: [
      { key: 'expression', label: L('ui.condition'), type: 'expr', required: true, placeholder: L('ui.eGI10') }] },
    do: { title: L('chart.doWhile'), help: L('ui.runsTheBodyAtLeastOnce'), fields: [
      { key: 'expression', label: L('ui.condition'), type: 'expr', required: true, placeholder: 'es. risposta != 0' }] },
    for: { title: L('ui.forCountingLoop'), help: L('ui.theVariableGoesFromTheStart'), fields: [
      { key: 'variable', label: L('ui.counterVariable'), type: 'lvalue', required: true, placeholder: L('ui.eGI') },
      { key: 'start', label: L('ui.startValue'), type: 'expr', required: true, inline: true },
      { key: 'end', label: L('ui.endValue'), type: 'expr', required: true, inline: true },
      { key: 'direction', label: L('ui.direction'), type: 'seg', options: [['inc', L('ui.increasing')], ['dec', L('ui.decreasing')]] },
      { key: 'step', label: L('ui.step'), type: 'expr', required: true, inline: true }] },
    call: { title: L('ui.call'), help: L('ui.runsAFunctionDefinedInThe'), fields: [
      { key: 'expression', label: L('ui.call'), type: 'expr', required: true, placeholder: L('ui.eGPrintV') }] },
    comment: { title: L('chart.comment'), help: L('ui.aNoteForTheReaderIt'), fields: [
      { key: 'text', label: L('ui.text'), type: 'textarea' }] },
    breakpoint: { title: L('ui.breakpoint'), help: L('ui.pausesTheProgramToLookAt'), fields: [
      { key: 'always', label: L('ui.alwaysStop'), type: 'check' },
      { key: 'expression', label: L('ui.stopOnlyIf'), type: 'expr', placeholder: L('ui.eGI5'), showIf: '!always' }] },
    open: { title: L('chart.openFile'), help: L('ui.filesAreInTheFilesTab'), fields: [
      { key: 'expression', label: L('ui.fileName'), type: 'expr', required: true, placeholder: L('ui.eGDataTxt') },
      { key: 'mode', label: L('ui.mode'), type: 'seg', options: [['read', L('ui.read')], ['write', L('ui.write')]] }] },
    close: { title: L('chart.closeFile'), fields: [
      { key: 'mode', label: L('ui.fileToClose'), type: 'seg', options: [['read', L('ui.reading')], ['write', L('ui.writing')]] }] },
    read: { title: L('chart.readFromFile'), help: L('ui.readsTheNextLineOfThe'), fields: [
      { key: 'variable', label: L('ui.variable'), type: 'lvalue', required: true }] },
    write: { title: L('chart.writeToFile'), help: L('ui.addsALineToTheFile'), fields: [
      { key: 'expression', label: L('ui.expression'), type: 'expr', required: true }] },
    throw: { title: L('ui.throwThrowsAnException'), help: L('ui.interruptsTheProgramWithAnException'), fields: [
      { key: 'expression', label: 'Exception', type: 'expr', required: true, placeholder: 'new Exception("message")', hint: L('ui.itIsCreatedWithNewAnd') }] },
  };
  /* exception types: the predefined ones and (Objects view) the classes that inherit from Exception */
  const excTypes = () => [...M.EXC_CLASSES.map((c) => c.name), ...(M.hasClasses(st.prog) ? st.prog.classes.filter((c) => M.isExcClass(st.prog, c)).map((c) => c.name) : [])];
  const excDoc = (n) => { const b = M.excClass(n); return b ? b.doc : L('ui.programClass'); };
  /* Try: Catch branches (type and variable), optional Finally */
  function tryDialog(s, isNew, done) {
    const cats = (s.catches || []).map((c) => ({ ...c }));
    let hasF = !!s.hasFinally;
    const body = h('div', { class: 'fields' }, h('p', { class: 'help' }, L('ui.theBlocksInsideTheTryAre')));
    const list = h('div', { class: 'params' });
    const draw = () => {
      list.innerHTML = '';
      if (!cats.length) list.append(h('p', { class: 'muted small' }, L('ui.noCatchTheExceptionContinuesAfter')));
      cats.forEach((c, i) => {
        const sel = h('select', { 'aria-label': L('ui.catchType') + (i + 1), onchange: (e) => { c.type = e.target.value; } }, excTypes().map((t) => h('option', { value: t, selected: t.toLowerCase() === String(c.type).toLowerCase(), title: excDoc(t) }, t)));
        const nm = h('input', { type: 'text', class: 'mono', value: c.variable, 'aria-label': L('ui.catchVariable') + (i + 1), placeholder: 'e', oninput: (e) => { c.variable = e.target.value.trim(); } });
        list.append(h('div', { class: 'prow catchrow' }, h('span', { class: 'ckw' }, 'Catch'), sel, nm,
          h('button', { class: 'iconbtn', type: 'button', title: L('ui.moveUpTheCatchesAreChecked'), 'aria-label': L('ui.moveUp'), disabled: i === 0, onclick: () => { cats.splice(i - 1, 0, cats.splice(i, 1)[0]); draw(); } }, '↑'),
          h('button', { class: 'iconbtn', type: 'button', title: L('ui.removeWithItsBlocks'), 'aria-label': L('ui.removeTheCatch'), onclick: () => { cats.splice(i, 1); draw(); } }, '✕')));
      });
    };
    draw();
    const finW = field({ key: 'fin', label: L('ui.finallyBlocksAlwaysRunAtThe'), type: 'check' }, hasF);
    body.append(h('div', { class: 'flabel' }, L('ui.catchCheckedInOrderMoreSpecific')), list,
      h('button', { class: 'btn small', type: 'button', onclick: () => { const used = cats.map((c) => c.type); cats.push(M.makeCatch({ type: excTypes().find((t) => !used.includes(t)) || 'Exception' })); draw(); } }, L('ui.addCatch')),
      finW, h('p', { class: 'muted small', style: 'margin:0' }, L('ui.inTheCatchEMessaggioIs')));
    openModal({
      title: (isNew ? L('ui.newBlock') : '') + 'Try', body, okText: isNew ? L('ui.add') : L('ui.save'), wide: true,
      onOk: () => {
        hasF = finW._get();
        if (!cats.length && !hasF) return L('ui.aTryHasAtLeastOne');
        const own = declaredNames(func());
        const catchVars = new Set(); M.walk(func().body, (x) => { if (x.kind === 'try') (x.catches || []).forEach((c) => catchVars.add(c.variable.toLowerCase())); });
        for (const [i, c] of cats.entries()) {
          if (!E.validIdent(c.variable)) return L('ui.catchIsNotAValidVariable', { value: i + 1, value2: c.variable || L('ui.empty') });
          if (own.some((n) => n.toLowerCase() === c.variable.toLowerCase()) && !catchVars.has(c.variable.toLowerCase())) return L('ui.catchIsAlreadyAVariableOf', { value: i + 1, variable: c.variable });
          // a Catch after one of a more general type would never be reached (in Java it is an error)
          const prev = cats.slice(0, i).find((p) => M.isSubclass(st.prog, M.classByName(st.prog, c.type), M.classByName(st.prog, p.type)));
          if (prev) return L('ui.theCatchWouldNeverRunIt', { type: c.type, type2: prev.type, type3: c.type });
        }
        done({ catches: cats, hasFinally: hasF, finally: hasF ? (s.finally || []) : [] });
        return true;
      },
    });
  }

  function stmtDialog(s, isNew, done) {
    if (s.kind === 'try') { tryDialog(s, isNew, done); return; }
    let form = STMT_FORMS[s.kind];
    if (s.kind === 'throw' && isNew && !s.expression) s = { ...s, expression: 'new Exception("")' };
    // in the Objects view variables of class type can be declared
    if (s.kind === 'declare' && (M.hasClasses(st.prog) || (func().tparams || []).length)) form = { ...form, fields: form.fields.map((f) => (f.key === 'type' ? { ...f, type: 'typepick', ctx: typeCtx(func()) } : f)) };
    const vars = declaredNames(func());
    const body = h('div', { class: 'fields' });
    if (form.help) body.append(h('p', { class: 'help' }, form.help));
    const ws = {};
    const row = h('div', { class: 'row' });
    for (const spec of form.fields) {
      // an array with initial values shows them in the field of the size
      const arrVals = s.kind === 'declare' && s.array && String(s.init || '').trim();
      const val = arrVals && spec.key === 'size' ? s.init : arrVals && spec.key === 'init' ? '' : s[spec.key];
      const w = field(spec, val, vars);
      ws[spec.key] = w;
      if (spec.inline) { row.append(w); if (!row.parentNode) body.append(row); } else body.append(w);
    }
    const sync = () => {
      for (const spec of form.fields) if (spec.showIf) {
        const neg = spec.showIf.startsWith('!'); const k = spec.showIf.replace('!', '');
        const on = ws[k]._get(); ws[spec.key].hidden = neg ? on : !on;
      }
    };
    body.addEventListener('change', sync); sync();
    // Throw: quick choice of the exception type (changes the new Type(...) part of the expression)
    if (s.kind === 'throw') {
      const inp = ws.expression._input;
      const cur = (/^\s*new\s+([\p{L}_][\p{L}\p{N}_]*)/u.exec(s.expression || '') || [])[1] || '';
      const sel = h('select', { id: 'f_exctype', 'aria-label': L('ui.exceptionType'), onchange: (e) => {
        const t = e.target.value, v = inp.value;
        inp.value = /^\s*new\s+[\p{L}_][\p{L}\p{N}_]*/u.test(v) ? v.replace(/^\s*new\s+[\p{L}_][\p{L}\p{N}_]*/u, 'new ' + t) : `new ${t}("")`;
        inp.dispatchEvent(new Event('input')); inp.focus();
      } }, excTypes().map((t) => h('option', { value: t, selected: t.toLowerCase() === cur.toLowerCase(), title: excDoc(t) }, `${t} — ${excDoc(t)}`)));
      body.insertBefore(h('div', { class: 'field' }, h('label', { class: 'flabel', for: 'f_exctype' }, L('ui.exceptionType')), sel), ws.expression);
    }
    openModal({
      title: (isNew ? L('ui.newBlock') : '') + form.title, body, okText: isNew ? L('ui.add') : L('ui.save'),
      onOk: () => {
        const vals = {};
        for (const spec of form.fields) {
          if (ws[spec.key].hidden) { vals[spec.key] = spec.type === 'check' ? false : (spec.key === 'size' || spec.key === 'init' ? '' : s[spec.key]); continue; }
          const e = ws[spec.key]._check ? ws[spec.key]._check() : '';
          if (e) return e;
          vals[spec.key] = ws[spec.key]._get();
          if (typeof vals[spec.key] === 'string' && spec.type !== 'textarea') vals[spec.key] = vals[spec.key].trim();
        }
        if (s.kind === 'declare') {
          // the field of the size can hold the initial values {…}: then they are the values and the size comes from them
          if (vals.array && String(vals.size).trim().startsWith('{')) { vals.init = String(vals.size).trim(); vals.size = ''; }
          if (vals.array && !String(vals.size).trim() && !vals.init) return L('ui.enterTheNumberOfElementsOrThe');
        }
        if (s.kind === 'declare') vals.name = vals.name.split(',').map((x) => x.trim()).join(', ');
        if (s.kind === 'breakpoint' && !vals.always && !String(vals.expression || '').trim()) return L('ui.writeAConditionOrChooseAlways');
        done(vals);
        return true;
      },
    });
  }

  /* Functions */
  // shape of a parameter or of a return value: single value or array with 1…5 dimensions
  const SHAPES = [[0, L('run.value')], [1, 'array [ ]'], [2, L('ui.matrix')], [3, L('ui.3Dimensions')], [4, L('ui.4Dimensions')], [5, L('ui.5Dimensions')]];
  /* opts (Objects view, new method): { cls, ctor } */
  function editFunction(index, opts) {
    const isNew = index == null;
    const f = isNew ? M.makeFunction('') : st.prog.functions[index];
    const oo = isOO() && M.hasClasses(st.prog);
    const cls = oo ? (isNew ? opts.cls : M.classOf(st.prog, f)) : null;
    if (roGuard(cls) || (!isNew && roFunc(f))) return;
    const ctor = oo && (isNew ? !!(opts && opts.ctor) : !!f.ctor);
    const params = f.params.map((p) => ({ ...p }));
    const body = h('div', { class: 'fields' });
    const what = ctor ? L('uml.constructor') : oo ? L('uml.method') : L('ui.function2');
    if (ctor) body.append(h('p', { class: 'help' }, L('ui.theConstructorPreparesANewObject', { name: cls.name, name2: cls.name, text: cls.parent ? L('ui.theFirstBlockCanBeThe', { parent: cls.parent }) : '' })));
    const nameW = field({ key: 'fname', label: ctor ? L('ui.nameItIsTheClassName') : oo ? L('ui.methodName') : L('ui.functionName'), type: 'ident', required: true, placeholder: L('ui.eGMaximum') }, ctor ? cls.name : f.name);
    if (ctor) nameW._input.disabled = true;
    const rets = ctor ? [] : M.rets(f).map((r) => ({ ...r }));
    body.append(nameW);
    let visW = null, statW = null, absW = null;
    if (oo) {
      visW = field({ key: 'fvis', label: L('ui.access'), type: 'seg', options: VIS_OPTS }, isNew ? 'public' : (f.visibility || 'public'));
      body.append(visW);
      if (!ctor) { statW = field({ key: 'fstatic', label: L('ui.staticCalledWith') + cls.name + L('ui.nameWithoutCreatingAnObject'), type: 'check' }, isNew ? cls === M.mainClass(st.prog) : !!f.static); body.append(statW); }
      if (!ctor && cls !== M.mainClass(st.prog)) {
        // abstract: without body, the subclasses define it (the class becomes abstract)
        absW = field({ key: 'fabs', label: L('ui.abstractNoBodyTheSubclassesDefine'), type: 'check' }, !isNew && !!f.abstract);
        body.append(absW);
        const syncAbs = () => { const a = absW._get(); statW._input.disabled = a; if (a) statW._input.checked = false; };
        absW._input.addEventListener('change', syncAbs); syncAbs();
      }
    }
    // Generic Types: in the parameters a new one can be created; in the return values the existing ones are used
    const mainCls = oo && cls === M.mainClass(st.prog);
    const isInstance = () => oo && (ctor || !(statW && statW._get()) || !!(absW && absW._get()));
    const dialogGens = (withRets) => genNamesIn([...params.map((p) => p.type), ...(withRets ? rets.map((r) => r.type) : [])], [...(f.tparams || []), ...(cls ? cls.tparams || [] : [])]);
    const gensNow = () => (isInstance() ? orderGen(cls.tparams, genNamesIn([...classTypes(cls, f), ...params.map((p) => p.type)], cls.tparams)) : orderGen(f.tparams, dialogGens(false)));
    const genCtx = (forParam) => ({ gens: gensNow(), allowNew: forParam && !(isInstance() && mainCls), taken: () => [...gensNow(), ...dialogGens(true), ...(cls ? cls.tparams || [] : [])] });
    let genKey = '';
    const regen = () => { const k = gensNow().join(',') + '|' + isInstance(); if (k !== genKey) { genKey = k; drawParams(); drawRets(); } };
    if (statW) statW._input.addEventListener('change', regen);
    if (absW) absW._input.addEventListener('change', regen);
    const plist = h('div', { class: 'params' });
    const drawParams = () => {
      plist.innerHTML = '';
      if (!params.length) plist.append(h('p', { class: 'muted small' }, L('ui.noParameters')));
      params.forEach((p, i) => {
        const nm = h('input', { type: 'text', class: 'mono', value: p.name, 'aria-label': L('ui.parameterName') + (i + 1), placeholder: 'nome', oninput: (e) => { p.name = e.target.value.trim(); } });
        const tp = typePicker(p.type, genCtx(true), (t) => { p.type = t; regen(); }, L('ui.parameterType') + (i + 1)).el;
        const shape = p.array ? (p.dims || 1) : 0;
        const arr = h('select', { 'aria-label': L('ui.parameterShape') + (i + 1), title: L('ui.singleValueOrArray'), onchange: (e) => { const d = +e.target.value; p.array = d > 0; p.dims = Math.max(1, d); } }, SHAPES.map(([v, l]) => h('option', { value: v, selected: v === shape }, l)));
        plist.append(h('div', { class: 'prow' }, nm, tp, arr,
          h('button', { class: 'iconbtn', type: 'button', title: L('ui.moveUp'), 'aria-label': L('ui.moveUp'), disabled: i === 0, onclick: () => { params.splice(i - 1, 0, params.splice(i, 1)[0]); drawParams(); } }, '↑'),
          h('button', { class: 'iconbtn', type: 'button', title: L('ui.remove'), 'aria-label': L('ui.removeParameter'), onclick: () => { params.splice(i, 1); drawParams(); } }, '✕')));
      });
    };
    drawParams();
    body.append(h('div', { class: 'flabel' }, L('ui.parameters')), plist,
      h('button', { class: 'btn small', type: 'button', onclick: () => { params.push({ name: '', type: 'Integer', array: false }); drawParams(); plist.querySelector('.prow:last-child input').focus(); } }, L('ui.addParameter')));
    // return values: none = procedure, one = classic function, more than one = as in Python
    const rlist = h('div', { class: 'params' });
    // methods: an attribute of the class can be returned (also inherited, if not private)
    const retAttrs = oo && !ctor ? retAttributes(cls) : [];
    const attrOf = (n) => retAttrs.find((x) => x.attr.name.toLowerCase() === String(n).toLowerCase());
    const dlId = 'retattrs_' + Math.random().toString(36).slice(2);
    const drawRets = () => {
      rlist.innerHTML = '';
      if (!rets.length) rlist.append(h('p', { class: 'muted small' }, L('ui.noValueItIsAProcedure')));
      rets.forEach((r, i) => {
        const tpk = typePicker(r.type, genCtx(false), (t) => { r.type = t; }, L('ui.returnValueType') + (i + 1)), tp = tpk.el;
        // a return value can be an array too, like the parameters
        const arr = h('select', { 'aria-label': L('ui.returnValueShape') + (i + 1), title: L('ui.singleValueOrArray'), onchange: (e) => { const d = +e.target.value; r.array = d > 0; r.dims = Math.max(1, d); if (!r.array) delete r.dims; } }, SHAPES.map(([v, l]) => h('option', { value: v, selected: v === (r.array ? r.dims || 1 : 0) }, l)));
        const tag = h('span', { class: 'rtag', title: L('ui.itIsAnAttributeOfThe') }, L('ui.attribute'));
        // choosing an attribute, the type and the shape are its own and do not change
        const syncAttr = () => {
          const a = attrOf(r.name);
          if (a) {
            r.type = a.attr.type; tpk.set(a.attr.type);
            if (a.attr.array) { r.array = true; r.dims = E.splitTop(a.attr.size).length || 1; } else { r.array = false; delete r.dims; }
            arr.value = String(r.array ? r.dims : 0);
          }
          tpk.setDisabled(!!a); arr.disabled = !!a; tag.hidden = !a;
        };
        const nm = h('input', { type: 'text', class: 'mono', value: r.name, list: retAttrs.length ? dlId : null, 'aria-label': L('ui.returnedVariable') + (i + 1), placeholder: retAttrs.length ? L('ui.variableOrAttribute') : L('ui.variable2'), oninput: (e) => { r.name = e.target.value.trim(); syncAttr(); } });
        syncAttr();
        rlist.append(h('div', { class: 'prow rrow' }, h('div', { class: 'rname' }, nm, tag), tp, arr,
          h('button', { class: 'iconbtn', type: 'button', title: L('ui.moveUp'), 'aria-label': L('ui.moveUp'), disabled: i === 0, onclick: () => { rets.splice(i - 1, 0, rets.splice(i, 1)[0]); drawRets(); } }, '↑'),
          h('button', { class: 'iconbtn', type: 'button', title: L('ui.remove'), 'aria-label': L('ui.removeReturnValue'), onclick: () => { rets.splice(i, 1); drawRets(); } }, '✕')));
      });
    };
    drawRets();
    genKey = gensNow().join(',') + '|' + isInstance();
    if (retAttrs.length) body.append(h('datalist', { id: dlId }, retAttrs.map((x) => h('option', { value: x.attr.name }, L('ui.attribute2', { text: x.owner === cls ? '' : 'di ' + x.owner.name + ' ', type: E.typeName(x.attr.type), text2: x.attr.array ? `[${','.repeat(E.splitTop(x.attr.size).length - 1)}]` : '' })))));
    if (!ctor) body.append(h('div', { class: 'flabel' }, L('ui.returnValues')), h('p', { class: 'muted small', style: 'margin:0' }, L('ui.theVariablesMustBeDeclaredIn', { text: oo ? L('chart.ofTheMethod') : L('chart.ofTheFunction'), text2: retAttrs.length ? L('ui.youCanAlsoChooseAnAttribute') : '', text3: oo ? 'obj.metodo' : L('ui.function'), text4: oo ? 'obj.metodo' : L('ui.function') })), rlist,
      h('button', { class: 'btn small', type: 'button', onclick: () => { rets.push({ name: '', type: 'Integer' }); drawRets(); rlist.querySelector('.prow:last-child input').focus(); } }, L('ui.addReturnValue')));
    openModal({
      title: isNew ? (ctor ? L('ui.newConstructorOf', { name: cls.name }) : oo ? L('ui.newMethodIn', { name: cls.name }) : L('ui.newFunction')) : L('ui.edit2', { what }), body, okText: isNew ? L('ui.create') : L('ui.save'), wide: true,
      onOk: () => {
        const e1 = nameW._check(); if (e1) return e1;
        const name = ctor ? cls.name : nameW._get().trim();
        if (name.toLowerCase() === 'main') return L('ui.theNameMainIsReservedFor');
        // a method can have the name of a built-in function (it is called with obj.name() or this.name());
        // the functions and methods of the main class cannot
        const plainFn = !oo || cls === M.mainClass(st.prog);
        if (E.BUILTINS[name.toLowerCase()] && plainFn) return L('ui.isAlreadyABuiltInFunction', { name });
        const isAbs = !!(absW && absW._get());
        const isStatic = !ctor && !isAbs && !!(statW && statW._get());
        // in Java toString() overrides the one of Object: public, non-static, returns a String
        if (oo && !ctor && name === 'toString' && !params.length) {
          const vis = visW ? visW._get() : 'public';
          if (vis !== 'public' || isStatic || rets.length !== 1 || rets[0].type !== 'String') return L('ui.tostringMustBePublicNotStatic');
        }
        if (isAbs && visW && visW._get() === 'private') return L('ui.anAbstractMethodCannotBePrivate');
        if (oo) {
          const sigOf = (list) => list.map((p) => p.type.toLowerCase() + (p.array ? '[' + (p.dims || 1) : '')).join(',');
          if (!ctor && name.toLowerCase() === cls.name.toLowerCase()) return L('ui.isTheNameOfTheClass', { name });
          const clash = M.membersOf(st.prog, cls).find((g) => g !== f && !!g.ctor === ctor && g.name.toLowerCase() === name.toLowerCase() && sigOf(g.params) === sigOf(params));
          if (clash) return ctor ? L('ui.aConstructorWithTheSameParameter') : L('ui.aMethodWithTheSameParameter', { name });
          if (!ctor) for (const k of M.chainOf(st.prog, cls).slice(1)) {
            const g = M.membersOf(st.prog, k).find((x) => !x.ctor && x.name.toLowerCase() === name.toLowerCase() && sigOf(x.params) === sigOf(params));
            if (!g) continue;
            if (!!g.static !== isStatic) return L('ui.alreadyExistsInAsAMethod', { name, name2: k.name, text: g.static ? L('ui.static') : L('ui.nonStatic') });
            const rt = (l) => l.map((r) => r.type + (r.array ? `[${','.repeat((r.dims || 1) - 1)}]` : '')).join(',');
            if (rt(M.rets(g)) !== rt(rets)) return L('ui.overridesTheMethodOfItMust', { name, name2: k.name, value: M.rets(g).map((r) => E.typeName(r.type) + (r.array ? `[${','.repeat((r.dims || 1) - 1)}]` : '')).join(', ') || L('win.noValue') });
            break;
          }
        } else if (st.prog.functions.some((g, i) => i !== index && g.name.toLowerCase() === name.toLowerCase())) return L('ui.aFunctionCalledAlreadyExists', { name });
        const rseen = new Set();
        for (const r of rets) {
          if (!E.validIdent(r.name)) return L('ui.returnValueInvalidVariableName', { value: r.name || L('ui.empty') });
          if (E.RESERVED.has(r.name.toLowerCase())) return L('run.isAReservedWord', { n: r.name });
          if (rseen.has(r.name)) return L('ui.theReturnedVariableIsRepeated', { name: r.name });
          rseen.add(r.name);
          if (oo && !ctor) {
            const a = M.chainOf(st.prog, cls).flatMap((k) => k.attributes.map((x) => ({ attr: x, owner: k }))).find((x) => x.attr.name.toLowerCase() === r.name.toLowerCase());
            if (a && a.owner !== cls && a.attr.visibility === 'private') return L('ui.isAPrivateAttributeOfCannot', { name: a.attr.name, name2: a.owner.name, name3: cls.name });
            if (a && isStatic && !a.attr.static) return L('ui.isAnInstanceAttributeAStatic', { name: a.attr.name });
          }
        }
        // Generic Types: of the class (non-static methods, constructors) or of the function
        const inst = isInstance();
        let tps = [], clsGen = null;
        if (inst) {
          const ch = classGenChange(cls, f, [...params.map((p) => p.type), ...rets.map((r) => r.type)]);
          if (ch.err) return ch.err; clsGen = ch;
        } else {
          tps = orderGen(f.tparams, dialogGens(false));
          const missing = dialogGens(true).filter((t) => !tps.includes(t) && !(cls && M.isTypeParam(cls, t)));
          if (missing.length) return L('ui.theGenericTypeOfAReturn', { list: missing.join(', ') });
          if (cls && dialogGens(true).some((t) => M.isTypeParam(cls, t))) return L('ui.cannotUseTheGenericTypesOf', { text: oo && !ctor ? L('ui.aStaticMethod') : L('ui.thisFunction'), cls: M.classTitle(cls) });
          // the method becomes static: the class may lose some Generic Types
          if (oo && cls) { const ch = classGenChange(cls, f, []); if (ch.err) return ch.err; clsGen = ch; }
        }
        const seen = new Set();
        for (const p of params) {
          if (!E.validIdent(p.name)) return L('ui.parameterInvalidName', { value: p.name || L('ui.empty') });
          if (seen.has(p.name)) return L('ui.theParameterIsRepeated', { name: p.name });
          seen.add(p.name);
        }
        mutate(() => {
          const target = isNew ? M.makeFunction(name, { params }) : f;
          Object.assign(target, { name, params });
          if (tps.length) target.tparams = tps; else delete target.tparams;
          if (clsGen) applyGen(cls, clsGen);
          if (oo) Object.assign(target, { cls: cls.id, visibility: visW ? visW._get() : 'public', static: isStatic || target === st.prog.functions[0], ctor, abstract: isAbs });
          // a returned attribute is written as it is declared (the languages are case-sensitive)
          for (const r of rets) { const a = attrOf(r.name); if (a) { r.name = a.attr.name; r.type = a.attr.type; } }
          if (isAbs && !cls.abstract) { cls.abstract = true; setTimeout(() => toast(L('ui.hasBecomeAnAbstractClassIt', { name: cls.name })), 0); }
          M.setRets(target, rets);
          // declares the returned variables that are not declared yet (grouped by type)
          const known = new Set(params.map((p) => p.name));
          // the returned attributes are not declared
          if (oo && !ctor) retAttributes(cls).forEach((x) => known.add(x.attr.name));
          M.walk(target.body, (x) => { if (x.kind === 'declare') x.name.split(',').forEach((n) => known.add(n.trim())); });
          const missing = rets.filter((r) => ![...known].some((k) => k.toLowerCase() === r.name.toLowerCase()));
          const decls = [];
          for (const r of missing) {
            const last = decls[decls.length - 1];
            // a returned array must be declared with its size: the block stays to be completed
            if (r.array) decls.push(M.makeStmt('declare', { name: r.name, type: r.type, array: true, size: '' }));
            else if (last && !last.array && last.type === r.type) last.name += ', ' + r.name;
            else decls.push(M.makeStmt('declare', { name: r.name, type: r.type }));
          }
          target.body.unshift(...decls);
          if (decls.some((d) => d.array)) setTimeout(() => toast(L('ui.enterTheNumberOfElementsOf2', { list: decls.filter((d) => d.array).map((d) => d.name).join(', ') })), 0);
          if (isNew) {
            st.prog.functions.push(target);
            // from the class diagram the new method stays selected; otherwise it opens
            if (isUml()) st.usel = { cls: cls.id, kind: 'method', fid: target.id };
            else st.fi = st.prog.functions.length - 1;
          }
        });
        return true;
      },
    });
  }
  function deleteFunction(target) {
    const f = target || func();
    const i = st.prog.functions.indexOf(f);
    if (i <= 0 || roFunc(f) || roGuard(M.hasClasses(st.prog) ? M.classOf(st.prog, f) : null)) return;
    const what = f.ctor ? L('ui.theConstructor', { name: f.name }) : isOO() ? L('ui.theMethod', { f: fname(f) }) : L('ui.theFunction', { name: f.name });
    // the class may lose a Generic Type used only by this method
    const owner = M.hasClasses(st.prog) ? M.classOf(st.prog, f) : null;
    const ch = owner ? classGenChange(owner, f, []) : {};
    if (ch.err) { infoBox(L('ui.methodWithGenericType'), ch.err); return; }
    confirmBox(f.ctor ? L('ui.deleteTheConstructor') : isOO() ? L('ui.deleteTheMethod') : L('ui.deleteTheFunction'), L('ui.andAllItsBlocksWillBe', { what }), L('ui.delete'), () => mutate(() => {
      st.prog.functions.splice(i, 1);
      applyGen(owner, ch);
      if (st.fi === i) { st.fi = 0; if (isOO()) st.uml = true; } else if (st.fi > i) st.fi--;
      if (st.usel && st.usel.fid === f.id) st.usel = { cls: st.usel.cls, kind: 'class' };
    }));
  }

  /* attributes that a method of the class can return: its own and the inherited non-private ones, arrays too */
  function retAttributes(cls) {
    const out = [];
    M.chainOf(st.prog, cls).forEach((k, i) => k.attributes.forEach((a) => { if (i === 0 || a.visibility !== 'private') out.push({ attr: a, owner: k }); }));
    return out;
  }

  /* ------------------------ Classes (Objects view) ------------------------ */
  const VIS_OPTS = [['public', L('ui.public')], ['private', L('ui.private')], ['protected', L('ui.protected')]];
  const sigOf = (list) => list.map((p) => p.type.toLowerCase() + (p.array ? '[' + (p.dims || 1) : '')).join(',');
  const descendants = (c) => st.prog.classes.filter((k) => k !== c && M.isSubclass(st.prog, k, c));
  /* replaces the name of a class in the expressions: new Old(...) and Old.member */
  function renameInExpr(src, old, nu) {
    let toks;
    try { toks = E.tokenize(String(src)); } catch (e) { return src; }
    let out = String(src);
    const lo = old.toLowerCase();
    for (let i = toks.length - 1; i >= 0; i--) {
      const t = toks[i];
      if (t.k !== 'id' || t.v.toLowerCase() !== lo) continue;
      const prev = toks[i - 1], next = toks[i + 1];
      if ((prev && prev.k === 'id' && prev.v.toLowerCase() === 'new') || (next && next.k === 'op' && next.v === '.')) out = out.slice(0, t.pos) + nu + out.slice(t.pos + t.v.length);
    }
    return out;
  }
  function renameClass(c, nu) {
    const old = c.name, lo = old.toLowerCase();
    if (old === nu) return;
    const T = (t) => { const g = E.splitType(t); return E.joinType(g.base.toLowerCase() === lo ? nu : g.base, g.args.map(T)); };
    for (const k of st.prog.classes) {
      if ((k.parent || '').toLowerCase() === lo) k.parent = nu;
      if (k.pargs) k.pargs = k.pargs.map(T);
      for (const a of k.attributes) { a.type = T(a.type); a.init = renameInExpr(a.init || '', old, nu); a.size = renameInExpr(a.size || '', old, nu); }
    }
    for (const f of st.prog.functions) {
      if (f.ctor && f.cls === c.id) f.name = nu;
      f.params.forEach((p) => { p.type = T(p.type); });
      M.setRets(f, M.rets(f).map((r) => ({ name: r.name, type: T(r.type) })));
      M.walk(f.body, (x) => {
        if (x.kind === 'declare' || x.kind === 'const') x.type = T(x.type);
        if (x.kind === 'try') for (const c of x.catches || []) c.type = T(c.type); // Catch of an exception of the program
        for (const k of ['expression', 'variable', 'start', 'end', 'step', 'size']) if (typeof x[k] === 'string') x[k] = renameInExpr(x[k], old, nu);
      });
    }
    c.name = nu;
  }
  /* classes and exceptions are two separate families: a class inherits only from classes, an exception
     (New exception…, Shift+E) only from exceptions, predefined or of the program */
  /* predefined exception: what it is for and how to inherit from it */
  function builtinInfo(name) {
    const k = M.excClass(name); if (!k) return;
    infoBox(L('ui.predefinedException', { name: k.name }), L('ui.itHasTheReadOnlyAttribute', { name: k.name, text: k.parent ? L('ui.inheritsFrom', { parent: k.parent }) : '', doc: k.doc, name2: k.name, name3: k.name, name4: k.name }));
  }
  function classDialog(c, pos, asExc, parentName) {
    const isNew = !c;
    if (c && roGuard(c)) return;
    const exc = c ? M.isExcClass(st.prog, c) : !!asExc;
    const what = exc ? L('chart.exception') : L('ui.class');
    const nameW = field({ key: 'cname', label: exc ? L('ui.exceptionName') : L('ui.className'), type: 'ident', required: true, placeholder: exc ? L('ui.eGInvalidgrade') : L('ui.eGPoint'), hint: L('ui.byConventionItStartsWithAn') }, c ? c.name : '');
    const banned = c ? [c, ...descendants(c)] : [];
    // a parent class with Generic Types (not for the exceptions): its types are chosen next to it (Lista<T>, Lista<Integer>)
    const mine = st.prog.classes.filter((k) => !banned.includes(k) && (exc ? !(k.tparams || []).length : true) && M.isExcClass(st.prog, k) === exc).map((k) => [k.name, exc ? k.name : M.classTitle(k)]);
    const parW = exc
      ? field({ key: 'cpar', label: L('ui.inheritsFromParentException'), type: 'select', options: [...M.EXC_CLASSES.map((k) => [k.name, L('ui.predefinedException2', { name: k.name })]), ...mine] }, c ? c.parent : parentName || 'Exception')
      : field({ key: 'cpar', label: L('ui.inheritsFromParentClass'), type: 'select', options: [['', L('ui.none')], ...mine] }, c ? (c.parent || '') : '');
    // type arguments of the parent class: base types, classes and the Generic Types of this class (also a new one)
    const pctx = { gens: c ? (c.tparams || []).slice() : [], allowNew: !(c && c === M.mainClass(st.prog)), taken: () => [...pctx.gens, ...pkids.map((k) => k.get())] };
    let pkids = [];
    const pargsEl = h('div', { class: 'tpargs pargs' });
    const drawPargs = (vals) => {
      pargsEl.innerHTML = ''; pkids = []; pctx._sels = new Set();
      const par = !exc && M.classByName(st.prog, parW._get());
      if (!par || !(par.tparams || []).length) { pargsEl.hidden = true; return; }
      pargsEl.hidden = false;
      par.tparams.forEach((t, i) => {
        const k = typePicker((vals || [])[i] || 'Integer', pctx, null, L('ui.typeOfInTheParentClass', { t, name: par.name }));
        pkids.push(k);
        pargsEl.append(h('span', { class: 'tparg' }, h('span', { class: 'tpname' }, t + ':'), k.el));
      });
    };
    if (!exc) { parW.append(pargsEl); drawPargs(c ? c.pargs : null); parW._input.addEventListener('change', () => drawPargs(null)); }
    const isMainCls = c && c === M.mainClass(st.prog);
    const absW = isMainCls ? null : field({ key: 'cabs', label: L('ui.abstractNoObjectsOfThisAre', { what }), type: 'check' }, c ? !!c.abstract : false);
    const help = exc ? L('ui.anExceptionReportsAnErrorIt')
      : L('ui.aClassDescribesAKindOf');
    const body = h('div', { class: 'fields' }, h('p', { class: 'help' }, help), nameW, parW, absW);
    openModal({
      title: isNew ? (exc ? L('ui.newException') : L('ui.newClass')) : L('ui.edit3', { what, name: c.name }), body, okText: isNew ? L('ui.create') : L('ui.save'),
      onOk: () => {
        const e1 = nameW._check(); if (e1) return e1;
        const name = nameW._get().trim();
        if (E.BUILTINS[name.toLowerCase()]) return L('ui.isTheNameOfABuilt', { name });
        if (st.prog.classes.some((k) => k !== c && k.name.toLowerCase() === name.toLowerCase())) return L('ui.aClassCalledAlreadyExists', { name });
        if (M.excClass(name)) return L('ui.isAPredefinedExceptionChooseAnother', { name, text: exc ? '' : L('ui.forYourOwnExceptionUseNew') });
        const parent = parW._get();
        const abs = !!(absW && absW._get());
        // the Generic Types of the class come from the attributes, the methods and the types given to the parent class
        const pargs = parent && !exc ? pkids.map((k) => k.get()) : [];
        const tps = c ? c.tparams || [] : [];
        const ntps = orderGen(tps, genNamesIn([...(c ? classTypes(c, 'pargs') : []), ...pargs], tps));
        let subs = [];
        if (ntps.join(',') !== tps.join(',')) {
          if (c && c === M.mainClass(st.prog)) return L('ui.isTheMainClassItCannot', { name: c.name });
          if (c && classUsed(c)) return L('ui.theSubclassWouldChangeItsGeneric', { name: c.name, c: M.classTitle(c), text: ntps.length ? `${c.name}<${ntps.join(', ')}>` : c.name });
          if (c) { const r = subGenChange(c, tps, ntps); if (r.err) return r.err; subs = r; }
        }
        if ((!c || c.name !== name) && /^[A-Z][0-9]*$/.test(name)) return L('ui.isANameReservedForGeneric', { name });
        if (c && !abs) { const am = M.membersOf(st.prog, c).filter((f) => f.abstract); if (am.length) return L('ui.hasAbstractMethodsToMakeIt', { name: c.name, list: am.map((f) => f.name + '()').join(', ') }); }
        // the attributes cannot have the same name as those of the new parent class
        if (parent) {
          const up = new Set(); M.chainOf(st.prog, M.classByName(st.prog, parent)).forEach((k) => k.attributes.forEach((a) => up.add(a.name.toLowerCase())));
          for (const k of c ? [c, ...descendants(c)] : []) for (const a of k.attributes) if (up.has(a.name.toLowerCase())) return L('ui.theAttributeHasTheSameName', { name: k.name, name2: a.name, parent });
        }
        mutate(() => {
          if (isNew) {
            const nc = M.makeClass(name, Object.assign({ parent, abstract: abs, tparams: ntps }, pargs.length ? { pargs } : {}, UmlLib.freeSpot(st.prog, pos)));
            st.prog.classes.push(nc);
            st.usel = { cls: nc.id, kind: 'class' };
          } else {
            renameClass(c, name); c.parent = parent; c.abstract = abs;
            if (pargs.length) c.pargs = pargs; else delete c.pargs;
            applyGen(c, { nu: ntps, subs });
          }
        });
        return true;
      },
    });
  }
  function attrDialog(c, index) {
    const isNew = index == null;
    if (roGuard(c)) return;
    const a = isNew ? M.makeAttribute() : c.attributes[index];
    const nameW = field({ key: 'aname', label: L('ui.attributeName'), type: 'ident', required: true, placeholder: L('ui.eGRadius') }, a.name);
    // an instance attribute can have a Generic Type: the class becomes Class<T>
    const actx = { gens: c.tparams || [], allowNew: !isMainClsOf(c), taken: () => [...(c.tparams || []), ...genNamesIn([typeW._get()], c.tparams)] };
    const typeW = field({ key: 'atype', label: L('win.type'), type: 'typepick', ctx: actx }, a.type);
    const arrW = field({ key: 'aarr', label: 'Array', type: 'check' }, a.array);
    const sizeW = field({ key: 'asize', label: L('ui.numberOfElements'), type: 'exprlist', placeholder: L('ui.eG10Or342') }, a.size);
    const visW = field({ key: 'avis', label: L('ui.access'), type: 'seg', options: VIS_OPTS }, a.visibility);
    const statW = field({ key: 'astat', label: L('ui.staticOnlyOneForTheWhole'), type: 'check' }, a.static);
    const initW = field({ key: 'ainit', label: L('ui.initialValueOptional'), type: 'expr', placeholder: L('ui.ifEmpty0FalseOrNull'), hint: L('ui.everyNewObjectStartsFromThis') }, a.init || '');
    const body = h('div', { class: 'fields' }, nameW, typeW, arrW, sizeW, visW, statW, initW);
    const sync = () => { sizeW.hidden = !arrW._get(); initW.hidden = arrW._get(); };
    body.addEventListener('change', sync); sync();
    openModal({
      title: isNew ? L('ui.newAttributeIn', { name: c.name }) : L('ui.editAttribute', { name: c.name, name2: a.name }), body, okText: isNew ? L('ui.add') : L('ui.save'),
      onOk: () => {
        for (const w of [nameW, initW]) { if (w.hidden) continue; const e = w._check(); if (e) return e; }
        const name = nameW._get().trim(), lo = name.toLowerCase();
        const arr = arrW._get();
        if (arr) { const e = sizeW._check(); if (e) return e; if (!String(sizeW._get()).trim()) return L('ui.enterTheNumberOfElementsOf'); }
        for (const k of [...M.chainOf(st.prog, c), ...descendants(c)]) for (const x of k.attributes) if (x !== a && x.name.toLowerCase() === lo) return k === c ? L('ui.theClassAlreadyHasAnAttribute', { name: x.name }) : L('ui.alreadyHasAnAttributeInThe', { name: k.name, name2: x.name });
        const ty = typeW._get();
        if (statW._get() && genNamesIn([ty], c.tparams).length) return L('ui.aStaticAttributeCannotHaveA');
        const ch = classGenChange(c, a, statW._get() ? [] : [ty]);
        if (ch.err) return ch.err;
        mutate(() => {
          applyGen(c, ch);
          Object.assign(a, { name, type: ty, array: arr, size: arr ? sizeW._get().trim() : '', visibility: visW._get(), static: statW._get(), init: arr ? '' : initW._get().trim() });
          if (isNew) c.attributes.push(a);
          st.usel = { cls: c.id, kind: 'attr', i: c.attributes.indexOf(a) };
        });
        return true;
      },
    });
  }
  function deleteClass(c) {
    if (c.module) { removeModule(c.module.name); return; }
    if (c === M.mainClass(st.prog)) { infoBox(L('ui.mainClass'), L('ui.isTheMainClassItContains', { name: c.name })); return; }
    const kids = st.prog.classes.filter((k) => (k.parent || '').toLowerCase() === c.name.toLowerCase());
    if (kids.length) { infoBox(L('ui.classWithSubclasses'), L('ui.firstRemoveTheInheritanceFromInherit', { list: kids.map((k) => k.name).join(', '), name: c.name })); return; }
    confirmBox(L('ui.deleteTheClass'), L('ui.theClassItsAttributesAndIts', { name: c.name, membersOfCount: M.membersOf(st.prog, c).length, name2: c.name }), L('ui.delete'), () => mutate(() => {
      const cur = func();
      st.prog.functions = st.prog.functions.filter((f) => f.cls !== c.id);
      st.prog.classes = st.prog.classes.filter((k) => k !== c);
      st.fi = Math.max(0, st.prog.functions.indexOf(cur));
      st.usel = null; st.uml = true;
    }));
  }
  function deleteAttr(c, i) {
    const a = c.attributes[i]; if (!a || roGuard(c)) return;
    const ch = classGenChange(c, a, []);
    if (ch.err) { infoBox(L('ui.attributeWithGenericType'), ch.err); return; }
    mutate(() => { c.attributes.splice(i, 1); applyGen(c, ch); st.usel = { cls: c.id, kind: 'class' }; });
    toast(L('ui.attributeDeletedCtrlZToUndo', { name: a.name }));
  }
  const uselClass = () => st.usel && M.classById(st.prog, st.usel.cls);
  function openMethod(fid) { const i = st.prog.functions.findIndex((f) => f.id === fid); if (i >= 0) showFunc(i); }
  function editMethodSig(f) { const i = st.prog.functions.indexOf(f); if (i === 0) editProgram(); else editFunction(i); }
  function editUmlSel() {
    const c = uselClass(); if (!c) return;
    if (st.usel.kind === 'attr') attrDialog(c, st.usel.i);
    else if (st.usel.kind === 'method') { const f = st.prog.functions.find((x) => x.id === st.usel.fid); if (f) editMethodSig(f); }
    else classDialog(c);
  }
  function deleteUmlSel() {
    const c = uselClass(); if (!c) return;
    if (st.usel.kind === 'attr') deleteAttr(c, st.usel.i);
    else if (st.usel.kind === 'method') { const f = st.prog.functions.find((x) => x.id === st.usel.fid); if (f && f !== st.prog.functions[0]) deleteFunction(f); else if (f) toast(L('ui.mainIsTheStartingPointOf'), 'warn'); }
    else deleteClass(c);
  }
  function memberMenu(c, x, y) {
    const box = h('div', { class: 'ctxmenu' },
      h('button', { type: 'button', onclick: () => { closePop(); editFunction(null, { cls: c, ctor: false }); } }, h('span', null, L('ui.newMethod')), h('kbd', null, 'M')),
      h('button', { type: 'button', onclick: () => { closePop(); editFunction(null, { cls: c, ctor: true }); } }, h('span', null, L('ui.newConstructor2')), h('kbd', null, 'C')));
    openPop(x, y, box);
  }
  function umlMenu(e) {
    const box = e.target.closest('.ubox'), row = e.target.closest('.urow');
    const c = box && M.classById(st.prog, box.dataset.cls);
    const B = (label, fn, cls, key) => h('button', { type: 'button', class: cls || '', onclick: () => { closePop(); fn(); } }, h('span', null, label), key ? h('kbd', null, key) : null);
    let menuBox;
    const modEl = e.target.closest('.umod');
    const bi = box && box.classList.contains('builtin') ? box.dataset.cls.slice(4) : null;
    if (bi) {
      menuBox = h('div', { class: 'ctxmenu' }, h('div', { class: 'pophead' }, L('ui.predefinedException', { name: bi })),
        B(L('ui.newExceptionInheritingFrom', { bi }), () => classDialog(null, svgPoint(e), true, bi)), B(L('ui.whatIsIt'), () => builtinInfo(bi)));
    } else if (modEl && !c) {
      const mn = modEl.dataset.module;
      const fr = row && row.dataset.kind === 'method' ? row.dataset.fid : null;
      menuBox = h('div', { class: 'ctxmenu' }, h('div', { class: 'pophead' }, L('ui.module4') + mn), fr ? B(L('ui.openTheFlowchart'), () => openMethod(fr), '', L('ui.enter')) : null, B(L('ui.updateTheModule'), () => updateModule(mn)), h('hr'), B(L('ui.removeTheModule'), () => removeModule(mn), 'danger'));
    } else if (!c) {
      const pt = svgPoint(e);
      menuBox = h('div', { class: 'ctxmenu' }, B(L('ui.newClass2'), () => classDialog(null, pt), '', 'N'), B(L('ui.newException2'), () => classDialog(null, pt, true), '', 'Shift+E'), B(L('ui.importAModule'), moduleDialog, '', 'Ctrl+I'));
    } else if (c.module) {
      const f = row && row.dataset.kind === 'method' ? st.prog.functions.find((x) => x.id === row.dataset.fid) : null;
      menuBox = h('div', { class: 'ctxmenu' }, h('div', { class: 'pophead' }, L('ui.module5', { c: M.classTitle(c), name: c.module.name })),
        f ? B(L('ui.openTheFlowchart'), () => openMethod(f.id), '', L('ui.enter')) : null,
        B(L('ui.updateTheModule'), () => updateModule(c.module.name)), h('hr'), B(L('ui.removeTheModule'), () => removeModule(c.module.name), 'danger'));
    } else if (row && row.dataset.kind === 'method') {
      const f = st.prog.functions.find((x) => x.id === row.dataset.fid);
      menuBox = h('div', { class: 'ctxmenu' },
        B(L('ui.openTheFlowchart'), () => openMethod(f.id), '', L('ui.enter')),
        B(f === st.prog.functions[0] ? L('ui.programProperties') : f.ctor ? L('ui.editTheConstructor') : L('ui.editTheMethodSignature'), () => editMethodSig(f), '', 'F2'),
        f === st.prog.functions[0] ? null : h('hr'),
        f === st.prog.functions[0] ? null : B(f.ctor ? L('ui.deleteTheConstructor2') : L('ui.deleteTheMethod2'), () => deleteFunction(f), 'danger', L('ui.del')));
    } else if (row && row.dataset.kind === 'attr') {
      const i = +row.dataset.i;
      menuBox = h('div', { class: 'ctxmenu' }, B(L('ui.editTheAttribute'), () => attrDialog(c, i), '', L('ui.enter')), h('hr'), B(L('ui.deleteTheAttribute'), () => deleteAttr(c, i), 'danger', L('ui.del')));
    } else {
      menuBox = h('div', { class: 'ctxmenu' },
        B(L('ui.newAttribute'), () => attrDialog(c, null), '', 'A'),
        B(L('ui.newMethod'), () => editFunction(null, { cls: c, ctor: false }), '', 'M'),
        B(L('ui.newConstructor2'), () => editFunction(null, { cls: c, ctor: true }), '', 'C'),
        h('hr'),
        B(L('ui.editTheClass'), () => classDialog(c), '', L('ui.enter')),
        B(L('ui.deleteTheClass2'), () => deleteClass(c), 'danger', L('ui.del')));
    }
    openPop(e.clientX, e.clientY, menuBox);
  }
  function svgPoint(e) {
    const svg = $('svg', V.chart); const r = svg.getBoundingClientRect();
    return { x: (e.clientX - r.left) / st.zoom, y: (e.clientY - r.top) / st.zoom };
  }
  /* highlights the selection without redrawing (otherwise the double click is lost) */
  function decorateUml() {
    const u = st.usel;
    $$('.ubox', V.chart).forEach((b) => { const on = !!u && u.cls === b.dataset.cls; b.classList.toggle('cur', on); b.classList.toggle('sel', on && u.kind === 'class'); });
    $$('.urow', V.chart).forEach((r) => {
      const b = r.closest('.ubox');
      const on = !!u && u.cls === b.dataset.cls && u.kind === r.dataset.kind && (u.kind === 'attr' ? String(u.i) === r.dataset.i : u.fid === r.dataset.fid);
      r.classList.toggle('sel', on);
    });
    if (V.main) renderFuncSelect();
  }
  /* selection in the class diagram */
  function umlSelectFrom(target) {
    const box = target.closest('.ubox'), row = target.closest('.urow');
    if (!box || box.classList.contains('builtin')) st.usel = null; // predefined exception: it is not selected
    else if (row) st.usel = { cls: box.dataset.cls, kind: row.dataset.kind, i: row.dataset.i != null ? +row.dataset.i : undefined, fid: row.dataset.fid };
    else st.usel = { cls: box.dataset.cls, kind: 'class' };
  }
  function editProgram() {
    const a = st.prog.attrs;
    const n = field({ key: 'pname', label: L('ui.programName'), type: 'plain' }, a.name);
    const au = field({ key: 'pauth', label: L('ui.authors'), type: 'plain' }, a.authors);
    const ab = field({ key: 'pabout', label: L('ui.description'), type: 'textarea', hint: L('ui.ifTheProgramIsUsedAs') }, a.about);
    openModal({ title: L('ui.programProperties2'), body: h('div', { class: 'fields' }, n, au, ab), okText: L('ui.save'), onOk: () => {
      if (isRunning()) return L('ui.stopTheProgramBeforeEditingIt');
      mutate(() => {
        // the default class takes the name of the program
        const c = M.hasClasses(st.prog) && st.prog.classes.length === 1 && st.prog.classes[0].name === M.defaultClassName(st.prog) ? st.prog.classes[0] : null;
        a.name = n._get().trim(); a.authors = au._get().trim(); a.about = ab._get();
        if (c && !st.prog.classes.some((k) => k !== c && k.name === M.defaultClassName(st.prog))) renameClass(c, M.defaultClassName(st.prog));
      });
      return true;
    } });
  }

  /* ------------------------ Interaction with the drawing ---------------------- */
  let drag = null, suppressClick = false, udrag = null, mdrag = null;
  /* events of the sheet of a view (main or auxiliary) */
  /* ------------------------------ Pan ------------------------------
     Around the drawing the sheet has a margin of empty paper (about a screen on each side, --pan-x/--pan-y): the sheet
     is moved by scrolling it (Space + drag, the middle button, the hand tool, the arrows, the wheel), so the scrollbars,
     the «Continue» views and the block in execution keep working as they are. Each view remembers where it was on
     each diagram (function or class diagram) until another program is opened. */
  let panSpace = false, handTool = false, pan = null, overWrap = null;
  const diagramKey = () => (isUml() ? 'uml' : 'f:' + (func() ? func().id : ''));
  /* the drawing in the coordinates of the sheet (scrollable content) of its view */
  function drawingBox(v) {
    const d = v.chart.firstElementChild; if (!d) return null;
    const r = d.getBoundingClientRect(), w = v.wrap.getBoundingClientRect();
    return { left: r.left - w.left - v.wrap.clientLeft + v.wrap.scrollLeft, top: r.top - w.top - v.wrap.clientTop + v.wrap.scrollTop, width: r.width, height: r.height };
  }
  /* the starting position: the drawing at the top, in the middle (the class diagram on the left) */
  function home(v) {
    v = v || V;
    const b = drawingBox(v); if (!b) return;
    const w = v.wrap, uml = v.chart.classList.contains('umlsheet');
    w.scrollLeft = !uml && b.width < w.clientWidth - 24 ? b.left + b.width / 2 - w.clientWidth / 2 : b.left - 12;
    w.scrollTop = b.top - 12;
  }
  /* after drawing: a diagram just shown goes back where it was in this view, or to the starting position */
  function placeSheet() {
    const v = V;
    v.chart.classList.toggle('umlsheet', isUml());
    // a «Continue» view is placed vertically by the main sheet; horizontally the drawing is centred when it starts to
    // follow the sheet or the diagram changes, then the view is moved freely
    if (v.sync) { const k = diagramKey(); if (v.syncKey !== k) { v.syncKey = k; centerX(v); } return; }
    const key = diagramKey();
    if (v.panKey === key) return;
    v.panKey = key;
    const p = v.pans.get(key);
    if (p) { v.wrap.scrollLeft = p[0]; v.wrap.scrollTop = p[1]; } else home(v);
  }
  function forgetPans(v) { v.pans.clear(); v.panKey = null; }
  /* the drawing in the middle of the view, horizontally */
  function centerX(v) { const b = drawingBox(v); if (b) v.wrap.scrollLeft = b.left + b.width / 2 - v.wrap.clientWidth / 2; }
  /* zoom keeping still the point (x, y) of the screen (the cursor), or the middle of the view */
  function zoomAt(v, z, x, y) {
    const w = v.wrap, r = w.getBoundingClientRect(), b = drawingBox(v), old = vget(v, 'zoom');
    if (x == null) { x = r.left + w.clientLeft + w.clientWidth / 2; y = r.top + w.clientTop + w.clientHeight / 2; }
    const px = x - r.left - w.clientLeft + w.scrollLeft, py = y - r.top - w.clientTop + w.scrollTop;
    const dx = b ? (px - b.left) / old : 0, dy = b ? (py - b.top) / old : 0;
    withView(v, () => setZoom(z));
    if (!b || v.sync) return;
    const nb = drawingBox(v), nz = vget(v, 'zoom');
    w.scrollLeft += nb.left + dx * nz - px; w.scrollTop += nb.top + dy * nz - py;
  }
  const ICON_HAND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V12M17 10.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.6-2.2L4.6 14.9a1.5 1.5 0 0 1 2.3-1.9L8 14.3"/></svg>';
  /* the button of the hand (in the zoom bar of each view): with it on, dragging on the sheet moves it */
  function panButton() {
    const b = h('button', { type: 'button', class: 'panbtn' + (handTool ? ' on' : ''), title: L('ui.handMoveTheSheet'), 'aria-label': L('ui.handMoveTheSheet'), 'aria-pressed': String(handTool), html: ICON_HAND });
    b.addEventListener('click', () => setHand(!handTool));
    return b;
  }
  function setHand(on) {
    handTool = !!on;
    document.body.classList.toggle('handtool', handTool);
    $$('.panbtn').forEach((b) => { b.setAttribute('aria-pressed', String(handTool)); b.classList.toggle('on', handTool); });
  }
  const typingIn = (el) => !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
  function bindPan() {
    // Space held with the cursor on a sheet: the hand (Space in a field or on a button keeps doing its own work)
    document.addEventListener('pointermove', (e) => { overWrap = e.target && e.target.closest ? e.target.closest('#canvasWrap, .vwrap') : null; }, true);
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || e.ctrlKey || e.metaKey || e.altKey || typingIn(document.activeElement) || modalStack.length || !overWrap) return;
      e.preventDefault(); e.stopPropagation();
      if (!panSpace) { panSpace = true; document.body.classList.add('panready'); }
    }, true);
    document.addEventListener('keyup', (e) => { if (e.code === 'Space' && panSpace) { panSpace = false; document.body.classList.remove('panready'); } }, true);
    window.addEventListener('blur', () => { panSpace = false; document.body.classList.remove('panready'); });
  }
  /* the pan on the sheet of a view: before any other gesture (selection, dragging of blocks and classes) */
  function bindPanOn(v) {
    const w = v.wrap;
    let lastMid = 0;
    w.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); }); // no automatic scrolling of the browser
    w.addEventListener('pointerdown', (e) => {
      const mid = e.button === 1;
      if (!(mid || (e.button === 0 && (panSpace || handTool)))) return;
      if (e.target.closest('.vtools, .zoombar, .vdone')) return;
      e.preventDefault(); e.stopPropagation();
      focusView(v);
      // double click of the middle button: back to the starting position
      if (mid && e.timeStamp - lastMid < 350) { lastMid = 0; if (v.sync) centerX(v); else home(v); return; }
      if (mid) lastMid = e.timeStamp;
      pan = { v, x: e.clientX, y: e.clientY, sl: w.scrollLeft, st: w.scrollTop, mst: MAIN.wrap.scrollTop, moved: false, id: e.pointerId };
      try { w.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      document.body.classList.add('panning');
    }, true);
    w.addEventListener('pointermove', (e) => {
      if (!pan || pan.v !== v || e.pointerId !== pan.id) return;
      const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
      if (Math.hypot(dx, dy) > 3) { pan.moved = true; lastMid = 0; }
      // a «Continue» view: horizontally it moves by itself, vertically it is the main sheet that scrolls (and the view follows it)
      w.scrollLeft = pan.sl - dx;
      if (v.sync) MAIN.wrap.scrollTop = pan.mst - dy; else w.scrollTop = pan.st - dy;
    });
    const end = (e) => {
      if (!pan || pan.v !== v || (e && e.pointerId !== pan.id)) return;
      if (pan.moved) suppressClick = true;
      pan = null;
      document.body.classList.remove('panning');
    };
    w.addEventListener('pointerup', end); w.addEventListener('pointercancel', end);
    // the place reached on this diagram, remembered by the view
    w.addEventListener('scroll', () => { if (!v.sync && v.panKey) v.pans.set(v.panKey, [w.scrollLeft, w.scrollTop]); }, { passive: true });
  }

  function bindChart(v) {
    const chart = v.chart;
    bindPanOn(v);
    chart.addEventListener('click', (e) => {
      if (suppressClick) { suppressClick = false; return; }
      focusView(v);
      if (isUml()) {
        const mt = e.target.closest('.umodtog');
        if (mt) { toggleModule(mt.dataset.module); return; }
        const add = e.target.closest('.uadd');
        if (add) {
          const c = M.classById(st.prog, add.closest('.ubox').dataset.cls);
          if (isRunning()) { toast(L('ui.stopTheProgramToEditThe'), 'warn'); return; }
          if (add.dataset.add === 'attr') attrDialog(c, null); else memberMenu(c, e.clientX + 6, e.clientY + 6);
          return;
        }
        umlSelectFrom(e.target); decorateUml();
        return;
      }
      const tog = e.target.closest('.ctoggle');
      if (tog) { const id = tog.dataset.toggle; st.expanded.has(id) ? st.expanded.delete(id) : st.expanded.add(id); render(); return; }
      const ins = e.target.closest('.ins');
      if (ins) { if (isRunning()) { toast(L('ui.stopTheProgramToEditThe'), 'warn'); return; } insertMenu(+ins.dataset.ins, e.clientX + 6, e.clientY + 6); return; }
      const g = e.target.closest('.shape');
      const gid = g ? ownerOf(g.dataset.id) : null;
      selectClick(gid, e);
      link = g ? { from: 'chart', raw: g.dataset.id } : null;
      decorate();
      decorateCode(true);
    });
    chart.addEventListener('dblclick', (e) => {
      focusView(v);
      if (isUml()) {
        if (e.target.closest('.uadd') || e.target.closest('.umodtog')) return;
        const mc = e.target.closest('.umodc');
        if (mc) { toggleModule(mc.dataset.module); return; }
        const row = e.target.closest('.urow'), box = e.target.closest('.ubox');
        if (row && row.dataset.kind === 'method' && !box) { openMethod(row.dataset.fid); return; } // function of a module
        if (e.target.closest('.umod')) return; // box of a module: no new class
        if (box && box.classList.contains('builtin')) { builtinInfo(box.dataset.cls.slice(4)); return; }
        if (row && row.dataset.kind === 'method') { openMethod(row.dataset.fid); return; }
        if (isRunning()) { toast(L('ui.stopTheProgramToEditThe'), 'warn'); return; }
        if (row) { attrDialog(M.classById(st.prog, box.dataset.cls), +row.dataset.i); return; }
        if (box) { classDialog(M.classById(st.prog, box.dataset.cls)); return; }
        classDialog(null, svgPoint(e));
        return;
      }
      if (e.target.closest('.ctoggle')) return;
      const g = e.target.closest('.shape'); if (!g) return;
      const id = g.dataset.id;
      if (id.startsWith('start:') || id.startsWith('end:')) { if (isRunning()) return; st.fi === 0 ? editProgram() : editFunction(st.fi); return; }
      editStmt(ownerOf(id));
    });
    chart.addEventListener('contextmenu', (e) => {
      focusView(v);
      if (isUml()) {
        e.preventDefault();
        if (isRunning()) { toast(L('ui.stopTheProgramToEditThe'), 'warn'); return; }
        umlSelectFrom(e.target); decorateUml(); umlMenu(e);
        return;
      }
      const g = e.target.closest('.shape'); if (!g) return;
      e.preventDefault();
      const gid = ownerOf(g.dataset.id);
      // right click inside the selection keeps it (the menu acts on all the selected blocks)
      if (!gid.includes(':') && !selIds().includes(gid)) { setSel([gid]); decorate(); }
      shapeMenu(gid, e.clientX, e.clientY);
    });
    chart.addEventListener('pointerdown', (e) => {
      focusView(v);
      if (isUml()) {
        // classes are moved by dragging them; a module (box or label) moves with all its classes
        if (e.button !== 0 || isRunning() || e.target.closest('.uadd') || e.target.closest('.umodtog')) return;
        const box = e.target.closest('.ubox'), mod = !box && e.target.closest('.umod');
        // an attribute or a method (not the Main) of a class of the program: it is moved to another class or to another place
        const mrow = box && !box.classList.contains('builtin') && e.target.closest('.urow');
        const mcls = mrow && M.classById(st.prog, box.dataset.cls);
        if (mrow && mcls && !mcls.module && !(mrow.dataset.kind === 'method' && mrow.dataset.fid === st.prog.functions[0].id)) {
          mdrag = { v, cls: mcls, kind: mrow.dataset.kind, i: mrow.dataset.i != null ? +mrow.dataset.i : null, fid: mrow.dataset.fid || null, text: mrow.querySelector('.umem').textContent, x: e.clientX, y: e.clientY, on: false, ghost: null, at: null };
          return;
        }
        let cs;
        // predefined exception: its position is moved (it is not in the file)
        if (box && box.classList.contains('builtin')) cs = [Object.assign(st.excPos.get(box.dataset.cls.slice(4)) || {}, { builtin: true })];
        else if (box) cs = [M.classById(st.prog, box.dataset.cls)];
        else if (mod) {
          const m = M.modulesOf(st.prog).find((x) => x.name === mod.dataset.module);
          // module with only functions: its position is moved (it is not in the file)
          cs = !m ? [] : m.classes.length ? m.classes : st.fmodPos.has(m.name) ? [Object.assign(st.fmodPos.get(m.name), { builtin: true })] : [];
        }
        if (!cs || !cs.length) return;
        udrag = { items: cs.map((c) => ({ c, ox: c.x || 0, oy: c.y || 0 })), mod: mod ? mod.dataset.module : null, x: e.clientX, y: e.clientY, on: false, raf: 0, wrap: v.wrap, sl: v.wrap.scrollLeft, st: v.wrap.scrollTop };
        return;
      }
      if (e.button !== 0 || e.target.closest('.ctoggle')) return;
      const g = e.target.closest('.shape');
      // on the empty sheet: a rectangle drawn with the mouse selects the blocks it contains (Shift or Ctrl: adds them)
      if (!g && !e.target.closest('.ins') && !e.target.closest('.vtools, .zoombar, #chartTools') && !func().abstract) {
        band = { v, x: e.clientX, y: e.clientY, on: false, add: e.shiftKey || e.ctrlKey || e.metaKey, base: selIds(), el: null };
        return;
      }
      if (isRunning() || !g || g.dataset.id.includes(':')) return;
      drag = { id: g.dataset.id, x: e.clientX, y: e.clientY, on: false, ghost: null };
    });
    v.wrap.addEventListener('wheel', (e) => {
      if (e.ctrlKey) { e.preventDefault(); focusView(v); zoomAt(v, st.zoom * (e.deltaY < 0 ? 1.1 : 0.9), e.clientX, e.clientY); return; }
      // a «Continue» view does not scroll by itself: the wheel scrolls the main sheet
      if (v.sync) { e.preventDefault(); MAIN.wrap.scrollBy(0, e.shiftKey && !e.deltaX ? 0 : e.deltaY); v.wrap.scrollBy(e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX, 0); }
    }, { passive: false });
    v.wrap.addEventListener('scroll', closePop);
  }
  /* ---- selection rectangle (bounding box) on the sheet of a view ---- */
  let band = null;
  function bandRect(b, e) { return { l: Math.min(b.x, e.clientX), t: Math.min(b.y, e.clientY), r: Math.max(b.x, e.clientX), b: Math.max(b.y, e.clientY) }; }
  function bandMove(e) {
    const b = band;
    if (!b.on && Math.hypot(e.clientX - b.x, e.clientY - b.y) > 5) { b.on = true; b.el = h('div', { class: 'selband' }); document.body.append(b.el); document.body.classList.add('banding'); }
    if (!b.on) return;
    const r = bandRect(b, e);
    Object.assign(b.el.style, { left: r.l + 'px', top: r.t + 'px', width: r.r - r.l + 'px', height: r.b - r.t + 'px' });
    // near the edges of the view the sheet scrolls
    const w = b.v.wrap.getBoundingClientRect(), E = 24, sp = 14;
    if (e.clientY > w.bottom - E) b.v.wrap.scrollTop += sp; else if (e.clientY < w.top + E) b.v.wrap.scrollTop -= sp;
    if (e.clientX > w.right - E) b.v.wrap.scrollLeft += sp; else if (e.clientX < w.left + E) b.v.wrap.scrollLeft -= sp;
    bandApply(e, false);
  }
  // the blocks all inside the rectangle (Start, End and the Catch/Finally headers are not selected)
  function bandApply(e, final) {
    const b = band, r = bandRect(b, e);
    const inside = new Set($$('.shape', b.v.chart).filter((g) => {
      if (g.dataset.id.includes(':')) return false;
      const q = g.getBoundingClientRect();
      return q.left >= r.l && q.right <= r.r && q.top >= r.t && q.bottom <= r.b;
    }).map((g) => g.dataset.id));
    if (b.add) b.base.forEach((id) => inside.add(id));
    // in the order of the program; the main block is the last one
    const ids = []; M.walk(func().body, (x) => { if (inside.has(x.id)) ids.push(x.id); });
    setSel(ids, ids[ids.length - 1]); st.mselAnchor = ids[0] || null;
    link = null;
    decorate();
    if (final) decorateCode(true);
  }
  /* ---- class diagram: attributes and methods dragged to another class (or to another place of the same class) ---- */
  /* where the member would go: { c, before } (before: index of the attribute or id of the method; null = at the end) and the line to show */
  function memberDropAt(e, d) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const box = el && el.closest && el.closest('.vchart .ubox');
    if (!box || box.classList.contains('builtin')) return null;
    const c = M.classById(st.prog, box.dataset.cls);
    if (!c || c.module) return null;
    // the rows of the same kind (the constructors and the Main stay at the top: a method goes after them)
    const rows = [...box.querySelectorAll(`.urow[data-kind=${d.kind}]`)].filter((r) => d.kind !== 'method' || (!r.classList.contains('ctor') && !r.classList.contains('mainm')) || (d.ctor && r.classList.contains('ctor')));
    let before = null, ref = null, after = false;
    for (const r of rows) {
      const b = r.getBoundingClientRect();
      if (e.clientY < b.top + b.height / 2) { before = d.kind === 'attr' ? +r.dataset.i : r.dataset.fid; ref = r; break; }
    }
    if (!ref && rows.length) { ref = rows[rows.length - 1]; after = true; }
    return { c, box, before, ref, after };
  }
  function memberDragMove(e) {
    const d = mdrag;
    if (!d.on && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) {
      d.on = true;
      if (d.kind === 'method') { const f = st.prog.functions.find((x) => x.id === d.fid); d.ctor = !!(f && f.ctor); }
      document.body.classList.add('mdragging');
      d.ghost = h('div', { class: 'ghost' }, d.text); document.body.append(d.ghost);
    }
    if (!d.on) return;
    d.ghost.style.left = e.clientX + 14 + 'px'; d.ghost.style.top = e.clientY + 10 + 'px';
    $$('.vchart .ubox.udrop').forEach((b) => b.classList.remove('udrop'));
    $$('.vchart .udropline').forEach((l) => l.remove());
    const at = memberDropAt(e, d);
    if (!at) return;
    at.box.classList.add('udrop');
    if (at.ref) {
      // line between two rows, in the coordinates of the drawing
      const r = at.ref.querySelector('.uhit'), y = +r.getAttribute('y') + (at.after ? +r.getAttribute('height') : 0);
      const ln = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      ln.setAttribute('class', 'udropline'); ln.setAttribute('d', `M${+r.getAttribute('x') + 2} ${y}H${+r.getAttribute('x') + +r.getAttribute('width') - 2}`);
      at.box.append(ln);
    }
  }
  function memberDrop(e) {
    const d = mdrag; mdrag = null;
    if (!d.on) return;
    document.body.classList.remove('mdragging'); d.ghost.remove();
    $$('.vchart .ubox.udrop').forEach((b) => b.classList.remove('udrop'));
    $$('.vchart .udropline').forEach((l) => l.remove());
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 50);
    const at = memberDropAt(e, d);
    if (!at) { render(); return; }
    const from = d.cls, to = at.c, same = from === to;
    const tps = (x) => new Set((x.tparams || []).map((t) => t.toLowerCase()));
    // a Generic Type of the class it comes from, which the other class does not have
    const usesOwnT = (types) => { const a = tps(from), b = tps(to); return types.some((t) => [...String(t).matchAll(/[A-Za-z_]\w*/g)].some((m) => a.has(m[0].toLowerCase()) && !b.has(m[0].toLowerCase()))); };
    const no = (msg) => { toast(msg, 'warn'); render(); };
    if (d.kind === 'attr') {
      const a = from.attributes[d.i]; if (!a) return;
      if (!same) {
        if (to.attributes.some((x) => x.name.toLowerCase() === a.name.toLowerCase())) return no(L('ui.alreadyHasTheAttribute', { cls: to.name, name: a.name }));
        if (usesOwnT([a.type])) return no(L('ui.usesTheGenericTypeOf', { name: a.name, cls: from.name }));
      }
      mutate(() => {
        from.attributes.splice(d.i, 1);
        let k = at.before == null ? to.attributes.length : at.before - (same && at.before > d.i ? 1 : 0);
        to.attributes.splice(Math.max(0, Math.min(k, to.attributes.length)), 0, a);
        st.usel = { cls: to.id, kind: 'attr', i: to.attributes.indexOf(a) };
      });
      if (!same) toast(L('ui.memberMovedTo', { what: a.name, cls: to.name }), 'ok');
      return;
    }
    const f = st.prog.functions.find((x) => x.id === d.fid); if (!f || f === st.prog.functions[0]) return;
    if (!same) {
      if (f.ctor) return no(L('ui.aConstructorStaysInItsClass', { cls: from.name }));
      const sig = (g) => g.name.toLowerCase() + '(' + g.params.map((p) => p.type.toLowerCase() + (p.array ? '[]' : '')).join(',') + ')';
      if (M.membersOf(st.prog, to).some((g) => !g.ctor && sig(g) === sig(f))) return no(L('ui.alreadyHasTheMethod', { cls: to.name, name: f.name }));
      if (f.abstract && !to.abstract) return no(L('ui.anAbstractMethodGoesOnlyIn', { name: f.name, cls: to.name }));
      if (usesOwnT([...f.params.map((p) => p.type), ...M.rets(f).map((r) => r.type)])) return no(L('ui.usesTheGenericTypeOf', { name: f.name + '()', cls: from.name }));
    }
    mutate(() => {
      const cur = func();
      const fs = st.prog.functions;
      fs.splice(fs.indexOf(f), 1);
      f.cls = to.id;
      let k;
      if (at.before != null) k = fs.findIndex((g) => g.id === at.before);
      else { const ms = M.membersOf(st.prog, to).filter((g) => g !== f); k = ms.length ? fs.indexOf(ms[ms.length - 1]) + 1 : fs.length; }
      if (k < 1) k = k < 0 ? fs.length : 1; // the Main stays first
      fs.splice(k, 0, f);
      st.fi = Math.max(0, fs.indexOf(cur));
      st.usel = { cls: to.id, kind: 'method', fid: f.id };
    });
    if (!same) toast(L('ui.memberMovedTo', { what: f.name + '()', cls: to.name }), 'ok');
  }
  /* dragging (also from one view to another) */
  function bindDrag() {
    window.addEventListener('pointermove', (e) => {
      if (band) { bandMove(e); return; }
      if (mdrag) { memberDragMove(e); return; }
      if (udrag) {
        // near the edges of the view the sheet scrolls, and the class goes with the pointer
        if (udrag.on) {
          const w = udrag.wrap.getBoundingClientRect(), E = 28, sp = 14;
          if (e.clientY > w.bottom - E) udrag.wrap.scrollTop += sp; else if (e.clientY < w.top + E) udrag.wrap.scrollTop -= sp;
          if (e.clientX > w.right - E) udrag.wrap.scrollLeft += sp; else if (e.clientX < w.left + E) udrag.wrap.scrollLeft -= sp;
        }
        const dx = (e.clientX - udrag.x + udrag.wrap.scrollLeft - udrag.sl) / st.zoom, dy = (e.clientY - udrag.y + udrag.wrap.scrollTop - udrag.st) / st.zoom;
        if (!udrag.on && Math.hypot(dx, dy) > 4) {
          udrag.on = true;
          if (!udrag.items[0].c.builtin) { st.undo.push(snapshot()); if (st.undo.length > 150) st.undo.shift(); st.redo = []; }
          document.body.classList.add('udragging');
          st.usel = udrag.mod || udrag.items[0].c.builtin ? null : { cls: udrag.items[0].c.id, kind: 'class' };
        }
        if (udrag.on) {
          // step of 10 and never beyond the top or left edge (the classes of a module stay aligned with each other)
          const it = udrag.items;
          const mx = Math.max(Math.round(dx / 10) * 10, 10 - Math.min(...it.map((i) => i.ox)));
          const my = Math.max(Math.round(dy / 10) * 10, 10 - Math.min(...it.map((i) => i.oy)));
          for (const i of it) { i.c.x = it.length > 1 ? i.ox + mx : Math.max(10, Math.round((i.ox + dx) / 10) * 10); i.c.y = it.length > 1 ? i.oy + my : Math.max(10, Math.round((i.oy + dy) / 10) * 10); }
          if (!udrag.raf) udrag.raf = requestAnimationFrame(() => { if (udrag) udrag.raf = 0; render(); });
        }
        return;
      }
      if (!drag) return;
      if (!drag.on && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 7) {
        drag.on = true;
        document.body.classList.add('dragging');
        const f = M.findStmt(st.prog, drag.id);
        drag.ghost = h('div', { class: 'ghost' }, RenderLib.KIND_IT[f.stmt.kind] + ': ' + RenderLib.caption(f.stmt).text);
        document.body.append(drag.ghost);
      }
      if (drag.on) {
        drag.ghost.style.left = e.clientX + 14 + 'px'; drag.ghost.style.top = e.clientY + 10 + 'px';
        const el = document.elementFromPoint(e.clientX, e.clientY);
        $$('.vchart .ins.drop').forEach((x) => x.classList.remove('drop'));
        const ins = el && el.closest && el.closest('.vchart .ins');
        if (ins) ins.classList.add('drop');
      }
    });
    window.addEventListener('pointerup', (e) => {
      if (band) {
        const b = band;
        if (b.on) { bandApply(e, true); b.el.remove(); document.body.classList.remove('banding'); suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); }
        band = null;
        return;
      }
      if (mdrag) { memberDrop(e); return; }
      if (udrag) {
        const d = udrag; udrag = null;
        if (d.on) { cancelAnimationFrame(d.raf); document.body.classList.remove('udragging'); if (!d.items[0].c.builtin) st.dirty = true; suppressClick = true; setTimeout(() => { suppressClick = false; }, 50); render(); }
        return;
      }
      if (!drag) return;
      const d = drag; drag = null;
      if (!d.on) return;
      document.body.classList.remove('dragging');
      d.ghost.remove();
      suppressClick = true; setTimeout(() => { suppressClick = false; }, 50);
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const ins = el && el.closest && el.closest('.vchart .ins');
      $$('.vchart .ins.drop').forEach((x) => x.classList.remove('drop'));
      if (!ins) return;
      // the block can also be dropped in the diagram of another view
      const tv = viewOfEl(ins) || V;
      const pt = (vget(tv, 'ins') || [])[+ins.dataset.ins];
      if (!pt) return;
      if (tv !== V && withView(tv, () => roGuard())) return;
      moveStmt(d.id, pt);
    });
  }

  /* ============================ EXECUTION =============================== */
  const run = { state: 'idle', gen: null, interp: null, timer: null, steps: 0, curId: null, curFrame: null, errId: null, pending: undefined, mode: 'run', mainFrame: null, viewFrame: null, prevVals: new Map(), lastVarsAt: 0 };

  /* ---- Console ---- */
  let conLine = null;
  function conClear() { $('#conOut').innerHTML = ''; conLine = null; }
  function conWrite(text, nl, cls) {
    const out = $('#conOut');
    if (cls === 'echo' && conLine) {
      conLine.append(h('span', { class: 'echo-inline' }, text));
      conLine = null;
    } else if (cls) {
      if (conLine && conLine.textContent === '') { conLine.remove(); }
      out.append(h('div', { class: 'cline ' + cls }, text));
      conLine = null;
    } else {
      if (!conLine) { conLine = h('div', { class: 'cline' }); out.append(conLine); }
      conLine.append(document.createTextNode(text));
      if (nl) conLine = null;
    }
    while (out.childElementCount > 4000) out.firstElementChild.remove();
    scheduleScroll();
  }
  let scrollPending = false;
  function scheduleScroll() {
    if (scrollPending) return; scrollPending = true;
    requestAnimationFrame(() => { scrollPending = false; const o = $('#conOut'); o.scrollTop = o.scrollHeight; });
  }

  /* ---- Virtual files ---- */
  const streams = { read: null, write: null };
  function saveVfs() { store.set('vfs', Object.fromEntries(st.vfs)); renderFiles(); }
  function fileOpen(name, mode) {
    if (!name.trim()) throw new E.FlowError(L('ui.theFileNameIsEmpty'));
    if (streams[mode]) throw new E.FlowError(L('ui.thereIsAlreadyAFileOpen', { text: mode === 'read' ? L('chart.reading') : L('chart.writing') }));
    if (mode === 'read') {
      if (!st.vfs.has(name)) throw new E.FlowError(L('ui.fileNotFoundUploadItIn', { name }), { exc: 'FileError' });
      const lines = st.vfs.get(name).split(/\r?\n/);
      if (lines.length && lines[lines.length - 1] === '') lines.pop();
      streams.read = { name, lines, pos: 0 };
    } else streams.write = { name, lines: [] };
  }
  function fileClose(mode) {
    if (!streams[mode]) throw new E.FlowError(L('ui.noFileOpenFor', { text: mode === 'read' ? L('chart.reading') : L('chart.writing') }));
    if (mode === 'write') { st.vfs.set(streams.write.name, streams.write.lines.join('\n') + (streams.write.lines.length ? '\n' : '')); saveVfs(); }
    streams[mode] = null;
  }
  function flushStreams() { if (streams.write) { try { fileClose('write'); } catch (e) { /* ignore */ } } streams.read = null; streams.write = null; }

  const env = {
    output: (t, nl, cls) => conWrite(t, nl, cls),
    eof: () => { if (!streams.read) throw new E.FlowError(L('ui.eofNoFileOpenForReading')); return streams.read.pos >= streams.read.lines.length; },
    fileOpen, fileClose,
    fileRead: () => {
      const r = streams.read;
      if (!r) throw new E.FlowError(L('ui.noFileOpenForReading'));
      if (r.pos >= r.lines.length) throw new E.FlowError(L('ui.readingPastTheEndOfThe', { name: r.name }), { exc: 'FileError' });
      return r.lines[r.pos++];
    },
    fileWrite: (s) => { if (!streams.write) throw new E.FlowError(L('ui.noFileOpenForWriting')); streams.write.lines.push(s); },
  };

  function setStatus(kind, text) {
    const s = $('#status');
    s.className = 'status ' + kind;
    $('#statusText').textContent = text;
    $('#stepCount').textContent = run.steps ? L('ui.steps', { toLocaleStringNaN: run.steps.toLocaleString('it-IT') }) : '';
    document.body.dataset.run = run.state;
    $('#runBtn').querySelector('span').textContent = run.state === 'paused' ? L('ui.continue') : L('ui.run');
    $('#pauseBtn').disabled = run.state !== 'running';
    $('#stopBtn').disabled = !isRunning();
  }

  function startRun(mode) {
    stopTimer();
    run.mode = mode;
    run.steps = 0; run.curId = null; run.errId = null; run.pending = undefined; run.mainFrame = null; run.viewFrame = null; run.prevVals = new Map();
    run.trail = null; clearTrail();
    ArrayView.markStale();
    conClear(); flushStreams();
    conWrite(`▶ ${st.prog.attrs.name || L('model.program')}`, true, 'sys');
    // runs a copy, so the changes to the diagram do not touch the execution
    const prog = JSON.parse(JSON.stringify(st.prog));
    run.interp = new Interpreter(prog, env);
    run.gen = run.interp.run();
    run.stageWait = null; run.stageNext = null; run.stageHold = null;
    if (stageHook) stageHook.start(run.interp);
    // the Code tab, if in view, stays: it follows the running block
    if (!paneVisible('console') && !paneVisible('vars') && !paneVisible('code')) showPane('console');
    if (mode === 'run') { run.state = 'running'; setStatus('running', L('ui.running')); pump(); }
    else { run.state = 'paused'; stepOnce(); }
  }

  function stopTimer() { if (run.timer) { clearTimeout(run.timer); run.timer = null; } }

  function advance() {
    let r, ev;
    for (;;) {
      try { r = run.gen.next(run.pending); run.pending = undefined; } catch (e) { onError(e); return null; }
      if (r.done) { onFinish(); return null; }
      ev = r.value;
      // the branch chosen by an If is only for the cursor: it is not a step
      if (ev.type === 'branch') { ev.frame._branch = { id: ev.stmt.id, taken: ev.taken }; continue; }
      break;
    }
    if (ev.type === 'stmt') {
      const prevId = run.curId;
      run.steps++; run.curId = ev.stmt.id; run.curFrame = ev.frame;
      // path for the cursor: from the last block run in this same call
      run.trail = { from: ev.frame._last || null, to: ev.stmt.id, frame: ev.frame, branch: ev.frame._branch || null, step: run.steps, exc: ev.exc || null };
      ev.frame._last = ev.stmt.id;
      if (!run.mainFrame) run.mainFrame = ev.frame;
      // Stage (only if a stage is open): the changes of its variables become an animation, and the program waits for it
      if (stageHook) { const p = stageHook.step(ev.frame); if (p) { const w = p.then(() => { if (run.stageWait === w) { run.stageWait = null; if (!run.stageNext) run.stageHold = null; } }); run.stageWait = w; run.stageHold = prevId; decorate(); } }
      if (run.state === 'running' && (runTo || bpMarks.size)) {
        const why = stopHere(ev);
        if (why) {
          run.state = 'paused'; run.mode = 'step';
          // with an animation of the stage the cursor stays on the block that made it until it ends
          if (run.stageWait) afterStage(showCurrent); else showCurrent();
          setStatus('paused', why);
          conWrite(why, true, 'sys');
          return null;
        }
      }
      return ev;
    }
    if (ev.type === 'input') { onInput(ev); return null; }
    if (ev.type === 'break') {
      run.state = 'paused'; run.mode = 'step';
      showCurrent(); setStatus('paused', L('ui.pausedAtTheBreakpoint'));
      conWrite(L('ui.breakpoint2'), true, 'sys');
      return null;
    }
    return ev;
  }

  /* Stage: what to do when the animation of the stage ends. Only one thing waits (the last one asked replaces the others),
     so a run never goes on twice and the steps asked during an animation do not pile up */
  function afterStage(fn) {
    const tok = { fn };
    run.stageNext = tok;
    run.stageWait.then(() => { if (run.stageNext === tok && !run.stageWait) { run.stageNext = null; run.stageHold = null; fn(); } });
  }
  function pump() {
    run.timer = null;
    if (run.state !== 'running') return;
    if (run.stageWait) { afterStage(pump); return; }
    const ms = run.fast ? 0 : SPEEDS[st.speed].ms; // «Run to here»: without animation
    const t0 = performance.now();
    while (run.state === 'running') {
      const ev = advance();
      if (!ev) return;
      // an animation of the stage: the cursor stays on the block that changed the variables until the animation ends
      if (run.stageWait) {
        afterStage(() => {
          showCurrent();
          if (run.state === 'running') { if (ms > 0) run.timer = setTimeout(pump, ms); else pump(); }
        });
        return;
      }
      if (ms > 0) { showCurrent(); run.timer = setTimeout(pump, ms); return; }
      if (performance.now() - t0 > 16) {
        setStatus('running', L('ui.running'));
        if (performance.now() - run.lastVarsAt > 400) { renderVars(); run.lastVarsAt = performance.now(); }
        run.timer = setTimeout(pump, 0);
        return;
      }
    }
  }

  function stepOnce() {
    if (run.state === 'input') return;
    // an animation of the stage still running: the step is not taken (otherwise the steps asked meanwhile would all run
    // together at its end, without stopping on the blocks)
    if (run.stageWait) return;
    run.state = 'paused'; run.mode = 'step';
    const ev = advance();
    if (!ev) return;
    // the cursor stays on the block just run while the stage animates its changes, then goes to the next one
    if (run.stageWait) {
      setStatus('paused', L('stage.waitingForTheAnimation'));
      afterStage(() => { if (run.state === 'paused') { showCurrent(); setStatus('paused', L('ui.stepByStepPressStepTo')); } });
    }
    else { showCurrent(); setStatus('paused', L('ui.stepByStepPressStepTo')); }
  }

  /* Step over: runs up to the next block of the same call (or of the one that called it),
     without stopping inside the functions and methods called by the current block */
  function onOverBtn() {
    if (run.state === 'input') return;
    if (run.state === 'running') { onStepBtn(); return; }
    if (run.state !== 'paused') { run.errId = null; startRun('step'); return; }
    run.overDepth = run.curFrame ? run.curFrame.depth : 0;
    run.mode = 'over'; run.state = 'running';
    pumpOver();
  }
  /* Step out: runs the rest of the current function (or method) and stops
     on the next block of the caller; in Main it runs to the end */
  function onOutBtn() {
    if (run.state === 'input') return;
    if (run.state === 'running') { onStepBtn(); return; }
    if (run.state !== 'paused') { run.errId = null; startRun('step'); return; }
    run.overDepth = (run.curFrame ? run.curFrame.depth : 0) - 1;
    run.mode = 'over'; run.state = 'running';
    pumpOver();
  }
  function pumpOver() {
    run.timer = null;
    if (run.state !== 'running') return;
    if (run.stageWait) { afterStage(pumpOver); return; }
    const t0 = performance.now();
    while (run.state === 'running') {
      const ev = advance();
      if (!ev) return; // end, error, input or breakpoint
      const arrived = ev.frame.depth <= run.overDepth;
      if (run.stageWait) {
        if (arrived) { run.state = 'paused'; run.mode = 'step'; }
        afterStage(() => {
          if (arrived) { showCurrent(); setStatus('paused', L('ui.stepByStepPressStepTo')); } else if (run.state === 'running') { showCurrent(); pumpOver(); }
        });
        return;
      }
      if (arrived) {
        run.state = 'paused'; run.mode = 'step';
        showCurrent(); setStatus('paused', L('ui.stepByStepPressStepTo'));
        return;
      }
      if (performance.now() - t0 > 16) {
        setStatus('running', L('ui.runningTheCall'));
        run.timer = setTimeout(pumpOver, 0);
        return;
      }
    }
  }

  /* the execution is followed in the main sheet; the other views light up the same blocks */
  function showCurrent() { withView(MAIN, showCurrentMain); }
  function showCurrentMain() {
    const fid = run.curFrame && run.curFrame.func.id;
    if (fid) {
      const i = st.prog.functions.findIndex((f) => f.id === fid);
      if (i >= 0 && (i !== st.fi || st.uml)) { st.fi = i; st.uml = false; st.sel = null; render(); }
    }
    decorate();
    const el = $(`.shape[data-id="${CSS.escape(run.curId || '')}"]`, MAIN.chart);
    if (el) scrollIntoViewIfNeeded(el);
    run.viewFrame = null;
    renderVars();
    drawTrail();
  }

  /* ---- Cursor along the arrows ---- */
  let trailRaf = 0;
  function clearTrail() {
    cancelAnimationFrame(trailRaf);
    run.hold = null;
    for (const v of views) {
      if (!v.chart) continue;
      const g = $('svg .trail', v.chart); if (g) g.innerHTML = '';
      const ov = $('svg .exc-over', v.chart); if (ov) ov.innerHTML = '';
    }
    run.trailShown = null;
  }
  function findPath(from, to, branch) {
    const out = new Map();
    for (const e of st.edges || []) { if (!out.has(e.from)) out.set(e.from, []); out.get(e.from).push(e); }
    // breadth-first search: the first step from an If follows the branch really taken
    let first = out.get(from) || [];
    if (branch && branch.id === from) first = first.filter((e) => e.tag === (branch.taken ? 'T' : 'F'));
    const queue = first.map((e) => ({ node: e.to, path: [e] }));
    const seen = new Set();
    while (queue.length) {
      const { node, path } = queue.shift();
      if (node === to) return path;
      if (seen.has(node)) continue;
      seen.add(node);
      for (const e of out.get(node) || []) queue.push({ node: e.to, path: path.concat(e) });
    }
    return null;
  }
  /* in the auxiliary views with the same diagram the red arrow of an exception appears still */
  function drawAuxExc(t) {
    const NS = 'http://www.w3.org/2000/svg';
    for (const v of views) {
      if (v.main) continue;
      withView(v, () => {
        const g = $('svg .trail', V.chart); if (!g) return;
        g.innerHTML = '';
        const ov = $('svg .exc-over', V.chart); if (ov) ov.innerHTML = '';
        if (!t || !t.exc || !t.from || isUml() || func().id !== t.frame.func.id) return;
        const pts = excPath(t, g); if (pts.length < 2) return;
        const line = document.createElementNS(NS, 'path');
        line.setAttribute('class', 'trail-path exc');
        line.setAttribute('d', pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join(''));
        g.append(line);
      });
    }
  }
  function drawTrail() {
    const t = run.trail;
    const animate = run.mode === 'step' || SPEEDS[st.speed].ms > 0;
    if (!t || !animate || run.trailShown === t.step) return;
    run.trailShown = t.step;
    cancelAnimationFrame(trailRaf);
    if (run.hold) { run.hold = null; decorate(); }
    drawAuxExc(t);
    const g = $('svg .trail', V.chart); if (!g) return;
    g.innerHTML = '';
    const ov = $('svg .exc-over', V.chart); if (ov) ov.innerHTML = '';
    if (!t.from || isUml() || func().id !== t.frame.func.id) return;
    let pts = [];
    if (t.exc) pts = excPath(t, g); // exception: dashed red arrow from the block it comes from, up the exception arrow of the Try, to the Catch (or to the Finally)
    else {
      const path = findPath(t.from, t.to, t.branch);
      if (!path) return;
      for (const e of path) for (const p of e.pts) { const q = pts[pts.length - 1]; if (!q || q[0] !== p[0] || q[1] !== p[1]) pts.push(p); }
    }
    if (pts.length < 2) return;
    const seg = []; let total = 0;
    for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(l); total += l; }
    const NS = 'http://www.w3.org/2000/svg';
    const line = document.createElementNS(NS, 'path');
    line.setAttribute('class', 'trail-path' + (t.exc ? ' exc' : ''));
    line.setAttribute('d', pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join(''));
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('class', 'trail-cursor' + (t.exc ? ' exc' : '')); dot.setAttribute('r', '6');
    g.append(line, dot);
    const at = (d) => {
      let i = 0;
      while (i < seg.length - 1 && d > seg[i]) { d -= seg[i]; i++; }
      const k = seg[i] ? Math.min(1, d / seg[i]) : 1;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k];
    };
    const place = (f) => {
      line.style.strokeDasharray = `${total} ${total}`;
      line.style.strokeDashoffset = String(total * (1 - f));
      const [x, y] = at(total * f); dot.setAttribute('cx', x); dot.setAttribute('cy', y);
    };
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ms = run.mode === 'step' ? 520 : Math.min(SPEEDS[st.speed].ms * 0.8, 650);
    if (reduce || ms < 60) { place(1); return; }
    // during the trip the arrival block stays off; it lights up when the cursor arrives
    run.hold = t.to; run.holdFrom = t.from; decorate();
    const t0 = performance.now();
    const tick = (now) => {
      const f = Math.min(1, (now - t0) / ms);
      place(f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2);
      if (f < 1) trailRaf = requestAnimationFrame(tick);
      else { run.hold = null; decorate(); }
    };
    place(0);
    trailRaf = requestAnimationFrame(tick);
  }
  /* path of the exception: from the block it comes from (the one that threw it, or the call
     of the function it goes up from) to the header of the Catch that catches it or of the Finally; the starting
     block is circled in red and a label says which exception it is */
  function excPath(t, g) {
    const box = (id) => { const el = $(`.shape[data-id="${CSS.escape(id)}"]`, V.chart); return el ? el.getBBox() : null; };
    const a = box(t.from), b = box(t.to);
    if (!a || !b) return [];
    const NS = 'http://www.w3.org/2000/svg';
    const ring = document.createElementNS(NS, 'rect');
    ring.setAttribute('class', 'exc-src');
    for (const [k, v] of [['x', a.x - 5], ['y', a.y - 5], ['width', a.width + 10], ['height', a.height + 10], ['rx', 8]]) ring.setAttribute(k, v);
    const lab = document.createElementNS(NS, 'text');
    lab.setAttribute('class', 'exc-lab');
    lab.setAttribute('x', a.x - 4); lab.setAttribute('y', a.y - 9);
    lab.textContent = `⚡ ${t.exc.type}${t.exc.lost && t.exc.lost.length ? ` da ${t.exc.lost[0]}()` : ''}${t.exc.pending ? L('ui.finallyThenContinues') : ''}`;
    // above the blocks, so the label can always be read
    const svg = g.ownerSVGElement;
    const over = svg.querySelector('.exc-over') || svg.appendChild(document.createElementNS(NS, 'g'));
    over.setAttribute('class', 'exc-over'); over.innerHTML = '';
    over.append(ring, lab);
    const sy = a.y + a.height / 2, hy = b.y + b.height / 2;
    // Catch: from the block it goes right to the lane next to the blocks of the Try, up to the exception arrow that
    // leaves the Try and along it down to the Catch
    const xe = (st.edges || []).find((e) => e.tag === 'X' && e.to === t.to && e.lane != null);
    if (xe && a.x + a.width < xe.lane && sy > xe.pts[0][1]) {
      const my = xe.pts[0][1];
      return [[a.x + a.width, sy], [xe.lane, sy], [xe.lane, my], ...xe.pts.slice(1)];
    }
    if (b.x > a.x + a.width) {
      // Catch on the right: lane just to the left of its column
      const lane = b.x - 14;
      return [[a.x + a.width, sy], [lane, sy], [lane, hy], [b.x, hy]];
    }
    // Finally (below, in the middle): lane on the left
    const lane = Math.min(a.x, b.x) - 18;
    return [[a.x, sy], [lane, sy], [lane, hy], [b.x, hy]];
  }
  /* the block is all visible in the view (screen rectangle) */
  function shownIn(v, el) {
    const r = el.getBoundingClientRect(), w = v.wrap.getBoundingClientRect();
    return r.width > 0 && r.top >= w.top + 30 && r.bottom <= w.bottom - 30 && r.left >= w.left && r.right <= w.right;
  }
  function scrollIntoViewIfNeeded(el) {
    const v = viewOfEl(el) || V, wrap = v.wrap;
    const r = el.getBoundingClientRect(), w = wrap.getBoundingClientRect();
    // in the main sheet: if the block is already seen in a «Continue» view, there is no need to scroll
    if (v.main && views.some((x) => x.sync && !x.min && (() => { const o = $(`.shape[data-id="${CSS.escape(el.dataset.id)}"]`, x.chart); return o && shownIn(x, o); })())) return;
    if (v.sync) return;
    if (r.top < w.top + 30 || r.bottom > w.bottom - 30 || r.left < w.left || r.right > w.right) {
      wrap.scrollBy({ top: r.top - w.top - w.height / 2 + r.height / 2, left: r.left - w.left - w.width / 2 + r.width / 2, behavior: SPEEDS[st.speed].ms > 200 ? 'smooth' : 'auto' });
    }
  }

  function onInput(ev) {
    run.state = 'input';
    showCurrent();
    setStatus('input', L('ui.waitingForAValueFor', { varName: ev.varName }));
    const inp = $('#conInput');
    inp.disabled = false; $('#conSend').disabled = false;
    inp.placeholder = L('ui.typeAndPressEnter', { varName: ev.varName, value: TYPE_IT[ev.varType] });
    $('#conPrompt').textContent = ev.varName;
    $('#conForm').classList.add('waiting');
    // the input must be visible: if the console is in the hidden panel, the panel opens again
    if (!isFloat('console') && document.body.classList.contains('side-hidden')) setSideHidden(false);
    showPane('console');
    setTimeout(() => inp.focus(), 0);
  }
  function submitInput(text) {
    if (run.state !== 'input') return;
    conWrite(text, true, 'echo');
    const inp = $('#conInput');
    inp.value = ''; inp.disabled = true; $('#conSend').disabled = true; inp.placeholder = L('ui.inputBecomesActiveWhenTheProgram');
    $('#conPrompt').textContent = '›';
    $('#conForm').classList.remove('waiting');
    run.pending = text;
    if (run.mode === 'run') { run.state = 'running'; setStatus('running', L('ui.running')); pump(); }
    else if (run.mode === 'over') { run.state = 'running'; pumpOver(); }
    else { run.state = 'paused'; stepOnce(); }
  }

  function onFinish() {
    flushStreams();
    run.state = 'done'; runTo = null; run.fast = false;
    conWrite(L('ui.endOfProgramSteps', { toLocaleStringNaN: run.steps.toLocaleString('it-IT') }), true, 'sys');
    run.curId = null; run.curFrame = null; clearTrail();
    decorate(); renderVars();
    setStatus('done', L('ui.programFinished'));
    // after Run the results are shown: the console (even if the Variables tab was open)
    if (run.mode === 'run') {
      if (!isFloat('console') && document.body.classList.contains('side-hidden')) setSideHidden(false);
      showPane('console');
    }
  }
  function onError(e) {
    flushStreams();
    run.state = 'done'; runTo = null; run.fast = false;
    run.errId = e.stmtId || null;
    const fi = e.funcId ? st.prog.functions.findIndex((f) => f.id === e.funcId) : -1;
    if (fi >= 0 && (fi !== st.fi || st.uml)) { st.fi = fi; st.uml = false; render(); }
    if (!run.errId && e.stmtId) run.errId = e.stmtId;
    let where = '';
    if (e.stmtId) {
      const fs = M.findStmt(st.prog, e.stmtId);
      const fn = e.funcId && st.prog.functions.find((f) => f.id === e.funcId);
      if (fs) where = L('ui.inBlock', { func: fname(fs.func), text: RenderLib.caption(fs.stmt).text });
      else if (fn) where = ` (in ${fname(fn)})`;
    }
    conWrite(L('ui.error') + (e.message || String(e)) + where, true, 'error');
    decorate(); renderVars();
    const el = run.errId && $(`.shape[data-id="${CSS.escape(run.errId)}"]`, MAIN.chart);
    if (el) scrollIntoViewIfNeeded(el);
    showPane('console');
    setStatus('error', L('ui.errorDuringExecution'));
    if (!(e instanceof E.FlowError)) console.error(e);
  }
  function stopRun() {
    if (!isRunning()) return;
    stopTimer(); runTo = null; run.fast = false;
    run.stageWait = null; run.stageNext = null; run.stageHold = null; if (stageHook) stageHook.stop();
    try { run.gen.return(); } catch (e) { /* ignore */ }
    flushStreams();
    run.state = 'done';
    const inp = $('#conInput'); inp.disabled = true; $('#conSend').disabled = true; $('#conForm').classList.remove('waiting'); $('#conPrompt').textContent = '›';
    conWrite(L('ui.executionStopped'), true, 'sys');
    run.curId = null; decorate(); clearTrail();
    setStatus('done', L('ui.stopped'));
  }
  function onRunBtn() {
    if (run.state === 'paused') { run.mode = 'run'; run.state = 'running'; setStatus('running', L('ui.running')); pump(); return; }
    if (run.state === 'running' || run.state === 'input') return;
    run.errId = null;
    startRun('run');
  }
  function onStepBtn() {
    if (run.state === 'paused') { stepOnce(); return; }
    if (run.state === 'running') { stopTimer(); run.state = 'paused'; run.mode = 'step'; if (run.stageWait) afterStage(showCurrent); else showCurrent(); setStatus('paused', L('ui.paused')); return; }
    if (run.state === 'input') return;
    run.errId = null;
    startRun('step');
  }
  function onPauseBtn() {
    if (run.state !== 'running') return;
    stopTimer(); run.state = 'paused'; run.mode = 'step';
    if (run.stageWait) afterStage(showCurrent); else showCurrent();
    setStatus('paused', L('ui.paused'));
  }

  /* ---- Variables ---- */
  const CARET = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5L8 6L4.5 9.5"/></svg>';
  const GRID_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/></svg>';
  /* after each update: the object windows follow the references that change */
  function renderVars() { renderVarsTable(); ArrayView.relink(); }
  function renderVarsTable() {
    const box = $('#varsBody');
    const interp = run.interp;
    const stack = interp && isRunning() ? interp.stack : (run.mainFrame ? [run.mainFrame] : []);
    // the array windows follow the most recent call of their function
    if (ArrayView.count) ArrayView.refresh((fid, vn) => { for (let i = stack.length - 1; i >= 0; i--) { const fr = stack[i]; if (fr.func.id === fid) { const c = fr.vars.get(vn.toLowerCase()); if (c && c.array) return c; } } return null; });
    box.innerHTML = '';
    if (!stack.length) { box.append(h('p', { class: 'empty' }, L('ui.variablesAppearHereWhenYouRun'))); return; }
    const frame = run.viewFrame && stack.includes(run.viewFrame) ? run.viewFrame : stack[stack.length - 1];
    const crumbs = h('nav', { class: 'crumbs', 'aria-label': L('ui.callsInProgress') });
    stack.forEach((fr, i) => {
      if (i) crumbs.append(h('span', { class: 'sep' }, '›'));
      crumbs.append(h('button', { type: 'button', class: fr === frame ? 'on' : '', onclick: () => { run.viewFrame = fr; renderVars(); } }, fname(fr.func)));
    });
    if (stack.length > 6) crumbs.classList.add('long');
    box.append(crumbs);
    const statics = interp && interp.oo ? [...interp.statics].filter(([, m]) => m.size) : [];
    if (!frame.vars.size && !frame.self && !statics.length) { box.append(h('p', { class: 'empty' }, L('ui.noVariablesDeclaredSoFarIn') + fname(frame.func) + '.')); return; }
    const tbl = h('table', { class: 'vars' }, h('thead', null, h('tr', null, h('th', null, L('ui.name')), h('th', null, L('win.type')), h('th', null, L('win.value')))));
    const tb = h('tbody');
    // src: key of the row, to link the window to the clicked element
    const srcSel = (k) => `#varsBody [data-src="${CSS.escape(k)}"]`;
    const fmt = (v, k) => (v === undefined ? h('span', { class: 'undef' }, L('win.noValue'))
      : v.t === 'Object' && v.v ? h('button', { type: 'button', class: 'ov-link obj', 'data-src': k || null, 'data-uid': v.v.uid, title: L('ui.openTheObjectInAWindow'), onclick: () => ArrayView.openObject(v.v, k ? ArrayView.domSrc(srcSel(k)) : null) }, E.literalOf(v))
      : h('span', { class: 'v-' + v.t }, E.literalOf(v)));
    const prev = run.prevVals; const next = new Map();
    const fkey = fname(frame.func);
    /* small arrow that opens or closes the rows below (the state stays from one step to the next) */
    const makeCaret = (okey, label, onToggle) => {
      const isOpen = st.varsOpen.has(okey);
      const b = h('button', { class: 'caret' + (isOpen ? ' open' : ''), type: 'button', 'aria-expanded': String(isOpen), 'aria-label': L('ui.showOrHideTheDetailsOf', { label }), html: CARET, onclick: () => {
        const open = !st.varsOpen.has(okey);
        if (open) st.varsOpen.add(okey); else st.varsOpen.delete(okey);
        b.classList.toggle('open', open); b.setAttribute('aria-expanded', String(open));
        onToggle(open);
      } });
      return { el: b, isOpen };
    };
    const ind = (depth) => (depth ? { style: `padding-left:${8 + depth * 16}px` } : null);
    /* one row per variable or attribute; objects open to show their attributes */
    const addCell = (c, label, depth, path, seen, extra) => {
      const key = frame.depth + ':' + path;
      const tags = [c.param ? h('span', { class: 'ptag', title: L('ui.parameter') }, 'par') : null, c.constant ? h('span', { class: 'ptag', title: L('ui.constant') }, 'cost') : null, c.field && c.visibility && c.visibility !== 'public' ? h('span', { class: 'ptag vis', title: M.VIS_IT[c.visibility] }, M.VISIBILITY[c.visibility]) : null, extra || null];
      if (c.array) {
        const n = c.items.length, dims = c.dims || [n];
        const sv = String(c.writes || 0); next.set(key, sv);
        const changed = prev.has(key) && prev.get(key) !== sv;
        const src = ArrayView.domSrc(srcSel(key));
        const openArr = () => (depth ? ArrayView.open('@' + path, c, { label, fixed: true, src }) : ArrayView.open(frame.func.id, c, { src }));
        const icon = h('button', { class: 'iconbtn avopen', type: 'button', 'data-src': key, title: L('ui.showTheValues'), 'aria-label': L('ui.showTheValuesOf', { label }), html: GRID_ICON, onclick: openArr });
        const okey = fkey + '::' + path.toLowerCase();
        const detail = h('tr', { class: 'detail' + (st.varsOpen.has(okey) ? ' open' : '') + (changed ? ' changed' : '') }, h('td', { colspan: 3 },
          h('div', { class: 'det-wrap' }, h('div', { class: 'det-inner', ...(ind(depth + 1) || {}) },
            h('button', { class: 'avlink', type: 'button', tabindex: st.varsOpen.has(okey) ? '0' : '-1', title: L('ui.openAWindowWithTheValues'), onclick: openArr }, L('ui.showTheValues2'))))));
        const car = makeCaret(okey, label, (open) => { detail.classList.toggle('open', open); detail.querySelector('.avlink').tabIndex = open ? 0 : -1; });
        tb.append(h('tr', { class: 'arr' + (changed ? ' changed' : '') }, h('td', ind(depth), car.el, label, ...tags, icon), h('td', null, `${E.typeName(cellT(c))}[${dims.join(' × ')}]`), h('td', { class: 'muted' }, L('ui.elements', { n }))));
        tb.append(detail);
        return;
      }
      const v = c.value;
      const sv = v === undefined ? '∅' : E.literalOf(v); next.set(key, sv);
      const changed = prev.has(key) && prev.get(key) !== sv;
      if (v && v.t === 'Object' && v.v) {
        const obj = v.v;
        const okey = fkey + '::' + path.toLowerCase();
        const loop = seen.has(obj);
        const rows = [];
        const car = loop ? null : makeCaret(okey, label, () => renderVars());
        tb.append(h('tr', { class: 'objrow' + (changed ? ' changed' : '') }, h('td', ind(depth), car ? car.el : h('span', { class: 'caret-sp' }), label, ...tags), h('td', null, E.typeName(cellT(c))), h('td', null, fmt(v, key), loop ? h('span', { class: 'muted small' }, L('ui.alreadyAbove')) : null)));
        if (car && car.isOpen && depth < 6) {
          const s2 = new Set(seen); s2.add(obj);
          for (const fc of obj.fields.values()) addCell(fc, fc.name, depth + 1, path + '.' + fc.name, s2);
          if (!obj.fields.size) tb.append(h('tr', { class: 'objrow' }, h('td', { colspan: 3, class: 'muted small', ...(ind(depth + 1) || {}) }, L('ui.noAttributes'))));
        }
        return;
      }
      tb.append(h('tr', { class: changed ? 'changed' : '' }, h('td', ind(depth), depth || (v && v.t === 'Object') ? h('span', { class: 'caret-sp' }) : null, label, ...tags), h('td', null, E.typeName(cellT(c))), h('td', null, fmt(c.value))));
    };
    if (frame.self) addCell({ name: 'this', type: frame.self.cls.name, value: E.V.obj(frame.self) }, 'this', 0, 'this', new Set(), h('span', { class: 'ptag', title: L('ui.theObjectTheMethodWorksOn') }, L('ui.object')));
    for (const c of frame.vars.values()) addCell(c, c.name, 0, c.name, new Set());
    // static attributes: one per class, shared by all the objects
    for (const [cid, m] of statics) {
      const cls = interp.prog.classes.find((k) => k.id === cid); if (!cls) continue;
      const okey = 'statici::' + cls.name.toLowerCase();
      const car = makeCaret(okey, cls.name, () => renderVars());
      tb.append(h('tr', { class: 'objrow statrow' }, h('td', { colspan: 3 }, car.el, h('span', null, L('ui.staticAttributes', { name: cls.name })))));
      if (car.isOpen) for (const fc of m.values()) addCell(fc, `${cls.name}.${fc.name}`, 1, `static.${cls.name}.${fc.name}`, new Set());
    }
    for (const [k, v] of next) prev.set(k, v);
    tbl.append(tb); box.append(tbl);
  }

  /* ---- Files (tab) ---- */
  function renderFiles() {
    const box = $('#filesBody'); box.innerHTML = '';
    if (!st.vfs.size) box.append(h('p', { class: 'empty' }, L('ui.noFilesTheOpenReadWrite')));
    const ul = h('ul', { class: 'files' });
    for (const [name, txt] of [...st.vfs].sort()) {
      const lines = txt ? txt.split(/\r?\n/).filter((x, i, a) => !(i === a.length - 1 && x === '')).length : 0;
      ul.append(h('li', null,
        h('div', { class: 'fname' }, h('strong', null, name), h('span', { class: 'muted small' }, L('ui.lines', { lines }))),
        h('div', { class: 'factions' },
          h('button', { class: 'btn small', type: 'button', onclick: () => editFile(name) }, L('ui.open')),
          h('button', { class: 'btn small', type: 'button', onclick: () => download(name, txt, 'text/plain') }, L('ui.download')),
          h('button', { class: 'btn small danger', type: 'button', onclick: () => confirmBox(L('ui.deleteTheFile'), L('ui.willBeRemoved', { name }), L('ui.delete'), () => { st.vfs.delete(name); saveVfs(); }) }, L('ui.delete')))));
    }
    box.append(ul);
  }
  function editFile(name) {
    const nm = field({ key: 'vfname', label: L('ui.fileName'), type: 'plain', placeholder: L('ui.eGDataTxt2') }, name || '');
    const ta = h('textarea', { class: 'mono', rows: 12, id: 'vfcontent', 'aria-label': L('ui.contentOneItemPerLine') });
    ta.value = name ? st.vfs.get(name) : '';
    openModal({ title: name ? L('ui.editFile') : L('ui.newFile'), wide: true, body: h('div', { class: 'fields' }, nm, h('label', { class: 'flabel', for: 'vfcontent' }, L('ui.contentOneItemPerLine')), ta), okText: L('ui.save'), onOk: () => {
      const n = nm._get().trim(); if (!n) return L('ui.giveTheFileAName');
      if (name && n !== name) st.vfs.delete(name);
      st.vfs.set(n, ta.value); saveVfs(); return true;
    } });
  }

  /* ---- Code ---- */
  /* link between code and flowchart: every line knows the blocks it comes from (codeMap); a click on a
     block lights its lines, a click on a line lights its blocks, during execution the line of the current block */
  let codeMap = [];
  let link = null; // { from: 'chart', raw } or { from: 'code', ids, sel }
  function renderCode() {
    if (!paneVisible('code')) return;
    const { code, map } = CodeGen.generateMapped(st.prog, st.lang);
    codeMap = map;
    $('#codeOut').innerHTML = highlight(code, st.lang, map);
    $('#codeOut').dataset.raw = code;
    decorateCode();
  }
  // blocks the code follows: those of the clicked line, otherwise the selected block (and the clicked header)
  function codeFocus() {
    if (link && link.from === 'code') return link.ids;
    const sel = st.uml ? null : vget(V, 'sel'), out = new Set(st.uml ? [] : selIds());
    if (link && link.from === 'chart' && link.raw && (!sel || ownerOf(link.raw) === sel)) out.add(link.raw);
    return out;
  }
  let codeExecLine = -1;
  function decorateCode(scroll) {
    const box = $('#codeOut'); if (!box || !paneVisible('code')) return;
    const rows = box.children; if (!rows.length) return;
    const focus = codeFocus();
    // during an animation of the stage the block that made it stays lit
    const litId = run.stageHold || (run.hold ? run.holdFrom : run.curId);
    const on = run.state !== 'idle' && run.state !== 'done' && litId;
    let firstLinked = -1, firstExec = -1;
    for (let i = 0; i < rows.length; i++) {
      const ids = codeMap[i]; let lk = false, ex = false;
      if (ids && ids.size) { for (const id of ids) { if (focus.has(id)) lk = true; if (on && id === litId) ex = true; } }
      rows[i].classList.toggle('linked', lk); rows[i].classList.toggle('exec', ex);
      if (lk && firstLinked < 0) firstLinked = i;
      if (ex && firstExec < 0) firstExec = i;
    }
    // the line of the current block is brought into view when it changes; the linked ones when asked
    if (firstExec >= 0 && firstExec !== codeExecLine) showCodeRow(rows[firstExec]);
    codeExecLine = firstExec;
    if (scroll && firstLinked >= 0) showCodeRow(rows[firstLinked]);
  }
  function showCodeRow(row) {
    const box = $('#codeOut'), r = row.getBoundingClientRect(), b = box.getBoundingClientRect();
    if (r.top < b.top + 8 || r.bottom > b.bottom - 8) box.scrollTop += r.top - b.top - b.height / 3;
  }
  // click on a line: its blocks light up in the flowchart (the sheet goes to their function if no view shows it)
  function onCodeClick(e) {
    const row = e.target.closest('.cl'); if (!row) return;
    const i = [...row.parentNode.children].indexOf(row), ids = codeMap[i];
    if (!ids || !ids.size || getSelection().toString()) return;
    const fidOf = (id) => { const m = /^(start|end):(.+)$/.exec(id); if (m) return m[2]; const f = M.findStmt(st.prog, ownerOf(id)); return f && f.func.id; };
    const first = [...ids][0], fid = fidOf(first); if (!fid) return;
    const sel = [...ids].map(ownerOf).find((x) => !x.includes(':')) || null;
    const shown = views.find((v) => v.chart && $(`.shape[data-id="${CSS.escape(first)}"]`, v.chart));
    if (shown) focusView(shown);
    else { focusView(MAIN); const fi = st.prog.functions.findIndex((f) => f.id === fid); if (fi >= 0) showFunc(fi); }
    setSel(sel ? [sel] : []);
    link = { from: 'code', ids, sel };
    decorate();
    const el = $(`.shape[data-id="${CSS.escape(first)}"]`, V.chart);
    if (el) scrollIntoViewIfNeeded(el);
  }
  /* the code in rows of pieces [class, text]: tk keyword, ts string, tn number, tc comment */
  function codeTokens(code, lang) {
    const LG = CodeGen.LANGS[lang];
    const kw = new Set(LG.keywords);
    const cm = LG.comment === '#' ? '#[^\\n]*' : '\\/\\/[^\\n]*';
    const re = new RegExp(`(${cm})|("(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*')|(\\b\\d+(?:\\.\\d+)?\\b)|([\\p{L}_][\\p{L}\\p{N}_]*)|(\\n)|([\\s\\S])`, 'gu');
    const lines = [[]];
    const put = (cls, t) => { const ln = lines[lines.length - 1], last = ln[ln.length - 1]; if (last && last[0] === cls) last[1] += t; else ln.push([cls, t]); };
    let m;
    while ((m = re.exec(code))) {
      if (m[1]) put('tc', m[1]);
      else if (m[2]) put('ts', m[2]);
      else if (m[3]) put('tn', m[3]);
      else if (m[4]) put(kw.has(m[4]) ? 'tk' : '', m[4]);
      else if (m[5]) lines.push([]);
      else put('', m[6]);
    }
    return lines;
  }
  function highlight(code, lang, map) {
    const escH = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const lines = codeTokens(code, lang);
    // a final newline does not open an empty numbered row
    if (lines.length > 1 && !lines[lines.length - 1].length) lines.pop();
    // one row per line; the rows that come from blocks can be clicked; the escape sequences of the strings in red
    return lines.map((ln, i) => `<span class="cl${map && map[i] && map[i].size ? ' src' : ''}"><span class="ln"></span>` + ln.map(([c, t]) => c === 'ts' ? `<span class="ts">${escH(t).replace(/\\./g, (e) => `<span class="tesc">${e}</span>`)}</span>` : c ? `<span class="${c}">${escH(t)}</span>` : escH(t)).join('') + '</span>').join('');
  }

  /* ------------------------- Tabs and floating windows --------------------- */
  const PANES = [['console', L('ui.console')], ['vars', L('ui.variables')], ['code', L('ui.code')], ['files', L('ui.files')]];
  const PANE_TITLE = Object.fromEntries(PANES);
  const ICON_POP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';
  const ICON_MIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>';
  const ICON_RESTORE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  const ICON_DOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16M11 9l-3 3 3 3M8 12h0"/></svg>';
  const layout = (() => {
    const l = store.get('layout', null) || {};
    const ids = PANES.map((p) => p[0]);
    l.order = (Array.isArray(l.order) ? l.order.filter((x) => ids.includes(x)) : []);
    for (const id of ids) if (!l.order.includes(id)) l.order.push(id);
    l.float = l.float && typeof l.float === 'object' ? l.float : {};
    for (const k of Object.keys(l.float)) if (!ids.includes(k)) delete l.float[k];
    return l;
  })();
  const saveLayout = () => store.set('layout', layout);
  let zTop = 30;
  const isFloat = (t) => !!layout.float[t];
  const paneVisible = (t) => isFloat(t) || st.tab === t;

  function setTab(t) {
    if (isFloat(t)) { raiseWin(t); refreshPane(t); return; }
    st.tab = t; store.set('tab', t);
    $$('#tabs [role=tab]').forEach((b) => { const on = b.dataset.tab === t; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; });
    $$('#side > .pane').forEach((p) => { p.hidden = p.id !== 'pane-' + t; });
    refreshPane(t);
  }
  function refreshPane(t) {
    if (t === 'code') renderCode();
    if (t === 'vars') renderVars();
    if (t === 'files') renderFiles();
  }
  const showPane = (t) => { if (isFloat(t)) minimizeWin(t, false); setTab(t); };

  function buildTabs() {
    const bar = $('#tabs');
    bar.innerHTML = '';
    const docked = layout.order.filter((id) => !isFloat(id));
    for (const id of docked) {
      const w = h('div', { class: 'tabw', 'data-tab': id, draggable: 'true', role: 'presentation' },
        h('button', { role: 'tab', type: 'button', 'data-tab': id, title: L('ui.dragToReorderOrOntoThe'), onclick: () => setTab(id) }, PANE_TITLE[id]),
        h('button', { class: 'detach', type: 'button', title: L('ui.detachIntoAFloatingWindow'), 'aria-label': L('ui.detach') + PANE_TITLE[id], html: ICON_POP, onclick: (e) => { e.stopPropagation(); detachPane(id); } }));
      w.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-flowlab-pane', id); e.dataTransfer.setData('text/plain', PANE_TITLE[id]); e.dataTransfer.effectAllowed = 'move'; w.classList.add('dragging'); document.body.classList.add('panedrag'); });
      w.addEventListener('dragend', () => { w.classList.remove('dragging'); document.body.classList.remove('panedrag'); $$('.tabw').forEach((x) => x.classList.remove('drop-before', 'drop-after')); });
      w.addEventListener('dragover', (e) => {
        if (![...e.dataTransfer.types].includes('application/x-flowlab-pane')) return;
        e.preventDefault(); e.dataTransfer.dropEffect = 'move';
        const r = w.getBoundingClientRect(); const after = e.clientX > r.left + r.width / 2;
        $$('.tabw').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
        w.classList.add(after ? 'drop-after' : 'drop-before');
      });
      w.addEventListener('drop', (e) => {
        const src = e.dataTransfer.getData('application/x-flowlab-pane'); if (!src) return;
        e.preventDefault(); e.stopPropagation();
        const after = w.classList.contains('drop-after');
        movePaneTo(src, id, after);
      });
      bar.append(w);
    }
    document.body.classList.toggle('side-empty', docked.length === 0);
    if (docked.length && !docked.includes(st.tab)) st.tab = docked[0];
    if (docked.length) setTab(st.tab);
  }
  function movePaneTo(src, target, after) {
    if (src === target) return;
    const o = layout.order.filter((x) => x !== src);
    let i = o.indexOf(target); if (after) i++;
    o.splice(i, 0, src);
    layout.order = o;
    if (isFloat(src)) { dockPane(src, true); return; }
    saveLayout(); buildTabs(); setTab(src);
  }

  function winHost() { return $('#floatLayer'); }
  function detachPane(id, at) {
    const col = $('.canvas-col').getBoundingClientRect();
    const n = Object.keys(layout.float).length;
    const w = Math.min(420, window.innerWidth - 24), hh = Math.min(id === 'console' ? 360 : 400, window.innerHeight - 80);
    let x = col.right - w - 24 - n * 26, y = col.top + 16 + n * 26;
    if (at) { x = at.x - 60; y = at.y - 14; }
    layout.float[id] = { x, y, w, h: hh, min: false };
    saveLayout();
    mountWin(id);
    buildTabs();
    raiseWin(id);
    refreshPane(id);
  }
  function mountWin(id) {
    const pane = $('#pane-' + id);
    const g = layout.float[id];
    const body = h('div', { class: 'fwin-body' });
    const win = h('div', { class: 'fwin', 'data-win': id, role: 'dialog', 'aria-label': PANE_TITLE[id] },
      h('div', { class: 'fwin-head' },
        h('span', { class: 'fwin-title' }, PANE_TITLE[id]),
        h('span', { class: 'grow' }),
        h('button', { class: 'iconbtn minbtn', type: 'button', title: L('ui.collapseToTheTitleBar'), 'aria-label': L('ui.collapse') + PANE_TITLE[id], 'aria-expanded': 'true', html: ICON_MIN, onclick: () => minimizeWin(id) }),
        h('button', { class: 'iconbtn dock', type: 'button', title: L('ui.putBackInThePanel'), 'aria-label': L('ui.putBack') + PANE_TITLE[id] + L('ui.inThePanel'), html: ICON_DOCK, onclick: () => dockPane(id) })),
      body);
    pane.hidden = false;
    body.append(pane);
    winHost().append(win);
    Object.assign(win.style, { left: g.x + 'px', top: g.y + 'px', width: g.w + 'px', height: g.h + 'px' });
    if (g.min) setMinUi(win, true);
    clampWin(win);
    win.addEventListener('pointerdown', () => raiseWin(id), true);
    const head = win.querySelector('.fwin-head');
    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      e.preventDefault();
      head.setPointerCapture(e.pointerId);
      const sx = e.clientX, sy = e.clientY, ox = win.offsetLeft, oy = win.offsetTop;
      win.classList.add('moving');
      const mv = (ev) => { win.style.left = ox + ev.clientX - sx + 'px'; win.style.top = oy + ev.clientY - sy + 'px'; clampWin(win); };
      const up = () => { head.removeEventListener('pointermove', mv); head.removeEventListener('pointerup', up); head.removeEventListener('pointercancel', up); win.classList.remove('moving'); saveWin(id, win); };
      head.addEventListener('pointermove', mv); head.addEventListener('pointerup', up); head.addEventListener('pointercancel', up);
    });
    head.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) dockPane(id); });
    if (window.ResizeObserver) {
      let t = null;
      new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => { if (win.isConnected) { clampWin(win); saveWin(id, win); } }, 200); }).observe(win);
    }
  }
  function clampWin(win) {
    const host = winHost();
    const W = host.clientWidth, H = host.clientHeight;
    if (win.offsetWidth > W) win.style.width = W + 'px';
    if (win.offsetHeight > H) win.style.height = H + 'px';
    const x = Math.max(0, Math.min(win.offsetLeft, W - win.offsetWidth));
    const y = Math.max(0, Math.min(win.offsetTop, H - win.offsetHeight));
    win.style.left = x + 'px'; win.style.top = y + 'px';
  }
  function saveWin(id, win) {
    const prev = layout.float[id]; if (!prev) return;
    const min = win.classList.contains('min');
    layout.float[id] = { x: win.offsetLeft, y: win.offsetTop, w: win.offsetWidth, h: min ? prev.h : win.offsetHeight, min };
    saveLayout();
  }
  function setMinUi(win, min) {
    win.classList.toggle('min', min);
    const b = win.querySelector('.minbtn');
    b.innerHTML = min ? ICON_RESTORE : ICON_MIN;
    b.title = min ? L('ui.restoreTheWindow') : L('ui.collapseToTheTitleBar');
    b.setAttribute('aria-expanded', String(!min));
  }
  /* reduces the window to its title bar only, or restores it (force = true/false to impose the state) */
  function minimizeWin(id, force) {
    const win = $(`.fwin[data-win="${id}"]`); const g = layout.float[id];
    if (!win || !g) return;
    const min = force === undefined ? !win.classList.contains('min') : force;
    if (min === win.classList.contains('min')) return;
    if (min) g.h = win.offsetHeight;
    setMinUi(win, min);
    if (!min) win.style.height = g.h + 'px';
    g.min = min;
    clampWin(win); saveLayout();
    if (!min) refreshPane(id);
  }
  function raiseWin(id) {
    const win = $(`.fwin[data-win="${id}"]`); if (!win) return;
    win.style.zIndex = ++zTop;
    $$('.fwin').forEach((x) => x.classList.toggle('active', x === win));
  }
  function setSideHidden(hidden) {
    document.body.classList.toggle('side-hidden', hidden);
    const b = $('#sideToggle');
    b.title = (hidden ? L('ui.showThePanel') : L('ui.hideThePanel')) + ' (Ctrl+B)';
    b.setAttribute('aria-label', b.title);
    b.setAttribute('aria-expanded', String(!hidden));
    store.set('sideHidden', hidden);
  }
  function dockPane(id, keepOrder) {
    const win = $(`.fwin[data-win="${id}"]`);
    const pane = $('#pane-' + id);
    $('#side').append(pane);
    setSideHidden(false);
    if (win) win.remove();
    delete layout.float[id];
    saveLayout();
    st.tab = id;
    buildTabs();
    setTab(id);
  }
  /* every floating window (views, detached tabs, arrays, objects) is resized from all its edges and corners:
     near the border the cursor changes and dragging moves that edge (a minimized window only left and right) */
  function edgeResize() {
    const OUT = 5, IN = 3, root = document.documentElement; // grip zone: a little outside and a little inside the border
    const CUR = { n: 'ns', s: 'ns', e: 'ew', w: 'ew', ne: 'nesw', sw: 'nesw', nw: 'nwse', se: 'nwse' };
    let drag = null;
    const zOf = (w) => +getComputedStyle(w).zIndex || 0;
    const edgeAt = (e) => {
      const t = e.target;
      if (!t || !t.closest || t.closest('.modal, .ctxmenu, .pop, .popover, select')) return null;
      const own = t.closest('.fwin');
      // just outside a window the border wins over the sheet, but not over a block, a button or a field
      const out = own ? 0 : t.closest('.shape, .ins, .ubox, button, input, select, textarea, a, [role=tab]') ? 0 : OUT;
      const x = e.clientX, y = e.clientY;
      // the topmost window with the point in its border zone (a window above it hides it)
      const wins = [...document.querySelectorAll('.fwin')].filter((w) => w.getClientRects().length)
        .map((w) => ({ w, z: zOf(w), r: w.getBoundingClientRect() }))
        .filter(({ r }) => x > r.left - out && x < r.right + out && y > r.top - out && y < r.bottom + out)
        .sort((a, b) => b.z - a.z);
      if (!wins.length) return null;
      const { w: win, r } = wins[0];
      if (own && own !== win) return null;
      let ed = '';
      if (!win.classList.contains('min')) { if (Math.abs(y - r.top) < (y < r.top ? out : IN)) ed = 'n'; else if (Math.abs(r.bottom - y) < (y > r.bottom ? out : IN)) ed = 's'; }
      if (Math.abs(x - r.left) < (x < r.left ? out : IN)) ed += 'w'; else if (Math.abs(r.right - x) < (x > r.right ? out : IN)) ed += 'e';
      return ed ? { win, ed } : null;
    };
    const setCursor = (ed) => { if (ed) root.dataset.rs = CUR[ed]; else delete root.dataset.rs; };
    document.addEventListener('pointermove', (e) => { if (!drag) { const h = edgeAt(e); setCursor(h && h.ed); } }, true);
    document.addEventListener('pointerdown', (e) => {
      if (!e.isTrusted || e.button !== 0) return;
      const h = edgeAt(e); if (!h) return;
      e.preventDefault(); e.stopPropagation();
      const { win, ed } = h;
      // the window comes to the front as with any other click on it
      win.dispatchEvent(new PointerEvent('pointerdown', { bubbles: false, button: 0, clientX: e.clientX, clientY: e.clientY }));
      const cs = getComputedStyle(win), minW = parseFloat(cs.minWidth) || 160, minH = parseFloat(cs.minHeight) || 100;
      drag = { win, ed, sx: e.clientX, sy: e.clientY, x: win.offsetLeft, y: win.offsetTop, w: win.offsetWidth, h: win.offsetHeight, minW, minH };
      document.body.classList.add('resizing');
      setCursor(ed);
      const mv = (ev) => {
        const d = drag, dx = ev.clientX - d.sx, dy = ev.clientY - d.sy, st = d.win.style;
        if (d.ed.includes('e')) st.width = Math.max(d.minW, d.w + dx) + 'px';
        if (d.ed.includes('s')) st.height = Math.max(d.minH, d.h + dy) + 'px';
        if (d.ed.includes('w')) { const w = Math.max(d.minW, Math.min(d.w - dx, d.x + d.w)); st.width = w + 'px'; st.left = d.x + d.w - w + 'px'; }
        if (d.ed.includes('n')) { const hh = Math.max(d.minH, Math.min(d.h - dy, d.y + d.h)); st.height = hh + 'px'; st.top = d.y + d.h - hh + 'px'; }
      };
      const up = () => {
        window.removeEventListener('pointermove', mv, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', up, true);
        drag = null; document.body.classList.remove('resizing'); setCursor(null);
      };
      window.addEventListener('pointermove', mv, true); window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', up, true);
    }, true);
  }
  function initLayout() {
    for (const id of layout.order) if (isFloat(id)) mountWin(id);
    buildTabs();
    edgeResize();
    window.addEventListener('resize', () => $$('.fwin').forEach(clampWin));
    // dragging a tab onto the diagram detaches it at that point
    const col = winHost();
    col.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('application/x-flowlab-pane')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } });
    col.addEventListener('drop', (e) => {
      const id = e.dataTransfer.getData('application/x-flowlab-pane'); if (!id) return;
      e.preventDefault(); e.stopPropagation();
      if (!isFloat(id)) detachPane(id, { x: e.clientX, y: e.clientY });
    });
  }

  /* ========================== AUXILIARY VIEWS ===========================
     floating windows with a diagram of the program, to navigate and edit like the main
     sheet (also the same diagram, on another part). With «Continue» the view shows the
     continuation of the main sheet: the part that goes out of the bottom of the window, and it scrolls with it;
     several «Continue» views line up, one after the other */
  let viewSeq = 0;
  const ICON_COMPACT = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect class="cb1" x="6" y="2.5" width="12" height="5" rx="1"/><path class="cb-arrow" d="M12 7.5v3"/><rect class="cb2" x="6" y="10.5" width="12" height="5" rx="1"/><path class="cb-arrow" d="M12 15.5v3"/><rect class="cb3" x="6" y="18.5" width="12" height="3.5" rx="1"/></svg>';
  const ICON_CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const fidAt = (i) => { const f = st.prog.functions[i]; return f && f.id; };
  /* o: saved position and state (fi, uml, zoom, compact, sync, min, x, y, w, h); without it, the view
     starts from the diagram of the active view */
  function openView(o) {
    o = o || {};
    const n = views.length - 1;
    const fi = o.fi != null ? Math.max(0, Math.min(o.fi, st.prog.functions.length - 1)) : st.fi;
    const v = { id: ++viewSeq, main: false, sync: false, min: false, h: 0, pans: new Map(), panKey: null,
      state: { fi, uml: o.fi != null ? !!o.uml : st.uml, sel: null, usel: null, zoom: o.zoom || st.zoom, ins: [], edges: [], compact: o.fi != null ? !!o.compact : !!st.compact, compactFid: fidAt(fi), fid: fidAt(fi) } };
    v.sel = h('select', { class: 'vsel', 'aria-label': L('ui.diagramOfTheView') });
    enhanceSel(v.sel);
    v.compactBtn = h('button', { class: 'vcompact', type: 'button', 'aria-pressed': 'false', html: ICON_COMPACT + `<span class="lbl">${L('ui.compact')}</span>` });
    v.syncBtn = h('button', { class: 'vsync', type: 'button', 'aria-pressed': 'false', title: L('ui.continueTheMainSheetTheView') }, v.syncIco = h('span', { 'aria-hidden': 'true' }, '⇣'), L('ui.continue2'));
    v.zoomVal = h('button', { class: 'vzoomval', type: 'button', title: L('ui.backTo100') }, '100%');
    const zb = (label, title, fn) => h('button', { type: 'button', 'aria-label': title, title, onclick: () => { focusView(v); fn(); } }, label);
    const minBtn = h('button', { class: 'iconbtn minbtn', type: 'button', title: L('ui.collapseToTheTitleBar'), 'aria-label': L('ui.collapseTheView'), 'aria-expanded': 'true', html: ICON_MIN });
    const closeBtn = h('button', { class: 'iconbtn vclose', type: 'button', title: L('ui.closeTheView'), 'aria-label': L('ui.closeTheView'), html: ICON_CLOSE });
    v.chart = h('div', { class: 'vchart' });
    v.wrap = h('div', { class: 'vwrap' }, v.chart);
    v.done = h('div', { class: 'vdone', hidden: true }, L('ui.theRestOfTheDiagramIs'));
    const head = h('div', { class: 'fwin-head' }, v.sel, v.syncBtn, h('span', { class: 'grow' }), minBtn, closeBtn);
    // on the sheet of the view, as in the main one: Compact at the top left, the zoom at the bottom left
    const tools = h('div', { class: 'vtools' }, v.compactBtn);
    const zoom = h('div', { class: 'zoombar vzoombar', role: 'group', 'aria-label': L('ui.viewZoom') },
      zb('−', L('ui.zoomOut'), () => zoomAt(v, st.zoom / 1.15)), v.zoomVal, zb('+', L('ui.zoomIn'), () => zoomAt(v, st.zoom * 1.15)), zb('⤢', L('ui.fitToWindow'), fitZoom), panButton());
    v.win = h('div', { class: 'fwin auxwin', role: 'region', 'aria-label': L('ui.auxiliaryView') }, head, h('div', { class: 'fwin-body' }, v.wrap, tools, zoom, v.done));
    // position: on the right, a little staggered from the other views; it can also cover the side panel
    const col = $('.canvas-col').getBoundingClientRect();
    const w = o.w || Math.round(Math.max(420, Math.min(600, window.innerWidth * 0.38))), hh = o.h || Math.max(260, col.height - 80);
    Object.assign(v.win.style, { left: (o.x != null ? o.x : window.innerWidth - w - 16 - n * 28) + 'px', top: (o.y != null ? o.y : col.top + 12 + n * 28) + 'px', width: w + 'px', height: hh + 'px', zIndex: ++zTop });
    v.h = hh;
    winHost().append(v.win);
    clampWin(v.win);
    views.push(v);
    document.body.classList.add('hasviews');
    bindChart(v);
    v.win.addEventListener('pointerdown', () => { v.win.style.zIndex = ++zTop; }, true);
    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button, select')) return;
      e.preventDefault();
      head.setPointerCapture(e.pointerId);
      const sx = e.clientX, sy = e.clientY, ox = v.win.offsetLeft, oy = v.win.offsetTop;
      v.win.classList.add('moving');
      const mv = (ev) => { v.win.style.left = ox + ev.clientX - sx + 'px'; v.win.style.top = oy + ev.clientY - sy + 'px'; clampWin(v.win); };
      const up = () => { head.removeEventListener('pointermove', mv); head.removeEventListener('pointerup', up); head.removeEventListener('pointercancel', up); v.win.classList.remove('moving'); saveViewsSoon(); };
      head.addEventListener('pointermove', mv); head.addEventListener('pointerup', up); head.addEventListener('pointercancel', up);
    });
    head.addEventListener('dblclick', (e) => { if (!e.target.closest('button, select')) minimizeView(v); });
    v.sel.addEventListener('change', () => { focusView(v); if (v.sel.value === 'uml') showUml(); else showFunc(+v.sel.value); });
    v.compactBtn.addEventListener('click', () => { focusView(v); toggleCompact(); });
    v.syncBtn.addEventListener('click', () => { focusView(v); setSync(v, !v.sync); });
    v.zoomVal.addEventListener('click', () => { focusView(v); setZoom(1); });
    minBtn.addEventListener('click', () => minimizeView(v));
    closeBtn.addEventListener('click', () => closeView(v));
    if (window.ResizeObserver) new ResizeObserver(() => { if (v.win.isConnected) { scheduleSync(); saveViewsSoon(); } }).observe(v.win);
    withView(v, renderChart);
    if (o.sync) setSync(v, true);
    if (o.min) minimizeView(v, true);
    decorate();
    if (!o.restore) focusView(v);
    saveViewsSoon();
    return v;
  }
  /* header of the active view: selector, Compact, Continue */
  function renderViewHead(v) {
    fillFuncOptions(v.sel);
    v.sel.title = v.sync ? L('ui.theViewFollowsTheMainSheet') : L('ui.diagramShownInTheView');
    v.wrap.classList.toggle('uml', isUml());
    const cb = v.compactBtn, can = !isUml() && !(isOO() && func().abstract);
    cb.hidden = !can;
    cb.setAttribute('aria-pressed', String(!!st.compact && can));
    cb.querySelector('.lbl').textContent = st.compact && can ? L('ui.expand') : L('ui.compact');
    cb.title = v.sync ? L('ui.compactOrExtendedViewAsIn') : st.compact ? L('ui.extendedViewArrowsBetweenAllBlocks2') : L('ui.compactViewBlocksInSequenceTouch2');
    cb.setAttribute('aria-label', cb.title);
    const o = v.sel.options[v.sel.selectedIndex];
    v.win.setAttribute('aria-label', L('ui.view') + (o ? o.textContent : ''));
  }
  /* «Continue»: the view follows the main sheet (diagram, zoom, compact view) */
  function setSync(v, on) {
    v.sync = !!on; v.syncKey = null;
    v.syncBtn.setAttribute('aria-pressed', String(v.sync));
    v.win.classList.toggle('sync', v.sync);
    if (v.sync) {
      if (v === V) { saveViewState(v); loadViewState(v); renderChart(); } else withView(v, renderChart);
      decorate();
      toast(L('ui.theViewShowsThePartOf'));
    } else { v.done.hidden = true; v.padB = 0; v.chart.style.paddingBottom = ''; withView(v, () => renderViewHead(v)); }
    scheduleSync(); saveViewsSoon();
  }
  function minimizeView(v, force) {
    const min = force === undefined ? !v.min : force;
    if (min === v.min) return;
    if (min) v.h = v.win.offsetHeight;
    v.min = min;
    setMinUi(v.win, min);
    if (!min) v.win.style.height = v.h + 'px';
    clampWin(v.win); scheduleSync(); saveViewsSoon();
  }
  function closeView(v) {
    if (V === v) focusView(MAIN);
    const i = views.indexOf(v); if (i > 0) views.splice(i, 1);
    v.win.remove();
    document.body.classList.toggle('hasviews', views.length > 1);
    scheduleSync(); saveViewsSoon();
  }
  /* another program: the views close */
  function resetViews() { focusView(MAIN); for (const v of views.slice(1)) closeView(v); bpMarks.clear(); forgetPans(MAIN); }
  let syncRaf = 0;
  function scheduleSync() {
    if (syncRaf) return;
    syncRaf = requestAnimationFrame(() => { syncRaf = 0; syncScroll(); });
  }
  /* the «Continue» views show what the main sheet does not show: if the sheet is scrolled
     down, the first shows the part cut off at the top (up to the point where the sheet starts);
     the others, in a row, the part that goes out of the bottom */
  let needView = false;
  function syncScroll() {
    const ms = $('svg', MAIN.chart);
    let mStart = 0;
    if (ms) {
      const pw = MAIN.wrap.getBoundingClientRect(), pr = ms.getBoundingClientRect();
      mStart = pw.top + MAIN.wrap.clientTop - pr.top;
    }
    const topCut = !!ms && mStart > 4;
    let shownFrom = mStart; // the drawing is seen from here down (in the sheet or in a «Continue» view above it)
    let prev = MAIN, first = true, n = 0;
    const marks = new Map(); // marks of the point in common: view → { top, bottom }
    const mark = (v, edge, m) => { if (!marks.has(v)) marks.set(v, {}); marks.get(v)[edge] = m; };
    for (const v of views) {
      if (v.main || !v.sync || v.min) continue;
      const above = first && topCut; first = false;
      const link = { n: ++n, color: LINK_COLORS[(n - 1) % LINK_COLORS.length], dir: above ? '⇡' : '⇣' };
      v.win.style.setProperty('--lc', link.color);
      v.win.classList.toggle('above', above);
      v.syncIco.textContent = above ? '⇡' : '⇣';
      const ps = $('svg', prev.chart), vs = $('svg', v.chart);
      if (!ms || !ps || !vs) { v.done.hidden = true; continue; }
      const pw = prev.wrap.getBoundingClientRect(), pr = ps.getBoundingClientRect();
      const ww = v.wrap.getBoundingClientRect(), vr = vs.getBoundingClientRect();
      // only vertically: horizontally the view is free (centred on the drawing when it starts to follow the sheet)
      if (above) {
        // at the bottom of the view, the point of the drawing where the main sheet starts
        v.wrap.scrollTop += vr.top - ww.top - v.wrap.clientTop + mStart - v.wrap.clientHeight;
        shownFrom = mStart - v.wrap.clientHeight;
        v.done.hidden = true;
        // point in common: the top edge of the sheet and the same point of the drawing in the view
        mark(MAIN, 'top', Object.assign({ y: 0 }, link));
        mark(v, 'bottom', Object.assign({ y: vs.getBoundingClientRect().top + mStart - ww.top - v.wrap.clientTop }, link));
        continue;
      }
      // point of the drawing (in screen pixels) that is at the bottom of the previous view
      const endY = pw.top + prev.wrap.clientTop + prev.wrap.clientHeight - pr.top;
      // below the drawing there is space to scroll beyond the end
      const need = Math.ceil(Math.max(0, endY - vr.height) + v.wrap.clientHeight + 40);
      if ((v.padB || 0) < need) { v.padB = need + 400; v.chart.style.paddingBottom = v.padB + 'px'; }
      v.wrap.scrollTop += vr.top - ww.top - v.wrap.clientTop + endY;
      v.done.hidden = endY < pr.height - 4;
      // point in common: the bottom edge of the previous view and the same point of the drawing in this one
      mark(prev, 'bottom', Object.assign({ y: prev.wrap.clientHeight }, link));
      mark(v, 'top', Object.assign({ y: vs.getBoundingClientRect().top + endY - ww.top - v.wrap.clientTop }, link));
      prev = v;
    }
    for (const v of views) drawLinks(v, marks.get(v) || {});
    // dot on the «New view» button: at least one whole block is above the top of the sheet and not
    // seen in any view (the part beyond the bottom does not light it: one simply scrolls down to it)
    needView = false;
    if (ms && topCut) {
      const top = ms.getBoundingClientRect().top;
      needView = [...ms.querySelectorAll('.shape')].some((e) => { const r = e.getBoundingClientRect(); return r.height && r.bottom - top <= mStart && r.top - top < shownFrom; });
    }
    const b = $('#viewAdd');
    b.classList.toggle('notify', needView);
    b.title = needView ? L('ui.newContinueViewShowsThePart') : L('ui.newViewAnotherWindowOnThe');
    b.setAttribute('aria-label', needView ? L('ui.newContinueViewPartOfThe') : L('ui.newView'));
  }
  /* mark of the point in common between two views linked by «Continue»: a dashed line of the
     same colour with the number of the view, at the point of the drawing where one ends and the other starts */
  const LINK_COLORS = ['#d9480f', '#7048e8', '#2b8a3e', '#c2255c', '#1971c2'];
  function drawLinks(v, m) {
    const host = v.main ? $('.canvas-col') : v.wrap.parentNode;
    v.links = v.links || {};
    for (const edge of ['top', 'bottom']) {
      let el = v.links[edge];
      const k = m[edge];
      const y = k ? Math.round(k.y) : -1;
      if (!k || y < -1 || y > v.wrap.clientHeight + 1) { if (el) el.hidden = true; continue; }
      if (!el) { el = v.links[edge] = h('div', { class: 'vlink', 'aria-hidden': 'true' }, h('span', { class: 'vlink-b' })); host.append(el); }
      el.hidden = false;
      el.className = 'vlink ' + edge;
      el.style.setProperty('--lc', k.color);
      el.style.top = (v.wrap.offsetTop + v.wrap.clientTop + Math.max(0, Math.min(y, v.wrap.clientHeight))) + 'px';
      el.style.left = v.wrap.offsetLeft + 'px'; el.style.width = v.wrap.clientWidth + 'px';
      el.firstChild.textContent = k.dir + ' ' + k.n;
      if (v.main) { const t = edge === 'top' ? $('#chartTools') : $('.zoombar'); el.firstChild.style.left = Math.max(8, t.offsetLeft + t.offsetWidth + 10 - v.wrap.offsetLeft) + 'px'; }
      el.title = v.main ? L('ui.hereTheSheetContinuesInView', { n: k.n }) : L('ui.pointInCommonWith', { text: k.n === 1 || k.dir === '⇡' ? L('ui.theMainSheet') : L('ui.view2') + (k.n - 1) });
    }
  }
  /* with the dot on, the new view is already «Continue» */
  function newView() { if (syncRaf) { cancelAnimationFrame(syncRaf); syncRaf = 0; syncScroll(); } openView(needView ? { sync: true } : undefined); }
  /* the views are remembered with the open program (automatic saving) */
  function viewsData() {
    return views.filter((v) => !v.main).map((v) => {
      const id = v === V ? fidAt(st.fi) : v.state.fid;
      const fi = Math.max(0, st.prog.functions.findIndex((f) => f.id === id));
      return { fi, uml: !!vget(v, 'uml'), zoom: vget(v, 'zoom'), compact: !!vget(v, 'compact'), sync: v.sync, min: v.min, x: v.win.offsetLeft, y: v.win.offsetTop, w: v.win.offsetWidth, h: v.min ? v.h : v.win.offsetHeight };
    });
  }
  /* the active view is the one clicked or where the keyboard cursor is brought */
  function bindViews() {
    const pick = (e) => {
      const t = e.target; if (!t || !t.closest) return;
      const w = t.closest('.auxwin');
      if (w) focusView(views.find((v) => v.win === w));
      else if (t.closest('.canvas-col, header.bar')) focusView(MAIN);
    };
    document.addEventListener('pointerdown', pick, true);
    document.addEventListener('focusin', pick, true);
    $('#viewAdd').addEventListener('click', newView);
    if (window.ResizeObserver) new ResizeObserver(scheduleSync).observe(MAIN.wrap);
  }
  let viewsTimer = 0;
  function saveViewsSoon() { clearTimeout(viewsTimer); viewsTimer = setTimeout(autosave, 300); }

  /* ----------------------------- Saving ----------------------------- */
  function safeName(s) { return (s || L('ui.program')).replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').slice(0, 60) || L('ui.program'); }
  async function download(name, text, mime) {
    if (window.showSaveFilePicker && window.self === window.top) {
      try {
        const ext = name.split('.').pop();
        const hdl = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: ext.toUpperCase(), accept: { [mime]: ['.' + ext] } }] });
        const w = await hdl.createWritable(); await w.write(text); await w.close();
        toast(L('ui.saved') + hdl.name, 'ok');
        return hdl.name;
      } catch (e) { if (e && e.name === 'AbortError') return null; }
    }
    const blob = text instanceof Blob ? text : new Blob([text], { type: mime + ';charset=utf-8' });
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return name;
  }
  async function saveFile() {
    const xml = M.serializeFprg(st.prog);
    const ext = M.extendedFeatures(st.prog);
    if (ext.length) toast(L('ui.savedInExtendedFprgFormatFlowlab', { list: ext.join(', ') }), 'warn');
    const name = st.fileName || safeName(st.prog.attrs.name) + '.fprg';
    // file opened with a double click in the installed app: it is saved directly there
    if (st.fileHandle) {
      try {
        const fh = st.fileHandle, mode = { mode: 'readwrite' };
        if ((await fh.queryPermission(mode)) !== 'granted' && (await fh.requestPermission(mode)) !== 'granted') throw new Error(L('ui.permissionDenied'));
        const w = await fh.createWritable(); await w.write(xml); await w.close();
        toast(L('ui.saved') + fh.name, 'ok'); st.dirty = false; autosave();
        return;
      } catch (e) { st.fileHandle = null; }
    }
    const saved = await download(name, xml, 'application/xml');
    if (saved) { st.fileName = saved; st.dirty = false; autosave(); }
  }
  /* keepUndo: the previous program stays recoverable with Undo */
  function loadText(text, name, keepUndo) {
    let prog;
    try { prog = M.parseFprg(text); } catch (e) { toast(e.message, 'error'); return false; }
    if (isRunning()) stopRun();
    resetViews();
    const before = keepUndo ? snapshot() : null;
    st.excPos = new Map(); st.fmodPos = new Map();
    st.undo = before ? [before] : []; st.redo = []; st.prog = prog; st.fi = 0; st.sel = null; st.fileName = name || null; st.dirty = false; st.sourceUrl = null; st.fileHandle = null; st.stageBase = null;
    run.errId = null; run.mainFrame = null;
    startView();
    render(); renderVars();
    // the stages named by the program (after openUrl has set the address the program comes from)
    setTimeout(syncStages, 0);
    setTimeout(fitIfLarge, 0);
    if (prog.skipped && prog.skipped.length) toast(L('ui.openedSkippedUnsupportedBlocks', { value: name || L('ui.program'), skippedCount: prog.skipped.length, list: [...new Set(prog.skipped)].join(', ') }), 'warn');
    else toast(L('ui.opened', { value: name || L('ui.program'), text: before ? L('ui.ctrlZToGoBackTo') : '' }), 'ok');
    return true;
  }

  /* ------------------------ Opening from a web address ----------------------
     FlowLab.html?url=https://…/program.fprg opens the file at startup. The site must
     allow reading from other pages (CORS): for example a file on
     GitHub (the «blob» links become the raw file), GitHub Pages, a Gist. */
  function rawUrl(u) {
    const s = String(u).trim();
    let m = s.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/i);
    if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3].replace(/[?#].*$/, '')}`;
    m = s.match(/^https?:\/\/gist\.github\.com\/([^/]+)\/([0-9a-f]+)\/?$/i);
    if (m) return `https://gist.githubusercontent.com/${m[1]}/${m[2]}/raw`;
    if (/^https?:\/\/(www\.)?dropbox\.com\//i.test(s)) return s.replace(/([?&])dl=0/, '$1dl=1').replace(/^https?:\/\/(www\.)?dropbox\.com/i, 'https://dl.dropboxusercontent.com');
    return s;
  }
  async function openUrl(u, keepUndo) {
    const src = rawUrl(u);
    let abs;
    try { abs = new URL(src, location.href).href; } catch (e) { toast(L('ui.invalidAddress') + u, 'error'); return false; }
    toast(L('ui.opening') + abs + '…');
    let text;
    try {
      const r = await fetch(abs, { cache: 'no-cache' });
      if (!r.ok) throw new Error(L('ui.theServerReplies', { status: r.status, value: r.statusText || '' }).trim());
      text = await r.text();
    } catch (e) {
      const why = e instanceof TypeError ? L('ui.theSiteDoesNotRespondOr') : e.message;
      toast(L('ui.cannotOpen', { abs, why }), 'error');
      return false;
    }
    const name = decodeURIComponent(abs.split(/[?#]/)[0].split('/').pop() || 'programma.fprg');
    if (!loadText(text, name, keepUndo)) return false;
    st.sourceUrl = abs;
    return true;
  }
  function openUrlDialog() {
    const f = field({ key: 'furl', label: L('ui.addressOfTheFprgFile'), type: 'plain', placeholder: 'https://github.com/…/programma.fprg', hint: L('ui.worksWithFilesOnGithubIn') }, st.sourceUrl || '');
    openModal({ title: L('ui.openFromWebAddress'), body: h('div', { class: 'fields' }, f), okText: L('ui.open'), onOk: () => {
      const u = f._get().trim(); if (!u) return L('ui.writeTheAddressOfTheFile');
      guardDirty(() => openUrl(u, true));
      return true;
    } });
  }
  /* link to FlowLab that opens this program directly */
  async function copyShareLink() {
    if (!st.sourceUrl) { infoBox(L('ui.linkToTheProgram'), L('ui.theLinkCanBeCreatedFor')); return; }
    const base = location.protocol.startsWith('http') ? location.href.split(/[?#]/)[0] : 'https://nicvac.github.io/flowlab/dist/FlowLab.html';
    const link = `${base}?url=${encodeURIComponent(st.sourceUrl)}`;
    try { await navigator.clipboard.writeText(link); toast(L('ui.linkCopiedWhoeverOpensItFinds'), 'ok'); }
    catch (e) { const ta = h('textarea', { class: 'mono', rows: 3, readonly: true, 'aria-label': L('ui.linkToTheProgram') }); ta.value = link; openModal({ title: L('ui.linkToTheProgram'), wide: true, body: ta, okText: L('win.close'), noCancel: true }); setTimeout(() => ta.select(), 50); }
  }
  function fitIfLarge() {
    if (!V.main) { withView(MAIN, fitIfLarge); return; }
    const svg = $('svg', V.chart); const wrap = V.wrap;
    if (!svg) return;
    if (svg.dataset.w * st.zoom > wrap.clientWidth - 24) setZoom(Math.max(0.55, (wrap.clientWidth - 24) / svg.dataset.w));
    home(V);
  }
  function openFile() { $('#fileInput').click(); }

  /* ------------------------------ Modules --------------------------------
     A module is a .fprg program. If it has classes, the classes are copied into the program;
     if it has only functions, the functions are copied (and the program stays in its view).
     In both cases they stay read-only, marked with the name of the module and where it
     comes from; the Main of the module is only for testing it and is not imported.
     src: "lib:topic/Name" (official collection), "url:address", "file:name.fprg"
     The module collections are GitHub folders: each subfolder is a topic
     (data_structures -> «Data structures») and contains the .fprg files of the modules. */
  const OFFICIAL_SRC = 'https://github.com/nicvac/flowlab/tree/main/modules';
  const isMainClsOf = (c) => !!c && c === M.mainClass(st.prog);
  const topicTitle = (t) => { const x = String(t || '').replace(/[_-]+/g, ' ').trim(); return x ? x[0].toUpperCase() + x.slice(1) : L('ui.otherModules'); };
  /* is the class used as a type somewhere in the program? */
  function classUsed(c) {
    const lo = c.name.toLowerCase();
    const uses = (t) => { const g = E.splitType(t); return g.base.toLowerCase() === lo || g.args.some(uses); };
    for (const k of st.prog.classes) if (k !== c && k.attributes.some((a) => uses(a.type))) return true;
    for (const f of st.prog.functions) {
      if (f.cls === c.id) continue;
      if (f.params.some((p) => uses(p.type)) || M.rets(f).some((r) => uses(r.type))) return true;
      let u = false; M.walk(f.body, (x) => { if ((x.kind === 'declare' || x.kind === 'const') && uses(x.type)) u = true; }); if (u) return true;
    }
    return false;
  }
  /* is the function called somewhere in the program (outside its module)? */
  function funcUsed(fn) {
    const re = new RegExp(`(^|[^\\w.])${fn.name}\\s*\\(`, 'i');
    let u = false;
    for (const f of st.prog.functions) if (!f.module) M.walk(f.body, (x) => { for (const k of ['expression', 'variable', 'start', 'end']) if (typeof x[k] === 'string' && re.test(x[k])) u = true; });
    return u;
  }
  /* what to import from a module: the classes (except the one of the Main, if it has only the Main)
     or, if the module has only functions, the functions except the Main */
  function moduleParts(text, src) {
    const mp = M.parseFprg(text);
    const name = (mp.attrs.name || String(src).replace(/^.*[/:]/, '').replace(/\.fprg$/i, '') || L('ui.module6')).trim();
    const about = mp.attrs.about || '';
    if (!M.hasClasses(mp) || M.isTrivialOO(mp)) {
      const funcs = mp.functions.slice(1);
      if (!funcs.length) throw new Error(L('ui.theModuleContainsNoFunctionsTo'));
      return { kind: 'functions', mp, name, about, classes: [], funcs };
    }
    const mc = M.mainClass(mp);
    const classes = mp.classes.filter((c) => c !== mc || c.attributes.length || M.membersOf(mp, c).length > 1);
    if (!classes.length) throw new Error(L('ui.theModuleContainsNoClassesTo'));
    const funcs = mp.functions.filter((f) => f !== mp.functions[0] && classes.some((c) => c.id === f.cls));
    return { kind: 'classes', mp, name, about, classes, funcs };
  }
  const cloneFunc = (f) => { const nf = JSON.parse(JSON.stringify(f)); nf.id = M.newId(); nf.body.forEach((s) => M.reId(s)); return nf; };
  /* copies the module into the program (replaces a version already imported) */
  function importModule(text, src) {
    if (isRunning()) { toast(L('ui.stopTheProgramToImportA'), 'warn'); return false; }
    let parts;
    try { parts = moduleParts(text, src); } catch (e) { toast(L('ui.cannotImportTheModule') + e.message, 'error'); return false; }
    const { name, classes, funcs } = parts;
    const same = (m) => m && m.name.toLowerCase() === name.toLowerCase();
    const oldC = (st.prog.classes || []).filter((c) => same(c.module));
    const oldF = st.prog.functions.filter((f) => same(M.moduleOfFunc(st.prog, f)));
    const fail = (msg) => { infoBox(L('ui.moduleNotImported'), msg); return false; };
    if (parts.kind === 'functions') {
      // functions: same names not allowed (in the Functions view there is no overloading)
      for (const f of funcs) {
        if ((E.BUILTINS[f.name.toLowerCase()] && !E.BUILTINS[f.name.toLowerCase()].soft) || f.name.toLowerCase() === 'main') return fail(L('ui.theModuleContainsTheFunctionWhich', { name, name2: f.name }));
        // in the Objects view: the other functions of the modules (a method of a class has precedence in its class)
        const clash = st.prog.functions.find((g) => !oldF.includes(g) && g.name.toLowerCase() === f.name.toLowerCase() && (!M.hasClasses(st.prog) || M.isGlobalFunc(st.prog, g)));
        if (clash) return fail(L('ui.theModuleContainsTheFunctionBut', { name, name2: f.name, text: clash.module ? L('ui.fromTheModule', { name: clash.module.name }) : '' }));
      }
      mutate(() => {
        const cur = func();
        st.prog.functions = st.prog.functions.filter((f) => !oldF.includes(f));
        // also in the Objects view they belong to no class: the module is shown apart and its functions are called from everywhere
        for (const f of funcs) {
          const nf = cloneFunc(f);
          delete nf.cls; delete nf.visibility; delete nf.static; delete nf.ctor; delete nf.abstract;
          nf.module = { name, src };
          st.prog.functions.push(nf);
        }
        st.fi = Math.max(0, st.prog.functions.indexOf(cur));
      });
      toast(oldF.length ? L('ui.moduleUpdated', { name }) : L('ui.moduleImported', { name, list: funcs.map((f) => f.name + '()').join(', ') }), 'ok');
      return true;
    }
    if (!M.hasClasses(st.prog)) M.wrapInClass(st.prog);
    for (const c of classes) {
      const clash = st.prog.classes.find((k) => !oldC.includes(k) && k.name.toLowerCase() === c.name.toLowerCase());
      if (clash) return fail(L('ui.theModuleContainsTheClassBut', { name, name2: c.name, text: clash.module ? L('ui.fromTheModule', { name: clash.module.name }) : '' }));
    }
    mutate(() => {
      // position: that of the previous version, otherwise to the right of the existing classes
      const prevPos = new Map(oldC.map((c) => [c.name.toLowerCase(), { x: c.x, y: c.y }]));
      st.prog.functions = st.prog.functions.filter((f) => !oldC.some((c) => c.id === f.cls));
      st.prog.classes = st.prog.classes.filter((c) => !oldC.includes(c));
      const boxes = [...UmlLib.layout(st.prog).values()];
      const right = boxes.length ? Math.max(...boxes.map((b) => b.x + b.w)) + 90 : 40;
      const minX = Math.min(...classes.map((c) => c.x || 0)), minY = Math.min(...classes.map((c) => c.y || 0));
      const idMap = new Map();
      for (const c of classes) {
        const p = prevPos.get(c.name.toLowerCase());
        const nc = M.makeClass(c.name, { parent: c.parent, abstract: c.abstract, tparams: (c.tparams || []).slice(), attributes: c.attributes.map((a) => ({ ...a })), module: { name, src },
          x: p ? p.x : right + (c.x || 0) - minX, y: p ? p.y : 60 + (c.y || 0) - minY });
        idMap.set(c.id, nc.id);
        st.prog.classes.push(nc);
      }
      for (const f of funcs) { const nf = cloneFunc(f); nf.cls = idMap.get(f.cls); st.prog.functions.push(nf); }
      st.view = 'objects'; store.set('view', 'objects');
      st.uml = true; st.usel = null;
    });
    toast(oldC.length ? L('ui.moduleUpdated', { name }) : L('ui.moduleImported', { name, list: classes.map((c) => M.classTitle(c)).join(', ') }), 'ok');
    return true;
  }
  /* ---- module collections on GitHub ---- */
  /* "https://github.com/user/repo/tree/branch/folder" -> { owner, repo, ref, path } */
  function ghSource(u) {
    const m = String(u).trim().match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+)(?:\/tree\/([^/\s]+)(?:\/([^?#\s]*))?)?\/?(?:[?#].*)?$/i);
    if (!m) return null;
    return { owner: m[1], repo: m[2].replace(/\.git$/i, ''), ref: m[3] || 'HEAD', path: (m[4] || '').replace(/\/+$/, '') };
  }
  const srcLabel = (u) => { const g = ghSource(u); return g ? `${g.owner}/${g.repo}${g.path ? '/' + g.path : ''}` : u; };
  function getSources() { const v = store.get('moduleSources'); return Array.isArray(v) ? v : [OFFICIAL_SRC]; }
  function setSources(list) { store.set('moduleSources', list); }
  /* modules of a collection: [{ topic, id, text, src }] (cached for a few hours) */
  const SRC_TTL = 6 * 3600 * 1000;
  async function loadSource(u, force) {
    const key = 'modsrc:' + u;
    const cached = store.get(key);
    if (!force && cached && Date.now() - cached.time < SRC_TTL) return { list: cached.list, cached: true };
    const g = ghSource(u);
    if (!g) throw new Error(L('ui.itIsNotTheLinkOf'));
    const r = await fetch(`https://api.github.com/repos/${g.owner}/${g.repo}/git/trees/${encodeURIComponent(g.ref)}?recursive=1`, { cache: 'no-cache' });
    if (r.status === 403 || r.status === 429) throw new Error(L('ui.githubHasReachedItsRequestLimit'));
    if (!r.ok) throw new Error(r.status === 404 ? L('ui.repositoryOrFolderNotFoundIt') : L('ui.githubReplies', { status: r.status }));
    const tree = (await r.json()).tree || [];
    const pre = g.path ? g.path + '/' : '';
    const files = tree.filter((x) => x.type === 'blob' && /\.fprg$/i.test(x.path) && x.path.startsWith(pre)).map((x) => x.path);
    const official = u === OFFICIAL_SRC;
    const list = [];
    await Promise.all(files.map(async (p) => {
      const rel = p.slice(pre.length).split('/');
      const id = rel.pop().replace(/\.fprg$/i, ''), topic = rel.length ? rel[rel.length - 1] : '';
      const raw = `https://raw.githubusercontent.com/${g.owner}/${g.repo}/${g.ref}/${p.split('/').map(encodeURIComponent).join('/')}`;
      try { const t = await fetch(raw, { cache: 'no-cache' }); if (t.ok) list.push({ topic, id, text: await t.text(), src: official ? `lib:${topic}/${id}` : 'url:' + raw }); } catch (e) { /* unreadable file: skipped */ }
    }));
    list.sort((a, b) => (a.topic + '/' + a.id).localeCompare(b.topic + '/' + b.id));
    if (list.length) store.set(key, { time: Date.now(), list });
    return { list, cached: false };
  }
  /* copy of the official collection included in FlowLab (for when GitHub does not answer) */
  const builtinList = () => ModuleLibrary.map((m) => ({ topic: m.topic, id: m.id, text: m.text, src: `lib:${m.topic}/${m.id}` }));
  async function libText(src) {
    const m = /^lib:(.+)\/([^/]+)$/.exec(src || ''); if (!m) return null;
    const g = ghSource(OFFICIAL_SRC);
    try {
      const r = await fetch(`https://raw.githubusercontent.com/${g.owner}/${g.repo}/${g.ref}/${g.path}/${m[1]}/${m[2]}.fprg`, { cache: 'no-cache' });
      if (r.ok) return await r.text();
    } catch (e) { /* the included copy is used */ }
    const b = ModuleLibrary.find((x) => x.topic === m[1] && x.id === m[2]);
    return b ? b.text : null;
  }
  async function fetchText(u) {
    const abs = new URL(rawUrl(u), location.href).href;
    const r = await fetch(abs, { cache: 'no-cache' });
    if (!r.ok) throw new Error(L('ui.theServerReplies2', { status: r.status }));
    return { text: await r.text(), abs };
  }
  async function importModuleUrl(u) {
    try { const { text, abs } = await fetchText(u); return importModule(text, 'url:' + abs); }
    catch (e) { toast(L('ui.cannotDownloadTheModule', { text: e instanceof TypeError ? L('ui.theSiteDoesNotRespondOr2') : e.message }), 'error'); return false; }
  }
  function importModuleFile() {
    const inp = h('input', { type: 'file', accept: '.fprg,.xml', hidden: true });
    inp.addEventListener('change', () => {
      const file = inp.files[0]; if (!file) return;
      const r = new FileReader(); r.onload = () => importModule(r.result, 'file:' + file.name); r.readAsText(file);
    });
    document.body.append(inp); inp.click(); setTimeout(() => inp.remove(), 60000);
  }
  async function updateModule(name) {
    const m = M.modulesOf(st.prog).find((x) => x.name === name); if (!m) return;
    const src = m.src || '';
    if (src.startsWith('lib:')) { const t = await libText(src); if (t) importModule(t, src); else toast(L('ui.theModuleIsNoLongerIn', { name }), 'error'); return; }
    if (src.startsWith('url:')) { importModuleUrl(src.slice(4)); return; }
    toast(L('ui.chooseTheFileOfTheModule', { name })); importModuleFile();
  }
  function removeModule(name) {
    if (isRunning()) { toast(L('ui.stopTheProgramToRemoveA'), 'warn'); return; }
    const m = M.modulesOf(st.prog).find((x) => x.name === name); if (!m) return;
    const used = m.classes.some((c) => classUsed(c)) || m.funcs.some((f) => !m.classes.length && funcUsed(f));
    const what = m.classes.length ? L('ui.theClasses', { list: m.classes.map((c) => M.classTitle(c)).join(', ') }) : L('ui.theFunctions', { list: m.funcs.map((f) => f.name + '()').join(', ') });
    confirmBox(L('ui.removeTheModule2'), L('ui.ofTheModuleWillBeRemoved', { what, name, text: used ? L('ui.theProgramUsesThemItWill') : '' }), L('ui.remove'), () => mutate(() => {
      const cur = func();
      st.prog.functions = st.prog.functions.filter((f) => !m.funcs.includes(f) && !m.classes.some((c) => c.id === f.cls));
      if (m.classes.length) st.prog.classes = st.prog.classes.filter((k) => !m.classes.includes(k));
      st.fi = Math.max(0, st.prog.functions.indexOf(cur)); st.usel = null;
      if (m.classes.length) st.uml = true;
    }));
  }
  /* dialog: modules in the program, module collections (GitHub) by topic, other modules */
  function moduleDialog() {
    if (isRunning()) { toast(L('ui.stopTheProgramToImportA'), 'warn'); return; }
    let closeIt = null;
    const done = (fn) => () => { if (closeIt) closeIt(); fn(); };
    const have = () => new Map(M.modulesOf(st.prog).map((m) => [m.name.toLowerCase(), m]));
    // modules already imported
    const mine = h('div', { class: 'modlib' });
    const drawMine = () => {
      mine.innerHTML = '';
      const ms = M.modulesOf(st.prog);
      if (!ms.length) return;
      mine.append(h('h3', { class: 'modh' }, L('ui.modulesInTheProgram')));
      for (const m of ms) mine.append(h('div', { class: 'modrow' },
        h('div', { class: 'modinfo' }, h('strong', null, m.name), h('span', { class: 'modcls mono' }, m.classes.length ? m.classes.map((c) => M.classTitle(c)).join(' · ') : m.funcs.map((f) => f.name + '()').join(' · ')), h('span', { class: 'muted small' }, m.src.startsWith('lib:') ? L('ui.officialCollection') : m.src.replace(/^(url|file):/, ''))),
        h('button', { class: 'btn small', type: 'button', onclick: done(() => updateModule(m.name)) }, L('ui.update')),
        h('button', { class: 'btn small danger', type: 'button', onclick: done(() => removeModule(m.name)) }, L('ui.remove'))));
    };
    drawMine();
    // collections
    const coll = h('div', { class: 'modlib' });
    const row = (m) => {
      let info; try { info = moduleParts(m.text, m.src); } catch (e) { return null; }
      const got = have().get(info.name.toLowerCase());
      return h('div', { class: 'modrow' },
        h('div', { class: 'modinfo' }, h('strong', null, info.name), h('span', { class: 'modcls mono' }, info.kind === 'classes' ? info.classes.map((c) => M.classTitle(c)).join(' · ') : info.funcs.map((f) => f.name + '()').join(' · ')), info.about ? h('p', { class: 'muted small' }, info.about) : null),
        h('button', { class: 'btn small' + (got ? '' : ' primary'), type: 'button', onclick: done(() => importModule(m.text, m.src)) }, got ? L('ui.update') : L('ui.import')));
    };
    // expandable tree: collection › topic › modules (the open/closed state is remembered)
    // the first time the official collection is already open, so one sees at once how it is made
    const openSet = new Set(store.get('modOpen', [OFFICIAL_SRC]));
    // clickable bar: big arrow, icon, title, count
    const ICON_CHEV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
    const ICON_REPO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h11l3 3v13H5z"/><path d="M8 4v6l2-1.5L12 10V4"/><path d="M8 14h8M8 17h6"/></svg>';
    const ICON_DIR = '<svg class="dir-closed" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/></svg><svg class="dir-open" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v2"/><path d="M3 18V6M3 18l2.6-7.2a1 1 0 0 1 .9-.8H21a.7.7 0 0 1 .7.9L19.4 18a1 1 0 0 1-1 .8H3"/></svg>';
    const count = (n) => `${n} ${n === 1 ? L('ui.module') : L('ui.modules')}`;
    const keepOpen = (key, det) => det.addEventListener('toggle', () => { if (det.open) openSet.add(key); else openSet.delete(key); store.set('modOpen', [...openSet]); });
    const fill = (box, list, u) => {
      box.innerHTML = '';
      if (!list.length) { box.append(h('p', { class: 'muted small' }, L('ui.noFprgFilesInThisFolder'))); return; }
      const topics = new Map();
      for (const m of list) { if (!topics.has(m.topic)) topics.set(m.topic, []); topics.get(m.topic).push(m); }
      for (const [topic, ms] of topics) {
        const key = u + '|' + topic;
        const rows = ms.map(row).filter(Boolean);
        const det = h('details', { class: 'modtopic', open: openSet.has(key) },
          h('summary', { class: 'modbar', title: L('ui.clickToShowOrHideThe') }, h('span', { class: 'modchev', html: ICON_CHEV }), h('span', { class: 'modicon', html: ICON_DIR }),
            h('span', { class: 'modtname' }, topicTitle(topic)), h('span', { class: 'modlist muted small' }, ms.map((m) => m.id).join(', ')), h('span', { class: 'grow' }), h('span', { class: 'modcount' }, count(rows.length))),
          h('div', { class: 'modtopicbody' }, ...rows));
        keepOpen(key, det);
        box.append(det);
      }
    };
    const drawSources = (force) => {
      coll.innerHTML = '';
      const srcs = getSources();
      for (const u of srcs) {
        const box = h('div', { class: 'modsrcbody' });
        const badge = h('span', { class: 'modcount', hidden: true });
        const showCount = () => { const n = box.querySelectorAll('.modrow').length; badge.textContent = count(n); badge.hidden = !n; };
        const official = u === OFFICIAL_SRC;
        let loaded = false;
        const load = (again) => {
          loaded = true;
          box.innerHTML = ''; box.append(h('p', { class: 'muted small' }, L('ui.loadingFromGithub')));
          const fallback = (why) => { fill(box, builtinList(), u); box.prepend(h('p', { class: 'muted small' }, L('ui.thisIsTheCopyOfThe', { why }))); showCount(); };
          loadSource(u, again).then(({ list }) => { if (!list.length && official) fallback(L('ui.theCollectionOnGithubIsEmpty')); else { fill(box, list, u); showCount(); } }).catch((e) => {
            if (official) fallback(L('ui.githubDoesNotRespond', { message: e.message }));
            else { box.innerHTML = ''; box.append(h('p', { class: 'formerr' }, L('ui.cannotReadTheCollection', { message: e.message }))); }
          });
        };
        // the buttons in the title must not open or close the collection
        const btn = (title, text, fn) => h('button', { class: 'iconbtn', type: 'button', title, 'aria-label': title, onclick: (e) => { e.preventDefault(); e.stopPropagation(); fn(); } }, text);
        const det = h('details', { class: 'modsrc', open: openSet.has(u) },
          h('summary', { class: 'modsrchead modbar', title: L('ui.clickToShowOrHideThe2') }, h('span', { class: 'modchev', html: ICON_CHEV }), h('span', { class: 'modicon', html: ICON_REPO }),
            h('span', { class: 'modsname mono' }, srcLabel(u)), official ? h('span', { class: 'ptag' }, 'ufficiale') : null, h('span', { class: 'grow' }), badge,
            btn(L('ui.reloadFromGithub'), '↻', () => { det.open = true; load(true); }),
            btn(L('ui.removeThisCollection'), '✕', () => { setSources(getSources().filter((x) => x !== u)); drawSources(); })),
          box);
        keepOpen(u, det);
        det.addEventListener('toggle', () => { if (det.open && !loaded) load(force); });
        coll.append(det);
        if (det.open) load(force);
      }
      if (!srcs.includes(OFFICIAL_SRC)) coll.append(h('button', { class: 'btn small', type: 'button', onclick: () => { setSources([OFFICIAL_SRC, ...getSources()]); drawSources(); } }, L('ui.restoreTheOfficialCollection')));
    };
    drawSources(false);
    const srcW = field({ key: 'msrc', label: L('ui.addAModuleCollectionLinkTo'), type: 'plain', placeholder: 'https://github.com/user/repo/tree/main/moduli', hint: L('ui.eachSubfolderIsATopicE') }, '');
    const addSrc = () => {
      const u = srcW._get().trim(); if (!u) { toast(L('ui.pasteTheLinkOfTheGithub'), 'warn'); return; }
      if (!ghSource(u)) { toast(L('ui.aLinkToAGithubFolder'), 'warn'); return; }
      if (!getSources().includes(u)) setSources([...getSources(), u]);
      srcW._input.value = ''; drawSources();
    };
    const addRow = h('div', { class: 'modadd' }, srcW, h('button', { class: 'btn small', type: 'button', onclick: addSrc }, L('ui.addTheCollection')));
    srcW._input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); addSrc(); } });
    // other modules
    const urlW = field({ key: 'murl', label: L('ui.orFromAWebAddress'), type: 'plain', placeholder: 'https://github.com/…/Modulo.fprg' }, '');
    const other = h('div', { class: 'modother' },
      h('button', { class: 'btn small', type: 'button', onclick: done(importModuleFile) }, L('ui.importFromAFprgFile')),
      urlW, h('button', { class: 'btn small', type: 'button', onclick: () => { const u = urlW._get().trim(); if (!u) { toast(L('ui.writeTheAddressOfTheModule'), 'warn'); return; } if (closeIt) closeIt(); importModuleUrl(u); } }, L('ui.importFromTheAddress')));
    const body = h('div', { class: 'fields' },
      h('p', { class: 'help' }, L('ui.aModuleIsAReusableFprg')),
      mine, h('h3', { class: 'modh' }, L('ui.moduleCollections')), coll, addRow, h('h3', { class: 'modh' }, L('ui.otherModules')), other);
    closeIt = openModal({ title: L('ui.importAModule2'), body, wide: true, okText: L('win.close'), noCancel: true }).close;
    setTimeout(() => { const mb = body.closest('.modal-body'); if (mb) mb.scrollTop = 0; const b = body.querySelector('.modsrc > summary'); if (b) b.focus(); }, 20);
  }

  /* several files at once (from Open or dragged): the .flstage files become known by name, then the program is opened
     (its stages are found among them); stage files alone are linked to the program open */
  async function readFiles(files) {
    files = [...(files || [])];
    const stages = files.filter((f) => isStageFile(f.name)), others = files.filter((f) => !isStageFile(f.name));
    const texts = [];
    for (const f of stages) { const t = await readText(f); if (t != null) { keepStage(f.name, t); texts.push([f.name, t]); } }
    if (others.length) { for (const f of others) readFileObj(f); return; }
    for (const [name, t] of texts) linkStage(name, t);
  }
  function readFileObj(file) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      if (/\.(fprg|xml)$/i.test(file.name) || /^\s*<\?xml/i.test(r.result) || r.result.toLowerCase().includes('<' + M.FPRG_ROOT)) loadText(r.result, file.name);
      else { st.vfs.set(file.name, r.result); saveVfs(); setTab('files'); toast(L('ui.textFileAddedToTheFiles', { name: file.name }), 'ok'); }
    };
    r.readAsText(file);
  }
  function guardDirty(action) {
    if (!st.dirty) { action(); return; }
    confirmBox(L('ui.unsavedChanges'), L('ui.theCurrentProgramHasUnsavedChanges'), L('ui.continue'), action);
  }
  function newProgram() {
    guardDirty(() => { if (isRunning()) stopRun(); resetViews(); st.excPos = new Map(); st.fmodPos = new Map(); st.prog = M.newProgram(); st.fi = 0; st.sel = null; st.uml = isOO(); st.usel = null; st.undo = []; st.redo = []; st.fileName = null; st.dirty = false; st.sourceUrl = null; st.stageBase = null; run.mainFrame = null; codeStart(); render(); renderVars(); syncStages(); });
  }
  function loadExample(id) {
    const ex = Examples.get(id); if (!ex) return;
    guardDirty(() => {
      if (isRunning()) stopRun();
      resetViews(); st.excPos = new Map(); st.fmodPos = new Map();
      st.prog = ex.make(); st.fi = 0; st.sel = null; st.usel = null; st.undo = []; st.redo = []; st.fileName = null; st.dirty = false; run.mainFrame = null; run.errId = null;
      // the stages of the examples are in the page, as if they were in the folder of the example
      st.sourceUrl = null; st.stageBase = 'example:' + Examples.lang;
      startView();
      conClear(); render(); renderVars(); setTimeout(fitIfLarge, 0);
      syncStages();
    });
  }

  function exportSvg(source, css) {
    // export is always in the extended view
    if (!source && st.compact && !isUml() && !(isOO() && func().abstract)) {
      const f = func(), c = isOO() ? M.classOf(st.prog, f) : null;
      source = svgFromString(new RenderLib.Renderer().func(f, st.expanded, isOO() ? { owner: c ? c.name : '', isMain: st.fi === 0 } : {}).svg);
    }
    const svg = (source || $('svg', V.chart)).cloneNode(true);
    svg.setAttribute('width', svg.dataset.w); svg.setAttribute('height', svg.dataset.h);
    svg.insertBefore(h('style', null, css || exportCss()), svg.firstChild);
    $$('.hits, .ctoggle, .uadd, .uhit, .umodtog', svg).forEach((x) => x.remove());
    return new XMLSerializer().serializeToString(svg);
  }

  /* ------------------------- PDF export -------------------------
     Cover with the data and the contents, class diagram, flowchart
     of each function or method (with all the texts expanded), source code. */
  const svgFromString = (str) => { const d = h('div', { html: str }); return d.firstElementChild; };
  const loadImg = (svgStr) => new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error(L('ui.imageNotAvailable'))); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr); });
  async function exportPdf() {
    if (isRunning()) { toast(L('ui.stopTheProgramBeforeExporting'), 'warn'); return; }
    toast(L('ui.preparingThePdf'));
    // colours of the light theme, whatever the theme in use
    const root = document.documentElement, oldTheme = root.dataset.theme;
    root.dataset.theme = 'light';
    const css = exportCss();
    const csv = getComputedStyle(root), hex = (n) => { const v = csv.getPropertyValue(n).trim().replace('#', ''); return v.length === 6 ? [0, 2, 4].map((k) => parseInt(v.slice(k, k + 2), 16)) : [23, 34, 45]; };
    const CODE_COL = { '': hex('--ink'), tk: hex('--s-call'), ts: hex('--s-out'), tn: hex('--s-loop'), tc: hex('--faint') };
    if (oldTheme) root.dataset.theme = oldTheme; else delete root.dataset.theme;
    const prog = st.prog, oo = isOO() && M.hasClasses(prog);
    const doc = new PdfLib.Doc();
    const M0 = 42, CW = doc.W - M0 * 2, TOP = 58, BOTTOM = doc.H - 46;
    const INK = [23, 34, 45], MUTED = [90, 104, 117], ACCENT = [12, 108, 128];
    const title = prog.attrs.name || L('ui.untitledProgram');
    const sigOf = (f) => `${f.name}(${f.params.map((p) => `${p.name}${p.array ? '[]' : ''}: ${E.typeName(p.type)}`).join(', ')})${M.rets(f).length ? ': ' + M.rets(f).map((r) => E.typeName(r.type)).join(', ') : ''}`;
    const heading = (f) => {
      if (f === prog.functions[0]) return L('ui.mainMainProgram');
      const c = oo ? M.classOf(prog, f) : null;
      if (!c) return L('ui.function3') + sigOf(f);
      if (f.ctor) return L('ui.constructorOfNew', { name: c.name, sigOf: sigOf(f) });
      return `${f.abstract ? L('ui.abstractMethod') : f.static ? L('ui.staticMethod') : L('ui.method')} ${c.name}.${sigOf(f)}`;
    };
    // order: Main, then by class (constructors and methods) or the functions in the order of the program
    const funcs = oo ? [prog.functions[0], ...prog.classes.flatMap((c) => { const ms = M.membersOf(prog, c).filter((f) => f !== prog.functions[0]); return [...ms.filter((f) => f.ctor), ...ms.filter((f) => !f.ctor)]; }), ...M.globalFuncs(prog)] : prog.functions.slice();

    /* ---- cover ---- */
    let p = doc.page();
    let y = 92;
    doc.text(p, M0, y, 'FlowLab', { font: 'F2', size: 12, color: ACCENT }); y += 34;
    for (const l of PdfLib.wrap(title, 'F2', 24, CW)) { doc.text(p, M0, y, l, { font: 'F2', size: 24, color: INK }); y += 30; }
    const meta = [prog.attrs.authors ? L('ui.authors2') + prog.attrs.authors : null, L('ui.exportedOn', { toLocaleDateString: new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }) }), oo ? L('ui.objectOrientedProgram', { classesCount: prog.classes.length, text: prog.classes.length === 1 ? L('ui.class') : L('ui.classes') }) : L('ui.programWithFunctions', { functionsCount: prog.functions.length, text: prog.functions.length === 1 ? L('ui.diagram2') : L('ui.diagrams') })].filter(Boolean);
    for (const m of meta) { doc.text(p, M0, y, m, { size: 11, color: MUTED }); y += 16; }
    y += 10; doc.line(p, M0, y, M0 + CW, y); y += 24;
    if (String(prog.attrs.about || '').trim()) {
      for (const l of PdfLib.wrap(prog.attrs.about, 'F1', 11.5, CW)) { doc.text(p, M0, y, l, { size: 11.5 }); y += 16; }
      y += 14;
    }
    doc.text(p, M0, y, L('ui.contents'), { font: 'F2', size: 13 }); y += 20;
    // contents: the page numbers are written at the end, when the layout is known
    const toc = [];
    if (oo) toc.push({ key: 'uml', label: L('ui.classDiagram') });
    for (const f of funcs) toc.push({ key: f.id, label: heading(f) });
    toc.push({ key: 'code', label: L('ui.sourceCode', { label: CodeGen.LANGS[st.lang].label }) });
    const tocAt = [], sectionPage = {};
    for (const t of toc) {
      PdfLib.wrap(t.label, 'F1', 10.5, CW - 50).forEach((l, k, arr) => {
        if (y > BOTTOM - 10) { p = doc.page(); y = TOP + 10; }
        doc.text(p, M0 + 10, y, l, { size: 10.5 });
        if (k === arr.length - 1) tocAt.push({ p, y, key: t.key });
        y += 14;
      });
    }

    /* ---- diagrams: each one on a page as tall as needed (continuous form) ----
       fixed scale: the text of the blocks (12.5 px) becomes 9 pt; diagrams wider
       than an A4 widen the page instead of shrinking */
    const K = 2.2; // pixels per point: resolution of the images
    const STRIP = 8000; // pixels: very tall diagrams are drawn in strips (canvas limits)
    const SCALE = 9 / 12.5;
    async function placeDiagram(key, label, svgStr, W, Hh, note) {
      const head = 30 + (note ? 18 : 0), foot = doc.H - BOTTOM + 14;
      let scale = SCALE;
      // beyond the maximum size of a PDF page the diagram shrinks
      const maxImg = doc.maxH - TOP - head - foot;
      if (svgStr && Hh * scale > maxImg) scale = maxImg / Hh;
      if (svgStr && W * scale > doc.maxH - M0 * 2) scale = (doc.maxH - M0 * 2) / W;
      const w = W * scale, hpt = svgStr ? Hh * scale : 0;
      p = doc.page(TOP + head + hpt + foot, svgStr ? w + M0 * 2 : 0); y = TOP;
      const cwp = p.w - M0 * 2; // usable width of this page
      sectionPage[key] = doc.pages.length;
      doc.text(p, M0, y + 12, label, { font: 'F2', size: 12.5, color: INK });
      y += 20; doc.line(p, M0, y, M0 + cwp, y, { color: [207, 216, 225] }); y += 10;
      if (note) { doc.text(p, M0, y + 10, note, { font: 'F4', size: 10, color: MUTED }); y += 18; }
      if (!svgStr) return;
      const img = await loadImg(svgStr);
      const x0 = M0 + (cwp - w) / 2;
      let done = 0;
      while (done < hpt - 0.01) {
        const part = Math.min(STRIP / K, hpt - done);
        const cw = Math.max(1, Math.round(w * K)), ch = Math.max(1, Math.round(part * K));
        const cv = h('canvas', { width: cw, height: ch });
        const cx = cv.getContext('2d');
        cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, cw, ch);
        cx.drawImage(img, 0, -done * K, w * K, hpt * K);
        doc.image(p, doc.addJpeg(cv.toDataURL('image/jpeg', 0.9), cw, ch), x0, y, w, part);
        done += part; y += part;
      }
    }
    try {
      if (oo) {
        const u = UmlLib.render(prog, null, { excPos: st.excPos, fmodPos: st.fmodPos });
        await placeDiagram('uml', L('ui.classDiagram'), exportSvg(svgFromString(u.svg), css), u.W, u.H);
      }
      const all = new Set();
      for (const f of prog.functions) M.walk(f.body, (x) => all.add(x.id));
      const r = new RenderLib.Renderer();
      for (const f of funcs) {
        if (f.abstract) {
          const c = M.classOf(prog, f);
          await placeDiagram(f.id, heading(f), null, 1, 1, L('ui.noBodyTheSubclassesOfDefine', { name: c.name }));
          continue;
        }
        const c = oo ? M.classOf(prog, f) : null;
        const out = r.func(f, all, oo ? { owner: c ? c.name : '', isMain: f === prog.functions[0] } : undefined);
        await placeDiagram(f.id, heading(f), exportSvg(svgFromString(out.svg), css), out.W, out.H);
      }
    } catch (e) { toast(L('ui.cannotCreateTheImagesOfThe') + e.message, 'error'); return; }

    /* ---- code: landscape A4 pages with reduced margins, coloured as in the Code tab ---- */
    const code = CodeGen.generate(prog, st.lang).replace(/\n$/, '');
    const LW = doc.H, LHt = doc.W, MC = 22, CTOP = 34, CBOT = LHt - 22; // landscape A4
    const codePage = () => { const pg = doc.page(LHt, LW); pg.compact = true; return pg; };
    p = codePage(); y = CTOP;
    sectionPage.code = doc.pages.length;
    doc.text(p, MC, y + 12, L('ui.sourceCode2', { label: CodeGen.LANGS[st.lang].label }), { font: 'F2', size: 12.5 }); y += 20;
    doc.line(p, MC, y, LW - MC, y, { color: [207, 216, 225] }); y += 14;
    const FS = 8.6, LH = 10.6, NW = 26, CH = 0.6 * FS, cols = Math.floor((LW - MC * 2 - NW) / CH);
    const FONT = { '': 'F3', tk: 'F5', ts: 'F3', tn: 'F3', tc: 'F6' };
    codeTokens(code, st.lang).forEach((toks, i) => {
      // coloured pieces with their column; lines that are too long wrap
      const segs = []; let col = 0;
      for (const [c, t] of toks) { const tx = t.replace(/\t/g, '    '); segs.push({ c, t: tx, at: col }); col += [...tx].length; }
      const rows = Math.max(1, Math.ceil(col / cols));
      for (let k = 0; k < rows; k++) {
        if (y > CBOT - 4) { p = codePage(); y = CTOP + 4; }
        if (!k) doc.text(p, MC, y, String(i + 1).padStart(4, ' '), { font: 'F3', size: 7.5, color: CODE_COL.tc });
        const from = k * cols, to = from + cols, x0 = MC + NW + (k ? 2 * CH : 0);
        for (const sg of segs) {
          const chars = [...sg.t], a = Math.max(from, sg.at), b = Math.min(to, sg.at + chars.length);
          if (a >= b) continue;
          const piece = chars.slice(a - sg.at, b - sg.at).join('');
          if (!piece.trim()) continue;
          doc.text(p, x0 + (a - from) * CH, y, piece, { font: FONT[sg.c], size: FS, color: CODE_COL[sg.c] });
        }
        y += LH;
      }
    });

    /* ---- header and page numbers ---- */
    for (const t of tocAt) { const n = String(sectionPage[t.key] || ''); doc.text(t.p, M0 + CW - PdfLib.textWidth(n, 'F1', 10.5), t.y, n, { size: 10.5, color: MUTED }); }
    const N = doc.pages.length;
    doc.pages.forEach((pg, i) => {
      if (i === 0) { doc.text(pg, M0, pg.h - 26, `${i + 1} / ${N}`, { size: 8.5, color: MUTED }); return; }
      // the code pages have reduced margins
      const mx = pg.compact ? 22 : M0, ty = pg.compact ? 16 : 30, fy = pg.compact ? 12 : 26;
      doc.text(pg, mx, ty, title, { size: 8.5, color: MUTED });
      doc.line(pg, mx, ty + 6, pg.w - mx, ty + 6, { color: [225, 231, 237], width: 0.6 });
      const t = `${i + 1} / ${N}`;
      doc.text(pg, pg.w - mx - PdfLib.textWidth(t, 'F1', 8.5), pg.h - fy, t, { size: 8.5, color: MUTED });
    });
    const blob = doc.build({ title, author: prog.attrs.authors || '' });
    window.__lastPdf = blob; // for the automatic tests
    await download(safeName(prog.attrs.name) + '.pdf', blob, 'application/pdf');
  }
  function exportCss() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    let css = `text{font:${RenderLib.R_.font};fill:${v('--sh-text')};text-anchor:middle}.cline-t{text-anchor:start}.comment text{font-weight:400;font-style:italic}.badge{font-size:10px}.c-in .badge{fill:${v('--s-in')}}.c-out .badge{fill:${v('--s-out')}}.c-decl .badge{fill:${v('--s-decl')}}.blabel{font-size:11px;font-weight:600;fill:${v('--muted')}}.flow{fill:none;stroke:${v('--flow')};stroke-width:1.6}.ahead{fill:${v('--flow')}}.joint{fill:${v('--flow')}}.shape>path,.shape>rect{stroke-width:1.6}.inner{fill:none!important}.note{stroke-dasharray:4 3}svg{background:${v('--paper')}}`;
    for (const c of ['term', 'decl', 'assign', 'in', 'out', 'cond', 'loop', 'call', 'comment', 'brk', 'file', 'inc', 'exc']) css += `.c-${c}>path,.c-${c}>rect{fill:${v('--f-' + c)};stroke:${v('--s-' + c)}}`;
    css += `.escseq{fill:${v('--err')}}`;
    css += `.flow.exc{stroke:${v('--s-exc')};stroke-dasharray:5 4}.fframe{fill:${v('--f-exc')};fill-opacity:.35;stroke:${v('--s-exc')};stroke-width:1.4;stroke-dasharray:6 4}`;
    // class diagram
    css += `.exc .ubg{stroke:${v('--s-exc')}}.exc .uheadbg{fill:${v('--f-exc')}}.exc .usep{stroke:${v('--s-exc')}}.builtin .ubg{stroke-dasharray:6 3}.builtin .uheadbg{fill-opacity:.55}`;
    css += `.ubg{fill:${v('--paper')};stroke:${v('--s-call')};stroke-width:1.6}.uheadbg{fill:${v('--f-call')}}.main .uheadbg{fill:${v('--f-term')}}.main .ubg{stroke:${v('--s-term')}}.usep{stroke:${v('--s-call')};stroke-width:1.2}.uname{font:700 14px "Atkinson Hyperlegible",sans-serif;text-anchor:middle}.ustereo{font:italic 11.5px "Atkinson Hyperlegible",sans-serif;fill:${v('--muted')};text-anchor:middle}.umem{font:400 12.5px "JetBrains Mono",monospace;text-anchor:start}.urel{fill:none;stroke:${v('--flow')};stroke-width:1.6}.minh{fill:${v('--paper')};stroke:${v('--flow')};stroke-width:1.6}.mopen{fill:none;stroke:${v('--flow')};stroke-width:1.6}.ulab{font:600 11.5px "JetBrains Mono",monospace;fill:${v('--muted')};text-anchor:start}`;
    return css;
  }
  function exportPng() {
    const s = exportSvg();
    const svgEl = $('svg', V.chart);
    const w = +svgEl.dataset.w, hh = +svgEl.dataset.h, k = 2;
    const img = new Image();
    img.onload = () => {
      const c = h('canvas', { width: w * k, height: hh * k });
      const x = c.getContext('2d'); x.scale(k, k); x.drawImage(img, 0, 0);
      c.toBlob((b) => download(safeName(st.prog.attrs.name) + '_' + (isUml() ? L('ui.classes') : safeName(fname(func()))) + '.png', b, 'image/png'));
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
  }

  /* ------------------------------ Menu ----------------------------------- */
  function menu(btn, items) {
    const r = btn.getBoundingClientRect();
    const box = h('div', { class: 'ctxmenu' });
    for (const it of items) {
      if (it === '-') { box.append(h('hr')); continue; }
      box.append(h('button', { type: 'button', class: it.cls || '', onclick: () => { closePop(); it.do(); } }, h('span', null, it.label), it.key ? h('kbd', null, it.key) : null));
    }
    openPop(r.left, r.bottom + 4, box);
  }
  function fileMenu(btn) {
    menu(btn, [
      { label: L('ui.newProgram'), key: 'Ctrl+Alt+N', do: newProgram },
      { label: L('ui.openFprgFile'), key: 'Ctrl+O', do: openFile },
      { label: L('ui.openFromWebAddress2'), key: 'Ctrl+Shift+O', do: openUrlDialog },
      { label: L('ui.saveAsFprg'), key: 'Ctrl+S', do: saveFile },
      { label: L('ui.copyTheLinkToThisProgram'), key: 'Ctrl+Shift+L', do: copyShareLink },
      '-',
      { label: L('ui.importAModule'), key: 'Ctrl+I', do: moduleDialog },
      { label: L('stage.stageMenu'), do: () => stageMenu() },
      '-',
      { label: L('ui.exportDiagramAsSvg'), key: 'Ctrl+Shift+G', do: exportSvgFile },
      { label: L('ui.exportDiagramAsPng'), key: 'Ctrl+Shift+E', do: exportPng },
      { label: L('ui.exportTheWholeProjectAsPdf'), key: 'Ctrl+P', do: exportPdf },
      { label: L('ui.downloadSourceCode'), key: 'Ctrl+Shift+S', do: downloadCode },
      '-',
      { label: L('ui.programProperties'), key: 'Alt+Enter', do: editProgram },
      '-',
      // the language item also says "Language" in English, so anyone can find it
      { label: `🌐 ${L('ui.language')}: ${I18n.name}${I18n.lang === 'en' ? '' : ' (Language)'}…`, do: languageDialog },
      ...(isStandalone() ? [] : ['-', { label: L('ui.installFlowlabAsAnApp'), do: installApp, cls: 'install' }]),
    ]);
  }
  /* language: the ones built into FlowLab and those in the languages folder on GitHub; choosing one reloads the page
     (the open program stays, it is saved automatically) */
  function languageDialog() {
    const list = h('div', { class: 'langlist', role: 'list' });
    const choose = async (code) => {
      if (code === I18n.lang) { closeTop(); return; }
      if (isRunning()) stopRun();
      autosave();
      try { await I18n.set(code); } catch (e) { toast(L('ui.cannotLoadLanguage', { code, message: e.message }), 'error'); }
    };
    const item = (code, name, remote) => h('button', { type: 'button', class: 'btn langitem' + (code === I18n.lang ? ' on' : ''), role: 'listitem', onclick: () => choose(code) },
      h('b', null, name), h('span', { class: 'muted small' }, remote ? `${code} · GitHub` : code));
    const draw = (remote) => {
      list.innerHTML = '';
      for (const l of I18n.available()) list.append(item(l.code, l.name, false));
      for (const c of remote.filter((x) => !I18n.packs[x])) list.append(item(c, c, true));
    };
    draw([]);
    const note = h('p', { class: 'muted small' }, L('ui.languagesLoading'));
    const close = openModal({ title: L('ui.language') + (I18n.lang === 'en' ? '' : ' · Language'), body: h('div', { class: 'fields' }, list, note), okText: L('win.close'), noCancel: true });
    const closeTop = () => { const m = modalStack[modalStack.length - 1]; if (m) m(); };
    I18n.remote().then((codes) => { draw(codes); note.textContent = L('ui.languagesHint'); }).catch(() => { note.textContent = L('ui.languagesOffline'); });
    return close;
  }
  /* ---- installation as an app (PWA): from the online version, open in a Chrome or Edge tab ---- */
  const ONLINE_URL = 'https://nicvac.github.io/flowlab/dist/FlowLab.html';
  let installEvt = null;
  const isStandalone = () => { try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (e) { return false; } };
  function setupPwa() {
    if (location.protocol === 'file:' || window.self !== window.top) return;
    if (!document.querySelector('link[rel=manifest]')) document.head.append(h('link', { rel: 'manifest', href: 'manifest.webmanifest' }));
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    // Chrome offers the installation: it is used from the File menu
    addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; });
    addEventListener('appinstalled', () => { installEvt = null; toast(L('ui.flowlabIsInstalledYouWillFind'), 'ok'); });
    // installed app: the .fprg files opened by the system (double click, «Open with») arrive here
    if ('launchQueue' in window) {
      window.launchQueue.setConsumer(async (params) => {
        const fh = params.files && params.files[0];
        if (!fh) return;
        try {
          const file = await fh.getFile();
          if (loadText(await file.text(), file.name, true) !== false) st.fileHandle = fh;
        } catch (e) { toast(L('ui.cannotOpenTheFile') + e.message, 'error'); }
      });
    }
  }
  async function installApp() {
    if (installEvt) {
      const e = installEvt; installEvt = null;
      e.prompt();
      try { const r = await e.userChoice; if (r.outcome !== 'accepted') installEvt = e; } catch (err) { /* nothing */ }
      return;
    }
    const ua = navigator.userAgent;
    let why;
    if (location.protocol === 'file:' || window.self !== window.top) why = L('ui.thisCopyOfFlowlabCannotBe', { ONLINEURL: ONLINE_URL });
    else if (/Firefox\//.test(ua)) why = L('ui.firefoxDoesNotInstallWebApps');
    else if (/Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) why = /iPhone|iPad/.test(ua) ? L('ui.inSafariTapShareAndThen') : L('ui.inSafariFileMenuAddTo');
    else why = L('ui.flowlabMayAlreadyBeInstalledYou');
    infoBox(L('ui.installFlowlabAsAnApp2'), why);
  }
  function exportSvgFile() { download(safeName(st.prog.attrs.name) + '_' + (isUml() ? L('ui.classes') : safeName(fname(func()))) + '.svg', exportSvg(), 'image/svg+xml'); }
  function downloadCode() { download(safeName(st.prog.attrs.name) + '.' + CodeGen.LANGS[st.lang].ext, CodeGen.generate(st.prog, st.lang), 'text/plain'); }
  /* ---- Stage: animated scenes that follow the variables (optional module, loaded only when a stage is opened) ---- */
  /* ------------------------------ Stage ------------------------------
     A program can name stages (prog.stages): .flstage files in the same folder as the .fprg (only the name is saved) or
     at a web address. Without stages nothing of the module is loaded and the execution has no hook. */
  let stageHook = null, stageMod = null;
  // the ends of the sliders of speed: slow on the left, fast on the right
  const ICON_SLOW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 15.5c0-4 3.2-7 7-7s7 3 7 7z"/><path d="M7.2 11.5l3.8 4M14.8 11.5L11 15.5M11 8.5v7"/><path d="M18 15.5h1.8a1.8 1.8 0 0 0 1.7-2.3l-.3-.9a1.5 1.5 0 0 0-2.1-.9L18 12M6 15.5v2.5M15.5 15.5v2.5M3 15.5l-1 1"/></svg>';
  const ICON_FAST = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 18c0-4 3-7 7.5-7 1.8 0 3 .5 4 1.3"/><path d="M16.5 12.3c1.5-.3 3 .4 3.5 1.7.4 1-.3 2-1.3 2H17M12.5 11C12 8 12.5 4.5 14 3.5c1 1.5.8 4.5-.3 7.7M15 11.2c.8-2.7 2.5-5.4 4-5.7.4 1.8-1 4.5-2.8 6.4"/><path d="M5 18h10.5a2.5 2.5 0 0 0 2.5-2M8 18l-1.5 2M13 18l1 2M5 18c-1.3 0-2-.8-2-1.8"/><circle cx="18" cy="13.6" r=".5"/></svg>';
  const STAGE_ICON = '<svg viewBox="0 0 24 24"><path d="M3 4h18M5 4v13M19 4v13M3 17h18"/><path d="M5 4c2 4 5 5 7 5s5-1 7-5"/><circle cx="9.5" cy="13" r="1.6"/><circle cx="14.5" cy="13" r="1.6"/></svg>';
  // the texts of the stage files chosen in this session (by name); the stages of the examples are in the page
  const stageTexts = new Map();
  const isStageFile = (name) => /\.flstage$/i.test(name);
  function stageModule() {
    if (stageMod) return stageMod;
    // the code of the stages becomes active only now (until now it is only text in the page)
    const sc = document.createElement('script'); sc.textContent = STAGE_SRC; document.head.append(sc); sc.remove();
    stageMod = window.FlowLabStage({
      L, h, M, toast, openModal, store, ICON: STAGE_ICON, ICON_MIN, ICON_SLOW, ICON_FAST, lang: I18n.lang,
      prog: () => st.prog, interp: () => run.interp, winHost, nextZ: () => ++zTop,
      area: () => $('#canvasWrap').getBoundingClientRect(),
      stages: () => st.prog.stages || null,
      resolve: resolveStage, pickFiles: pickStageFiles,
      // the text of a stage if already at hand (to show its name before loading it)
      peek: (x) => { if (stageTexts.has(x.file)) return stageTexts.get(x.file); const ex = st.stageBase && st.stageBase.startsWith('example:') ? STAGE_FILES[st.stageBase.slice(8)] : null; return ex && ex[x.file] != null ? STAGE_FILES.texts[ex[x.file]] : null; },
      // the list and the bindings are part of the program (to save); the active stage and the collapse are saved too,
      // but they do not count as changes
      changed: (what) => {
        if (st.prog.stages && !st.prog.stages.list.length) delete st.prog.stages;
        if (what === 'list' || what === 'bind') st.dirty = true;
        autosave();
      },
      setHook: (x) => {
        stageHook = x; run.stageWait = null; run.stageHold = null;
        // a stage loaded during an execution starts from the values it finds
        if (x && isRunning() && run.interp) x.start(run.interp);
      },
    });
    return stageMod;
  }
  /* the window of the stages follows the program: shown if it names stages, removed (with the module idle) if not */
  function syncStages() {
    if (st.prog.stages && st.prog.stages.list.length) stageModule().mount();
    else if (stageMod) stageMod.unmount();
  }
  /* the text of a stage: from its address; from the files chosen; from the examples; next to the program opened from an
     address; at the start, from the copy kept by the browser of the last stages used */
  async function resolveStage(x) {
    const f = x.file;
    if (/^https?:\/\//i.test(f)) return { text: (await fetchText(f)).text };
    if (stageTexts.has(f)) return { text: stageTexts.get(f) };
    const ex = st.stageBase && st.stageBase.startsWith('example:') ? STAGE_FILES[st.stageBase.slice(8)] : null;
    if (ex && ex[f] != null) return { text: STAGE_FILES.texts[ex[f]] };
    if (st.sourceUrl) {
      try { const t = (await fetchText(new URL(f, st.sourceUrl).href)).text; stageTexts.set(f, t); return { text: t }; } catch (e) { return { missing: true }; }
    }
    const kept = (store.get('stageCache', {}) || {})[f];
    if (st.stageBase === 'restore' && kept) return { text: kept };
    return { missing: true };
  }
  function keepStage(name, text) {
    stageTexts.set(name, text);
    // a copy in the browser, only to find the stages again when the page is reloaded (the last few)
    try { const c = store.get('stageCache', {}) || {}; delete c[name]; c[name] = text; const k = Object.keys(c); while (k.length > 6) delete c[k.shift()]; store.set('stageCache', c); } catch (e) { /* ignore */ }
  }
  const readText = (file) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => res(null); r.readAsText(file); });
  /* chooses .flstage files (several at once): they become known by name; resolves with true if at least one */
  function pickStageFiles() {
    return new Promise((resolve) => {
      const inp = h('input', { type: 'file', accept: '.flstage', multiple: true, hidden: true });
      inp.addEventListener('change', async () => {
        let n = 0;
        for (const f of inp.files) { const t = await readText(f); if (t != null && isStageFile(f.name)) { keepStage(f.name, t); n++; } }
        inp.remove(); resolve(n > 0);
      });
      document.body.append(inp); inp.click();
    });
  }
  /* links a stage to the program (by name, or by address), makes it the active one and shows the window */
  function linkStage(file, text) {
    if (text != null) keepStage(file, text);
    const s = st.prog.stages || (st.prog.stages = { list: [], active: 0, collapsed: false });
    let i = s.list.findIndex((x) => x.file === file);
    if (i < 0) { s.list.push({ file, bind: {} }); i = s.list.length - 1; st.dirty = true; }
    s.active = i; s.collapsed = false;
    autosave();
    stageModule().mount();
  }
  function addStageFiles() {
    const inp = h('input', { type: 'file', accept: '.flstage', multiple: true, hidden: true });
    inp.addEventListener('change', async () => {
      for (const f of inp.files) { const t = await readText(f); if (t != null) linkStage(f.name, t); }
      inp.remove();
    });
    document.body.append(inp); inp.click();
  }
  function addStageUrl() {
    const u = field({ key: 'surl', label: L('stage.addressOfTheStage'), type: 'plain', placeholder: 'https://…/fila.flstage' }, '');
    openModal({ title: L('stage.linkAStageFromAnAddress'), body: h('div', { class: 'fields' }, u), okText: L('stage.link'), onOk: () => {
      const a = u._get().trim(); if (!a) return L('stage.writeTheAddress');
      fetchText(a).then(({ text, abs }) => { stageTexts.set(abs, text); linkStage(abs); }).catch((e) => toast(L('stage.cannotDownload', { msg: e instanceof TypeError ? L('ui.theSiteDoesNotRespondOr2') : e.message }), 'error'));
      return true;
    } });
  }
  /* for the tests and the API: links a stage given as text */
  function openStage(text, name) { linkStage(name || 'stage.flstage', text); }
  function stageMenu() {
    const r = $('#fileBtn').getBoundingClientRect();
    const s = st.prog.stages;
    const B = (label, fn) => h('button', { type: 'button', onclick: () => { closePop(); fn(); } }, h('span', null, label));
    const box = h('div', { class: 'ctxmenu examples' }, h('div', { class: 'pophead' }, L('stage.stage')),
      h('p', { class: 'muted small stage-hint' }, L('stage.sameFolder')),
      B(L('stage.linkStageFiles'), addStageFiles), B(L('stage.linkAStageFromAnAddress'), addStageUrl));
    if (s && s.list.length) {
      box.append(h('hr'));
      if (s.collapsed) box.append(B(L('stage.showTheStage'), () => { s.collapsed = false; stageModule().mount(); autosave(); }));
      if (stageMod && stageMod.isOpen()) box.append(B(L('stage.bindTheVariables'), () => stageMod.bindDialog()), B(L('stage.saveTheStage'), () => stageMod.save()));
      box.append(B(L('stage.unlinkTheStage'), () => { s.list.splice(s.active, 1); s.active = Math.min(s.active, s.list.length - 1); if (!s.list.length) delete st.prog.stages; st.dirty = true; autosave(); syncStages(); }));
    }
    openPop(r.left, r.bottom + 4, box);
  }
  function examplesMenu(btn) {
    const r = btn.getBoundingClientRect();
    const box = h('div', { class: 'ctxmenu examples' }, h('div', { class: 'pophead' }, L('ui.examplePrograms')));
    for (const ex of Examples.list) {
      // the examples linked to stages have the icon of the stage next to the title
      const ico = ex.stages ? h('span', { class: 'ex-stage', title: L('stage.exampleWithStage'), 'aria-label': L('stage.exampleWithStage'), role: 'img', html: STAGE_ICON }) : null;
      box.append(h('button', { type: 'button', onclick: () => { closePop(); loadExample(ex.id); } }, h('span', { class: 'ex-title' }, ex.title, ico), h('span', { class: 'tag' }, ex.tags)));
    }
    openPop(r.left, r.bottom + 4, box);
  }
  function helpDialog() {
    const fns = Object.entries(E.BUILTINS).map(([k, b]) => h('tr', null, h('td', { class: 'mono' }, b.doc.split(' — ')[0]), h('td', null, b.doc.split(' — ')[1] || '')));
    const ops = [
      ['+  -  *  /', L('ui.arithmeticDivisionAlwaysGivesAReal')], ['mod  %', L('ui.remainderOfTheDivision')], ['^', L('ui.power238')],
      ['&', L('ui.joinsTextsAndNumbersTotalT')], ['=  ==   !=  <>', L('ui.equalNotEqual')], ['<  <=  >  >=', L('ui.comparisons')],
      ['and  &&   or  ||   not  !', L('ui.logicalOperators')], ['xor  ⊕', L('ui.xorTrueWhenExactlyOne')], ['true  false  Pi', L('ui.constants')], ['v[i]', L('ui.elementIOfAnArrayFrom')],
      ['v ← quadrati(10)', L('ui.functionThatReturnsAnArrayV')],
      ['Try  Catch  Finally', L('ui.exceptionsIfABlockOfThe')],
      ['Throw new Exception("…")', L('ui.throwsAnExceptionPredefinedTypesEccezione')],
      ['e.message', L('ui.inTheCatchTheMessageOf')],
      ['massimo<T>(v: T[], n)', L('ui.genericTypeTAnyTypeInferred')],
    ].map(([a, b]) => h('tr', null, h('td', { class: 'mono' }, a), h('td', null, b)));
    const oo = [
      ['p ← new Punto(1, 2)', L('ui.createsAnObjectRunsTheConstructor')], ['p.x   p.sposta(3, 4)', L('ui.attributeAndMethodOfAnObject')],
      ['this.x', L('ui.attributeOfTheObjectBeingWorked')], ['Punto.contatore   Punto.crea()', L('ui.staticAttributeOrMethodUsedWith')],
      ['super(nome)', L('ui.callBlockFirstBlockOfThe')], ['super.descrivi()', L('ui.runsTheParentClassSVersion')],
      ['null   p = null', L('ui.noObjectItCanBeAssigned')], [L('uml.abstract3'), L('ui.abstractClassNoObjectsAreCreated')], ['+  -  #', L('ui.publicPrivateProtectedAccessCheckedDuring')],
      ['ArrayList<T>', L('ui.classWithGenericTypeTChosen')], ['l ← new ArrayList<Intero>()', L('ui.objectOfAClassWithA')],
      ['a ← b', L('ui.withTwoArraysABecomesThe')], ['Ctrl+I', L('ui.importAModuleReadyMadeClasses')], ['p.   Punto.', L('ui.typingTheDotAfterAnObject')],
    ].map(([a, b]) => h('tr', null, h('td', { class: 'mono' }, a), h('td', null, b)));
    const keys = SHORTCUTS.flatMap(([g, rows]) => [h('tr', { class: 'kgroup' }, h('td', { colspan: 2 }, g)), ...rows.map(([a, b]) => h('tr', null, h('td', { class: 'mono' }, a), h('td', null, b)))]);
    const body = h('div', { class: 'help-body' },
      h('p', null, L('ui.clickAnArrowOfTheDiagram')),
      h('h3', null, L('ui.operators')), h('table', { class: 'ref' }, h('tbody', null, ops)),
      h('h3', null, L('ui.classesAndObjectsObjectsView')), h('p', { class: 'muted small' }, L('ui.inTheClassDiagramDoubleClick')), h('table', { class: 'ref' }, h('tbody', null, oo)),
      h('h3', null, L('ui.builtInFunctions')), h('table', { class: 'ref' }, h('tbody', null, fns)),
      h('h3', null, L('ui.shortcuts')), h('table', { class: 'ref' }, h('tbody', null, keys)));
    openModal({ title: L('ui.quickGuide'), wide: true, body, okText: L('win.close'), noCancel: true });
  }

  /* ------------------------------ Keyboard ------------------------------- */
  /* list of the shortcuts (Quick guide) */
  const SHORTCUTS = [
    ['File', [
      ['Ctrl+Alt+N', L('ui.newProgram')], ['Ctrl+O', L('ui.openFprgFile2')], ['Ctrl+Shift+O', L('ui.openFromWebAddress')], ['Ctrl+S', L('ui.saveAsFprg')],
      ['Ctrl+Shift+L', L('ui.copyTheLinkToTheProgram')], ['Ctrl+I', L('ui.importAModule2')],
      ['Ctrl+Shift+G  ·  Ctrl+Shift+E', L('ui.exportTheDiagramAsSvgAs')], ['Ctrl+P', L('ui.exportTheWholeProjectAsPdf')], ['Ctrl+Shift+S', L('ui.downloadTheSourceCode')],
      ['Alt+Enter', L('ui.programProperties2')],
    ]],
    [L('ui.execution'), [
      ['F5  ·  Ctrl+Enter', L('ui.runContinue')], ['F10', L('ui.nextStepEntersTheCalledFunctions')], ['F8', L('ui.stepOverRunsTheCallWithout')], ['Shift+F8', L('ui.stepOutRunsTheRestAnd')], ['F9', L('ui.breakpointOnTheSelectedBlock')], [L('ui.rightClick'), L('ui.runToHereAndConditionalBreakpoints')],
      ['F6', L('chart.pause')], ['Shift+F5', L('ui.stop')],
    ]],
    [L('ui.edit4'), [
      ['Ctrl+Z  ·  Ctrl+Y', L('ui.undoRedo')], ['Ctrl+C  X  V  D', L('ui.copyCutPasteAfterTheSelected')],
      [L('ui.enterDoubleClick'), L('ui.editTheSelectedBlock')], [L('ui.del'), L('ui.deleteTheSelectedBlock')],
      ['↑  ↓', L('ui.selectThePreviousNextBlock')], [L('ui.shiftClickShiftArrows'), L('ui.selectSeveralBlocks')], ['Ctrl+A', L('ui.selectAllTheBlocksOfThe')], ['Alt+↑  Alt+↓', L('ui.moveTheSelectedBlockUpDown')],
    ]],
    [L('ui.addABlockAfterTheSelected'), [
      [keysOf('declare', 'const', 'assign'), L('ui.declareConstantAssign')], [keysOf('input', 'output', 'call'), L('ui.inputOutputCall')], [keysOf('if', 'while', 'for', 'do'), L('ui.ifWhileForDoWhile')], [keysOf('comment', 'breakpoint'), L('ui.commentBreakpoint')],
      [keysOf('open', 'read', 'write', 'close'), L('ui.openFileReadFromFileWrite')],
      [keysOf('try', 'throw'), L('ui.tryWithCatchAndFinallyThrow')],
    ]],
    [L('ui.functionsMethodsAndClasses'), [
      ['N', L('ui.newFunctionOrNewMethodIn')], ['Shift+E', L('ui.inTheClassDiagramNewException')], ['F2', L('ui.editTheFunctionOrMethodIn')],
      ['Shift+Canc', L('ui.deleteTheFunctionOrMethod')], ['PgUp  PgDn', L('ui.previousNextDiagram')], ['U', L('ui.classDiagram')],
      ['A  M  C', L('ui.classDiagramNewAttributeMethodConstructor')],
      [L('ui.enterDel'), L('ui.classDiagramOpenOrEditDelete')],
      ['Shift+M', L('ui.classDiagramCollapseOrExpandThe')],
    ]],
    [L('ui.view3'), [
      ['Ctrl+Alt+F  ·  Ctrl+Alt+O', L('ui.functionsViewObjectsView')], ['Alt+1  2  3  4', L('ui.consoleVariablesCodeFilesTabs')], ['Ctrl+B', L('ui.showOrHideThePanel')],
      ['Ctrl++  Ctrl+-  Ctrl+0', L('ui.zoomInOut100')], ['Shift+1', L('ui.fitToWindow')], [L('ui.spaceDrag'), L('ui.moveTheSheet')], ['H', L('ui.handMoveTheSheet')], ['Shift+K', L('ui.compactViewOfTheFlowchartBlocks')], ['Ctrl+Alt+V', L('ui.newViewAnotherWindowOnThe2')], [L('ui.ctrlWheel'), 'Zoom'],
      ['F1', L('ui.quickGuide')], ['Esc', L('ui.closeWindowsAndMenus')], ['Shift+Enter', L('ui.confirmTheDialog')],
    ]],
  ];
  /* previous or next diagram in the selector */
  function navDiagram(dir) {
    const sel = V.main ? $('#funcSel') : V.sel, n = sel.options.length;
    if (sel.disabled) return;
    if (n < 2) return;
    sel.selectedIndex = (sel.selectedIndex + dir + n) % n;
    sel.dispatchEvent(new Event('change'));
  }
  function bindKeys() {
    document.addEventListener('keydown', (e) => {
      if (e.defaultPrevented) return;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      const ctrl = e.ctrlKey || e.metaKey, shift = e.shiftKey, alt = e.altKey;
      const k = e.key.toLowerCase();
      const go = (fn) => { e.preventDefault(); fn(); };
      if (e.key === 'Escape') {
        if (!$('#pop').hidden) { closePop(); e.preventDefault(); return; }
        if (modalStack.length) { modalStack[modalStack.length - 1](); e.preventDefault(); return; }
        if (drag && drag.on) { drag.ghost.remove(); drag = null; document.body.classList.remove('dragging'); return; }
        if (handTool) { setHand(false); return; }
        // Esc leaves only the main block selected
        if (st.msel && st.msel.size > 1) { setSel(st.sel ? [st.sel] : []); decorate(); }
        return;
      }
      // «Add a block» menu open: the key chooses the block
      const insBox = !$('#pop').hidden && $('#pop .insmenu');
      if (insBox) {
        const kind = KEY_KIND[keyLabel(e)];
        if (kind) go(() => { const t = insBox._target; closePop(); addStmt(t, kind); });
        else if (ctrl && k === 'v' && st.clip) go(() => { const t = insBox._target; closePop(); paste(t); });
        return;
      }
      if (modalStack.length || !$('#pop').hidden) return;
      const busy = () => { if (isRunning()) { toast(L('ui.stopTheProgramToEditThe'), 'warn'); return true; } return false; };
      // execution
      if (e.key === 'F1') return go(helpDialog);
      if (e.key === 'F5' && shift) return go(() => { if (!$('#stopBtn').disabled) stopRun(); });
      if (e.key === 'F5' || (ctrl && e.key === 'Enter')) return go(onRunBtn);
      if (e.key === 'F6') return go(() => { if (!$('#pauseBtn').disabled) onPauseBtn(); });
      if (e.key === 'F10') return go(onStepBtn);
      if (e.key === 'F9') return go(() => { if (!st.uml) toggleMark(vget(V, 'sel')); });
      if (e.key === 'F8' && shift) return go(onOutBtn);
      if (e.key === 'F8') return go(onOverBtn);
      // file
      if (ctrl && !alt) {
        if (k === 's') return go(shift ? downloadCode : saveFile);
        if (k === 'o') return go(shift ? openUrlDialog : openFile);
        if (k === 'p' && !shift) return go(exportPdf);
        if (shift && k === 'e') return go(exportPng);
        if (shift && k === 'g') return go(exportSvgFile);
        if (shift && k === 'l') return go(copyShareLink);
        if (!shift && k === 'i') return go(moduleDialog);
      }
      if (alt && !ctrl && e.key === 'Enter') return go(() => { if (!busy()) editProgram(); });
      if (typing) return;
      // view
      if (ctrl && alt) {
        if (e.code === 'KeyN') return go(newProgram);
        if (e.code === 'KeyF') return go(() => setView('functions'));
        if (e.code === 'KeyO') return go(() => setView('objects'));
        if (e.code === 'KeyV') return go(newView);
      }
      if (ctrl && !alt && k === 'b') return go(() => $('#sideToggle').click());
      if (alt && !ctrl && /^Digit[1-4]$/.test(e.code)) return go(() => setTab(['console', 'vars', 'code', 'files'][+e.code.slice(5) - 1]));
      if (ctrl && !alt && (e.key === '+' || e.key === '=')) return go(() => setZoom(st.zoom * 1.15));
      if (ctrl && !alt && e.key === '-') return go(() => setZoom(st.zoom / 1.15));
      if (ctrl && !alt && e.key === '0') return go(() => setZoom(1));
      if (shift && !ctrl && !alt && e.code === 'Digit1') return go(fitZoom);
      // edit
      if (ctrl && k === 'z' && !shift) return go(undo);
      if (ctrl && (k === 'y' || (k === 'z' && shift))) return go(redo);
      if (ctrl && !shift && k === 'c') { if (st.sel) go(() => copySel(false)); return; }
      if (ctrl && !shift && k === 'x') { if (st.sel) go(() => copySel(true)); return; }
      if (ctrl && !shift && k === 'v') { if (st.clip) go(() => paste()); return; }
      if (ctrl && !shift && k === 'd') { if (st.sel) go(duplicate); return; }
      if (ctrl && !shift && !alt && k === 'a' && !isUml()) return go(selectAll);
      // functions, methods and classes
      if (e.key === 'PageDown' || e.key === 'PageUp') { if (!ctrl && !alt) go(() => navDiagram(e.key === 'PageDown' ? 1 : -1)); return; }
      if (e.key === 'F2') return go(() => $('#funcEdit').click());
      if (shift && (e.key === 'Delete' || e.key === 'Backspace') && !isUml()) return go(() => $('#funcDel').click());
      const lab = keyLabel(e);
      if (lab === 'N') return go(() => $('#funcAdd').click());
      if (lab === 'H') return go(() => setHand(!handTool));
      if (lab === 'Shift+E' && isUml()) return go(() => { if (isRunning()) toast(L('ui.stopTheProgramToEditThe'), 'warn'); else classDialog(null, null, true); });
      if (lab === 'U' && isOO() && !isUml()) return go(showUml);
      if (lab === 'Shift+K' && !isUml()) return go(toggleCompact);
      if (isUml()) {
        if ((e.key === 'Delete' || e.key === 'Backspace') && st.usel && !isRunning()) { e.preventDefault(); deleteUmlSel(); }
        else if (e.key === 'Enter' && st.usel) { e.preventDefault(); if (st.usel.kind === 'method') openMethod(st.usel.fid); else if (!isRunning()) editUmlSel(); }
        else if (lab === 'Shift+M') { e.preventDefault(); toggleAllModules(); }
        else if (lab === 'A' || lab === 'M' || lab === 'C') {
          e.preventDefault();
          if (busy()) return;
          const c = uselClass(); if (!c) { toast(L('ui.selectAClassFirst'), 'warn'); return; }
          if (lab === 'A') attrDialog(c, null); else editFunction(null, { cls: c, ctor: lab === 'C' });
        }
        return;
      }
      // nothing selected: the arrows move the sheet (with Shift, more)
      if (/^Arrow/.test(e.key) && !ctrl && !alt && !typing && !st.sel && !st.usel) {
        // in a «Continue» view up and down scroll the main sheet (the view follows it)
        const d = shift ? 240 : 60, vert = e.key === 'ArrowUp' || e.key === 'ArrowDown', w = vert && V.sync ? MAIN.wrap : V.wrap;
        return go(() => w.scrollBy({ left: e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, top: e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0 }));
      }
      // flowchart
      if ((e.key === 'Delete' || e.key === 'Backspace') && st.sel) return go(deleteSel);
      if (e.key === 'Enter' && st.sel) return go(() => editStmt(st.sel));
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && st.sel) {
        if (alt) return go(() => shiftSel(e.key === 'ArrowDown' ? 1 : -1));
        const f = M.findStmt(st.prog, st.sel); if (!f) return;
        const n = f.arr[f.index + (e.key === 'ArrowDown' ? 1 : -1)];
        if (n) {
          e.preventDefault();
          // Shift: the selection grows (or shrinks) from the first block chosen
          if (shift) { const anchor = st.msel && st.msel.size > 1 ? st.mselAnchor : st.sel; const r = rangeIds(anchor, n.id); if (r) { setSel(r.ids, n.id); st.mselAnchor = anchor; } }
          else setSel([n.id]);
          decorate(); const el = $(`.shape[data-id="${n.id}"]`, V.chart); if (el) scrollIntoViewIfNeeded(el);
        }
        return;
      }

      const kind = KEY_KIND[lab];
      if (kind) go(() => addByKey(kind));
    });
  }

  /* ----------------------------- Startup ----------------------------------- */
  function bindUi() {
    $('#fileBtn').addEventListener('click', (e) => fileMenu(e.currentTarget));
    $('#exBtn').addEventListener('click', (e) => examplesMenu(e.currentTarget));
    $('#modBtn').addEventListener('click', moduleDialog);
    $('#modToggle').addEventListener('click', toggleAllModules);
    $('#openBtn').addEventListener('click', openFile);
    $('#saveBtn').addEventListener('click', saveFile);
    $('#undoBtn').addEventListener('click', undo);
    $('#redoBtn').addEventListener('click', redo);
    $('#helpBtn').addEventListener('click', helpDialog);
    $('#progName').addEventListener('click', () => { if (isRunning()) { toast(L('ui.stopTheProgramToEditThe'), 'warn'); return; } editProgram(); });
    $('#fileInput').addEventListener('change', (e) => { readFiles(e.target.files).then(() => { e.target.value = ''; }); });
    enhanceSel($('#funcSel'));
    $('#funcSel').addEventListener('change', (e) => { focusView(MAIN); if (e.target.value === 'uml') showUml(); else showFunc(+e.target.value); });
    const busy = () => { if (isRunning()) { toast(L('ui.stopTheProgramToEditThe'), 'warn'); return true; } return false; };
    $('#funcAdd').addEventListener('click', () => { if (busy()) return; if (!isOO()) editFunction(null); else if (st.uml) classDialog(null); else editFunction(null, { cls: M.classOf(st.prog, func()) || M.mainClass(st.prog), ctor: false }); });
    $('#funcEdit').addEventListener('click', () => { if (busy()) return; if (isUml()) editUmlSel(); else if (st.fi === 0) editProgram(); else editFunction(st.fi); });
    $('#funcDel').addEventListener('click', () => { if (busy()) return; if (isUml()) deleteUmlSel(); else deleteFunction(); });
    $('#viewFn').addEventListener('click', () => setView('functions'));
    $('#viewOo').addEventListener('click', () => setView('objects'));
    $('#backUml').addEventListener('click', () => { focusView(MAIN); showUml(); });
    $('#runBtn').addEventListener('click', onRunBtn);
    $('#stepBtn').addEventListener('click', onStepBtn);
    $('#overBtn').addEventListener('click', onOverBtn);
    $('#outBtn').addEventListener('click', onOutBtn);
    $('#pauseBtn').addEventListener('click', onPauseBtn);
    $('#stopBtn').addEventListener('click', stopRun);
    const sp = $('#speed');
    // to the right faster (as the slider of the stages): the slider shows SPEEDS from the slowest to the instant one
    const toPos = (i) => SPEEDS.length - 1 - i;
    sp.value = toPos(st.speed); $('#speedVal').textContent = SPEEDS[st.speed].label;
    sp.addEventListener('input', () => { st.speed = toPos(+sp.value); store.set('speed', st.speed); $('#speedVal').textContent = SPEEDS[st.speed].label; });
    $('#zoomIn').addEventListener('click', () => { focusView(MAIN); zoomAt(MAIN, st.zoom * 1.15); });
    $('#zoomOut').addEventListener('click', () => { focusView(MAIN); zoomAt(MAIN, st.zoom / 1.15); });
    $('#panBtn').addEventListener('click', () => setHand(!handTool));
    $('#zoomFit').addEventListener('click', () => { focusView(MAIN); fitZoom(); });
    $('#compactBtn').addEventListener('click', () => { focusView(MAIN); toggleCompact(); });
    $('#zoomVal').addEventListener('click', () => { focusView(MAIN); setZoom(1); });
    $('#tabs').addEventListener('keydown', (e) => {
      if (below.matches) {
        if (!['ArrowUp', 'ArrowDown'].includes(e.key) || document.body.classList.contains('side-hidden')) return;
        e.preventDefault();
        setSideH($('#side').getBoundingClientRect().height + (e.key === 'ArrowUp' ? 30 : -30));
        return;
      }
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const tabs = $$('#tabs [role=tab]'); const i = tabs.findIndex((t) => t.dataset.tab === st.tab);
      const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; setTab(n.dataset.tab); n.focus();
    });
    // no form submit: in sandboxed pages the submit event does not arrive
    $('#conForm').addEventListener('submit', (e) => e.preventDefault());
    $('#conSend').addEventListener('click', () => submitInput($('#conInput').value));
    $('#conInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submitInput($('#conInput').value); } });
    $('#conClear').addEventListener('click', () => { if (!isRunning()) conClear(); });
    const ls = $('#langSel');
    for (const [k, L] of Object.entries(CodeGen.LANGS)) ls.append(h('option', { value: k, selected: k === st.lang }, L.label));
    ls.addEventListener('change', () => { st.lang = ls.value; store.set('lang', st.lang); renderCode(); });
    $('#codeOut').addEventListener('click', onCodeClick);
    // size of the code text: buttons A− A+ (the number brings it back to 13), Ctrl + wheel on the code; remembered
    const setCodeSize = (px) => {
      const v = Math.max(9, Math.min(28, Math.round(px)));
      document.documentElement.style.setProperty('--code-size', v + 'px');
      $('#codeSizeVal').textContent = v;
      store.set('codeSize', v);
    };
    const codeSize = () => +store.get('codeSize', 13) || 13;
    setCodeSize(codeSize());
    $('#codeSmaller').addEventListener('click', () => setCodeSize(codeSize() - 1));
    $('#codeBigger').addEventListener('click', () => setCodeSize(codeSize() + 1));
    $('#codeSizeVal').addEventListener('click', () => setCodeSize(13));
    $('#codeOut').addEventListener('wheel', (e) => { if (!e.ctrlKey) return; e.preventDefault(); setCodeSize(codeSize() + (e.deltaY < 0 ? 1 : -1)); }, { passive: false });
    $('#codeCopy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText($('#codeOut').dataset.raw || ''); toast(L('ui.codeCopied'), 'ok'); }
      catch (e) { const r = document.createRange(); r.selectNodeContents($('#codeOut')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast(L('ui.pressCtrlCToCopyThe')); }
    });
    $('#fileNew').addEventListener('click', () => editFile(null));
    $('#fileUpload').addEventListener('click', () => $('#txtInput').click());
    $('#txtInput').addEventListener('change', (e) => { for (const f of e.target.files) { const r = new FileReader(); r.onload = () => { st.vfs.set(f.name, r.result); saveVfs(); }; r.readAsText(f); } e.target.value = ''; });
    document.addEventListener('mousedown', (e) => { const p = $('#pop'); if (!p.hidden && !p.contains(e.target)) closePop(); });
    window.addEventListener('resize', closePop);
    $('#canvasWrap').addEventListener('scroll', () => { closePop(); scheduleSync(); });
    // drag and drop files
    document.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); document.body.classList.add('filedrag'); } });
    document.addEventListener('dragleave', (e) => { if (e.target === document.documentElement || !e.relatedTarget) document.body.classList.remove('filedrag'); });
    document.addEventListener('drop', (e) => { if (!e.dataTransfer || !e.dataTransfer.files.length) return; e.preventDefault(); document.body.classList.remove('filedrag'); readFiles(e.dataTransfer.files); });
    // panel divider
    const grip = $('#grip');
    const sideW = store.get('sideW', null); if (sideW) document.documentElement.style.setProperty('--side-w', sideW + 'px');
    const sideH = store.get('sideH', null); if (sideH) document.documentElement.style.setProperty('--side-h', sideH + 'px');
    // on narrow screens the panel is below the diagram: the divider is horizontal and changes the height of the panel
    const below = matchMedia('(max-width: 900px)');
    const orient = () => grip.setAttribute('aria-orientation', below.matches ? 'horizontal' : 'vertical');
    orient(); below.addEventListener('change', orient);
    const setSideH = (h) => { h = Math.round(Math.max(140, Math.min(window.innerHeight - 220, h))); document.documentElement.style.setProperty('--side-h', h + 'px'); store.set('sideH', h); };
    $('#sideToggle').addEventListener('pointerdown', (e) => e.stopPropagation());
    $('#sideToggle').addEventListener('click', (e) => { e.stopPropagation(); setSideHidden(!document.body.classList.contains('side-hidden')); });
    setSideHidden(!!store.get('sideHidden', false));
    grip.addEventListener('pointerdown', (e) => {
      if (document.body.classList.contains('side-hidden')) return;
      grip.setPointerCapture(e.pointerId);
      const mv = below.matches
        ? (ev) => setSideH(window.innerHeight - ev.clientY - 3)
        : (ev) => { const w = Math.max(280, Math.min(window.innerWidth - 320, window.innerWidth - ev.clientX)); document.documentElement.style.setProperty('--side-w', w + 'px'); store.set('sideW', w); };
      const up = () => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); };
      grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up);
    });
    grip.addEventListener('keydown', (e) => {
      if (below.matches) {
        if (!['ArrowUp', 'ArrowDown'].includes(e.key) || document.body.classList.contains('side-hidden')) return;
        e.preventDefault();
        setSideH($('#side').getBoundingClientRect().height + (e.key === 'ArrowUp' ? 30 : -30));
        return;
      }
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const cur = $('#side').getBoundingClientRect().width; const w = Math.max(280, cur + (e.key === 'ArrowLeft' ? 30 : -30));
      document.documentElement.style.setProperty('--side-w', w + 'px'); store.set('sideW', w);
    });
    // theme
    const theme = store.get('theme', null);
    if (theme) document.documentElement.dataset.theme = theme;
    $('#themeBtn').addEventListener('click', () => {
      const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      const nx = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = nx; store.set('theme', nx);
    });
    window.addEventListener('beforeunload', (e) => { if (st.dirty && window.self === window.top) { e.preventDefault(); e.returnValue = ''; } });
  }

  /* at opening: Functions view on the Main; the Objects view only if the program
     has several classes or members that the functions cannot show, and anyway on the Main */
  function startView() {
    st.view = M.hasClasses(st.prog) && !M.isTrivialOO(st.prog) ? 'objects' : 'functions';
    store.set('view', st.view);
    st.fi = 0; st.uml = false; st.sel = null; st.usel = null;
    codeStart();
  }
  // starting a program (new, opened from a file or from a web address, an example): the Code tab in Java
  /* a program that starts (new, opened, example): the Code tab, in the language last chosen (Java if none) */
  function codeStart() {
    const ls = $('#langSel'); if (ls) ls.value = st.lang;
    if ($('#tabs')) setTab('code');
  }
  function init() {
    ArrayView.configure({ host: () => $('#floatLayer'), nextZ: () => ++zTop });
    I18n.translateDom(document.body); // fixed texts of the page in the chosen language
    MAIN.chart = $('#chart'); MAIN.wrap = $('#canvasWrap');
    // the margin of empty paper around the drawing: about a screen on each side (the same for the whole session)
    document.documentElement.style.setProperty('--pan-x', Math.round(Math.max(900, screen.width * 0.8)) + 'px');
    document.documentElement.style.setProperty('--pan-y', Math.round(Math.max(700, screen.height * 0.8)) + 'px');
    bindUi(); bindPan(); bindChart(MAIN); bindDrag(); bindKeys(); setupPwa(); bindViews();
    const saved = store.get('autosave', null);
    let ok = false;
    if (saved && saved.xml) {
      try { st.prog = M.parseFprg(saved.xml); st.fi = Math.min(saved.fi || 0, st.prog.functions.length - 1); st.fileName = saved.fileName || null; st.sourceUrl = saved.sourceUrl || null; st.stageBase = saved.stageBase || 'restore'; ok = true; } catch (e) { ok = false; }
    }
    if (!ok) st.prog = Examples.get('grade_average').make();
    startView();
    render(); initLayout(); renderVars(); renderFiles(); setStatus('idle', L('ui.ready'));
    // the auxiliary views of the open program
    if (ok && Array.isArray(saved.views)) { for (const o of saved.views) openView(Object.assign({}, o, { restore: true })); focusView(MAIN); }
    if (ok) syncStages();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { render(); fitIfLarge(); });
    setTimeout(fitIfLarge, 0);
    // ?url=…: opens the given program; then the parameter is removed from the address bar,
    // so reloading the page the work is found again (saved automatically) and not the original file
    let q = null;
    try { const sp = new URLSearchParams(location.search); q = sp.get('url') || sp.get('fprg'); } catch (e) { q = null; }
    if (q) openUrl(q, ok).then((done) => {
      if (!done) return;
      startView(); render();
      try { const u = new URL(location.href); u.searchParams.delete('url'); u.searchParams.delete('fprg'); history.replaceState(null, '', u.href); } catch (e) { /* ignore */ }
    });
    // minimal API for the automatic tests
    window.FlowLab = { openStage, get stage() { return stageMod; }, get state() { return st; }, run, loadText, serialize: () => M.serializeFprg(st.prog), render, setTab, submitInput, setView, showUml, showFunc, openView, get views() { return views; }, focusView, openUrl, rawUrl, loadExample: (id) => { st.dirty = false; loadExample(id); } };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
