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
    fileName: null, ins: [], expanded: new Set(), varsOpen: new Set(), vfs: new Map(Object.entries(store.get('vfs', {}))),
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
  /* tipi per dichiarazioni, parametri e attributi: i quattro di base e le classi */
  function typeOpts() {
    const base = E.TYPES.map((t) => [t, TYPE_IT[t]]);
    return M.hasClasses(st.prog) ? base.concat(st.prog.classes.map((c) => [c.name, c.name + ' (classe)'])) : base;
  }

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
    bar.hidden = !isOO() || st.uml;
    if (!bar.hidden) { const f = func(); const c = M.classOf(st.prog, f); $('#crumbWhere').textContent = `${c ? c.name : ''} › ${f === st.prog.functions[0] ? 'Main (inizio del programma)' : f.ctor ? 'costruttore' : f.name + '()'}`; }
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

  /* --------------------------- Disegno ----------------------------------- */
  let codeTimer = null;
  function render() {
    ensureView();
    const holder = $('#chart');
    if (isUml()) {
      const out = UmlLib.render(st.prog, st.usel);
      st.ins = []; st.edges = [];
      holder.innerHTML = out.svg;
      applyZoom();
    } else if (isOO() && func().abstract) {
      abstractCard(func());
    } else {
      const f = func();
      const c = isOO() ? M.classOf(st.prog, f) : null;
      const out = renderer.func(f, st.expanded, isOO() ? { owner: c ? c.name : '', isMain: st.fi === 0 } : undefined);
      st.ins = out.ins;
      st.edges = out.edges;
      holder.innerHTML = out.svg;
      applyZoom();
      decorate();
    }
    renderFuncSelect();
    renderViewSwitch();
    $('#undoBtn').disabled = !st.undo.length;
    $('#redoBtn').disabled = !st.redo.length;
    $('#progName').textContent = st.prog.attrs.name || 'Programma senza nome';
    clearTimeout(codeTimer); codeTimer = setTimeout(() => { renderCode(); autosave(); }, 120);
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
        const og = h('optgroup', { label: 'Classe ' + c.name });
        const ms = M.membersOf(st.prog, c);
        for (const f of [...ms.filter((x) => x.ctor), ...ms.filter((x) => !x.ctor)]) {
          const i = st.prog.functions.indexOf(f);
          og.append(h('option', { value: i, selected: !st.uml && i === st.fi }, i === 0 ? 'Inizio (principale)' : f.ctor ? `new ${c.name}(${f.params.map((p) => p.name).join(', ')}) · costruttore` : `${f.name}(${f.params.map((p) => p.name).join(', ')})${f.abstract ? ' · astratto' : ''}`));
        }
        sel.append(og);
      }
      const cur = !st.uml && M.classOf(st.prog, func());
      add.title = st.uml ? 'Nuova classe' : `Nuovo metodo nella classe ${cur ? cur.name : ''}`;
      edit.title = st.uml ? 'Modifica l\'elemento selezionato nel diagramma' : 'Modifica il metodo';
      del.title = st.uml ? 'Elimina l\'elemento selezionato nel diagramma' : 'Elimina il metodo';
      del.disabled = st.uml ? !st.usel : st.fi === 0;
      edit.disabled = st.uml && !st.usel;
      return;
    }
    $('#funcLbl').textContent = 'Funzione';
    add.title = 'Nuova funzione'; edit.title = 'Modifica funzione o proprietà del programma'; del.title = 'Elimina funzione';
    edit.disabled = false;
    st.prog.functions.forEach((f, i) => sel.append(h('option', { value: i, selected: i === st.fi }, i === 0 ? 'Inizio (principale)' : `${f.name}(${f.params.map((p) => p.name).join(', ')})`)));
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
    box.append(h('div', { class: 'pophead' }, 'Aggiungi un blocco'));
    for (const [g, kinds] of GROUPS) {
      const row = h('div', { class: 'insgroup' }, h('div', { class: 'glabel' }, g));
      const grid = h('div', { class: 'insgrid' });
      for (const k of kinds) {
        grid.append(h('button', { class: 'insbtn', type: 'button', role: 'menuitem', title: RenderLib.KIND_IT[k], onclick: () => { closePop(); addStmt(target, k); } },
          h('span', { html: icon(k) }), h('span', { class: 'ilabel' }, RenderLib.KIND_IT[k])));
      }
      row.append(grid); box.append(row);
    }
    if (st.clip) box.append(h('button', { class: 'pastebtn', type: 'button', onclick: () => { closePop(); paste(target); } }, `Incolla qui (${RenderLib.KIND_IT[st.clip.kind]})`));
    openPop(x, y, box);
  }
  function shapeMenu(id, x, y) {
    if (id.startsWith('start:') || id.startsWith('end:')) {
      const box = h('div', { class: 'ctxmenu' },
        h('button', { type: 'button', onclick: () => { closePop(); st.fi === 0 ? editProgram() : editFunction(st.fi); } }, st.fi === 0 ? 'Proprietà del programma…' : 'Modifica funzione…'));
      openPop(x, y, box); return;
    }
    const box = h('div', { class: 'ctxmenu' },
      h('button', { type: 'button', onclick: () => { closePop(); editStmt(id); } }, h('span', null, 'Modifica…'), h('kbd', null, 'Invio')),
      h('button', { type: 'button', onclick: () => { closePop(); copySel(false); } }, h('span', null, 'Copia'), h('kbd', null, 'Ctrl+C')),
      h('button', { type: 'button', onclick: () => { closePop(); copySel(true); } }, h('span', null, 'Taglia'), h('kbd', null, 'Ctrl+X')),
      h('button', { type: 'button', onclick: () => { closePop(); duplicate(); } }, h('span', null, 'Duplica'), h('kbd', null, 'Ctrl+D')),
      h('button', { type: 'button', class: 'danger', onclick: () => { closePop(); deleteSel(); } }, h('span', null, 'Elimina'), h('kbd', null, 'Canc')));
    openPop(x, y, box);
  }

  /* ---------------------------- Modifiche -------------------------------- */
  function addStmt(target, kind) {
    const s = M.makeStmt(kind);
    if (isRunning()) { toast('Ferma il programma per modificare il diagramma', 'warn'); return; }
    stmtDialog(s, true, (vals) => mutate(() => { Object.assign(s, vals); target.arr.splice(target.idx, 0, s); st.sel = s.id; }));
  }
  function editStmt(id) {
    const f = M.findStmt(st.prog, id); if (!f) return;
    if (isRunning()) { toast('Ferma il programma per modificare il diagramma', 'warn'); return; }
    stmtDialog(f.stmt, false, (vals) => mutate(() => Object.assign(f.stmt, vals)));
  }
  function deleteSel() {
    if (!st.sel) return;
    const f = M.findStmt(st.prog, st.sel); if (!f) return;
    mutate(() => { f.arr.splice(f.index, 1); st.sel = f.arr[f.index] ? f.arr[f.index].id : (f.arr[f.index - 1] ? f.arr[f.index - 1].id : null); });
  }
  function copySel(cut) {
    if (!st.sel) return;
    const f = M.findStmt(st.prog, st.sel); if (!f) return;
    st.clip = M.cloneStmt(f.stmt, true);
    if (cut) mutate(() => { f.arr.splice(f.index, 1); st.sel = null; });
    else toast('Blocco copiato: fai clic su una freccia e scegli «Incolla qui»');
  }
  function paste(target) {
    if (!st.clip || (!target && (isUml() || func().abstract))) return;
    const c = M.cloneStmt(st.clip);
    if (!target) {
      const f = st.sel && M.findStmt(st.prog, st.sel);
      target = f ? { arr: f.arr, idx: f.index + 1 } : { arr: func().body, idx: func().body.length };
    }
    mutate(() => { target.arr.splice(target.idx, 0, c); st.sel = c.id; });
  }
  function duplicate() {
    if (!st.sel) return;
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
    const f = M.findStmt(st.prog, id); if (!f) return;
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
    function close() { back.remove(); modalStack.pop(); }
    modalStack.push(close);
    document.body.append(back);
    setTimeout(() => { const f = form.querySelector('input:not([type=checkbox]):not([type=radio]), textarea, select'); (f || ok).focus(); if (f && f.select) f.select(); }, 0);
    return { close, form, err };
  }
  function confirmBox(title, text, okText, onOk) {
    openModal({ title, body: h('p', { class: 'confirm' }, text), okText, danger: true, onOk: () => { onOk(); } });
  }

  /* Campi */
  function field(spec, val, vars) {
    const id = 'f_' + spec.key;
    const wrap = h('div', { class: 'field' + (spec.inline ? ' inline' : '') });
    let input;
    if (spec.type === 'select') {
      input = h('select', { id }, spec.options.map(([v, l]) => h('option', { value: v, selected: v === val }, l)));
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
    if (s.kind === 'declare' && M.hasClasses(st.prog)) form = { ...form, fields: form.fields.map((f) => (f.key === 'type' ? { ...f, type: 'select', options: typeOpts() } : f)) };
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
  /* opts (vista Oggetti, nuovo metodo): { cls, ctor } */
  function editFunction(index, opts) {
    const isNew = index == null;
    const f = isNew ? M.makeFunction('') : st.prog.functions[index];
    const oo = isOO() && M.hasClasses(st.prog);
    const cls = oo ? (isNew ? opts.cls : M.classOf(st.prog, f)) : null;
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
    const plist = h('div', { class: 'params' });
    const drawParams = () => {
      plist.innerHTML = '';
      if (!params.length) plist.append(h('p', { class: 'muted small' }, 'Nessun parametro.'));
      params.forEach((p, i) => {
        const nm = h('input', { type: 'text', class: 'mono', value: p.name, 'aria-label': 'Nome parametro ' + (i + 1), placeholder: 'nome', oninput: (e) => { p.name = e.target.value.trim(); } });
        const tp = h('select', { 'aria-label': 'Tipo parametro ' + (i + 1), onchange: (e) => { p.type = e.target.value; } }, typeOpts().map(([v, l]) => h('option', { value: v, selected: v === p.type }, l)));
        const shape = p.array ? (p.dims || 1) : 0;
        const arr = h('select', { 'aria-label': 'Forma del parametro ' + (i + 1), title: 'Valore singolo o array', onchange: (e) => { const d = +e.target.value; p.array = d > 0; p.dims = Math.max(1, d); } }, [[0, 'valore'], [1, 'array [ ]'], [2, 'matrice [ , ]'], [3, '3 dimensioni'], [4, '4 dimensioni'], [5, '5 dimensioni']].map(([v, l]) => h('option', { value: v, selected: v === shape }, l)));
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
    const drawRets = () => {
      rlist.innerHTML = '';
      if (!rets.length) rlist.append(h('p', { class: 'muted small' }, 'Nessun valore: è una procedura.'));
      rets.forEach((r, i) => {
        const nm = h('input', { type: 'text', class: 'mono', value: r.name, 'aria-label': 'Variabile restituita ' + (i + 1), placeholder: 'variabile', oninput: (e) => { r.name = e.target.value.trim(); } });
        const tp = h('select', { 'aria-label': 'Tipo del valore restituito ' + (i + 1), onchange: (e) => { r.type = e.target.value; } }, typeOpts().map(([v, l]) => h('option', { value: v, selected: v === r.type }, l)));
        rlist.append(h('div', { class: 'prow rrow' }, nm, tp,
          h('button', { class: 'iconbtn', type: 'button', title: 'Sposta su', 'aria-label': 'Sposta su', disabled: i === 0, onclick: () => { rets.splice(i - 1, 0, rets.splice(i, 1)[0]); drawRets(); } }, '↑'),
          h('button', { class: 'iconbtn', type: 'button', title: 'Rimuovi', 'aria-label': 'Rimuovi valore restituito', onclick: () => { rets.splice(i, 1); drawRets(); } }, '✕')));
      });
    };
    drawRets();
    if (!ctor) body.append(h('div', { class: 'flabel' }, 'Valori restituiti'), h('p', { class: 'muted small', style: 'margin:0' }, `Le variabili vanno dichiarate nel corpo ${oo ? 'del metodo' : 'della funzione'}: quelle nuove vengono dichiarate in automatico. Con più valori la chiamata si scrive a, b ← ${oo ? 'obj.metodo' : 'Funzione'}(...)`), rlist,
      h('button', { class: 'btn small', type: 'button', onclick: () => { rets.push({ name: '', type: 'Integer' }); drawRets(); rlist.querySelector('.prow:last-child input').focus(); } }, '+ Aggiungi valore restituito'));
    openModal({
      title: isNew ? (ctor ? `Nuovo costruttore di ${cls.name}` : oo ? `Nuovo metodo in ${cls.name}` : 'Nuova funzione') : `Modifica ${what}`, body, okText: isNew ? 'Crea' : 'Salva', wide: true,
      onOk: () => {
        const e1 = nameW._check(); if (e1) return e1;
        const name = ctor ? cls.name : nameW._get().trim();
        if (name.toLowerCase() === 'main') return 'Il nome Main è riservato al programma principale (Inizio)';
        if (E.BUILTINS[name.toLowerCase()]) return `${name} è già una funzione integrata`;
        const isAbs = !!(absW && absW._get());
        const isStatic = !ctor && !isAbs && !!(statW && statW._get());
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
            const rt = (l) => l.map((r) => r.type).join(',');
            if (rt(M.rets(g)) !== rt(rets)) return `${name} ridefinisce il metodo di ${k.name}: deve restituire gli stessi tipi (${M.rets(g).map((r) => E.typeName(r.type)).join(', ') || 'nessun valore'})`;
            break;
          }
        } else if (st.prog.functions.some((g, i) => i !== index && g.name.toLowerCase() === name.toLowerCase())) return `Esiste già una funzione chiamata ${name}`;
        const rseen = new Set();
        for (const r of rets) {
          if (!E.validIdent(r.name)) return `Valore restituito "${r.name || '(vuoto)'}": nome di variabile non valido`;
          if (E.RESERVED.has(r.name.toLowerCase())) return `"${r.name}" è una parola riservata`;
          if (rseen.has(r.name)) return `La variabile restituita ${r.name} è ripetuta`;
          rseen.add(r.name);
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
          if (oo) Object.assign(target, { cls: cls.id, visibility: visW ? visW._get() : 'public', static: isStatic || target === st.prog.functions[0], ctor, abstract: isAbs });
          if (isAbs && !cls.abstract) { cls.abstract = true; setTimeout(() => toast(`${cls.name} è diventata una classe astratta: contiene un metodo astratto`), 0); }
          M.setRets(target, rets);
          // dichiara le variabili restituite che non sono ancora dichiarate (raggruppate per tipo)
          const known = new Set(params.map((p) => p.name));
          M.walk(target.body, (x) => { if (x.kind === 'declare') x.name.split(',').forEach((n) => known.add(n.trim())); });
          const missing = rets.filter((r) => !known.has(r.name));
          const decls = [];
          for (const r of missing) {
            const last = decls[decls.length - 1];
            if (last && last.type === r.type) last.name += ', ' + r.name;
            else decls.push(M.makeStmt('declare', { name: r.name, type: r.type }));
          }
          target.body.unshift(...decls);
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
    if (i <= 0) return;
    const what = f.ctor ? `Il costruttore ${f.name}(…)` : isOO() ? `Il metodo ${fname(f)}` : `La funzione ${f.name}`;
    confirmBox(f.ctor ? 'Eliminare il costruttore?' : isOO() ? 'Eliminare il metodo?' : 'Eliminare la funzione?', `${what} e tutti i suoi blocchi verranno eliminati.`, 'Elimina', () => mutate(() => {
      st.prog.functions.splice(i, 1);
      if (st.fi === i) { st.fi = 0; if (isOO()) st.uml = true; } else if (st.fi > i) st.fi--;
      if (st.usel && st.usel.fid === f.id) st.usel = { cls: st.usel.cls, kind: 'class' };
    }));
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
    const T = (t) => (String(t).toLowerCase() === lo ? nu : t);
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
    const nameW = field({ key: 'cname', label: 'Nome della classe', type: 'ident', required: true, placeholder: 'es. Punto', hint: 'Per convenzione inizia con la lettera maiuscola' }, c ? c.name : '');
    const banned = c ? [c, ...descendants(c)] : [];
    const parW = field({ key: 'cpar', label: 'Eredita da (classe madre)', type: 'select', options: [['', '— nessuna —'], ...st.prog.classes.filter((k) => !banned.includes(k)).map((k) => [k.name, k.name])] }, c ? (c.parent || '') : '');
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
    const a = isNew ? M.makeAttribute() : c.attributes[index];
    const nameW = field({ key: 'aname', label: 'Nome dell\'attributo', type: 'ident', required: true, placeholder: 'es. raggio' }, a.name);
    const typeW = field({ key: 'atype', label: 'Tipo', type: 'select', options: typeOpts() }, a.type);
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
        mutate(() => {
          Object.assign(a, { name, type: typeW._get(), array: arr, size: arr ? sizeW._get().trim() : '', visibility: visW._get(), static: statW._get(), init: arr ? '' : initW._get().trim() });
          if (isNew) c.attributes.push(a);
          st.usel = { cls: c.id, kind: 'attr', i: c.attributes.indexOf(a) };
        });
        return true;
      },
    });
  }
  function deleteClass(c) {
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
    const a = c.attributes[i]; if (!a) return;
    mutate(() => { c.attributes.splice(i, 1); st.usel = { cls: c.id, kind: 'class' }; });
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
      h('button', { type: 'button', onclick: () => { closePop(); editFunction(null, { cls: c, ctor: false }); } }, h('span', null, 'Nuovo metodo…')),
      h('button', { type: 'button', onclick: () => { closePop(); editFunction(null, { cls: c, ctor: true }); } }, h('span', null, 'Nuovo costruttore…')));
    openPop(x, y, box);
  }
  function umlMenu(e) {
    const box = e.target.closest('.ubox'), row = e.target.closest('.urow');
    const c = box && M.classById(st.prog, box.dataset.cls);
    const B = (label, fn, cls) => h('button', { type: 'button', class: cls || '', onclick: () => { closePop(); fn(); } }, h('span', null, label));
    let menuBox;
    if (!c) {
      const pt = svgPoint(e);
      menuBox = h('div', { class: 'ctxmenu' }, B('Nuova classe…', () => classDialog(null, pt)));
    } else if (row && row.dataset.kind === 'method') {
      const f = st.prog.functions.find((x) => x.id === row.dataset.fid);
      menuBox = h('div', { class: 'ctxmenu' },
        B('Apri il diagramma di flusso', () => openMethod(f.id)),
        B(f === st.prog.functions[0] ? 'Proprietà del programma…' : f.ctor ? 'Modifica il costruttore…' : 'Modifica la firma del metodo…', () => editMethodSig(f)),
        f === st.prog.functions[0] ? null : h('hr'),
        f === st.prog.functions[0] ? null : B(f.ctor ? 'Elimina il costruttore' : 'Elimina il metodo', () => deleteFunction(f), 'danger'));
    } else if (row && row.dataset.kind === 'attr') {
      const i = +row.dataset.i;
      menuBox = h('div', { class: 'ctxmenu' }, B('Modifica l\'attributo…', () => attrDialog(c, i)), h('hr'), B('Elimina l\'attributo', () => deleteAttr(c, i), 'danger'));
    } else {
      menuBox = h('div', { class: 'ctxmenu' },
        B('Nuovo attributo…', () => attrDialog(c, null)),
        B('Nuovo metodo…', () => editFunction(null, { cls: c, ctor: false })),
        B('Nuovo costruttore…', () => editFunction(null, { cls: c, ctor: true })),
        h('hr'),
        B('Modifica la classe…', () => classDialog(c)),
        B('Elimina la classe', () => deleteClass(c), 'danger'));
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
    const ab = field({ key: 'pabout', label: 'Descrizione', type: 'textarea' }, a.about);
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
        if (e.target.closest('.uadd')) return;
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
        // le classi si spostano trascinandole
        if (e.button !== 0 || isRunning() || e.target.closest('.uadd')) return;
        const box = e.target.closest('.ubox'); if (!box) return;
        const c = M.classById(st.prog, box.dataset.cls);
        udrag = { c, x: e.clientX, y: e.clientY, ox: c.x, oy: c.y, on: false, raf: 0 };
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
          st.usel = { cls: udrag.c.id, kind: 'class' };
        }
        if (udrag.on) {
          udrag.c.x = Math.max(10, Math.round((udrag.ox + dx) / 10) * 10);
          udrag.c.y = Math.max(10, Math.round((udrag.oy + dy) / 10) * 10);
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
        tb.append(h('tr', { class: 'arr' + (changed ? ' changed' : '') }, h('td', ind(depth), car.el, label, ...tags, icon), h('td', null, `${E.typeName(c.type)}[${dims.join(' × ')}]`), h('td', { class: 'muted' }, `${n} elementi`)));
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
        tb.append(h('tr', { class: 'objrow' + (changed ? ' changed' : '') }, h('td', ind(depth), car ? car.el : h('span', { class: 'caret-sp' }), label, ...tags), h('td', null, E.typeName(c.type)), h('td', null, fmt(v, key), loop ? h('span', { class: 'muted small' }, ' ↺ già sopra') : null)));
        if (car && car.isOpen && depth < 6) {
          const s2 = new Set(seen); s2.add(obj);
          for (const fc of obj.fields.values()) addCell(fc, fc.name, depth + 1, path + '.' + fc.name, s2);
          if (!obj.fields.size) tb.append(h('tr', { class: 'objrow' }, h('td', { colspan: 3, class: 'muted small', ...(ind(depth + 1) || {}) }, 'nessun attributo')));
        }
        return;
      }
      tb.append(h('tr', { class: changed ? 'changed' : '' }, h('td', ind(depth), depth || (v && v.t === 'Object') ? h('span', { class: 'caret-sp' }) : null, label, ...tags), h('td', null, E.typeName(c.type)), h('td', null, fmt(c.value))));
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
  function highlight(code, lang) {
    const L = CodeGen.LANGS[lang];
    const kw = new Set(L.keywords);
    const cm = L.comment === '#' ? '#[^\\n]*' : '\\/\\/[^\\n]*';
    const re = new RegExp(`(${cm})|("(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*')|(\\b\\d+(?:\\.\\d+)?\\b)|([\\p{L}_][\\p{L}\\p{N}_]*)|(\\n)|([\\s\\S])`, 'gu');
    const escH = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let out = '<span class="ln"></span>';
    let m;
    while ((m = re.exec(code))) {
      if (m[1]) out += `<span class="tc">${escH(m[1])}</span>`;
      else if (m[2]) out += `<span class="ts">${escH(m[2])}</span>`;
      else if (m[3]) out += `<span class="tn">${m[3]}</span>`;
      else if (m[4]) out += kw.has(m[4]) ? `<span class="tk">${m[4]}</span>` : escH(m[4]);
      else if (m[5]) out += '\n<span class="ln"></span>';
      else out += escH(m[6]);
    }
    return out.replace(/\n<span class="ln"><\/span>$/, '\n');
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
    b.title = hidden ? 'Mostra il pannello' : 'Nascondi il pannello';
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
    if (window.self !== window.top) toast('Se il download non parte, usa «Copia XML» dal menu File', 'warn');
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
  async function copyXml() {
    const xml = M.serializeFprg(st.prog);
    try { await navigator.clipboard.writeText(xml); toast('XML del programma copiato negli appunti', 'ok'); }
    catch (e) {
      const ta = h('textarea', { class: 'mono', rows: 14, readonly: true, 'aria-label': 'XML del programma' }); ta.value = xml;
      openModal({ title: 'XML del programma', wide: true, body: ta, okText: 'Chiudi', noCancel: true });
      setTimeout(() => ta.select(), 50);
    }
  }
  function loadText(text, name) {
    let prog;
    try { prog = M.parseFprg(text); } catch (e) { toast(e.message, 'error'); return; }
    if (isRunning()) stopRun();
    st.undo = []; st.redo = []; st.prog = prog; st.fi = 0; st.sel = null; st.fileName = name || null; st.dirty = false;
    run.errId = null; run.mainFrame = null;
    if (M.hasClasses(prog)) { st.view = 'objects'; store.set('view', 'objects'); }
    st.uml = isOO(); st.usel = null;
    render(); renderVars();
    setTimeout(fitIfLarge, 0);
    if (prog.skipped && prog.skipped.length) toast(`Aperto ${name || 'programma'}: ignorati ${prog.skipped.length} blocchi non supportati (${[...new Set(prog.skipped)].join(', ')})`, 'warn');
    else toast(`Aperto ${name || 'programma'}`, 'ok');
  }
  function fitIfLarge() {
    const svg = $('#chart svg'); const wrap = $('#canvasWrap');
    if (!svg) return;
    if (svg.dataset.w * st.zoom > wrap.clientWidth - 24) setZoom(Math.max(0.55, (wrap.clientWidth - 24) / svg.dataset.w));
    wrap.scrollLeft = (wrap.scrollWidth - wrap.clientWidth) / 2;
  }
  function openFile() { $('#fileInput').click(); }
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
      if (M.hasClasses(st.prog)) { st.view = 'objects'; store.set('view', 'objects'); }
      st.uml = isOO();
      conClear(); render(); renderVars(); setTimeout(fitIfLarge, 0);
    });
  }

  function exportSvg() {
    const svg = $('#chart svg').cloneNode(true);
    svg.setAttribute('width', svg.dataset.w); svg.setAttribute('height', svg.dataset.h);
    svg.insertBefore(h('style', null, exportCss()), svg.firstChild);
    $$('.hits, .ctoggle, .uadd, .uhit', svg).forEach((x) => x.remove());
    return new XMLSerializer().serializeToString(svg);
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
      { label: 'Salva come .fprg', key: 'Ctrl+S', do: saveFile },
      { label: 'Copia XML negli appunti', do: copyXml },
      '-',
      { label: 'Esporta diagramma SVG', do: () => download(safeName(st.prog.attrs.name) + '_' + (isUml() ? 'classi' : safeName(fname(func()))) + '.svg', exportSvg(), 'image/svg+xml') },
      { label: 'Esporta diagramma PNG', do: exportPng },
      { label: 'Scarica codice sorgente', do: () => download(safeName(st.prog.attrs.name) + '.' + CodeGen.LANGS[st.lang].ext, CodeGen.generate(st.prog, st.lang), 'text/plain') },
      '-',
      { label: 'Proprietà del programma…', do: editProgram },
    ]);
  }
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
    ].map(([a, b]) => h('tr', null, h('td', { class: 'mono' }, a), h('td', null, b)));
    const oo = [
      ['p ← new Punto(1, 2)', 'Crea un oggetto: esegue il costruttore con quei parametri'], ['p.x   p.sposta(3, 4)', 'Attributo e metodo di un oggetto'],
      ['this.x', 'Attributo dell\'oggetto su cui si sta lavorando (in un metodo basta x)'], ['Punto.contatore   Punto.crea()', 'Attributo o metodo statico: si usa con il nome della classe'],
      ['super(nome)', 'Blocco Chiamata, primo blocco del costruttore: esegue il costruttore della classe madre'], ['super.descrivi()', 'Esegue la versione del metodo della classe madre'],
      ['null   p = null', 'Nessun oggetto: si può assegnare e confrontare'], ['«abstract»', 'Classe astratta: non si creano oggetti. Un metodo astratto non ha corpo e lo definiscono le sottoclassi'], ['+  -  #', 'Accesso pubblico, privato, protetto (controllato durante l\'esecuzione)'],
    ].map(([a, b]) => h('tr', null, h('td', { class: 'mono' }, a), h('td', null, b)));
    const keys = [['F5  ·  Ctrl+Invio', 'Esegui / continua'], ['F10', 'Passo successivo (entra nelle funzioni chiamate)'], ['F8', 'Passo sopra (esegue la chiamata senza entrarci)'], ['Esc', 'Chiudi finestre e menu'], ['Invio  ·  doppio clic', 'Modifica il blocco selezionato'], ['Canc', 'Elimina il blocco selezionato'], ['Ctrl+C  X  V  D', 'Copia, taglia, incolla, duplica'], ['Ctrl+Z  ·  Ctrl+Y', 'Annulla, ripeti'], ['Ctrl+rotella', 'Zoom']]
      .map(([a, b]) => h('tr', null, h('td', { class: 'mono' }, a), h('td', null, b)));
    const body = h('div', { class: 'help-body' },
      h('p', null, 'Fai clic su una freccia del diagramma per aggiungere un blocco. Trascina un blocco su un\'altra freccia per spostarlo. I file .fprg si aprono e si salvano con lo stesso formato XML usato dagli editor di diagrammi di flusso più diffusi a scuola.'),
      h('h3', null, 'Operatori'), h('table', { class: 'ref' }, h('tbody', null, ops)),
      h('h3', null, 'Classi e oggetti (vista Oggetti)'), h('p', { class: 'muted small' }, 'Nel diagramma delle classi: doppio clic su un metodo per disegnarlo, doppio clic sul nome della classe o su un attributo per modificarlo, clic destro per aggiungere attributi, metodi e costruttori, trascina le classi per spostarle.'), h('table', { class: 'ref' }, h('tbody', null, oo)),
      h('h3', null, 'Funzioni integrate'), h('table', { class: 'ref' }, h('tbody', null, fns)),
      h('h3', null, 'Scorciatoie'), h('table', { class: 'ref' }, h('tbody', null, keys)));
    openModal({ title: 'Guida rapida', wide: true, body, okText: 'Chiudi', noCancel: true });
  }

  /* ------------------------------ Tastiera ------------------------------- */
  function bindKeys() {
    document.addEventListener('keydown', (e) => {
      if (e.defaultPrevented) return;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') {
        if (!$('#pop').hidden) { closePop(); e.preventDefault(); return; }
        if (modalStack.length) { modalStack[modalStack.length - 1](); e.preventDefault(); return; }
        if (drag && drag.on) { drag.ghost.remove(); drag = null; document.body.classList.remove('dragging'); }
        return;
      }
      if (modalStack.length) return;
      if (e.key === 'F5' || (ctrl && e.key === 'Enter')) { e.preventDefault(); onRunBtn(); return; }
      if (e.key === 'F10') { e.preventDefault(); onStepBtn(); return; }
      if (e.key === 'F8') { e.preventDefault(); onOverBtn(); return; }
      if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); saveFile(); return; }
      if (ctrl && e.key.toLowerCase() === 'o') { e.preventDefault(); openFile(); return; }
      if (typing) return;
      if (ctrl && e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); newProgram(); return; }
      if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (ctrl && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
      if (ctrl && e.key.toLowerCase() === 'c') { if (st.sel) { e.preventDefault(); copySel(false); } return; }
      if (ctrl && e.key.toLowerCase() === 'x') { if (st.sel) { e.preventDefault(); copySel(true); } return; }
      if (ctrl && e.key.toLowerCase() === 'v') { if (st.clip) { e.preventDefault(); paste(); } return; }
      if (ctrl && e.key.toLowerCase() === 'd') { if (st.sel) { e.preventDefault(); duplicate(); } return; }
      if (isUml()) {
        if ((e.key === 'Delete' || e.key === 'Backspace') && st.usel && !isRunning()) { e.preventDefault(); deleteUmlSel(); }
        else if (e.key === 'Enter' && st.usel) { e.preventDefault(); if (st.usel.kind === 'method') openMethod(st.usel.fid); else if (!isRunning()) editUmlSel(); }
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && st.sel) { e.preventDefault(); deleteSel(); return; }
      if (e.key === 'Enter' && st.sel) { e.preventDefault(); editStmt(st.sel); return; }
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && st.sel) {
        const f = M.findStmt(st.prog, st.sel); if (!f) return;
        const n = f.arr[f.index + (e.key === 'ArrowDown' ? 1 : -1)];
        if (n) { e.preventDefault(); st.sel = n.id; decorate(); const el = $(`#chart .shape[data-id="${n.id}"]`); if (el) scrollIntoViewIfNeeded(el); }
      }
    });
  }

  /* ----------------------------- Avvio ----------------------------------- */
  function bindUi() {
    $('#fileBtn').addEventListener('click', (e) => fileMenu(e.currentTarget));
    $('#exBtn').addEventListener('click', (e) => examplesMenu(e.currentTarget));
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
    $('#pauseBtn').addEventListener('click', onPauseBtn);
    $('#stopBtn').addEventListener('click', stopRun);
    const sp = $('#speed');
    sp.value = st.speed; $('#speedVal').textContent = SPEEDS[st.speed].label;
    sp.addEventListener('input', () => { st.speed = +sp.value; store.set('speed', st.speed); $('#speedVal').textContent = SPEEDS[st.speed].label; });
    $('#zoomIn').addEventListener('click', () => setZoom(st.zoom * 1.15));
    $('#zoomOut').addEventListener('click', () => setZoom(st.zoom / 1.15));
    $('#zoomFit').addEventListener('click', fitZoom);
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

  function init() {
    ArrayView.configure({ host: () => $('#floatLayer'), nextZ: () => ++zTop });
    bindUi(); bindChart(); bindKeys();
    const saved = store.get('autosave', null);
    let ok = false;
    if (saved && saved.xml) {
      try { st.prog = M.parseFprg(saved.xml); st.fi = Math.min(saved.fi || 0, st.prog.functions.length - 1); st.fileName = saved.fileName || null; ok = true; } catch (e) { ok = false; }
    }
    if (!ok) st.prog = Examples.get('media').make();
    if (M.hasClasses(st.prog)) st.view = 'objects';
    st.uml = isOO();
    render(); initLayout(); renderVars(); renderFiles(); setStatus('idle', 'Pronto');
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { render(); fitIfLarge(); });
    setTimeout(fitIfLarge, 0);
    // API minima per i test automatici
    window.FlowLab = { get state() { return st; }, run, loadText, serialize: () => M.serializeFprg(st.prog), render, setTab, submitInput, setView, showUml, showFunc, loadExample: (id) => { st.dirty = false; loadExample(id); } };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
