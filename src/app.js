/* ==========================================================================
   FlowLab — applicazione (interfaccia, editor, esecuzione)
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
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem('flowlab:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('flowlab:' + k, JSON.stringify(v)); } catch (e) { /* archiviazione non disponibile */ } },
  };
  const E = ExprLib, M = ModelLib;
  const TYPE_IT = E.TYPE_IT;

  /* ------------------------------ Stato --------------------------------- */
  const st = {
    prog: null, fi: 0, sel: null, clip: null, undo: [], redo: [], dirty: false,
    zoom: store.get('zoom', 1), speed: store.get('speed', 2), lang: store.get('lang', 'python'), tab: store.get('tab', 'console'),
    fileName: null, ins: [], expanded: new Set(), modCollapsed: new Set(store.get('modCollapsed', [])), varsOpen: new Set(), vfs: new Map(Object.entries(store.get('vfs', {}))),
    // vista Funzioni o Oggetti; nella vista Oggetti il foglio mostra il diagramma delle classi (uml) o un metodo
    view: store.get('view', 'functions') === 'objects' ? 'objects' : 'functions', uml: true, usel: null,
  };
  const SPEEDS = [{ ms: 0, label: 'Istantanea' }, { ms: 40, label: 'Veloce' }, { ms: 280, label: 'Media' }, { ms: 750, label: 'Lenta' }];
  const renderer = new RenderLib.Renderer();

  /* ------------------------------ Utilità -------------------------------- */
  let toastTimer = null;
  function toast(msg, kind) {
    const t = $('#toast');
    t.textContent = msg; t.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = 'toast'; }, 3200);
  }
  const func = () => st.prog.functions[st.fi];
  const isOO = () => st.view === 'objects';
  const isUml = () => isOO() && st.uml;
  /* nome mostrato: Inizio per Main, Classe.metodo e new Classe nella vista Oggetti */
  const fname = (f) => {
    if (!f) return '';
    if (f.name.toLowerCase() === 'main' && !f.ctor) return 'Inizio';
    const c = f.cls && M.classOf(st.prog, f);
    if (!c) return f.name;
    return f.ctor ? 'new ' + c.name : c.name + '.' + f.name;
  };
  const tplTxt = (f) => ((f.tparams || []).length ? `<${f.tparams.join(', ')}>` : '');
  const isRunning = () => ['running', 'paused', 'input'].includes(run.state);

  function snapshot() { return JSON.stringify({ prog: st.prog, fi: st.fi }); }
  function mutate(fn) {
    if (isRunning()) { toast('Ferma il programma per modificare il diagramma', 'warn'); return false; }
    st.undo.push(snapshot()); if (st.undo.length > 150) st.undo.shift();
    st.redo = [];
    fn();
    st.dirty = true;
    render();
    return true;
  }
  function restore(json) {
    const s = JSON.parse(json);
    st.prog = s.prog; st.fi = Math.min(s.fi, st.prog.functions.length - 1);
    st.sel = null;
    if (st.usel && !M.classById(st.prog, st.usel.cls)) st.usel = null;
    render();
  }
  function undo() { if (isRunning() || !st.undo.length) return; st.redo.push(snapshot()); restore(st.undo.pop()); st.dirty = true; }
  function redo() { if (isRunning() || !st.redo.length) return; st.undo.push(snapshot()); restore(st.redo.pop()); st.dirty = true; }

  function declaredNames(f) {
    const out = [];
    for (const p of f.params) out.push(p.name);
    M.walk(f.body, (s) => { if (s.kind === 'declare' || s.kind === 'const') s.name.split(',').map((x) => x.trim()).filter(Boolean).forEach((n) => out.push(n)); });
    // nella vista Oggetti anche gli attributi della classe (e di quelle madri, se non privati)
    const c = isOO() && M.classOf(st.prog, f);
    if (c) {
      M.chainOf(st.prog, c).forEach((k, i) => k.attributes.forEach((a) => { if ((i === 0 || a.visibility !== 'private') && (a.static || !f.static)) out.push(a.name); }));
      if (!f.static) out.push('this');
    }
    return [...new Set(out)];
  }
  /* scelta di un tipo: un menu con i tipi base, i Tipi Generici (T) e le classi; per una
     classe con Tipi Generici (Nodo<S, T>) accanto compaiono i menu dei suoi tipi, anche annidati.
     ctx: { gens: [T, S…], allowNew, taken() } oppure la classe in cui si usa il tipo;
     con allowNew c'è la voce «Nuovo Tipo Generico», che assegna un nome libero (T, S, V…).
     onChange(tipo) a ogni cambiamento */
  const NEW_GEN = '\u0000nuovo';
  function typePicker(value, ctx, onChange, aria) {
    const el = h('span', { class: 'tpick' });
    const sel = h('select', { 'aria-label': aria || 'Tipo' });
    const sub = h('span', { class: 'tpargs' });
    const cs = M.hasClasses(st.prog) ? st.prog.classes : [];
    const tps = ctx ? ctx.gens || ctx.tparams || [] : [];
    const genOpt = (t) => h('option', { value: t, class: 'genopt' }, `${t} (Tipo Generico)`);
    const opts = [...E.TYPES.map((t) => [t, TYPE_IT[t]]), ...tps.map((t) => [t, `${t} (Tipo Generico)`]), ...(ctx && ctx.allowNew ? [[NEW_GEN, 'Nuovo Tipo Generico']] : []), ...cs.map((c) => [c.name, `${M.classTitle(c)} (${c.module ? 'modulo' : 'classe'})`])];
    // i menu dello stesso dialogo vedono subito i Tipi Generici appena creati
    if (ctx && typeof ctx === 'object' && !ctx.id) (ctx._sels = ctx._sels || new Set()).add(sel);
    const genOf = (b) => { const c = M.classByName(st.prog, b); return c && (c.tparams || []).length ? c : null; };
    let kids = [];
    const get = () => { const c = genOf(sel.value); return c ? E.joinType(c.name, kids.map((k) => k.get())) : sel.value; };
    const fire = () => { if (onChange) onChange(get()); };
    const drawArgs = (args) => {
      sub.innerHTML = ''; kids = [];
      const c = genOf(sel.value); if (!c) return;
      c.tparams.forEach((p, i) => {
        const k = typePicker(args[i] || 'Integer', ctx, fire, `${aria || 'Tipo'}: ${p} di ${c.name}`);
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
    sel.append(...opts.map(([v, l]) => h('option', { value: v, class: v === NEW_GEN ? 'newgen' : null }, l)));
    sel.addEventListener('change', () => {
      if (sel.value === NEW_GEN) {
        const taken = new Set([...(ctx.taken ? ctx.taken() : []), ...tps].map((x) => x.toLowerCase()));
        const nm = nextGenName(taken);
        for (const x of ctx._sels || [sel]) {
          if (![...x.options].some((o) => o.value === nm)) { const nw = [...x.options].find((o) => o.value === NEW_GEN); const o = genOpt(nm); if (nw) x.insertBefore(o, nw); else { const firstCls = [...x.options].find((o2) => /\((classe|modulo)\)$/.test(o2.textContent)); x.insertBefore(o, firstCls || null); } }
        }
        sel.value = nm;
        toast(`Nuovo Tipo Generico: ${nm}`);
      }
      drawArgs([]); fire();
    });
    el.append(sel, sub);
    set(value);
    return { el, sel, get, set, setDisabled(d) { el.querySelectorAll('select').forEach((x) => { x.disabled = d; }); } };
  }
  /* ---- Tipi Generici: FlowLab dà i nomi (T, S, V…) e li ricava da dove si usano ----
     in un attributo, in un costruttore o in un metodo non statico appartengono alla classe (Coppia<T>);
     in una funzione o in un metodo statico alla funzione (massimo<T>) */
  const GEN_NAMES = ['T', 'S', 'V', 'U', 'W', 'K', 'E', 'R'];
  function nextGenName(taken) {
    const free = (n) => !taken.has(n.toLowerCase()) && !M.classByName(st.prog, n);
    for (const n of GEN_NAMES) if (free(n)) return n;
    let i = 1; while (!free('T' + i)) i++; return 'T' + i;
  }
  /* nomi dei Tipi Generici che compaiono nei tipi (known: quelli già noti, anche con nomi lunghi) */
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
  /* l'ordine dei Tipi Generici già presenti resta (Coppia<K, V>): i nuovi vanno in fondo */
  const orderGen = (old, used) => [...(old || []).filter((t) => used.some((u) => u.toLowerCase() === t.toLowerCase())), ...used.filter((u) => !(old || []).some((t) => t.toLowerCase() === u.toLowerCase()))];
  /* tipi che rendono generica una classe: attributi d'istanza, costruttori, metodi non statici (tranne skip) */
  function classTypes(c, skip) {
    const out = [];
    for (const a of c.attributes) if (a !== skip && !a.static) out.push(a.type);
    for (const f of M.membersOf(st.prog, c)) if (f !== skip && (f.ctor || !f.static)) out.push(...f.params.map((p) => p.type), ...M.rets(f).map((r) => r.type));
    return out;
  }
  /* Tipi Generici della classe se si aggiungono quei tipi (null se non cambiano); errore se il cambio non si può fare */
  function classGenChange(c, skip, extra) {
    const nu = orderGen(c.tparams, genNamesIn([...classTypes(c, skip), ...extra], c.tparams));
    if (nu.join(',') === (c.tparams || []).join(',')) return { nu: null };
    const added = nu.filter((t) => !(c.tparams || []).includes(t)), gone = (c.tparams || []).filter((t) => !nu.includes(t));
    const what = [added.length ? `si aggiungerebbe il Tipo Generico ${added.join(', ')}` : '', gone.length ? `si toglierebbe il Tipo Generico ${gone.join(', ')}` : ''].filter(Boolean).join(' e ') || 'cambierebbe l\'ordine dei Tipi Generici';
    if (nu.length && c === M.mainClass(st.prog)) return { err: `${c.name} è la classe principale: non può avere Tipi Generici. Usa un metodo statico (il Tipo Generico è suo) oppure un'altra classe` };
    if (nu.length && c.parent) return { err: `${c.name} eredita da ${c.parent}: in FlowLab una classe con Tipi Generici non può ereditare da un'altra classe` };
    if (nu.length && st.prog.classes.some((k) => (k.parent || '').toLowerCase() === c.name.toLowerCase())) return { err: `${c.name} ha delle sottoclassi: in FlowLab una classe con Tipi Generici non può essere una classe madre` };
    if (classUsed(c)) return { err: `${c.name} è già usata nel programma: ${what} (${M.classTitle(c)} → ${nu.length ? `${c.name}<${nu.join(', ')}>` : c.name}). Togli prima le variabili e gli attributi di tipo ${c.name}` };
    return { nu };
  }
  /* Tipi Generici che si possono usare in una funzione: quelli della classe (metodi non statici, costruttori) o quelli suoi */
  function typeCtx(f) {
    const c = f && M.hasClasses(st.prog) ? M.classOf(st.prog, f) : null;
    const gens = c && (f.ctor || !f.static) ? c.tparams || [] : (f && f.tparams) || [];
    return gens.length ? { gens } : c;
  }
  /* ---- moduli: le loro classi sono in sola lettura ---- */
  function roGuard(c) {
    if (c === undefined) {
      // funzione o metodo aperto: viene da un modulo?
      if (isUml()) return false;
      const f = func(), m = M.moduleOfFunc(st.prog, f);
      if (m) { toast(`${f.module ? f.name + '()' : M.classOf(st.prog, f).name} fa parte del modulo ${m.name}: è in sola lettura`, 'warn'); return true; }
      return false;
    }
    if (c && c.module) { toast(`${c.name} fa parte del modulo ${c.module.name}: è in sola lettura`, 'warn'); return true; }
    return false;
  }
  /* funzione importata da un modulo di sole funzioni */
  function roFunc(f) { if (f && f.module) { toast(`${f.name}() fa parte del modulo ${f.module.name}: è in sola lettura`, 'warn'); return true; } return false; }
  /* tipo di una cella con i parametri di tipo sostituiti (T -> Intero per un ArrayList<Intero>) */
  function cellT(c) { return run.interp && run.interp.cellType ? run.interp.cellType(c) : c.type; }

  /* ----------------------------- Viste ----------------------------------- */
  /* il programma deve corrispondere alla vista: classe predefinita nella vista Oggetti */
  function ensureView() {
    if (isOO() && !M.hasClasses(st.prog)) M.wrapInClass(st.prog);
    if (!isOO() && M.hasClasses(st.prog)) {
      if (M.isTrivialOO(st.prog)) M.unwrapClasses(st.prog);
      else { st.view = 'objects'; store.set('view', 'objects'); }
    }
  }
  function infoBox(title, text) { openModal({ title, body: h('p', { class: 'confirm' }, text), okText: 'Ho capito', noCancel: true }); }
  function setView(v) {
    if (v === st.view) { if (v === 'objects' && !st.uml) showUml(); return; }
    if (isRunning()) { toast('Ferma il programma per cambiare vista', 'warn'); return; }
    if (v === 'functions' && M.hasClasses(st.prog)) {
      const cs = st.prog.classes;
      if (cs.length > 1) {
        infoBox('Vista funzioni non disponibile', `Non puoi aprire la vista funzioni perché c'è più di una classe (${cs.map((c) => c.name).join(', ')}). La vista funzioni è disponibile solo finché il programma ha una sola classe.`);
        return;
      }
      if (!M.isTrivialOO(st.prog)) {
        const c = cs[0], ms = M.membersOf(st.prog, c), why = [];
        if (c.attributes.length) why.push('attributi');
        if (ms.some((f) => f.ctor)) why.push('costruttori');
        if (ms.some((f) => !f.ctor && !f.static)) why.push('metodi non statici');
        if (ms.some((f) => (f.visibility || 'public') !== 'public')) why.push('metodi privati o protetti');
        infoBox('Vista funzioni non disponibile', `La classe ${c.name} ha ${why.join(', ')}: nella vista funzioni ci sono solo funzioni. Per tornare alla vista funzioni la classe deve contenere solo metodi statici e pubblici.`);
        return;
      }
      M.unwrapClasses(st.prog);
    }
    st.view = v; store.set('view', v);
    st.sel = null; st.usel = null;
    st.uml = v === 'objects';
    if (v === 'objects') ensureView();
    render();
    $('#canvasWrap').scrollTo(0, 0);
  }
  function renderViewSwitch() {
    $('#viewFn').setAttribute('aria-checked', String(!isOO()));
    $('#viewOo').setAttribute('aria-checked', String(isOO()));
    document.body.classList.toggle('oo', isOO());
    document.body.classList.toggle('umlmode', isUml());
    $('.hint-add').textContent = isUml() ? 'Doppio clic su un metodo per disegnarlo · clic destro su una classe per aggiungere membri · trascina le classi per spostarle' : 'Clic su una freccia per aggiungere un blocco · doppio clic per modificarlo · trascina per spostarlo';
    const bar = $('#crumbBar');
    const fmod = !isUml() && func().module;
    bar.hidden = (!isOO() || st.uml) && !fmod;
    $('#backUml').hidden = !isOO();
    if (!bar.hidden) {
      const f = func(); const c = isOO() ? M.classOf(st.prog, f) : null; const m = M.moduleOfFunc(st.prog, f);
      $('#crumbWhere').textContent = isOO() ? `${c ? M.classTitle(c) : ''} › ${f === st.prog.functions[0] ? 'Main (inizio del programma)' : f.ctor ? 'costruttore' : f.name + '()'}${m ? ` · modulo ${m.name}, sola lettura` : ''}` : `${f.name}() · modulo ${m.name}, sola lettura`;
    }
    document.body.classList.toggle('readonly', !bar.hidden && M.isModuleFunc(st.prog, func()));
    const mods = isUml() ? M.modulesOf(st.prog).filter((m) => m.classes.length) : [];
    $('#modBar').hidden = !mods.length;
    document.body.classList.toggle('hasmods', !!mods.length);
    if (mods.length) { const anyOpen = mods.some((m) => !st.modCollapsed.has(m.name)); $('#modToggle').textContent = anyOpen ? '⊟ Condensa i moduli' : '⊞ Espandi i moduli'; $('#modToggle').title = (anyOpen ? 'Mostra i moduli importati come riquadri compatti, con i soli nomi delle classi' : 'Mostra attributi e metodi delle classi dei moduli importati') + ' (Maiusc+M)'; }
  }
  /* metodo astratto: niente diagramma di flusso, solo le versioni delle sottoclassi */
  function abstractCard(f) {
    st.ins = []; st.edges = [];
    const c = M.classOf(st.prog, f);
    const sig = (g) => g.params.map((p) => p.type.toLowerCase() + (p.array ? '[' + (p.dims || 1) : '')).join(',');
    const impls = st.prog.functions.filter((g) => g !== f && !g.ctor && !g.abstract && g.name.toLowerCase() === f.name.toLowerCase() && sig(g) === sig(f) && M.isSubclass(st.prog, M.classOf(st.prog, g), c));
    const card = h('div', { class: 'abscard', role: 'note' },
      h('div', { class: 'tag' }, 'metodo astratto'),
      h('h3', null, UmlLib.methodText(st.prog, f)),
      h('p', null, `In ${c.name} questo metodo non ha un corpo: ogni sottoclasse concreta lo deve definire. Quando il programma lo chiama, viene eseguita la versione della classe dell'oggetto.`),
      impls.length ? h('p', { class: 'muted small' }, 'Definito in:') : h('p', { class: 'muted small' }, 'Nessuna sottoclasse lo definisce ancora: aggiungi il metodo con lo stesso nome e gli stessi parametri in una sottoclasse.'),
      h('div', { class: 'impls' },
        ...impls.map((g) => h('button', { class: 'btn small', type: 'button', onclick: () => showFunc(st.prog.functions.indexOf(g)) }, `${M.classOf(st.prog, g).name}.${g.name}()`)),
        h('button', { class: 'btn small', type: 'button', onclick: () => { if (!isRunning()) editFunction(st.prog.functions.indexOf(f)); } }, 'Modifica il metodo…')));
    const holder = $('#chart'); holder.innerHTML = ''; holder.append(card);
  }
  function showUml() { st.uml = true; st.sel = null; render(); $('#canvasWrap').scrollTo(0, 0); }
  /* moduli condensati nel diagramma delle classi (si ricordano per nome) */
  function toggleModule(name) {
    if (st.modCollapsed.has(name)) st.modCollapsed.delete(name); else st.modCollapsed.add(name);
    store.set('modCollapsed', [...st.modCollapsed]); render();
  }
  function toggleAllModules() {
    const ms = M.modulesOf(st.prog).filter((m) => m.classes.length).map((m) => m.name);
    const anyOpen = ms.some((n) => !st.modCollapsed.has(n));
    for (const n of ms) { if (anyOpen) st.modCollapsed.add(n); else st.modCollapsed.delete(n); }
    store.set('modCollapsed', [...st.modCollapsed]); render();
  }

  /* --------------------------- Disegno ----------------------------------- */
  let codeTimer = null;
  function render() {
    ensureView();
    const holder = $('#chart');
    if (isUml()) {
      const out = UmlLib.render(st.prog, st.usel, { collapsed: st.modCollapsed });
      st.ins = []; st.edges = [];
      holder.innerHTML = out.svg;
      applyZoom();
    } else if (isOO() && func().abstract) {
      abstractCard(func());
    } else {
      const f = func();
      const c = isOO() ? M.classOf(st.prog, f) : null;
      // un diagramma appena aperto è sempre esteso
      if (st.compactFid !== f.id) { st.compact = false; st.compactFid = f.id; }
      const out = renderer.func(f, st.expanded, Object.assign(isOO() ? { owner: c ? c.name : '', isMain: st.fi === 0 } : {}, { compact: !!st.compact }));
      st.ins = out.ins;
      st.edges = out.edges;
      holder.innerHTML = out.svg;
      applyZoom();
      decorate();
    }
    syncCompactBtn();
    renderFuncSelect();
    renderViewSwitch();
    $('#undoBtn').disabled = !st.undo.length;
    $('#redoBtn').disabled = !st.redo.length;
    $('#progName').textContent = st.prog.attrs.name || 'Programma senza nome';
    clearTimeout(codeTimer); codeTimer = setTimeout(() => { renderCode(); autosave(); }, 120);
  }
  /* vista compatta: solo per i diagrammi di flusso; l'esportazione è sempre estesa */
  function syncCompactBtn() {
    const b = $('#compactBtn'); if (!b) return;
    b.hidden = isUml() || (isOO() && func().abstract);
    const on = !!st.compact && !b.hidden;
    b.setAttribute('aria-pressed', String(on));
    b.querySelector('.lbl').textContent = on ? 'Estendi' : 'Compatta';
    b.title = on ? 'Vista estesa: frecce tra tutti i blocchi (Maiusc+K)' : 'Vista compatta: i blocchi in sequenza si toccano (Maiusc+K)';
  }
  function toggleCompact() {
    if (isUml() || (isOO() && func().abstract)) return;
    st.compact = !st.compact; st.compactFid = func().id;
    render();
  }
  function decorate() {
    // durante il tragitto del cursore resta acceso il blocco di partenza
    const litId = run.hold ? run.holdFrom : run.curId;
    $$('#chart .shape').forEach((g) => {
      const id = g.dataset.id;
      g.classList.toggle('sel', id === st.sel);
      // il blocco si illumina solo quando il cursore lo ha raggiunto
      g.classList.toggle('exec', id === litId && run.state !== 'idle' && run.state !== 'done');
      g.classList.toggle('err', id === run.errId);
    });
  }
  function applyZoom() {
    const svg = $('#chart svg'); if (!svg) return;
    svg.setAttribute('width', Math.round(svg.dataset.w * st.zoom));
    svg.setAttribute('height', Math.round(svg.dataset.h * st.zoom));
    $('#zoomVal').textContent = Math.round(st.zoom * 100) + '%';
  }
  function setZoom(z) { st.zoom = Math.max(0.3, Math.min(2.5, Math.round(z * 100) / 100)); store.set('zoom', st.zoom); applyZoom(); }
  function fitZoom() {
    const svg = $('#chart svg'); const wrap = $('#canvasWrap');
    if (!svg) return;
    const z = Math.min((wrap.clientWidth - 24) / svg.dataset.w, (wrap.clientHeight - 24) / svg.dataset.h, 1.4);
    setZoom(Math.max(0.3, z));
  }
  function renderFuncSelect() {
    const sel = $('#funcSel');
    sel.innerHTML = '';
    const add = $('#funcAdd'), edit = $('#funcEdit'), del = $('#funcDel');
    if (isOO()) {
      // diagramma delle classi e, per ogni classe, costruttori e metodi
      $('#funcLbl').textContent = 'Diagramma';
      sel.append(h('option', { value: 'uml', selected: st.uml }, '▦ Classi (UML)'));
      for (const c of st.prog.classes) {
        const og = h('optgroup', { label: 'Classe ' + M.classTitle(c) + (c.module ? ` · modulo ${c.module.name}` : '') });
        const ms = M.membersOf(st.prog, c);
        for (const f of [...ms.filter((x) => x.ctor), ...ms.filter((x) => !x.ctor)]) {
          const i = st.prog.functions.indexOf(f);
          og.append(h('option', { value: i, selected: !st.uml && i === st.fi }, i === 0 ? 'Inizio (principale)' : f.ctor ? `new ${c.name}(${f.params.map((p) => p.name).join(', ')}) · costruttore` : `${f.name}${tplTxt(f)}(${f.params.map((p) => p.name).join(', ')})${f.abstract ? ' · astratto' : ''}${f.module ? ' · modulo ' + f.module.name : ''}`));
        }
        sel.append(og);
      }
      const cur = !st.uml && M.classOf(st.prog, func());
      add.title = (st.uml ? 'Nuova classe' : `Nuovo metodo nella classe ${cur ? cur.name : ''}`) + ' (N)';
      edit.title = (st.uml ? 'Modifica l\'elemento selezionato nel diagramma' : 'Modifica il metodo') + ' (F2)';
      del.title = st.uml ? 'Elimina l\'elemento selezionato nel diagramma (Canc)' : 'Elimina il metodo (Maiusc+Canc)';
      del.disabled = st.uml ? !st.usel : st.fi === 0;
      edit.disabled = st.uml && !st.usel;
      return;
    }
    $('#funcLbl').textContent = 'Funzione';
    add.title = 'Nuova funzione (N)'; edit.title = 'Modifica funzione o proprietà del programma (F2)'; del.title = 'Elimina funzione (Maiusc+Canc)';
    edit.disabled = false;
    st.prog.functions.forEach((f, i) => sel.append(h('option', { value: i, selected: i === st.fi }, i === 0 ? 'Inizio (principale)' : `${f.name}${tplTxt(f)}(${f.params.map((p) => p.name).join(', ')})${f.module ? ' · modulo ' + f.module.name : ''}`)));
    del.disabled = st.fi === 0;
  }
  function showFunc(i) { if (i === st.fi && !st.uml) return; st.fi = i; st.uml = false; st.sel = null; render(); $('#canvasWrap').scrollTo(0, 0); }

  function autosave() {
    try { store.set('autosave', { xml: M.serializeFprg(st.prog), fi: st.fi, fileName: st.fileName }); } catch (e) { /* ignora */ }
  }

  /* ------------------------ Mini icone delle forme ------------------------ */
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
  };
  const CAT = { declare: 'decl', const: 'decl', assign: 'assign', input: 'in', output: 'out', if: 'cond', while: 'loop', for: 'loop', do: 'loop', call: 'call', comment: 'comment', breakpoint: 'brk', open: 'file', close: 'file', read: 'file', write: 'file' };
  const icon = (k) => `<svg class="mini c-${CAT[k]}" viewBox="0 0 32 26" aria-hidden="true">${ICON[k]}</svg>`;

  const GROUPS = [
    ['Base', ['declare', 'const', 'assign', 'input', 'output', 'call']],
    ['Controllo', ['if', 'while', 'for', 'do']],
    ['Altro', ['comment', 'breakpoint']],
    ['File', ['open', 'read', 'write', 'close']],
  ];

  /* tasti per aggiungere i blocchi: dopo il blocco selezionato, o in fondo al diagramma */
  const KIND_KEY = {
    declare: 'D', const: 'K', assign: 'A', input: 'I', output: 'O', call: 'C',
    if: 'S', while: 'M', for: 'P', do: 'F', comment: '/', breakpoint: 'B',
    open: 'Maiusc+A', read: 'Maiusc+L', write: 'Maiusc+S', close: 'Maiusc+C',
  };
  const KEY_KIND = Object.fromEntries(Object.entries(KIND_KEY).map(([k, v]) => [v, k]));
  /* il tasto premuto scritto come in KIND_KEY (lettera, con Maiusc+ davanti) */
  function keyLabel(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return null;
    if (e.key === '/') return '/';
    if (!/^Key[A-Z]$/.test(e.code)) return null;
    return (e.shiftKey ? 'Maiusc+' : '') + e.code.slice(3);
  }

  /* ------------------------------ Popover -------------------------------- */
  function closePop() { $('#pop').hidden = true; $('#pop').innerHTML = ''; }
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
    box._target = target; // per scegliere il blocco con la tastiera
    box.append(h('div', { class: 'pophead' }, 'Aggiungi un blocco'));
    for (const [g, kinds] of GROUPS) {
      const row = h('div', { class: 'insgroup' }, h('div', { class: 'glabel' }, g));
      const grid = h('div', { class: 'insgrid' });
      for (const k of kinds) {
        grid.append(h('button', { class: 'insbtn', type: 'button', role: 'menuitem', title: RenderLib.KIND_IT[k], onclick: () => { closePop(); addStmt(target, k); } },
          h('span', { html: icon(k) }), h('span', { class: 'ilabel' }, RenderLib.KIND_IT[k]), h('kbd', { class: 'ikey' }, KIND_KEY[k])));
      }
      row.append(grid); box.append(row);
    }
    if (st.clip) box.append(h('button', { class: 'pastebtn', type: 'button', onclick: () => { closePop(); paste(target); } }, `Incolla qui (${RenderLib.KIND_IT[st.clip.kind]})  ·  Ctrl+V`));
    openPop(x, y, box);
  }
  function shapeMenu(id, x, y) {
    if (id.startsWith('start:') || id.startsWith('end:')) {
      const box = h('div', { class: 'ctxmenu' },
        h('button', { type: 'button', onclick: () => { closePop(); st.fi === 0 ? editProgram() : editFunction(st.fi); } }, h('span', null, st.fi === 0 ? 'Proprietà del programma…' : isOO() ? 'Modifica il metodo…' : 'Modifica la funzione…'), h('kbd', null, 'F2')));
      openPop(x, y, box); return;
    }
    const box = h('div', { class: 'ctxmenu' },
      h('button', { type: 'button', onclick: () => { closePop(); editStmt(id); } }, h('span', null, 'Modifica…'), h('kbd', null, 'Invio')),
      h('button', { type: 'button', onclick: () => { closePop(); copySel(false); } }, h('span', null, 'Copia'), h('kbd', null, 'Ctrl+C')),
      h('button', { type: 'button', onclick: () => { closePop(); copySel(true); } }, h('span', null, 'Taglia'), h('kbd', null, 'Ctrl+X')),
      st.clip ? h('button', { type: 'button', onclick: () => { closePop(); paste(); } }, h('span', null, 'Incolla dopo'), h('kbd', null, 'Ctrl+V')) : null,
      h('button', { type: 'button', onclick: () => { closePop(); duplicate(); } }, h('span', null, 'Duplica'), h('kbd', null, 'Ctrl+D')),
      h('hr'),
      h('button', { type: 'button', onclick: () => { closePop(); shiftSel(-1); } }, h('span', null, 'Sposta su'), h('kbd', null, 'Alt+↑')),
      h('button', { type: 'button', onclick: () => { closePop(); shiftSel(1); } }, h('span', null, 'Sposta giù'), h('kbd', null, 'Alt+↓')),
      h('hr'),
      h('button', { type: 'button', class: 'danger', onclick: () => { closePop(); deleteSel(); } }, h('span', null, 'Elimina'), h('kbd', null, 'Canc')));
    openPop(x, y, box);
  }

  /* ---------------------------- Modifiche -------------------------------- */
  function addStmt(target, kind) {
    const s = M.makeStmt(kind);
    if (isRunning()) { toast('Ferma il programma per modificare il diagramma', 'warn'); return; }
    if (roGuard()) return;
    stmtDialog(s, true, (vals) => mutate(() => { Object.assign(s, vals); target.arr.splice(target.idx, 0, s); st.sel = s.id; }));
  }
  function editStmt(id) {
    const f = M.findStmt(st.prog, id); if (!f) return;
    if (isRunning()) { toast('Ferma il programma per modificare il diagramma', 'warn'); return; }
    if (roGuard()) return;
    stmtDialog(f.stmt, false, (vals) => mutate(() => Object.assign(f.stmt, vals)));
  }
  function deleteSel() {
    if (!st.sel || roGuard()) return;
    const f = M.findStmt(st.prog, st.sel); if (!f) return;
    mutate(() => { f.arr.splice(f.index, 1); st.sel = f.arr[f.index] ? f.arr[f.index].id : (f.arr[f.index - 1] ? f.arr[f.index - 1].id : null); });
  }
  function copySel(cut) {
    if (!st.sel) return;
    const f = M.findStmt(st.prog, st.sel); if (!f) return;
    if (cut && roGuard()) return;
    st.clip = M.cloneStmt(f.stmt, true);
    if (cut) mutate(() => { f.arr.splice(f.index, 1); st.sel = null; });
    else toast('Blocco copiato: fai clic su una freccia e scegli «Incolla qui»');
  }
  function paste(target) {
    if (!st.clip || (!target && (isUml() || func().abstract)) || roGuard()) return;
    const c = M.cloneStmt(st.clip);
    if (!target) {
      const f = st.sel && M.findStmt(st.prog, st.sel);
      target = f ? { arr: f.arr, idx: f.index + 1 } : { arr: func().body, idx: func().body.length };
    }
    mutate(() => { target.arr.splice(target.idx, 0, c); st.sel = c.id; });
  }
  /* sposta il blocco selezionato di un posto (dir -1 su, +1 giù) nella stessa sequenza */
  function shiftSel(dir) {
    if (!st.sel || roGuard()) return;
    if (isRunning()) { toast('Ferma il programma per modificare il diagramma', 'warn'); return; }
    const f = M.findStmt(st.prog, st.sel); if (!f) return;
    const j = f.index + dir; if (j < 0 || j >= f.arr.length) return;
    mutate(() => { f.arr.splice(f.index, 1); f.arr.splice(j, 0, f.stmt); });
  }
  /* nuovo blocco dalla tastiera: dopo il blocco selezionato o in fondo al diagramma */
  function addByKey(kind) {
    if (isUml() || func().abstract) return;
    const f = st.sel && M.findStmt(st.prog, st.sel);
    addStmt(f ? { arr: f.arr, idx: f.index + 1 } : { arr: func().body, idx: func().body.length }, kind);
  }
  function duplicate() {
    if (!st.sel || roGuard()) return;
    const f = M.findStmt(st.prog, st.sel); if (!f) return;
    const c = M.cloneStmt(f.stmt);
    mutate(() => { f.arr.splice(f.index + 1, 0, c); st.sel = c.id; });
  }
  function containsArr(stmt, arr) {
    let found = false;
    const visit = (s) => { for (const b of M.KINDS[s.kind].blocks || []) { if (s[b] === arr) found = true; s[b].forEach(visit); } };
    visit(stmt);
    return found;
  }
  function moveStmt(id, target) {
    const f = M.findStmt(st.prog, id); if (!f || roGuard()) return;
    if (containsArr(f.stmt, target.arr)) { toast('Non puoi spostare un blocco dentro se stesso', 'warn'); return; }
    let idx = target.idx;
    if (target.arr === f.arr && f.index < idx) idx--;
    if (target.arr === f.arr && idx === f.index) return;
    mutate(() => { f.arr.splice(f.index, 1); target.arr.splice(idx, 0, f.stmt); st.sel = id; });
  }

  /* ------------------------------ Dialoghi ------------------------------- */
  const modalStack = [];
  function openModal({ title, body, okText, onOk, wide, cancelText, danger, noCancel }) {
    const back = h('div', { class: 'modal-back' });
    const err = h('div', { class: 'formerr', role: 'alert' });
    const ok = h('button', { class: 'btn primary' + (danger ? ' danger' : ''), type: 'button' }, okText || 'OK');
    const form = h('form', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('header', null, h('h2', null, title), h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Chiudi', onclick: () => close() }, '✕')),
      h('div', { class: 'modal-body' }, body),
      err,
      h('footer', null, noCancel ? null : h('button', { class: 'btn', type: 'button', onclick: () => close() }, cancelText || 'Annulla'), ok));
    back.append(form);
    const submit = () => {
      if (!onOk) { close(); return; }
      const r = onOk();
      if (typeof r === 'string') { err.textContent = r; return; }
      if (r !== false) close();
    };
    // gestione diretta di clic e Invio: nelle pagine in sandbox l'evento submit non arriva
    form.addEventListener('submit', (e) => e.preventDefault());
    ok.addEventListener('click', submit);
    form.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing || e.shiftKey) return;
      const t = e.target;
      if (t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.tagName === 'SELECT') return;
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

  /* Campi */
  /* ---- autocompletamento dopo il punto: metodi e attributi dell'oggetto (o della classe) ---- */
  /* testo prima del cursore -> { from, typed, items } oppure null */
  function memberSuggestions(before, lvalueOnly) {
    if (!M.hasClasses(st.prog) || isUml()) return null;
    const mm = /\.([\p{L}_][\p{L}\p{N}_]*)?$/u.exec(before);
    if (!mm) return null;
    const dot = mm.index, typed = mm[1] || '';
    // espressione a sinistra del punto: nomi, punti e parentesi bilanciate (es. lista.get(0).nome)
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
    // NomeClasse. -> membri statici; oggetto. -> membri d'istanza
    let c = null, statics = false, map = null;
    if (node.k === 'var' && !node.indices && !sc.vars.has(node.name.toLowerCase()) && !(sc.implicitField && sc.implicitField(node.name)) && M.classByName(st.prog, node.name)) { c = M.classByName(st.prog, node.name); statics = true; }
    else {
      let t; try { t = E.inferType(node, sc); } catch (e) { return null; }
      const g = E.splitType(t);
      c = M.classByName(st.prog, g.base);
      if (c && (c.tparams || []).length && g.args.length) { map = {}; c.tparams.forEach((p, k) => { map[p.toLowerCase()] = g.args[k]; }); }
    }
    if (!c) return null;
    const T = (x) => E.typeName(map ? E.substType(x, map) : x);
    const canSee = (vis, owner) => (vis || 'public') === 'public' || (vis === 'private' ? here === owner : !!here && M.isSubclass(st.prog, here, owner));
    const items = [], seen = new Set();
    for (const k of M.chainOf(st.prog, c)) {
      for (const a of k.attributes) {
        if (!!a.static !== statics || !canSee(a.visibility, k) || seen.has('a:' + a.name.toLowerCase())) continue;
        seen.add('a:' + a.name.toLowerCase());
        items.push({ kind: 'a', name: a.name, label: `${a.name}: ${T(a.type)}${a.array ? '[]' : ''}`, insert: a.name, owner: k });
      }
      if (lvalueOnly) continue;
      for (const m of M.membersOf(st.prog, k)) {
        if (m.ctor || m === st.prog.functions[0] || !!m.static !== statics || !canSee(m.visibility, k)) continue;
        const sig = m.name.toLowerCase() + '(' + m.params.map((p) => p.type.toLowerCase()).join(',');
        if (seen.has(sig)) continue; // ridefinito in una sottoclasse
        seen.add(sig);
        const rl = M.rets(m);
        items.push({ kind: 'm', name: m.name, label: `${m.name}(${m.params.map((p) => `${p.name}: ${T(p.type)}${p.array ? '[]' : ''}`).join(', ')})${rl.length ? ': ' + rl.map((r) => T(r.type) + (r.array ? '[]' : '')).join(', ') : ''}`, insert: m.name + (m.params.length ? '(' : '()'), owner: k });
      }
    }
    const lo = typed.toLowerCase();
    const list = items.filter((x) => x.name.toLowerCase().startsWith(lo)).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'm' ? -1 : 1) || a.name.localeCompare(b.name));
    // attributo già scritto per intero: niente elenco, così Invio conferma il dialogo
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
    pop.append(h('div', { class: 'achead' }, `${sug.statics ? 'Statici di' : 'Membri di'} ${M.classTitle(sug.cls)}${sug.cls.module ? ' · modulo ' + sug.cls.module.name : ''}`));
    sug.items.slice(0, 40).forEach((it, k) => pop.append(h('div', { class: 'acitem' + (k === acCur.sel ? ' sel' : ''), role: 'option', 'aria-selected': String(k === acCur.sel),
      onmousedown: (e) => { e.preventDefault(); acCur.sel = k; acApply(); } },
      h('span', { class: 'ackind ' + it.kind }, it.kind === 'm' ? 'm' : 'a'), h('span', { class: 'aclabel' }, it.label),
      it.owner !== sug.cls ? h('span', { class: 'acowner' }, 'da ' + it.owner.name) : null)));
    pop.append(h('div', { class: 'acfoot' }, '↑ ↓ per scegliere · Invio o Tab per inserire · Esc per chiudere'));
    // sotto il cursore nel campo
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
  /* collega l'autocompletamento a un campo di testo */
  function attachMemberAC(input, lvalueOnly) {
    input.addEventListener('input', () => acUpdate(input, lvalueOnly));
    input.addEventListener('click', () => acUpdate(input, lvalueOnly));
    input.addEventListener('blur', () => setTimeout(() => { if (acCur && acCur.input === input) acHide(); }, 120));
    input.addEventListener('keydown', (e) => {
      if (!acCur || acCur.input !== input) return;
      const n = acCur.sug.items.length;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); acCur.sel = (acCur.sel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; acShow(input, acCur.sug); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); acApply(); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); acHide(); }
    });
    input.addEventListener('keyup', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') acUpdate(input, lvalueOnly); });
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
    if (['expr', 'exprlist', 'lvalue', 'lvalues'].includes(spec.type) && vars && vars.length) {
      const chips = h('div', { class: 'chips', 'aria-label': 'Variabili disponibili' });
      vars.slice(0, 24).forEach((v) => chips.append(h('button', { type: 'button', class: 'chip', tabindex: '-1', onclick: () => {
        const s = input.selectionStart ?? input.value.length, e = input.selectionEnd ?? s;
        input.value = input.value.slice(0, s) + v + input.value.slice(e);
        input.focus(); input.setSelectionRange(s + v.length, s + v.length); input.dispatchEvent(new Event('input'));
      } }, v)));
      wrap.append(chips);
    }
    const check = () => {
      const v = input.value;
      let err = '';
      if (spec.required && !String(v).trim()) err = '';
      else if (String(v).trim()) {
        try {
          if (spec.type === 'expr') E.parseExpr(v);
          if (spec.type === 'exprlist') E.splitTop(v).forEach((x, i) => { if (!x) throw new Error(`manca la dimensione ${i + 1}`); E.parseExpr(x); });
          if (spec.type === 'lvalue') E.parseLValue(v);
          if (spec.type === 'lvalues') E.parseLValueList(v);
          if (spec.type === 'names') {
            for (const n of v.split(',').map((x) => x.trim())) {
              if (!n) throw new Error('Nome vuoto tra due virgole');
              if (!E.validIdent(n)) throw new Error(`"${n}" non è un nome valido: usa lettere, cifre e _ e inizia con una lettera`);
              if (E.RESERVED.has(n.toLowerCase())) throw new Error(`"${n}" è una parola riservata`);
            }
          }
          if (spec.type === 'ident') {
            if (!E.validIdent(v.trim())) throw new Error('Usa lettere, cifre e _ e inizia con una lettera');
            if (E.RESERVED.has(v.trim().toLowerCase())) throw new Error('È una parola riservata');
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
      if (spec.required && !String(input.value).trim()) return `Compila il campo «${spec.label}»`;
      return '';
    };
    wrap._input = input;
    return wrap;
  }

  const TYPE_OPTS = E.TYPES.map((t) => [t, TYPE_IT[t]]);
  const STMT_FORMS = {
    declare: { title: 'Dichiarazione', help: 'Crea una o più variabili. Separa i nomi con una virgola.', fields: [
      { key: 'name', label: 'Nomi delle variabili', type: 'names', required: true, placeholder: 'es. a, b, totale' },
      { key: 'type', label: 'Tipo', type: 'seg', options: TYPE_OPTS },
      { key: 'array', label: 'Array (elenco di valori con indice da 0)', type: 'check' },
      { key: 'size', label: 'Numero di elementi', type: 'exprlist', placeholder: 'es. 10   oppure   3, 4 per una matrice', hint: 'Per un array a più dimensioni separa le dimensioni con la virgola: 3, 4 è una matrice 3 × 4', showIf: 'array' },
      { key: 'init', label: 'Valore iniziale (facoltativo)', type: 'expr', placeholder: 'es. 0', hint: 'Con più nomi tutte le variabili partono da questo valore. Se resta vuoto, la variabile non ha un valore finché non le assegni qualcosa.', showIf: '!array' }] },
    const: { title: 'Costante', help: 'Un valore con un nome che non cambia durante il programma. Per convenzione si scrive in maiuscolo.', fields: [
      { key: 'name', label: 'Nome della costante', type: 'ident', required: true, placeholder: 'es. MAX' },
      { key: 'type', label: 'Tipo', type: 'seg', options: TYPE_OPTS },
      { key: 'expression', label: 'Valore', type: 'expr', required: true, placeholder: 'es. 100' }] },
    assign: { title: 'Assegnamento', help: 'Calcola l\'espressione e mette il risultato nella variabile.', fields: [
      { key: 'variable', label: 'Variabile', type: 'lvalues', required: true, placeholder: 'es. x  oppure  v[i]', hint: 'Per una funzione che restituisce più valori: più variabili separate da virgola, es. min, max ← MinMax(v)' },
      { key: 'expression', label: 'Espressione', type: 'expr', required: true, placeholder: 'es. x + 1' }] },
    input: { title: 'Input', help: 'Chiede un valore all\'utente durante l\'esecuzione.', fields: [
      { key: 'variable', label: 'Variabile da leggere', type: 'lvalue', required: true }] },
    output: { title: 'Output', help: 'Scrive un valore nella console. Unisci testi e numeri con &.', fields: [
      { key: 'expression', label: 'Espressione da scrivere', type: 'expr', required: true, placeholder: 'es. "Totale: " & totale' },
      { key: 'newline', label: 'Vai a capo dopo la scrittura', type: 'check' }] },
    if: { title: 'Se', help: 'Sceglie il ramo Vero o Falso in base alla condizione.', fields: [
      { key: 'expression', label: 'Condizione', type: 'expr', required: true, placeholder: 'es. eta >= 18' }] },
    while: { title: 'Mentre', help: 'Ripete il corpo finché la condizione è vera (controllo all\'inizio).', fields: [
      { key: 'expression', label: 'Condizione', type: 'expr', required: true, placeholder: 'es. i <= 10' }] },
    do: { title: 'Fai-mentre', help: 'Esegue il corpo almeno una volta e lo ripete finché la condizione è vera.', fields: [
      { key: 'expression', label: 'Condizione', type: 'expr', required: true, placeholder: 'es. risposta != 0' }] },
    for: { title: 'Per (ciclo con contatore)', help: 'La variabile va dal valore iniziale al finale, estremi compresi.', fields: [
      { key: 'variable', label: 'Variabile contatore', type: 'lvalue', required: true, placeholder: 'es. i' },
      { key: 'start', label: 'Valore iniziale', type: 'expr', required: true, inline: true },
      { key: 'end', label: 'Valore finale', type: 'expr', required: true, inline: true },
      { key: 'direction', label: 'Direzione', type: 'seg', options: [['inc', 'Crescente'], ['dec', 'Decrescente']] },
      { key: 'step', label: 'Passo', type: 'expr', required: true, inline: true }] },
    call: { title: 'Chiamata', help: 'Esegue una funzione definita nel programma. Con gli oggetti: p.sposta(1, 2), oppure super(...) all\'inizio di un costruttore.', fields: [
      { key: 'expression', label: 'Chiamata', type: 'expr', required: true, placeholder: 'es. Stampa(v)' }] },
    comment: { title: 'Commento', help: 'Una nota per chi legge: non viene eseguita.', fields: [
      { key: 'text', label: 'Testo', type: 'textarea' }] },
    breakpoint: { title: 'Punto di interruzione', help: 'Mette in pausa il programma per osservare le variabili.', fields: [
      { key: 'always', label: 'Fermati sempre', type: 'check' },
      { key: 'expression', label: 'Fermati solo se', type: 'expr', placeholder: 'es. i = 5', showIf: '!always' }] },
    open: { title: 'Apri file', help: 'I file stanno nella scheda File: puoi caricarli dal computer.', fields: [
      { key: 'expression', label: 'Nome del file', type: 'expr', required: true, placeholder: 'es. "dati.txt"' },
      { key: 'mode', label: 'Modalità', type: 'seg', options: [['read', 'Lettura'], ['write', 'Scrittura']] }] },
    close: { title: 'Chiudi file', fields: [
      { key: 'mode', label: 'File da chiudere', type: 'seg', options: [['read', 'In lettura'], ['write', 'In scrittura']] }] },
    read: { title: 'Leggi da file', help: 'Legge la riga successiva del file aperto in lettura.', fields: [
      { key: 'variable', label: 'Variabile', type: 'lvalue', required: true }] },
    write: { title: 'Scrivi su file', help: 'Aggiunge una riga al file aperto in scrittura.', fields: [
      { key: 'expression', label: 'Espressione', type: 'expr', required: true }] },
  };

  function stmtDialog(s, isNew, done) {
    let form = STMT_FORMS[s.kind];
    // nella vista Oggetti si possono dichiarare variabili di tipo classe
    if (s.kind === 'declare' && (M.hasClasses(st.prog) || (func().tparams || []).length)) form = { ...form, fields: form.fields.map((f) => (f.key === 'type' ? { ...f, type: 'typepick', ctx: typeCtx(func()) } : f)) };
    const vars = declaredNames(func());
    const body = h('div', { class: 'fields' });
    if (form.help) body.append(h('p', { class: 'help' }, form.help));
    const ws = {};
    const row = h('div', { class: 'row' });
    for (const spec of form.fields) {
      const w = field(spec, s[spec.key], vars);
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
    openModal({
      title: (isNew ? 'Nuovo blocco: ' : '') + form.title, body, okText: isNew ? 'Aggiungi' : 'Salva',
      onOk: () => {
        const vals = {};
        for (const spec of form.fields) {
          if (ws[spec.key].hidden) { vals[spec.key] = spec.type === 'check' ? false : (spec.key === 'size' || spec.key === 'init' ? '' : s[spec.key]); continue; }
          const e = ws[spec.key]._check ? ws[spec.key]._check() : '';
          if (e) return e;
          vals[spec.key] = ws[spec.key]._get();
          if (typeof vals[spec.key] === 'string' && spec.type !== 'textarea') vals[spec.key] = vals[spec.key].trim();
        }
        if (s.kind === 'declare' && vals.array && !String(vals.size).trim()) return 'Indica il numero di elementi dell\'array';
        if (s.kind === 'declare') vals.name = vals.name.split(',').map((x) => x.trim()).join(', ');
        if (s.kind === 'breakpoint' && !vals.always && !String(vals.expression || '').trim()) return 'Scrivi una condizione oppure scegli «Fermati sempre»';
        done(vals);
        return true;
      },
    });
  }

  /* Funzioni */
  // forma di un parametro o di un valore restituito: valore singolo o array a 1…5 dimensioni
  const SHAPES = [[0, 'valore'], [1, 'array [ ]'], [2, 'matrice [ , ]'], [3, '3 dimensioni'], [4, '4 dimensioni'], [5, '5 dimensioni']];
  /* opts (vista Oggetti, nuovo metodo): { cls, ctor } */
  function editFunction(index, opts) {
    const isNew = index == null;
    const f = isNew ? M.makeFunction('') : st.prog.functions[index];
    const oo = isOO() && M.hasClasses(st.prog);
    const cls = oo ? (isNew ? opts.cls : M.classOf(st.prog, f)) : null;
    if (roGuard(cls) || (!isNew && roFunc(f))) return;
    const ctor = oo && (isNew ? !!(opts && opts.ctor) : !!f.ctor);
    const params = f.params.map((p) => ({ ...p }));
    const body = h('div', { class: 'fields' });
    const what = ctor ? 'costruttore' : oo ? 'metodo' : 'funzione';
    if (ctor) body.append(h('p', { class: 'help' }, `Il costruttore prepara un nuovo oggetto ${cls.name}: si esegue con new ${cls.name}(...). Si possono avere più costruttori con parametri diversi.${cls.parent ? ` Il primo blocco può essere la Chiamata super(...) al costruttore di ${cls.parent}.` : ''}`));
    const nameW = field({ key: 'fname', label: ctor ? 'Nome (è quello della classe)' : oo ? 'Nome del metodo' : 'Nome della funzione', type: 'ident', required: true, placeholder: 'es. Massimo' }, ctor ? cls.name : f.name);
    if (ctor) nameW._input.disabled = true;
    const rets = ctor ? [] : M.rets(f).map((r) => ({ ...r }));
    body.append(nameW);
    let visW = null, statW = null, absW = null;
    if (oo) {
      visW = field({ key: 'fvis', label: 'Accesso', type: 'seg', options: VIS_OPTS }, isNew ? 'public' : (f.visibility || 'public'));
      body.append(visW);
      if (!ctor) { statW = field({ key: 'fstatic', label: 'Statico: si chiama con ' + cls.name + '.nome(...) senza creare un oggetto', type: 'check' }, isNew ? cls === M.mainClass(st.prog) : !!f.static); body.append(statW); }
      if (!ctor && cls !== M.mainClass(st.prog)) {
        // astratto: senza corpo, lo definiscono le sottoclassi (la classe diventa astratta)
        absW = field({ key: 'fabs', label: 'Astratto: senza corpo, lo definiscono le sottoclassi', type: 'check' }, !isNew && !!f.abstract);
        body.append(absW);
        const syncAbs = () => { const a = absW._get(); statW._input.disabled = a; if (a) statW._input.checked = false; };
        absW._input.addEventListener('change', syncAbs); syncAbs();
      }
    }
    // Tipi Generici: nei parametri si può crearne uno nuovo; nei valori restituiti si usano quelli già presenti
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
      if (!params.length) plist.append(h('p', { class: 'muted small' }, 'Nessun parametro.'));
      params.forEach((p, i) => {
        const nm = h('input', { type: 'text', class: 'mono', value: p.name, 'aria-label': 'Nome parametro ' + (i + 1), placeholder: 'nome', oninput: (e) => { p.name = e.target.value.trim(); } });
        const tp = typePicker(p.type, genCtx(true), (t) => { p.type = t; regen(); }, 'Tipo parametro ' + (i + 1)).el;
        const shape = p.array ? (p.dims || 1) : 0;
        const arr = h('select', { 'aria-label': 'Forma del parametro ' + (i + 1), title: 'Valore singolo o array', onchange: (e) => { const d = +e.target.value; p.array = d > 0; p.dims = Math.max(1, d); } }, SHAPES.map(([v, l]) => h('option', { value: v, selected: v === shape }, l)));
        plist.append(h('div', { class: 'prow' }, nm, tp, arr,
          h('button', { class: 'iconbtn', type: 'button', title: 'Sposta su', 'aria-label': 'Sposta su', disabled: i === 0, onclick: () => { params.splice(i - 1, 0, params.splice(i, 1)[0]); drawParams(); } }, '↑'),
          h('button', { class: 'iconbtn', type: 'button', title: 'Rimuovi', 'aria-label': 'Rimuovi parametro', onclick: () => { params.splice(i, 1); drawParams(); } }, '✕')));
      });
    };
    drawParams();
    body.append(h('div', { class: 'flabel' }, 'Parametri'), plist,
      h('button', { class: 'btn small', type: 'button', onclick: () => { params.push({ name: '', type: 'Integer', array: false }); drawParams(); plist.querySelector('.prow:last-child input').focus(); } }, '+ Aggiungi parametro'));
    // valori restituiti: nessuno = procedura, uno = funzione classica, più di uno = come in Python
    const rlist = h('div', { class: 'params' });
    // metodi: si può restituire un attributo della classe (anche ereditato, se non privato)
    const retAttrs = oo && !ctor ? retAttributes(cls) : [];
    const attrOf = (n) => retAttrs.find((x) => x.attr.name.toLowerCase() === String(n).toLowerCase());
    const dlId = 'retattrs_' + Math.random().toString(36).slice(2);
    const drawRets = () => {
      rlist.innerHTML = '';
      if (!rets.length) rlist.append(h('p', { class: 'muted small' }, 'Nessun valore: è una procedura.'));
      rets.forEach((r, i) => {
        const tpk = typePicker(r.type, genCtx(false), (t) => { r.type = t; }, 'Tipo del valore restituito ' + (i + 1)), tp = tpk.el;
        // anche un valore restituito può essere un array, come i parametri
        const arr = h('select', { 'aria-label': 'Forma del valore restituito ' + (i + 1), title: 'Valore singolo o array', onchange: (e) => { const d = +e.target.value; r.array = d > 0; r.dims = Math.max(1, d); if (!r.array) delete r.dims; } }, SHAPES.map(([v, l]) => h('option', { value: v, selected: v === (r.array ? r.dims || 1 : 0) }, l)));
        const tag = h('span', { class: 'rtag', title: 'È un attributo della classe: il metodo lo restituisce direttamente, senza dichiarare una variabile' }, 'attributo');
        // scegliendo un attributo il tipo e la forma sono i suoi e non si cambiano
        const syncAttr = () => {
          const a = attrOf(r.name);
          if (a) {
            r.type = a.attr.type; tpk.set(a.attr.type);
            if (a.attr.array) { r.array = true; r.dims = E.splitTop(a.attr.size).length || 1; } else { r.array = false; delete r.dims; }
            arr.value = String(r.array ? r.dims : 0);
          }
          tpk.setDisabled(!!a); arr.disabled = !!a; tag.hidden = !a;
        };
        const nm = h('input', { type: 'text', class: 'mono', value: r.name, list: retAttrs.length ? dlId : null, 'aria-label': 'Variabile restituita ' + (i + 1), placeholder: retAttrs.length ? 'variabile o attributo' : 'variabile', oninput: (e) => { r.name = e.target.value.trim(); syncAttr(); } });
        syncAttr();
        rlist.append(h('div', { class: 'prow rrow' }, h('div', { class: 'rname' }, nm, tag), tp, arr,
          h('button', { class: 'iconbtn', type: 'button', title: 'Sposta su', 'aria-label': 'Sposta su', disabled: i === 0, onclick: () => { rets.splice(i - 1, 0, rets.splice(i, 1)[0]); drawRets(); } }, '↑'),
          h('button', { class: 'iconbtn', type: 'button', title: 'Rimuovi', 'aria-label': 'Rimuovi valore restituito', onclick: () => { rets.splice(i, 1); drawRets(); } }, '✕')));
      });
    };
    drawRets();
    genKey = gensNow().join(',') + '|' + isInstance();
    if (retAttrs.length) body.append(h('datalist', { id: dlId }, retAttrs.map((x) => h('option', { value: x.attr.name }, `attributo ${x.owner === cls ? '' : 'di ' + x.owner.name + ' '}· ${E.typeName(x.attr.type)}${x.attr.array ? `[${','.repeat(E.splitTop(x.attr.size).length - 1)}]` : ''}`))));
    if (!ctor) body.append(h('div', { class: 'flabel' }, 'Valori restituiti'), h('p', { class: 'muted small', style: 'margin:0' }, `Le variabili vanno dichiarate nel corpo ${oo ? 'del metodo' : 'della funzione'}: quelle nuove vengono dichiarate in automatico.${retAttrs.length ? ' Si può scegliere anche un attributo della classe: in quel caso non serve dichiararlo.' : ''} Con più valori la chiamata si scrive a, b ← ${oo ? 'obj.metodo' : 'Funzione'}(...). Un array restituito si assegna a un array: v ← ${oo ? 'obj.metodo' : 'Funzione'}(...), e v diventa quell'array`), rlist,
      h('button', { class: 'btn small', type: 'button', onclick: () => { rets.push({ name: '', type: 'Integer' }); drawRets(); rlist.querySelector('.prow:last-child input').focus(); } }, '+ Aggiungi valore restituito'));
    openModal({
      title: isNew ? (ctor ? `Nuovo costruttore di ${cls.name}` : oo ? `Nuovo metodo in ${cls.name}` : 'Nuova funzione') : `Modifica ${what}`, body, okText: isNew ? 'Crea' : 'Salva', wide: true,
      onOk: () => {
        const e1 = nameW._check(); if (e1) return e1;
        const name = ctor ? cls.name : nameW._get().trim();
        if (name.toLowerCase() === 'main') return 'Il nome Main è riservato al programma principale (Inizio)';
        // un metodo può avere il nome di una funzione integrata (si chiama con obj.nome() o this.nome());
        // le funzioni e i metodi della classe principale no
        const plainFn = !oo || cls === M.mainClass(st.prog);
        if (E.BUILTINS[name.toLowerCase()] && plainFn) return `${name} è già una funzione integrata`;
        const isAbs = !!(absW && absW._get());
        const isStatic = !ctor && !isAbs && !!(statW && statW._get());
        // in Java toString() ridefinisce quello di Object: pubblico, non statico, restituisce una Stringa
        if (oo && !ctor && name === 'toString' && !params.length) {
          const vis = visW ? visW._get() : 'public';
          if (vis !== 'public' || isStatic || rets.length !== 1 || rets[0].type !== 'String') return 'toString() deve essere pubblico, non statico e restituire una Stringa: ridefinisce il toString() che ogni oggetto ha in Java';
        }
        if (isAbs && visW && visW._get() === 'private') return 'Un metodo astratto non può essere privato: le sottoclassi devono poterlo ridefinire';
        if (oo) {
          const sigOf = (list) => list.map((p) => p.type.toLowerCase() + (p.array ? '[' + (p.dims || 1) : '')).join(',');
          if (!ctor && name.toLowerCase() === cls.name.toLowerCase()) return `${name} è il nome della classe: per un costruttore usa «Nuovo costruttore»`;
          const clash = M.membersOf(st.prog, cls).find((g) => g !== f && !!g.ctor === ctor && g.name.toLowerCase() === name.toLowerCase() && sigOf(g.params) === sigOf(params));
          if (clash) return ctor ? 'Esiste già un costruttore con gli stessi tipi di parametri' : `Esiste già un metodo ${name} con gli stessi tipi di parametri (si possono avere più versioni solo con parametri diversi)`;
          if (!ctor) for (const k of M.chainOf(st.prog, cls).slice(1)) {
            const g = M.membersOf(st.prog, k).find((x) => !x.ctor && x.name.toLowerCase() === name.toLowerCase() && sigOf(x.params) === sigOf(params));
            if (!g) continue;
            if (!!g.static !== isStatic) return `${name} esiste già in ${k.name} come metodo ${g.static ? 'statico' : 'non statico'}: deve esserlo anche qui`;
            const rt = (l) => l.map((r) => r.type + (r.array ? `[${','.repeat((r.dims || 1) - 1)}]` : '')).join(',');
            if (rt(M.rets(g)) !== rt(rets)) return `${name} ridefinisce il metodo di ${k.name}: deve restituire gli stessi tipi (${M.rets(g).map((r) => E.typeName(r.type) + (r.array ? `[${','.repeat((r.dims || 1) - 1)}]` : '')).join(', ') || 'nessun valore'})`;
            break;
          }
        } else if (st.prog.functions.some((g, i) => i !== index && g.name.toLowerCase() === name.toLowerCase())) return `Esiste già una funzione chiamata ${name}`;
        const rseen = new Set();
        for (const r of rets) {
          if (!E.validIdent(r.name)) return `Valore restituito "${r.name || '(vuoto)'}": nome di variabile non valido`;
          if (E.RESERVED.has(r.name.toLowerCase())) return `"${r.name}" è una parola riservata`;
          if (rseen.has(r.name)) return `La variabile restituita ${r.name} è ripetuta`;
          rseen.add(r.name);
          if (oo && !ctor) {
            const a = M.chainOf(st.prog, cls).flatMap((k) => k.attributes.map((x) => ({ attr: x, owner: k }))).find((x) => x.attr.name.toLowerCase() === r.name.toLowerCase());
            if (a && a.owner !== cls && a.attr.visibility === 'private') return `${a.attr.name} è un attributo privato di ${a.owner.name}: ${cls.name} non lo vede`;
            if (a && isStatic && !a.attr.static) return `${a.attr.name} è un attributo d'istanza: un metodo statico non lo può restituire`;
          }
        }
        // Tipi Generici: della classe (metodi non statici, costruttori) o della funzione
        const inst = isInstance();
        let tps = [], clsGen = null;
        if (inst) {
          const ch = classGenChange(cls, f, [...params.map((p) => p.type), ...rets.map((r) => r.type)]);
          if (ch.err) return ch.err; clsGen = ch.nu;
        } else {
          tps = orderGen(f.tparams, dialogGens(false));
          const missing = dialogGens(true).filter((t) => !tps.includes(t) && !(cls && M.isTypeParam(cls, t)));
          if (missing.length) return `Il Tipo Generico ${missing.join(', ')} di un valore restituito deve comparire anche in un parametro: alla chiamata si ricava dagli argomenti`;
          if (cls && dialogGens(true).some((t) => M.isTypeParam(cls, t))) return `${oo && !ctor ? 'Un metodo statico' : 'Questa funzione'} non può usare i Tipi Generici della classe ${M.classTitle(cls)}: valgono solo per i suoi oggetti`;
          // il metodo diventa statico: la classe può perdere dei Tipi Generici
          if (oo && cls) { const ch = classGenChange(cls, f, []); if (ch.err) return ch.err; clsGen = ch.nu; }
        }
        const seen = new Set();
        for (const p of params) {
          if (!E.validIdent(p.name)) return `Parametro "${p.name || '(vuoto)'}": nome non valido`;
          if (seen.has(p.name)) return `Il parametro ${p.name} è ripetuto`;
          seen.add(p.name);
        }
        mutate(() => {
          const target = isNew ? M.makeFunction(name, { params }) : f;
          Object.assign(target, { name, params });
          if (tps.length) target.tparams = tps; else delete target.tparams;
          if (clsGen) cls.tparams = clsGen;
          if (oo) Object.assign(target, { cls: cls.id, visibility: visW ? visW._get() : 'public', static: isStatic || target === st.prog.functions[0], ctor, abstract: isAbs });
          // un attributo restituito si scrive come è dichiarato (i linguaggi distinguono le maiuscole)
          for (const r of rets) { const a = attrOf(r.name); if (a) { r.name = a.attr.name; r.type = a.attr.type; } }
          if (isAbs && !cls.abstract) { cls.abstract = true; setTimeout(() => toast(`${cls.name} è diventata una classe astratta: contiene un metodo astratto`), 0); }
          M.setRets(target, rets);
          // dichiara le variabili restituite che non sono ancora dichiarate (raggruppate per tipo)
          const known = new Set(params.map((p) => p.name));
          // gli attributi restituiti non si dichiarano
          if (oo && !ctor) retAttributes(cls).forEach((x) => known.add(x.attr.name));
          M.walk(target.body, (x) => { if (x.kind === 'declare') x.name.split(',').forEach((n) => known.add(n.trim())); });
          const missing = rets.filter((r) => ![...known].some((k) => k.toLowerCase() === r.name.toLowerCase()));
          const decls = [];
          for (const r of missing) {
            const last = decls[decls.length - 1];
            // un array restituito va dichiarato con la sua dimensione: il blocco resta da completare
            if (r.array) decls.push(M.makeStmt('declare', { name: r.name, type: r.type, array: true, size: '' }));
            else if (last && !last.array && last.type === r.type) last.name += ', ' + r.name;
            else decls.push(M.makeStmt('declare', { name: r.name, type: r.type }));
          }
          target.body.unshift(...decls);
          if (decls.some((d) => d.array)) setTimeout(() => toast(`Indica il numero di elementi di ${decls.filter((d) => d.array).map((d) => d.name).join(', ')} nel blocco Dichiara (doppio clic)`), 0);
          if (isNew) {
            st.prog.functions.push(target);
            // dal diagramma delle classi il nuovo metodo resta selezionato; altrimenti si apre
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
    const what = f.ctor ? `Il costruttore ${f.name}(…)` : isOO() ? `Il metodo ${fname(f)}` : `La funzione ${f.name}`;
    // la classe può perdere un Tipo Generico usato solo da questo metodo
    const owner = M.hasClasses(st.prog) ? M.classOf(st.prog, f) : null;
    const ch = owner ? classGenChange(owner, f, []) : {};
    if (ch.err) { infoBox('Metodo con Tipo Generico', ch.err); return; }
    confirmBox(f.ctor ? 'Eliminare il costruttore?' : isOO() ? 'Eliminare il metodo?' : 'Eliminare la funzione?', `${what} e tutti i suoi blocchi verranno eliminati.`, 'Elimina', () => mutate(() => {
      st.prog.functions.splice(i, 1);
      if (ch.nu) owner.tparams = ch.nu;
      if (st.fi === i) { st.fi = 0; if (isOO()) st.uml = true; } else if (st.fi > i) st.fi--;
      if (st.usel && st.usel.fid === f.id) st.usel = { cls: st.usel.cls, kind: 'class' };
    }));
  }

  /* attributi che un metodo della classe può restituire: propri e ereditati non privati, anche array */
  function retAttributes(cls) {
    const out = [];
    M.chainOf(st.prog, cls).forEach((k, i) => k.attributes.forEach((a) => { if (i === 0 || a.visibility !== 'private') out.push({ attr: a, owner: k }); }));
    return out;
  }

  /* ------------------------ Classi (vista Oggetti) ------------------------ */
  const VIS_OPTS = [['public', '+ pubblico'], ['private', '- privato'], ['protected', '# protetto']];
  const sigOf = (list) => list.map((p) => p.type.toLowerCase() + (p.array ? '[' + (p.dims || 1) : '')).join(',');
  const descendants = (c) => st.prog.classes.filter((k) => k !== c && M.isSubclass(st.prog, k, c));
  /* sostituisce il nome di una classe nelle espressioni: new Vecchio(...) e Vecchio.membro */
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
      for (const a of k.attributes) { a.type = T(a.type); a.init = renameInExpr(a.init || '', old, nu); a.size = renameInExpr(a.size || '', old, nu); }
    }
    for (const f of st.prog.functions) {
      if (f.ctor && f.cls === c.id) f.name = nu;
      f.params.forEach((p) => { p.type = T(p.type); });
      M.setRets(f, M.rets(f).map((r) => ({ name: r.name, type: T(r.type) })));
      M.walk(f.body, (x) => {
        if (x.kind === 'declare' || x.kind === 'const') x.type = T(x.type);
        for (const k of ['expression', 'variable', 'start', 'end', 'step', 'size']) if (typeof x[k] === 'string') x[k] = renameInExpr(x[k], old, nu);
      });
    }
    c.name = nu;
  }
  function classDialog(c, pos) {
    const isNew = !c;
    if (c && roGuard(c)) return;
    const nameW = field({ key: 'cname', label: 'Nome della classe', type: 'ident', required: true, placeholder: 'es. Punto', hint: 'Per convenzione inizia con la lettera maiuscola' }, c ? c.name : '');
    const banned = c ? [c, ...descendants(c)] : [];
    const parW = field({ key: 'cpar', label: 'Eredita da (classe madre)', type: 'select', options: [['', '— nessuna —'], ...st.prog.classes.filter((k) => !banned.includes(k) && !(k.tparams || []).length).map((k) => [k.name, k.name])] }, c ? (c.parent || '') : '');
    const isMainCls = c && c === M.mainClass(st.prog);
    const absW = isMainCls ? null : field({ key: 'cabs', label: 'Astratta: non si creano oggetti di questa classe, solo delle sue sottoclassi', type: 'check' }, c ? !!c.abstract : false);
    const body = h('div', { class: 'fields' }, h('p', { class: 'help' }, 'Una classe descrive un tipo di oggetti: i loro attributi (i dati) e i metodi (le operazioni). Con l\'ereditarietà la classe riceve attributi e metodi della classe madre e può ridefinire i metodi.'), nameW, parW, absW);
    openModal({
      title: isNew ? 'Nuova classe' : 'Modifica classe ' + c.name, body, okText: isNew ? 'Crea' : 'Salva',
      onOk: () => {
        const e1 = nameW._check(); if (e1) return e1;
        const name = nameW._get().trim();
        if (E.BUILTINS[name.toLowerCase()]) return `${name} è il nome di una funzione integrata`;
        if (st.prog.classes.some((k) => k !== c && k.name.toLowerCase() === name.toLowerCase())) return `Esiste già una classe chiamata ${name}`;
        const parent = parW._get();
        const abs = !!(absW && absW._get());
        // i Tipi Generici della classe vengono dagli attributi e dai metodi
        const tps = c ? c.tparams || [] : [];
        if (tps.length && parent) return `${c.name} ha dei Tipi Generici (${M.classTitle(c)}): in FlowLab una classe con Tipi Generici non può ereditare da un'altra classe`;
        if ((!c || c.name !== name) && /^[A-Z][0-9]*$/.test(name)) return `${name} è un nome riservato ai Tipi Generici (T, S, V…): usa un nome più lungo`;
        if (c && !abs) { const am = M.membersOf(st.prog, c).filter((f) => f.abstract); if (am.length) return `${c.name} ha metodi astratti (${am.map((f) => f.name + '()').join(', ')}): per renderla concreta togli prima «astratto» da quei metodi`; }
        // gli attributi non possono avere lo stesso nome di quelli della nuova classe madre
        if (parent) {
          const up = new Set(); M.chainOf(st.prog, M.classByName(st.prog, parent)).forEach((k) => k.attributes.forEach((a) => up.add(a.name.toLowerCase())));
          for (const k of c ? [c, ...descendants(c)] : []) for (const a of k.attributes) if (up.has(a.name.toLowerCase())) return `L'attributo ${k.name}.${a.name} ha lo stesso nome di un attributo di ${parent} o delle sue classi madri`;
        }
        mutate(() => {
          if (isNew) {
            const nc = M.makeClass(name, Object.assign({ parent, abstract: abs }, UmlLib.freeSpot(st.prog, pos)));
            st.prog.classes.push(nc);
            st.usel = { cls: nc.id, kind: 'class' };
          } else { renameClass(c, name); c.parent = parent; c.abstract = abs; }
        });
        return true;
      },
    });
  }
  function attrDialog(c, index) {
    const isNew = index == null;
    if (roGuard(c)) return;
    const a = isNew ? M.makeAttribute() : c.attributes[index];
    const nameW = field({ key: 'aname', label: 'Nome dell\'attributo', type: 'ident', required: true, placeholder: 'es. raggio' }, a.name);
    // un attributo d'istanza può avere un Tipo Generico: la classe diventa Classe<T>
    const actx = { gens: c.tparams || [], allowNew: !isMainClsOf(c), taken: () => [...(c.tparams || []), ...genNamesIn([typeW._get()], c.tparams)] };
    const typeW = field({ key: 'atype', label: 'Tipo', type: 'typepick', ctx: actx }, a.type);
    const arrW = field({ key: 'aarr', label: 'Array', type: 'check' }, a.array);
    const sizeW = field({ key: 'asize', label: 'Numero di elementi', type: 'exprlist', placeholder: 'es. 10   oppure   3, 4' }, a.size);
    const visW = field({ key: 'avis', label: 'Accesso', type: 'seg', options: VIS_OPTS }, a.visibility);
    const statW = field({ key: 'astat', label: 'Statico: uno solo per tutta la classe (Classe.nome)', type: 'check' }, a.static);
    const initW = field({ key: 'ainit', label: 'Valore iniziale (facoltativo)', type: 'expr', placeholder: 'se vuoto: 0, "", false oppure null', hint: 'Ogni nuovo oggetto parte da questo valore; poi il costruttore lo può cambiare' }, a.init || '');
    const body = h('div', { class: 'fields' }, nameW, typeW, arrW, sizeW, visW, statW, initW);
    const sync = () => { sizeW.hidden = !arrW._get(); initW.hidden = arrW._get(); };
    body.addEventListener('change', sync); sync();
    openModal({
      title: isNew ? `Nuovo attributo in ${c.name}` : `Modifica attributo ${c.name}.${a.name}`, body, okText: isNew ? 'Aggiungi' : 'Salva',
      onOk: () => {
        for (const w of [nameW, initW]) { if (w.hidden) continue; const e = w._check(); if (e) return e; }
        const name = nameW._get().trim(), lo = name.toLowerCase();
        const arr = arrW._get();
        if (arr) { const e = sizeW._check(); if (e) return e; if (!String(sizeW._get()).trim()) return 'Indica il numero di elementi dell\'array'; }
        for (const k of [...M.chainOf(st.prog, c), ...descendants(c)]) for (const x of k.attributes) if (x !== a && x.name.toLowerCase() === lo) return k === c ? `La classe ha già un attributo ${x.name}` : `${k.name} ha già un attributo ${x.name}: nella stessa gerarchia di classi i nomi devono essere diversi`;
        const ty = typeW._get();
        if (statW._get() && genNamesIn([ty], c.tparams).length) return 'Un attributo statico non può avere un Tipo Generico: è uno solo per tutti gli oggetti, che possono avere tipi diversi';
        const ch = classGenChange(c, a, statW._get() ? [] : [ty]);
        if (ch.err) return ch.err;
        mutate(() => {
          if (ch.nu) c.tparams = ch.nu;
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
    if (c === M.mainClass(st.prog)) { infoBox('Classe principale', `${c.name} è la classe principale: contiene Main, da cui parte il programma, e non si può eliminare.`); return; }
    const kids = st.prog.classes.filter((k) => (k.parent || '').toLowerCase() === c.name.toLowerCase());
    if (kids.length) { infoBox('Classe con sottoclassi', `Prima togli l'ereditarietà da ${kids.map((k) => k.name).join(', ')}: ereditano da ${c.name}.`); return; }
    confirmBox('Eliminare la classe?', `La classe ${c.name}, i suoi attributi e i suoi ${M.membersOf(st.prog, c).length} metodi verranno eliminati. Le variabili e gli attributi di tipo ${c.name} andranno corretti.`, 'Elimina', () => mutate(() => {
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
    if (ch.err) { infoBox('Attributo con Tipo Generico', ch.err); return; }
    mutate(() => { c.attributes.splice(i, 1); if (ch.nu) c.tparams = ch.nu; st.usel = { cls: c.id, kind: 'class' }; });
    toast(`Attributo ${a.name} eliminato (Ctrl+Z per annullare)`);
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
    else if (st.usel.kind === 'method') { const f = st.prog.functions.find((x) => x.id === st.usel.fid); if (f && f !== st.prog.functions[0]) deleteFunction(f); else if (f) toast('Main è il punto di partenza del programma e non si può eliminare', 'warn'); }
    else deleteClass(c);
  }
  function memberMenu(c, x, y) {
    const box = h('div', { class: 'ctxmenu' },
      h('button', { type: 'button', onclick: () => { closePop(); editFunction(null, { cls: c, ctor: false }); } }, h('span', null, 'Nuovo metodo…'), h('kbd', null, 'M')),
      h('button', { type: 'button', onclick: () => { closePop(); editFunction(null, { cls: c, ctor: true }); } }, h('span', null, 'Nuovo costruttore…'), h('kbd', null, 'C')));
    openPop(x, y, box);
  }
  function umlMenu(e) {
    const box = e.target.closest('.ubox'), row = e.target.closest('.urow');
    const c = box && M.classById(st.prog, box.dataset.cls);
    const B = (label, fn, cls, key) => h('button', { type: 'button', class: cls || '', onclick: () => { closePop(); fn(); } }, h('span', null, label), key ? h('kbd', null, key) : null);
    let menuBox;
    const modEl = e.target.closest('.umod');
    if (modEl && !c) {
      const mn = modEl.dataset.module;
      menuBox = h('div', { class: 'ctxmenu' }, h('div', { class: 'pophead' }, 'Modulo ' + mn), B('Aggiorna il modulo', () => updateModule(mn)), h('hr'), B('Rimuovi il modulo', () => removeModule(mn), 'danger'));
    } else if (!c) {
      const pt = svgPoint(e);
      menuBox = h('div', { class: 'ctxmenu' }, B('Nuova classe…', () => classDialog(null, pt), '', 'N'), B('Importa un modulo…', moduleDialog, '', 'Ctrl+I'));
    } else if (c.module) {
      const f = row && row.dataset.kind === 'method' ? st.prog.functions.find((x) => x.id === row.dataset.fid) : null;
      menuBox = h('div', { class: 'ctxmenu' }, h('div', { class: 'pophead' }, `${M.classTitle(c)} · modulo ${c.module.name}`),
        f ? B('Apri il diagramma di flusso', () => openMethod(f.id), '', 'Invio') : null,
        B('Aggiorna il modulo', () => updateModule(c.module.name)), h('hr'), B('Rimuovi il modulo', () => removeModule(c.module.name), 'danger'));
    } else if (row && row.dataset.kind === 'method') {
      const f = st.prog.functions.find((x) => x.id === row.dataset.fid);
      menuBox = h('div', { class: 'ctxmenu' },
        B('Apri il diagramma di flusso', () => openMethod(f.id), '', 'Invio'),
        B(f === st.prog.functions[0] ? 'Proprietà del programma…' : f.ctor ? 'Modifica il costruttore…' : 'Modifica la firma del metodo…', () => editMethodSig(f), '', 'F2'),
        f === st.prog.functions[0] ? null : h('hr'),
        f === st.prog.functions[0] ? null : B(f.ctor ? 'Elimina il costruttore' : 'Elimina il metodo', () => deleteFunction(f), 'danger', 'Canc'));
    } else if (row && row.dataset.kind === 'attr') {
      const i = +row.dataset.i;
      menuBox = h('div', { class: 'ctxmenu' }, B('Modifica l\'attributo…', () => attrDialog(c, i), '', 'Invio'), h('hr'), B('Elimina l\'attributo', () => deleteAttr(c, i), 'danger', 'Canc'));
    } else {
      menuBox = h('div', { class: 'ctxmenu' },
        B('Nuovo attributo…', () => attrDialog(c, null), '', 'A'),
        B('Nuovo metodo…', () => editFunction(null, { cls: c, ctor: false }), '', 'M'),
        B('Nuovo costruttore…', () => editFunction(null, { cls: c, ctor: true }), '', 'C'),
        h('hr'),
        B('Modifica la classe…', () => classDialog(c), '', 'Invio'),
        B('Elimina la classe', () => deleteClass(c), 'danger', 'Canc'));
    }
    openPop(e.clientX, e.clientY, menuBox);
  }
  function svgPoint(e) {
    const svg = $('#chart svg'); const r = svg.getBoundingClientRect();
    return { x: (e.clientX - r.left) / st.zoom, y: (e.clientY - r.top) / st.zoom };
  }
  /* evidenzia la selezione senza ridisegnare (altrimenti il doppio clic si perde) */
  function decorateUml() {
    const u = st.usel;
    $$('#chart .ubox').forEach((b) => { const on = !!u && u.cls === b.dataset.cls; b.classList.toggle('cur', on); b.classList.toggle('sel', on && u.kind === 'class'); });
    $$('#chart .urow').forEach((r) => {
      const b = r.closest('.ubox');
      const on = !!u && u.cls === b.dataset.cls && u.kind === r.dataset.kind && (u.kind === 'attr' ? String(u.i) === r.dataset.i : u.fid === r.dataset.fid);
      r.classList.toggle('sel', on);
    });
    renderFuncSelect();
  }
  /* selezione nel diagramma delle classi */
  function umlSelectFrom(target) {
    const box = target.closest('.ubox'), row = target.closest('.urow');
    if (!box) st.usel = null;
    else if (row) st.usel = { cls: box.dataset.cls, kind: row.dataset.kind, i: row.dataset.i != null ? +row.dataset.i : undefined, fid: row.dataset.fid };
    else st.usel = { cls: box.dataset.cls, kind: 'class' };
  }
  function editProgram() {
    const a = st.prog.attrs;
    const n = field({ key: 'pname', label: 'Nome del programma', type: 'plain' }, a.name);
    const au = field({ key: 'pauth', label: 'Autori', type: 'plain' }, a.authors);
    const ab = field({ key: 'pabout', label: 'Descrizione', type: 'textarea', hint: 'Se il programma viene usato come modulo, è la descrizione mostrata quando lo si importa' }, a.about);
    openModal({ title: 'Proprietà del programma', body: h('div', { class: 'fields' }, n, au, ab), okText: 'Salva', onOk: () => {
      if (isRunning()) return 'Ferma il programma prima di modificarlo';
      mutate(() => {
        // la classe predefinita prende il nome del programma
        const c = M.hasClasses(st.prog) && st.prog.classes.length === 1 && st.prog.classes[0].name === M.defaultClassName(st.prog) ? st.prog.classes[0] : null;
        a.name = n._get().trim(); a.authors = au._get().trim(); a.about = ab._get();
        if (c && !st.prog.classes.some((k) => k !== c && k.name === M.defaultClassName(st.prog))) renameClass(c, M.defaultClassName(st.prog));
      });
      return true;
    } });
  }

  /* ------------------------ Interazione col disegno ---------------------- */
  let drag = null, suppressClick = false, udrag = null;
  function bindChart() {
    const chart = $('#chart');
    chart.addEventListener('click', (e) => {
      if (suppressClick) { suppressClick = false; return; }
      if (isUml()) {
        const mt = e.target.closest('.umodtog');
        if (mt) { toggleModule(mt.dataset.module); return; }
        const add = e.target.closest('.uadd');
        if (add) {
          const c = M.classById(st.prog, add.closest('.ubox').dataset.cls);
          if (isRunning()) { toast('Ferma il programma per modificare il diagramma', 'warn'); return; }
          if (add.dataset.add === 'attr') attrDialog(c, null); else memberMenu(c, e.clientX + 6, e.clientY + 6);
          return;
        }
        umlSelectFrom(e.target); decorateUml();
        return;
      }
      const tog = e.target.closest('.ctoggle');
      if (tog) { const id = tog.dataset.toggle; st.expanded.has(id) ? st.expanded.delete(id) : st.expanded.add(id); render(); return; }
      const ins = e.target.closest('.ins');
      if (ins) { if (isRunning()) { toast('Ferma il programma per modificare il diagramma', 'warn'); return; } insertMenu(+ins.dataset.ins, e.clientX + 6, e.clientY + 6); return; }
      const g = e.target.closest('.shape');
      st.sel = g && !g.dataset.id.includes(':') ? g.dataset.id : null;
      decorate();
    });
    chart.addEventListener('dblclick', (e) => {
      if (isUml()) {
        if (e.target.closest('.uadd') || e.target.closest('.umodtog')) return;
        const mc = e.target.closest('.umodc');
        if (mc) { toggleModule(mc.dataset.module); return; }
        if (e.target.closest('.umod')) return; // riquadro di un modulo: niente nuova classe
        const row = e.target.closest('.urow'), box = e.target.closest('.ubox');
        if (row && row.dataset.kind === 'method') { openMethod(row.dataset.fid); return; }
        if (isRunning()) { toast('Ferma il programma per modificare il diagramma', 'warn'); return; }
        if (row) { attrDialog(M.classById(st.prog, box.dataset.cls), +row.dataset.i); return; }
        if (box) { classDialog(M.classById(st.prog, box.dataset.cls)); return; }
        classDialog(null, svgPoint(e));
        return;
      }
      if (e.target.closest('.ctoggle')) return;
      const g = e.target.closest('.shape'); if (!g) return;
      const id = g.dataset.id;
      if (id.startsWith('start:') || id.startsWith('end:')) { if (isRunning()) return; st.fi === 0 ? editProgram() : editFunction(st.fi); return; }
      editStmt(id);
    });
    chart.addEventListener('contextmenu', (e) => {
      if (isUml()) {
        e.preventDefault();
        if (isRunning()) { toast('Ferma il programma per modificare il diagramma', 'warn'); return; }
        umlSelectFrom(e.target); decorateUml(); umlMenu(e);
        return;
      }
      const g = e.target.closest('.shape'); if (!g) return;
      e.preventDefault();
      if (!g.dataset.id.includes(':')) { st.sel = g.dataset.id; decorate(); }
      shapeMenu(g.dataset.id, e.clientX, e.clientY);
    });
    chart.addEventListener('pointerdown', (e) => {
      if (isUml()) {
        // le classi si spostano trascinandole; un modulo (riquadro o etichetta) si sposta con tutte le sue classi
        if (e.button !== 0 || isRunning() || e.target.closest('.uadd') || e.target.closest('.umodtog')) return;
        const box = e.target.closest('.ubox'), mod = !box && e.target.closest('.umod');
        let cs;
        if (box) cs = [M.classById(st.prog, box.dataset.cls)];
        else if (mod) { const m = M.modulesOf(st.prog).find((x) => x.name === mod.dataset.module); cs = m ? m.classes : []; }
        if (!cs || !cs.length) return;
        udrag = { items: cs.map((c) => ({ c, ox: c.x || 0, oy: c.y || 0 })), mod: mod ? mod.dataset.module : null, x: e.clientX, y: e.clientY, on: false, raf: 0 };
        return;
      }
      if (e.button !== 0 || isRunning() || e.target.closest('.ctoggle')) return;
      const g = e.target.closest('.shape'); if (!g || g.dataset.id.includes(':')) return;
      drag = { id: g.dataset.id, x: e.clientX, y: e.clientY, on: false, ghost: null };
    });
    window.addEventListener('pointermove', (e) => {
      if (udrag) {
        const dx = (e.clientX - udrag.x) / st.zoom, dy = (e.clientY - udrag.y) / st.zoom;
        if (!udrag.on && Math.hypot(dx, dy) > 4) {
          udrag.on = true;
          st.undo.push(snapshot()); if (st.undo.length > 150) st.undo.shift(); st.redo = [];
          document.body.classList.add('udragging');
          st.usel = udrag.mod ? null : { cls: udrag.items[0].c.id, kind: 'class' };
        }
        if (udrag.on) {
          // passo di 10 e mai oltre il bordo in alto o a sinistra (le classi di un modulo restano allineate tra loro)
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
        $$('#chart .ins.drop').forEach((x) => x.classList.remove('drop'));
        const ins = el && el.closest && el.closest('#chart .ins');
        if (ins) ins.classList.add('drop');
      }
    });
    window.addEventListener('pointerup', (e) => {
      if (udrag) {
        const d = udrag; udrag = null;
        if (d.on) { cancelAnimationFrame(d.raf); document.body.classList.remove('udragging'); st.dirty = true; suppressClick = true; setTimeout(() => { suppressClick = false; }, 50); render(); }
        return;
      }
      if (!drag) return;
      const d = drag; drag = null;
      if (!d.on) return;
      document.body.classList.remove('dragging');
      d.ghost.remove();
      suppressClick = true; setTimeout(() => { suppressClick = false; }, 50);
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const ins = el && el.closest && el.closest('#chart .ins');
      if (ins) moveStmt(d.id, st.ins[+ins.dataset.ins]);
      $$('#chart .ins.drop').forEach((x) => x.classList.remove('drop'));
    });
    $('#canvasWrap').addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(st.zoom * (e.deltaY < 0 ? 1.1 : 0.9));
    }, { passive: false });
  }

  /* ============================ ESECUZIONE =============================== */
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

  /* ---- File virtuali ---- */
  const streams = { read: null, write: null };
  function saveVfs() { store.set('vfs', Object.fromEntries(st.vfs)); renderFiles(); }
  function fileOpen(name, mode) {
    if (!name.trim()) throw new E.FlowError('Il nome del file è vuoto');
    if (streams[mode]) throw new E.FlowError(`C'è già un file aperto in ${mode === 'read' ? 'lettura' : 'scrittura'}: chiudilo prima di aprirne un altro`);
    if (mode === 'read') {
      if (!st.vfs.has(name)) throw new E.FlowError(`File "${name}" non trovato: caricalo nella scheda File`);
      const lines = st.vfs.get(name).split(/\r?\n/);
      if (lines.length && lines[lines.length - 1] === '') lines.pop();
      streams.read = { name, lines, pos: 0 };
    } else streams.write = { name, lines: [] };
  }
  function fileClose(mode) {
    if (!streams[mode]) throw new E.FlowError(`Nessun file aperto in ${mode === 'read' ? 'lettura' : 'scrittura'}`);
    if (mode === 'write') { st.vfs.set(streams.write.name, streams.write.lines.join('\n') + (streams.write.lines.length ? '\n' : '')); saveVfs(); }
    streams[mode] = null;
  }
  function flushStreams() { if (streams.write) { try { fileClose('write'); } catch (e) { /* ignora */ } } streams.read = null; streams.write = null; }

  const env = {
    output: (t, nl, cls) => conWrite(t, nl, cls),
    eof: () => { if (!streams.read) throw new E.FlowError('EOF(): nessun file aperto in lettura'); return streams.read.pos >= streams.read.lines.length; },
    fileOpen, fileClose,
    fileRead: () => {
      const r = streams.read;
      if (!r) throw new E.FlowError('Nessun file aperto in lettura');
      if (r.pos >= r.lines.length) throw new E.FlowError(`Lettura oltre la fine del file "${r.name}" (controlla con EOF())`);
      return r.lines[r.pos++];
    },
    fileWrite: (s) => { if (!streams.write) throw new E.FlowError('Nessun file aperto in scrittura'); streams.write.lines.push(s); },
  };

  function setStatus(kind, text) {
    const s = $('#status');
    s.className = 'status ' + kind;
    $('#statusText').textContent = text;
    $('#stepCount').textContent = run.steps ? `${run.steps.toLocaleString('it-IT')} passi` : '';
    document.body.dataset.run = run.state;
    $('#runBtn').querySelector('span').textContent = run.state === 'paused' ? 'Continua' : 'Esegui';
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
    conWrite(`▶ ${st.prog.attrs.name || 'Programma'}`, true, 'sys');
    // esegue una copia, così le modifiche al diagramma non toccano l'esecuzione
    const prog = JSON.parse(JSON.stringify(st.prog));
    run.interp = new Interpreter(prog, env);
    run.gen = run.interp.run();
    if (!paneVisible('console') && !paneVisible('vars')) showPane('console');
    if (mode === 'run') { run.state = 'running'; setStatus('running', 'In esecuzione…'); pump(); }
    else { run.state = 'paused'; stepOnce(); }
  }

  function stopTimer() { if (run.timer) { clearTimeout(run.timer); run.timer = null; } }

  function advance() {
    let r, ev;
    for (;;) {
      try { r = run.gen.next(run.pending); run.pending = undefined; } catch (e) { onError(e); return null; }
      if (r.done) { onFinish(); return null; }
      ev = r.value;
      // il ramo scelto da un Se serve solo al cursore: non è un passo
      if (ev.type === 'branch') { ev.frame._branch = { id: ev.stmt.id, taken: ev.taken }; continue; }
      break;
    }
    if (ev.type === 'stmt') {
      run.steps++; run.curId = ev.stmt.id; run.curFrame = ev.frame;
      // percorso per il cursore: dall'ultimo blocco eseguito in questa stessa chiamata
      run.trail = { from: ev.frame._last || null, to: ev.stmt.id, frame: ev.frame, branch: ev.frame._branch || null, step: run.steps };
      ev.frame._last = ev.stmt.id;
      if (!run.mainFrame) run.mainFrame = ev.frame;
      return ev;
    }
    if (ev.type === 'input') { onInput(ev); return null; }
    if (ev.type === 'break') {
      run.state = 'paused'; run.mode = 'step';
      showCurrent(); setStatus('paused', 'In pausa al punto di interruzione');
      conWrite('⏸ Punto di interruzione', true, 'sys');
      return null;
    }
    return ev;
  }

  function pump() {
    run.timer = null;
    if (run.state !== 'running') return;
    const ms = SPEEDS[st.speed].ms;
    const t0 = performance.now();
    while (run.state === 'running') {
      const ev = advance();
      if (!ev) return;
      if (ms > 0) { showCurrent(); run.timer = setTimeout(pump, ms); return; }
      if (performance.now() - t0 > 16) {
        setStatus('running', 'In esecuzione…');
        if (performance.now() - run.lastVarsAt > 400) { renderVars(); run.lastVarsAt = performance.now(); }
        run.timer = setTimeout(pump, 0);
        return;
      }
    }
  }

  function stepOnce() {
    if (run.state === 'input') return;
    run.state = 'paused'; run.mode = 'step';
    const ev = advance();
    if (ev) { showCurrent(); setStatus('paused', 'Passo a passo: premi Passo per continuare'); }
  }

  /* Passo sopra: esegue fino al prossimo blocco della stessa chiamata (o di quella che l'ha chiamata),
     senza fermarsi dentro le funzioni e i metodi chiamati dal blocco corrente */
  function onOverBtn() {
    if (run.state === 'input') return;
    if (run.state === 'running') { onStepBtn(); return; }
    if (run.state !== 'paused') { run.errId = null; startRun('step'); return; }
    run.overDepth = run.curFrame ? run.curFrame.depth : 0;
    run.mode = 'over'; run.state = 'running';
    pumpOver();
  }
  /* Esci dalla funzione: esegue il resto della funzione (o del metodo) in corso e si ferma
     sul blocco successivo di chi l'ha chiamata; nel Main esegue fino alla fine */
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
    const t0 = performance.now();
    while (run.state === 'running') {
      const ev = advance();
      if (!ev) return; // fine, errore, input o punto di interruzione
      if (ev.frame.depth <= run.overDepth) {
        run.state = 'paused'; run.mode = 'step';
        showCurrent(); setStatus('paused', 'Passo a passo: premi Passo per continuare');
        return;
      }
      if (performance.now() - t0 > 16) {
        setStatus('running', 'Esecuzione della chiamata…');
        run.timer = setTimeout(pumpOver, 0);
        return;
      }
    }
  }

  function showCurrent() {
    const fid = run.curFrame && run.curFrame.func.id;
    if (fid) {
      const i = st.prog.functions.findIndex((f) => f.id === fid);
      if (i >= 0 && (i !== st.fi || st.uml)) { st.fi = i; st.uml = false; st.sel = null; render(); }
    }
    decorate();
    const el = $(`#chart .shape[data-id="${CSS.escape(run.curId || '')}"]`);
    if (el) scrollIntoViewIfNeeded(el);
    run.viewFrame = null;
    renderVars();
    drawTrail();
  }

  /* ---- Cursore lungo le frecce ---- */
  let trailRaf = 0;
  function clearTrail() {
    cancelAnimationFrame(trailRaf);
    run.hold = null;
    const g = $('#chart svg .trail'); if (g) g.innerHTML = '';
    run.trailShown = null;
  }
  function findPath(from, to, branch) {
    const out = new Map();
    for (const e of st.edges || []) { if (!out.has(e.from)) out.set(e.from, []); out.get(e.from).push(e); }
    // ricerca in ampiezza: il primo passo da un Se segue il ramo davvero preso
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
  function drawTrail() {
    const t = run.trail;
    const animate = run.mode === 'step' || SPEEDS[st.speed].ms > 0;
    if (!t || !animate || run.trailShown === t.step) return;
    run.trailShown = t.step;
    cancelAnimationFrame(trailRaf);
    if (run.hold) { run.hold = null; decorate(); }
    const g = $('#chart svg .trail'); if (!g) return;
    g.innerHTML = '';
    if (!t.from || func().id !== t.frame.func.id) return;
    const path = findPath(t.from, t.to, t.branch);
    if (!path) return;
    const pts = [];
    for (const e of path) for (const p of e.pts) { const q = pts[pts.length - 1]; if (!q || q[0] !== p[0] || q[1] !== p[1]) pts.push(p); }
    if (pts.length < 2) return;
    const seg = []; let total = 0;
    for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(l); total += l; }
    const NS = 'http://www.w3.org/2000/svg';
    const line = document.createElementNS(NS, 'path');
    line.setAttribute('class', 'trail-path');
    line.setAttribute('d', pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join(''));
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('class', 'trail-cursor'); dot.setAttribute('r', '6');
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
    // durante il tragitto il blocco di arrivo resta spento; si illumina all'arrivo del cursore
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
  function scrollIntoViewIfNeeded(el) {
    const wrap = $('#canvasWrap');
    const r = el.getBoundingClientRect(), w = wrap.getBoundingClientRect();
    if (r.top < w.top + 30 || r.bottom > w.bottom - 30 || r.left < w.left || r.right > w.right) {
      wrap.scrollBy({ top: r.top - w.top - w.height / 2 + r.height / 2, left: r.left - w.left - w.width / 2 + r.width / 2, behavior: SPEEDS[st.speed].ms > 200 ? 'smooth' : 'auto' });
    }
  }

  function onInput(ev) {
    run.state = 'input';
    showCurrent();
    setStatus('input', `In attesa di un valore per ${ev.varName}`);
    const inp = $('#conInput');
    inp.disabled = false; $('#conSend').disabled = false;
    inp.placeholder = `${ev.varName} (${TYPE_IT[ev.varType]}) — scrivi e premi Invio`;
    $('#conPrompt').textContent = ev.varName;
    $('#conForm').classList.add('waiting');
    // l'input deve essere visibile: se la console è nel pannello nascosto, il pannello si riapre
    if (!isFloat('console') && document.body.classList.contains('side-hidden')) setSideHidden(false);
    showPane('console');
    setTimeout(() => inp.focus(), 0);
  }
  function submitInput(text) {
    if (run.state !== 'input') return;
    conWrite(text, true, 'echo');
    const inp = $('#conInput');
    inp.value = ''; inp.disabled = true; $('#conSend').disabled = true; inp.placeholder = 'L\'input si attiva quando il programma chiede un valore';
    $('#conPrompt').textContent = '›';
    $('#conForm').classList.remove('waiting');
    run.pending = text;
    if (run.mode === 'run') { run.state = 'running'; setStatus('running', 'In esecuzione…'); pump(); }
    else if (run.mode === 'over') { run.state = 'running'; pumpOver(); }
    else { run.state = 'paused'; stepOnce(); }
  }

  function onFinish() {
    flushStreams();
    run.state = 'done';
    conWrite(`■ Fine del programma · ${run.steps.toLocaleString('it-IT')} passi`, true, 'sys');
    run.curId = null; run.curFrame = null; clearTrail();
    decorate(); renderVars();
    setStatus('done', 'Programma terminato');
    // dopo Esegui si mostrano i risultati: la console (anche se era aperta la scheda Variabili)
    if (run.mode === 'run') {
      if (!isFloat('console') && document.body.classList.contains('side-hidden')) setSideHidden(false);
      showPane('console');
    }
  }
  function onError(e) {
    flushStreams();
    run.state = 'done';
    run.errId = e.stmtId || null;
    const fi = e.funcId ? st.prog.functions.findIndex((f) => f.id === e.funcId) : -1;
    if (fi >= 0 && (fi !== st.fi || st.uml)) { st.fi = fi; st.uml = false; render(); }
    if (!run.errId && e.stmtId) run.errId = e.stmtId;
    let where = '';
    if (e.stmtId) {
      const fs = M.findStmt(st.prog, e.stmtId);
      const fn = e.funcId && st.prog.functions.find((f) => f.id === e.funcId);
      if (fs) where = ` (in ${fname(fs.func)}, blocco «${RenderLib.caption(fs.stmt).text}»)`;
      else if (fn) where = ` (in ${fname(fn)})`;
    }
    conWrite('✖ Errore: ' + (e.message || String(e)) + where, true, 'error');
    decorate(); renderVars();
    const el = run.errId && $(`#chart .shape[data-id="${CSS.escape(run.errId)}"]`);
    if (el) scrollIntoViewIfNeeded(el);
    showPane('console');
    setStatus('error', 'Errore durante l\'esecuzione');
    if (!(e instanceof E.FlowError)) console.error(e);
  }
  function stopRun() {
    if (!isRunning()) return;
    stopTimer();
    try { run.gen.return(); } catch (e) { /* ignora */ }
    flushStreams();
    run.state = 'done';
    const inp = $('#conInput'); inp.disabled = true; $('#conSend').disabled = true; $('#conForm').classList.remove('waiting'); $('#conPrompt').textContent = '›';
    conWrite('■ Esecuzione interrotta', true, 'sys');
    run.curId = null; decorate(); clearTrail();
    setStatus('done', 'Interrotto');
  }
  function onRunBtn() {
    if (run.state === 'paused') { run.mode = 'run'; run.state = 'running'; setStatus('running', 'In esecuzione…'); pump(); return; }
    if (run.state === 'running' || run.state === 'input') return;
    run.errId = null;
    startRun('run');
  }
  function onStepBtn() {
    if (run.state === 'paused') { stepOnce(); return; }
    if (run.state === 'running') { stopTimer(); run.state = 'paused'; run.mode = 'step'; showCurrent(); setStatus('paused', 'In pausa'); return; }
    if (run.state === 'input') return;
    run.errId = null;
    startRun('step');
  }
  function onPauseBtn() {
    if (run.state !== 'running') return;
    stopTimer(); run.state = 'paused'; run.mode = 'step';
    showCurrent(); setStatus('paused', 'In pausa');
  }

  /* ---- Variabili ---- */
  const CARET = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5L8 6L4.5 9.5"/></svg>';
  const GRID_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/></svg>';
  function renderVars() {
    const box = $('#varsBody');
    const interp = run.interp;
    const stack = interp && isRunning() ? interp.stack : (run.mainFrame ? [run.mainFrame] : []);
    // le finestre degli array seguono la chiamata più recente della loro funzione
    if (ArrayView.count) ArrayView.refresh((fid, vn) => { for (let i = stack.length - 1; i >= 0; i--) { const fr = stack[i]; if (fr.func.id === fid) { const c = fr.vars.get(vn.toLowerCase()); if (c && c.array) return c; } } return null; });
    box.innerHTML = '';
    if (!stack.length) { box.append(h('p', { class: 'empty' }, 'Le variabili compaiono qui quando esegui il programma. Usa Passo per osservarle cambiare istruzione dopo istruzione.')); return; }
    const frame = run.viewFrame && stack.includes(run.viewFrame) ? run.viewFrame : stack[stack.length - 1];
    const crumbs = h('nav', { class: 'crumbs', 'aria-label': 'Chiamate in corso' });
    stack.forEach((fr, i) => {
      if (i) crumbs.append(h('span', { class: 'sep' }, '›'));
      crumbs.append(h('button', { type: 'button', class: fr === frame ? 'on' : '', onclick: () => { run.viewFrame = fr; renderVars(); } }, fname(fr.func)));
    });
    if (stack.length > 6) crumbs.classList.add('long');
    box.append(crumbs);
    const statics = interp && interp.oo ? [...interp.statics].filter(([, m]) => m.size) : [];
    if (!frame.vars.size && !frame.self && !statics.length) { box.append(h('p', { class: 'empty' }, 'Nessuna variabile dichiarata finora in ' + fname(frame.func) + '.')); return; }
    const tbl = h('table', { class: 'vars' }, h('thead', null, h('tr', null, h('th', null, 'Nome'), h('th', null, 'Tipo'), h('th', null, 'Valore'))));
    const tb = h('tbody');
    // src: chiave della riga, per collegare la finestra all'elemento cliccato
    const srcSel = (k) => `#varsBody [data-src="${CSS.escape(k)}"]`;
    const fmt = (v, k) => (v === undefined ? h('span', { class: 'undef' }, 'nessun valore')
      : v.t === 'Object' && v.v ? h('button', { type: 'button', class: 'ov-link obj', 'data-src': k || null, title: 'Apri l\'oggetto in una finestra', onclick: () => ArrayView.openObject(v.v, k ? ArrayView.domSrc(srcSel(k)) : null) }, E.literalOf(v))
      : h('span', { class: 'v-' + v.t }, E.literalOf(v)));
    const prev = run.prevVals; const next = new Map();
    const fkey = fname(frame.func);
    /* freccina che apre o chiude le righe sotto (lo stato resta tra un passo e l'altro) */
    const makeCaret = (okey, label, onToggle) => {
      const isOpen = st.varsOpen.has(okey);
      const b = h('button', { class: 'caret' + (isOpen ? ' open' : ''), type: 'button', 'aria-expanded': String(isOpen), 'aria-label': `Mostra o nascondi i dettagli di ${label}`, html: CARET, onclick: () => {
        const open = !st.varsOpen.has(okey);
        if (open) st.varsOpen.add(okey); else st.varsOpen.delete(okey);
        b.classList.toggle('open', open); b.setAttribute('aria-expanded', String(open));
        onToggle(open);
      } });
      return { el: b, isOpen };
    };
    const ind = (depth) => (depth ? { style: `padding-left:${8 + depth * 16}px` } : null);
    /* una riga per variabile o attributo; gli oggetti si aprono per vedere i loro attributi */
    const addCell = (c, label, depth, path, seen, extra) => {
      const key = frame.depth + ':' + path;
      const tags = [c.param ? h('span', { class: 'ptag', title: 'parametro' }, 'par') : null, c.constant ? h('span', { class: 'ptag', title: 'costante' }, 'cost') : null, c.field && c.visibility && c.visibility !== 'public' ? h('span', { class: 'ptag vis', title: M.VIS_IT[c.visibility] }, M.VISIBILITY[c.visibility]) : null, extra || null];
      if (c.array) {
        const n = c.items.length, dims = c.dims || [n];
        const sv = String(c.writes || 0); next.set(key, sv);
        const changed = prev.has(key) && prev.get(key) !== sv;
        const src = ArrayView.domSrc(srcSel(key));
        const openArr = () => (depth ? ArrayView.open('@' + path, c, { label, fixed: true, src }) : ArrayView.open(frame.func.id, c, { src }));
        const icon = h('button', { class: 'iconbtn avopen', type: 'button', 'data-src': key, title: 'Visualizza i valori', 'aria-label': `Visualizza i valori di ${label}`, html: GRID_ICON, onclick: openArr });
        const okey = fkey + '::' + path.toLowerCase();
        const detail = h('tr', { class: 'detail' + (st.varsOpen.has(okey) ? ' open' : '') + (changed ? ' changed' : '') }, h('td', { colspan: 3 },
          h('div', { class: 'det-wrap' }, h('div', { class: 'det-inner', ...(ind(depth + 1) || {}) },
            h('button', { class: 'avlink', type: 'button', tabindex: st.varsOpen.has(okey) ? '0' : '-1', title: 'Apri una finestra con i valori dell\'array', onclick: openArr }, 'visualizza i valori')))));
        const car = makeCaret(okey, label, (open) => { detail.classList.toggle('open', open); detail.querySelector('.avlink').tabIndex = open ? 0 : -1; });
        tb.append(h('tr', { class: 'arr' + (changed ? ' changed' : '') }, h('td', ind(depth), car.el, label, ...tags, icon), h('td', null, `${E.typeName(cellT(c))}[${dims.join(' × ')}]`), h('td', { class: 'muted' }, `${n} elementi`)));
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
        tb.append(h('tr', { class: 'objrow' + (changed ? ' changed' : '') }, h('td', ind(depth), car ? car.el : h('span', { class: 'caret-sp' }), label, ...tags), h('td', null, E.typeName(cellT(c))), h('td', null, fmt(v, key), loop ? h('span', { class: 'muted small' }, ' ↺ già sopra') : null)));
        if (car && car.isOpen && depth < 6) {
          const s2 = new Set(seen); s2.add(obj);
          for (const fc of obj.fields.values()) addCell(fc, fc.name, depth + 1, path + '.' + fc.name, s2);
          if (!obj.fields.size) tb.append(h('tr', { class: 'objrow' }, h('td', { colspan: 3, class: 'muted small', ...(ind(depth + 1) || {}) }, 'nessun attributo')));
        }
        return;
      }
      tb.append(h('tr', { class: changed ? 'changed' : '' }, h('td', ind(depth), depth || (v && v.t === 'Object') ? h('span', { class: 'caret-sp' }) : null, label, ...tags), h('td', null, E.typeName(cellT(c))), h('td', null, fmt(c.value))));
    };
    if (frame.self) addCell({ name: 'this', type: frame.self.cls.name, value: E.V.obj(frame.self) }, 'this', 0, 'this', new Set(), h('span', { class: 'ptag', title: 'l\'oggetto su cui lavora il metodo' }, 'oggetto'));
    for (const c of frame.vars.values()) addCell(c, c.name, 0, c.name, new Set());
    // attributi statici: uno per classe, condivisi da tutti gli oggetti
    for (const [cid, m] of statics) {
      const cls = interp.prog.classes.find((k) => k.id === cid); if (!cls) continue;
      const okey = 'statici::' + cls.name.toLowerCase();
      const car = makeCaret(okey, cls.name, () => renderVars());
      tb.append(h('tr', { class: 'objrow statrow' }, h('td', { colspan: 3 }, car.el, h('span', null, `${cls.name} · attributi statici`))));
      if (car.isOpen) for (const fc of m.values()) addCell(fc, `${cls.name}.${fc.name}`, 1, `static.${cls.name}.${fc.name}`, new Set());
    }
    for (const [k, v] of next) prev.set(k, v);
    tbl.append(tb); box.append(tbl);
  }

  /* ---- File (scheda) ---- */
  function renderFiles() {
    const box = $('#filesBody'); box.innerHTML = '';
    if (!st.vfs.size) box.append(h('p', { class: 'empty' }, 'Nessun file. I blocchi Apri/Leggi/Scrivi usano questi file: caricane uno dal computer o creane uno nuovo.'));
    const ul = h('ul', { class: 'files' });
    for (const [name, txt] of [...st.vfs].sort()) {
      const lines = txt ? txt.split(/\r?\n/).filter((x, i, a) => !(i === a.length - 1 && x === '')).length : 0;
      ul.append(h('li', null,
        h('div', { class: 'fname' }, h('strong', null, name), h('span', { class: 'muted small' }, `${lines} righe`)),
        h('div', { class: 'factions' },
          h('button', { class: 'btn small', type: 'button', onclick: () => editFile(name) }, 'Apri'),
          h('button', { class: 'btn small', type: 'button', onclick: () => download(name, txt, 'text/plain') }, 'Scarica'),
          h('button', { class: 'btn small danger', type: 'button', onclick: () => confirmBox('Eliminare il file?', `${name} verrà rimosso.`, 'Elimina', () => { st.vfs.delete(name); saveVfs(); }) }, 'Elimina'))));
    }
    box.append(ul);
  }
  function editFile(name) {
    const nm = field({ key: 'vfname', label: 'Nome del file', type: 'plain', placeholder: 'es. dati.txt' }, name || '');
    const ta = h('textarea', { class: 'mono', rows: 12, id: 'vfcontent', 'aria-label': 'Contenuto (una voce per riga)' });
    ta.value = name ? st.vfs.get(name) : '';
    openModal({ title: name ? 'Modifica file' : 'Nuovo file', wide: true, body: h('div', { class: 'fields' }, nm, h('label', { class: 'flabel', for: 'vfcontent' }, 'Contenuto (una voce per riga)'), ta), okText: 'Salva', onOk: () => {
      const n = nm._get().trim(); if (!n) return 'Dai un nome al file';
      if (name && n !== name) st.vfs.delete(name);
      st.vfs.set(n, ta.value); saveVfs(); return true;
    } });
  }

  /* ---- Codice ---- */
  function renderCode() {
    if (!paneVisible('code')) return;
    const code = CodeGen.generate(st.prog, st.lang);
    $('#codeOut').innerHTML = highlight(code, st.lang);
    $('#codeOut').dataset.raw = code;
  }
  /* il codice in righe di pezzi [classe, testo]: tk parola chiave, ts stringa, tn numero, tc commento */
  function codeTokens(code, lang) {
    const L = CodeGen.LANGS[lang];
    const kw = new Set(L.keywords);
    const cm = L.comment === '#' ? '#[^\\n]*' : '\\/\\/[^\\n]*';
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
  function highlight(code, lang) {
    const escH = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const lines = codeTokens(code, lang);
    // un a capo finale non apre una riga numerata vuota
    const tail = lines.length > 1 && !lines[lines.length - 1].length ? (lines.pop(), '\n') : '';
    return lines.map((ln) => '<span class="ln"></span>' + ln.map(([c, t]) => c ? `<span class="${c}">${escH(t)}</span>` : escH(t)).join('')).join('\n') + tail;
  }

  /* ------------------------- Schede e finestre mobili --------------------- */
  const PANES = [['console', 'Console'], ['vars', 'Variabili'], ['code', 'Codice'], ['files', 'File']];
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
        h('button', { role: 'tab', type: 'button', 'data-tab': id, title: 'Trascina per riordinare, oppure sul diagramma per sganciare', onclick: () => setTab(id) }, PANE_TITLE[id]),
        h('button', { class: 'detach', type: 'button', title: 'Sgancia in una finestra mobile', 'aria-label': 'Sgancia ' + PANE_TITLE[id], html: ICON_POP, onclick: (e) => { e.stopPropagation(); detachPane(id); } }));
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
        h('button', { class: 'iconbtn minbtn', type: 'button', title: 'Riduci alla barra del titolo', 'aria-label': 'Riduci ' + PANE_TITLE[id], 'aria-expanded': 'true', html: ICON_MIN, onclick: () => minimizeWin(id) }),
        h('button', { class: 'iconbtn dock', type: 'button', title: 'Riporta nel pannello', 'aria-label': 'Riporta ' + PANE_TITLE[id] + ' nel pannello', html: ICON_DOCK, onclick: () => dockPane(id) })),
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
    b.title = min ? 'Ripristina la finestra' : 'Riduci alla barra del titolo';
    b.setAttribute('aria-expanded', String(!min));
  }
  /* riduce la finestra alla sola barra del titolo, o la ripristina (force = true/false per imporre lo stato) */
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
    b.title = (hidden ? 'Mostra il pannello' : 'Nascondi il pannello') + ' (Ctrl+B)';
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
  function initLayout() {
    for (const id of layout.order) if (isFloat(id)) mountWin(id);
    buildTabs();
    window.addEventListener('resize', () => $$('.fwin').forEach(clampWin));
    // trascinare una scheda sul diagramma la sgancia in quel punto
    const col = winHost();
    col.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('application/x-flowlab-pane')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } });
    col.addEventListener('drop', (e) => {
      const id = e.dataTransfer.getData('application/x-flowlab-pane'); if (!id) return;
      e.preventDefault(); e.stopPropagation();
      if (!isFloat(id)) detachPane(id, { x: e.clientX, y: e.clientY });
    });
  }

  /* ----------------------------- Salvataggio ----------------------------- */
  function safeName(s) { return (s || 'programma').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').slice(0, 60) || 'programma'; }
  async function download(name, text, mime) {
    if (window.showSaveFilePicker && window.self === window.top) {
      try {
        const ext = name.split('.').pop();
        const hdl = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: ext.toUpperCase(), accept: { [mime]: ['.' + ext] } }] });
        const w = await hdl.createWritable(); await w.write(text); await w.close();
        toast('Salvato: ' + hdl.name, 'ok');
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
    if (ext.length) toast(`Salvato in formato .fprg esteso (${ext.join(', ')}). FlowLab lo riapre senza problemi; gli altri editor .fprg potrebbero non eseguirlo.`, 'warn');
    const name = st.fileName || safeName(st.prog.attrs.name) + '.fprg';
    const saved = await download(name, xml, 'application/xml');
    if (saved) { st.fileName = saved; st.dirty = false; autosave(); }
  }
  /* keepUndo: il programma di prima resta recuperabile con Annulla */
  function loadText(text, name, keepUndo) {
    let prog;
    try { prog = M.parseFprg(text); } catch (e) { toast(e.message, 'error'); return false; }
    if (isRunning()) stopRun();
    const before = keepUndo ? snapshot() : null;
    st.undo = before ? [before] : []; st.redo = []; st.prog = prog; st.fi = 0; st.sel = null; st.fileName = name || null; st.dirty = false; st.sourceUrl = null;
    run.errId = null; run.mainFrame = null;
    startView();
    render(); renderVars();
    setTimeout(fitIfLarge, 0);
    if (prog.skipped && prog.skipped.length) toast(`Aperto ${name || 'programma'}: ignorati ${prog.skipped.length} blocchi non supportati (${[...new Set(prog.skipped)].join(', ')})`, 'warn');
    else toast(`Aperto ${name || 'programma'}${before ? ' · Ctrl+Z per tornare al programma di prima' : ''}`, 'ok');
    return true;
  }

  /* ------------------------ Apertura da indirizzo web ----------------------
     FlowLab.html?url=https://…/programma.fprg apre il file all'avvio. Il sito deve
     permettere la lettura da altre pagine (CORS): va bene per esempio un file su
     GitHub (i link «blob» si trasformano nel file grezzo), GitHub Pages, un Gist. */
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
    try { abs = new URL(src, location.href).href; } catch (e) { toast('Indirizzo non valido: ' + u, 'error'); return false; }
    toast('Apro ' + abs + '…');
    let text;
    try {
      const r = await fetch(abs, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`il server risponde ${r.status} ${r.statusText || ''}`.trim());
      text = await r.text();
    } catch (e) {
      const why = e instanceof TypeError ? 'il sito non risponde oppure non permette di leggere il file da un\'altra pagina (CORS). Prova con un link a GitHub, a un Gist o a GitHub Pages' : e.message;
      toast(`Impossibile aprire ${abs}: ${why}`, 'error');
      return false;
    }
    const name = decodeURIComponent(abs.split(/[?#]/)[0].split('/').pop() || 'programma.fprg');
    if (!loadText(text, name, keepUndo)) return false;
    st.sourceUrl = abs;
    return true;
  }
  function openUrlDialog() {
    const f = field({ key: 'furl', label: 'Indirizzo del file .fprg', type: 'plain', placeholder: 'https://github.com/…/programma.fprg', hint: 'Funziona con i file su GitHub, nei Gist e su GitHub Pages; i link «blob» di GitHub vanno bene così come sono.' }, st.sourceUrl || '');
    openModal({ title: 'Apri da indirizzo web', body: h('div', { class: 'fields' }, f), okText: 'Apri', onOk: () => {
      const u = f._get().trim(); if (!u) return 'Scrivi l\'indirizzo del file';
      guardDirty(() => openUrl(u, true));
      return true;
    } });
  }
  /* link a FlowLab che apre direttamente questo programma */
  async function copyShareLink() {
    if (!st.sourceUrl) { infoBox('Link al programma', 'Il link si può creare per i programmi aperti da un indirizzo web (File › Apri da indirizzo web…). Pubblica il file .fprg online, per esempio su GitHub, e aprilo da lì.'); return; }
    const base = location.protocol.startsWith('http') ? location.href.split(/[?#]/)[0] : 'https://nicvac.github.io/flowlab/dist/FlowLab.html';
    const link = `${base}?url=${encodeURIComponent(st.sourceUrl)}`;
    try { await navigator.clipboard.writeText(link); toast('Link copiato: chi lo apre trova questo programma in FlowLab', 'ok'); }
    catch (e) { const ta = h('textarea', { class: 'mono', rows: 3, readonly: true, 'aria-label': 'Link al programma' }); ta.value = link; openModal({ title: 'Link al programma', wide: true, body: ta, okText: 'Chiudi', noCancel: true }); setTimeout(() => ta.select(), 50); }
  }
  function fitIfLarge() {
    const svg = $('#chart svg'); const wrap = $('#canvasWrap');
    if (!svg) return;
    if (svg.dataset.w * st.zoom > wrap.clientWidth - 24) setZoom(Math.max(0.55, (wrap.clientWidth - 24) / svg.dataset.w));
    wrap.scrollLeft = (wrap.scrollWidth - wrap.clientWidth) / 2;
  }
  function openFile() { $('#fileInput').click(); }

  /* ------------------------------ Moduli --------------------------------
     Un modulo è un programma .fprg. Se ha delle classi, le classi si copiano nel programma;
     se ha solo funzioni, si copiano le funzioni (e il programma resta nella sua vista).
     In entrambi i casi restano in sola lettura, segnate con il nome del modulo e da dove
     viene; il Main del modulo serve solo per provarlo e non si importa.
     src: "lib:argomento/Nome" (raccolta ufficiale), "url:indirizzo", "file:nome.fprg"
     Le raccolte di moduli sono cartelle GitHub: ogni sottocartella è un argomento
     (strutture_dati -> «Strutture dati») e contiene i file .fprg dei moduli. */
  const OFFICIAL_SRC = 'https://github.com/nicvac/flowlab/tree/main/moduli';
  const isMainClsOf = (c) => !!c && c === M.mainClass(st.prog);
  const topicTitle = (t) => { const x = String(t || '').replace(/[_-]+/g, ' ').trim(); return x ? x[0].toUpperCase() + x.slice(1) : 'Altri moduli'; };
  /* la classe è usata come tipo da qualche parte nel programma? */
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
  /* la funzione è chiamata da qualche parte nel programma (fuori dal suo modulo)? */
  function funcUsed(fn) {
    const re = new RegExp(`(^|[^\\w.])${fn.name}\\s*\\(`, 'i');
    let u = false;
    for (const f of st.prog.functions) if (!f.module) M.walk(f.body, (x) => { for (const k of ['expression', 'variable', 'start', 'end']) if (typeof x[k] === 'string' && re.test(x[k])) u = true; });
    return u;
  }
  /* cosa importare da un modulo: le classi (tranne quella del Main, se ha solo il Main)
     oppure, se il modulo ha solo funzioni, le funzioni tranne il Main */
  function moduleParts(text, src) {
    const mp = M.parseFprg(text);
    const name = (mp.attrs.name || String(src).replace(/^.*[/:]/, '').replace(/\.fprg$/i, '') || 'Modulo').trim();
    const about = mp.attrs.about || '';
    if (!M.hasClasses(mp) || M.isTrivialOO(mp)) {
      const funcs = mp.functions.slice(1);
      if (!funcs.length) throw new Error('il modulo non contiene funzioni da importare (il suo Main serve solo per provarlo)');
      return { kind: 'functions', mp, name, about, classes: [], funcs };
    }
    const mc = M.mainClass(mp);
    const classes = mp.classes.filter((c) => c !== mc || c.attributes.length || M.membersOf(mp, c).length > 1);
    if (!classes.length) throw new Error('il modulo non contiene classi da importare (il suo Main serve solo per provarlo)');
    const funcs = mp.functions.filter((f) => f !== mp.functions[0] && classes.some((c) => c.id === f.cls));
    return { kind: 'classes', mp, name, about, classes, funcs };
  }
  const cloneFunc = (f) => { const nf = JSON.parse(JSON.stringify(f)); nf.id = M.newId(); nf.body.forEach((s) => M.reId(s)); return nf; };
  /* copia il modulo nel programma (sostituisce una versione già importata) */
  function importModule(text, src) {
    if (isRunning()) { toast('Ferma il programma per importare un modulo', 'warn'); return false; }
    let parts;
    try { parts = moduleParts(text, src); } catch (e) { toast('Impossibile importare il modulo: ' + e.message, 'error'); return false; }
    const { name, classes, funcs } = parts;
    const same = (m) => m && m.name.toLowerCase() === name.toLowerCase();
    const oldC = (st.prog.classes || []).filter((c) => same(c.module));
    const oldF = st.prog.functions.filter((f) => same(M.moduleOfFunc(st.prog, f)));
    const fail = (msg) => { infoBox('Modulo non importato', msg); return false; };
    if (parts.kind === 'functions') {
      // funzioni: stessi nomi non ammessi (nella vista Funzioni non c'è l'overloading)
      for (const f of funcs) {
        if (E.BUILTINS[f.name.toLowerCase()] || f.name.toLowerCase() === 'main') return fail(`Il modulo ${name} contiene la funzione ${f.name}, che ha il nome di una funzione integrata.`);
        const clash = st.prog.functions.find((g) => !oldF.includes(g) && g.name.toLowerCase() === f.name.toLowerCase() && (!M.hasClasses(st.prog) || g.cls === M.mainClass(st.prog).id));
        if (clash) return fail(`Il modulo ${name} contiene la funzione ${f.name}, ma nel programma c'è già una funzione con questo nome${clash.module ? ` (dal modulo ${clash.module.name})` : ''}. Rinomina la tua funzione e riprova.`);
      }
      mutate(() => {
        const cur = func();
        st.prog.functions = st.prog.functions.filter((f) => !oldF.includes(f));
        const home = M.hasClasses(st.prog) ? M.mainClass(st.prog) : null;
        for (const f of funcs) {
          const nf = cloneFunc(f);
          if (home) Object.assign(nf, { cls: home.id, static: true, visibility: 'public', ctor: false });
          else { delete nf.cls; delete nf.visibility; delete nf.static; delete nf.ctor; delete nf.abstract; }
          nf.module = { name, src };
          st.prog.functions.push(nf);
        }
        st.fi = Math.max(0, st.prog.functions.indexOf(cur));
      });
      toast(oldF.length ? `Modulo ${name} aggiornato` : `Modulo ${name} importato: ${funcs.map((f) => f.name + '()').join(', ')}`, 'ok');
      return true;
    }
    if (!M.hasClasses(st.prog)) M.wrapInClass(st.prog);
    for (const c of classes) {
      const clash = st.prog.classes.find((k) => !oldC.includes(k) && k.name.toLowerCase() === c.name.toLowerCase());
      if (clash) return fail(`Il modulo ${name} contiene la classe ${c.name}, ma nel programma c'è già una classe con questo nome${clash.module ? ` (dal modulo ${clash.module.name})` : ''}. Rinomina la tua classe e riprova.`);
    }
    mutate(() => {
      // posizione: quella della versione precedente, altrimenti a destra delle classi esistenti
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
    toast(oldC.length ? `Modulo ${name} aggiornato` : `Modulo ${name} importato: ${classes.map((c) => M.classTitle(c)).join(', ')}`, 'ok');
    return true;
  }
  /* ---- raccolte di moduli su GitHub ---- */
  /* "https://github.com/utente/repo/tree/ramo/cartella" -> { owner, repo, ref, path } */
  function ghSource(u) {
    const m = String(u).trim().match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+)(?:\/tree\/([^/\s]+)(?:\/([^?#\s]*))?)?\/?(?:[?#].*)?$/i);
    if (!m) return null;
    return { owner: m[1], repo: m[2].replace(/\.git$/i, ''), ref: m[3] || 'HEAD', path: (m[4] || '').replace(/\/+$/, '') };
  }
  const srcLabel = (u) => { const g = ghSource(u); return g ? `${g.owner}/${g.repo}${g.path ? '/' + g.path : ''}` : u; };
  function getSources() { const v = store.get('moduleSources'); return Array.isArray(v) ? v : [OFFICIAL_SRC]; }
  function setSources(list) { store.set('moduleSources', list); }
  /* moduli di una raccolta: [{ topic, id, text, src }] (con cache di qualche ora) */
  const SRC_TTL = 6 * 3600 * 1000;
  async function loadSource(u, force) {
    const key = 'modsrc:' + u;
    const cached = store.get(key);
    if (!force && cached && Date.now() - cached.time < SRC_TTL) return { list: cached.list, cached: true };
    const g = ghSource(u);
    if (!g) throw new Error('non è il link di una cartella GitHub');
    const r = await fetch(`https://api.github.com/repos/${g.owner}/${g.repo}/git/trees/${encodeURIComponent(g.ref)}?recursive=1`, { cache: 'no-cache' });
    if (r.status === 403 || r.status === 429) throw new Error('GitHub ha raggiunto il limite di richieste: riprova tra qualche minuto');
    if (!r.ok) throw new Error(r.status === 404 ? 'repository o cartella non trovati (deve essere pubblico)' : `GitHub risponde ${r.status}`);
    const tree = (await r.json()).tree || [];
    const pre = g.path ? g.path + '/' : '';
    const files = tree.filter((x) => x.type === 'blob' && /\.fprg$/i.test(x.path) && x.path.startsWith(pre)).map((x) => x.path);
    const official = u === OFFICIAL_SRC;
    const list = [];
    await Promise.all(files.map(async (p) => {
      const rel = p.slice(pre.length).split('/');
      const id = rel.pop().replace(/\.fprg$/i, ''), topic = rel.length ? rel[rel.length - 1] : '';
      const raw = `https://raw.githubusercontent.com/${g.owner}/${g.repo}/${g.ref}/${p.split('/').map(encodeURIComponent).join('/')}`;
      try { const t = await fetch(raw, { cache: 'no-cache' }); if (t.ok) list.push({ topic, id, text: await t.text(), src: official ? `lib:${topic}/${id}` : 'url:' + raw }); } catch (e) { /* file non leggibile: si salta */ }
    }));
    list.sort((a, b) => (a.topic + '/' + a.id).localeCompare(b.topic + '/' + b.id));
    if (list.length) store.set(key, { time: Date.now(), list });
    return { list, cached: false };
  }
  /* copia inclusa in FlowLab della raccolta ufficiale (per quando GitHub non risponde) */
  const builtinList = () => ModuleLibrary.map((m) => ({ topic: m.topic, id: m.id, text: m.text, src: `lib:${m.topic}/${m.id}` }));
  async function libText(src) {
    const m = /^lib:(.+)\/([^/]+)$/.exec(src || ''); if (!m) return null;
    const g = ghSource(OFFICIAL_SRC);
    try {
      const r = await fetch(`https://raw.githubusercontent.com/${g.owner}/${g.repo}/${g.ref}/${g.path}/${m[1]}/${m[2]}.fprg`, { cache: 'no-cache' });
      if (r.ok) return await r.text();
    } catch (e) { /* si usa la copia inclusa */ }
    const b = ModuleLibrary.find((x) => x.topic === m[1] && x.id === m[2]);
    return b ? b.text : null;
  }
  async function fetchText(u) {
    const abs = new URL(rawUrl(u), location.href).href;
    const r = await fetch(abs, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`il server risponde ${r.status}`);
    return { text: await r.text(), abs };
  }
  async function importModuleUrl(u) {
    try { const { text, abs } = await fetchText(u); return importModule(text, 'url:' + abs); }
    catch (e) { toast(`Impossibile scaricare il modulo: ${e instanceof TypeError ? 'il sito non risponde oppure non permette di leggere il file (CORS)' : e.message}`, 'error'); return false; }
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
    if (src.startsWith('lib:')) { const t = await libText(src); if (t) importModule(t, src); else toast(`Il modulo ${name} non è più nella raccolta ufficiale`, 'error'); return; }
    if (src.startsWith('url:')) { importModuleUrl(src.slice(4)); return; }
    toast(`Scegli di nuovo il file del modulo ${name}`); importModuleFile();
  }
  function removeModule(name) {
    if (isRunning()) { toast('Ferma il programma per rimuovere un modulo', 'warn'); return; }
    const m = M.modulesOf(st.prog).find((x) => x.name === name); if (!m) return;
    const used = m.classes.some((c) => classUsed(c)) || m.funcs.some((f) => !m.classes.length && funcUsed(f));
    const what = m.classes.length ? `Le classi ${m.classes.map((c) => M.classTitle(c)).join(', ')}` : `Le funzioni ${m.funcs.map((f) => f.name + '()').join(', ')}`;
    confirmBox('Rimuovere il modulo?', `${what} del modulo ${name} verranno tolte dal programma.${used ? ' Il programma le usa: andrà corretto.' : ''}`, 'Rimuovi', () => mutate(() => {
      const cur = func();
      st.prog.functions = st.prog.functions.filter((f) => !m.funcs.includes(f) && !m.classes.some((c) => c.id === f.cls));
      if (m.classes.length) st.prog.classes = st.prog.classes.filter((k) => !m.classes.includes(k));
      st.fi = Math.max(0, st.prog.functions.indexOf(cur)); st.usel = null;
      if (m.classes.length) st.uml = true;
    }));
  }
  /* dialogo: moduli nel programma, raccolte di moduli (GitHub) per argomento, altri moduli */
  function moduleDialog() {
    if (isRunning()) { toast('Ferma il programma per importare un modulo', 'warn'); return; }
    let closeIt = null;
    const done = (fn) => () => { if (closeIt) closeIt(); fn(); };
    const have = () => new Map(M.modulesOf(st.prog).map((m) => [m.name.toLowerCase(), m]));
    // moduli già importati
    const mine = h('div', { class: 'modlib' });
    const drawMine = () => {
      mine.innerHTML = '';
      const ms = M.modulesOf(st.prog);
      if (!ms.length) return;
      mine.append(h('h3', { class: 'modh' }, 'Moduli nel programma'));
      for (const m of ms) mine.append(h('div', { class: 'modrow' },
        h('div', { class: 'modinfo' }, h('strong', null, m.name), h('span', { class: 'modcls mono' }, m.classes.length ? m.classes.map((c) => M.classTitle(c)).join(' · ') : m.funcs.map((f) => f.name + '()').join(' · ')), h('span', { class: 'muted small' }, m.src.startsWith('lib:') ? 'raccolta ufficiale' : m.src.replace(/^(url|file):/, ''))),
        h('button', { class: 'btn small', type: 'button', onclick: done(() => updateModule(m.name)) }, 'Aggiorna'),
        h('button', { class: 'btn small danger', type: 'button', onclick: done(() => removeModule(m.name)) }, 'Rimuovi')));
    };
    drawMine();
    // raccolte
    const coll = h('div', { class: 'modlib' });
    const row = (m) => {
      let info; try { info = moduleParts(m.text, m.src); } catch (e) { return null; }
      const got = have().get(info.name.toLowerCase());
      return h('div', { class: 'modrow' },
        h('div', { class: 'modinfo' }, h('strong', null, info.name), h('span', { class: 'modcls mono' }, info.kind === 'classes' ? info.classes.map((c) => M.classTitle(c)).join(' · ') : info.funcs.map((f) => f.name + '()').join(' · ')), info.about ? h('p', { class: 'muted small' }, info.about) : null),
        h('button', { class: 'btn small' + (got ? '' : ' primary'), type: 'button', onclick: done(() => importModule(m.text, m.src)) }, got ? 'Aggiorna' : 'Importa'));
    };
    // albero espandibile: raccolta › argomento › moduli (lo stato aperto/chiuso si ricorda)
    // la prima volta la raccolta ufficiale è già aperta, così si vede subito com'è fatta
    const openSet = new Set(store.get('modOpen', [OFFICIAL_SRC]));
    // barra cliccabile: freccia grande, icona, titolo, conteggio
    const ICON_CHEV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
    const ICON_REPO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h11l3 3v13H5z"/><path d="M8 4v6l2-1.5L12 10V4"/><path d="M8 14h8M8 17h6"/></svg>';
    const ICON_DIR = '<svg class="dir-closed" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/></svg><svg class="dir-open" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v2"/><path d="M3 18V6M3 18l2.6-7.2a1 1 0 0 1 .9-.8H21a.7.7 0 0 1 .7.9L19.4 18a1 1 0 0 1-1 .8H3"/></svg>';
    const count = (n) => `${n} ${n === 1 ? 'modulo' : 'moduli'}`;
    const keepOpen = (key, det) => det.addEventListener('toggle', () => { if (det.open) openSet.add(key); else openSet.delete(key); store.set('modOpen', [...openSet]); });
    const fill = (box, list, u) => {
      box.innerHTML = '';
      if (!list.length) { box.append(h('p', { class: 'muted small' }, 'Nessun file .fprg in questa cartella.')); return; }
      const topics = new Map();
      for (const m of list) { if (!topics.has(m.topic)) topics.set(m.topic, []); topics.get(m.topic).push(m); }
      for (const [topic, ms] of topics) {
        const key = u + '|' + topic;
        const rows = ms.map(row).filter(Boolean);
        const det = h('details', { class: 'modtopic', open: openSet.has(key) },
          h('summary', { class: 'modbar', title: 'Clic per mostrare o nascondere i moduli' }, h('span', { class: 'modchev', html: ICON_CHEV }), h('span', { class: 'modicon', html: ICON_DIR }),
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
          box.innerHTML = ''; box.append(h('p', { class: 'muted small' }, 'Caricamento da GitHub…'));
          const fallback = (why) => { fill(box, builtinList(), u); box.prepend(h('p', { class: 'muted small' }, `${why}: questa è la copia della raccolta inclusa in FlowLab.`)); showCount(); };
          loadSource(u, again).then(({ list }) => { if (!list.length && official) fallback('La raccolta su GitHub è vuota o non ancora pubblicata'); else { fill(box, list, u); showCount(); } }).catch((e) => {
            if (official) fallback(`GitHub non risponde (${e.message})`);
            else { box.innerHTML = ''; box.append(h('p', { class: 'formerr' }, `Impossibile leggere la raccolta: ${e.message}`)); }
          });
        };
        // i pulsanti nel titolo non devono aprire o chiudere la raccolta
        const btn = (title, text, fn) => h('button', { class: 'iconbtn', type: 'button', title, 'aria-label': title, onclick: (e) => { e.preventDefault(); e.stopPropagation(); fn(); } }, text);
        const det = h('details', { class: 'modsrc', open: openSet.has(u) },
          h('summary', { class: 'modsrchead modbar', title: 'Clic per mostrare o nascondere gli argomenti della raccolta' }, h('span', { class: 'modchev', html: ICON_CHEV }), h('span', { class: 'modicon', html: ICON_REPO }),
            h('span', { class: 'modsname mono' }, srcLabel(u)), official ? h('span', { class: 'ptag' }, 'ufficiale') : null, h('span', { class: 'grow' }), badge,
            btn('Ricarica da GitHub', '↻', () => { det.open = true; load(true); }),
            btn('Togli questa raccolta', '✕', () => { setSources(getSources().filter((x) => x !== u)); drawSources(); })),
          box);
        keepOpen(u, det);
        det.addEventListener('toggle', () => { if (det.open && !loaded) load(force); });
        coll.append(det);
        if (det.open) load(force);
      }
      if (!srcs.includes(OFFICIAL_SRC)) coll.append(h('button', { class: 'btn small', type: 'button', onclick: () => { setSources([OFFICIAL_SRC, ...getSources()]); drawSources(); } }, 'Rimetti la raccolta ufficiale'));
    };
    drawSources(false);
    const srcW = field({ key: 'msrc', label: 'Aggiungi una raccolta di moduli (link a una cartella GitHub)', type: 'plain', placeholder: 'https://github.com/utente/repo/tree/main/moduli', hint: 'Ogni sottocartella è un argomento (es. strutture_dati) e contiene i file .fprg dei moduli. Il repository deve essere pubblico.' }, '');
    const addSrc = () => {
      const u = srcW._get().trim(); if (!u) { toast('Incolla il link della cartella GitHub', 'warn'); return; }
      if (!ghSource(u)) { toast('Serve il link di una cartella GitHub, es. https://github.com/utente/repo/tree/main/moduli', 'warn'); return; }
      if (!getSources().includes(u)) setSources([...getSources(), u]);
      srcW._input.value = ''; drawSources();
    };
    const addRow = h('div', { class: 'modadd' }, srcW, h('button', { class: 'btn small', type: 'button', onclick: addSrc }, 'Aggiungi la raccolta'));
    srcW._input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); addSrc(); } });
    // altri moduli
    const urlW = field({ key: 'murl', label: 'Oppure da un indirizzo web', type: 'plain', placeholder: 'https://github.com/…/Modulo.fprg' }, '');
    const other = h('div', { class: 'modother' },
      h('button', { class: 'btn small', type: 'button', onclick: done(importModuleFile) }, 'Importa da un file .fprg…'),
      urlW, h('button', { class: 'btn small', type: 'button', onclick: () => { const u = urlW._get().trim(); if (!u) { toast('Scrivi l\'indirizzo del modulo', 'warn'); return; } if (closeIt) closeIt(); importModuleUrl(u); } }, 'Importa dall\'indirizzo'));
    const body = h('div', { class: 'fields' },
      h('p', { class: 'help' }, 'Un modulo è un programma .fprg da riusare: le sue classi o funzioni si importano nel tuo programma in sola lettura (il Main del modulo serve solo per provarlo). La descrizione di un modulo è quella scritta in Proprietà del programma.'),
      mine, h('h3', { class: 'modh' }, 'Raccolte di moduli'), coll, addRow, h('h3', { class: 'modh' }, 'Altri moduli'), other);
    closeIt = openModal({ title: 'Importa un modulo', body, wide: true, okText: 'Chiudi', noCancel: true }).close;
    setTimeout(() => { const mb = body.closest('.modal-body'); if (mb) mb.scrollTop = 0; const b = body.querySelector('.modsrc > summary'); if (b) b.focus(); }, 20);
  }

  function readFileObj(file) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      if (/\.(fprg|xml)$/i.test(file.name) || /^\s*<\?xml/i.test(r.result) || r.result.toLowerCase().includes('<' + M.FPRG_ROOT)) loadText(r.result, file.name);
      else { st.vfs.set(file.name, r.result); saveVfs(); setTab('files'); toast(`File di testo ${file.name} aggiunto alla scheda File`, 'ok'); }
    };
    r.readAsText(file);
  }
  function guardDirty(action) {
    if (!st.dirty) { action(); return; }
    confirmBox('Modifiche non salvate', 'Il programma attuale ha modifiche non salvate. Vuoi continuare e perderle?', 'Continua', action);
  }
  function newProgram() {
    guardDirty(() => { if (isRunning()) stopRun(); st.prog = M.newProgram(); st.fi = 0; st.sel = null; st.uml = isOO(); st.usel = null; st.undo = []; st.redo = []; st.fileName = null; st.dirty = false; run.mainFrame = null; render(); renderVars(); });
  }
  function loadExample(id) {
    const ex = Examples.get(id); if (!ex) return;
    guardDirty(() => {
      if (isRunning()) stopRun();
      st.prog = ex.make(); st.fi = 0; st.sel = null; st.usel = null; st.undo = []; st.redo = []; st.fileName = null; st.dirty = false; run.mainFrame = null; run.errId = null;
      startView();
      conClear(); render(); renderVars(); setTimeout(fitIfLarge, 0);
    });
  }

  function exportSvg(source, css) {
    // l'esportazione è sempre nella vista estesa
    if (!source && st.compact && !isUml() && !(isOO() && func().abstract)) {
      const f = func(), c = isOO() ? M.classOf(st.prog, f) : null;
      source = svgFromString(new RenderLib.Renderer().func(f, st.expanded, isOO() ? { owner: c ? c.name : '', isMain: st.fi === 0 } : {}).svg);
    }
    const svg = (source || $('#chart svg')).cloneNode(true);
    svg.setAttribute('width', svg.dataset.w); svg.setAttribute('height', svg.dataset.h);
    svg.insertBefore(h('style', null, css || exportCss()), svg.firstChild);
    $$('.hits, .ctoggle, .uadd, .uhit, .umodtog', svg).forEach((x) => x.remove());
    return new XMLSerializer().serializeToString(svg);
  }

  /* ------------------------- Esportazione in PDF -------------------------
     Copertina con i dati e l'indice, diagramma delle classi, diagramma di flusso
     di ogni funzione o metodo (con tutti i testi espansi), codice sorgente. */
  const svgFromString = (str) => { const d = h('div', { html: str }); return d.firstElementChild; };
  const loadImg = (svgStr) => new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error('immagine non disponibile')); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr); });
  async function exportPdf() {
    if (isRunning()) { toast('Ferma il programma prima di esportare', 'warn'); return; }
    toast('Preparo il PDF…');
    // colori del tema chiaro, qualunque sia il tema in uso
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
    const title = prog.attrs.name || 'Programma senza nome';
    const sigOf = (f) => `${f.name}(${f.params.map((p) => `${p.name}${p.array ? '[]' : ''}: ${E.typeName(p.type)}`).join(', ')})${M.rets(f).length ? ': ' + M.rets(f).map((r) => E.typeName(r.type)).join(', ') : ''}`;
    const heading = (f) => {
      if (f === prog.functions[0]) return 'Inizio (programma principale)';
      const c = oo ? M.classOf(prog, f) : null;
      if (!c) return 'Funzione ' + sigOf(f);
      if (f.ctor) return `Costruttore di ${c.name}: new ${sigOf(f)}`;
      return `${f.abstract ? 'Metodo astratto' : f.static ? 'Metodo statico' : 'Metodo'} ${c.name}.${sigOf(f)}`;
    };
    // ordine: Main, poi per classe (costruttori e metodi) o le funzioni nell'ordine del programma
    const funcs = oo ? [prog.functions[0], ...prog.classes.flatMap((c) => { const ms = M.membersOf(prog, c).filter((f) => f !== prog.functions[0]); return [...ms.filter((f) => f.ctor), ...ms.filter((f) => !f.ctor)]; })] : prog.functions.slice();

    /* ---- copertina ---- */
    let p = doc.page();
    let y = 92;
    doc.text(p, M0, y, 'FlowLab', { font: 'F2', size: 12, color: ACCENT }); y += 34;
    for (const l of PdfLib.wrap(title, 'F2', 24, CW)) { doc.text(p, M0, y, l, { font: 'F2', size: 24, color: INK }); y += 30; }
    const meta = [prog.attrs.authors ? 'Autori: ' + prog.attrs.authors : null, `Esportato il ${new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}`, oo ? `Programma a oggetti: ${prog.classes.length} ${prog.classes.length === 1 ? 'classe' : 'classi'}` : `Programma a funzioni: ${prog.functions.length} ${prog.functions.length === 1 ? 'diagramma' : 'diagrammi'}`].filter(Boolean);
    for (const m of meta) { doc.text(p, M0, y, m, { size: 11, color: MUTED }); y += 16; }
    y += 10; doc.line(p, M0, y, M0 + CW, y); y += 24;
    if (String(prog.attrs.about || '').trim()) {
      for (const l of PdfLib.wrap(prog.attrs.about, 'F1', 11.5, CW)) { doc.text(p, M0, y, l, { size: 11.5 }); y += 16; }
      y += 14;
    }
    doc.text(p, M0, y, 'Contenuto', { font: 'F2', size: 13 }); y += 20;
    // indice: i numeri di pagina si scrivono alla fine, quando l'impaginazione è nota
    const toc = [];
    if (oo) toc.push({ key: 'uml', label: 'Diagramma delle classi' });
    for (const f of funcs) toc.push({ key: f.id, label: heading(f) });
    toc.push({ key: 'code', label: `Codice sorgente (${CodeGen.LANGS[st.lang].label})` });
    const tocAt = [], sectionPage = {};
    for (const t of toc) {
      PdfLib.wrap(t.label, 'F1', 10.5, CW - 50).forEach((l, k, arr) => {
        if (y > BOTTOM - 10) { p = doc.page(); y = TOP + 10; }
        doc.text(p, M0 + 10, y, l, { size: 10.5 });
        if (k === arr.length - 1) tocAt.push({ p, y, key: t.key });
        y += 14;
      });
    }

    /* ---- diagrammi: ognuno su una pagina alta quanto serve (modulo continuo) ----
       scala fissa: il testo dei blocchi (12,5 px) diventa di 9 pt; i diagrammi più larghi
       di un A4 allargano la pagina invece di rimpicciolirsi */
    const K = 2.2; // pixel per punto: risoluzione delle immagini
    const STRIP = 8000; // pixel: i diagrammi molto alti si disegnano a strisce (limiti dei canvas)
    const SCALE = 9 / 12.5;
    async function placeDiagram(key, label, svgStr, W, Hh, note) {
      const head = 30 + (note ? 18 : 0), foot = doc.H - BOTTOM + 14;
      let scale = SCALE;
      // oltre le dimensioni massime di una pagina PDF il diagramma si rimpicciolisce
      const maxImg = doc.maxH - TOP - head - foot;
      if (svgStr && Hh * scale > maxImg) scale = maxImg / Hh;
      if (svgStr && W * scale > doc.maxH - M0 * 2) scale = (doc.maxH - M0 * 2) / W;
      const w = W * scale, hpt = svgStr ? Hh * scale : 0;
      p = doc.page(TOP + head + hpt + foot, svgStr ? w + M0 * 2 : 0); y = TOP;
      const cwp = p.w - M0 * 2; // larghezza utile di questa pagina
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
        const u = UmlLib.render(prog, null);
        await placeDiagram('uml', 'Diagramma delle classi', exportSvg(svgFromString(u.svg), css), u.W, u.H);
      }
      const all = new Set();
      for (const f of prog.functions) M.walk(f.body, (x) => all.add(x.id));
      const r = new RenderLib.Renderer();
      for (const f of funcs) {
        if (f.abstract) {
          const c = M.classOf(prog, f);
          await placeDiagram(f.id, heading(f), null, 1, 1, `Senza corpo: lo definiscono le sottoclassi di ${c.name}.`);
          continue;
        }
        const c = oo ? M.classOf(prog, f) : null;
        const out = r.func(f, all, oo ? { owner: c ? c.name : '', isMain: f === prog.functions[0] } : undefined);
        await placeDiagram(f.id, heading(f), exportSvg(svgFromString(out.svg), css), out.W, out.H);
      }
    } catch (e) { toast('Impossibile creare le immagini dei diagrammi: ' + e.message, 'error'); return; }

    /* ---- codice: pagine A4 orizzontali con margini ridotti, colorato come nella scheda Codice ---- */
    const code = CodeGen.generate(prog, st.lang).replace(/\n$/, '');
    const LW = doc.H, LHt = doc.W, MC = 22, CTOP = 34, CBOT = LHt - 22; // A4 orizzontale
    const codePage = () => { const pg = doc.page(LHt, LW); pg.compact = true; return pg; };
    p = codePage(); y = CTOP;
    sectionPage.code = doc.pages.length;
    doc.text(p, MC, y + 12, `Codice sorgente · ${CodeGen.LANGS[st.lang].label}`, { font: 'F2', size: 12.5 }); y += 20;
    doc.line(p, MC, y, LW - MC, y, { color: [207, 216, 225] }); y += 14;
    const FS = 8.6, LH = 10.6, NW = 26, CH = 0.6 * FS, cols = Math.floor((LW - MC * 2 - NW) / CH);
    const FONT = { '': 'F3', tk: 'F5', ts: 'F3', tn: 'F3', tc: 'F6' };
    codeTokens(code, st.lang).forEach((toks, i) => {
      // pezzi colorati con la loro colonna; le righe troppo lunghe vanno a capo
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

    /* ---- intestazione e numeri di pagina ---- */
    for (const t of tocAt) { const n = String(sectionPage[t.key] || ''); doc.text(t.p, M0 + CW - PdfLib.textWidth(n, 'F1', 10.5), t.y, n, { size: 10.5, color: MUTED }); }
    const N = doc.pages.length;
    doc.pages.forEach((pg, i) => {
      if (i === 0) { doc.text(pg, M0, pg.h - 26, `${i + 1} / ${N}`, { size: 8.5, color: MUTED }); return; }
      // le pagine del codice hanno margini ridotti
      const mx = pg.compact ? 22 : M0, ty = pg.compact ? 16 : 30, fy = pg.compact ? 12 : 26;
      doc.text(pg, mx, ty, title, { size: 8.5, color: MUTED });
      doc.line(pg, mx, ty + 6, pg.w - mx, ty + 6, { color: [225, 231, 237], width: 0.6 });
      const t = `${i + 1} / ${N}`;
      doc.text(pg, pg.w - mx - PdfLib.textWidth(t, 'F1', 8.5), pg.h - fy, t, { size: 8.5, color: MUTED });
    });
    const blob = doc.build({ title, author: prog.attrs.authors || '' });
    window.__lastPdf = blob; // per i test automatici
    await download(safeName(prog.attrs.name) + '.pdf', blob, 'application/pdf');
  }
  function exportCss() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    let css = `text{font:${RenderLib.R_.font};fill:${v('--sh-text')};text-anchor:middle}.cline-t{text-anchor:start}.comment text{font-weight:400;font-style:italic}.badge{font-size:10px}.c-in .badge{fill:${v('--s-in')}}.c-out .badge{fill:${v('--s-out')}}.c-decl .badge{fill:${v('--s-decl')}}.blabel{font-size:11px;font-weight:600;fill:${v('--muted')}}.flow{fill:none;stroke:${v('--flow')};stroke-width:1.6}.ahead{fill:${v('--flow')}}.joint{fill:${v('--flow')}}.shape>path,.shape>rect{stroke-width:1.6}.inner{fill:none!important}.note{stroke-dasharray:4 3}svg{background:${v('--paper')}}`;
    for (const c of ['term', 'decl', 'assign', 'in', 'out', 'cond', 'loop', 'call', 'comment', 'brk', 'file', 'inc']) css += `.c-${c}>path,.c-${c}>rect{fill:${v('--f-' + c)};stroke:${v('--s-' + c)}}`;
    // diagramma delle classi
    css += `.ubg{fill:${v('--paper')};stroke:${v('--s-call')};stroke-width:1.6}.uheadbg{fill:${v('--f-call')}}.main .uheadbg{fill:${v('--f-term')}}.main .ubg{stroke:${v('--s-term')}}.usep{stroke:${v('--s-call')};stroke-width:1.2}.uname{font:700 14px "Atkinson Hyperlegible",sans-serif;text-anchor:middle}.ustereo{font:italic 11.5px "Atkinson Hyperlegible",sans-serif;fill:${v('--muted')};text-anchor:middle}.umem{font:400 12.5px "JetBrains Mono",monospace;text-anchor:start}.urel{fill:none;stroke:${v('--flow')};stroke-width:1.6}.minh{fill:${v('--paper')};stroke:${v('--flow')};stroke-width:1.6}.mopen{fill:none;stroke:${v('--flow')};stroke-width:1.6}.ulab{font:600 11.5px "JetBrains Mono",monospace;fill:${v('--muted')};text-anchor:start}`;
    return css;
  }
  function exportPng() {
    const s = exportSvg();
    const svgEl = $('#chart svg');
    const w = +svgEl.dataset.w, hh = +svgEl.dataset.h, k = 2;
    const img = new Image();
    img.onload = () => {
      const c = h('canvas', { width: w * k, height: hh * k });
      const x = c.getContext('2d'); x.scale(k, k); x.drawImage(img, 0, 0);
      c.toBlob((b) => download(safeName(st.prog.attrs.name) + '_' + (isUml() ? 'classi' : safeName(fname(func()))) + '.png', b, 'image/png'));
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
      { label: 'Nuovo programma', key: 'Ctrl+Alt+N', do: newProgram },
      { label: 'Apri file .fprg…', key: 'Ctrl+O', do: openFile },
      { label: 'Apri da indirizzo web…', key: 'Ctrl+Maiusc+O', do: openUrlDialog },
      { label: 'Salva come .fprg', key: 'Ctrl+S', do: saveFile },
      { label: 'Copia il link a questo programma', key: 'Ctrl+Maiusc+L', do: copyShareLink },
      '-',
      { label: 'Importa un modulo…', key: 'Ctrl+I', do: moduleDialog },
      '-',
      { label: 'Esporta diagramma SVG', key: 'Ctrl+Maiusc+G', do: exportSvgFile },
      { label: 'Esporta diagramma PNG', key: 'Ctrl+Maiusc+E', do: exportPng },
      { label: 'Esporta tutto il progetto in PDF', key: 'Ctrl+P', do: exportPdf },
      { label: 'Scarica codice sorgente', key: 'Ctrl+Maiusc+S', do: downloadCode },
      '-',
      { label: 'Proprietà del programma…', key: 'Alt+Invio', do: editProgram },
    ]);
  }
  function exportSvgFile() { download(safeName(st.prog.attrs.name) + '_' + (isUml() ? 'classi' : safeName(fname(func()))) + '.svg', exportSvg(), 'image/svg+xml'); }
  function downloadCode() { download(safeName(st.prog.attrs.name) + '.' + CodeGen.LANGS[st.lang].ext, CodeGen.generate(st.prog, st.lang), 'text/plain'); }
  function examplesMenu(btn) {
    const r = btn.getBoundingClientRect();
    const box = h('div', { class: 'ctxmenu examples' }, h('div', { class: 'pophead' }, 'Programmi di esempio'));
    for (const ex of Examples.list) box.append(h('button', { type: 'button', onclick: () => { closePop(); loadExample(ex.id); } }, h('span', null, ex.title), h('span', { class: 'tag' }, ex.tags)));
    openPop(r.left, r.bottom + 4, box);
  }
  function helpDialog() {
    const fns = Object.entries(E.BUILTINS).map(([k, b]) => h('tr', null, h('td', { class: 'mono' }, b.doc.split(' — ')[0]), h('td', null, b.doc.split(' — ')[1] || '')));
    const ops = [
      ['+  -  *  /', 'Aritmetica. La divisione / dà sempre un numero reale'], ['mod  %', 'Resto della divisione'], ['^', 'Potenza (2 ^ 3 = 8)'],
      ['&', 'Unisce testi e numeri: "Totale: " & t'], ['=  ==   !=  <>', 'Uguale, diverso'], ['<  <=  >  >=', 'Confronti'],
      ['and  &&   or  ||   not  !', 'Operatori logici'], ['true  false  Pi', 'Costanti'], ['v[i]', 'Elemento i di un array (da 0)'],
      ['v ← quadrati(10)', 'Funzione che restituisce un array: v diventa l\'array restituito (forma «array» nel valore restituito)'],
      ['massimo<T>(v: T[], n)', 'Tipo Generico T: un tipo qualsiasi, ricavato dagli argomenti della chiamata. Si sceglie «Nuovo Tipo Generico» nel menu del tipo di un parametro'],
    ].map(([a, b]) => h('tr', null, h('td', { class: 'mono' }, a), h('td', null, b)));
    const oo = [
      ['p ← new Punto(1, 2)', 'Crea un oggetto: esegue il costruttore con quei parametri'], ['p.x   p.sposta(3, 4)', 'Attributo e metodo di un oggetto'],
      ['this.x', 'Attributo dell\'oggetto su cui si sta lavorando (in un metodo basta x)'], ['Punto.contatore   Punto.crea()', 'Attributo o metodo statico: si usa con il nome della classe'],
      ['super(nome)', 'Blocco Chiamata, primo blocco del costruttore: esegue il costruttore della classe madre'], ['super.descrivi()', 'Esegue la versione del metodo della classe madre'],
      ['null   p = null', 'Nessun oggetto: si può assegnare e confrontare'], ['«abstract»', 'Classe astratta: non si creano oggetti. Un metodo astratto non ha corpo e lo definiscono le sottoclassi'], ['+  -  #', 'Accesso pubblico, privato, protetto (controllato durante l\'esecuzione)'],
      ['ArrayList<T>', 'Classe con Tipo Generico T, scelto da chi la usa: nasce scegliendo «Nuovo Tipo Generico» per un attributo o un parametro di un metodo'], ['l ← new ArrayList<Intero>()', 'Oggetto di una classe con Tipo Generico; con new ArrayList<>() il tipo si ricava dalla variabile'],
      ['a ← b', 'Con due array: a diventa lo stesso array di b (come in Java)'], ['Ctrl+I', 'Importa un modulo: classi già pronte (ArrayList, Stack, Queue, ordinamento…) da riusare in sola lettura'], ['p.   Punto.', 'Scrivendo il punto dopo un oggetto o una classe compare l\'elenco dei metodi e degli attributi utilizzabili'],
    ].map(([a, b]) => h('tr', null, h('td', { class: 'mono' }, a), h('td', null, b)));
    const keys = SHORTCUTS.flatMap(([g, rows]) => [h('tr', { class: 'kgroup' }, h('td', { colspan: 2 }, g)), ...rows.map(([a, b]) => h('tr', null, h('td', { class: 'mono' }, a), h('td', null, b)))]);
    const body = h('div', { class: 'help-body' },
      h('p', null, 'Fai clic su una freccia del diagramma per aggiungere un blocco. Trascina un blocco su un\'altra freccia per spostarlo. I file .fprg si aprono e si salvano con lo stesso formato XML usato dagli editor di diagrammi di flusso più diffusi a scuola.'),
      h('h3', null, 'Operatori'), h('table', { class: 'ref' }, h('tbody', null, ops)),
      h('h3', null, 'Classi e oggetti (vista Oggetti)'), h('p', { class: 'muted small' }, 'Nel diagramma delle classi: doppio clic su un metodo per disegnarlo, doppio clic sul nome della classe o su un attributo per modificarlo, clic destro per aggiungere attributi, metodi e costruttori, trascina le classi per spostarle.'), h('table', { class: 'ref' }, h('tbody', null, oo)),
      h('h3', null, 'Funzioni integrate'), h('table', { class: 'ref' }, h('tbody', null, fns)),
      h('h3', null, 'Scorciatoie'), h('table', { class: 'ref' }, h('tbody', null, keys)));
    openModal({ title: 'Guida rapida', wide: true, body, okText: 'Chiudi', noCancel: true });
  }

  /* ------------------------------ Tastiera ------------------------------- */
  /* elenco delle scorciatoie (Guida rapida) */
  const SHORTCUTS = [
    ['File', [
      ['Ctrl+Alt+N', 'Nuovo programma'], ['Ctrl+O', 'Apri file .fprg'], ['Ctrl+Maiusc+O', 'Apri da indirizzo web'], ['Ctrl+S', 'Salva come .fprg'],
      ['Ctrl+Maiusc+L', 'Copia il link al programma'], ['Ctrl+I', 'Importa un modulo'],
      ['Ctrl+Maiusc+G  ·  Ctrl+Maiusc+E', 'Esporta il diagramma in SVG, in PNG'], ['Ctrl+P', 'Esporta tutto il progetto in PDF'], ['Ctrl+Maiusc+S', 'Scarica il codice sorgente'],
      ['Alt+Invio', 'Proprietà del programma'],
    ]],
    ['Esecuzione', [
      ['F5  ·  Ctrl+Invio', 'Esegui / continua'], ['F10', 'Passo successivo (entra nelle funzioni chiamate)'], ['F8', 'Passo sopra (esegue la chiamata senza entrarci)'], ['Maiusc+F8', 'Esci dalla funzione (esegue il resto e si ferma dopo la chiamata)'],
      ['F6', 'Pausa'], ['Maiusc+F5', 'Ferma'],
    ]],
    ['Modifica', [
      ['Ctrl+Z  ·  Ctrl+Y', 'Annulla, ripeti'], ['Ctrl+C  X  V  D', 'Copia, taglia, incolla (dopo il blocco selezionato), duplica'],
      ['Invio  ·  doppio clic', 'Modifica il blocco selezionato'], ['Canc', 'Elimina il blocco selezionato'],
      ['↑  ↓', 'Seleziona il blocco precedente, successivo'], ['Alt+↑  Alt+↓', 'Sposta il blocco selezionato su, giù'],
    ]],
    ['Aggiungi un blocco (dopo quello selezionato o in fondo; anche nel menu «Aggiungi un blocco»)', [
      ['D  K  A', 'Dichiara, Costante, Assegna'], ['I  O  C', 'Input, Output, Chiama'], ['S  M  P  F', 'Se, Mentre, Per, Fai-mentre'], ['/  B', 'Commento, Interruzione'],
      ['Maiusc+A  L  S  C', 'Apri file, Leggi da file, Scrivi su file, Chiudi file'],
    ]],
    ['Funzioni, metodi e classi', [
      ['N', 'Nuova funzione o nuovo metodo (nel diagramma delle classi: nuova classe)'], ['F2', 'Modifica la funzione o il metodo (nel diagramma delle classi: l\'elemento selezionato)'],
      ['Maiusc+Canc', 'Elimina la funzione o il metodo'], ['Pag↑  Pag↓', 'Diagramma precedente, successivo'], ['U', 'Diagramma delle classi'],
      ['A  M  C', 'Diagramma delle classi: nuovo attributo, metodo, costruttore della classe selezionata'],
      ['Invio  ·  Canc', 'Diagramma delle classi: apri o modifica, elimina l\'elemento selezionato'],
      ['Maiusc+M', 'Diagramma delle classi: condensa o espandi i moduli importati'],
    ]],
    ['Vista', [
      ['Ctrl+Alt+F  ·  Ctrl+Alt+O', 'Vista Funzioni, vista Oggetti'], ['Alt+1  2  3  4', 'Schede Console, Variabili, Codice, File'], ['Ctrl+B', 'Mostra o nascondi il pannello'],
      ['Ctrl++  Ctrl+-  Ctrl+0', 'Zoom avanti, indietro, 100%'], ['Maiusc+1', 'Adatta alla finestra'], ['Maiusc+K', 'Vista compatta del diagramma di flusso (i blocchi in sequenza si toccano) / vista estesa'], ['Ctrl+rotella', 'Zoom'],
      ['F1', 'Guida rapida'], ['Esc', 'Chiudi finestre e menu'],
    ]],
  ];
  /* diagramma precedente o successivo nel selettore */
  function navDiagram(dir) {
    const sel = $('#funcSel'), n = sel.options.length;
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
        if (drag && drag.on) { drag.ghost.remove(); drag = null; document.body.classList.remove('dragging'); }
        return;
      }
      // menu «Aggiungi un blocco» aperto: il tasto sceglie il blocco
      const insBox = !$('#pop').hidden && $('#pop .insmenu');
      if (insBox) {
        const kind = KEY_KIND[keyLabel(e)];
        if (kind) go(() => { const t = insBox._target; closePop(); addStmt(t, kind); });
        else if (ctrl && k === 'v' && st.clip) go(() => { const t = insBox._target; closePop(); paste(t); });
        return;
      }
      if (modalStack.length || !$('#pop').hidden) return;
      const busy = () => { if (isRunning()) { toast('Ferma il programma per modificare il diagramma', 'warn'); return true; } return false; };
      // esecuzione
      if (e.key === 'F1') return go(helpDialog);
      if (e.key === 'F5' && shift) return go(() => { if (!$('#stopBtn').disabled) stopRun(); });
      if (e.key === 'F5' || (ctrl && e.key === 'Enter')) return go(onRunBtn);
      if (e.key === 'F6') return go(() => { if (!$('#pauseBtn').disabled) onPauseBtn(); });
      if (e.key === 'F10') return go(onStepBtn);
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
      // vista
      if (ctrl && alt) {
        if (e.code === 'KeyN') return go(newProgram);
        if (e.code === 'KeyF') return go(() => setView('functions'));
        if (e.code === 'KeyO') return go(() => setView('objects'));
      }
      if (ctrl && !alt && k === 'b') return go(() => $('#sideToggle').click());
      if (alt && !ctrl && /^Digit[1-4]$/.test(e.code)) return go(() => setTab(['console', 'vars', 'code', 'files'][+e.code.slice(5) - 1]));
      if (ctrl && !alt && (e.key === '+' || e.key === '=')) return go(() => setZoom(st.zoom * 1.15));
      if (ctrl && !alt && e.key === '-') return go(() => setZoom(st.zoom / 1.15));
      if (ctrl && !alt && e.key === '0') return go(() => setZoom(1));
      if (shift && !ctrl && !alt && e.code === 'Digit1') return go(fitZoom);
      // modifica
      if (ctrl && k === 'z' && !shift) return go(undo);
      if (ctrl && (k === 'y' || (k === 'z' && shift))) return go(redo);
      if (ctrl && !shift && k === 'c') { if (st.sel) go(() => copySel(false)); return; }
      if (ctrl && !shift && k === 'x') { if (st.sel) go(() => copySel(true)); return; }
      if (ctrl && !shift && k === 'v') { if (st.clip) go(() => paste()); return; }
      if (ctrl && !shift && k === 'd') { if (st.sel) go(duplicate); return; }
      // funzioni, metodi e classi
      if (e.key === 'PageDown' || e.key === 'PageUp') { if (!ctrl && !alt) go(() => navDiagram(e.key === 'PageDown' ? 1 : -1)); return; }
      if (e.key === 'F2') return go(() => $('#funcEdit').click());
      if (shift && (e.key === 'Delete' || e.key === 'Backspace') && !isUml()) return go(() => $('#funcDel').click());
      const lab = keyLabel(e);
      if (lab === 'N') return go(() => $('#funcAdd').click());
      if (lab === 'U' && isOO() && !isUml()) return go(showUml);
      if (lab === 'Maiusc+K' && !isUml()) return go(toggleCompact);
      if (isUml()) {
        if ((e.key === 'Delete' || e.key === 'Backspace') && st.usel && !isRunning()) { e.preventDefault(); deleteUmlSel(); }
        else if (e.key === 'Enter' && st.usel) { e.preventDefault(); if (st.usel.kind === 'method') openMethod(st.usel.fid); else if (!isRunning()) editUmlSel(); }
        else if (lab === 'Maiusc+M') { e.preventDefault(); toggleAllModules(); }
        else if (lab === 'A' || lab === 'M' || lab === 'C') {
          e.preventDefault();
          if (busy()) return;
          const c = uselClass(); if (!c) { toast('Seleziona prima una classe', 'warn'); return; }
          if (lab === 'A') attrDialog(c, null); else editFunction(null, { cls: c, ctor: lab === 'C' });
        }
        return;
      }
      // diagramma di flusso
      if ((e.key === 'Delete' || e.key === 'Backspace') && st.sel) return go(deleteSel);
      if (e.key === 'Enter' && st.sel) return go(() => editStmt(st.sel));
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && st.sel) {
        if (alt) return go(() => shiftSel(e.key === 'ArrowDown' ? 1 : -1));
        const f = M.findStmt(st.prog, st.sel); if (!f) return;
        const n = f.arr[f.index + (e.key === 'ArrowDown' ? 1 : -1)];
        if (n) { e.preventDefault(); st.sel = n.id; decorate(); const el = $(`#chart .shape[data-id="${n.id}"]`); if (el) scrollIntoViewIfNeeded(el); }
        return;
      }
      const kind = KEY_KIND[lab];
      if (kind) go(() => addByKey(kind));
    });
  }

  /* ----------------------------- Avvio ----------------------------------- */
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
    $('#progName').addEventListener('click', () => { if (isRunning()) { toast('Ferma il programma per modificare il diagramma', 'warn'); return; } editProgram(); });
    $('#fileInput').addEventListener('change', (e) => { readFileObj(e.target.files[0]); e.target.value = ''; });
    $('#funcSel').addEventListener('change', (e) => (e.target.value === 'uml' ? showUml() : showFunc(+e.target.value)));
    const busy = () => { if (isRunning()) { toast('Ferma il programma per modificare il diagramma', 'warn'); return true; } return false; };
    $('#funcAdd').addEventListener('click', () => { if (busy()) return; if (!isOO()) editFunction(null); else if (st.uml) classDialog(null); else editFunction(null, { cls: M.classOf(st.prog, func()), ctor: false }); });
    $('#funcEdit').addEventListener('click', () => { if (busy()) return; if (isUml()) editUmlSel(); else if (st.fi === 0) editProgram(); else editFunction(st.fi); });
    $('#funcDel').addEventListener('click', () => { if (busy()) return; if (isUml()) deleteUmlSel(); else deleteFunction(); });
    $('#viewFn').addEventListener('click', () => setView('functions'));
    $('#viewOo').addEventListener('click', () => setView('objects'));
    $('#backUml').addEventListener('click', showUml);
    $('#runBtn').addEventListener('click', onRunBtn);
    $('#stepBtn').addEventListener('click', onStepBtn);
    $('#overBtn').addEventListener('click', onOverBtn);
    $('#outBtn').addEventListener('click', onOutBtn);
    $('#pauseBtn').addEventListener('click', onPauseBtn);
    $('#stopBtn').addEventListener('click', stopRun);
    const sp = $('#speed');
    sp.value = st.speed; $('#speedVal').textContent = SPEEDS[st.speed].label;
    sp.addEventListener('input', () => { st.speed = +sp.value; store.set('speed', st.speed); $('#speedVal').textContent = SPEEDS[st.speed].label; });
    $('#zoomIn').addEventListener('click', () => setZoom(st.zoom * 1.15));
    $('#zoomOut').addEventListener('click', () => setZoom(st.zoom / 1.15));
    $('#zoomFit').addEventListener('click', fitZoom);
    $('#compactBtn').addEventListener('click', toggleCompact);
    $('#zoomVal').addEventListener('click', () => setZoom(1));
    $('#tabs').addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const tabs = $$('#tabs [role=tab]'); const i = tabs.findIndex((t) => t.dataset.tab === st.tab);
      const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; setTab(n.dataset.tab); n.focus();
    });
    // niente invio del modulo: nelle pagine in sandbox l'evento submit non arriva
    $('#conForm').addEventListener('submit', (e) => e.preventDefault());
    $('#conSend').addEventListener('click', () => submitInput($('#conInput').value));
    $('#conInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submitInput($('#conInput').value); } });
    $('#conClear').addEventListener('click', () => { if (!isRunning()) conClear(); });
    const ls = $('#langSel');
    for (const [k, L] of Object.entries(CodeGen.LANGS)) ls.append(h('option', { value: k, selected: k === st.lang }, L.label));
    ls.addEventListener('change', () => { st.lang = ls.value; store.set('lang', st.lang); renderCode(); });
    $('#codeCopy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText($('#codeOut').dataset.raw || ''); toast('Codice copiato', 'ok'); }
      catch (e) { const r = document.createRange(); r.selectNodeContents($('#codeOut')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Premi Ctrl+C per copiare il testo selezionato'); }
    });
    $('#fileNew').addEventListener('click', () => editFile(null));
    $('#fileUpload').addEventListener('click', () => $('#txtInput').click());
    $('#txtInput').addEventListener('change', (e) => { for (const f of e.target.files) { const r = new FileReader(); r.onload = () => { st.vfs.set(f.name, r.result); saveVfs(); }; r.readAsText(f); } e.target.value = ''; });
    document.addEventListener('mousedown', (e) => { const p = $('#pop'); if (!p.hidden && !p.contains(e.target)) closePop(); });
    window.addEventListener('resize', closePop);
    $('#canvasWrap').addEventListener('scroll', closePop);
    // trascina e rilascia file
    document.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); document.body.classList.add('filedrag'); } });
    document.addEventListener('dragleave', (e) => { if (e.target === document.documentElement || !e.relatedTarget) document.body.classList.remove('filedrag'); });
    document.addEventListener('drop', (e) => { if (!e.dataTransfer || !e.dataTransfer.files.length) return; e.preventDefault(); document.body.classList.remove('filedrag'); readFileObj(e.dataTransfer.files[0]); });
    // divisore pannelli
    const grip = $('#grip');
    const sideW = store.get('sideW', null); if (sideW) document.documentElement.style.setProperty('--side-w', sideW + 'px');
    $('#sideToggle').addEventListener('pointerdown', (e) => e.stopPropagation());
    $('#sideToggle').addEventListener('click', (e) => { e.stopPropagation(); setSideHidden(!document.body.classList.contains('side-hidden')); });
    setSideHidden(!!store.get('sideHidden', false));
    grip.addEventListener('pointerdown', (e) => {
      if (document.body.classList.contains('side-hidden')) return;
      grip.setPointerCapture(e.pointerId);
      const mv = (ev) => { const w = Math.max(280, Math.min(window.innerWidth - 320, window.innerWidth - ev.clientX)); document.documentElement.style.setProperty('--side-w', w + 'px'); store.set('sideW', w); };
      const up = () => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); };
      grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up);
    });
    grip.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const cur = $('#side').getBoundingClientRect().width; const w = Math.max(280, cur + (e.key === 'ArrowLeft' ? 30 : -30));
      document.documentElement.style.setProperty('--side-w', w + 'px'); store.set('sideW', w);
    });
    // tema
    const theme = store.get('theme', null);
    if (theme) document.documentElement.dataset.theme = theme;
    $('#themeBtn').addEventListener('click', () => {
      const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      const nx = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = nx; store.set('theme', nx);
    });
    window.addEventListener('beforeunload', (e) => { if (st.dirty && window.self === window.top) { e.preventDefault(); e.returnValue = ''; } });
  }

  /* all'apertura: vista Funzioni sul Main (Inizio); la vista Oggetti solo se il programma
     ha più classi o membri che le funzioni non possono mostrare, e comunque sul Main */
  function startView() {
    st.view = M.hasClasses(st.prog) && !M.isTrivialOO(st.prog) ? 'objects' : 'functions';
    store.set('view', st.view);
    st.fi = 0; st.uml = false; st.sel = null; st.usel = null;
  }
  function init() {
    ArrayView.configure({ host: () => $('#floatLayer'), nextZ: () => ++zTop });
    bindUi(); bindChart(); bindKeys();
    const saved = store.get('autosave', null);
    let ok = false;
    if (saved && saved.xml) {
      try { st.prog = M.parseFprg(saved.xml); st.fi = Math.min(saved.fi || 0, st.prog.functions.length - 1); st.fileName = saved.fileName || null; ok = true; } catch (e) { ok = false; }
    }
    if (!ok) st.prog = Examples.get('media').make();
    startView();
    render(); initLayout(); renderVars(); renderFiles(); setStatus('idle', 'Pronto');
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { render(); fitIfLarge(); });
    setTimeout(fitIfLarge, 0);
    // ?url=…: apre il programma indicato; poi il parametro si toglie dalla barra degli indirizzi,
    // così ricaricando la pagina si ritrova il lavoro (salvato in automatico) e non il file originale
    let q = null;
    try { const sp = new URLSearchParams(location.search); q = sp.get('url') || sp.get('fprg'); } catch (e) { q = null; }
    if (q) openUrl(q, ok).then((done) => {
      if (!done) return;
      startView(); render();
      try { const u = new URL(location.href); u.searchParams.delete('url'); u.searchParams.delete('fprg'); history.replaceState(null, '', u.href); } catch (e) { /* ignora */ }
    });
    // API minima per i test automatici
    window.FlowLab = { get state() { return st; }, run, loadText, serialize: () => M.serializeFprg(st.prog), render, setTab, submitInput, setView, showUml, showFunc, openUrl, rawUrl, loadExample: (id) => { st.dirty = false; loadExample(id); } };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
