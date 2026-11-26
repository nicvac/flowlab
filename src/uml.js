/* ==========================================================================
   FlowLab — class diagram (UML)
   Each class is a box with three sections: name, attributes, methods.
   Inheritance: arrow with an empty triangle towards the parent class.
   Association: open arrow towards the class used as the type of an
   attribute, with the name of the attribute and the multiplicity (0..1 or *).
   ========================================================================== */
'use strict';
if (typeof L === 'undefined' && typeof require !== 'undefined') require('./i18n.js'); // testi tradotti (in Node: italiano)

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
  /* exception of the program (it inherits, even from afar, from Exception) */
  const isExc = (prog, c) => !c.builtin && ModelLib.isExcClass(prog, c);
  function methodText(prog, f) {
    const ps = f.params.map((p) => `${p.name}: ${T(p.type)}${p.array ? `[${','.repeat((p.dims || 1) - 1)}]` : ''}`).join(', ');
    const rl = ModelLib.rets(f);
    return `${V(f.visibility)} ${f.name}${(f.tparams || []).length ? `<${f.tparams.join(', ')}>` : ''}(${ps})${rl.length ? ': ' + rl.map((r) => T(r.type) + (r.array ? `[${','.repeat((r.dims || 1) - 1)}]` : '')).join(', ') : ''}`;
  }

  /* measures of each box */
  function layout(prog) {
    const main = ModelLib.mainClass(prog);
    const boxes = new Map();
    for (const c of prog.classes) {
      const members = ModelLib.membersOf(prog, c);
      const methods = [...members.filter((f) => f.ctor), ...members.filter((f) => !f.ctor)];
      const attrs = c.attributes.map((a, i) => ({ text: attrText(a), i, st: !!a.static }));
      const meths = methods.map((f) => ({ text: methodText(prog, f), f, st: !!f.static, ctor: !!f.ctor, abs: !!f.abstract, main: f === prog.functions[0] }));
      // concrete class that does not define inherited abstract methods
      const missing = c.abstract ? [] : ModelLib.missingAbstract(prog, c);
      let w = Math.max(MINW, tw(ModelLib.classTitle(c), FN) + PADX * 2 + 24, ...attrs.map((r) => tw(r.text, FM) + PADX * 2), ...meths.map((r) => tw(r.text, FM) + PADX * 2));
      w = Math.ceil(Math.min(MAXW, w));
      // exception of the program: «exception» above the name
      const head = HEAD + (c === main || c.abstract || isExc(prog, c) ? STEREO : 0);
      const ah = Math.max(1, attrs.length) * ROW + CPAD * 2 - (attrs.length ? 0 : ROW - 10);
      const mh = Math.max(1, meths.length) * ROW + CPAD * 2 - (meths.length ? 0 : ROW - 10);
      boxes.set(c.id, { c, x: c.x || 0, y: c.y || 0, w, h: head + ah + mh, head, ah, mh, attrs, meths, main: c === main, missing, exc: isExc(prog, c) });
    }
    return boxes;
  }
  /* predefined exceptions the program inherits from (even from afar): read-only boxes.
     The first time they appear they are put in the best place, usually above the subclasses; then
     they stay there (pos: Map name → { x, y }, moved by dragging) and do not follow the subclasses */
  function builtinBoxes(prog, boxes, pos) {
    const used = [];
    for (const c of prog.classes) if (!c.builtin) for (const k of ModelLib.chainOf(prog, c)) if (k.builtin && !used.includes(k)) used.push(k);
    if (!used.length) return;
    const depth = (k) => ModelLib.chainOf(prog, k).length;
    used.sort((a, b) => depth(b) - depth(a)); // first the ones closest to the classes of the program
    const all = () => [...boxes.values()];
    const hits = (x, y, w, h) => all().some((b) => x < b.x + b.w + 30 && x + w + 30 > b.x && y < b.y + b.h + 30 && y + h + 30 > b.y);
    for (const k of used) {
      const attrs = [{ text: L('uml.message', { value: T('String') }), i: 0, st: false, tip: L('uml.theMessageOfTheExceptionRead') }];
      const meths = [{ text: `+ ${k.name}()`, ctor: true, tip: L('uml.constructorEmptyMessage') }, { text: `+ ${k.name}(message: ${T('String')})`, ctor: true, tip: L('uml.constructorInASubclassItIs') }];
      const w = Math.ceil(Math.max(MINW, tw(k.name, FN) + PADX * 2 + 24, tw(L('uml.predefinedException'), FS) + PADX * 2, ...[...attrs, ...meths].map((r) => tw(r.text, FM) + PADX * 2)));
      const head = HEAD + STEREO, ah = ROW + CPAD * 2, mh = 2 * ROW + CPAD * 2, h = head + ah + mh;
      const kids = all().filter((b) => b.c.parent && b.c.parent.toLowerCase() === k.name.toLowerCase());
      const cx = kids.reduce((t, b) => t + b.x + b.w / 2, 0) / kids.length;
      const top = Math.min(...kids.map((b) => b.y)), left = Math.min(...kids.map((b) => b.x)), right = Math.max(...kids.map((b) => b.x + b.w));
      // possible places: above (centred and then shifted right and left), left, right
      const cands = [];
      const above = top - h - 60;
      if (above >= 10) for (let d = 0; d <= 600; d += 40) { cands.push([cx - w / 2 + d, above]); if (d) cands.push([cx - w / 2 - d, above]); }
      cands.push([left - w - 70, top], [right + 70, top]);
      for (let d = 40; d <= 1200; d += 40) cands.push([right + 70, top + d], [left - w - 70, top + d]);
      let p = pos && pos.get(k.name);
      if (!p) {
        const at = cands.map(([x, y]) => [Math.round(x), Math.round(y)]).find(([x, y]) => x >= 10 && y >= 10 && !hits(x, y, w, h)) || [Math.round(right + 70), Math.round(Math.max(10, top))];
        p = { x: at[0], y: at[1] };
        if (pos) pos.set(k.name, p);
      }
      boxes.set(k.id, { c: k, builtin: true, x: p.x, y: p.y, w, h, head, ah, mh, attrs, meths, main: false, missing: [], exc: true });
    }
  }

  /* modules with only functions in the Objects view: one box each, with the functions (session position in pos: Map name → { x, y },
     the first time to the right of the classes) */
  function fmodBoxes(prog, boxes, pos, collapsed) {
    const out = [];
    const all = () => [...boxes.values(), ...out];
    const hits = (x, y, w, h) => all().some((b) => x < b.x + b.w + 40 && x + w + 40 > b.x && y < b.y + b.h + 40 && y + h + 40 > b.y);
    for (const m of ModelLib.modulesOf(prog).filter((x) => !x.classes.length && x.funcs.length)) {
      const rows = m.funcs.map((f) => ({ f, text: methodText(prog, f).replace(/^\S+ /, '') }));
      const label = L('uml.module') + m.name;
      const w = Math.ceil(Math.min(MAXW + 60, Math.max(190, tw(label, FS) + 70, ...rows.map((r) => tw(r.text, FM) + PADX * 2 + 8))));
      const h = collapsed.has(m.name) ? 62 : 34 + rows.length * ROW + 10;
      let p = pos && pos.get(m.name);
      if (!p) {
        const right = all().length ? Math.max(...all().map((b) => b.x + b.w)) : 0;
        let at = null;
        for (let yy = 40; yy < 2000 && !at; yy += 40) for (const xx of [right + 90]) if (!hits(xx, yy, w, h)) at = { x: Math.round(xx), y: yy };
        p = at || { x: Math.round(right + 90), y: 40 };
        if (pos) pos.set(m.name, p);
      }
      out.push({ m, rows, label, x: p.x, y: p.y, w, h });
    }
    return out;
  }
  /* point where the line from the centre towards (tx, ty) leaves the box */
  function clip(b, tx, ty, ox, oy) {
    const cx = b.x + b.w / 2 + (ox || 0), cy = b.y + b.h / 2 + (oy || 0);
    const dx = tx - cx, dy = ty - cy;
    if (!dx && !dy) return [cx, cy];
    const t = Math.min(dx ? (b.w / 2) / Math.abs(dx) : Infinity, dy ? (b.h / 2) / Math.abs(dy) : Infinity);
    return [cx + dx * t, cy + dy * t];
  }

  /* small button to collapse (−) or expand (+) a module */
  const modTog = (cx, cy, name, open) => `<g class="umodtog" data-module="${esc(name)}" role="button" aria-label="${open ? L('uml.collapseTheModule', { name: esc(name) }) : L('uml.expandTheModule', { name: esc(name) })}"><title>${open ? L('uml.collapseTheModuleShowOnlyThe') : L('uml.expandTheModuleShowAttributesAnd')}</title><circle cx="${cx}" cy="${cy}" r="8"/><path d="M${cx - 3.5} ${cy}H${cx + 3.5}${open ? '' : `M${cx} ${cy - 3.5}V${cy + 3.5}`}"/></g>`;
  /* opts.collapsed: names of the collapsed modules (a single box with the class names) */
  function render(prog, sel, opts) {
    const boxes = layout(prog);
    builtinBoxes(prog, boxes, opts && opts.excPos);
    const collapsed = (opts && opts.collapsed) || new Set();
    const mods = ModelLib.modulesOf(prog).filter((x) => x.classes.length);
    // collapsed modules: all their classes point to the same compact box
    for (const m of mods.filter((x) => collapsed.has(x.name))) {
      const bs = m.classes.map((c) => boxes.get(c.id));
      const rows = m.classes.map((c) => ModelLib.classTitle(c));
      const label = L('uml.module') + m.name;
      const w = Math.ceil(Math.max(170, tw(label, FS) + 60, ...rows.map((r) => tw(r, FN) + 36)));
      const cb = { compact: true, m, rows, label, x: Math.min(...bs.map((b) => b.x)), y: Math.min(...bs.map((b) => b.y)), w, h: 40 + rows.length * 22 + 8 };
      for (const c of m.classes) boxes.set(c.id, cb);
    }
    // modules with only functions: a box of the module with its functions (they belong to no class)
    const fbox = fmodBoxes(prog, boxes, opts && opts.fmodPos, collapsed);
    let W = 640, H = 420;
    for (const b of [...boxes.values(), ...fbox]) { W = Math.max(W, b.x + b.w + 120); H = Math.max(H, b.y + b.h + 120); }
    const lines = [], labels = [], shapes = [], frames = [];
    // imported modules: a dashed box around their classes
    for (const m of mods.filter((x) => !collapsed.has(x.name))) {
      const bs = m.classes.map((c) => boxes.get(c.id));
      const x1 = Math.min(...bs.map((b) => b.x)) - 16, y1 = Math.min(...bs.map((b) => b.y)) - 34;
      const x2 = Math.max(...bs.map((b) => b.x + b.w)) + 16, y2 = Math.max(...bs.map((b) => b.y + b.h)) + 16;
      const label = L('uml.module') + m.name;
      const tabW = tw(label, FS) + 46;
      frames.push(`<g class="umod" data-module="${esc(m.name)}"><title>${L('uml.moduleReadOnlyRightClickTo', { name: esc(m.name) })}</title><rect class="umodbg" x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" rx="10"/><rect class="umodtab" x="${x1}" y="${y1}" width="${tabW}" height="22" rx="10"/><text class="umodlab" x="${x1 + 13}" y="${y1 + 15}">${esc(label)}</text>${modTog(x1 + tabW - 14, y1 + 11, m.name, true)}</g>`);
      W = Math.max(W, x2 + 40); H = Math.max(H, y2 + 40);
    }
    // relations: a single line per ordered pair and kind; pairs with several relations are spread apart
    const rels = [];
    for (const c of [...prog.classes, ...[...boxes.values()].filter((b) => b.builtin).map((b) => b.c)]) {
      const par = ModelLib.classByName(prog, c.parent);
      // generic parent class: the types it receives, when they are not its own names (T→Integer, T→V)
      const bind = par && (par.tparams || []).map((t, i) => [t, (c.pargs || [])[i]]).filter(([t, a]) => a && a.toLowerCase() !== t.toLowerCase()).map(([t, a]) => `${t}→${T(a)}`).join(', ');
      if (par && par !== c && boxes.has(par.id)) rels.push({ kind: 'inh', from: c, to: par, bind });
      for (const a of c.attributes) {
        const t = ModelLib.classByName(prog, ExprLib.splitType(a.type).base);
        if (t && boxes.has(t.id)) rels.push({ kind: 'assoc', from: c, to: t, name: a.name, mult: a.array ? '*' : '0..1', st: a.static });
      }
    }
    const pairCount = new Map();
    for (const r of rels) { const k = [r.from.id, r.to.id].sort().join('|'); pairCount.set(k, (pairCount.get(k) || 0) + 1); }
    const pairIdx = new Map();
    const selfIdx = new Map();
    for (const r of rels) {
      const A = boxes.get(r.from.id), B = boxes.get(r.to.id);
      if (A.compact && A === B) continue; // inside a collapsed module
      if (r.from === r.to) {
        // association towards its own class: loop on the right side
        const k = selfIdx.get(A.c.id) || 0; selfIdx.set(A.c.id, k + 1);
        const x = A.x + A.w, y1 = A.y + 14 + k * 12, y2 = A.y + A.head + 6 + k * 12, d = 34 + k * 16;
        lines.push(`<path class="urel assoc" d="M${x} ${y1}H${x + d}V${y2}H${x + 1}" marker-end="url(#uml-open)"/>`);
        labels.push(`<text class="ulab" x="${x + d + 5}" y="${(y1 + y2) / 2 + 4}">${esc(r.name)} ${r.mult}</text>`);
        continue;
      }
      const key = [r.from.id, r.to.id].sort().join('|');
      const n = pairCount.get(key), i = pairIdx.get(key) || 0; pairIdx.set(key, i + 1);
      // perpendicular offset for parallel relations
      const ax = A.x + A.w / 2, ay = A.y + A.h / 2, bx = B.x + B.w / 2, by = B.y + B.h / 2;
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const sign = r.from.id < r.to.id ? 1 : -1;
      const off = (i - (n - 1) / 2) * 16 * sign;
      const ox = (-(by - ay) / len) * off, oy = ((bx - ax) / len) * off;
      const p1 = clip(A, bx + ox, by + oy, ox, oy), p2 = clip(B, ax + ox, ay + oy, ox, oy);
      if (r.kind === 'inh') {
        lines.push(`<path class="urel inh" d="M${p1[0]} ${p1[1]}L${p2[0]} ${p2[1]}" marker-end="url(#uml-inh)"/>`);
        if (r.bind) labels.push(`<text class="ulab ubind" x="${(p1[0] + p2[0]) / 2 + 8}" y="${(p1[1] + p2[1]) / 2 + 4}">«bind» ${esc(r.bind)}</text>`);
      } else {
        lines.push(`<path class="urel assoc" d="M${p1[0]} ${p1[1]}L${p2[0]} ${p2[1]}" marker-end="url(#uml-open)"/>`);
        // label near the arrival class
        const lx = p2[0] + (p1[0] - p2[0]) * 0.22, ly = p2[1] + (p1[1] - p2[1]) * 0.22;
        const nx = -(p2[1] - p1[1]) / len, ny = (p2[0] - p1[0]) / len;
        const anchor = nx >= 0 ? 'start' : 'end';
        labels.push(`<text class="ulab" x="${lx + nx * 14}" y="${ly + ny * 14 + 4}" text-anchor="${anchor}">${r.st ? '<tspan text-decoration="underline">' : ''}${esc(r.name)}${r.st ? '</tspan>' : ''} ${r.mult}</text>`);
      }
    }
    // collapsed modules
    for (const b of new Set([...boxes.values()].filter((x) => x.compact))) {
      const { x, y, w, h } = b;
      let g = `<g class="umod umodc" data-module="${esc(b.m.name)}"><title>${L('uml.moduleReadOnlyCollapsedDoubleClick', { name: esc(b.m.name) })}</title>`;
      g += `<rect class="umodbg" x="${x}" y="${y}" width="${w}" height="${h}" rx="10"/><rect class="umodtab" x="${x}" y="${y}" width="${w}" height="26" rx="10"/><text class="umodlab" x="${x + 13}" y="${y + 17}">${esc(b.label)}</text>`;
      g += modTog(x + w - 15, y + 13, b.m.name, false);
      b.rows.forEach((r, k) => { g += `<text class="umodcls" x="${x + 16}" y="${y + 46 + k * 22}">${esc(r)}</text>`; });
      shapes.push(g + '</g>');
    }
    for (const b of fbox) {
      const { x, y, w, h } = b, open = !collapsed.has(b.m.name);
      let g = `<g class="umod umodf${open ? '' : ' umodc'}" data-module="${esc(b.m.name)}"><title>${open ? L('uml.functionsModuleReadOnly', { name: esc(b.m.name) }) : L('uml.moduleReadOnlyCollapsedDoubleClick', { name: esc(b.m.name) })}</title>`;
      g += `<rect class="umodbg" x="${x}" y="${y}" width="${w}" height="${h}" rx="10"/><rect class="umodtab" x="${x}" y="${y}" width="${w}" height="26" rx="10"/><text class="umodlab" x="${x + 13}" y="${y + 17}">${esc(b.label)}</text>`;
      g += modTog(x + w - 15, y + 13, b.m.name, open);
      if (!open) g += `<text class="umodcls" x="${x + 16}" y="${y + 46}">${esc(L('uml.nFunctions', { n: b.rows.length }))}</text>`;
      else b.rows.forEach((r, k) => {
        const ry = y + 34 + k * ROW;
        const on = sel && sel.kind === 'method' && sel.fid === r.f.id;
        g += `<g class="urow method${on ? ' sel' : ''}" data-kind="method" data-fid="${r.f.id}"><rect class="uhit" x="${x + 4}" y="${ry}" width="${w - 8}" height="${ROW}" rx="3"/><text class="umem" x="${x + PADX}" y="${ry + ROW / 2 + 4.5}">${esc(RenderLib.fitText(r.text, w - PADX * 2, FM))}</text><title>${esc(r.text)}${L('uml.functionOfTheModuleDoubleClick')}</title></g>`;
      });
      shapes.push(g + '</g>');
    }
    // boxes
    for (const b of boxes.values()) {
      if (b.compact) continue;
      if (b.builtin) { shapes.push(builtinBox(b)); continue; }
      const { c, x, y, w } = b;
      const isSel = sel && sel.cls === c.id;
      const warn = b.missing.length ? L('uml.doesNotDefineInAddOr', { name: c.name, list: b.missing.map((m) => m.f.name + '()').join(', '), text: b.missing.length === 1 ? L('uml.abstract') : L('uml.abstract2'), list2: [...new Set(b.missing.map((m) => m.owner.name))].join(', '), text2: b.missing.length === 1 ? L('chart.theMethod') : L('uml.theMethods') }) : '';
      let g = `<g class="ubox${isSel && sel.kind === 'class' ? ' sel' : ''}${isSel ? ' cur' : ''}${b.main ? ' main' : ''}${b.exc ? ' exc' : ''}${c.abstract ? ' abstract' : ''}${warn ? ' warn' : ''}${c.module ? ' mod' : ''}" data-cls="${c.id}">`;
      g += c.module ? `<title>${L('uml.fromTheModuleReadOnlyDouble', { c: esc(ModelLib.classTitle(c)), name: esc(c.module.name) })}</title>`
        : `<title>${c.abstract ? L('uml.abstractClass') : ''}${esc(ModelLib.classTitle(c))}${c.parent ? L('uml.inheritsFrom') + esc(ModelLib.parentTitle(c)) : ''}${warn ? ' — ⚠ ' + esc(warn) : ''}${L('uml.doubleClickTheNameToEdit')}</title>`;
      g += `<rect class="ubg" x="${x}" y="${y}" width="${w}" height="${b.h}" rx="6"/>`;
      g += `<path class="uheadbg" d="M${x} ${y + b.head}V${y + 6}Q${x} ${y} ${x + 6} ${y}H${x + w - 6}Q${x + w} ${y} ${x + w} ${y + 6}V${y + b.head}Z"/>`;
      g += `<rect class="uhit head" data-part="head" x="${x}" y="${y}" width="${w}" height="${b.head}"/>`;
      if (b.main || c.abstract || b.exc) g += `<text class="ustereo" x="${x + w / 2}" y="${y + 15}">${b.main ? L('uml.main') : c.abstract ? L('uml.abstract3') : L('uml.exception')}</text>`;
      g += `<text class="uname" x="${x + w / 2}" y="${y + b.head - 13}">${esc(ModelLib.classTitle(c))}</text>`;
      if (warn) g += `<g class="uwarn"><circle cx="${x + 15}" cy="${y + b.head / 2}" r="8"/><text x="${x + 15}" y="${y + b.head / 2 + 4}">!</text></g>`;
      // attributes
      let yy = y + b.head;
      g += `<path class="usep" d="M${x} ${yy}H${x + w}"/>`;
      b.attrs.forEach((r, k) => {
        const ry = yy + CPAD + k * ROW;
        const on = isSel && sel.kind === 'attr' && sel.i === r.i;
        g += `<g class="urow${on ? ' sel' : ''}" data-kind="attr" data-i="${r.i}"><rect class="uhit" x="${x + 2}" y="${ry}" width="${w - 4}" height="${ROW}" rx="3"/><text class="umem" x="${x + PADX}" y="${ry + ROW / 2 + 4.5}"${r.st ? ' text-decoration="underline"' : ''}>${esc(RenderLib.fitText(r.text, w - PADX * 2, FM))}</text><title>${esc(r.text)}${r.st ? L('uml.static') : ''}${L('uml.doubleClickToEditIt')}</title></g>`;
      });
      if (!c.module) g += addBtn(x + w - 13, yy, 'attr', L('uml.addAnAttribute'));
      // methods
      yy += b.ah;
      g += `<path class="usep" d="M${x} ${yy}H${x + w}"/>`;
      b.meths.forEach((r, k) => {
        const ry = yy + CPAD + k * ROW;
        const on = isSel && sel.kind === 'method' && sel.fid === r.f.id;
        const tip = r.ctor ? L('uml.constructor') : r.main ? L('uml.startingPointOfTheProgram') : r.st ? L('uml.staticMethod') : r.abs ? L('uml.abstractMethodWithoutABodyThe') : L('uml.method');
        g += `<g class="urow method${on ? ' sel' : ''}${r.ctor ? ' ctor' : ''}${r.abs ? ' abs' : ''}${r.main ? ' mainm' : ''}" data-kind="method" data-fid="${r.f.id}"><rect class="uhit" x="${x + 2}" y="${ry}" width="${w - 4}" height="${ROW}" rx="3"/><text class="umem" x="${x + PADX}" y="${ry + ROW / 2 + 4.5}"${r.st ? ' text-decoration="underline"' : ''}>${esc(RenderLib.fitText(r.text, w - PADX * 2, FM))}</text><title>${esc(r.text)} (${tip})${r.abs ? '' : L('uml.doubleClickToOpenTheFlowchart')}</title></g>`;
      });
      if (!c.module) g += addBtn(x + w - 13, yy, 'method', L('uml.addAMethodOrAConstructor'));
      g += '</g>';
      shapes.push(g);
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="uml" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" data-w="${W}" data-h="${H}">`
      + '<defs><marker id="uml-inh" viewBox="0 0 14 14" refX="13" refY="7" markerWidth="13" markerHeight="13" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M1 1L13 7L1 13Z" class="minh"/></marker>'
      + '<marker id="uml-open" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="11" markerHeight="11" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M1 1L11 6L1 11" class="mopen"/></marker></defs>'
      + `<g class="umods">${frames.join('')}</g><g class="urels">${lines.join('')}</g><g class="uboxes">${shapes.join('')}</g><g class="ulabels">${labels.join('')}</g></svg>`;
    return { svg, W, H, boxes };
  }
  /* eccezione predefinita: message e i due costruttori, in sola lettura */
  function builtinBox(b) {
    const { c, x, y, w } = b;
    let g = `<g class="ubox exc builtin" data-cls="${c.id}"><title>${esc(c.name)}${L('uml.predefinedException2')}${c.parent ? L('uml.inheritsFrom2') + esc(c.parent) : ''} (${esc(c.doc)})${L('uml.readOnlyDragItToMove')}</title>`;
    g += `<rect class="ubg" x="${x}" y="${y}" width="${w}" height="${b.h}" rx="6"/>`;
    g += `<path class="uheadbg" d="M${x} ${y + b.head}V${y + 6}Q${x} ${y} ${x + 6} ${y}H${x + w - 6}Q${x + w} ${y} ${x + w} ${y + 6}V${y + b.head}Z"/>`;
    g += `<text class="ustereo" x="${x + w / 2}" y="${y + 15}">«eccezione predefinita»</text><text class="uname" x="${x + w / 2}" y="${y + b.head - 13}">${esc(c.name)}</text>`;
    let yy = y + b.head;
    const row = (r, k) => `<g class="urow ro"><text class="umem" x="${x + PADX}" y="${yy + CPAD + k * ROW + ROW / 2 + 4.5}">${esc(r.text)}</text><title>${esc(r.text)} — ${esc(r.tip)}</title></g>`;
    g += `<path class="usep" d="M${x} ${yy}H${x + w}"/>` + b.attrs.map(row).join('');
    yy += b.ah;
    g += `<path class="usep" d="M${x} ${yy}H${x + w}"/>` + b.meths.map(row).join('');
    return g + '</g>';
  }
  function addBtn(cx, y, what, title) {
    return `<g class="uadd" data-add="${what}" role="button" aria-label="${title}"><title>${title}</title><circle cx="${cx}" cy="${y}" r="8"/><path d="M${cx - 3.5} ${y}H${cx + 3.5}M${cx} ${y - 3.5}V${y + 3.5}"/></g>`;
  }
  /* free position for a new class */
  function freeSpot(prog, near) {
    const boxes = layout(prog);
    const hit = (x, y) => [...boxes.values()].some((b) => x < b.x + b.w + 40 && x + 220 > b.x - 40 && y < b.y + b.h + 40 && y + 140 > b.y - 40);
    if (near && !hit(near.x, near.y)) return { x: Math.max(20, Math.round(near.x)), y: Math.max(20, Math.round(near.y)) };
    for (let row = 0; row < 40; row++) for (let col = 0; col < 6; col++) { const x = 40 + col * 280, y = 40 + row * 200; if (!hit(x, y)) return { x, y }; }
    return { x: 40, y: 40 };
  }
  return { render, layout, freeSpot, methodText, attrText };
})();
