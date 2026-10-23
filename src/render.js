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
function textW(t) {
  if (!_measureCtx) return t.length * 7.4;
  _measureCtx.font = R_.font;
  return _measureCtx.measureText(t).width;
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function fit(t, max) {
  if (textW(t) <= max) return t;
  let lo = 0, hi = t.length;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (textW(t.slice(0, m) + '…') <= max) lo = m; else hi = m - 1; }
  return t.slice(0, lo) + '…';
}

const KIND_IT = {
  declare: 'Dichiara', assign: 'Assegna', input: 'Input', output: 'Output', if: 'Se', while: 'Mentre', for: 'Per', do: 'Fai-mentre',
  call: 'Chiama', comment: 'Commento', breakpoint: 'Interruzione',
  open: 'Apri file', close: 'Chiudi file', read: 'Leggi da file', write: 'Scrivi su file',
};

function caption(s) {
  const T = ExprLib.TYPE_IT;
  if (ModelLib.isIncomplete(s)) return { text: KIND_IT[s.kind], incomplete: true };
  switch (s.kind) {
    case 'declare': {
      const names = s.name.split(',').map((x) => x.trim()).filter(Boolean);
      return { text: `${T[s.type]} ${s.array ? names.map((n) => `${n}[${s.size}]`).join(', ') : names.join(', ')}` };
    }
    case 'assign': return { text: `${s.variable} ← ${s.expression}` };
    case 'input': return { text: `Leggi ${s.variable}` };
    case 'output': return { text: `Scrivi ${s.expression}${s.newline ? '' : '  ⋯'}` };
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
  declare: 'decl', assign: 'rect', input: 'para', output: 'para', if: 'diamond', while: 'diamond', do: 'diamond', for: 'hex',
  call: 'call', comment: 'note', breakpoint: 'oct',
  open: 'doc', close: 'doc', read: 'doc', write: 'doc',
};
const CAT_OF = {
  declare: 'decl', assign: 'assign', input: 'in', output: 'out', if: 'cond', while: 'loop', do: 'loop', for: 'loop', call: 'call',
  comment: 'comment', breakpoint: 'brk',
  open: 'file', close: 'file', read: 'file', write: 'file',
};

class Renderer {
  constructor() { this.reset(); }
  reset() { this.ins = []; this.sh = []; this.ln = []; this.hit = []; this.lbl = []; }

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

  shape(id, kind, cat, shp, cx, y, w, h, text, title, extra) {
    const tw = w - (shp === 'diamond' ? 36 : shp === 'hex' ? 30 : shp === 'para' ? 24 : 18);
    const t = fit(text, tw);
    let s = `<g class="shape c-${cat}${extra || ''}" data-id="${id}"${kind ? ` data-kind="${kind}"` : ''}><title>${esc(title || text)}</title>${shapePath(shp, cx, y, w, h)}`;
    s += `<text x="${cx}" y="${y + h / 2}" dy="0.35em">${esc(t)}</text></g>`;
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
      draw: (cx, y) => {
        let cur = y;
        parts.forEach((p, i) => {
          this.insPoint(arr, i, cx, cur, cur + R_.GAP, true);
          cur += R_.GAP;
          p.draw(cx, cur);
          cur += p.h;
        });
        this.insPoint(arr, arr.length, cx, cur, cur + R_.GAP, tailHead);
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
        draw: (cx, y) => {
          const m = y + DH / 2, j = y + h;
          this.shape(s.id, s.kind, cat, 'diamond', cx, y, dw, DH, cap.text, title);
          this.line([[cx + dw / 2, m], [cx + offR, m]]);
          this.line([[cx - dw / 2, m], [cx - offL, m]]);
          this.label(cx + dw / 2 + 6, m - 6, 'Vero', 'start');
          this.label(cx - dw / 2 - 6, m - 6, 'Falso', 'end');
          T.draw(cx + offR, m);
          E.draw(cx - offL, m);
          this.line([[cx + offR, m + T.h], [cx + offR, j], [cx, j]]);
          this.line([[cx - offL, m + E.h], [cx - offL, j], [cx, j]]);
          this.ln.push(`<circle class="joint" cx="${cx}" cy="${j}" r="3.5"/>`);
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
        draw: (cx, y) => {
          const m = y + dh / 2, by = y + dh + B.h;
          this.shape(s.id, s.kind, cat, s.kind === 'for' ? 'hex' : 'diamond', cx, y, dw, dh, cap.text, title);
          B.draw(cx, y + dh);
          this.label(cx + 6, y + dh + 13, s.kind === 'for' ? 'Ripeti' : 'Vero', 'start');
          this.line([[cx, by], [cx, by + 10], [cx - lo, by + 10], [cx - lo, m], [cx - dw / 2, m]], true, 'back');
          this.line([[cx + dw / 2, m], [cx + ro, m], [cx + ro, by + 22], [cx, by + 22], [cx, y + h]]);
          this.label(cx + dw / 2 + 6, m - 6, s.kind === 'for' ? 'Fine' : 'Falso', 'start');
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
        draw: (cx, y) => {
          const top = y + 6, dy = top + B.h, m = dy + DH / 2;
          this.line([[cx, y], [cx, top]]);
          this.ln.push(`<circle class="joint" cx="${cx}" cy="${top}" r="3.5"/>`);
          B.draw(cx, top);
          this.shape(s.id, s.kind, cat, 'diamond', cx, dy, dw, DH, cap.text, title);
          this.line([[cx - dw / 2, m], [cx - lo, m], [cx - lo, top], [cx - 4, top]], true, 'back');
          this.label(cx - dw / 2 - 6, m - 6, 'Vero', 'end');
          this.label(cx + 6, dy + DH + 13, 'Falso', 'start');
        },
      };
    }
    const w = this.boxW(cap.text, shp);
    const h = s.kind === 'comment' ? H - 4 : H;
    return {
      L: w / 2 + 6, R: w / 2 + 6, h,
      draw: (cx, y) => {
        this.shape(s.id, s.kind, cat, shp, cx, y, w, h, cap.text, title, s.kind === 'comment' ? ' comment' : '');
      },
    };
  }

  func(f) {
    this.reset();
    const sig = f.name === 'Main' || f === undefined ? 'Main' : `${f.name}(${f.params.map((p) => `${ExprLib.TYPE_IT[p.type]}${p.array ? '[]' : ''} ${p.name}`).join(', ')})`;
    const endText = f.type === 'None' ? 'Fine' : `Restituisci ${f.variable || '?'}`;
    const sw = this.boxW(sig, 'rect') + 10, ew = this.boxW(endText, 'rect') + 10;
    const B = this.seq(f.body, true);
    const L = Math.max(sw / 2, ew / 2, B.L), R = Math.max(sw / 2, ew / 2, B.R);
    const M = 40;
    const W = Math.ceil(L + R + M * 2), Hh = Math.ceil(R_.H * 2 + B.h + M * 2);
    const cx = Math.round(M + L), y0 = M;
    this.shape('start:' + f.id, '', 'term', 'term', cx, y0, sw, R_.H, sig, `Inizio di ${f.name}: doppio clic per modificare la funzione`);
    B.draw(cx, y0 + R_.H);
    this.shape('end:' + f.id, '', 'term', 'term', cx, y0 + R_.H + B.h, ew, R_.H, endText, f.type === 'None' ? 'Fine della funzione' : `La funzione restituisce il valore di ${f.variable}`);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="chart" viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}" data-w="${W}" data-h="${Hh}">`
      + '<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="ahead"/></marker></defs>'
      + `<g class="lines">${this.ln.join('')}</g><g class="hits">${this.hit.join('')}</g><g class="shapes">${this.sh.join('')}</g><g class="labels">${this.lbl.join('')}</g></svg>`;
    return { svg, W, H: Hh, ins: this.ins };
  }
}

const RenderLib = { Renderer, caption, KIND_IT, textW, R_ };
