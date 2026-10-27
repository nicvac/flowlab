/* ==========================================================================
   FlowLab — impaginazione e disegno SVG del diagramma
   Ogni blocco calcola le proprie estensioni a sinistra/destra dell'asse
   centrale (L, R) e l'altezza; poi si disegna a partire da (cx, y).
   ========================================================================== */
'use strict';

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

function fit(t, max, font) {
  if (textW(t, font) <= max) return t;
  let lo = 0, hi = t.length;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (textW(t.slice(0, m) + '…', font) <= max) lo = m; else hi = m - 1; }
  return t.slice(0, lo) + '…';
}

/* Spezza il testo in righe che stanno in maxW pixel (rispetta gli a capo) */
function wrapLines(text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/(\s+)/);
    let cur = '';
    for (const w of words) {
      if (textW(cur + w, CFONT) <= maxW) { cur += w; continue; }
      if (cur.trim()) out.push(cur.trimEnd());
      cur = w.trimStart();
      while (textW(cur, CFONT) > maxW) { // parola più lunga della riga
        let n = cur.length;
        while (n > 1 && textW(cur.slice(0, n), CFONT) > maxW) n--;
        out.push(cur.slice(0, n)); cur = cur.slice(n);
      }
    }
    out.push(cur.trimEnd());
  }
  while (out.length > 1 && out[out.length - 1] === '') out.pop();
  return out;
}

function dedupe(pts) {
  const out = [];
  for (const p of pts) { const q = out[out.length - 1]; if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push([p[0], p[1]]); }
  return out;
}
const cat2 = (a, b) => a.concat(b);

const KIND_IT = {
  declare: 'Dichiara', const: 'Costante', assign: 'Assegna', input: 'Input', output: 'Output', if: 'Se', while: 'Mentre', for: 'Per', do: 'Fai-mentre',
  call: 'Chiama', comment: 'Commento', breakpoint: 'Interruzione',
  open: 'Apri file', close: 'Chiudi file', read: 'Leggi da file', write: 'Scrivi su file',
};

function caption(s) {
  const T = ExprLib.TYPE_IT;
  if (ModelLib.isIncomplete(s)) return { text: KIND_IT[s.kind], incomplete: true };
  switch (s.kind) {
    case 'declare': {
      const names = s.name.split(',').map((x) => x.trim()).filter(Boolean);
      return { text: `${s.array ? names.map((n) => `${n}[${s.size}]`).join(', ') : names.join(', ')}: ${T[s.type]}` };
    }
    case 'assign': return { text: `${s.variable} ← ${s.expression}` };
    case 'const': return { text: `${s.name}: ${T[s.type]} = ${s.expression}`, badge: 'C' };
    case 'input': return { text: s.variable, badge: 'I' };
    case 'output': return { text: `${s.expression}${s.newline ? '' : '  ⋯'}`, badge: 'O' };
    case 'if': case 'while': case 'do': return { text: s.expression };
    case 'for': {
      const st = String(s.step).trim();
      return { text: `${s.variable} da ${s.start} a ${s.end}${s.direction === 'dec' ? ' indietro' : ''}${st && st !== '1' ? ' passo ' + st : ''}` };
    }
    case 'call': return { text: /\(/.test(s.expression) ? s.expression : s.expression + '()' };
    case 'comment': return { text: s.text.split('\n')[0] + (s.text.includes('\n') ? ' …' : '') };
    case 'breakpoint': return { text: s.always ? 'Pausa' : `Pausa se ${s.expression}` };
    case 'open': return { text: `Apri ${s.expression} (${s.mode === 'read' ? 'lettura' : 'scrittura'})` };
    case 'close': return { text: `Chiudi file (${s.mode === 'read' ? 'lettura' : 'scrittura'})` };
    case 'read': return { text: `Leggi ${s.variable} dal file` };
    case 'write': return { text: `Scrivi ${s.expression} nel file` };
  }
  return { text: s.kind };
}

/* Forme geometriche (cx = asse, y = alto, w/h dimensioni) */
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
  }
  return '';
}
const SHAPE_OF = {
  declare: 'decl', const: 'decl', assign: 'rect', input: 'para', output: 'para', if: 'diamond', while: 'diamond', do: 'diamond', for: 'hex',
  call: 'call', comment: 'note', breakpoint: 'oct',
  open: 'doc', close: 'doc', read: 'doc', write: 'doc',
};
const CAT_OF = {
  declare: 'decl', const: 'decl', assign: 'assign', input: 'in', output: 'out', if: 'cond', while: 'loop', do: 'loop', for: 'loop', call: 'call',
  comment: 'comment', breakpoint: 'brk',
  open: 'file', close: 'file', read: 'file', write: 'file',
};

