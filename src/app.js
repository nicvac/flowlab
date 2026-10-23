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
    fileName: null, ins: [], vfs: new Map(Object.entries(store.get('vfs', {}))),
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
    render();
  }
  function undo() { if (isRunning() || !st.undo.length) return; st.redo.push(snapshot()); restore(st.undo.pop()); st.dirty = true; }
  function redo() { if (isRunning() || !st.redo.length) return; st.undo.push(snapshot()); restore(st.redo.pop()); st.dirty = true; }

  function declaredNames(f) {
    const out = [];
    for (const p of f.params) out.push(p.name);
    M.walk(f.body, (s) => { if (s.kind === 'declare') s.name.split(',').map((x) => x.trim()).filter(Boolean).forEach((n) => out.push(n)); });
    return [...new Set(out)];
  }

  /* --------------------------- Disegno ----------------------------------- */
  let codeTimer = null;
  function render() {
    const f = func();
    const out = renderer.func(f);
    st.ins = out.ins;
    const holder = $('#chart');
    holder.innerHTML = out.svg;
    applyZoom();
    decorate();
    renderFuncSelect();
    $('#undoBtn').disabled = !st.undo.length;
    $('#redoBtn').disabled = !st.redo.length;
    $('#progName').textContent = st.prog.attrs.name || 'Programma senza nome';
    clearTimeout(codeTimer); codeTimer = setTimeout(() => { renderCode(); autosave(); }, 120);
  }
  function decorate() {
    $$('#chart .shape').forEach((g) => {
      const id = g.dataset.id;
      g.classList.toggle('sel', id === st.sel);
      g.classList.toggle('exec', id === run.curId && run.state !== 'idle' && run.state !== 'done');
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
    st.prog.functions.forEach((f, i) => sel.append(h('option', { value: i, selected: i === st.fi }, i === 0 ? 'Main' : `${f.name}(${f.params.map((p) => p.name).join(', ')})`)));
    $('#funcDel').disabled = st.fi === 0;
  }
  function showFunc(i) { if (i === st.fi) return; st.fi = i; st.sel = null; render(); $('#canvasWrap').scrollTo(0, 0); }

  function autosave() {
    try { store.set('autosave', { xml: M.serializeFprg(st.prog), fi: st.fi, fileName: st.fileName }); } catch (e) { /* ignora */ }
  }

  /* ------------------------ Mini icone delle forme ------------------------ */
  const ICON = {
    declare: '<rect x="3" y="5" width="26" height="16" rx="1.5"/><path class="inner" d="M7 5V21M3 9H29"/>',
    assign: '<rect x="3" y="5" width="26" height="16" rx="1.5"/>',
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
  const CAT = { declare: 'decl', assign: 'assign', input: 'in', output: 'out', if: 'cond', while: 'loop', for: 'loop', do: 'loop', call: 'call', comment: 'comment', breakpoint: 'brk', open: 'file', close: 'file', read: 'file', write: 'file' };
  const icon = (k) => `<svg class="mini c-${CAT[k]}" viewBox="0 0 32 26" aria-hidden="true">${ICON[k]}</svg>`;

  const GROUPS = [
    ['Base', ['declare', 'assign', 'input', 'output', 'call']],
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
    if (!st.clip) return;
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
    if (['expr', 'lvalue'].includes(spec.type) && vars && vars.length) {
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
          if (spec.type === 'lvalue') E.parseLValue(v);
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
      { key: 'size', label: 'Numero di elementi', type: 'expr', placeholder: 'es. 10', showIf: 'array' }] },
    assign: { title: 'Assegnamento', help: 'Calcola l\'espressione e mette il risultato nella variabile.', fields: [
      { key: 'variable', label: 'Variabile', type: 'lvalue', required: true, placeholder: 'es. x  oppure  v[i]' },
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
    call: { title: 'Chiamata', help: 'Esegue una funzione definita nel programma.', fields: [
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
    const form = STMT_FORMS[s.kind];
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
          if (ws[spec.key].hidden) { vals[spec.key] = spec.type === 'check' ? false : (spec.key === 'size' ? '' : s[spec.key]); continue; }
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
  function editFunction(index) {
    const isNew = index == null;
    const f = isNew ? M.makeFunction('') : st.prog.functions[index];
    const params = f.params.map((p) => ({ ...p }));
    const body = h('div', { class: 'fields' });
    const nameW = field({ key: 'fname', label: 'Nome della funzione', type: 'ident', required: true, placeholder: 'es. Massimo' }, f.name);
    const typeW = field({ key: 'ftype', label: 'Restituisce', type: 'select', options: [['None', 'Niente (procedura)'], ...TYPE_OPTS] }, f.type);
    const varW = field({ key: 'fvar', label: 'Variabile restituita', type: 'ident', placeholder: 'es. risultato', hint: 'Va dichiarata nel corpo della funzione' }, f.variable);
    body.append(nameW, h('div', { class: 'row' }, typeW, varW));
    const sync = () => { varW.hidden = typeW._get() === 'None'; };
    typeW._input.addEventListener('change', sync); sync();
    const plist = h('div', { class: 'params' });
    const drawParams = () => {
      plist.innerHTML = '';
      if (!params.length) plist.append(h('p', { class: 'muted small' }, 'Nessun parametro.'));
      params.forEach((p, i) => {
        const nm = h('input', { type: 'text', class: 'mono', value: p.name, 'aria-label': 'Nome parametro ' + (i + 1), placeholder: 'nome', oninput: (e) => { p.name = e.target.value.trim(); } });
        const tp = h('select', { 'aria-label': 'Tipo parametro ' + (i + 1), onchange: (e) => { p.type = e.target.value; } }, TYPE_OPTS.map(([v, l]) => h('option', { value: v, selected: v === p.type }, l)));
        const arr = h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: p.array, onchange: (e) => { p.array = e.target.checked; } }), h('span', null, 'array'));
        plist.append(h('div', { class: 'prow' }, nm, tp, arr,
          h('button', { class: 'iconbtn', type: 'button', title: 'Sposta su', 'aria-label': 'Sposta su', disabled: i === 0, onclick: () => { params.splice(i - 1, 0, params.splice(i, 1)[0]); drawParams(); } }, '↑'),
          h('button', { class: 'iconbtn', type: 'button', title: 'Rimuovi', 'aria-label': 'Rimuovi parametro', onclick: () => { params.splice(i, 1); drawParams(); } }, '✕')));
      });
    };
    drawParams();
    body.append(h('div', { class: 'flabel' }, 'Parametri'), plist,
      h('button', { class: 'btn small', type: 'button', onclick: () => { params.push({ name: '', type: 'Integer', array: false }); drawParams(); plist.querySelector('.prow:last-child input').focus(); } }, '+ Aggiungi parametro'));
    openModal({
      title: isNew ? 'Nuova funzione' : 'Modifica funzione', body, okText: isNew ? 'Crea' : 'Salva', wide: true,
      onOk: () => {
        const e1 = nameW._check(); if (e1) return e1;
        const name = nameW._get().trim();
        if (name.toLowerCase() === 'main') return 'Il nome Main è riservato al programma principale';
        if (E.BUILTINS[name.toLowerCase()]) return `${name} è già una funzione integrata`;
        if (st.prog.functions.some((g, i) => i !== index && g.name.toLowerCase() === name.toLowerCase())) return `Esiste già una funzione chiamata ${name}`;
        const type = typeW._get();
        let variable = '';
        if (type !== 'None') { const e2 = varW._check(); if (e2) return e2; variable = varW._get().trim(); if (!variable) return 'Indica la variabile che contiene il valore restituito'; }
        const seen = new Set();
        for (const p of params) {
          if (!E.validIdent(p.name)) return `Parametro "${p.name || '(vuoto)'}": nome non valido`;
          if (seen.has(p.name)) return `Il parametro ${p.name} è ripetuto`;
          seen.add(p.name);
        }
        mutate(() => {
          if (isNew) {
            const nf = M.makeFunction(name, { type, variable, params });
            if (type !== 'None') nf.body.push(M.makeStmt('declare', { name: variable, type }));
            st.prog.functions.push(nf); st.fi = st.prog.functions.length - 1;
          } else Object.assign(f, { name, type, variable, params });
        });
        return true;
      },
    });
  }
  function deleteFunction() {
    if (st.fi === 0) return;
    const f = func();
    confirmBox('Eliminare la funzione?', `La funzione ${f.name} e tutti i suoi blocchi verranno eliminati.`, 'Elimina', () => mutate(() => { st.prog.functions.splice(st.fi, 1); st.fi = 0; }));
  }
  function editProgram() {
    const a = st.prog.attrs;
    const n = field({ key: 'pname', label: 'Nome del programma', type: 'plain' }, a.name);
    const au = field({ key: 'pauth', label: 'Autori', type: 'plain' }, a.authors);
    const ab = field({ key: 'pabout', label: 'Descrizione', type: 'textarea' }, a.about);
    openModal({ title: 'Proprietà del programma', body: h('div', { class: 'fields' }, n, au, ab), okText: 'Salva', onOk: () => {
      if (isRunning()) return 'Ferma il programma prima di modificarlo';
      mutate(() => { a.name = n._get().trim(); a.authors = au._get().trim(); a.about = ab._get(); });
      return true;
    } });
  }

  /* ------------------------ Interazione col disegno ---------------------- */
  let drag = null, suppressClick = false;
  function bindChart() {
    const chart = $('#chart');
    chart.addEventListener('click', (e) => {
      if (suppressClick) { suppressClick = false; return; }
      const ins = e.target.closest('.ins');
      if (ins) { if (isRunning()) { toast('Ferma il programma per modificare il diagramma', 'warn'); return; } insertMenu(+ins.dataset.ins, e.clientX + 6, e.clientY + 6); return; }
      const g = e.target.closest('.shape');
      st.sel = g && !g.dataset.id.includes(':') ? g.dataset.id : null;
      decorate();
    });
    chart.addEventListener('dblclick', (e) => {
      const g = e.target.closest('.shape'); if (!g) return;
      const id = g.dataset.id;
      if (id.startsWith('start:') || id.startsWith('end:')) { if (isRunning()) return; st.fi === 0 ? editProgram() : editFunction(st.fi); return; }
      editStmt(id);
    });
    chart.addEventListener('contextmenu', (e) => {
      const g = e.target.closest('.shape'); if (!g) return;
      e.preventDefault();
      if (!g.dataset.id.includes(':')) { st.sel = g.dataset.id; decorate(); }
      shapeMenu(g.dataset.id, e.clientX, e.clientY);
    });
    chart.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || isRunning()) return;
      const g = e.target.closest('.shape'); if (!g || g.dataset.id.includes(':')) return;
      drag = { id: g.dataset.id, x: e.clientX, y: e.clientY, on: false, ghost: null };
    });
    window.addEventListener('pointermove', (e) => {
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
    conClear(); flushStreams();
    conWrite(`▶ ${st.prog.attrs.name || 'Programma'}`, true, 'sys');
    // esegue una copia, così le modifiche al diagramma non toccano l'esecuzione
    const prog = JSON.parse(JSON.stringify(st.prog));
    run.interp = new Interpreter(prog, env);
    run.gen = run.interp.run();
    if (st.tab !== 'console' && st.tab !== 'vars') setTab('console');
    if (mode === 'run') { run.state = 'running'; setStatus('running', 'In esecuzione…'); pump(); }
    else { run.state = 'paused'; stepOnce(); }
  }

  function stopTimer() { if (run.timer) { clearTimeout(run.timer); run.timer = null; } }

  function advance() {
    let r;
    try { r = run.gen.next(run.pending); run.pending = undefined; } catch (e) { onError(e); return null; }
    if (r.done) { onFinish(); return null; }
    const ev = r.value;
    if (ev.type === 'stmt') {
      run.steps++; run.curId = ev.stmt.id; run.curFrame = ev.frame;
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

  function showCurrent() {
    const fid = run.curFrame && run.curFrame.func.id;
    if (fid) {
      const i = st.prog.functions.findIndex((f) => f.id === fid);
      if (i >= 0 && i !== st.fi) { st.fi = i; st.sel = null; render(); }
    }
    decorate();
    const el = $(`#chart .shape[data-id="${CSS.escape(run.curId || '')}"]`);
    if (el) scrollIntoViewIfNeeded(el);
    run.viewFrame = null;
    renderVars();
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
    if (st.tab !== 'console') setTab('console');
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
    else { run.state = 'paused'; stepOnce(); }
  }

  function onFinish() {
    flushStreams();
    run.state = 'done';
    conWrite(`■ Fine del programma · ${run.steps.toLocaleString('it-IT')} passi`, true, 'sys');
    run.curId = null; run.curFrame = null;
    decorate(); renderVars();
    setStatus('done', 'Programma terminato');
  }
  function onError(e) {
    flushStreams();
    run.state = 'done';
    run.errId = e.stmtId || null;
    const fi = e.funcId ? st.prog.functions.findIndex((f) => f.id === e.funcId) : -1;
    if (fi >= 0 && fi !== st.fi) { st.fi = fi; render(); }
    if (!run.errId && e.stmtId) run.errId = e.stmtId;
    let where = '';
    if (e.stmtId) {
      const fs = M.findStmt(st.prog, e.stmtId);
      const fn = e.funcId && st.prog.functions.find((f) => f.id === e.funcId);
      if (fs) where = ` (in ${fs.func.name}, blocco «${RenderLib.caption(fs.stmt).text}»)`;
      else if (fn) where = ` (in ${fn.name})`;
    }
    conWrite('✖ Errore: ' + (e.message || String(e)) + where, true, 'error');
    decorate(); renderVars();
    const el = run.errId && $(`#chart .shape[data-id="${CSS.escape(run.errId)}"]`);
    if (el) scrollIntoViewIfNeeded(el);
    if (st.tab !== 'console') setTab('console');
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
    run.curId = null; decorate();
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
  function renderVars() {
    const box = $('#varsBody');
    const interp = run.interp;
    const stack = interp && isRunning() ? interp.stack : (run.mainFrame ? [run.mainFrame] : []);
    box.innerHTML = '';
    if (!stack.length) { box.append(h('p', { class: 'empty' }, 'Le variabili compaiono qui quando esegui il programma. Usa Passo per osservarle cambiare istruzione dopo istruzione.')); return; }
    const frame = run.viewFrame && stack.includes(run.viewFrame) ? run.viewFrame : stack[stack.length - 1];
    const crumbs = h('nav', { class: 'crumbs', 'aria-label': 'Chiamate in corso' });
    stack.forEach((fr, i) => {
      if (i) crumbs.append(h('span', { class: 'sep' }, '›'));
      crumbs.append(h('button', { type: 'button', class: fr === frame ? 'on' : '', onclick: () => { run.viewFrame = fr; renderVars(); } }, fr.func.name));
    });
    if (stack.length > 6) crumbs.classList.add('long');
    box.append(crumbs);
    if (!frame.vars.size) { box.append(h('p', { class: 'empty' }, 'Nessuna variabile dichiarata finora in ' + frame.func.name + '.')); return; }
    const tbl = h('table', { class: 'vars' }, h('thead', null, h('tr', null, h('th', null, 'Nome'), h('th', null, 'Tipo'), h('th', null, 'Valore'))));
    const tb = h('tbody');
    const fmt = (v) => (v === undefined ? h('span', { class: 'undef' }, 'nessun valore') : h('span', { class: 'v-' + v.t }, E.literalOf(v)));
    const prev = run.prevVals; const next = new Map();
    for (const c of frame.vars.values()) {
      const key = frame.depth + ':' + c.name;
      if (c.array) {
        const n = c.items.length;
        const summary = h('tr', { class: 'arr' }, h('td', null, c.name), h('td', null, `${TYPE_IT[c.type]}[${n}]`), h('td', { class: 'muted' }, `${n} elementi`));
        tb.append(summary);
        c.items.slice(0, 300).forEach((it, i) => {
          const k = key + '[' + i + ']'; const sv = it === undefined ? '∅' : E.literalOf(it); next.set(k, sv);
          const changed = prev.has(k) && prev.get(k) !== sv;
          tb.append(h('tr', { class: 'item' + (changed ? ' changed' : '') }, h('td', null, `[${i}]`), h('td', null, ''), h('td', null, fmt(it))));
        });
        if (n > 300) tb.append(h('tr', { class: 'item' }, h('td', { colspan: 3, class: 'muted' }, `… altri ${n - 300} elementi`)));
      } else {
        const sv = c.value === undefined ? '∅' : E.literalOf(c.value); next.set(key, sv);
        const changed = prev.has(key) && prev.get(key) !== sv;
        tb.append(h('tr', { class: changed ? 'changed' : '' }, h('td', null, c.name, c.param ? h('span', { class: 'ptag', title: 'parametro' }, 'par') : null), h('td', null, TYPE_IT[c.type]), h('td', null, fmt(c.value))));
      }
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
    if (st.tab !== 'code') return;
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

  /* ------------------------------ Schede --------------------------------- */
  function setTab(t) {
    st.tab = t; store.set('tab', t);
    $$('#tabs [role=tab]').forEach((b) => { const on = b.dataset.tab === t; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; });
    $$('.pane').forEach((p) => { p.hidden = p.id !== 'pane-' + t; });
    if (t === 'code') renderCode();
    if (t === 'vars') renderVars();
    if (t === 'files') renderFiles();
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
      if (/\.(fprg|xml)$/i.test(file.name) || /^\s*<\?xml|<flowgorithm/i.test(r.result)) loadText(r.result, file.name);
      else { st.vfs.set(file.name, r.result); saveVfs(); setTab('files'); toast(`File di testo ${file.name} aggiunto alla scheda File`, 'ok'); }
    };
    r.readAsText(file);
  }
  function guardDirty(action) {
    if (!st.dirty) { action(); return; }
    confirmBox('Modifiche non salvate', 'Il programma attuale ha modifiche non salvate. Vuoi continuare e perderle?', 'Continua', action);
  }
  function newProgram() {
    guardDirty(() => { if (isRunning()) stopRun(); st.prog = M.newProgram(); st.fi = 0; st.sel = null; st.undo = []; st.redo = []; st.fileName = null; st.dirty = false; run.mainFrame = null; render(); renderVars(); });
  }
  function loadExample(id) {
    const ex = Examples.get(id); if (!ex) return;
    guardDirty(() => { if (isRunning()) stopRun(); st.prog = ex.make(); st.fi = 0; st.sel = null; st.undo = []; st.redo = []; st.fileName = null; st.dirty = false; run.mainFrame = null; run.errId = null; conClear(); render(); renderVars(); setTimeout(fitIfLarge, 0); });
  }

  function exportSvg() {
    const svg = $('#chart svg').cloneNode(true);
    svg.setAttribute('width', svg.dataset.w); svg.setAttribute('height', svg.dataset.h);
    svg.insertBefore(h('style', null, exportCss()), svg.firstChild);
    $$('.hits', svg).forEach((x) => x.remove());
    return new XMLSerializer().serializeToString(svg);
  }
  function exportCss() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    let css = `text{font:${RenderLib.R_.font};fill:${v('--sh-text')};text-anchor:middle}.blabel{font-size:11px;font-weight:600;fill:${v('--muted')}}.flow{fill:none;stroke:${v('--flow')};stroke-width:1.6}.ahead{fill:${v('--flow')}}.joint{fill:${v('--flow')}}.shape>path,.shape>rect{stroke-width:1.6}.inner{fill:none!important}.note{stroke-dasharray:4 3}svg{background:${v('--paper')}}`;
    for (const c of ['term', 'decl', 'assign', 'in', 'out', 'cond', 'loop', 'call', 'comment', 'brk', 'file', 'inc']) css += `.c-${c}>path,.c-${c}>rect{fill:${v('--f-' + c)};stroke:${v('--s-' + c)}}`;
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
      c.toBlob((b) => download(safeName(st.prog.attrs.name) + '_' + func().name + '.png', b, 'image/png'));
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
      { label: 'Esporta diagramma SVG', do: () => download(safeName(st.prog.attrs.name) + '_' + func().name + '.svg', exportSvg(), 'image/svg+xml') },
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
    const keys = [['F5  ·  Ctrl+Invio', 'Esegui / continua'], ['F10', 'Passo successivo'], ['Esc', 'Chiudi finestre e menu'], ['Invio  ·  doppio clic', 'Modifica il blocco selezionato'], ['Canc', 'Elimina il blocco selezionato'], ['Ctrl+C  X  V  D', 'Copia, taglia, incolla, duplica'], ['Ctrl+Z  ·  Ctrl+Y', 'Annulla, ripeti'], ['Ctrl+rotella', 'Zoom']]
      .map(([a, b]) => h('tr', null, h('td', { class: 'mono' }, a), h('td', null, b)));
    const body = h('div', { class: 'help-body' },
      h('p', null, 'Fai clic su una freccia del diagramma per aggiungere un blocco. Trascina un blocco su un\'altra freccia per spostarlo. I file .fprg si aprono e si salvano con lo stesso formato XML usato dagli editor di diagrammi di flusso più diffusi a scuola.'),
      h('h3', null, 'Operatori'), h('table', { class: 'ref' }, h('tbody', null, ops)),
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
    $('#funcSel').addEventListener('change', (e) => showFunc(+e.target.value));
    $('#funcAdd').addEventListener('click', () => { if (isRunning()) { toast('Ferma il programma per modificare il diagramma', 'warn'); return; } editFunction(null); });
    $('#funcEdit').addEventListener('click', () => { if (isRunning()) { toast('Ferma il programma per modificare il diagramma', 'warn'); return; } st.fi === 0 ? editProgram() : editFunction(st.fi); });
    $('#funcDel').addEventListener('click', () => { if (isRunning()) { toast('Ferma il programma per modificare il diagramma', 'warn'); return; } deleteFunction(); });
    $('#runBtn').addEventListener('click', onRunBtn);
    $('#stepBtn').addEventListener('click', onStepBtn);
    $('#pauseBtn').addEventListener('click', onPauseBtn);
    $('#stopBtn').addEventListener('click', stopRun);
    const sp = $('#speed');
    sp.value = st.speed; $('#speedVal').textContent = SPEEDS[st.speed].label;
    sp.addEventListener('input', () => { st.speed = +sp.value; store.set('speed', st.speed); $('#speedVal').textContent = SPEEDS[st.speed].label; });
    $('#zoomIn').addEventListener('click', () => setZoom(st.zoom * 1.15));
    $('#zoomOut').addEventListener('click', () => setZoom(st.zoom / 1.15));
    $('#zoomFit').addEventListener('click', fitZoom);
    $('#zoomVal').addEventListener('click', () => setZoom(1));
    $$('#tabs [role=tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
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
    grip.addEventListener('pointerdown', (e) => {
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
    bindUi(); bindChart(); bindKeys();
    const saved = store.get('autosave', null);
    let ok = false;
    if (saved && saved.xml) {
      try { st.prog = M.parseFprg(saved.xml); st.fi = Math.min(saved.fi || 0, st.prog.functions.length - 1); st.fileName = saved.fileName || null; ok = true; } catch (e) { ok = false; }
    }
    if (!ok) st.prog = Examples.get('media').make();
    render(); setTab(st.tab); renderVars(); renderFiles(); setStatus('idle', 'Pronto');
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { render(); fitIfLarge(); });
    setTimeout(fitIfLarge, 0);
    // API minima per i test automatici
    window.FlowLab = { get state() { return st; }, run, loadText, serialize: () => M.serializeFprg(st.prog), render, setTab, submitInput, loadExample: (id) => { st.dirty = false; loadExample(id); } };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
