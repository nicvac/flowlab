/* ==========================================================================
   FlowLab — layout and SVG drawing of the diagram
   Each block computes its extents to the left/right of the central
   axis (L, R) and its height; then it is drawn starting from (cx, y).
   ========================================================================== */
'use strict';
if (typeof L === 'undefined' && typeof require !== 'undefined') require('./i18n.js'); // testi tradotti (in Node: italiano)

const R_ = {
  H: 34, PADX: 16, MINW: 96, MAXW: 340, GAP: 28, DH: 46, BRANCH: 22,
  font: '700 12.5px "Atkinson Hyperlegible", system-ui, -apple-system, "Segoe UI", sans-serif',
};

const _measureCtx = (() => { try { return document.createElement('canvas').getContext('2d'); } catch (e) { return null; } })();
const CFONT = 'italic 400 12.5px "Atkinson Hyperlegible", system-ui, -apple-system, "Segoe UI", sans-serif';
function textW(t, font) {
  if (!_measureCtx) return t.length * 7.4;
  _measureCtx.font = font || R_.font;
  return _measureCtx.measureText(t).width;
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/* the text of a block with the escape sequences of its strings (\n, \t, \\, \", \') in red; st.q: the quote still open
   at the start of the line (a text on several lines) */
function escSeq(t, st) {
  st = st || { q: null };
  const s = String(t); let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (st.q) {
      if (c === '\\' && i + 1 < s.length && 'ntr\\"\''.includes(s[i + 1])) { out += `<tspan class="escseq">${esc(c + s[i + 1])}</tspan>`; i++; continue; }
      if (c === st.q) st.q = null;
    } else if (c === '"' || c === "'") st.q = c;
    out += esc(c);
  }
  return out;
}

function fit(t, max, font) {
  if (textW(t, font) <= max) return t;
  let lo = 0, hi = t.length;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (textW(t.slice(0, m) + '…', font) <= max) lo = m; else hi = m - 1; }
  return t.slice(0, lo) + '…';
}

/* Splits the text into lines that fit in maxW pixels (respects the line breaks) */
function wrapLines(text, maxW, font) {
  const F = font || CFONT;
  const out = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/(\s+)/);
    let cur = '';
    for (const w of words) {
      if (textW(cur + w, F) <= maxW) { cur += w; continue; }
      if (cur.trim()) out.push(cur.trimEnd());
      cur = w.trimStart();
      while (textW(cur, F) > maxW) { // longest word of the line
        let n = cur.length;
        while (n > 1 && textW(cur.slice(0, n), F) > maxW) n--;
        out.push(cur.slice(0, n)); cur = cur.slice(n);
      }
    }
    out.push(cur.trimEnd());
  }
  while (out.length > 1 && out[out.length - 1] === '') out.pop();
  return out;
}

/* the text in two lines of similar length, split on a space (null if there are none);
   better to break before an operator, especially if it binds loosely (and/or, comparisons) */
