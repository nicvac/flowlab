// Programmi a oggetti usati dai test
const M = require('../src/model.js');
const S = M.makeStmt;
const A = (o) => M.makeAttribute(o);
/* programma con classi: cls = [{name, parent, attributes}], methods = [{cls, name, ...}] */
function oo(mainBody, classes, methods) {
  const p = M.newProgram();
  p.attrs.name = 'Prova';
  M.wrapInClass(p);
  const main = p.classes[0];
  p.functions[0].body = mainBody;
  for (const c of classes) p.classes.push(M.makeClass(c.name, { parent: c.parent || '', attributes: (c.attributes || []).map(A) }));
  for (const m of methods) {
    const c = p.classes.find((k) => k.name === m.cls) || main;
    const f = M.makeFunction(m.ctor ? c.name : m.name, { params: (m.params || []).map(([n, t, a]) => ({ name: n, type: t, array: !!a })), body: m.body || [], cls: c.id, visibility: m.vis || 'public', static: !!m.static, ctor: !!m.ctor });
    if (m.rets) M.setRets(f, m.rets.map(([n, t]) => ({ name: n, type: t })));
    p.functions.push(f);
  }
  return p;
}
const out = (e) => S('output', { expression: e });
const set = (v, e) => S('assign', { variable: v, expression: e });
const decl = (n, t, size) => S('declare', { name: n, type: t, array: size != null, size: size != null ? String(size) : '' });
const call = (e) => S('call', { expression: e });