class Renderer {
  constructor() { this.reset(); }
  reset() { this.ins = []; this.sh = []; this.ln = []; this.hit = []; this.lbl = []; this.edges = []; }

  /* ---- grafo dei percorsi (per il cursore che segue le frecce) ----
     Ogni disegno riceve "head" = {node, pts, tag}: il percorso pendente che arriva
     al suo ingresso, e restituisce "tail": il percorso che parte dalla sua uscita. */
  edge(from, to, pts, tag) { this.edges.push({ from, to, pts: dedupe(pts), tag: tag || null }); }

  /* ---- primitive ---- */
  line(pts, head, cls) {
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join('');
    this.ln.push(`<path class="flow${cls ? ' ' + cls : ''}" d="${d}"${head ? ' marker-end="url(#ah)"' : ''}/>`);
  }
  insPoint(arr, idx, x, y1, y2, head) {
    const k = this.ins.length;
    this.ins.push({ arr, idx });
    this.line([[x, y1], [x, y2]], head);
    const hh = y2 - y1;
    this.hit.push(`<g class="ins" data-ins="${k}"><rect x="${x - 22}" y="${y1}" width="44" height="${hh}"/><circle cx="${x}" cy="${y1 + hh / 2}" r="9"/><path d="M${x - 4} ${y1 + hh / 2}H${x + 4}M${x} ${y1 + hh / 2 - 4}V${y1 + hh / 2 + 4}"/></g>`);
  }
  label(x, y, t, anchor) { this.lbl.push(`<text class="blabel" x="${x}" y="${y}" text-anchor="${anchor || 'middle'}">${t}</text>`); }

  shape(id, kind, cat, shp, cx, y, w, h, text, title, extra, badge) {
    const tw = w - (shp === 'diamond' ? 36 : shp === 'hex' ? 30 : shp === 'para' ? 24 : 18) - (badge ? 18 : 0);
    const t = fit(text, tw);
    let s = `<g class="shape c-${cat}${extra || ''}" data-id="${id}"${kind ? ` data-kind="${kind}"` : ''}><title>${esc(title || text)}</title>${shapePath(shp, cx, y, w, h)}`;
    s += `<text x="${cx}" y="${y + h / 2}" dy="0.35em">${esc(t)}</text>`;
    if (badge) s += `<text class="badge" x="${cx + w / 2 - 13}" y="${y + 11}" dy="0.35em">${badge}</text>`;
    s += '</g>';
    this.sh.push(s);
  }

  /* ---- impaginazione ---- */
  boxW(text, shp) {
    const pad = shp === 'diamond' ? 56 : shp === 'hex' ? 44 : shp === 'para' ? 40 : R_.PADX * 2;
    return Math.round(Math.min(R_.MAXW + pad, Math.max(R_.MINW, textW(text) + pad)));
  }

  seq(arr, tailHead) {
    const parts = arr.map((s) => this.stmt(s));
    let L = 22, R = 22, h = R_.GAP * (arr.length + 1);
    for (const p of parts) { L = Math.max(L, p.L); R = Math.max(R, p.R); h += p.h; }
    return {
      L, R, h,
      draw: (cx, y, head) => {
        let cur = y;
        let pend = head;
        parts.forEach((p, i) => {
          this.insPoint(arr, i, cx, cur, cur + R_.GAP, true);
          const arrow = [[cx, cur], [cx, cur + R_.GAP]];
          cur += R_.GAP;
          pend = p.draw(cx, cur, { node: pend.node, pts: cat2(pend.pts, arrow), tag: pend.tag });
          cur += p.h;
        });
        this.insPoint(arr, arr.length, cx, cur, cur + R_.GAP, tailHead);
        return { node: pend.node, pts: cat2(pend.pts, [[cx, cur], [cx, cur + R_.GAP]]), tag: pend.tag };
      },
    };
  }

