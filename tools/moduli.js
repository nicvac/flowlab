// Scrive i moduli della libreria di FlowLab in moduli/<argomento>/<Nome>.fprg e l'elenco in moduli/README.md
// Un modulo è un normale programma .fprg: le sue classi si importano in un altro programma,
// il Main serve solo per provarlo e non viene importato.
// Uso: node tools/moduli.js
const fs = require('fs'), path = require('path');
global.ExprLib = require('../src/expr.js');
const M = global.ModelLib = require('../src/model.js');
const S = M.makeStmt;

const X = {
  decl: (name, type, size) => S('declare', { name, type, array: size != null, size: size != null ? String(size) : '' }),
  set: (variable, expression) => S('assign', { variable, expression }),
  out: (expression, newline = true) => S('output', { expression, newline }),
  call: (expression) => S('call', { expression }),
  if: (expression, then, els) => S('if', { expression, then: then || [], else: els || [] }),
  while: (expression, body) => S('while', { expression, body }),
  for: (variable, start, end, body, dec) => S('for', { variable, start, end, direction: dec ? 'dec' : 'inc', step: '1', body }),
  note: (text) => S('comment', { text }),
};

/* modulo: name, about, classi { Nome: { tparams, attrs: [[nome, tipo, vis, opz]], x, y } }, metodi, Main di prova */
function modulo({ name, about, mainClass, main, classes, methods }) {
  const p = M.newProgram();
  p.attrs.name = name; p.attrs.about = about; p.attrs.authors = 'FlowLab';
  p.functions[0].body = main;
  const mc = M.wrapInClass(p);
  mc.name = mainClass; Object.assign(mc, { x: 40, y: 360 });
  for (const [cn, c] of Object.entries(classes)) {
    p.classes.push(M.makeClass(cn, { tparams: c.tparams || [], x: c.x, y: c.y, attributes: (c.attrs || []).map(([n, t, vis, o]) => M.makeAttribute(Object.assign({ name: n, type: t, visibility: vis || 'private' }, o || {}))) }));
  }
  for (const m of methods) {
    const c = p.classes.find((k) => k.name === m.cls);
    const f = M.makeFunction(m.ctor ? c.name : m.name, { params: (m.params || []).map(([n, t, a]) => ({ name: n, type: t, array: !!a })), body: m.body || [], cls: c.id, visibility: m.vis || 'public', static: !!m.static, ctor: !!m.ctor });
    if (m.ret) M.setRets(f, [{ name: m.ret[0], type: m.ret[1] }]);
    p.functions.push(f);
  }
  return p;
}

/* modulo di sole funzioni (programma a funzioni): name, about, funzioni [{ name, params, ret, body }], Main di prova */
function moduloFunzioni({ name, about, funcs, main }) {
  const p = M.newProgram();
  p.attrs.name = name; p.attrs.about = about; p.attrs.authors = 'FlowLab';
  p.functions[0].body = main;
  for (const fn of funcs) {
    const f = M.makeFunction(fn.name, { params: (fn.params || []).map(([n, t, arr]) => ({ name: n, type: t, array: !!arr })), body: fn.body || [] });
    if (fn.ret) M.setRets(f, [{ name: fn.ret[0], type: fn.ret[1] }]);
    p.functions.push(f);
  }
  return p;
}

/* crescita dell'array interno come in java.util.ArrayList: nuova capacità = vecchia + vecchia / 2 */
const cresci = (cls) => ({ cls, name: 'cresci', vis: 'private', body: [
  X.note('Array pieno: se ne crea uno più grande (una volta e mezza, come ArrayList di Java) e si copiano gli elementi'),
  X.decl('nuovaCapacita, k', 'Integer'),
  X.set('nuovaCapacita', 'Size(elementi) + Int(Size(elementi) / 2)'),
  X.if('nuovaCapacita < Size(elementi) + 1', [X.set('nuovaCapacita', 'Size(elementi) + 1')]),
  X.decl('nuovo', 'T', 'nuovaCapacita'),
  X.for('k', '0', 'quanti - 1', [X.set('nuovo[k]', 'elementi[k]')]),
  X.set('elementi', 'nuovo'),
] });

