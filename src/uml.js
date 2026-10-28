/* ==========================================================================
   FlowLab — diagramma delle classi (UML)
   Ogni classe è un riquadro con tre sezioni: nome, attributi, metodi.
   Ereditarietà: freccia con triangolo vuoto verso la classe madre.
   Associazione: freccia aperta verso la classe usata come tipo di un
   attributo, con il nome dell'attributo e la molteplicità (0..1 oppure *).
   ========================================================================== */
'use strict';

const UmlLib = (() => {
  const FN = '700 14px "Atkinson Hyperlegible", system-ui, sans-serif';
  const FM = '400 12.5px "JetBrains Mono", ui-monospace, Consolas, monospace';
  const FS = 'italic 400 11.5px "Atkinson Hyperlegible", system-ui, sans-serif';
  const PADX = 14, ROW = 21, HEAD = 36, STEREO = 14, CPAD = 7, MINW = 170, MAXW = 520;
  const tw = (t, f) => RenderLib.textW(t, f);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const T = (t) => ExprLib.typeName(t);
  const V = (v) => ModelLib.VISIBILITY[v || 'public'];

  function attrText(a) {
    return `${V(a.visibility)} ${a.name}: ${T(a.type)}${a.array ? `[${a.size}]` : ''}${!a.array && String(a.init || '').trim() ? ' = ' + a.init : ''}`;
  }
  function methodText(prog, f) {
    const ps = f.params.map((p) => `${p.name}: ${T(p.type)}${p.array ? `[${','.repeat((p.dims || 1) - 1)}]` : ''}`).join(', ');
    const rl = ModelLib.rets(f);
    return `${V(f.visibility)} ${f.name}(${ps})${rl.length ? ': ' + rl.map((r) => T(r.type)).join(', ') : ''}`;
  }

  /* misure di ogni riquadro */
  function layout(prog) {
    const main = ModelLib.mainClass(prog);
    const boxes = new Map();
    for (const c of prog.classes) {
      const members = ModelLib.membersOf(prog, c);
      const methods = [...members.filter((f) => f.ctor), ...members.filter((f) => !f.ctor)];
      const attrs = c.attributes.map((a, i) => ({ text: attrText(a), i, st: !!a.static }));
      const meths = methods.map((f) => ({ text: methodText(prog, f), f, st: !!f.static, ctor: !!f.ctor, main: f === prog.functions[0] }));
      let w = Math.max(MINW, tw(c.name, FN) + PADX * 2 + 24, ...attrs.map((r) => tw(r.text, FM) + PADX * 2), ...meths.map((r) => tw(r.text, FM) + PADX * 2));
      w = Math.ceil(Math.min(MAXW, w));
      const head = HEAD + (c === main ? STEREO : 0);
      const ah = Math.max(1, attrs.length) * ROW + CPAD * 2 - (attrs.length ? 0 : ROW - 10);
      const mh = Math.max(1, meths.length) * ROW + CPAD * 2 - (meths.length ? 0 : ROW - 10);
      boxes.set(c.id, { c, x: c.x || 0, y: c.y || 0, w, h: head + ah + mh, head, ah, mh, attrs, meths, main: c === main });
    }
    return boxes;
  }

  /* punto in cui la retta dal centro verso (tx, ty) esce dal riquadro */
  function clip(b, tx, ty, ox, oy) {
    const cx = b.x + b.w / 2 + (ox || 0), cy = b.y + b.h / 2 + (oy || 0);
    const dx = tx - cx, dy = ty - cy;
    if (!dx && !dy) return [cx, cy];
    const t = Math.min(dx ? (b.w / 2) / Math.abs(dx) : Infinity, dy ? (b.h / 2) / Math.abs(dy) : Infinity);
    return [cx + dx * t, cy + dy * t];
  }

  function render(prog, sel) {
    const boxes = layout(prog);
    let W = 640, H = 420;
    for (const b of boxes.values()) { W = Math.max(W, b.x + b.w + 120); H = Math.max(H, b.y + b.h + 120); }
    const lines = [], labels = [], shapes = [];
    // relazioni: una sola linea per coppia ordinata e tipo; le coppie con più relazioni si scostano
    const rels = [];
    for (const c of prog.classes) {
      const par = ModelLib.classByName(prog, c.parent);
      if (par && par !== c) rels.push({ kind: 'inh', from: c, to: par });
      for (const a of c.attributes) {
        const t = ModelLib.classByName(prog, a.type);
        if (t) rels.push({ kind: 'assoc', from: c, to: t, name: a.name, mult: a.array ? '*' : '0..1', st: a.static });
      }
    }
    const pairCount = new Map();
    for (const r of rels) { const k = [r.from.id, r.to.id].sort().join('|'); pairCount.set(k, (pairCount.get(k) || 0) + 1); }
    const pairIdx = new Map();
    const selfIdx = new Map();
    for (const r of rels) {
      const A = boxes.get(r.from.id), B = boxes.get(r.to.id);
      if (r.from === r.to) {
        // associazione verso la propria classe: anello sul lato destro
        const k = selfIdx.get(A.c.id) || 0; selfIdx.set(A.c.id, k + 1);
        const x = A.x + A.w, y1 = A.y + 14 + k * 12, y2 = A.y + A.head + 6 + k * 12, d = 34 + k * 16;
        lines.push(`<path class="urel assoc" d="M${x} ${y1}H${x + d}V${y2}H${x + 1}" marker-end="url(#uml-open)"/>`);
        labels.push(`<text class="ulab" x="${x + d + 5}" y="${(y1 + y2) / 2 + 4}">${esc(r.name)} ${r.mult}</text>`);
        continue;
      }
      const key = [r.from.id, r.to.id].sort().join('|');
      const n = pairCount.get(key), i = pairIdx.get(key) || 0; pairIdx.set(key, i + 1);
      // scostamento perpendicolare per le relazioni parallele
      const ax = A.x + A.w / 2, ay = A.y + A.h / 2, bx = B.x + B.w / 2, by = B.y + B.h / 2;
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const sign = r.from.id < r.to.id ? 1 : -1;
      const off = (i - (n - 1) / 2) * 16 * sign;
      const ox = (-(by - ay) / len) * off, oy = ((bx - ax) / len) * off;
      const p1 = clip(A, bx + ox, by + oy, ox, oy), p2 = clip(B, ax + ox, ay + oy, ox, oy);
      if (r.kind === 'inh') {
        lines.push(`<path class="urel inh" d="M${p1[0]} ${p1[1]}L${p2[0]} ${p2[1]}" marker-end="url(#uml-inh)"/>`);
      } else {
        lines.push(`<path class="urel assoc" d="M${p1[0]} ${p1[1]}L${p2[0]} ${p2[1]}" marker-end="url(#uml-open)"/>`);
        // etichetta vicino alla classe di arrivo
        const lx = p2[0] + (p1[0] - p2[0]) * 0.22, ly = p2[1] + (p1[1] - p2[1]) * 0.22;
        const nx = -(p2[1] - p1[1]) / len, ny = (p2[0] - p1[0]) / len;
        const anchor = nx >= 0 ? 'start' : 'end';
        labels.push(`<text class="ulab" x="${lx + nx * 14}" y="${ly + ny * 14 + 4}" text-anchor="${anchor}">${r.st ? '<tspan text-decoration="underline">' : ''}${esc(r.name)}${r.st ? '</tspan>' : ''} ${r.mult}</text>`);
      }
    }
    // riquadri
    for (const b of boxes.values()) {
      const { c, x, y, w } = b;
      const isSel = sel && sel.cls === c.id;
      let g = `<g class="ubox${isSel && sel.kind === 'class' ? ' sel' : ''}${isSel ? ' cur' : ''}${b.main ? ' main' : ''}" data-cls="${c.id}">`;
      g += `<title>${esc(c.name)}${c.parent ? ' — eredita da ' + esc(c.parent) : ''}: doppio clic sul nome per modificarla, clic destro per aggiungere membri</title>`;
      g += `<rect class="ubg" x="${x}" y="${y}" width="${w}" height="${b.h}" rx="6"/>`;
      g += `<path class="uheadbg" d="M${x} ${y + b.head}V${y + 6}Q${x} ${y} ${x + 6} ${y}H${x + w - 6}Q${x + w} ${y} ${x + w} ${y + 6}V${y + b.head}Z"/>`;
      g += `<rect class="uhit head" data-part="head" x="${x}" y="${y}" width="${w}" height="${b.head}"/>`;
      if (b.main) g += `<text class="ustereo" x="${x + w / 2}" y="${y + 15}">«principale»</text>`;
      g += `<text class="uname" x="${x + w / 2}" y="${y + b.head - 13}">${esc(c.name)}</text>`;
      // attributi
      let yy = y + b.head;
      g += `<path class="usep" d="M${x} ${yy}H${x + w}"/>`;
      b.attrs.forEach((r, k) => {
        const ry = yy + CPAD + k * ROW;
        const on = isSel && sel.kind === 'attr' && sel.i === r.i;
        g += `<g class="urow${on ? ' sel' : ''}" data-kind="attr" data-i="${r.i}"><rect class="uhit" x="${x + 2}" y="${ry}" width="${w - 4}" height="${ROW}" rx="3"/><text class="umem" x="${x + PADX}" y="${ry + ROW / 2 + 4.5}"${r.st ? ' text-decoration="underline"' : ''}>${esc(RenderLib.fitText(r.text, w - PADX * 2, FM))}</text><title>${esc(r.text)}${r.st ? ' (statico)' : ''} — doppio clic per modificarlo</title></g>`;
      });
      g += addBtn(x + w - 13, yy, 'attr', 'Aggiungi un attributo');
      // metodi
      yy += b.ah;
      g += `<path class="usep" d="M${x} ${yy}H${x + w}"/>`;
      b.meths.forEach((r, k) => {
        const ry = yy + CPAD + k * ROW;
        const on = isSel && sel.kind === 'method' && sel.fid === r.f.id;
        const tip = r.ctor ? 'costruttore' : r.main ? 'punto di partenza del programma' : r.st ? 'metodo statico' : 'metodo';
        g += `<g class="urow method${on ? ' sel' : ''}${r.ctor ? ' ctor' : ''}${r.main ? ' mainm' : ''}" data-kind="method" data-fid="${r.f.id}"><rect class="uhit" x="${x + 2}" y="${ry}" width="${w - 4}" height="${ROW}" rx="3"/><text class="umem" x="${x + PADX}" y="${ry + ROW / 2 + 4.5}"${r.st ? ' text-decoration="underline"' : ''}>${esc(RenderLib.fitText(r.text, w - PADX * 2, FM))}</text><title>${esc(r.text)} (${tip}) — doppio clic per aprire il diagramma di flusso</title></g>`;
      });
      g += addBtn(x + w - 13, yy, 'method', 'Aggiungi un metodo o un costruttore');
      g += '</g>';
      shapes.push(g);
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="uml" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" data-w="${W}" data-h="${H}">`
      + '<defs><marker id="uml-inh" viewBox="0 0 14 14" refX="13" refY="7" markerWidth="13" markerHeight="13" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M1 1L13 7L1 13Z" class="minh"/></marker>'
      + '<marker id="uml-open" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="11" markerHeight="11" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M1 1L11 6L1 11" class="mopen"/></marker></defs>'
      + `<g class="urels">${lines.join('')}</g><g class="uboxes">${shapes.join('')}</g><g class="ulabels">${labels.join('')}</g></svg>`;
    return { svg, W, H, boxes };
  }
  function addBtn(cx, y, what, title) {
    return `<g class="uadd" data-add="${what}" role="button" aria-label="${title}"><title>${title}</title><circle cx="${cx}" cy="${y}" r="8"/><path d="M${cx - 3.5} ${y}H${cx + 3.5}M${cx} ${y - 3.5}V${y + 3.5}"/></g>`;
  }
  /* posizione libera per una nuova classe */
  function freeSpot(prog, near) {
    const boxes = layout(prog);
    const hit = (x, y) => [...boxes.values()].some((b) => x < b.x + b.w + 40 && x + 220 > b.x - 40 && y < b.y + b.h + 40 && y + 140 > b.y - 40);
    if (near && !hit(near.x, near.y)) return { x: Math.max(20, Math.round(near.x)), y: Math.max(20, Math.round(near.y)) };
    for (let row = 0; row < 40; row++) for (let col = 0; col < 6; col++) { const x = 40 + col * 280, y = 40 + row * 200; if (!hit(x, y)) return { x, y }; }
    return { x: 40, y: 40 };
  }
  return { render, layout, freeSpot, methodText, attrText };
})();