  stmt(s) {
    const cap = caption(s);
    const shp = SHAPE_OF[s.kind];
    const cat = cap.incomplete ? 'inc' : CAT_OF[s.kind];
    const title = cap.incomplete ? `${KIND_IT[s.kind]} — incompleto: doppio clic per completarlo` : `${KIND_IT[s.kind]}: ${cap.text}`;
    const H = R_.H, DH = R_.DH;
    if (s.kind === 'if') {
      const dw = this.boxW(cap.text, 'diamond');
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
          this.shape(s.id, s.kind, cat, 'diamond', cx, y, dw, DH, cap.text, title);
          this.line([[cx + dw / 2, m], [cx + offR, m]]);
          this.line([[cx - dw / 2, m], [cx - offL, m]]);
          this.label(cx + dw / 2 + 6, m - 6, 'Vero', 'start');
          this.label(cx - dw / 2 - 6, m - 6, 'Falso', 'end');
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
      const dw = this.boxW(cap.text, s.kind === 'for' ? 'hex' : 'diamond');
      const dh = s.kind === 'for' ? H + 4 : DH;
      const B = this.seq(s.body, false);
      const lo = Math.max(dw / 2, B.L) + 20, ro = Math.max(dw / 2, B.R) + 20;
      const h = dh + B.h + 28;
      return {
        L: lo + 4, R: ro + 4, h,
        draw: (cx, y, head) => {
          const m = y + dh / 2, by = y + dh + B.h;
          this.edge(head.node, s.id, head.pts, head.tag);
          this.shape(s.id, s.kind, cat, s.kind === 'for' ? 'hex' : 'diamond', cx, y, dw, dh, cap.text, title);
          const tB = B.draw(cx, y + dh, { node: s.id, pts: [[cx, y + dh]], tag: 'T' });
          this.label(cx + 6, y + dh + 13, s.kind === 'for' ? 'Ripeti' : 'Vero', 'start');
          // il ritorno si innesta a metà della freccia che entra nella condizione
          const jy = y - R_.GAP / 2;
          this.line([[cx, by], [cx, by + 10], [cx - lo, by + 10], [cx - lo, jy], [cx - 4, jy]], true, 'back');
          this.ln.push(`<circle class="joint" cx="${cx}" cy="${jy}" r="3.5"/>`);
          this.line([[cx + dw / 2, m], [cx + ro, m], [cx + ro, by + 22], [cx, by + 22], [cx, y + h]]);
          this.label(cx + dw / 2 + 6, m - 6, s.kind === 'for' ? 'Fine' : 'Falso', 'start');
          this.edge(tB.node, s.id, cat2(tB.pts, [[cx, by + 10], [cx - lo, by + 10], [cx - lo, jy], [cx, jy], [cx, y]]), tB.tag);
          return { node: s.id, pts: [[cx + dw / 2, m], [cx + ro, m], [cx + ro, by + 22], [cx, by + 22]], tag: 'F' };
        },
      };
    }
    if (s.kind === 'do') {
      const dw = this.boxW(cap.text, 'diamond');
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
          this.shape(s.id, s.kind, cat, 'diamond', cx, dy, dw, DH, cap.text, title);
          this.line([[cx - dw / 2, m], [cx - lo, m], [cx - lo, top], [cx - 4, top]], true, 'back');
          this.label(cx - dw / 2 - 6, m - 6, 'Vero', 'end');
          this.label(cx + 6, dy + DH + 13, 'Falso', 'start');
          this.edge(s.id, J, [[cx - dw / 2, m], [cx - lo, m], [cx - lo, top], [cx, top]], 'T');
          return { node: s.id, pts: [[cx, dy + DH]], tag: 'F' };
        },
      };
    }
    if (s.kind === 'comment' && !cap.incomplete) return this.comment(s, title);
    const w = this.boxW(cap.text, shp) + (cap.badge ? 18 : 0);
    const h = H;
    return {
      L: w / 2 + 6, R: w / 2 + 6, h,
      draw: (cx, y, head) => {
        this.edge(head.node, s.id, head.pts, head.tag);
        this.shape(s.id, s.kind, cat, shp, cx, y, w, h, cap.text, title, s.kind === 'comment' ? ' comment' : '', cap.incomplete ? null : cap.badge);
        return { node: s.id, pts: [[cx, y + h]] };
      },
    };
  }

  /* Commento: una riga; se il testo è lungo compare «+» per espanderlo nel riquadro */
  comment(s, title) {
    const TOG = 24, PAD = 14, LH = 17, MAXT = R_.MAXW;
    const lines = wrapLines(s.text, MAXT);
    // margine di sicurezza: misura e disegno possono differire di qualche decimo di pixel
    const SAFE = 6;
    const multi = lines.length > 1;
    const firstW = textW(lines[0], CFONT);
    const truncated = multi || firstW > MAXT;
    let expandable = truncated;
    let open = expandable && this.expanded && this.expanded.has(s.id);
    let shown = open ? lines : [lines[0] + (multi ? ' …' : '')];
    const widthFor = (exp, sh) => Math.ceil(Math.max(R_.MINW, Math.min(MAXT + 12, Math.max(...sh.map((l) => textW(l, CFONT)))) + PAD * 2 + SAFE + (exp ? TOG : 0)));
    let w = widthFor(expandable, shown);
    // se il testo chiuso verrebbe comunque tagliato, il pulsante + deve esserci sempre
    if (!expandable && fit(shown[0], w - PAD * 2 + SAFE, CFONT) !== shown[0]) {
      expandable = true; open = this.expanded && this.expanded.has(s.id);
      w = widthFor(true, shown);
    }
    const h = open ? Math.max(R_.H - 4, shown.length * LH + 14) : R_.H - 4;
    return {
      L: w / 2 + 6, R: w / 2 + 6, h,
      draw: (cx, y, head) => {
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
          g += `<g class="ctoggle" data-toggle="${s.id}" role="button" aria-label="${open ? 'Riduci commento' : 'Espandi commento'}"><title>${open ? 'Riduci il commento' : 'Mostra tutto il commento'}</title><circle cx="${tx}" cy="${ty}" r="8"/><path d="M${tx - 3.5} ${ty}H${tx + 3.5}${open ? '' : `M${tx} ${ty - 3.5}V${ty + 3.5}`}"/></g>`;
        }
        this.sh.push(g + '</g>');
        return { node: s.id, pts: [[cx, y + h]] };
      },
    };
  }

  func(f, expanded) {
    this.reset();
    this.expanded = expanded;
    const isMain = f.name.toLowerCase() === 'main';
    const sig = isMain ? 'Inizio' : `${f.name}(${f.params.map((p) => `${p.name}${p.array ? '[]' : ''}: ${ExprLib.TYPE_IT[p.type]}`).join(', ')})`;
    const rsl = ModelLib.rets(f);
    const endText = rsl.length ? `Restituisci ${rsl.map((x) => x.name || '?').join(', ')}` : 'Fine';
    const sw = this.boxW(sig, 'rect') + 10, ew = this.boxW(endText, 'rect') + 10;
    const B = this.seq(f.body, true);
    const L = Math.max(sw / 2, ew / 2, B.L), R = Math.max(sw / 2, ew / 2, B.R);
    const M = 40;
    const W = Math.ceil(L + R + M * 2), Hh = Math.ceil(R_.H * 2 + B.h + M * 2);
    const cx = Math.round(M + L), y0 = M;
    this.shape('start:' + f.id, '', 'term', 'term', cx, y0, sw, R_.H, sig, isMain ? 'Inizio del programma: doppio clic per le proprietà' : `Inizio di ${f.name}: doppio clic per modificare la funzione`);
    const tail = B.draw(cx, y0 + R_.H, { node: 'start:' + f.id, pts: [[cx, y0 + R_.H]] });
    this.edge(tail.node, 'end:' + f.id, tail.pts, tail.tag);
    this.shape('end:' + f.id, '', 'term', 'term', cx, y0 + R_.H + B.h, ew, R_.H, endText, rsl.length ? `La funzione restituisce ${rsl.map((x) => `${x.name}: ${ExprLib.TYPE_IT[x.type]}`).join(', ')}` : 'Fine della funzione');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="chart" viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}" data-w="${W}" data-h="${Hh}">`
      + '<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="ahead"/></marker></defs>'
      + `<g class="lines">${this.ln.join('')}</g><g class="hits">${this.hit.join('')}</g><g class="trail"></g><g class="shapes">${this.sh.join('')}</g><g class="labels">${this.lbl.join('')}</g></svg>`;
    return { svg, W, H: Hh, ins: this.ins, edges: this.edges };
  }
}

const RenderLib = { Renderer, caption, KIND_IT, textW, R_ };
