// Programmi con funzioni generiche usati dai test
const M = require('../src/model.js');
const { oo, out, set, decl, call } = require('./oo_progs.js');
const S = M.makeStmt;
const fn = (name, tparams, params, rets, body, extra) => {
  const f = M.makeFunction(name, Object.assign({ tparams, params: params.map(([n, t, a]) => ({ name: n, type: t, array: !!a })), body }, extra || {}));
  if (rets) M.setRets(f, rets.map(([n, t]) => ({ name: n, type: t })));
  return f;
};
const forI = (v, a, b, body) => S('for', { variable: v, start: a, end: b, direction: 'inc', step: '1', body });
const iff = (e, then, els) => S('if', { expression: e, then, else: els || [] });

/* funzioni generiche in un programma a funzioni */
function genfun() {
  const p = M.newProgram();
  p.attrs.name = 'Generiche';
  p.functions[0].body = [
    decl('vi', 'Integer', 5), decl('vr', 'Real', 3), decl('vs', 'String', 4), decl('i', 'Integer'),
    forI('i', '0', '4', [set('vi[i]', '(i * 3) mod 5')]),
    set('vr[0]', '1.5'), set('vr[1]', '-2.25'), set('vr[2]', '0.5'),
    set('vs[0]', '"pera"'), set('vs[1]', '"mela"'), set('vs[2]', '"uva"'), set('vs[3]', '"kiwi"'),
    out('"max interi: " & massimo(vi, 5)'),
    out('"max reali: " & massimo(vr, 3)'),
    out('"max stringhe: " & massimo(vs, 4)'),
    call('scambia(vs, 0, 3)'),
    out('vs[0] & " " & vs[3]'),
    out('"contiene uva: " & contiene(vs, 4, "uva") & ", contiene 7: " & contiene(vi, 5, 7)'),
    out('"minore: " & minore(3, 8) & " " & minore("zeta", "alfa") & " " & minore(2.5, -1.5)'),
  ];
  p.functions.push(
    fn('massimo', ['T'], [['v', 'T', true], ['n', 'Integer']], [['m', 'T']], [
      decl('m', 'T'), decl('i', 'Integer'), set('m', 'v[0]'),
      forI('i', '1', 'n - 1', [iff('v[i] > m', [set('m', 'v[i]')])]),
    ]),
    fn('scambia', ['T'], [['v', 'T', true], ['i', 'Integer'], ['j', 'Integer']], null, [
      decl('tmp', 'T'), set('tmp', 'v[i]'), set('v[i]', 'v[j]'), set('v[j]', 'tmp'),
    ]),
    fn('contiene', ['T'], [['v', 'T', true], ['n', 'Integer'], ['x', 'T']], [['trovato', 'Boolean']], [
      decl('trovato', 'Boolean'), decl('i', 'Integer'), set('trovato', 'false'),
      forI('i', '0', 'n - 1', [iff('v[i] = x', [set('trovato', 'true')])]),
    ]),
    fn('minore', ['T'], [['a', 'T'], ['b', 'T']], [['r', 'T']], [
      decl('r', 'T'), iff('a <= b', [set('r', 'a')], [set('r', 'b')]),
    ]),
  );
  return p;
}

