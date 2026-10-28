// Programmazione a oggetti: interprete, salvataggio .fprg esteso e ricarica
const { JSDOM } = (() => { try { return require('jsdom'); } catch (e) { return {}; } })();
if (JSDOM) global.DOMParser = new JSDOM('').window.DOMParser;
const M = require('../src/model.js'), { Interpreter } = require('../src/interp.js');
const S = M.makeStmt;
const A = (o) => M.makeAttribute(o);

function run(prog, inputs = []) {
  let out = '';
  const env = { output: (t, nl) => { out += t + (nl ? '\n' : ''); }, eof: () => true, fileOpen() {}, fileClose() {}, fileRead() {}, fileWrite() {} };
  const g = new Interpreter(prog, env).run(); let r = g.next();
  try { while (!r.done) r = r.value.type === 'input' ? g.next(inputs.shift()) : g.next(); } catch (e) { out += 'ERR: ' + e.message + '\n'; }
  return out;
}
const { oo, punto, forme: formeP, lista: listaP, out, set, decl, call } = require('./oo_progs.js');
const forme = formeP(), lista = listaP();
const results = [];
const check = (name, got, want) => { const ok = got.trim() === want.trim(); results.push(ok); console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : `\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`)); };

// 1. incapsulamento, costruttori multipli, attributo statico
check('incapsulamento e costruttori', run(punto()), '(4, 6) (0, 0) creati: 2\nfalse\ntrue');

// accesso a un attributo privato da fuori
{ const p = punto(); p.functions[0].body.push(out('p.x')); check('privato da fuori', run(p).split('\n').slice(-2)[0], 'ERR: L\'attributo "x" di Punto è privato: si può usare solo dentro la classe Punto'); }
// costruttore inesistente
{ const p = punto(); p.functions[0].body.unshift(decl('z', 'Punto'), set('z', 'new Punto(1)')); check('costruttore con argomenti sbagliati', run(p), 'ERR: Punto non ha un costruttore con 1 argomento. Costruttori disponibili: Punto(Intero, Intero) · Punto()'); }
// null
{ const p = punto(); p.functions[0].body = [decl('z', 'Punto'), set('z', 'null'), call('z.sposta(1, 1)')]; check('null', run(p), 'ERR: "z" vale null: non indica nessun oggetto (crealo con new)'); }

// 2. ereditarietà, protetto, super, override, polimorfismo in un array
check('ereditarietà e polimorfismo', run(forme), 'cerchio: area 3.14\n[rettangolo: area 6.00]\ngenerica: area 0.00');
// super non al primo posto
{ const p = JSON.parse(JSON.stringify(forme)); const c = p.functions.find((f) => f.ctor && f.name === 'Cerchio'); c.body = [set('this.r', 'r'), call('super(n)')]; check('costruttore senza super quando serve', run(p), 'ERR: Il costruttore di Cerchio deve iniziare con un blocco Chiamata super(...): Forma non ha un costruttore senza parametri'); }
// protetto da fuori
{ const p = JSON.parse(JSON.stringify(forme)); p.functions[0].body.push(out('forme[0].nome')); check('protetto da fuori', run(p).split('\n').slice(-2)[0], 'ERR: L\'attributo "nome" di Forma è protetto: si può usare solo in Forma e nelle sue sottoclassi'); }
// tipo incompatibile
{ const p = JSON.parse(JSON.stringify(forme)); p.functions[0].body = [decl('c', 'Cerchio'), set('c', 'new Rettangolo(1, 1)')]; check('sottoclasse sbagliata', run(p), 'ERR: Tipi incompatibili: il valore assegnato a "c" è un oggetto Rettangolo, che non è un Cerchio'); }

// 3. associazione: lista collegata, metodo statico, overloading di metodi
check('lista collegata, statici, overloading', run(lista), '4 nodi: 40 30 20 10 · 40-30-20-10');
// metodo d'istanza chiamato da statico senza oggetto
{ const p = punto(); const f = p.functions.find((x) => x.name === 'descrivi'); p.functions.push(M.makeFunction('stat', { cls: f.cls, static: true, visibility: 'public', body: [call('sposta(1, 1)')] })); p.functions[0].body = [call('Punto.stat()')]; check('istanza da statico', run(p), 'ERR: Da un metodo statico non si può chiamare il metodo d\'istanza sposta senza un oggetto'); }

// 4. salvataggio e ricarica del formato esteso
if (JSDOM) {
  for (const [nm, p] of [['punto', punto()], ['forme', forme], ['lista', lista]]) {
    const xml = M.serializeFprg(p);
    const back = M.parseFprg(xml);
    check('ricarica ' + nm, run(back), run(p));
    check('stesso XML ' + nm, M.serializeFprg(back).replace(/saved" value="[^"]*"|edited" value="[^"]*"|created" value="[^"]*"/g, ''), xml.replace(/saved" value="[^"]*"|edited" value="[^"]*"|created" value="[^"]*"/g, ''));
  }
  // classe banale: file standard
  const p = M.newProgram(); p.functions[0].body = [out('"ciao"')]; M.wrapInClass(p);
  const xml = M.serializeFprg(p);
  check('classe banale = formato standard', String(/flowlab/.test(xml)) + ' ' + M.extendedFeatures(p).length, 'false 0');
  console.log('funzionalità estese:', M.extendedFeatures(forme).join(', '));
} else console.log('(jsdom non disponibile: salto i test sul formato)');

console.log(results.every(Boolean) ? 'TUTTI OK' : 'CI SONO ERRORI');
