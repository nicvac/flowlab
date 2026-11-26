// Codice generato per i programmi a oggetti: scrive i sorgenti e, con "run", li compila e li esegue
const M = require('../src/model.js'), C = require('../src/codegen.js'), { Interpreter } = require('../src/interp.js');
const P = require('./oo_progs.js');
const fs = require('fs'), cp = require('child_process'), path = require('path');
const progs = { geninh: require('./gen_progs.js').geninh(), punto: P.punto(), forme: P.forme(), lista: P.lista(), vettore: P.vettore(), getter: P.getter(), tostring: P.tostring(), moduli: P.moduli() };
// funzioni generiche (programma a funzioni e a oggetti)
const G = require('./gen_progs.js');
Object.assign(progs, { gen_fun: G.genfun(), gen_oo: G.genoo(), arr_ret: G.arrret() });
// eccezioni (vista Funzioni e vista Oggetti)
const X = require('./exc_progs.js');
Object.assign(progs, { exc_fun: X.excfun(), exc_oo: X.excoo() });
// xor operator: precedence with or, and, not and comparisons, in every language
{
  const S = M.makeStmt, p = M.newProgram();
  const exprs = ['a xor b', 'a xor c', 'not a xor b', 'a or b xor c', 'a and b xor c', 'b xor c and a', 'x < 3 xor x > 1', '(a xor b) xor c', 'a xor (b xor c)', 'not (a xor c)', 'a xor b = c', 'a ⊕ c', '(6 xor 3) = 5', '(x xor 7) + 1 = 6', '(x * 3 xor 1) = 7', '(-6 xor 3) = -7'];
  p.functions[0].body = [S('declare', { name: 'a, b, c', type: 'Boolean' }), S('declare', { name: 'x', type: 'Integer' }),
    S('assign', { variable: 'a', expression: 'true' }), S('assign', { variable: 'b', expression: 'false' }), S('assign', { variable: 'c', expression: 'true' }), S('assign', { variable: 'x', expression: '2' }),
    ...exprs.map((e) => S('if', { expression: e, then: [S('output', { expression: '"1"', newline: false })], else: [S('output', { expression: '"0"', newline: false })] })),
    S('output', { expression: '""' }), S('output', { expression: '12 xor 10' }), S('output', { expression: 'x xor 2' }), S('output', { expression: 'a xor b' }), S('output', { expression: '"v: " & (a xor c) & " " & (5 xor 1)' })];
  progs.xor_ops = p;
}
// arrays with their initial values {…}, also with more dimensions and without the size
{
  const S = M.makeStmt, p = M.newProgram();
  p.functions[0].body = [
    S('declare', { name: 'x', type: 'Integer', init: '5' }),
    S('declare', { name: 'v', type: 'Integer', array: true, size: '', init: '{3, 1, x + 1}' }),
    S('declare', { name: 'm', type: 'Integer', array: true, size: '2, 3', init: '{{1, 2, 3}, {4, 5, 6}}' }),
    S('declare', { name: 'r', type: 'Real', array: true, size: '', init: '{1, 2.5}' }),
    S('declare', { name: 'nomi', type: 'String', array: true, size: '', init: '{"Ada", "Alan"}' }),
    S('declare', { name: 'i, t', type: 'Integer' }), S('assign', { variable: 't', expression: '0' }),
    S('for', { variable: 'i', start: '0', end: 'Size(v) - 1', direction: 'inc', step: '1', body: [S('assign', { variable: 't', expression: 't + v[i]' })] }),
    S('output', { expression: '"v: " & t & " " & Size(v)' }),
    S('output', { expression: '"m: " & m[1, 2] & " " & m[0, 1] & " " & Size(m, 0) & "x" & Size(m, 1)' }),
    S('output', { expression: '"r: " & (r[0] + r[1])' }),
    S('output', { expression: 'nomi[1] & " e " & nomi[0]' }),
  ];
  progs.arr_init = p;
}
// anche gli esempi a oggetti dell'applicazione
global.ExprLib = require('../src/expr.js'); global.ModelLib = M;
const Examples = require('./examples_node.js');
for (const ex of Examples.list) { const p = ex.make(); if (M.hasClasses(p)) progs['es_' + ex.id] = p; }
// moduli della libreria: classi generiche scritte nel codice (mod_) e, importate, classi native del linguaggio (nat_)
const { MODULES } = require('../tools/modules.js');
for (const m of MODULES) {
  progs['mod_' + m.id] = m.make();
  const p = m.make();
  if (M.hasClasses(p)) { const mc = M.mainClass(p); for (const c of p.classes) if (c !== mc) c.module = { name: m.id, src: `lib:${m.topic}/${m.id}` }; }
  else for (const f of p.functions.slice(1)) f.module = { name: m.id, src: `lib:${m.topic}/${m.id}` };
  progs['nat_' + m.id] = p;
  // module with only functions imported into a program with classes: functions outside the classes, called from the Main
  if (!M.hasClasses(p)) { const q = m.make(); for (const f of q.functions.slice(1)) f.module = { name: m.id, src: `lib:${m.topic}/${m.id}` }; M.wrapInClass(q); progs['oo_' + m.id] = q; }
}
const dir = 'test/out/oo'; fs.mkdirSync(dir, { recursive: true });
function interp(prog) {
  let out = '';
  const g = new Interpreter(prog, { output: (t, nl) => { out += t + (nl ? '\n' : ''); }, eof: () => true }).run();
  for (let r = g.next(); !r.done; r = g.next());
  return out;
}
const sh = (c, cwd) => { try { return cp.execSync(c, { cwd, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }).toString(); } catch (e) { return 'ERRORE: ' + (e.stderr || e.stdout || e.message).toString().slice(0, 1500); } };
const only = process.argv[3], onlyProg = process.argv[4] ? new RegExp(process.argv[4]) : null;
let bad = 0;
for (const [name, prog] of Object.entries(progs)) {
  if (onlyProg && !onlyProg.test(name)) continue;
  const want = interp(prog);
  for (const lang of Object.keys(C.LANGS)) {
    if (only && lang !== only) continue;
    const code = C.generate(prog, lang);
    const main = M.hasClasses(prog) ? M.mainClass(prog).name : 'Main';
    const d = path.join(dir, name, lang); fs.mkdirSync(d, { recursive: true });
    const file = lang === 'java' ? main + '.java' : 'prog.' + C.LANGS[lang].ext;
    fs.writeFileSync(path.join(d, file), code);
    if (process.argv[2] === 'show') console.log(`==== ${name} ${lang}\n${code}`);
    if (process.argv[2] !== 'run') continue;
    let got = null;
    if (lang === 'python') got = sh('python3 prog.py', d);
    if (lang === 'javascript') got = sh('node -e "global.prompt=()=>\'\';require(\'./prog.js\')"', d);
    if (lang === 'java') got = sh(`javac -encoding UTF-8 ${main}.java && java -Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 ${main}`, d);
    if (lang === 'cpp') got = sh('g++ -std=c++11 -Wall -o prog prog.cpp 2>&1 | grep -E "error|warning" | head -5; ./prog', d);
    if (got === null) continue;
    // Java/Python/JS stampano i numeri reali a modo loro: si confronta il testo
    if (lang === 'python') got = got.replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false');
    const ok = got.trim() === want.trim();
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${lang}${ok ? '' : '\n--- atteso\n' + want + '--- ottenuto\n' + got}`);
  }
}
console.log(bad ? `${bad} differenze` : 'tutto uguale all\'interprete');