const punto = () => oo([
  decl('p, q', 'Punto'),
  set('p', 'new Punto(1, 2)'), set('q', 'new Punto()'),
  call('p.sposta(3, 4)'),
  out('p.descrivi() & " " & q.descrivi() & " creati: " & Punto.creati'),
  out('p = q'), set('q', 'p'), out('p = q'),
], [{ name: 'Punto', attributes: [{ name: 'x', type: 'Integer' }, { name: 'y', type: 'Integer' }, { name: 'creati', type: 'Integer', static: true, visibility: 'public', init: '0' }] }], [
  { cls: 'Punto', ctor: true, params: [['x', 'Integer'], ['y', 'Integer']], body: [set('this.x', 'x'), set('this.y', 'y'), set('creati', 'creati + 1')] },
  { cls: 'Punto', ctor: true, body: [set('x', '0'), set('y', '0'), set('Punto.creati', 'Punto.creati + 1')] },
  { cls: 'Punto', name: 'sposta', params: [['dx', 'Integer'], ['dy', 'Integer']], body: [set('x', 'x + dx'), set('this.y', 'y + dy')] },
  { cls: 'Punto', name: 'descrivi', rets: [['s', 'String']], body: [decl('s', 'String'), set('s', '"(" & x & ", " & y & ")"')] },
]);
const forme = () => oo([
  decl('forme', 'Forma', 3), decl('i', 'Integer'),
  set('forme[0]', 'new Cerchio("cerchio", 1)'), set('forme[1]', 'new Rettangolo(2, 3)'), set('forme[2]', 'new Forma("generica")'),
  S('for', { variable: 'i', start: '0', end: 'Size(forme) - 1', body: [out('forme[i].descrivi()')] }),
], [
  { name: 'Forma', attributes: [{ name: 'nome', type: 'String', visibility: 'protected' }] },
  { name: 'Cerchio', parent: 'Forma', attributes: [{ name: 'r', type: 'Real' }] },
  { name: 'Rettangolo', parent: 'Forma', attributes: [{ name: 'b', type: 'Real' }, { name: 'h', type: 'Real' }] },
], [
  { cls: 'Forma', ctor: true, params: [['n', 'String']], body: [set('nome', 'n')] },
  { cls: 'Forma', name: 'area', rets: [['a', 'Real']], body: [decl('a', 'Real'), set('a', '0')] },
  { cls: 'Forma', name: 'descrivi', rets: [['s', 'String']], body: [decl('s', 'String'), set('s', 'nome & ": area " & ToFixed(area(), 2)')] },
  { cls: 'Cerchio', ctor: true, params: [['n', 'String'], ['r', 'Real']], body: [S('comment', { text: 'prima la classe madre' }), call('super(n)'), set('this.r', 'r')] },
  { cls: 'Cerchio', name: 'area', rets: [['a', 'Real']], body: [decl('a', 'Real'), set('a', 'Pi * r ^ 2')] },
  { cls: 'Rettangolo', ctor: true, params: [['b', 'Real'], ['h', 'Real']], body: [call('super("rettangolo")'), set('this.b', 'b'), set('this.h', 'h')] },
  { cls: 'Rettangolo', name: 'area', rets: [['a', 'Real']], body: [decl('a', 'Real'), set('a', 'b * h')] },
  { cls: 'Rettangolo', name: 'descrivi', rets: [['s', 'String']], body: [decl('s', 'String'), set('s', '"[" & super.descrivi() & "]"')] },
]);
const lista = () => oo([
  decl('testa, n', 'Nodo'), decl('i', 'Integer'),
  set('testa', 'null'),
  S('for', { variable: 'i', start: '1', end: '4', body: [set('n', 'new Nodo(i * 10)'), set('n.prossimo', 'testa'), set('testa', 'n')] }),
  out('Nodo.conta(testa) & " nodi: " & Nodo.elenco(testa) & " · " & Nodo.elenco(testa, "-")'),
], [{ name: 'Nodo', attributes: [{ name: 'valore', type: 'Integer', visibility: 'public' }, { name: 'prossimo', type: 'Nodo', visibility: 'public' }] }], [
  { cls: 'Nodo', ctor: true, params: [['v', 'Integer']], body: [set('valore', 'v')] },
  { cls: 'Nodo', name: 'conta', static: true, params: [['n', 'Nodo']], rets: [['k', 'Integer']], body: [decl('k', 'Integer'), set('k', '0'), S('while', { expression: 'n != null', body: [set('k', 'k + 1'), set('n', 'n.prossimo')] })] },
  { cls: 'Nodo', name: 'elenco', static: true, params: [['n', 'Nodo']], rets: [['s', 'String']], body: [decl('s', 'String'), set('s', 'elenco(n, " ")')] },
  { cls: 'Nodo', name: 'elenco', static: true, params: [['n', 'Nodo'], ['sep', 'String']], rets: [['s', 'String']], body: [decl('s', 'String'), set('s', '""'), S('while', { expression: 'n != null', body: [S('if', { expression: 's != ""', then: [set('s', 's & sep')] }), set('s', 's & n.valore'), set('n', 'n.prossimo')] })] },
]);
const vettore = () => oo([
  decl('v', 'Vettore'), decl('a, b', 'Integer'), decl('i', 'Integer'),
  set('v', 'new Vettore(5)'),
  S('for', { variable: 'i', start: '0', end: 'Size(v.dati) - 1', body: [set('v.dati[i]', '(i * 7) mod 5')] }),
  set('a, b', 'v.minmax()'),
  out('"min " & a & " max " & b & " somma " & v.somma() & " creati " & Vettore.quanti[0]'),
], [{ name: 'Vettore', attributes: [{ name: 'dati', type: 'Integer', array: true, size: '6', visibility: 'public' }, { name: 'quanti', type: 'Integer', array: true, size: '2', static: true, visibility: 'public' }, { name: 'usati', type: 'Integer' }] }], [
  { cls: 'Vettore', ctor: true, params: [['n', 'Integer']], body: [set('usati', 'n'), set('quanti[0]', 'quanti[0] + 1')] },
  { cls: 'Vettore', name: 'minmax', rets: [['mn', 'Integer'], ['mx', 'Integer']], body: [decl('mn, mx, i', 'Integer'), set('mn', 'dati[0]'), set('mx', 'dati[0]'), S('for', { variable: 'i', start: '1', end: 'usati - 1', body: [S('if', { expression: 'dati[i] < mn', then: [set('mn', 'dati[i]')] }), S('if', { expression: 'this.dati[i] > mx', then: [set('mx', 'dati[i]')] })] })] },
  { cls: 'Vettore', name: 'somma', rets: [['t', 'Integer']], body: [decl('t', 'Integer'), set('t', 'parziale(usati - 1)')] },
  { cls: 'Vettore', name: 'parziale', vis: 'private', params: [['k', 'Integer']], rets: [['t', 'Integer']], body: [decl('t', 'Integer'), S('if', { expression: 'k < 0', then: [set('t', '0')], else: [set('t', 'dati[k] + parziale(k - 1)')] })] },
]);
module.exports = { oo, punto, forme, lista, vettore, out, set, decl, call };
