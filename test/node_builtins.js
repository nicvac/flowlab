// The predefined functions Min, Max, Pow, Round, Floor, Ceil and the escape sequences of the strings (\n, \t, \\, \", \'):
// the interpreter and the code of each language print the same text
const fs = require('fs'), path = require('path'), cp = require('child_process');
process.env.FLOWLAB_LANG = process.env.FLOWLAB_LANG || 'en';
const M = require('../src/model.js'), C = require('../src/codegen.js'), E = require('../src/expr.js'), { Interpreter } = require('../src/interp.js');
let JSDOM = null; try { ({ JSDOM } = require('jsdom')); } catch (e) { /* without jsdom the reload of the .fprg is skipped */ }
if (typeof DOMParser === 'undefined' && JSDOM) global.DOMParser = new JSDOM('').window.DOMParser;
const S = M.makeStmt;
let bad = 0;
const ok = (name, cond, extra) => { if (!cond) bad++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond || !extra ? '' : '\n' + extra}`); };
const p = M.newProgram();
p.functions[0].body = [
  S('declare', { name: 'i, j', type: 'Integer' }), S('declare', { name: 'r', type: 'Real' }),
  S('assign', { variable: 'i', expression: '7' }), S('assign', { variable: 'j', expression: '-3' }), S('assign', { variable: 'r', expression: '2.5' }),
  S('output', { expression: 'Min(i, j) & " " & Max(i, j, 12) & " " & Min(4, 9, 1, 6)' }),
  S('output', { expression: 'Pow(2, 10) & " " & Pow(i, 2) + 1 & " " & Pow(2, -1)' }),
  S('output', { expression: 'Round(r) & " " & Round(-r) & " " & Round(2.4) & " " & Floor(-2.3) & " " & Ceil(-2.7) & " " & Ceil(r) + Floor(r)' }),
  S('output', { expression: '"riga 1\\nriga 2"' }),
  S('output', { expression: '"a\\tb" & "|" & "c:\\\\dir" & " \\"q\\" " & \'it\\\'s\'' }),
  S('output', { expression: 'Len("a\\nb")' }),
  // a string written on two lines (Enter inside the string in the Output dialog)
  S('output', { expression: '"due\nrighe"' }),
];
// the values of the interpreter
let want = '';
const g = new Interpreter(p, { output: (t, nl) => { want += t + (nl ? '\n' : ''); }, eof: () => true }).run();
for (let r = g.next(); !r.done; r = g.next());
const expect = '-3 12 1\n1024 50 0.5\n3 -2 2 -3 -2 5\nriga 1\nriga 2\na\tb|c:\\dir "q" it\'s\n3\ndue\nrighe\n';
ok('interpreter', want === expect, JSON.stringify(want));
// the extended features: the new functions and the escapes are not in the standard format
const ext = M.extendedFeatures(p).join(' | ');
ok('extended features: ' + ext, /Min, Max/.test(ext) && /escape/.test(ext));
// the .fprg keeps the escapes as written; 'it\'s' becomes "it's"
const xml = M.serializeFprg(p);
ok('fprg: ' + (xml.match(/expression="&quot;a[^\n]*?"/) || [''])[0], xml.includes('&quot;a\\tb&quot;') && xml.includes('&quot;it\'s&quot;') && xml.includes('&quot;riga 1\\nriga 2&quot;'));
if (typeof DOMParser !== 'undefined') {
const back = M.parseFprg(xml); let again = '';
const g2 = new Interpreter(back, { output: (t, nl) => { again += t + (nl ? '\n' : ''); }, eof: () => true }).run();
for (let r = g2.next(); !r.done; r = g2.next());
ok('fprg reloaded runs the same', again === expect, JSON.stringify(again));
}
const sh = (c, cwd) => { try { return cp.execSync(c, { cwd, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }).toString(); } catch (e) { return 'ERROR: ' + (e.stderr || e.stdout || e.message).toString().slice(0, 1500); } };
const dir = 'test/out/builtins';
for (const lang of Object.keys(C.LANGS)) {
  const code = C.generate(p, lang);
  const d = path.join(dir, lang); fs.mkdirSync(d, { recursive: true });
  const file = lang === 'java' ? 'Main.java' : 'prog.' + C.LANGS[lang].ext;
  fs.writeFileSync(path.join(d, file), code);
  if (process.argv[2] === 'show') console.log(`==== ${lang}\n${code}`);
  let got = null;
  if (lang === 'python') got = sh('python3 prog.py', d);
  if (lang === 'javascript') got = sh('node -e "global.prompt=()=>\'\';require(\'./prog.js\')"', d);
  if (lang === 'java') got = sh('javac -encoding UTF-8 Main.java && java -Dfile.encoding=UTF-8 Main', d);
  if (lang === 'cpp') got = sh('g++ -std=c++11 -Wall -o prog prog.cpp 2>&1 | grep -E "error|warning" | head -5; ./prog', d);
  if (lang === 'pseudo') { ok('pseudo: ' + (code.match(/.*riga 1.*/) || [''])[0].trim(), code.includes('"riga 1\\nriga 2"') && /Min\(i, j\)/.test(code)); continue; }
  if (lang === 'csharp') { ok('csharp: ' + (code.match(/.*Math\.Max.*/) || [''])[0].trim(), code.includes('Math.Max(i, Math.Max(j, 12))') && code.includes('(int) Math.Ceiling(') && code.includes('"riga 1\\nriga 2"')); continue; }
  if (got === null) continue;
  ok(lang, got === expect, '--- expected\n' + expect + '--- got\n' + got);
}
console.log(bad ? `${bad} FAIL` : 'all ok');
