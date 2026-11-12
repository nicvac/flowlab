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
    return `${V(f.visibility)} ${f.name}${(f.tparams || []).length ? `<${f.tparams.join(', ')}>` : ''}(${ps})${rl.length ? ': ' + rl.map((r) => T(r.type) + (r.array ? `[${','.repeat((r.dims || 1) - 1)}]` : '')).join(', ') : ''}`;
  }

  /* misure di ogni riquadro */
  function layout(prog) {
    const main = ModelLib.mainClass(prog);
    const boxes = new Map();
    for (const c of prog.classes) {
      const members = ModelLib.membersOf(prog, c);
      const methods = [...members.filter((f) => f.ctor), ...members.filter((f) => !f.ctor)];
      const attrs = c.attributes.map((a, i) => ({ text: attrText(a), i, st: !!a.static }));
      const meths = methods.map((f) => ({ text: methodText(prog, f), f, st: !!f.static, ctor: !!f.ctor, abs: !!f.abstract, main: f === prog.functions[0] }));
      // classe concreta che non definisce metodi astratti ereditati
      const missing = c.abstract ? [] : ModelLib.missingAbstract(prog, c);
      let w = Math.max(MINW, tw(ModelLib.classTitle(c), FN) + PADX * 2 + 24, ...attrs.map((r) => tw(r.text, FM) + PADX * 2), ...meths.map((r) => tw(r.text, FM) + PADX * 2));
      w = Math.ceil(Math.min(MAXW, w));
      const head = HEAD + (c === main || c.abstract ? STEREO : 0);
      const ah = Math.max(1, attrs.length) * ROW + CPAD * 2 - (attrs.length ? 0 : ROW - 10);
      const mh = Math.max(1, meths.length) * ROW + CPAD * 2 - (meths.length ? 0 : ROW - 10);
      boxes.set(c.id, { c, x: c.x || 0, y: c.y || 0, w, h: head + ah + mh, head, ah, mh, attrs, meths, main: c === main, missing });
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

  /* pulsantino per condensare (−) o espandere (+) un modulo */
  const modTog = (cx, cy, name, open) => `<g class="umodtog" data-module="${esc(name)}" role="button" aria-label="${open ? 'Condensa' : 'Espandi'} il modulo ${esc(name)}"><title>${open ? 'Condensa il modulo: mostra solo i nomi delle classi' : 'Espandi il modulo: mostra attributi e metodi'}</title><circle cx="${cx}" cy="${cy}" r="8"/><path d="M${cx - 3.5} ${cy}H${cx + 3.5}${open ? '' : `M${cx} ${cy - 3.5}V${cy + 3.5}`}"/></g>`;
  /* opts.collapsed: nomi dei moduli condensati (un solo riquadro con i nomi delle classi) */
  function render(prog, sel, opts) {
    const boxes = layout(prog);
    const collapsed = (opts && opts.collapsed) || new Set();
    const mods = ModelLib.modulesOf(prog).filter((x) => x.classes.length);
    // moduli condensati: tutte le loro classi puntano allo stesso riquadro compatto
    for (const m of mods.filter((x) => collapsed.has(x.name))) {
      const bs = m.classes.map((c) => boxes.get(c.id));
      const rows = m.classes.map((c) => ModelLib.classTitle(c));
      const label = 'modulo ' + m.name;
      const w = Math.ceil(Math.max(170, tw(label, FS) + 60, ...rows.map((r) => tw(r, FN) + 36)));
      const cb = { compact: true, m, rows, label, x: Math.min(...bs.map((b) => b.x)), y: Math.min(...bs.map((b) => b.y)), w, h: 40 + rows.length * 22 + 8 };
      for (const c of m.classes) boxes.set(c.id, cb);
    }
    let W = 640, H = 420;
    for (const b of boxes.values()) { W = Math.max(W, b.x + b.w + 120); H = Math.max(H, b.y + b.h + 120); }
    const lines = [], labels = [], shapes = [], frames = [];
    // moduli importati: un riquadro tratteggiato intorno alle loro classi
    for (const m of mods.filter((x) => !collapsed.has(x.name))) {
      const bs = m.classes.map((c) => boxes.get(c.id));
      const x1 = Math.min(...bs.map((b) => b.x)) - 16, y1 = Math.min(...bs.map((b) => b.y)) - 34;
      const x2 = Math.max(...bs.map((b) => b.x + b.w)) + 16, y2 = Math.max(...bs.map((b) => b.y + b.h)) + 16;
      const label = 'modulo ' + m.name;
      const tabW = tw(label, FS) + 46;
      frames.push(`<g class="umod" data-module="${esc(m.name)}"><title>Modulo ${esc(m.name)} (sola lettura): clic destro per aggiornarlo o rimuoverlo</title><rect class="umodbg" x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" rx="10"/><rect class="umodtab" x="${x1}" y="${y1}" width="${tabW}" height="22" rx="10"/><text class="umodlab" x="${x1 + 13}" y="${y1 + 15}">${esc(label)}</text>${modTog(x1 + tabW - 14, y1 + 11, m.name, true)}</g>`);
      W = Math.max(W, x2 + 40); H = Math.max(H, y2 + 40);
    }
    // relazioni: una sola linea per coppia ordinata e tipo; le coppie con più relazioni si scostano
    const rels = [];
    for (const c of prog.classes) {
      const par = ModelLib.classByName(prog, c.parent);
      if (par && par !== c) rels.push({ kind: 'inh', from: c, to: par });
      for (const a of c.attributes) {
        const t = ModelLib.classByName(prog, ExprLib.splitType(a.type).base);
        if (t) rels.push({ kind: 'assoc', from: c, to: t, name: a.name, mult: a.array ? '*' : '0..1', st: a.static });
      }
    }
    const pairCount = new Map();
    for (const r of rels) { const k = [r.from.id, r.to.id].sort().join('|'); pairCount.set(k, (pairCount.get(k) || 0) + 1); }
    const pairIdx = new Map();
    const selfIdx = new Map();
    for (const r of rels) {
      const A = boxes.get(r.from.id), B = boxes.get(r.to.id);
      if (A.compact && A === B) continue; // dentro un modulo condensato
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
    // moduli condensati
    for (const b of new Set([...boxes.values()].filter((x) => x.compact))) {
      const { x, y, w, h } = b;
      let g = `<g class="umod umodc" data-module="${esc(b.m.name)}"><title>Modulo ${esc(b.m.name)} (sola lettura, condensato): doppio clic per espanderlo, clic destro per aggiornarlo o rimuoverlo</title>`;
      g += `<rect class="umodbg" x="${x}" y="${y}" width="${w}" height="${h}" rx="10"/><rect class="umodtab" x="${x}" y="${y}" width="${w}" height="26" rx="10"/><text class="umodlab" x="${x + 13}" y="${y + 17}">${esc(b.label)}</text>`;
      g += modTog(x + w - 15, y + 13, b.m.name, false);
      b.rows.forEach((r, k) => { g += `<text class="umodcls" x="${x + 16}" y="${y + 46 + k * 22}">${esc(r)}</text>`; });
      shapes.push(g + '</g>');
    }
    // riquadri
    for (const b of boxes.values()) {
      if (b.compact) continue;
      const { c, x, y, w } = b;
      const isSel = sel && sel.cls === c.id;
      const warn = b.missing.length ? `${c.name} non definisce ${b.missing.map((m) => m.f.name + '()').join(', ')} (${b.missing.length === 1 ? 'astratto' : 'astratti'} in ${[...new Set(b.missing.map((m) => m.owner.name))].join(', ')}): aggiungi ${b.missing.length === 1 ? 'il metodo' : 'i metodi'} oppure rendi astratta la classe` : '';
      let g = `<g class="ubox${isSel && sel.kind === 'class' ? ' sel' : ''}${isSel ? ' cur' : ''}${b.main ? ' main' : ''}${c.abstract ? ' abstract' : ''}${warn ? ' warn' : ''}${c.module ? ' mod' : ''}" data-cls="${c.id}">`;
      g += c.module ? `<title>${esc(ModelLib.classTitle(c))} — dal modulo ${esc(c.module.name)}, in sola lettura: doppio clic su un metodo per vederne il diagramma di flusso</title>`
        : `<title>${c.abstract ? 'Classe astratta ' : ''}${esc(ModelLib.classTitle(c))}${c.parent ? ' — eredita da ' + esc(c.parent) : ''}${warn ? ' — ⚠ ' + esc(warn) : ''}: doppio clic sul nome per modificarla, clic destro per aggiungere membri</title>`;
      g += `<rect class="ubg" x="${x}" y="${y}" width="${w}" height="${b.h}" rx="6"/>`;
      g += `<path class="uheadbg" d="M${x} ${y + b.head}V${y + 6}Q${x} ${y} ${x + 6} ${y}H${x + w - 6}Q${x + w} ${y} ${x + w} ${y + 6}V${y + b.head}Z"/>`;
      g += `<rect class="uhit head" data-part="head" x="${x}" y="${y}" width="${w}" height="${b.head}"/>`;
      if (b.main || c.abstract) g += `<text class="ustereo" x="${x + w / 2}" y="${y + 15}">${b.main ? '«principale»' : '«abstract»'}</text>`;
      g += `<text class="uname" x="${x + w / 2}" y="${y + b.head - 13}">${esc(ModelLib.classTitle(c))}</text>`;
      if (warn) g += `<g class="uwarn"><circle cx="${x + 15}" cy="${y + b.head / 2}" r="8"/><text x="${x + 15}" y="${y + b.head / 2 + 4}">!</text></g>`;
      // attributi
      let yy = y + b.head;
      g += `<path class="usep" d="M${x} ${yy}H${x + w}"/>`;
      b.attrs.forEach((r, k) => {
        const ry = yy + CPAD + k * ROW;
        const on = isSel && sel.kind === 'attr' && sel.i === r.i;
        g += `<g class="urow${on ? ' sel' : ''}" data-kind="attr" data-i="${r.i}"><rect class="uhit" x="${x + 2}" y="${ry}" width="${w - 4}" height="${ROW}" rx="3"/><text class="umem" x="${x + PADX}" y="${ry + ROW / 2 + 4.5}"${r.st ? ' text-decoration="underline"' : ''}>${esc(RenderLib.fitText(r.text, w - PADX * 2, FM))}</text><title>${esc(r.text)}${r.st ? ' (statico)' : ''} — doppio clic per modificarlo</title></g>`;
      });
      if (!c.module) g += addBtn(x + w - 13, yy, 'attr', 'Aggiungi un attributo');
      // metodi
      yy += b.ah;
      g += `<path class="usep" d="M${x} ${yy}H${x + w}"/>`;
      b.meths.forEach((r, k) => {
        const ry = yy + CPAD + k * ROW;
        const on = isSel && sel.kind === 'method' && sel.fid === r.f.id;
        const tip = r.ctor ? 'costruttore' : r.main ? 'punto di partenza del programma' : r.st ? 'metodo statico' : r.abs ? 'metodo astratto, senza corpo: lo definiscono le sottoclassi' : 'metodo';
        g += `<g class="urow method${on ? ' sel' : ''}${r.ctor ? ' ctor' : ''}${r.abs ? ' abs' : ''}${r.main ? ' mainm' : ''}" data-kind="method" data-fid="${r.f.id}"><rect class="uhit" x="${x + 2}" y="${ry}" width="${w - 4}" height="${ROW}" rx="3"/><text class="umem" x="${x + PADX}" y="${ry + ROW / 2 + 4.5}"${r.st ? ' text-decoration="underline"' : ''}>${esc(RenderLib.fitText(r.text, w - PADX * 2, FM))}</text><title>${esc(r.text)} (${tip})${r.abs ? '' : ' — doppio clic per aprire il diagramma di flusso'}</title></g>`;
      });
      if (!c.module) g += addBtn(x + w - 13, yy, 'method', 'Aggiungi un metodo o un costruttore');
      g += '</g>';
      shapes.push(g);
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="uml" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" data-w="${W}" data-h="${H}">`
      + '<defs><marker id="uml-inh" viewBox="0 0 14 14" refX="13" refY="7" markerWidth="13" markerHeight="13" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M1 1L13 7L1 13Z" class="minh"/></marker>'
      + '<marker id="uml-open" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="11" markerHeight="11" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M1 1L11 6L1 11" class="mopen"/></marker></defs>'
      + `<g class="umods">${frames.join('')}</g><g class="urels">${lines.join('')}</g><g class="uboxes">${shapes.join('')}</g><g class="ulabels">${labels.join('')}</g></svg>`;
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
