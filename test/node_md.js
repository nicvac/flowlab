// array a più dimensioni: interprete e codice generato
global.ModelLib = require('../src/model.js'); global.ExprLib = require('../src/expr.js');
const { Interpreter } = require('../src/interp.js'); const C = require('../src/codegen.js'); const fs = require('fs');
const M = ModelLib, S = M.makeStmt;
const run = (p) => { let out = ''; const env = { output: (t, nl) => { out += t + (nl ? '\n' : ''); }, eof: () => true }; const g = new Interpreter(p, env).run(); try { for (let r = g.next(); !r.done; r = g.next()); } catch (e) { out += 'ERRORE: ' + e.message + '\n'; } return out.trim(); };
const p = M.newProgram();
p.functions[0].body = [
  S('declare', { name: 'm', type: 'Integer', array: true, size: '3, 4' }),
  S('declare', { name: 'c', type: 'Integer', array: true, size: '2, 3, 4' }),
  S('declare', { name: 'i, j, k', type: 'Integer' }),
  S('for', { variable: 'i', start: '0', end: 'Size(m) - 1', body: [S('for', { variable: 'j', start: '0', end: 'Size(m, 1) - 1', body: [S('assign', { variable: 'm[i, j]', expression: 'i * 10 + j' })] })] }),
  S('for', { variable: 'i', start: '0', end: 'Size(c, 0) - 1', body: [S('for', { variable: 'j', start: '0', end: 'Size(c, 1) - 1', body: [S('for', { variable: 'k', start: '0', end: 'Size(c, 2) - 1', body: [S('assign', { variable: 'c[i][j][k]', expression: 'i * 100 + j * 10 + k' })] })] })] }),
  S('output', { expression: '"m[2, 3] = " & m[2][3] & ", somma riga 1 = " & SommaRiga(m, 1) & ", c[1, 2, 3] = " & c[1, 2, 3] & ", dim c = " & Size(c) & "x" & Size(c, 1) & "x" & Size(c, 2)' }),
];
const f = M.makeFunction('SommaRiga', { params: [{ name: 'a', type: 'Integer', array: true, dims: 2 }, { name: 'r', type: 'Integer', array: false }], body: [S('declare', { name: 's, j', type: 'Integer' }), S('assign', { variable: 's', expression: '0' }), S('for', { variable: 'j', start: '0', end: 'Size(a, 1) - 1', body: [S('assign', { variable: 's', expression: 's + a[r, j]' })] })] });
M.setRets(f, [{ name: 's', type: 'Integer' }]); p.functions.push(f);
console.log('esecuzione:', run(p));
const bad = (expr) => { const q = JSON.parse(JSON.stringify(p)); q.functions[0].body.push(S('output', { expression: expr })); return run(q).split('\n').pop(); };
console.log(bad('m[1]')); console.log(bad('m[3, 0]')); console.log(bad('Size(m, 2)'));
console.log('estensioni:', M.extendedFeatures(p));
fs.mkdirSync(__dirname + '/out', { recursive: true });
for (const l of Object.keys(C.LANGS)) fs.writeFileSync(__dirname + '/out/md.' + C.LANGS[l].ext, C.generate(p, l));
