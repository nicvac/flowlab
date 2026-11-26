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
/* inheritance with Generic Types: Pila<T> extends Lista<T>, ListaInteri extends Lista<Integer>, Coppia<K, V> extends Lista<V> */
function geninh() {
  const p = oo([
    decl('p', 'Pila<String>'), decl('l', 'ListaInteri'), decl('q', 'Lista<Integer>'), decl('c', 'Coppia<String, Real>'), decl('x', 'String'),
    set('p', 'new Pila<String>()'), call('p.push("a")'), call('p.push("b")'), call('p.push("c")'),
    set('x', 'p.pop()'), set('x', 'x & p.pop()'), out('x & " " & p.size() & " " & p.descrivi()'),
    set('l', 'new ListaInteri()'), call('l.add(3)'), call('l.add(-1)'), call('l.add(4)'),
    out('"somma " & l.somma() & " su " & l.size() & ", primo " & l.get(0)'),
    set('q', 'new Pila<Integer>()'), call('q.add(7)'), call('q.add(8)'),
    out('"q " & q.get(1) & " " & q.size()'),
    // through the parent class: the version of ListaInteri (negative values are not added)
    set('q', 'l'), call('q.add(-5)'), call('q.add(5)'), out('"q " & q.size() & " " & q.get(2)'),
    set('c', 'new Coppia<String, Real>("k")'), call('c.add(1.5)'), call('c.add(2.25)'),
    out('c.chiave & " " & c.get(0) & " " & c.ultimo() & " max " & c.massimo() & " " & l.massimo()'),
  ], [
    { name: 'Lista', attributes: [{ name: 'items', type: 'T', array: true, size: '10', visibility: 'protected' }, { name: 'n', type: 'Integer', visibility: 'protected', init: '0' }] },
    { name: 'Pila', parent: 'Lista' },
    { name: 'ListaInteri', parent: 'Lista' },
    { name: 'Coppia', parent: 'Lista', attributes: [{ name: 'chiave', type: 'K', visibility: 'public' }] },
  ], [
    { cls: 'Lista', name: 'add', params: [['x', 'T']], body: [set('items[n]', 'x'), set('n', 'n + 1')] },
    { cls: 'Lista', name: 'get', params: [['i', 'Integer']], rets: [['r', 'T']], body: [decl('r', 'T'), set('r', 'items[i]')] },
    { cls: 'Lista', name: 'size', rets: [['k', 'Integer']], body: [decl('k', 'Integer'), set('k', 'n')] },
    { cls: 'Lista', name: 'massimo', rets: [['m', 'T']], body: [decl('m', 'T'), decl('i', 'Integer'), set('m', 'items[0]'), forI('i', '1', 'n - 1', [iff('items[i] > m', [set('m', 'items[i]')])])] },
    { cls: 'Lista', name: 'descrivi', rets: [['s', 'String']], body: [decl('s', 'String'), set('s', '"lista di " & n')] },
    { cls: 'Pila', name: 'push', params: [['x', 'T']], body: [call('add(x)')] },
    { cls: 'Pila', name: 'pop', rets: [['r', 'T']], body: [decl('r', 'T'), set('n', 'n - 1'), set('r', 'items[n]')] },
    { cls: 'ListaInteri', name: 'add', params: [['x', 'Integer']], body: [iff('x >= 0', [call('super.add(x)')])] },
    { cls: 'ListaInteri', name: 'somma', rets: [['t', 'Integer']], body: [decl('t', 'Integer'), decl('i', 'Integer'), set('t', '0'), forI('i', '0', 'n - 1', [set('t', 't + get(i)')])] },
    { cls: 'Coppia', ctor: true, params: [['k', 'K']], body: [call('super()'), set('chiave', 'k')] },
    { cls: 'Coppia', name: 'ultimo', rets: [['t', 'V']], body: [decl('t', 'V'), set('t', 'items[n - 1]')] },
  ]);
  const C = (n) => p.classes.find((c) => c.name === n);
  C('Lista').tparams = ['T'];
  C('Pila').tparams = ['T']; C('Pila').pargs = ['T'];
  C('ListaInteri').pargs = ['Integer'];
  C('Coppia').tparams = ['K', 'V']; C('Coppia').pargs = ['V'];
  return p;
}
module.exports = { geninh, genfun, genoo };

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
