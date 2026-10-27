// esegue e genera codice per l'esempio "minmax" in Node (DOM non necessario)
global.ModelLib = require('../src/model.js'); global.ExprLib = require('../src/expr.js');
const fs = require('fs'), vm = require('vm');
vm.runInThisContext(fs.readFileSync(__dirname + '/../src/examples.js', 'utf8').replace("'use strict';", '') + '\nglobalThis.Examples = Examples;');
const { Interpreter } = require('../src/interp.js'); const C = require('../src/codegen.js');
const M = ModelLib, E = ExprLib;
const p = Examples.get('minmax').make();
let out = ''; const env = { output: (t, nl) => { out += t + (nl ? '\n' : ''); }, eof: () => true, fileOpen() {}, fileClose() {}, fileRead() {}, fileWrite() {} };
const run = (prog) => { out = ''; const g = new Interpreter(prog, env).run(); try { for (let r = g.next(); !r.done; r = g.next()); } catch (e) { out += 'ERRORE: ' + e.message + '\n'; } return out; };
Math.random = (() => { let s = 7; return () => (s = (s * 9301 + 49297) % 233280) / 233280; })();
console.log(run(p));
// errori attesi
const S = M.makeStmt;
const bad = (variable, expression) => { const q = JSON.parse(JSON.stringify(p)); q.functions[0].body.splice(5, 1, S('assign', { variable, expression })); return run(q).split('\n').find((l) => l.startsWith('ERRORE')); };
console.log(bad('min, max', 'calcolaMassimoEMinimo(V, N)'));
console.log(bad('min', 'calcolaMassimoEMinimo(V, N)'));
console.log(bad('min, max', 'min + 1'));
console.log(bad('min, min, idxMin, idxMax', 'calcolaMassimoEMinimo(V, N)'));
fs.mkdirSync(__dirname + '/out', { recursive: true });
for (const l of Object.keys(C.LANGS)) fs.writeFileSync(__dirname + '/out/minmax.' + C.LANGS[l].ext, C.generate(p, l));