/* classe generica con confronti su T e metodi statici generici */
function genoo() {
  const p = oo([
    decl('c', 'Coppia<Integer>'), decl('d', 'Coppia<String>'), decl('v', 'Integer', 4), decl('i', 'Integer'),
    set('c', 'new Coppia<Integer>(4, 9)'), set('d', 'new Coppia<>("b", "b")'),
    out('"max: " & c.max() & ", uguali: " & c.uguali() & " / " & d.max() & ", uguali: " & d.uguali()'),
    out('"primo: " & primoDi(c) & " " & primoDi(d)'),
    forI('i', '0', '3', [set('v[i]', '10 - i * i')]),
    out('"conta 9: " & conta(v, 4, 9) & ", in d: " & conta2(d, "b")'),
  ], [
    { name: 'Coppia', attributes: [{ name: 'a', type: 'T' }, { name: 'b', type: 'T' }] },
  ], [
    { cls: 'Coppia', ctor: true, params: [['x', 'T'], ['y', 'T']], body: [set('a', 'x'), set('b', 'y')] },
    { cls: 'Coppia', name: 'max', rets: [['m', 'T']], body: [decl('m', 'T'), iff('a > b', [set('m', 'a')], [set('m', 'b')])] },
    { cls: 'Coppia', name: 'uguali', rets: [['u', 'Boolean']], body: [decl('u', 'Boolean'), set('u', 'a = b')] },
    { cls: 'Coppia', name: 'getA', rets: [['a', 'T']], body: [] },
  ]);
  const cp = p.classes.find((c) => c.name === 'Coppia');
  cp.tparams = ['T'];
  const mainC = p.classes[0];
  p.functions.push(
    fn('primoDi', ['T'], [['c', 'Coppia<T>']], [['r', 'T']], [decl('r', 'T'), set('r', 'c.getA()')], { cls: mainC.id, static: true, visibility: 'public' }),
    fn('conta', ['E'], [['v', 'E', true], ['n', 'Integer'], ['x', 'E']], [['k', 'Integer']], [
      decl('k', 'Integer'), decl('i', 'Integer'), set('k', '0'),
      forI('i', '0', 'n - 1', [iff('v[i] = x', [set('k', 'k + 1')])]),
    ], { cls: mainC.id, static: true, visibility: 'public' }),
    fn('conta2', ['E'], [['c', 'Coppia<E>'], ['x', 'E']], [['k', 'Integer']], [
      decl('k', 'Integer'), set('k', '0'), iff('c.getA() = x', [set('k', 'k + 1')]), iff('c.max() = x', [set('k', 'k + 1')]),
    ], { cls: mainC.id, static: true, visibility: 'private' }),
  );
  return p;
}
module.exports = { genfun, genoo };

/* funzioni che restituiscono array (anche a più dimensioni, insieme ad altri valori, con un Tipo Generico) */
function arrret() {
  const p = M.newProgram();
  p.attrs.name = 'ArrayRestituiti';
  const ret = (f, list) => { M.setRets(f, list); return f; };
  p.functions[0].body = [
    decl('v', 'Integer', 0), decl('m', 'Integer', '0, 0'), decl('w', 'Integer', 1), decl('n', 'Integer'), decl('s', 'String', 0),
    set('v', 'quadrati(5)'),
    out('"quadrati: " & v[0] & " " & v[2] & " " & v[4] & " (" & Size(v) & ")"'),
    set('m', 'tabellina(3)'),
    out('"tabellina: " & m[2, 2] & " " & m[1, 2] & " (" & Size(m, 0) & "x" & Size(m, 1) & ")"'),
    set('w, n', 'pari(v, 5)'),
    out('"pari: " & n & " -> " & w[0] & " " & w[1] & " " & w[2]'),
    set('s', 'ripeti("ab", 3)'),
    out('"ripeti: " & s[0] & s[1] & s[2]'),
    decl('z', 'Integer', 0), set('z', 'ripeti(7, 2)'), out('"ripeti 7: " & (z[0] + z[1])'),
  ];
  p.functions.push(
    ret(fn('quadrati', null, [['n', 'Integer']], null, [decl('q', 'Integer', 'n'), decl('i', 'Integer'), forI('i', '0', 'n - 1', [set('q[i]', 'i * i')])]), [{ name: 'q', type: 'Integer', array: true, dims: 1 }]),
    ret(fn('tabellina', null, [['n', 'Integer']], null, [decl('t', 'Integer', 'n, n'), decl('i, j', 'Integer'), forI('i', '0', 'n - 1', [forI('j', '0', 'n - 1', [set('t[i, j]', '(i + 1) * (j + 1)')])])]), [{ name: 't', type: 'Integer', array: true, dims: 2 }]),
    ret(fn('pari', null, [['a', 'Integer', true], ['n', 'Integer']], null, [decl('r', 'Integer', 'n'), decl('i', 'Integer'), decl('k', 'Integer'), set('k', '0'),
      forI('i', '0', 'n - 1', [iff('a[i] mod 2 = 0', [set('r[k]', 'a[i]'), set('k', 'k + 1')])])]), [{ name: 'r', type: 'Integer', array: true, dims: 1 }, { name: 'k', type: 'Integer' }]),
    ret(fn('ripeti', ['T'], [['x', 'T'], ['n', 'Integer']], null, [decl('r', 'T', 'n'), decl('i', 'Integer'), forI('i', '0', 'n - 1', [set('r[i]', 'x')])]), [{ name: 'r', type: 'T', array: true, dims: 1 }]),
  );
  return p;
}
module.exports.arrret = arrret;
