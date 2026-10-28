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
  const dimsOf = (cell) => cell.dims || [cell.items.length];

  /* ------------------------------------------------------------------ */
  class Viewer {
    constructor(key, funcName, cell, o) {
      this.key = key; this.funcName = funcName; this.name = (o && o.label) || cell.name;
      this.fixed = !!(o && o.fixed); // array dentro un oggetto: la cella resta sempre la stessa
      this.cell = null; this.live = true;
      this.lead = []; this.page = 0;               // indici scelti per le dimensioni iniziali e pagina del libro
      this.snapshot = null; this.changed = new Set(); this.focus = null;
      this.build();
      this.bind(cell);
    }

    /* ---- finestra ---- */
    build() {
      const close = h('button', { class: 'iconbtn', type: 'button', title: 'Chiudi', 'aria-label': 'Chiudi la finestra dell\'array', html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>', onclick: () => this.close() });
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
      const host = opts.host();
      host.append(this.win);
      const W = Math.min(520, window.innerWidth - 40), H = Math.min(380, window.innerHeight - 120);
      const n = viewers.size;
      // si apre sull'area del diagramma, accanto al pannello, senza coprire la scheda Variabili
      const col = document.querySelector('.canvas-col');
      const right = col ? col.getBoundingClientRect().right : window.innerWidth;
      Object.assign(this.win.style, { width: W + 'px', height: H + 'px', left: Math.max(10, right - W - 24 - n * 28) + 'px', top: (90 + n * 28) + 'px' });
      this.raise();
      this.win.addEventListener('pointerdown', () => this.raise(), true);
      this.head.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target.closest('button')) return;
        e.preventDefault(); this.head.setPointerCapture(e.pointerId);
        const sx = e.clientX, sy = e.clientY, ox = this.win.offsetLeft, oy = this.win.offsetTop;
        const mv = (ev) => { this.win.style.left = ox + ev.clientX - sx + 'px'; this.win.style.top = oy + ev.clientY - sy + 'px'; this.clamp(); };
        const up = () => { this.head.removeEventListener('pointermove', mv); this.head.removeEventListener('pointerup', up); };
        this.head.addEventListener('pointermove', mv); this.head.addEventListener('pointerup', up);
      });
      this.body.addEventListener('scroll', () => this.schedule());
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
    raise() {
      this.win.style.zIndex = opts.nextZ();
      document.querySelectorAll('.fwin').forEach((x) => x.classList.toggle('active', x === this.win));
    }
    clamp() {
      const W = window.innerWidth, H = window.innerHeight, w = this.win;
      if (w.offsetWidth > W) w.style.width = W + 'px';
      if (w.offsetHeight > H) w.style.height = H + 'px';
      w.style.left = Math.max(0, Math.min(w.offsetLeft, W - w.offsetWidth)) + 'px';
      w.style.top = Math.max(0, Math.min(w.offsetTop, H - w.offsetHeight)) + 'px';
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
    flip(d) {
      if (reduceMotion()) return;
      this.pageEl.classList.remove('turn-next', 'turn-prev');
      void this.pageEl.offsetWidth;
      this.pageEl.classList.add(d === 'next' ? 'turn-next' : 'turn-prev');
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
          let cls = 'av-c' + ((r + c) % 2 ? ' odd' : '') + (s === null ? ' undef' : ' t-' + v.t) + (this.changed.has(off) ? ' chg' : '') + (off === this.focus ? ' focus' : '');
          html += `<div class="${cls}" style="left:${c * cw}px;top:${r * CH}px;width:${cw}px" data-off="${off}">${s === null ? '·' : esc(s)}</div>`;
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
    }
    hover(e) {
      const t = e.target.closest('.av-c');
      if (!t) return;
      const off = +t.dataset.off; const v = this.cell.items[off];
      this.foot.textContent = `${this.name}[${this.indices(off).join(', ')}] = ${v === undefined ? 'nessun valore' : E.literalOf(v)}`;
    }
  }
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /* ------------------------------------------------------------------ */
  function open(funcName, cell, o) {
    const key = funcName.toLowerCase() + '::' + ((o && o.label) || cell.name).toLowerCase();
    const v = viewers.get(key);
    if (v) { v.bind(cell); v.live = true; v.raise(); v.update(); return v; }
    const nv = new Viewer(key, funcName, cell, o);
    viewers.set(key, nv);
    return nv;
  }
  /* resolve(funcName, varName) → cella attuale o null */
  function refresh(resolve) {
    for (const v of viewers.values()) {
      if (v.fixed) { v.update(); continue; }
      const c = resolve(v.funcName, v.name);
      v.live = !!c;
      if (c && c !== v.cell && c.array) v.bind(c);
      else v.update();
    }
  }
  return { configure, open, refresh, get count() { return viewers.size; } };
})();