const MODULES = [
  {
    topic: 'strutture_dati', id: 'ArrayList',
    make: () => modulo({
      name: 'ArrayList',
      about: 'Lista di elementi di tipo T che cresce da sola, come java.util.ArrayList. Internamente usa un array: quando è pieno ne crea uno una volta e mezza più grande e copia gli elementi.',
      mainClass: 'ProvaArrayList',
      classes: { ArrayList: { tparams: ['T'], x: 40, y: 40, attrs: [['elementi', 'T', 'private', { array: true, size: '10' }], ['quanti', 'Integer', 'private', { init: '0' }]] } },
      methods: [
        { cls: 'ArrayList', ctor: true, body: [X.note('Lista vuota con capacità iniziale 10, come new ArrayList<>() in Java')] },
        { cls: 'ArrayList', ctor: true, params: [['capacitaIniziale', 'Integer']], body: [
          X.note('Lista vuota con un array interno di capacitaIniziale posti, come new ArrayList<>(n) in Java'),
          X.decl('nuovo', 'T', 'capacitaIniziale'), X.set('elementi', 'nuovo')] },
        { cls: 'ArrayList', ctor: true, params: [['altra', 'ArrayList<T>']], body: [
          X.note('Copia degli elementi di un\'altra lista, come new ArrayList<>(altra) in Java'),
          X.decl('k', 'Integer'), X.decl('nuovo', 'T', 'altra.quanti'),
          X.for('k', '0', 'altra.quanti - 1', [X.set('nuovo[k]', 'altra.elementi[k]')]),
          X.set('elementi', 'nuovo'), X.set('quanti', 'altra.quanti')] },
        { cls: 'ArrayList', name: 'add', params: [['x', 'T']], body: [
          X.if('quanti = Size(elementi)', [X.call('cresci()')]),
          X.set('elementi[quanti]', 'x'), X.set('quanti', 'quanti + 1')] },
        { cls: 'ArrayList', name: 'add', params: [['i', 'Integer'], ['x', 'T']], body: [
          X.note('Inserisce x in posizione i: gli elementi da i in poi si spostano di un posto'),
          X.decl('k', 'Integer'),
          X.if('quanti = Size(elementi)', [X.call('cresci()')]),
          X.for('k', 'quanti - 1', 'i', [X.set('elementi[k + 1]', 'elementi[k]')], true),
          X.set('elementi[i]', 'x'), X.set('quanti', 'quanti + 1')] },
        { cls: 'ArrayList', name: 'get', params: [['i', 'Integer']], ret: ['elemento', 'T'], body: [X.decl('elemento', 'T'), X.set('elemento', 'elementi[i]')] },
        { cls: 'ArrayList', name: 'set', params: [['i', 'Integer'], ['x', 'T']], body: [X.set('elementi[i]', 'x')] },
        { cls: 'ArrayList', name: 'remove', params: [['i', 'Integer']], ret: ['tolto', 'T'], body: [
          X.note('Toglie l\'elemento in posizione i: quelli dopo si spostano indietro di un posto'),
          X.decl('tolto', 'T'), X.decl('k', 'Integer'),
          X.set('tolto', 'elementi[i]'),
          X.for('k', 'i', 'quanti - 2', [X.set('elementi[k]', 'elementi[k + 1]')]),
          X.set('quanti', 'quanti - 1')] },
        { cls: 'ArrayList', name: 'size', ret: ['n', 'Integer'], body: [X.decl('n', 'Integer'), X.set('n', 'quanti')] },
        { cls: 'ArrayList', name: 'isEmpty', ret: ['vuota', 'Boolean'], body: [X.decl('vuota', 'Boolean'), X.set('vuota', 'quanti = 0')] },
        { cls: 'ArrayList', name: 'indexOf', params: [['x', 'T']], ret: ['posizione', 'Integer'], body: [
          X.decl('posizione, k', 'Integer'), X.set('posizione', '-1'), X.set('k', '0'),
          X.while('posizione = -1 and k < quanti', [X.if('elementi[k] = x', [X.set('posizione', 'k')]), X.set('k', 'k + 1')])] },
        { cls: 'ArrayList', name: 'contains', params: [['x', 'T']], ret: ['trovato', 'Boolean'], body: [X.decl('trovato', 'Boolean'), X.set('trovato', 'indexOf(x) >= 0')] },
        { cls: 'ArrayList', name: 'clear', body: [X.set('quanti', '0')] },
        cresci('ArrayList'),
      ],
      main: [
        X.note('Prova del modulo: questo Main non viene importato'),
        X.decl('quadrati', 'ArrayList<Integer>'), X.decl('i', 'Integer'),
        X.set('quadrati', 'new ArrayList<Integer>()'),
        X.for('i', '1', '15', [X.call('quadrati.add(i * i)')]),
        X.out('"Elementi: " & quadrati.size() & ", il terzo è " & quadrati.get(2)'),
        X.call('quadrati.remove(0)'), X.call('quadrati.add(0, 100)'),
        X.out('"Ora il primo è " & quadrati.get(0) & ", il secondo " & quadrati.get(1)'),
        X.out('"Contiene 49? " & quadrati.contains(49) & " in posizione " & quadrati.indexOf(49)'),
        X.decl('nomi', 'ArrayList<String>'), X.set('nomi', 'new ArrayList<String>(0)'),
        X.call('nomi.add("Ada")'), X.call('nomi.add("Alan")'),
        X.out('"Nomi: " & nomi.get(0) & " e " & nomi.get(1)'),
        X.decl('copia', 'ArrayList<Integer>'), X.set('copia', 'new ArrayList<Integer>(quadrati)'),
        X.call('copia.set(0, -1)'),
        X.out('"Copia: " & copia.get(0) & " " & copia.get(1) & ", originale: " & quadrati.get(0) & ", elementi " & copia.size()'),
      ],
    }),
  },
  {
    topic: 'strutture_dati', id: 'Stack',
    make: () => modulo({
      name: 'Stack',
      about: 'Pila (LIFO) di elementi di tipo T, come java.util.Stack: l\'ultimo elemento inserito con push è il primo tolto con pop. Usa un array che cresce quando è pieno.',
      mainClass: 'ProvaStack',
      classes: { Stack: { tparams: ['T'], x: 40, y: 40, attrs: [['elementi', 'T', 'private', { array: true, size: '10' }], ['quanti', 'Integer', 'private', { init: '0' }]] } },
      methods: [
        { cls: 'Stack', ctor: true, body: [X.note('Pila vuota, come new Stack<>() in Java')] },
        { cls: 'Stack', name: 'push', params: [['x', 'T']], body: [X.if('quanti = Size(elementi)', [X.call('cresci()')]), X.set('elementi[quanti]', 'x'), X.set('quanti', 'quanti + 1')] },
        { cls: 'Stack', name: 'pop', ret: ['cima', 'T'], body: [X.decl('cima', 'T'), X.set('quanti', 'quanti - 1'), X.set('cima', 'elementi[quanti]')] },
        { cls: 'Stack', name: 'peek', ret: ['cima', 'T'], body: [X.decl('cima', 'T'), X.set('cima', 'elementi[quanti - 1]')] },
        { cls: 'Stack', name: 'size', ret: ['n', 'Integer'], body: [X.decl('n', 'Integer'), X.set('n', 'quanti')] },
        { cls: 'Stack', name: 'isEmpty', ret: ['vuota', 'Boolean'], body: [X.decl('vuota', 'Boolean'), X.set('vuota', 'quanti = 0')] },
        cresci('Stack'),
      ],
      main: [
        X.note('Prova del modulo: questo Main non viene importato'),
        X.decl('pila', 'Stack<String>'), X.set('pila', 'new Stack<String>()'),
        X.call('pila.push("primo")'), X.call('pila.push("secondo")'), X.call('pila.push("terzo")'),
        X.out('"In cima: " & pila.peek()'),
        X.while('not pila.isEmpty()', [X.out('pila.pop()')]),
      ],
    }),
  },
  {
    topic: 'strutture_dati', id: 'Queue',
    make: () => modulo({
      name: 'Queue',
      about: 'Coda (FIFO) di elementi di tipo T, come java.util.Queue: gli elementi escono nell\'ordine in cui sono entrati. È una lista collegata di nodi Nodo<T>.',
      mainClass: 'ProvaQueue',
      classes: {
        Queue: { tparams: ['T'], x: 40, y: 40, attrs: [['testa', 'Nodo<T>'], ['ultimo', 'Nodo<T>'], ['quanti', 'Integer', 'private', { init: '0' }]] },
        Nodo: { tparams: ['T'], x: 40, y: 330, attrs: [['valore', 'T', 'public'], ['successivo', 'Nodo<T>', 'public']] },
      },
      methods: [
        { cls: 'Nodo', ctor: true, params: [['v', 'T']], body: [X.set('valore', 'v'), X.set('successivo', 'null')] },
        { cls: 'Queue', ctor: true, body: [X.note('Coda vuota, come new LinkedList<>() in Java')] },
        { cls: 'Queue', ctor: true, params: [['altra', 'Queue<T>']], body: [
          X.note('Copia degli elementi di un\'altra coda, nello stesso ordine, come new LinkedList<>(altra) in Java'),
          X.decl('n', 'Nodo<T>'), X.set('n', 'altra.testa'),
          X.while('n != null', [X.call('add(n.valore)'), X.set('n', 'n.successivo')])] },
        { cls: 'Queue', name: 'add', params: [['x', 'T']], body: [
          X.decl('n', 'Nodo<T>'), X.set('n', 'new Nodo<T>(x)'),
          X.if('ultimo = null', [X.set('testa', 'n')], [X.set('ultimo.successivo', 'n')]),
          X.set('ultimo', 'n'), X.set('quanti', 'quanti + 1')] },
        { cls: 'Queue', name: 'remove', ret: ['primo', 'T'], body: [
          X.note('Toglie e restituisce il primo elemento della coda'),
          X.decl('primo', 'T'), X.set('primo', 'testa.valore'), X.set('testa', 'testa.successivo'),
          X.if('testa = null', [X.set('ultimo', 'null')]), X.set('quanti', 'quanti - 1')] },
        { cls: 'Queue', name: 'peek', ret: ['primo', 'T'], body: [X.decl('primo', 'T'), X.set('primo', 'testa.valore')] },
        { cls: 'Queue', name: 'size', ret: ['n', 'Integer'], body: [X.decl('n', 'Integer'), X.set('n', 'quanti')] },
        { cls: 'Queue', name: 'isEmpty', ret: ['vuota', 'Boolean'], body: [X.decl('vuota', 'Boolean'), X.set('vuota', 'quanti = 0')] },
      ],
      main: [
        X.note('Prova del modulo: questo Main non viene importato'),
        X.decl('fila', 'Queue<Integer>'), X.decl('i', 'Integer'), X.set('fila', 'new Queue<Integer>()'),
        X.for('i', '1', '5', [X.call('fila.add(i * 10)')]),
        X.out('"Primo in fila: " & fila.peek() & " su " & fila.size()'),
        X.decl('copia', 'Queue<Integer>'), X.set('copia', 'new Queue<Integer>(fila)'), X.call('copia.remove()'),
        X.out('"La copia ha " & copia.size() & " elementi, la coda " & fila.size()'),
        X.while('not fila.isEmpty()', [X.out('fila.remove() & " "', false)]),
        X.out('""'),
      ],
    }),
  },
  {
    topic: 'algoritmi_di_ordinamento', id: 'Ordinamento',
    make: () => moduloFunzioni({
      name: 'Ordinamento',
      about: 'Funzioni per ordinare in modo crescente un array di interi: bubbleSort(v, n), selectionSort(v, n) e insertionSort(v, n), dove n è il numero di elementi da ordinare.',
      funcs: [
        { name: 'bubbleSort', params: [['v', 'Integer', true], ['n', 'Integer']], body: [
          X.note('Confronta gli elementi vicini e li scambia: a ogni passata il più grande va in fondo'),
          X.decl('i, j, t', 'Integer'),
          X.for('i', '0', 'n - 2', [X.for('j', '0', 'n - 2 - i', [X.if('v[j] > v[j + 1]', [X.set('t', 'v[j]'), X.set('v[j]', 'v[j + 1]'), X.set('v[j + 1]', 't')])])])] },
        { name: 'selectionSort', params: [['v', 'Integer', true], ['n', 'Integer']], body: [
          X.note('Cerca il minimo della parte non ordinata e lo mette al suo posto'),
          X.decl('i, j, m, t', 'Integer'),
          X.for('i', '0', 'n - 2', [X.set('m', 'i'), X.for('j', 'i + 1', 'n - 1', [X.if('v[j] < v[m]', [X.set('m', 'j')])]), X.set('t', 'v[i]'), X.set('v[i]', 'v[m]'), X.set('v[m]', 't')])] },
        { name: 'insertionSort', params: [['v', 'Integer', true], ['n', 'Integer']], body: [
          X.note('Inserisce ogni elemento al suo posto nella parte già ordinata, spostando avanti quelli più grandi'),
          X.decl('i, j, x', 'Integer'),
          X.for('i', '1', 'n - 1', [X.set('x', 'v[i]'), X.set('j', 'i - 1'), X.while('j >= 0 and v[j] > x', [X.set('v[j + 1]', 'v[j]'), X.set('j', 'j - 1')]), X.set('v[j + 1]', 'x')])] },
      ],
      main: [
        X.note('Prova del modulo: questo Main non viene importato'),
        X.decl('v', 'Integer', 8), X.decl('i', 'Integer'),
        X.for('i', '0', '7', [X.set('v[i]', '(i * 37 + 11) mod 50')]),
        X.call('insertionSort(v, 8)'),
        X.for('i', '0', '7', [X.out('v[i] & " "', false)]), X.out('""'),
      ],
    }),
  },
  {
    topic: 'algoritmi_di_ricerca', id: 'Ricerca',
    make: () => moduloFunzioni({
      name: 'Ricerca',
      about: 'Funzioni per cercare un valore x in un array di interi: ricercaLineare(v, n, x) per un array qualsiasi e ricercaBinaria(v, n, x) per un array ordinato. Restituiscono la posizione del valore oppure -1 se non c\'è.',
      funcs: [
        { name: 'ricercaLineare', params: [['v', 'Integer', true], ['n', 'Integer'], ['x', 'Integer']], ret: ['posizione', 'Integer'], body: [
          X.note('Controlla gli elementi uno dopo l\'altro'),
          X.decl('posizione, i', 'Integer'), X.set('posizione', '-1'), X.set('i', '0'),
          X.while('posizione = -1 and i < n', [X.if('v[i] = x', [X.set('posizione', 'i')]), X.set('i', 'i + 1')])] },
        { name: 'ricercaBinaria', params: [['v', 'Integer', true], ['n', 'Integer'], ['x', 'Integer']], ret: ['posizione', 'Integer'], body: [
          X.note('L\'array deve essere ordinato: a ogni passo si dimezza la parte in cui cercare'),
          X.decl('posizione, inizio, fine, medio', 'Integer'),
          X.set('posizione', '-1'), X.set('inizio', '0'), X.set('fine', 'n - 1'),
          X.while('posizione = -1 and inizio <= fine', [
            X.set('medio', 'Int((inizio + fine) / 2)'),
            X.if('v[medio] = x', [X.set('posizione', 'medio')], [X.if('v[medio] < x', [X.set('inizio', 'medio + 1')], [X.set('fine', 'medio - 1')])])])] },
      ],
      main: [
        X.note('Prova del modulo: questo Main non viene importato'),
        X.decl('v', 'Integer', 6), X.decl('i', 'Integer'),
        X.for('i', '0', '5', [X.set('v[i]', 'i * 3')]),
        X.out('"15 è in posizione " & ricercaBinaria(v, 6, 15) & ", 7 in posizione " & ricercaLineare(v, 6, 7)'),
      ],
    }),
  },
];

