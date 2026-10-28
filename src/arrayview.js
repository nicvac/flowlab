/* ==========================================================================
   FlowLab — visualizzatore di array per il debug
   Finestre mobili che mostrano un array come striscia (1D), scacchiera (2D),
   libro da sfogliare (3D: la prima dimensione è la pagina) e, oltre, selettori
   di indice per le dimensioni iniziali + libro per le ultime tre.
   La griglia disegna solo le celle visibili; ai bordi oltre i quali ci sono
   altre celle si applica una sfumatura verso la trasparenza (mask-image).
   Quando un valore cambia la vista si porta nell'intorno della cella.
   ========================================================================== */
'use strict';

const ArrayView = (() => {
  const E = ExprLib;
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
  const CH = 30;            // altezza cella
  const HEAD_W = 46;        // colonna degli indici di riga
  const FADE = 46;          // ampiezza della sfumatura
  const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const viewers = new Map();
  let opts = { host: () => document.body, nextZ: () => 40 };

  function configure(o) { opts = Object.assign(opts, o); }

  const lit = (v) => (v === undefined ? null : E.literalOf(v));
  const objWins = new Map(); // finestre di ispezione degli oggetti
  const allCount = () => viewers.size + objWins.size;
  const ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  /* ---------------------------- connettori ----------------------------
     Ogni finestra può avere una sorgente (src): una funzione che restituisce il
     rettangolo dell'elemento cliccato, { r, out } con out = fuori vista. Un livello
     SVG sopra le finestre disegna una curva dalla sorgente al bordo della finestra. */
  const NS = 'http://www.w3.org/2000/svg';
  let linkSvg = null, linkRaf = 0;
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
  const visible = (el) => !!el && el.isConnected && el.getClientRects().length > 0 && !el.closest('[hidden]');
  /* limita il rettangolo all'area visibile del contenitore che scorre */
  function clipTo(r, box) {
    const out = r.bottom < box.top || r.top > box.bottom || r.right < box.left || r.left > box.right;
    if (!out) return { r, out: false };
    const cx = Math.max(box.left + 4, Math.min(box.right - 4, (r.left + r.right) / 2)), cy = Math.max(box.top + 4, Math.min(box.bottom - 4, (r.top + r.bottom) / 2));
    return { r: { left: cx - 3, right: cx + 3, top: cy - 3, bottom: cy + 3, width: 6, height: 6 }, out: true };
  }
  /* sorgente: un elemento della pagina trovato con un selettore (la scheda Variabili si ridisegna a ogni passo) */
  function domSrc(selector) {
    return () => {
      const el = document.querySelector(selector);
      if (!visible(el)) return null;
      const sc = el.closest('#varsBody, .ov-body, .fwin-body, .pane');
      // in una tabella si evidenzia tutta la riga: la linea parte dal suo bordo senza attraversare il testo
      const r = rectOf(el.closest('tr') || el);
      return sc ? clipTo(r, rectOf(sc)) : { r, out: false };
    };
  }
  /* sorgente: una cella del visualizzatore di array (le celle fuori vista non esistono: si calcola la posizione) */
  function cellSrc(v, off) {
    return () => {
      if (!v.win.isConnected) return null;
      const ix = v.indices(off), N = v.dims.length;
      const body = rectOf(v.body);
      if (N >= 3 && (ix[N - 3] !== v.page || v.lead.some((x, k) => x !== ix[k]))) return clipTo({ left: body.right + 99, right: body.right + 99, top: body.top, bottom: body.top }, body);
      const r = N === 1 ? 0 : ix[N - 2], c = ix[N - 1];
      const left = body.left + c * v.cw - v.body.scrollLeft, top = body.top + r * CH - v.body.scrollTop;
      return clipTo({ left, top, right: left + v.cw, bottom: top + CH, width: v.cw, height: CH }, body);
    };
  }
  function drawLinks() {
    linkRaf = 0;
    const wins = [...objWins.values(), ...viewers.values()].filter((w) => w.src && w.win.isConnected);
    if (!wins.length) { if (linkSvg) linkSvg.innerHTML = ''; return; }
    if (!linkSvg || !linkSvg.isConnected) { linkSvg = document.createElementNS(NS, 'svg'); linkSvg.setAttribute('class', 'wlinks'); linkSvg.setAttribute('aria-hidden', 'true'); opts.host().append(linkSvg); }
    let html = '';
    const top = Math.max(...wins.map((w) => +w.win.style.zIndex || 0));
    for (const w of wins) {
      const s = w.src(); if (!s) continue;
      const a = s.r, b = rectOf(w.win);
      const ax = (a.left + a.right) / 2, ay = (a.top + a.bottom) / 2;
      // punto di arrivo: il lato della finestra rivolto verso la sorgente
      // lato di uscita: la direzione in cui la finestra è più lontana
      const gx = ax < b.left ? b.left - a.right : ax > b.right ? a.left - b.right : -1;
      const gy = ay < b.top ? b.top - a.bottom : ay > b.bottom ? a.top - b.bottom : -1;
      if (gx < 0 && gy < 0) continue; // la sorgente è sotto la finestra
      let ex, ey, dx = 0, dy = 0;
      if (gx >= gy) { dx = ax < b.left ? -1 : 1; ex = dx < 0 ? b.left : b.right; ey = Math.max(b.top + 18, Math.min(b.bottom - 18, ay)); }
      else { dy = ay < b.top ? -1 : 1; ey = dy < 0 ? b.top : b.bottom; ex = Math.max(b.left + 18, Math.min(b.right - 18, ax)); }
      // partenza: il lato della sorgente rivolto verso la finestra
      const sx = dx ? (dx < 0 ? a.right : a.left) : ax, sy = dy ? (dy < 0 ? a.bottom : a.top) : ay;
      const k = Math.max(40, Math.min(160, Math.hypot(ex - sx, ey - sy) / 2.5));
      const c1x = sx - dx * k, c1y = sy - dy * k, c2x = ex + dx * k, c2y = ey + dy * k;
      const cls = 'wlink' + (w instanceof ObjWin ? ' obj' : ' arr') + (s.out ? ' out' : '') + ((+w.win.style.zIndex || 0) === top ? ' on' : '');
      html += `<g class="${cls}">`;
      if (!s.out) html += `<rect class="wl-src" x="${a.left - 2}" y="${a.top - 2}" width="${a.right - a.left + 4}" height="${a.bottom - a.top + 4}" rx="4"/>`;
      const d = `M${sx} ${sy}C${c1x} ${c1y} ${c2x} ${c2y} ${ex} ${ey}`;
      html += `<path class="wl-halo" d="${d}"/><path class="wl-line" d="${d}"/><circle class="wl-dot" cx="${sx}" cy="${sy}" r="3.5"/><circle class="wl-end" cx="${ex}" cy="${ey}" r="4.5"/></g>`;
    }
    linkSvg.innerHTML = html;
    linkRaf = requestAnimationFrame(drawLinks);
  }
  const startLinks = () => { if (!linkRaf) linkRaf = requestAnimationFrame(drawLinks); };

  /* finestra mobile: posizione iniziale sull'area del diagramma, trascinamento dalla barra, primo piano */
  /* near: rettangolo dell'elemento cliccato; la finestra si apre accanto, dal lato dove c'è posto */
  function floatWin(win, head, W, H, near) {
    opts.host().append(win);
    const n = allCount();
    const col = document.querySelector('.canvas-col');
    const right = col ? col.getBoundingClientRect().right : window.innerWidth;
    let x = Math.max(10, right - W - 24 - n * 28), y = 90 + n * 28;
    if (near) {
      const r = near.r, VW = window.innerWidth, VH = window.innerHeight, GAP = 56;
      x = r.left - W - GAP;
      if (x < 10) x = r.right + GAP;
      y = Math.max(56, Math.min(VH - H - 10, r.top - 40));
      if (x + W > VW - 10) { x = Math.max(10, Math.min(VW - W - 10, r.left - W / 2)); y = r.bottom + 40 + H < VH ? r.bottom + 40 : Math.max(56, r.top - H - 40); }
    }
    Object.assign(win.style, { width: W + 'px', height: H + 'px', left: x + 'px', top: y + 'px' });
    const raise = () => { win.style.zIndex = opts.nextZ(); document.querySelectorAll('.fwin').forEach((x) => x.classList.toggle('active', x === win)); };
    const clamp = () => {
      const VW = window.innerWidth, VH = window.innerHeight;
      if (win.offsetWidth > VW) win.style.width = VW + 'px';
      if (win.offsetHeight > VH) win.style.height = VH + 'px';
      win.style.left = Math.max(0, Math.min(win.offsetLeft, VW - win.offsetWidth)) + 'px';
      win.style.top = Math.max(0, Math.min(win.offsetTop, VH - win.offsetHeight)) + 'px';
    };
    raise();
    win.addEventListener('pointerdown', raise, true);
    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      e.preventDefault(); head.setPointerCapture(e.pointerId);
      const sx = e.clientX, sy = e.clientY, ox = win.offsetLeft, oy = win.offsetTop;
      const mv = (ev) => { win.style.left = ox + ev.clientX - sx + 'px'; win.style.top = oy + ev.clientY - sy + 'px'; clamp(); };
      const up = () => { head.removeEventListener('pointermove', mv); head.removeEventListener('pointerup', up); };
      head.addEventListener('pointermove', mv); head.addEventListener('pointerup', up);
    });
    clamp();
    return { raise, clamp };
  }
  const dimsOf = (cell) => cell.dims || [cell.items.length];

  /* ------------------------------------------------------------------ */
  class Viewer {
    constructor(key, funcName, cell, o) {
      this.key = key; this.funcName = funcName; this.name = (o && o.label) || cell.name;
      this.fixed = !!(o && o.fixed); // array dentro un oggetto: la cella resta sempre la stessa
      this.src = (o && o.src) || null;
      this.cell = null; this.live = true;
      this.lead = []; this.page = 0;               // indici scelti per le dimensioni iniziali e pagina del libro
      this.snapshot = null; this.changed = new Set(); this.focus = null;
      this.build();
      this.bind(cell);
    }

    /* ---- finestra ---- */
    build() {
      const close = h('button', { class: 'iconbtn', type: 'button', title: 'Chiudi', 'aria-label': 'Chiudi la finestra dell\'array', html: ICON_X, onclick: () => this.close() });
      this.titleEl = h('span', { class: 'fwin-title' });
      this.stateEl = h('span', { class: 'av-state' });
      this.head = h('div', { class: 'fwin-head' }, this.titleEl, this.stateEl, h('span', { class: 'grow' }), close);
      this.bar = h('div', { class: 'av-bar' });
      this.colHead = h('div', { class: 'av-colhead' });
      this.rowHead = h('div', { class: 'av-rowhead' });
      this.corner = h('div', { class: 'av-corner' });
      this.spacer = h('div', { class: 'av-spacer' });
      this.cells = h('div', { class: 'av-cells' });
      this.body = h('div', { class: 'av-body', tabindex: '0', 'aria-label': 'Celle dell\'array' }, this.spacer, this.cells);
      this.grid = h('div', { class: 'av-grid' }, this.corner, this.colHead, this.rowHead, this.body);
      this.pageEl = h('div', { class: 'av-page' }, this.grid);
      this.stage = h('div', { class: 'av-stage' }, this.pageEl);
      this.foot = h('div', { class: 'av-foot' }, ' ');
      this.win = h('div', { class: 'fwin avwin', role: 'dialog' }, this.head, h('div', { class: 'av-main' }, this.bar, this.stage, this.foot));
      // si apre sull'area del diagramma, accanto al pannello, senza coprire la scheda Variabili
      const fw = floatWin(this.win, this.head, Math.min(520, window.innerWidth - 40), Math.min(380, window.innerHeight - 120), this.src && this.src());
      this.raise = fw.raise; this.clamp = fw.clamp;
      this.body.addEventListener('scroll', () => this.schedule());
      // clic su una cella che contiene un oggetto: si apre la finestra dell'oggetto
      this.body.addEventListener('click', (e) => {
        const t = e.target.closest('.av-c.obj'); if (!t) return;
        const v = this.cell.items[+t.dataset.off];
        if (v && v.t === 'Object' && v.v) openObject(v.v, cellSrc(this, +t.dataset.off));
      });
      this.body.addEventListener('pointermove', (e) => this.hover(e));
      this.body.addEventListener('pointerleave', () => { this.foot.textContent = ' '; });
      this.win.addEventListener('keydown', (e) => {
        if (this.dims.length < 3) return;
        if (e.key === 'PageDown') { e.preventDefault(); this.setPage(this.page + 1); }
        if (e.key === 'PageUp') { e.preventDefault(); this.setPage(this.page - 1); }
      });
      if (window.ResizeObserver) new ResizeObserver(() => { this.clamp(); this.schedule(); }).observe(this.win);
      this.clamp();
    }
    close() { this.win.remove(); viewers.delete(this.key); }

    /* ---- dati ---- */
    bind(cell) {
      if (cell === this.cell) return;
      this.cell = cell;
      this.dims = dimsOf(cell).slice();
      const N = this.dims.length;
      this.lead = new Array(Math.max(0, N - 3)).fill(0);
      this.page = 0;
      this.snapshot = null; this.changed = new Set();
      this.measure();
      this.titleEl.textContent = `${this.name} · ${E.typeName(cell.type)}[${this.dims.join(' × ')}]`;
      this.win.setAttribute('aria-label', `Array ${this.name}`);
      const firstBind = !this.win.dataset.mode;
      this.win.dataset.mode = N === 1 ? 'strip' : N === 2 ? 'board' : 'book';
      if (firstBind && N === 1) this.win.style.height = '190px';
      if (firstBind && N >= 3) this.win.style.height = Math.min(460, window.innerHeight - 120) + 'px';
      this.buildBar();
      this.update(true);
      // aperta a programma avviato: si porta sull'ultima cella scritta
      if (cell.lastWrite != null) { this.changed = new Set([cell.lastWrite]); this.goTo(cell.lastWrite); }
    }
    measure() {
      // larghezza delle celle in base ai valori (campione)
      const it = this.cell.items; const step = Math.max(1, Math.floor(it.length / 2000));
      let longest = 3;
      for (let i = 0; i < it.length; i += step) { const s = lit(it[i]); if (s && s.length > longest) longest = s.length; }
      longest = Math.max(longest, String(Math.max(...this.dims) - 1).length);
      this.cw = Math.round(Math.min(150, Math.max(44, longest * 8 + 18)));
    }
    get rows() { const N = this.dims.length; return N === 1 ? 1 : this.dims[N - 2]; }
    get cols() { return this.dims[this.dims.length - 1]; }
    /* offset piatto della cella (r, c) nella vista corrente */
    offset(r, c) {
      const D = this.dims, N = D.length;
      if (N === 1) return c;
      if (N === 2) return r * D[1] + c;
      let off = 0;
      for (let k = 0; k < N - 3; k++) off = off * D[k] + this.lead[k];
      off = off * D[N - 3] + this.page;
      return (off * D[N - 2] + r) * D[N - 1] + c;
    }
    /* indici completi di un offset */
    indices(off) {
      const D = this.dims, out = new Array(D.length);
      for (let k = D.length - 1; k >= 0; k--) { out[k] = off % D[k]; off = Math.floor(off / D[k]); }
      return out;
    }

    /* ---- barra: selettori delle dimensioni iniziali e pagine del libro ---- */
    buildBar() {
      this.bar.innerHTML = '';
      const D = this.dims, N = D.length;
      this.bar.hidden = N < 3;
      if (N < 3) return;
      const stepper = (label, get, set, max, cls) => {
        const out = h('output', { class: 'av-idx' });
        const refresh = () => { out.textContent = String(get()); };
        const wrap = h('div', { class: 'av-step ' + (cls || '') },
          h('span', { class: 'av-lbl' }, label),
          h('button', { type: 'button', class: 'iconbtn', 'aria-label': label + ': precedente', onclick: () => { set(Math.max(0, get() - 1)); } }, '‹'),
          out,
          h('button', { type: 'button', class: 'iconbtn', 'aria-label': label + ': successivo', onclick: () => { set(Math.min(max - 1, get() + 1)); } }, '›'),
          h('span', { class: 'av-max' }, `/ ${max - 1}`));
        wrap._refresh = refresh; refresh();
        return wrap;
      };
      this.steppers = [];
      if (N > 3) {
        const lst = h('div', { class: 'av-lead', role: 'group', 'aria-label': 'Indici delle prime dimensioni' });
        for (let k = 0; k < N - 3; k++) {
          const s = stepper(`dim ${k + 1}`, () => this.lead[k], (v) => { this.lead[k] = v; this.afterNav(); }, D[k]);
          this.steppers.push(s); lst.append(s);
        }
        this.bar.append(lst);
      }
      // il cubo delle ultime tre dimensioni, aperto a libro: si sfoglia la prima
      const pages = D[N - 3];
      this.pageStep = stepper('pagina', () => this.page, (v) => this.setPage(v), pages, 'av-pagestep');
      this.range = h('input', { type: 'range', min: 0, max: Math.max(0, pages - 1), value: 0, 'aria-label': 'Pagina del libro', oninput: (e) => this.setPage(+e.target.value) });
      this.cube = h('span', { class: 'av-cube', 'aria-hidden': 'true' });
      this.bar.append(h('div', { class: 'av-bookbar' }, this.cube, this.pageStep, this.range));
      this.drawCube();
    }
    drawCube() {
      if (!this.cube) return;
      const pages = this.dims[this.dims.length - 3];
      const f = pages > 1 ? this.page / (pages - 1) : 0;
      // cubo assonometrico: la fetta evidenziata è la pagina aperta
      const x = 6 + f * 14, y = 4 + f * 0;
      this.cube.innerHTML = `<svg viewBox="0 0 40 34"><path class="cb" d="M6 10L20 4L34 10V26L20 32L6 26Z"/><path class="cb" d="M6 10L20 16L34 10M20 16V32"/><path class="sl2" d="M${6 + f * 14} ${10 + f * 6}L${20 + f * 14} ${4 + f * 6}L${20 + f * 14} ${20 + f * 6}L${6 + f * 14} ${26 + f * 6}Z"/></svg>`;
    }
    setPage(p, dir) {
      const pages = this.dims[this.dims.length - 3];
      p = Math.max(0, Math.min(pages - 1, p));
      if (p === this.page) return;
      const d = dir || (p > this.page ? 'next' : 'prev');
      this.page = p;
      this.flip(d);
      this.afterNav();
    }
    /* voltare pagina come in un libro rilegato a sinistra:
       avanti  → il foglio con la pagina che si lascia si solleva dal bordo destro e
                 ruota verso sinistra, scoprendo la pagina successiva sotto;
       indietro → il foglio della pagina precedente torna da sinistra verso destra
                 e si posa sopra quella che si stava guardando. */
    flip(d) {
      if (reduceMotion() || !this.pageEl.isConnected) return;
      this.endFlip();
      // fotografia della pagina che si sta lasciando (prima di ridisegnare)
      this.pendingFlip = { d, old: this.sheet() };
    }
    sheet() {
      const c = this.pageEl.cloneNode(true);
      c.classList.add('av-sheet');
      c.style.boxShadow = 'none';
      c.removeAttribute('tabindex');
      c.querySelectorAll('[tabindex]').forEach((x) => x.removeAttribute('tabindex'));
      c._sl = this.body.scrollLeft; c._st = this.body.scrollTop;
      return c;
    }
    runFlip() {
      const { d, old } = this.pendingFlip; this.pendingFlip = null;
      const place = (el) => {
        Object.assign(el.style, { left: this.pageEl.offsetLeft + 'px', top: this.pageEl.offsetTop + 'px', width: this.pageEl.offsetWidth + 'px', height: this.pageEl.offsetHeight + 'px' });
        this.stage.append(el);
        const b = el.querySelector('.av-body'); if (b) { b.scrollLeft = el._sl; b.scrollTop = el._st; }
      };
      const layers = [];
      if (d === 'next') { place(old); old.classList.add('turn-away'); layers.push(old); }
      else {
        place(old); layers.push(old);                         // la pagina di prima resta ferma sotto…
        const nw = this.sheet(); place(nw); nw.classList.add('turn-back'); layers.push(nw); // …e quella precedente ci torna sopra
      }
      this.flipLayers = layers;
      this.flipTimer = setTimeout(() => this.endFlip(), 700);
    }
    endFlip() {
      clearTimeout(this.flipTimer);
      (this.flipLayers || []).forEach((x) => x.remove());
      this.flipLayers = null; this.pendingFlip = null;
    }
    afterNav() {
      if (this.steppers) this.steppers.forEach((s) => s._refresh());
      if (this.pageStep) { this.pageStep._refresh(); this.range.value = this.page; }
      this.drawCube();
      this.stackShadow();
      this.render();
    }
    stackShadow() {
      // spessore del libro: pagine prima (a sinistra) e dopo (a destra)
      if (this.dims.length < 3) { this.pageEl.style.boxShadow = ''; return; }
      const pages = this.dims[this.dims.length - 3];
      const before = Math.min(5, this.page), after = Math.min(5, pages - 1 - this.page);
      const sh = [];
      for (let i = 1; i <= after; i++) sh.push(`${i * 3}px ${i * 2}px 0 -1px var(--av-paper-edge)`, `${i * 3}px ${i * 2}px 0 0 var(--av-paper-line)`);
      for (let i = 1; i <= before; i++) sh.push(`${-i * 3}px ${i * 2}px 0 -1px var(--av-paper-edge)`, `${-i * 3}px ${i * 2}px 0 0 var(--av-paper-line)`);
      this.pageEl.style.boxShadow = sh.join(', ');
    }

    /* ---- aggiornamento dal programma ---- */
    update(first) {
      const it = this.cell.items;
      const big = it.length > 200000;
      const cur = big ? null : it.map(lit);
      const changed = new Set();
      if (this.snapshot && cur) for (let i = 0; i < cur.length; i++) if (cur[i] !== this.snapshot[i]) changed.add(i);
      if (this.snapshot && big && this.cell.lastWrite != null) changed.add(this.cell.lastWrite);
      this.snapshot = cur;
      this.changed = changed;
      this.stateEl.textContent = this.live ? '' : 'non in esecuzione';
      if (changed.size) {
        // la cella da inquadrare: l'ultima scritta, se è tra quelle cambiate
        const target = changed.has(this.cell.lastWrite) ? this.cell.lastWrite : [...changed].pop();
        this.goTo(target);
      } else if (first) {
        this.afterNav();
      } else this.render();
    }
    goTo(off) {
      const ix = this.indices(off), N = this.dims.length;
      if (N >= 3) {
        let nav = false;
        for (let k = 0; k < N - 3; k++) if (this.lead[k] !== ix[k]) { this.lead[k] = ix[k]; nav = true; }
        if (this.page !== ix[N - 3]) { const d = ix[N - 3] > this.page ? 'next' : 'prev'; this.page = ix[N - 3]; this.flip(d); nav = true; }
        if (nav || true) this.afterNav();
      } else this.render();
      const r = N === 1 ? 0 : ix[N - 2], c = ix[N - 1];
      this.focus = off;
      const b = this.body;
      const left = c * this.cw - (b.clientWidth - this.cw) / 2, top = r * CH - (b.clientHeight - CH) / 2;
      b.scrollTo({ left: Math.max(0, left), top: Math.max(0, top), behavior: reduceMotion() ? 'auto' : 'smooth' });
      this.schedule();
    }

    /* ---- disegno della griglia (solo le celle visibili) ---- */
    schedule() { if (this.raf) return; this.raf = requestAnimationFrame(() => { this.raf = 0; this.render(); }); }
    render() {
      const R = this.rows, C = this.cols, cw = this.cw, N = this.dims.length;
      const strip = N === 1;
      this.grid.classList.toggle('strip', strip);
      this.spacer.style.width = C * cw + 'px';
      this.spacer.style.height = R * CH + 'px';
      const b = this.body;
      const sl = b.scrollLeft, st = b.scrollTop, vw = b.clientWidth, vh = b.clientHeight;
      const c0 = Math.max(0, Math.floor(sl / cw) - 1), c1 = Math.min(C - 1, Math.ceil((sl + vw) / cw));
      const r0 = Math.max(0, Math.floor(st / CH) - 1), r1 = Math.min(R - 1, Math.ceil((st + vh) / CH));
      const items = this.cell.items;
      let html = '';
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const off = this.offset(r, c);
          const v = items[off];
          const s = lit(v);
          const isObj = s !== null && v.t === 'Object' && v.v;
          let cls = 'av-c' + ((r + c) % 2 ? ' odd' : '') + (s === null ? ' undef' : ' t-' + v.t) + (isObj ? ' obj' : '') + (this.changed.has(off) ? ' chg' : '') + (off === this.focus ? ' focus' : '');
          html += `<div class="${cls}" style="left:${c * cw}px;top:${r * CH}px;width:${cw}px" data-off="${off}"${isObj ? ' role="button" title="Apri l\'oggetto"' : ''}>${s === null ? '·' : esc(s)}</div>`;
        }
      }
      this.cells.innerHTML = html;
      // intestazioni
      let ch = '';
      for (let c = c0; c <= c1; c++) ch += `<span style="left:${c * cw - sl}px;width:${cw}px">${c}</span>`;
      this.colHead.innerHTML = ch;
      let rh = '';
      if (!strip) for (let r = r0; r <= r1; r++) rh += `<span style="top:${r * CH - st}px">${r}</span>`;
      this.rowHead.innerHTML = rh;
      this.corner.textContent = strip ? '' : (N === 2 ? 'r \\ c' : '');
      // sfumature ai bordi oltre i quali ci sono altre celle
      const fl = sl > 1 ? FADE : 0, fr = sl + vw < C * cw - 1 ? FADE : 0;
      const ft = st > 1 ? FADE : 0, fb = st + vh < R * CH - 1 ? FADE : 0;
      for (const [el, l, r2, t, bt] of [[b, fl, fr, ft, fb], [this.colHead, fl, fr, 0, 0], [this.rowHead, 0, 0, ft, fb]]) {
        el.style.setProperty('--fl', l + 'px'); el.style.setProperty('--fr', r2 + 'px');
        el.style.setProperty('--ft', t + 'px'); el.style.setProperty('--fb', bt + 'px');
      }
      if (this.pendingFlip) this.runFlip();
    }
    hover(e) {
      const t = e.target.closest('.av-c');
      if (!t) return;
      const off = +t.dataset.off; const v = this.cell.items[off];
      this.foot.textContent = `${this.name}[${this.indices(off).join(', ')}] = ${v === undefined ? 'nessun valore' : E.literalOf(v)}${v && v.t === 'Object' && v.v ? ' · clic per aprire l\'oggetto' : ''}`;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Ispettore di un oggetto: i suoi attributi, raggruppati per la classe che li dichiara.
     Gli oggetti contenuti si aprono a loro volta, gli array nel visualizzatore. */
  class ObjWin {
    constructor(obj, src) {
      this.obj = obj; this.key = 'obj:' + obj.uid; this.snap = null; this.stale = false; this.src = src || null;
      const close = h('button', { class: 'iconbtn', type: 'button', title: 'Chiudi', 'aria-label': 'Chiudi la finestra dell\'oggetto', html: ICON_X, onclick: () => this.close() });
      this.titleEl = h('span', { class: 'fwin-title' });
      this.stateEl = h('span', { class: 'av-state' });
      this.head = h('div', { class: 'fwin-head' }, this.titleEl, this.stateEl, h('span', { class: 'grow' }), close);
      this.body = h('div', { class: 'ov-body' });
      this.win = h('div', { class: 'fwin ovwin', role: 'dialog', 'data-key': this.key }, this.head, this.body);
      const fw = floatWin(this.win, this.head, Math.min(400, window.innerWidth - 40), Math.min(Math.max(170, 96 + obj.fields.size * 31 + new Set([...obj.fields.values()].map((c) => c.owner)).size * 26), 460), this.src && this.src());
      this.raise = fw.raise;
      this.update();
    }
    close() { this.win.remove(); objWins.delete(this.key); }
    update() {
      const o = this.obj;
      this.titleEl.textContent = `${o.cls.name}#${o.id}`;
      this.win.setAttribute('aria-label', `Oggetto ${o.cls.name}#${o.id}`);
      this.stateEl.textContent = this.stale ? 'esecuzione precedente' : (o.cls.parent ? `${o.cls.name} eredita da ${o.cls.parent}` : '');
      const cur = new Map();
      const tb = h('tbody');
      const owners = new Set([...o.fields.values()].map((c) => c.owner));
      let lastOwner = null;
      for (const [k, c] of o.fields) {
        if (owners.size > 1 && c.owner !== lastOwner) {
          lastOwner = c.owner;
          tb.append(h('tr', { class: 'ov-group' }, h('td', { colspan: 3 }, c.owner === o.cls ? `di ${c.owner.name}` : `ereditati da ${c.owner.name}`)));
        }
        const sv = c.array ? String(c.writes || 0) : (c.value === undefined ? '∅' : E.literalOf(c.value));
        cur.set(k, sv);
        const chg = this.snap && this.snap.get(k) !== sv;
        let val;
        if (c.array) {
          const label = `${o.cls.name}#${o.id}.${c.name}`;
          val = h('button', { type: 'button', class: 'ov-link', 'data-src': k, title: 'Apri i valori dell\'array', onclick: () => open('@' + this.key, c, { label, fixed: true, src: domSrc(`.ovwin[data-key="${this.key}"] [data-src="${k}"]`) }) }, `${E.typeName(c.type)}[${(c.dims || [c.items.length]).join(' × ')}]`);
        } else if (c.value && c.value.t === 'Object' && c.value.v) {
          const target = c.value.v;
          val = h('button', { type: 'button', class: 'ov-link obj', 'data-src': k, title: 'Apri l\'oggetto', onclick: () => openObject(target, domSrc(`.ovwin[data-key="${this.key}"] [data-src="${k}"]`)) }, E.literalOf(c.value));
        } else val = c.value === undefined ? h('span', { class: 'undef' }, 'nessun valore') : h('span', { class: 'v-' + c.value.t }, E.literalOf(c.value));
        const vis = { public: '+', private: '-', protected: '#' }[c.visibility || 'public'];
        tb.append(h('tr', { class: chg ? 'changed' : '' },
          h('td', null, h('span', { class: 'ov-vis', title: { '+': 'pubblico', '-': 'privato', '#': 'protetto' }[vis] }, vis), c.name),
          h('td', null, E.typeName(c.type)), h('td', null, val)));
      }
      if (!o.fields.size) tb.append(h('tr', null, h('td', { colspan: 3, class: 'muted' }, 'Questo oggetto non ha attributi.')));
      this.snap = cur;
      this.body.innerHTML = '';
      this.body.append(h('table', { class: 'vars ov-table' }, h('thead', null, h('tr', null, h('th', null, 'Attributo'), h('th', null, 'Tipo'), h('th', null, 'Valore'))), tb));
    }
  }
  /* src: da dove è stato aperto (per il connettore); l'ultima apertura vince */
  function openObject(obj, src) {
    const key = 'obj:' + obj.uid;
    let w = objWins.get(key);
    if (w) { w.raise(); w.update(); }
    else { w = new ObjWin(obj, src); objWins.set(key, w); }
    if (src) { w.src = src; startLinks(); }
    return w;
  }
  /* un nuovo avvio: le finestre degli oggetti e degli array contenuti si riferiscono all'esecuzione precedente */
  function markStale() {
    for (const w of objWins.values()) { w.stale = true; w.update(); }
    for (const v of viewers.values()) if (v.fixed) { v.live = false; v.update(); }
  }
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /* ------------------------------------------------------------------ */
  function open(funcName, cell, o) {
    const key = funcName.toLowerCase() + '::' + ((o && o.label) || cell.name).toLowerCase();
    let v = viewers.get(key);
    if (v) { v.bind(cell); v.live = true; v.raise(); v.update(); }
    else { v = new Viewer(key, funcName, cell, o); viewers.set(key, v); }
    if (o && o.src) { v.src = o.src; startLinks(); }
    return v;
  }
  /* resolve(funcName, varName) → cella attuale o null */
  function refresh(resolve) {
    for (const w of objWins.values()) w.update();
    for (const v of viewers.values()) {
      if (v.fixed) { v.update(); continue; }
      const c = resolve(v.funcName, v.name);
      v.live = !!c;
      if (c && c !== v.cell && c.array) v.bind(c);
      else v.update();
    }
  }
  return { configure, open, openObject, domSrc, markStale, refresh, get count() { return allCount(); } };
})();
