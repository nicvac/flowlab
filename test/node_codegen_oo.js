// Codice generato per i programmi a oggetti: scrive i sorgenti e, con "run", li compila e li esegue
const M = require('../src/model.js'), C = require('../src/codegen.js'), { Interpreter } = require('../src/interp.js');
const P = require('./oo_progs.js');
const fs = require('fs'), cp = require('child_process'), path = require('path');
const progs = { punto: P.punto(), forme: P.forme(), lista: P.lista(), vettore: P.vettore(), getter: P.getter() };
// anche gli esempi a oggetti dell'applicazione
global.ExprLib = require('../src/expr.js'); global.ModelLib = M;
const Examples = eval(fs.readFileSync(path.join(__dirname, '../src/examples.js'), 'utf8') + ';Examples');
for (const ex of Examples.list) { const p = ex.make(); if (M.hasClasses(p)) progs['es_' + ex.id] = p; }
const dir = 'test/out/oo'; fs.mkdirSync(dir, { recursive: true });
function interp(prog) {
  let out = '';
  const g = new Interpreter(prog, { output: (t, nl) => { out += t + (nl ? '\n' : ''); }, eof: () => true }).run();
  for (let r = g.next(); !r.done; r = g.next());
  return out;
}
const sh = (c, cwd) => { try { return cp.execSync(c, { cwd, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }).toString(); } catch (e) { return 'ERRORE: ' + (e.stderr || e.stdout || e.message).toString().slice(0, 1500); } };
const only = process.argv[3];
let bad = 0;
for (const [name, prog] of Object.entries(progs)) {
  const want = interp(prog);
  for (const lang of Object.keys(C.LANGS)) {
    if (only && lang !== only) continue;
    const code = C.generate(prog, lang);
    const main = M.mainClass(prog).name;
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
