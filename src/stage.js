/* FlowLab Stage: animated scenes that follow the variables of the program.
   This file is NOT part of the page script: the build puts it in the page as text, and it runs only when a program
   linked to stages is opened (or a stage is linked). Until then nothing of it exists and the execution of the programs
   costs nothing more. A program (.fprg) names its stages (prog.stages: the .flstage files in the same folder, with the
   variables bound to their slots); one at a time is active, and with the window collapsed to its title bar the stage is
   unloaded (no iframe, no hook: the execution is exactly as without stages).

   A stage file (.flstage) is a JavaScript module:
     export const bindings = { "fila": "Main.dati" };      // the default bindings (the program keeps its own): slot -> variable
     export default { name, description, slots: { fila: { type: 'Integer[]', label: '…' } }, setup(stage), reset(stage, values),
                      update(stage, events, values), stop(stage) };
   It runs in an isolated iframe (sandbox): it receives the changes of the variables and answers when its animation is over;
   meanwhile the program waits. See docs/stage.md */
window.FlowLabStage = (host) => {
  const { L, h, M } = host;
  const NS_ID = 'flowlabStage';
  let cur = null; // the stage loaded in the iframe (null: none, also with the window collapsed)
  let win = null; // the window of the stages of the program
  let token = 0; // the last loading asked (an older one that ends later is ignored)
  const names = new Map(); // file -> name of the stage, once loaded
  let seq = 0;

  /* ------------------------------ the stage document (inside the iframe) ------------------------------ */
  const RUNTIME = `(() => {
  const post = (m) => parent.postMessage(Object.assign({ ${NS_ID}: 1 }, m), '*');
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.getElementById('stage');
  const speedFns = [];
  const stage = {
    svg, width: 800, height: 450, speed: 1, bound: [],
    // the language of FlowLab (it, en…) and the text in that language of { it: '…', en: '…' } (else English, else the first)
    lang: String(window.__flowlabLang || 'en'),
    text(x) { if (x == null || typeof x !== 'object') return x == null ? '' : String(x); return String(x[stage.lang] ?? x.en ?? Object.values(x)[0] ?? ''); },
    el(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs || {}) { if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); } (parent || svg).appendChild(e); return e; },
    clear(parent) { (parent || svg).replaceChildren(); },
    t(s) { return s / stage.speed; },
    wait(s) { return new Promise((r) => setTimeout(r, (s * 1000) / stage.speed)); },
    onSpeed(fn) { speedFns.push(fn); try { fn(stage.speed); } catch (e) { /* the stage's own error */ } },
    log(...a) { post({ type: 'log', msg: a.join(' ') }); },
  };
  window.stage = stage;
  window.addEventListener('error', (e) => post({ type: 'error', msg: e.message || 'error' }));
  window.addEventListener('unhandledrejection', (e) => post({ type: 'error', msg: String((e.reason && e.reason.message) || e.reason) }));
  let scene = null, queue = Promise.resolve();
  window.__boot = async (sc, bindings) => {
    if (!sc || typeof sc !== 'object') { post({ type: 'error', msg: 'export default {…} is missing' }); return; }
    scene = sc;
    try { if (scene.setup) await scene.setup(stage); } catch (e) { post({ type: 'error', msg: (e && e.message) || String(e) }); }
    // name, description and labels of the slots: a text, or a text for each language
    const slots = {};
    for (const [k, v] of Object.entries(sc.slots || {})) slots[k] = Object.assign({}, JSON.parse(JSON.stringify(v)), v && v.label != null ? { label: stage.text(v.label) } : {});
    post({ type: 'ready', info: { name: stage.text(sc.name), description: stage.text(sc.description), slots }, bindings: JSON.parse(JSON.stringify(bindings || {})) });
  };
  window.addEventListener('message', (e) => {
    if (e.source !== parent) return;
    const m = e.data || {};
    if (m.type === 'speed') { stage.speed = m.value; speedFns.forEach((f) => { try { f(m.value); } catch (err) { /* ignore */ } }); return; }
    queue = queue.then(async () => {
      try {
        if (m.type === 'reset') stage.bound = m.bound || [];
        if (m.type === 'reset' && scene && scene.reset) await scene.reset(stage, m.values);
        if (m.type === 'update' && scene && scene.update) await scene.update(stage, m.events, m.values);
        if (m.type === 'stop' && scene && scene.stop) await scene.stop(stage);
      } catch (err) { post({ type: 'error', msg: (err && err.message) || String(err) }); }
      post({ type: 'done', id: m.id });
    });
  });
})();`;
  function srcdoc(code) {
    const mod = code
      .replace(/^[ \t]*export\s+default\s+/m, 'const __scene = ')
      .replace(/^[ \t]*export\s+const\s+bindings\s*=/m, 'const __bindings =')
      .replace(/<\/script/gi, '<\\/script');
    return '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden;background:#fbfaf6}'
      + 'svg#stage{display:block;width:100%;height:100%}</style></head><body>'
      + '<svg id="stage" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" preserveAspectRatio="xMidYMid meet"></svg>'
      + `<script>window.__flowlabLang = ${JSON.stringify(String(host.lang || 'en'))};</script><script>${RUNTIME}</script>`
      + `<script type="module" onerror="parent.postMessage({ ${NS_ID}: 1, type: 'error', msg: 'load' }, '*')">${mod}\n;window.__boot(typeof __scene === 'undefined' ? null : __scene, typeof __bindings === 'undefined' ? {} : __bindings);</script>`
      + '</body></html>';
  }

  /* ------------------------------ slots, variables and bindings ------------------------------ */
  /* type of a slot: { base, dims, list } — Integer, Real[], String[][], Number (Integer or Real), ArrayList<Integer>, List<Integer>, * */
  function slotType(t) {
    let s = String(t || '*').replace(/\s+/g, ''), dims = 0;
    while (s.endsWith('[]')) { dims++; s = s.slice(0, -2); }
    const g = /^(\w+)<(\w+)>$/.exec(s);
    if (g) return { base: g[2], dims: 0, list: g[1] };
    return { base: s, dims, list: null };
  }
  const baseOk = (want, have) => want === '*' || want.toLowerCase() === have.toLowerCase() || (want.toLowerCase() === 'number' && /^(integer|real)$/i.test(have));
  /* the variables of the program (functions: parameters and declarations; static attributes) with their types */
  function variables() {
    const prog = host.prog(), oo = M.hasClasses(prog), out = [];
    for (const f of prog.functions) {
      if (M.isModuleFunc(prog, f)) continue;
      const c = oo ? M.classOf(prog, f) : null;
      const where = c ? `${c.name}.${f.name}` : f.name;
      const add = (name, type, array, dims) => { if (!out.some((x) => x.id.toLowerCase() === `${where}.${name}`.toLowerCase())) out.push({ id: `${where}.${name}`, where, name, type, dims: array ? dims || 1 : 0 }); };
      f.params.forEach((p) => add(p.name, p.type, p.array, p.dims));
      M.walk(f.body, (s) => {
        if (s.kind === 'declare') s.name.split(',').map((x) => x.trim()).filter(Boolean).forEach((n) => add(n, s.type, s.array, s.array ? Math.max(1, String(s.size || '').split(',').length) : 0));
        if (s.kind === 'const' && s.name.trim()) add(s.name.trim(), s.type, false, 0);
      });
    }
    for (const c of oo ? prog.classes : []) for (const a of c.attributes) if (a.static) out.push({ id: `${c.name}.${a.name}`, where: c.name, name: a.name, type: a.type, dims: a.array ? String(a.size || '').split(',').length : 0, attr: true });
    return out;
  }
  function compatible(slot, v) {
    const t = slotType(slot.type);
    if (t.base === '*' && !t.list) return true;
    const g = /^(\w+)<(\w+)>$/.exec(String(v.type).replace(/\s+/g, ''));
    if (t.list) {
      if (!g || v.dims) return false;
      const kinds = t.list.toLowerCase() === 'list' ? ['arraylist', 'stack', 'queue'] : [t.list.toLowerCase()];
      return kinds.includes(g[1].toLowerCase()) && baseOk(t.base, g[2]);
    }
    return !g && v.dims === t.dims && baseOk(t.base, v.type);
  }
  const findVar = (id) => variables().find((v) => v.id.toLowerCase() === String(id || '').toLowerCase());
  /* the slots without a valid variable (the optional ones can stay without) */
  function missing() {
    const out = [];
    for (const [k, s] of Object.entries(cur.info.slots)) {
      const v = findVar(cur.bindings[k]);
      if (!(v && compatible(s, v)) && !s.optional) out.push(k);
    }
    return out;
  }

  /* ------------------------------ values during the execution ------------------------------ */
  function plain(v, depth) {
    if (!v) return null;
    if (v.t === 'Object') return v.v ? listOf(v.v, depth || 0) : null;
    return v.v === undefined ? null : v.v;
  }
  /* ArrayList, Stack, Queue of the modules: their items in order */
  function listOf(obj, depth) {
    const f = (n) => obj.fields && obj.fields.get(n);
    if (depth > 2) return null;
    if (f('head') !== undefined && f('count') !== undefined) {
      const out = []; let node = f('head').value, guard = 0;
      while (node && node.v && guard++ < 100000) { const o = node.v; out.push(plain(o.fields.get('value').value, depth + 1)); node = o.fields.get('next').value; }
      return out;
    }
    if (f('items') && f('count')) { const n = f('count').value ? f('count').value.v : 0; return f('items').items.slice(0, n).map((x) => plain(x, depth + 1)); }
    return `${obj.cls.name}#${obj.id}`;
  }
  function cellValue(cell) {
    if (!cell) return undefined;
    if (cell.items) {
      const flat = cell.items.map((x) => plain(x)), d = cell.dims || [flat.length];
      if (d.length === 1) return flat;
      const rows = (arr, ds) => (ds.length === 1 ? arr : Array.from({ length: ds[0] }, (_, r) => { const n = arr.length / ds[0]; return rows(arr.slice(r * n, (r + 1) * n), ds.slice(1)); }));
      return rows(flat, d);
    }
    return plain(cell.value);
  }
  /* the cell of a binding: the variable in the most recent call of its function, or a static attribute */
  function cellOf(interp, id) {
    const parts = String(id || '').split('.'); if (parts.length < 2) return null;
    const name = parts.pop().toLowerCase(), fn = parts.pop().toLowerCase(), cls = (parts.pop() || '').toLowerCase();
    for (let i = interp.stack.length - 1; i >= 0; i--) {
      const fr = interp.stack[i];
      if (!fr.func || fr.func.name.toLowerCase() !== fn || fr.init) continue;
      if (cls && !(fr.cls && fr.cls.name.toLowerCase() === cls)) continue;
      const c = fr.vars.get(name); if (c) return c;
    }
    // static attribute Class.attr
    if (!cls && interp.oo) { const k = interp.prog.classes.find((x) => x.name.toLowerCase() === fn); const m = k && interp.statics.get(k.id); if (m && m.get(name)) return m.get(name); }
    return null;
  }
  const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
  /* what changed: appear, vanish, value; for lists set, swap, insert, remove, change */
  function diff(slot, a, b) {
    const ev = (kind, o) => Object.assign({ slot, kind, before: a === undefined ? null : a, after: b === undefined ? null : b }, o || {});
    if (a === undefined) return [ev('appear', { value: b })];
    if (b === undefined) return [ev('vanish', { value: a })];
    if (!Array.isArray(a) || !Array.isArray(b)) return [ev('value', { old: a, value: b })];
    const grid = Array.isArray(a[0]) || Array.isArray(b[0]);
    if (grid) {
      const d = [];
      if (a.length === b.length) a.forEach((r, i) => (r || []).forEach((x, j) => { if (!same(x, (b[i] || [])[j])) d.push([i, j]); }));
      if (a.length === b.length && d.length === 1) { const [i, j] = d[0]; return [ev('set', { index: [i, j], old: a[i][j], value: b[i][j] })]; }
      return [ev('change')];
    }
    if (a.length === b.length) {
      const d = []; for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) d.push(i);
      if (d.length === 1) return [ev('set', { index: d[0], old: a[d[0]], value: b[d[0]] })];
      if (d.length === 2 && same(a[d[0]], b[d[1]]) && same(a[d[1]], b[d[0]])) return [ev('swap', { index: d[0], index2: d[1] })];
      return [ev('change')];
    }
    let k = 0; while (k < Math.min(a.length, b.length) && same(a[k], b[k])) k++;
    if (b.length === a.length + 1 && same(a.slice(k), b.slice(k + 1))) return [ev('insert', { index: k, value: b[k] })];
    if (b.length === a.length - 1 && same(a.slice(k + 1), b.slice(k))) return [ev('remove', { index: k, value: a[k] })];
    return [ev('change')];
  }
  function snapshot(interp) {
    const out = {};
    for (const k of Object.keys(cur.info.slots)) { const b = cur.bindings[k]; out[k] = b ? cellValue(cellOf(interp, b)) : undefined; }
    return out;
  }
  const forFrame = (vals) => { const o = {}; for (const k of Object.keys(vals)) o[k] = vals[k] === undefined ? null : vals[k]; return o; };

  /* ------------------------------ messages with the iframe ------------------------------ */
  function send(msg, wait) {
    if (!cur || !cur.frame.contentWindow) return null;
    const id = ++seq;
    cur.frame.contentWindow.postMessage(Object.assign({ id }, msg), '*');
    if (!wait) return null;
    // the program waits for the end of the animation (at most 15 s at 1×: then it goes on and the stage reports it)
    return new Promise((resolve) => {
      // (the limit grows when the animations are slowed down)
      const t = setTimeout(() => { cur && cur.pending.delete(id); note(L('stage.animationTooLong'), 'err'); resolve(); }, 15000 / Math.min(1, cur.speed || 1));
      cur.pending.set(id, () => { clearTimeout(t); resolve(); });
    });
  }
  function onMessage(e) {
    if (!cur || e.source !== cur.frame.contentWindow) return;
    const m = e.data || {};
    if (!m[NS_ID]) return;
    if (m.type === 'done') { const f = cur.pending.get(m.id); if (f) { cur.pending.delete(m.id); f(); } return; }
    if (m.type === 'error') { note(m.msg === 'load' ? L('stage.cannotLoad') : L('stage.errorOfTheStage', { msg: m.msg }), 'err'); if (!cur.ready) clearTimeout(cur.loadTimer); return; }
    if (m.type === 'log') { console.log('[stage]', m.msg); return; }
    if (m.type === 'ready') {
      clearTimeout(cur.loadTimer);
      cur.ready = true; cur.info = m.info;
      // the bindings are those of the program; a stage just linked takes those written in its file
      if (!Object.keys(cur.bindings).length && m.bindings) Object.assign(cur.bindings, m.bindings);
      if (cur.info.name && names.get(cur.entry.file) !== cur.info.name) { names.set(cur.entry.file, cur.info.name); fillSelect(); }
      if (win) win.classList.add('stage-ready');
      note('');
      send({ type: 'speed', value: cur.speed });
      reset();
      if (missing().length) bindDialog();
    }
  }
  function note(text, kind) { if (!win) return; win.msg.textContent = text || ''; win.msg.hidden = !text; win.msg.className = 'stage-msg' + (kind ? ' ' + kind : ''); }

  /* ------------------------------ hook into the execution ------------------------------ */
  const hook = {
    /* a new execution: the stage starts again from the values (none yet) */
    start(interp) { cur.interp = interp; reset(); },
    /* after each step: the changes of the bound variables become events, and the program waits for the animation */
    step(frame) {
      if (!cur || !cur.ready || !cur.interp) return null;
      // inside the methods of a module (ArrayList.add…) the intermediate states are not seen: only the result
      if (frame && frame.func && M.isModuleFunc(cur.interp.prog, frame.func)) return null;
      const now = snapshot(cur.interp), events = [];
      for (const k of Object.keys(now)) if (!same(now[k], cur.snap[k]) && !(now[k] === undefined && cur.snap[k] === undefined)) events.push(...diff(k, cur.snap[k], now[k]));
      cur.snap = now;
      if (!events.length) return null;
      return send({ type: 'update', events, values: forFrame(now) }, true);
    },
    stop() { send({ type: 'stop' }); for (const f of cur.pending.values()) f(); cur.pending.clear(); },
  };
  function reset() {
    if (!cur || !cur.ready) return;
    cur.snap = cur.interp ? snapshot(cur.interp) : {};
    send({ type: 'reset', values: forFrame(cur.snap), bound: Object.keys(cur.info.slots).filter((k) => cur.bindings[k]) });
  }

  /* ------------------------------ window ------------------------------ */
  const ICONS = {
    bind: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.5 9.5l3-3M5 7.5L3.8 8.7a2.3 2.3 0 0 0 3.3 3.3L8.3 10.8M11 8.5l1.2-1.2a2.3 2.3 0 0 0-3.3-3.3L7.7 5.2"/></svg>',
    save: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v8M4.8 7.5L8 10.7l3.2-3.2M3 13.5h10"/></svg>',
    unlink: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M5 7.5L3.8 8.7a2.3 2.3 0 0 0 3.3 3.3L8.3 10.8M11 8.5l1.2-1.2a2.3 2.3 0 0 0-3.3-3.3L7.7 5.2M2.5 2.5l11 11"/></svg>',
  };
  const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
  const list = () => { const s = host.stages(); return s && s.list.length ? s : null; };
  /* the name of a stage: the one it declares (read from its text, if already at hand, without running it), or its file */
  function label(x) {
    if (!names.has(x.file)) {
      const t = host.peek(x), n = t && staticName(t);
      if (n) names.set(x.file, n);
    }
    return names.get(x.file) || decodeURIComponent(String(x.file).split(/[?#]/)[0].split('/').pop()).replace(/\.flstage$/i, '');
  }
  /* the name declared by a stage, read from its text without running it: name: '…' or name: { it: '…', en: '…' } */
  function staticName(t) {
    const m = /export\s+default\s*\{[\s\S]*?\bname\s*:\s*(?:(['"`])((?:(?!\1).)*)\1|\{([^}]*)\})/.exec(t);
    if (!m) return '';
    if (m[2] != null) return m[2];
    const pick = (lang) => { const r = new RegExp('\\b' + lang + '\\s*:\\s*([\'"`])((?:(?!\\1).)*)\\1').exec(m[3]); return r ? r[2] : ''; };
    return pick(host.lang) || pick('en') || (/(['"`])((?:(?!\1).)*)\1/.exec(m[3]) || [])[2] || '';
  }
  /* the window of the program's stages: the title bar has the choice of the active stage, the speed of the animations,
     the bindings, the download of the stage, the unlinking and the collapse (which unloads the stage) */
  function mount() {
    const s = list();
    if (!s) { unmount(); return; }
    if (!win) build();
    s.active = Math.max(0, Math.min(s.list.length - 1, s.active || 0));
    fillSelect();
    win.classList.toggle('min', !!s.collapsed);
    win.minBtn.title = s.collapsed ? L('ui.restoreTheWindow') : L('ui.collapseToTheTitleBar');
    win.minBtn.setAttribute('aria-label', win.minBtn.title);
    win.minBtn.setAttribute('aria-expanded', String(!s.collapsed));
    if (s.collapsed) unload(); else load();
  }
  function keepPlace() {
    if (!win) return;
    const r = { left: win.offsetLeft, top: win.offsetTop, width: parseFloat(win.style.width) || win.offsetWidth, height: parseFloat(win.style.height) || win.offsetHeight };
    host.store.set('stageWin', r);
  }
  function unmount() {
    keepPlace();
    unload();
    if (win) { win.remove(); win = null; }
  }
  function fillSelect() {
    const s = list(); if (!s || !win) return;
    win.sel.replaceChildren(...s.list.map((x, i) => h('option', { value: String(i) }, label(x))));
    win.sel.value = String(s.active);
    win.sel.title = s.list[s.active].file;
  }
  function build() {
    let si = +(host.store.get('stageSpeed', 3)); if (!(si >= 0 && si < SPEEDS.length)) si = 3;
    const speedLbl = h('span', { class: 'stage-speedval' }, SPEEDS[si] + '×');
    const speed = h('input', { type: 'range', min: 0, max: SPEEDS.length - 1, step: 1, value: si, class: 'stage-speed', 'aria-label': L('stage.speedOfTheAnimations'), title: L('stage.speedOfTheAnimations') });
    speed.addEventListener('input', () => { const v = SPEEDS[+speed.value]; speedLbl.textContent = v + '×'; host.store.set('stageSpeed', +speed.value); if (cur) { cur.speed = v; send({ type: 'speed', value: v }); } });
    const btn = (lbl, icon, fn, cls) => h('button', { class: 'iconbtn' + (cls ? ' ' + cls : ''), type: 'button', title: lbl, 'aria-label': lbl, html: icon, onclick: fn });
    const sel = h('select', { class: 'stage-sel', 'aria-label': L('stage.activeStage') });
    sel.addEventListener('change', () => { const s = list(); if (!s) return; s.active = +sel.value; host.changed('active'); mount(); });
    const minBtn = btn(L('ui.collapseToTheTitleBar'), host.ICON_MIN, () => { const s = list(); if (!s) return; s.collapsed = !s.collapsed; host.changed('collapsed'); mount(); }, 'minbtn');
    const msg = h('div', { class: 'stage-msg', hidden: true });
    const body = h('div', { class: 'fwin-body stage-body' }, msg);
    win = h('div', { class: 'fwin stagewin', role: 'dialog', 'aria-label': L('stage.stage') },
      h('div', { class: 'fwin-head' }, h('span', { class: 'stage-ico', 'aria-hidden': 'true', html: host.ICON }), sel, h('span', { class: 'grow' }),
        h('span', { class: 'stage-speedbox stage-live' }, speed, speedLbl),
        btn(L('stage.bindTheVariables'), ICONS.bind, () => bindDialog(), 'stage-live'),
        btn(L('stage.saveTheStage'), ICONS.save, () => save(), 'stage-live'),
        btn(L('stage.unlinkTheStage'), ICONS.unlink, () => unlink()),
        minBtn),
      body);
    Object.assign(win, { sel, minBtn, msg, body, speed });
    const hostEl = host.winHost();
    // where it was last time, or at the top right of the diagram
    const area = host.area(), W = Math.min(640, area.width - 40), H = Math.round(W * 450 / 800) + 40;
    const was = host.store.get('stageWin', null), fits = was && was.left >= 0 && was.top >= 0 && was.left < hostEl.clientWidth - 80 && was.top < hostEl.clientHeight - 40;
    Object.assign(win.style, fits ? { left: was.left + 'px', top: was.top + 'px', width: was.width + 'px', height: was.height + 'px' } : { left: Math.max(10, area.right - W - 16) + 'px', top: (area.top + 12) + 'px', width: W + 'px', height: H + 'px' });
    win.style.zIndex = host.nextZ();
    hostEl.append(win);
    win.addEventListener('pointerdown', () => { win.style.zIndex = host.nextZ(); }, true);
    const head = win.querySelector('.fwin-head');
    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button, input, select')) return;
      e.preventDefault(); head.setPointerCapture(e.pointerId);
      const sx = e.clientX, sy = e.clientY, ox = win.offsetLeft, oy = win.offsetTop, w = win;
      w.classList.add('moving');
      const mv = (ev) => { w.style.left = Math.max(0, Math.min(ox + ev.clientX - sx, hostEl.clientWidth - 60)) + 'px'; w.style.top = Math.max(0, Math.min(oy + ev.clientY - sy, hostEl.clientHeight - 30)) + 'px'; };
      const up = () => { head.removeEventListener('pointermove', mv); head.removeEventListener('pointerup', up); head.removeEventListener('pointercancel', up); w.classList.remove('moving'); keepPlace(); };
      head.addEventListener('pointermove', mv); head.addEventListener('pointerup', up); head.addEventListener('pointercancel', up);
    });
  }
  /* loads the active stage in the iframe (its text from the program's folder, from its address or from the files chosen) */
  async function load() {
    const s = list(); if (!s || !win) return;
    const x = s.list[s.active], my = ++token;
    unload();
    win.classList.remove('stage-ready');
    note(L('stage.loading'));
    let r;
    try { r = await host.resolve(x); } catch (e) { r = { error: e.message }; }
    if (my !== token || !win || list() !== s || s.list[s.active] !== x || s.collapsed) return;
    if (!r || r.missing) { missingNote(x); return; }
    if (r.error) { note(L('stage.cannotDownload', { msg: r.error }), 'err'); return; }
    run(r.text, x);
  }
  function missingNote(x) {
    note('');
    const pick = h('button', { class: 'btn small', type: 'button', onclick: () => host.pickFiles().then((added) => { if (added) mount(); }) }, L('stage.chooseTheFiles'));
    const box = h('div', { class: 'stage-missing' }, h('p', null, L('stage.missingFile', { file: x.file })), h('p', { class: 'muted small' }, L('stage.sameFolder')), pick);
    win.body.querySelectorAll('.stage-missing').forEach((n) => n.remove());
    win.body.append(box);
  }
  /* the stage runs: iframe, messages, hook into the execution */
  function run(text, x) {
    const frame = h('iframe', { class: 'stage-frame', sandbox: 'allow-scripts', title: L('stage.stage'), referrerpolicy: 'no-referrer' });
    win.body.prepend(frame);
    const v = SPEEDS[+win.speed.value];
    cur = { text, entry: x, fileName: /^https?:/i.test(x.file) ? label(x) + '.flstage' : x.file, frame, info: { slots: {} }, bindings: x.bind || (x.bind = {}), ready: false, pending: new Map(), snap: {}, speed: v, interp: host.interp() };
    window.addEventListener('message', onMessage);
    cur.loadTimer = setTimeout(() => { if (cur && !cur.ready) note(L('stage.cannotLoad'), 'err'); }, 20000);
    frame.srcdoc = srcdoc(text);
    host.setHook(hook);
  }
  /* the stage stops: no iframe, no hook (the execution goes back to exactly what it is without the stage) */
  function unload() {
    if (win) win.body.querySelectorAll('.stage-missing').forEach((n) => n.remove());
    if (!cur) return;
    hook.stop();
    window.removeEventListener('message', onMessage);
    clearTimeout(cur.loadTimer);
    cur.frame.remove();
    cur = null;
    if (win) win.classList.remove('stage-ready');
    host.setHook(null);
  }
  function unlink() {
    const s = list(); if (!s) return;
    s.list.splice(s.active, 1);
    s.active = Math.min(s.active, s.list.length - 1);
    host.changed('list');
    mount();
  }
  /* ------------------------------ bindings ------------------------------ */
  function bindDialog() {
    if (!cur || !cur.ready) return;
    const vars = variables(), rows = [], sels = {};
    const entries = Object.entries(cur.info.slots);
    if (!entries.length) { host.toast(L('stage.noSlots')); return; }
    for (const [k, s] of entries) {
      const ok = vars.filter((v) => compatible(s, v));
      const sel = h('select', { id: 'stage_b_' + k });
      if (s.optional || !ok.length) sel.append(h('option', { value: '' }, s.optional ? L('stage.none') : L('stage.noVariableOfThisType')));
      for (const v of ok) sel.append(h('option', { value: v.id }, `${v.name} — ${v.where}`));
      const was = ok.find((v) => v.id.toLowerCase() === String(cur.bindings[k] || '').toLowerCase());
      // without a valid choice: the variable with the same name as before, or the only one possible
      const prevName = String(cur.bindings[k] || '').split('.').pop().toLowerCase();
      const guess = was || ok.find((v) => v.name.toLowerCase() === prevName) || (ok.length === 1 || !s.optional ? ok[0] : null);
      sel.value = guess ? guess.id : '';
      sels[k] = sel;
      rows.push(h('div', { class: 'field' },
        h('label', { class: 'flabel', for: 'stage_b_' + k }, `${s.label || k} `, h('span', { class: 'muted small mono' }, `(${k}: ${s.type}${s.optional ? ', ' + L('stage.optional') : ''})`)),
        sel));
    }
    host.openModal({
      title: L('stage.bindTheVariablesOf', { name: cur.info.name || cur.fileName }),
      body: h('div', { class: 'fields' }, h('p', { class: 'help' }, cur.info.description || L('stage.chooseTheVariables')), ...rows),
      okText: L('stage.bind'),
      onOk: () => {
        for (const [k, s] of entries) if (!sels[k].value && !s.optional) return L('stage.chooseAVariableFor', { name: s.label || k });
        for (const k of Object.keys(sels)) { if (sels[k].value) cur.bindings[k] = sels[k].value; else delete cur.bindings[k]; }
        host.changed('bind');
        cur.interp = host.interp();
        reset();
        return true;
      },
    });
  }
  /* the bindings written in the file: the line export const bindings = {…}; (added at the top if missing) */
  function withBindings(text, b) {
    const line = `export const bindings = ${JSON.stringify(b)};`;
    const re = /^[ \t]*export\s+const\s+bindings\s*=\s*\{[\s\S]*?\}\s*;?[ \t]*$/m;
    return re.test(text) ? text.replace(re, line) : line + '\n' + text;
  }
  function save() {
    if (!cur) return;
    const a = h('a', { href: URL.createObjectURL(new Blob([withBindings(cur.text, cur.bindings)], { type: 'text/javascript' })), download: /\.flstage$/i.test(cur.fileName) ? cur.fileName : cur.fileName.replace(/\.\w+$/, '') + '.flstage' });
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  return {
    mount, unmount, bindDialog, save,
    isOpen: () => !!cur,
    info: () => (cur ? { name: cur.info.name, bindings: Object.assign({}, cur.bindings), ready: cur.ready, text: cur.text, file: cur.entry.file } : null),
  };
};