/* nome da mostrare per un argomento: è il nome della cartella, strutture_dati -> "Strutture dati" */
const topicTitle = (t) => { const x = t.replace(/[_-]+/g, ' ').trim(); return x[0].toUpperCase() + x.slice(1); };
module.exports = { MODULES, topicTitle };

if (require.main === module) {
  const root = path.join(__dirname, '../moduli');
  const stamp = Buffer.from('flowlab;moduli;2026-11-11 08:00:00 AM;1').toString('base64');
  const rows = [];
  for (const m of MODULES) {
    const p = m.make();
    p.attrs.created = stamp;
    const xml = M.serializeFprg(p)
      .replace(/<attribute name="saved" value="[^"]*"\/>/, '<attribute name="saved" value="2026-11-11 08:00:00 AM"/>')
      .replace(/<attribute name="edited" value="[^"]*"\/>/, `<attribute name="edited" value="${stamp}"/>`);
    fs.mkdirSync(path.join(root, m.topic), { recursive: true });
    fs.writeFileSync(path.join(root, m.topic, m.id + '.fprg'), xml);
    const cls = M.hasClasses(p) ? p.classes.filter((c) => c !== M.mainClass(p)).map((c) => '`' + M.classTitle(c) + '`').join(', ') : p.functions.slice(1).map((f) => '`' + f.name + '()`').join(', ');
    rows.push(`| ${topicTitle(m.topic)} | [${m.id}](${m.topic}/${m.id}.fprg) | ${cls} | ${p.attrs.about} |`);
  }
  fs.writeFileSync(path.join(root, 'README.md'), `# Moduli

La libreria di moduli di FlowLab, divisa per argomenti. Un modulo è un normale programma \`.fprg\`:
le sue classi o funzioni si importano in un altro programma (pulsante «Importa modulo») e si usano come quelle
scritte a mano, ma restano in sola lettura. Il Main del modulo serve solo per provarlo e non viene importato.
Chiunque può scrivere un modulo, anche uno studente: basta salvare un programma con le classi da riusare.

| Argomento | Modulo | Classi o funzioni | Descrizione |
|---|---|---|---|
${rows.join('\n')}

Nel codice generato i moduli della libreria che hanno un equivalente nel linguaggio usano le classi
già disponibili (per esempio \`java.util.ArrayList\`, \`list\` in Python, \`std::vector\` in C++); gli altri
moduli diventano classi scritte nel codice.

Ogni sottocartella è un argomento: il suo nome, con gli spazi scritti come \`_\`, è quello mostrato in FlowLab
(\`strutture_dati\` diventa «Strutture dati»). La descrizione di ogni modulo è quella scritta in
Proprietà del programma › Descrizione. In FlowLab si possono aggiungere altre raccolte di moduli: basta il link
GitHub di una cartella organizzata nello stesso modo.

Questa cartella si rigenera con \`node tools/moduli.js\`.
`);
  console.log(MODULES.length, 'moduli scritti in', root);
}