const OP_START = [[/^(?:and|or)\b/i, 0.75], [/^(?:not)\b/i, 0.8], [/^(?:<=|>=|==|!=|<>|<|>|=)(?:\s|$)/, 0.8], [/^(?:[-+&])/, 0.95], [/^(?:[*/%^]|mod\b)/i, 0.97]];
const OP_END = /(?:[-+*/%<>=!&|^←,(]|\band|\bor|\bnot|\bmod)$/i;
function split2(text, lmax) {
  const t = String(text).trim();
  let best = null, bc = Infinity, bfit = false;
  const re = /\s+/g; let m;
  while ((m = re.exec(t))) {
    const l1 = t.slice(0, m.index), l2 = t.slice(m.index + m[0].length);
    const w = Math.max(textW(l1), textW(l2)), fits = w <= lmax;
    const op = OP_START.find(([r]) => r.test(l2));
    const c = w * (op ? op[1] : 1) * (OP_END.test(l1) ? 1.15 : 1);
    if ((fits && !bfit) || (fits === bfit && c < bc)) { bc = c; best = [l1, l2]; bfit = fits; }
  }
  return best;
}

function dedupe(pts) {
  const out = [];
  for (const p of pts) { const q = out[out.length - 1]; if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push([p[0], p[1]]); }
  return out;
}
const cat2 = (a, b) => a.concat(b);
/* compact view: these blocks, if they come one after the other, touch each other (arrow of length 0) */
const COMPACT_KINDS = new Set(['declare', 'const', 'assign', 'input', 'output', 'call', 'comment', 'breakpoint', 'throw']);
const COMPOUND_KINDS = new Set(['if', 'while', 'for', 'do', 'try']);
const TAIL_C = 14; // last arrow of a branch or of the body of a loop: short, just enough for the +
const TOG = 24, LINE_H = 17;

const KIND_IT = {
  declare: L('chart.declare'), const: L('chart.constant'), assign: L('chart.assign'), input: 'Input', output: 'Output', if: L('chart.if'), while: L('chart.while'), for: L('chart.for'), do: L('chart.doWhile'),
  call: L('chart.call'), comment: L('chart.comment'), breakpoint: L('chart.breakpoint'), try: 'Try', throw: 'Throw',
  open: L('chart.openFile'), close: L('chart.closeFile'), read: L('chart.readFromFile'), write: L('chart.writeToFile'),
};

function caption(s) {
  const T = new Proxy({}, { get: (_, t) => ExprLib.typeName(t) });
  if (ModelLib.isIncomplete(s)) return { text: KIND_IT[s.kind], incomplete: true };
  switch (s.kind) {
    case 'declare': {
      const names = s.name.split(',').map((x) => x.trim()).filter(Boolean);
      // an array with its values and no size shows the size given by the values
      let size = s.size;
      if (s.array && !String(size || '').trim() && String(s.init || '').trim()) { try { size = ExprLib.parseArrayLit(s.init).dims.join(', '); } catch (e) { size = ''; } }
      return { text: `${s.array ? names.map((n) => `${n}[${size}]`).join(', ') : names.join(', ')}: ${T[s.type]}${String(s.init || '').trim() ? ' ← ' + s.init : ''}` };
    }
    case 'assign': return { text: `${s.variable} ← ${s.expression}` };
    case 'const': return { text: `${s.name}: ${T[s.type]} ← ${s.expression}`, badge: 'C' };
    case 'input': return { text: s.variable, badge: 'I' };
    case 'output': return { text: `${s.expression}${s.newline ? '' : '  ⋯'}`, badge: 'O' };
    case 'if': case 'while': case 'do': return { text: s.expression };
    case 'for': {
      const st = String(s.step).trim();
      return { text: L('chart.fromTo', { variable: s.variable, start: s.start, end: s.end, text: s.direction === 'dec' ? L('chart.backwards') : '', text2: st && st !== '1' ? L('chart.step') + st : '' }) };
    }
    case 'call': return { text: /\(/.test(s.expression) ? s.expression : s.expression + '()' };
    case 'comment': return { text: s.text.split('\n')[0] + (s.text.includes('\n') ? ' …' : '') };
    case 'breakpoint': return { text: s.always ? L('chart.pause') : L('chart.pauseIf', { expression: s.expression }) };
    case 'open': return { text: L('chart.open', { expression: s.expression, text: s.mode === 'read' ? L('chart.reading') : L('chart.writing') }) };
    case 'close': return { text: L('chart.closeFile2', { text: s.mode === 'read' ? L('chart.reading') : L('chart.writing') }) };
    case 'read': return { text: L('chart.readFromFile2', { variable: s.variable }) };
    case 'write': return { text: L('chart.writeToFile2', { expression: s.expression }) };
    case 'try': return { text: 'Try' };
    case 'throw': return { text: `Throw ${s.expression}` };
  }
  return { text: s.kind };
}

/* Geometric shapes (cx = axis, y = top, w/h size) */
function shapePath(shape, cx, y, w, h) {
  const l = cx - w / 2, r = cx + w / 2, b = y + h, m = y + h / 2;
  switch (shape) {
    case 'term': return `<rect x="${l}" y="${y}" width="${w}" height="${h}" rx="${h / 2}"/>`;
    case 'rect': return `<rect x="${l}" y="${y}" width="${w}" height="${h}" rx="2"/>`;
    case 'decl': return `<rect x="${l}" y="${y}" width="${w}" height="${h}" rx="2"/><path class="inner" d="M${l + 7} ${y}V${b}M${l} ${y + 7}H${r}"/>`;
    case 'para': { const k = 11; return `<path d="M${l + k} ${y}H${r}L${r - k} ${b}H${l}Z"/>`; }
    case 'diamond': return `<path d="M${cx} ${y}L${r} ${m}L${cx} ${b}L${l} ${m}Z"/>`;
    case 'hex': { const k = 14; return `<path d="M${l + k} ${y}H${r - k}L${r} ${m}L${r - k} ${b}H${l + k}L${l} ${m}Z"/>`; }
    case 'call': return `<rect x="${l}" y="${y}" width="${w}" height="${h}" rx="2"/><path class="inner" d="M${l + 8} ${y}V${b}M${r - 8} ${y}V${b}"/>`;
    case 'note': { const k = 9; return `<path class="note" d="M${l} ${y}H${r - k}L${r} ${y + k}V${b}H${l}Z"/><path class="inner" d="M${r - k} ${y}V${y + k}H${r}"/>`; }
    case 'oct': { const k = 9; return `<path d="M${l + k} ${y}H${r - k}L${r} ${y + k}V${b - k}L${r - k} ${b}H${l + k}L${l} ${b - k}V${y + k}Z"/>`; }
    case 'doc': { const q = 5; return `<path d="M${l} ${y}H${r}V${b - q}C${r - w * 0.25} ${b - q * 3} ${cx} ${b + q} ${l} ${b - q}Z"/>`; }
    // exceptions: Try, Catch and Finally have a header with the bar at the top; Throw is an outgoing arrow
    case 'exchead': return `<rect x="${l}" y="${y}" width="${w}" height="${h}" rx="6"/><path class="inner" d="M${l} ${y + 7}H${r}"/>`;
    case 'throw': { const k = 14; return `<path d="M${l} ${y}H${r - k}L${r} ${m}L${r - k} ${b}H${l}Z"/>`; }
  }
  return '';
}
const SHAPE_OF = {
  declare: 'decl', const: 'decl', assign: 'rect', input: 'para', output: 'para', if: 'diamond', while: 'diamond', do: 'diamond', for: 'hex',
  call: 'call', comment: 'note', breakpoint: 'oct',
  open: 'doc', close: 'doc', read: 'doc', write: 'doc', try: 'exchead', throw: 'throw',
};
const CAT_OF = {
  declare: 'decl', const: 'decl', assign: 'assign', input: 'in', output: 'out', if: 'cond', while: 'loop', do: 'loop', for: 'loop', call: 'call',
  comment: 'comment', breakpoint: 'brk',
  open: 'file', close: 'file', read: 'file', write: 'file', try: 'exc', throw: 'exc',
};

class Renderer {
  constructor() { this.reset(); }
  reset() { this.ins = []; this.sh = []; this.ln = []; this.bg = []; this.hit = []; this.hitTop = []; this.lbl = []; this.edges = []; }

  /* ---- graph of the paths (for the cursor that follows the arrows) ----
     Each drawing receives "head" = {node, pts, tag}: the pending path that arrives
     at its entry, and returns "tail": the path that starts from its exit. */
  edge(from, to, pts, tag) { this.edges.push({ from, to, pts: dedupe(pts), tag: tag || null }); }

  /* ---- primitives ---- */
  line(pts, head, cls) {
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join('');
    this.ln.push(`<path class="flow${cls ? ' ' + cls : ''}" d="${d}"${head ? ' marker-end="url(#ah)"' : ''}/>`);
  }
  insPoint(arr, idx, x, y1, y2, head) {
    const k = this.ins.length;
    this.ins.push({ arr, idx });
    // arrow of length 0 (compact view): the + is on the point, above the blocks
    if (y2 === y1) {
      this.hitTop.push(`<g class="ins zero" data-ins="${k}"><rect x="${x - 22}" y="${y1 - 8}" width="44" height="16"/><circle cx="${x}" cy="${y1}" r="9"/><path d="M${x - 4} ${y1}H${x + 4}M${x} ${y1 - 4}V${y1 + 4}"/></g>`);
      return;
    }
    this.line([[x, y1], [x, y2]], head);
    const hh = y2 - y1;
    this.hit.push(`<g class="ins" data-ins="${k}"><rect x="${x - 22}" y="${y1}" width="44" height="${hh}"/><circle cx="${x}" cy="${y1 + hh / 2}" r="9"/><path d="M${x - 4} ${y1 + hh / 2}H${x + 4}M${x} ${y1 + hh / 2 - 4}V${y1 + hh / 2 + 4}"/></g>`);
  }
  label(x, y, t, anchor) { this.lbl.push(`<text class="blabel" x="${x}" y="${y}" text-anchor="${anchor || 'middle'}">${t}</text>`); }

  /* mb: measures of the block (measure); if the text is truncated the + button appears to expand it */
  shape(id, kind, cat, shp, cx, y, w, h, text, title, extra, badge, mb) {
    const tog = mb && mb.expandable;
    const side = tog && shp !== 'diamond' ? TOG : 0; // space on the right for the button
    const tw = w - (shp === 'diamond' ? 36 : shp === 'hex' ? 30 : shp === 'para' ? 24 : 18) - (badge ? 18 : 0) - side;
    let s = `<g class="shape c-${cat}${extra || ''}${mb && mb.open ? ' open' : ''}" data-id="${id}"${kind ? ` data-kind="${kind}"` : ''}><title>${esc(title || text)}</title>${shapePath(shp, cx, y, w, h)}`;
    const tx = cx - side / 2 - (badge && side ? 9 : 0);
    if (mb && mb.lines) {
      const n = mb.lines.length;
      const q = { q: null };
      mb.lines.forEach((l, i) => { s += `<text x="${tx}" y="${y + h / 2 + (i - (n - 1) / 2) * LINE_H}" dy="0.35em">${escSeq(l, q)}</text>`; });
    } else s += `<text x="${tx}" y="${y + h / 2}" dy="0.35em">${escSeq(fit(text, tw))}</text>`;
    if (badge) s += `<text class="badge" x="${cx + w / 2 - 13}" y="${y + 11}" dy="0.35em">${badge}</text>`;
    if (tog) {
      const open = mb.open;
      // other shapes: on the right, before the possible I/O letter
      // diamond: just outside the top right side, so it does not cover the text
      const a2 = w / 2, b2 = h / 2, ln = Math.hypot(a2, b2);
      const px = shp === 'diamond' ? cx + a2 / 2 + (11 * b2) / ln : cx + w / 2 - 19 - (shp === 'hex' || shp === 'para' ? 9 : 0) - (badge ? 16 : 0);
      const py = shp === 'diamond' ? y + b2 / 2 - (11 * a2) / ln : (open ? y + 15 : y + h / 2);
      s += `<g class="ctoggle" data-toggle="${id}" role="button" aria-label="${open ? L('chart.collapseTheBlock') : L('chart.showAllTheTextOfThe')}"><title>${open ? L('chart.collapseTheBlock') : L('chart.showAllTheText')}</title><circle cx="${px}" cy="${py}" r="8"/><path d="M${px - 3.5} ${py}H${px + 3.5}${open ? '' : `M${px} ${py - 3.5}V${py + 3.5}`}"/></g>`;
    }
    s += '</g>';
    this.sh.push(s);
  }

  /* width and height of a block: if the text does not fit in the maximum width
     the block becomes expandable; when open, the text goes on several lines */
  measure(s, cap, shp, baseH) {
    if (shp === 'diamond' && !cap.incomplete) return this.diamond(s, cap, baseH);
    const badgeW = cap.badge && !cap.incomplete ? 18 : 0;
    // a text with line breaks (a string on several lines) is always all on several lines
    const breaks = !cap.incomplete && shp !== 'diamond' && String(cap.text).includes('\n');
    const expandable = !cap.incomplete && !breaks && textW(cap.text) > R_.MAXW;
    const open = expandable && !!this.expanded && this.expanded.has(s.id);
    if (!open && !breaks) return { w: this.boxW(cap.text, shp) + badgeW + (expandable && shp !== 'diamond' ? TOG : 0), h: baseH, expandable, open };
    const lines = wrapLines(cap.text, shp === 'diamond' ? 240 : R_.MAXW, R_.font);
    const lw = Math.max(...lines.map((l) => textW(l)));
    const half = (lines.length * LINE_H) / 2 + 4;
    if (shp === 'diamond') {
      // in the diamond the highest line is at half the height of the semi-axis: twice the width of the text
      const b = Math.max(baseH / 2, half * 2);
      return { w: Math.ceil(Math.max(R_.MINW, 2 * (lw + 22))), h: Math.ceil(2 * b), expandable, open, lines };
    }
    const padX = shp === 'hex' ? 44 : shp === 'para' ? 40 : R_.PADX * 2;
    return { w: Math.ceil(lw + padX + badgeW + (expandable ? TOG : 0)), h: Math.max(baseH, Math.ceil(lines.length * LINE_H + 18 + (shp === 'doc' ? 6 : 0))), expandable, open, lines };
  }

  /* diamond: the text is all inside (the text rectangle is inscribed in the diamond).
     One line if it is short, otherwise two lines of similar length; beyond the maximum
     size the text is truncated and the + button shows all of it */
  diamond(s, cap, baseH) {
    const t = cap.text, ONE = 200, LMAX = 220, OPENW = 240;
    let lines = textW(t) <= ONE ? [t] : split2(t, LMAX);
    let expandable = false;
    if (!lines || lines.some((l) => textW(l) > LMAX)) {
      const w = wrapLines(t, LMAX, R_.font);
      expandable = w.length > 2;
      lines = expandable ? [w[0], fit(w.slice(1).join(' '), LMAX)] : w;
    }
    const open = expandable && !!this.expanded && this.expanded.has(s.id);
    if (open) lines = wrapLines(t, OPENW, R_.font);
    const lw = Math.max(...lines.map((l) => textW(l)));
    const n = lines.length, hh = ((n - 1) * LINE_H) / 2 + 7; // half height of the text
    const b = Math.max(baseH / 2, n > 1 ? 2.5 * hh : 2 * hh); // half height of the diamond
    const a = (lw / 2 + 8) / (1 - hh / b); // mezza larghezza: (lw/2)/a + hh/b ≤ 1
    return { w: Math.ceil(Math.max(R_.MINW, 2 * a)), h: Math.ceil(2 * b), expandable, open, lines };
  }

  /* ---- layout ---- */
  boxW(text, shp) {
    const pad = shp === 'diamond' ? 56 : shp === 'hex' ? 44 : shp === 'para' ? 40 : R_.PADX * 2;
    return Math.round(Math.min(R_.MAXW + pad, Math.max(R_.MINW, textW(text) + pad)));
  }

  seq(arr, tailHead) {
    const parts = arr.map((s) => this.stmt(s));
    // compact view: consecutive simple blocks touch each other (arrow of length 0)
    const glued = arr.map((s, i) => !!this.compact && i > 0 && COMPACT_KINDS.has(s.kind) && COMPACT_KINDS.has(arr[i - 1].kind));
    // in a branch or in the body of a loop the last arrow is short; after another loop or an If it is zero
    // (the exit of the block continues straight into the return, without steps)
    const last = arr[arr.length - 1];
    // after an If the line goes down a little from its junction before turning (it does not run along its branches)
    const tail = !tailHead && last ? (COMPOUND_KINDS.has(last.kind) && last.kind !== 'if' ? 0 : TAIL_C) : R_.GAP;
    let lw = 22, R = 22, h = R_.GAP * (arr.length - glued.filter(Boolean).length) + tail;
    for (const p of parts) { lw = Math.max(lw, p.L); R = Math.max(R, p.R); h += p.h; }
    return {
      L: lw, R, h,
      draw: (cx, y, head) => {
        let cur = y;
        let pend = head;
        parts.forEach((p, i) => {
          const gap = glued[i] ? 0 : R_.GAP;
          this.insPoint(arr, i, cx, cur, cur + gap, true);
          const arrow = [[cx, cur], [cx, cur + gap]];
          cur += gap;
          pend = p.draw(cx, cur, { node: pend.node, pts: cat2(pend.pts, arrow), tag: pend.tag });
          cur += p.h;
        });
        this.insPoint(arr, arr.length, cx, cur, cur + tail, tailHead);
        return { node: pend.node, pts: cat2(pend.pts, [[cx, cur], [cx, cur + tail]]), tag: pend.tag };
      },
    };
  }

  stmt(s) {
    const cap = caption(s);
    const shp = SHAPE_OF[s.kind];
    const cat = cap.incomplete ? 'inc' : CAT_OF[s.kind];
    const title = cap.incomplete ? L('chart.incompleteDoubleClickToCompleteIt', { value: KIND_IT[s.kind] }) : `${KIND_IT[s.kind]}: ${cap.text}`;
    const H = R_.H;
    let DH = R_.DH;
    if (s.kind === 'if') {
      const mb = this.measure(s, cap, 'diamond', DH);
      const dw = mb.w; DH = mb.h;
      const T = this.seq(s.then, false), E = this.seq(s.else, false);
      const offR = Math.max(dw / 2 + R_.BRANCH, T.L + 26);
      const offL = Math.max(dw / 2 + R_.BRANCH, E.R + 26);
      const bh = Math.max(T.h, E.h);
      const h = DH / 2 + bh + 8;
      return {
        L: Math.max(dw / 2, offL + E.L), R: Math.max(dw / 2, offR + T.R), h,
        draw: (cx, y, head) => {
          const m = y + DH / 2, j = y + h, J = s.id + ':join';
          this.edge(head.node, s.id, head.pts, head.tag);
          this.shape(s.id, s.kind, cat, 'diamond', cx, y, dw, DH, cap.text, title, '', null, mb);
          this.line([[cx + dw / 2, m], [cx + offR, m]]);
          this.line([[cx - dw / 2, m], [cx - offL, m]]);
          this.label(cx + dw / 2 + 6, m - 6, L('chart.true'), 'start');
          this.label(cx - dw / 2 - 6, m - 6, L('chart.false'), 'end');
          const tT = T.draw(cx + offR, m, { node: s.id, pts: [[cx + dw / 2, m], [cx + offR, m]], tag: 'T' });
          const tE = E.draw(cx - offL, m, { node: s.id, pts: [[cx - dw / 2, m], [cx - offL, m]], tag: 'F' });
          this.line([[cx + offR, m + T.h], [cx + offR, j], [cx, j]]);
          this.line([[cx - offL, m + E.h], [cx - offL, j], [cx, j]]);
          this.ln.push(`<circle class="joint" cx="${cx}" cy="${j}" r="3.5"/>`);
          this.edge(tT.node, J, cat2(tT.pts, [[cx + offR, j], [cx, j]]), tT.tag);
          this.edge(tE.node, J, cat2(tE.pts, [[cx - offL, j], [cx, j]]), tE.tag);
          return { node: J, pts: [[cx, j]] };
        },
      };
    }
    if (s.kind === 'while' || s.kind === 'for') {
      const mb = this.measure(s, cap, s.kind === 'for' ? 'hex' : 'diamond', s.kind === 'for' ? H + 4 : DH);
      const dw = mb.w, dh = mb.h;
      const B = this.seq(s.body, false);
      const lo = Math.max(dw / 2, B.L) + 20, ro = Math.max(dw / 2, B.R) + 20;
      // below the body: the return starts at once, the exit passes 12 px lower
      const rd = 0, xd = 12;
      const h = dh + B.h + xd;
      return {
        L: lo + 4, R: ro + 4, h,
        draw: (cx, y, head) => {
          const m = y + dh / 2, by = y + dh + B.h;
          this.edge(head.node, s.id, head.pts, head.tag);
          this.shape(s.id, s.kind, cat, s.kind === 'for' ? 'hex' : 'diamond', cx, y, dw, dh, cap.text, title, '', null, mb);
          const tB = B.draw(cx, y + dh, { node: s.id, pts: [[cx, y + dh]], tag: 'T' });
          this.label(cx + 6, y + dh + 13, s.kind === 'for' ? L('chart.repeat') : L('chart.true'), 'start');
          // the return joins halfway along the arrow that enters the condition
          const jy = y - R_.GAP / 2;
          this.line([[cx, by], [cx, by + rd], [cx - lo, by + rd], [cx - lo, jy], [cx - 4, jy]], true, 'back');
          this.ln.push(`<circle class="joint" cx="${cx}" cy="${jy}" r="3.5"/>`);
          this.line(dedupe([[cx + dw / 2, m], [cx + ro, m], [cx + ro, by + xd], [cx, by + xd], [cx, y + h]]));
          this.label(cx + dw / 2 + 6, m - 6, s.kind === 'for' ? L('chart.end') : L('chart.false'), 'start');
          this.edge(tB.node, s.id, cat2(tB.pts, [[cx, by + rd], [cx - lo, by + rd], [cx - lo, jy], [cx, jy], [cx, y]]), tB.tag);
          return { node: s.id, pts: [[cx + dw / 2, m], [cx + ro, m], [cx + ro, by + xd], [cx, by + xd]], tag: 'F' };
        },
      };
    }
    if (s.kind === 'do') {
      const mb = this.measure(s, cap, 'diamond', DH);
      const dw = mb.w; DH = mb.h;
      const B = this.seq(s.body, true);
      const lo = Math.max(dw / 2, B.L) + 20;
      const h = 6 + B.h + DH;
      return {
        L: lo + 4, R: Math.max(dw / 2, B.R) + 4, h,
        draw: (cx, y, head) => {
          const top = y + 6, dy = top + B.h, m = dy + DH / 2, J = s.id + ':top';
          this.line([[cx, y], [cx, top]]);
          this.ln.push(`<circle class="joint" cx="${cx}" cy="${top}" r="3.5"/>`);
          this.edge(head.node, J, cat2(head.pts, [[cx, top]]), head.tag);
          const tB = B.draw(cx, top, { node: J, pts: [[cx, top]] });
          this.edge(tB.node, s.id, tB.pts, tB.tag);
          this.shape(s.id, s.kind, cat, 'diamond', cx, dy, dw, DH, cap.text, title, '', null, mb);
          this.line([[cx - dw / 2, m], [cx - lo, m], [cx - lo, top], [cx - 4, top]], true, 'back');
          this.label(cx - dw / 2 - 6, m - 6, L('chart.true'), 'end');
          this.label(cx + 6, dy + DH + 13, L('chart.false'), 'start');
          this.edge(s.id, J, [[cx - dw / 2, m], [cx - lo, m], [cx - lo, top], [cx, top]], 'T');
          return { node: s.id, pts: [[cx, dy + DH]], tag: 'F' };
        },
      };
    }
    if (s.kind === 'try') return this.tryBlock(s, cat, title);
    if (s.kind === 'comment' && !cap.incomplete) return this.comment(s, title);
    const mb = this.measure(s, cap, shp, H);
    const w0 = mb.w, h = mb.h;
    return {
      L: w0 / 2 + 6, R: w0 / 2 + 6, h, w: w0,
      draw: (cx, y, head, wForce) => {
        const w = wForce || w0;
        this.edge(head.node, s.id, head.pts, head.tag);
        this.shape(s.id, s.kind, cat, shp, cx, y, w, h, cap.text, title, s.kind === 'comment' ? ' comment' : '', cap.incomplete ? null : cap.badge, mb);
        return { node: s.id, pts: [[cx, y + h]] };
      },
    };
  }

  /* Try: header, body in the middle; on the right the dashed line of the exception leads to the Catch branches,
     which join below the body; then, if present, the Finally */
  tryBlock(s, cat, title) {
    const TH = R_.H, GX = 30, DROP = 16;
    const tw = this.boxW('Try', 'rect');
    const B = this.seq(s.body, false);
    const cats = (s.catches || []).map((c) => { const t = L('chart.catch', { type: c.type, variable: c.variable }); return { c, t, w: this.boxW(t, 'rect'), S: this.seq(c.body, false) }; });
    const F = s.hasFinally ? this.seq(s.finally || [], false) : null, fw = this.boxW('Finally', 'rect');
    let x = Math.max(tw / 2, B.R) + GX;
    for (const k of cats) { k.dx = x + Math.max(k.w / 2, k.S.L); x = k.dx + Math.max(k.w / 2, k.S.R) + GX; }
    const ctop = TH + DROP; // headers of the Catches
    const jrel = TH + Math.max(B.h, ...cats.map((k) => DROP + TH + k.S.h)) + 10;
    // the Finally is closed in a frame: header and its blocks, so it is clear where it ends
    const FGAP = 22, FPX = 10, FPT = 7, FPB = 8;
    const fl = F ? Math.max(fw / 2, F.L) + FPX : 0, fr = F ? Math.max(fw / 2, F.R) + FPX : 0;
    const h = jrel + (F ? FGAP + TH + F.h + FPB : 0);
    const lw = Math.max(tw / 2, B.L, fl) + 4;
    const R = Math.max(cats.length ? x - GX : Math.max(tw / 2, B.R), fr) + 4;
    return {
      L: lw, R, h,
      draw: (cx, y, head) => {
        const m = y + TH / 2, j = y + jrel, J = s.id + ':join';
        this.edge(head.node, s.id, head.pts, head.tag);
        this.shape(s.id, 'try', cat, 'exchead', cx, y, tw, TH, 'Try', title);
        const tB = B.draw(cx, y + TH, { node: s.id, pts: [[cx, y + TH]] });
        this.line([[cx, y + TH + B.h], [cx, j]]);
        this.edge(tB.node, J, cat2(tB.pts, [[cx, j]]), tB.tag);
        if (cats.length) {
          const last = cats[cats.length - 1];
          this.line([[cx + tw / 2, m], [cx + last.dx, m]], false, 'exc');
          this.label(cx + tw / 2 + 6, m - 6, L('chart.exception'), 'start');
          for (const k of cats) {
            const kx = cx + k.dx, KID = s.id + ':catch:' + k.c.id;
            this.line([[kx, m], [kx, y + ctop]], true, 'exc');
            this.shape(KID, 'catch', cat, 'exchead', kx, y + ctop, k.w, TH, k.t, L('chart.catchIfAnExceptionOrOf', { type: k.c.type, variable: k.c.variable, variable2: k.c.variable }));
            this.edge(s.id, KID, [[cx + tw / 2, m], [kx, m], [kx, y + ctop]], 'X');
            // lane between the blocks of the Try and the Catches: there the path of an exception goes up to this arrow
            this.edges[this.edges.length - 1].lane = cx + Math.max(tw / 2, B.R) + GX / 2;
            const tC = k.S.draw(kx, y + ctop + TH, { node: KID, pts: [[kx, y + ctop + TH]] });
            this.line([[kx, y + ctop + TH + k.S.h], [kx, j], [cx, j]]);
            this.edge(tC.node, J, cat2(tC.pts, [[kx, j], [cx, j]]), tC.tag);
          }
          this.ln.push(`<circle class="joint" cx="${cx}" cy="${j}" r="3.5"/>`);
        }
        if (!F) return { node: J, pts: [[cx, j]] };
        const fy = j + FGAP, FID = s.id + ':finally', fe = fy + TH + F.h;
        this.bg.push(`<rect class="fframe" x="${cx - fl}" y="${fy - FPT}" width="${fl + fr}" height="${TH + F.h + FPT + FPB / 2}" rx="10"/>`);
        this.line([[cx, j], [cx, fy]], true);
        this.edge(J, FID, [[cx, j], [cx, fy]]);
        this.shape(FID, 'finally', cat, 'exchead', cx, fy, fw, TH, 'Finally', L('chart.finallyAlwaysRunsWhetherThereWas'));
        const tF = F.draw(cx, fy + TH, { node: FID, pts: [[cx, fy + TH]] });
        this.line([[cx, fe], [cx, fe + FPB]]);
        return { node: tF.node, pts: cat2(tF.pts, [[cx, fe], [cx, fe + FPB]]), tag: tF.tag };
      },
    };
  }

  /* Comment: one line; if the text is long «+» appears to expand it in the box */
  comment(s, title) {
    const TOG = 24, PAD = 14, LH = 17, MAXT = R_.MAXW;
    const lines = wrapLines(s.text, MAXT);
    // safety margin: measure and drawing can differ by a few tenths of a pixel
    const SAFE = 6;
    const multi = lines.length > 1;
    const firstW = textW(lines[0], CFONT);
    const truncated = multi || firstW > MAXT;
    let expandable = truncated;
    let open = expandable && this.expanded && this.expanded.has(s.id);
    let shown = open ? lines : [lines[0] + (multi ? ' …' : '')];
    const widthFor = (exp, sh) => Math.ceil(Math.max(R_.MINW, Math.min(MAXT + 12, Math.max(...sh.map((l) => textW(l, CFONT)))) + PAD * 2 + SAFE + (exp ? TOG : 0)));
    let w = widthFor(expandable, shown);
    // if the closed text would be cut anyway, the + button must always be there
    if (!expandable && fit(shown[0], w - PAD * 2 + SAFE, CFONT) !== shown[0]) {
      expandable = true; open = this.expanded && this.expanded.has(s.id);
      w = widthFor(true, shown);
    }
    const h = open ? Math.max(R_.H - 4, shown.length * LH + 14) : R_.H - 4;
    const wn = w;
    return {
      L: wn / 2 + 6, R: wn / 2 + 6, h, w: wn,
      draw: (cx, y, head, wForce) => {
        const w = wForce || wn;
        this.edge(head.node, s.id, head.pts, head.tag);
        const l = cx - w / 2, r = cx + w / 2;
        let g = `<g class="shape c-comment comment${open ? ' open' : ''}" data-id="${s.id}" data-kind="comment"><title>${esc(title)}</title>${shapePath('note', cx, y, w, h)}`;
        if (open) {
          shown.forEach((t, i) => { g += `<text class="cline-t" x="${l + PAD}" y="${y + 7 + LH / 2 + i * LH}" dy="0.35em">${esc(t)}</text>`; });
        } else {
          g += `<text x="${expandable ? cx - TOG / 2 : cx}" y="${y + h / 2}" dy="0.35em">${esc(fit(shown[0], w - PAD * 2 - (expandable ? TOG : 0) + SAFE, CFONT))}</text>`;
        }
        if (expandable) {
          const tx = r - 19, ty = y + (R_.H - 4) / 2 + 1;
          g += `<g class="ctoggle" data-toggle="${s.id}" role="button" aria-label="${open ? L('chart.collapseComment') : L('chart.expandComment')}"><title>${open ? L('chart.collapseTheComment') : L('chart.showTheWholeComment')}</title><circle cx="${tx}" cy="${ty}" r="8"/><path d="M${tx - 3.5} ${ty}H${tx + 3.5}${open ? '' : `M${tx} ${ty - 3.5}V${ty + 3.5}`}"/></g>`;
        }
        this.sh.push(g + '</g>');
        return { node: s.id, pts: [[cx, y + h]] };
      },
    };
  }

  /* opts.owner: name of the class (Objects view), opts.isMain: it is the starting point */
  /* opts.compact: compact view (consecutive simple blocks touch each other) */
  func(f, expanded, opts) {
    this.reset();
    this.expanded = expanded;
    const o = opts || {};
    this.compact = !!o.compact;
    const isMain = o.isMain != null ? o.isMain : f.name.toLowerCase() === 'main';
    const ps = f.params.map((p) => `${p.name}${p.array ? `[${','.repeat((p.dims || 1) - 1)}]` : ''}: ${ExprLib.typeName(p.type)}`).join(', ');
    const sig = isMain ? L('run.main') : f.ctor ? `new ${f.name}(${ps})` : `${o.owner ? o.owner + '.' : ''}${f.name}${(f.tparams || []).length ? `<${f.tparams.join(', ')}>` : ''}(${ps})`;
    const rsl = ModelLib.rets(f);
    const endText = rsl.length ? L('chart.return', { list: rsl.map((x) => x.name || '?').join(', ') }) : L('chart.end');
    const sw = this.boxW(sig, 'rect') + 10, ew = this.boxW(endText, 'rect') + 10;
    const B = this.seq(f.body, true);
    const lw = Math.max(sw / 2, ew / 2, B.L), R = Math.max(sw / 2, ew / 2, B.R);
    const M = 40;
    const W = Math.ceil(lw + R + M * 2), Hh = Math.ceil(R_.H * 2 + B.h + M * 2);
    const cx = Math.round(M + lw), y0 = M;
    this.shape('start:' + f.id, '', 'term', 'term', cx, y0, sw, R_.H, sig, isMain ? L('chart.startOfTheProgramDoubleClick') : f.ctor ? L('chart.constructorOfDoubleClickToEdit', { name: f.name }) : L('chart.startOfDoubleClickToEdit', { name: f.name, text: o.owner ? L('chart.theMethod') : L('chart.theFunction') }));
    const tail = B.draw(cx, y0 + R_.H, { node: 'start:' + f.id, pts: [[cx, y0 + R_.H]] });
    this.edge(tail.node, 'end:' + f.id, tail.pts, tail.tag);
    this.shape('end:' + f.id, '', 'term', 'term', cx, y0 + R_.H + B.h, ew, R_.H, endText, rsl.length ? L('chart.returns', { text: o.owner ? L('run.theMethod') : L('run.theFunction'), list: rsl.map((x) => `${x.name}: ${ExprLib.typeName(x.type)}`).join(', ') }) : (f.ctor ? L('chart.endOfTheConstructorTheObject') : L('chart.end2', { text: o.owner ? L('chart.ofTheMethod') : L('chart.ofTheFunction') })));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="chart" viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}" data-w="${W}" data-h="${Hh}">`
      + '<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="ahead"/></marker></defs>'
      + `<g class="frames">${this.bg.join('')}</g><g class="lines">${this.ln.join('')}</g><g class="hits">${this.hit.join('')}</g><g class="trail"></g><g class="shapes">${this.sh.join('')}</g><g class="hits hits-top">${this.hitTop.join('')}</g><g class="labels">${this.lbl.join('')}</g></svg>`;
    return { svg, W, H: Hh, ins: this.ins, edges: this.edges };
  }
}

const RenderLib = { Renderer, caption, KIND_IT, textW, fitText: fit, R_ };
