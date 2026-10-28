/* ==========================================================================
   FlowLab — programmi di esempio
   ========================================================================== */
'use strict';

const Examples = (() => {
  const S = (k, p) => ModelLib.makeStmt(k, p);
  const X = {
    cost: (name, type, expression) => S('const', { name, type, expression }),
    decl: (name, type, size) => S('declare', { name, type, array: size != null, size: size != null ? String(size) : '' }),
    set: (variable, expression) => S('assign', { variable, expression }),
    inp: (variable) => S('input', { variable }),
    out: (expression, newline = true) => S('output', { expression, newline }),
    if: (expression, then = [], els = []) => S('if', { expression, then, else: els }),
    while: (expression, body) => S('while', { expression, body }),
    do: (body, expression) => S('do', { expression, body }),
    for: (variable, start, end, body, direction = 'inc', step = '1') => S('for', { variable, start, end, direction, step, body }),
    call: (expression) => S('call', { expression }),
    com: (text) => S('comment', { text }),
    open: (expression, mode) => S('open', { expression, mode }),
    close: (mode) => S('close', { mode }),
    read: (variable) => S('read', { variable }),
    write: (expression) => S('write', { expression }),
  };
  const prog = (name, about, mainBody, funcs = []) => {
    const p = ModelLib.newProgram();
    Object.defineProperty(p, 'also', { value: (fn) => { fn(p); return p; }, enumerable: false });
    p.attrs.name = name; p.attrs.about = about; p.attrs.authors = 'Esempi FlowLab';
    p.functions[0].body = mainBody;
    for (const f of funcs) p.functions.push(f);
    return p;
  };
  const fn = (name, type, variable, params, body) => ModelLib.makeFunction(name, { type, variable, params: params.map(([n, t, a]) => ({ name: n, type: t, array: !!a })), body });
  /* programma a oggetti: classi = { Nome: { parent, x, y, attrs: [[nome, tipo, accesso, opzioni]] } },
     metodi = [{ cls, name | ctor, vis, static, params, rets, body }] */
  const ooProg = (name, about, mainBody, classes, methods, mainPos) => {
    const p = prog(name, about, mainBody);
    const main = ModelLib.wrapInClass(p);
    Object.assign(main, mainPos || {});
    for (const [cn, c] of Object.entries(classes)) {
      p.classes.push(ModelLib.makeClass(cn, { parent: c.parent || '', x: c.x, y: c.y, attributes: (c.attrs || []).map(([n, t, vis, o]) => ModelLib.makeAttribute(Object.assign({ name: n, type: t, visibility: vis || 'private' }, o || {}))) }));
    }
    for (const m of methods) {
      const c = p.classes.find((k) => k.name === m.cls) || main;
      const f = ModelLib.makeFunction(m.ctor ? c.name : m.name, { params: (m.params || []).map(([n, t, a]) => ({ name: n, type: t, array: !!a })), body: m.body || [], cls: c.id, visibility: m.vis || 'public', static: !!m.static, ctor: !!m.ctor });
      if (m.rets) ModelLib.setRets(f, m.rets.map(([n, t]) => ({ name: n, type: t })));
      p.functions.push(f);
    }
    return p;
  };

  const list = [
    {
      id: 'media', title: 'Media dei voti', tags: 'Per · Se',
      make: () => prog('Media dei voti', 'Legge N voti, calcola la media e dice se è sufficiente.', [
        X.decl('n, i', 'Integer'), X.decl('voto, somma, media', 'Real'),
        X.out('"Quanti voti vuoi inserire?"'), X.inp('n'),
        X.set('somma', '0'),
        X.for('i', '1', 'n', [X.out('"Voto " & i & ": "', false), X.inp('voto'), X.set('somma', 'somma + voto')]),
        X.if('n > 0', [
          X.set('media', 'somma / n'),
          X.out('"Media: " & ToFixed(media, 2)'),
          X.if('media >= 6', [X.out('"Sufficiente"')], [X.out('"Insufficiente"')]),
        ], [X.out('"Nessun voto inserito"')]),
      ]),
    },
    {
      id: 'parita', title: 'Pari o dispari', tags: 'Se · mod',
      make: () => prog('Pari o dispari', 'Usa il resto della divisione per 2.', [
        X.decl('numero', 'Integer'),
        X.out('"Inserisci un numero intero"'), X.inp('numero'),
        X.if('numero mod 2 = 0', [X.out('numero & " è pari"')], [X.out('numero & " è dispari"')]),
      ]),
    },
    {
      id: 'tabellina', title: 'Tabellina', tags: 'Per',
      make: () => prog('Tabellina', 'Stampa la tabellina di un numero da 1 a 10.', [
        X.decl('n, i', 'Integer'),
        X.out('"Di quale numero vuoi la tabellina?"'), X.inp('n'),
        X.for('i', '1', '10', [X.out('n & " × " & i & " = " & n * i')]),
      ]),
    },
    {
      id: 'mcd', title: 'MCD di Euclide', tags: 'Mentre',
      make: () => prog('MCD di Euclide', 'Massimo comun divisore con l\'algoritmo delle divisioni successive.', [
        X.decl('a, b, r', 'Integer'),
        X.com('Algoritmo di Euclide: finché b non è zero, la coppia (a, b) diventa (b, a mod b).\nQuando b vale zero, a contiene il massimo comun divisore.'),
        X.out('"Primo numero"'), X.inp('a'), X.out('"Secondo numero"'), X.inp('b'),
        X.while('b != 0', [X.set('r', 'a mod b'), X.set('a', 'b'), X.set('b', 'r')]),
        X.out('"MCD = " & a'),
      ]),
    },
    {
      id: 'indovina', title: 'Indovina il numero', tags: 'Fai-mentre · Random',
      make: () => prog('Indovina il numero', 'Il computer pensa un numero da 1 a 100.', [
        X.decl('segreto, tentativo, tentativi', 'Integer'),
        X.set('segreto', 'Random(100) + 1'), X.set('tentativi', '0'),
        X.out('"Ho pensato un numero da 1 a 100. Prova a indovinarlo!"'),
        X.do([
          X.inp('tentativo'), X.set('tentativi', 'tentativi + 1'),
          X.if('tentativo < segreto', [X.out('"Più alto"')], [X.if('tentativo > segreto', [X.out('"Più basso"')])]),
        ], 'tentativo != segreto'),
        X.out('"Indovinato in " & tentativi & " tentativi"'),
      ]),
    },
    {
      id: 'fattoriale', title: 'Fattoriale ricorsivo', tags: 'Funzione · ricorsione',
      make: () => prog('Fattoriale ricorsivo', 'Una funzione che chiama se stessa.', [
        X.decl('n', 'Integer'),
        X.out('"Calcolo di n! — inserisci n"'), X.inp('n'),
        X.out('n & "! = " & Fattoriale(n)'),
      ], [
        fn('Fattoriale', 'Integer', 'risultato', [['k', 'Integer']], [
          X.decl('risultato', 'Integer'),
          X.if('k <= 1', [X.set('risultato', '1')], [X.set('risultato', 'k * Fattoriale(k - 1)')]),
        ]),
      ]),
    },
    {
      id: 'bolle', title: 'Ordinamento a bolle', tags: 'Array · procedura',
      make: () => prog('Ordinamento a bolle', 'Riempie un array con numeri casuali e lo ordina.', [
        X.cost('DIM', 'Integer', '8'), X.decl('dati', 'Integer', 'DIM'), X.decl('i', 'Integer'),
        X.for('i', '0', 'Size(dati) - 1', [X.set('dati[i]', 'Random(90) + 10')]),
        X.out('"Prima:  "', false), X.call('Stampa(dati)'),
        X.call('Ordina(dati)'),
        X.out('"Dopo:   "', false), X.call('Stampa(dati)'),
      ], [
        fn('Ordina', 'None', '', [['v', 'Integer', true]], [
          X.decl('i, j, t', 'Integer'),
          X.for('i', '0', 'Size(v) - 2', [
            X.for('j', '0', 'Size(v) - 2 - i', [
              X.if('v[j] > v[j + 1]', [X.set('t', 'v[j]'), X.set('v[j]', 'v[j + 1]'), X.set('v[j + 1]', 't')]),
            ]),
          ]),
        ]),
        fn('Stampa', 'None', '', [['v', 'Integer', true]], [
          X.decl('i', 'Integer'),
          X.for('i', '0', 'Size(v) - 1', [X.out('v[i] & " "', false)]),
          X.out('""'),
        ]),
      ]),
    },
    {
      id: 'minmax', title: 'Minimo e massimo (più valori restituiti)', tags: 'Funzione · più valori',
      make: () => {
        const f = fn('calcolaMassimoEMinimo', 'None', '', [['V', 'Integer', true], ['N', 'Integer']], [
          X.decl('min, max, idxMin, idxMax', 'Integer'), X.decl('i', 'Integer'),
          X.set('min', 'V[0]'), X.set('max', 'V[0]'), X.set('idxMin', '0'), X.set('idxMax', '0'),
          X.for('i', '1', 'N - 1', [
            X.if('V[i] < min', [X.set('min', 'V[i]'), X.set('idxMin', 'i')]),
            X.if('V[i] > max', [X.set('max', 'V[i]'), X.set('idxMax', 'i')]),
          ]),
        ]);
        ModelLib.setRets(f, [{ name: 'min', type: 'Integer' }, { name: 'max', type: 'Integer' }, { name: 'idxMin', type: 'Integer' }, { name: 'idxMax', type: 'Integer' }]);
        return prog('Minimo e massimo', 'Una funzione che restituisce quattro valori insieme, come in Python.', [
          X.decl('V', 'Integer', 8), X.decl('N, i, min, max, idxMin, idxMax', 'Integer'),
          X.set('N', 'Size(V)'),
          X.for('i', '0', 'N - 1', [X.set('V[i]', 'Random(100)'), X.out('V[i] & " "', false)]),
          X.out('""'),
          X.set('min, max, idxMin, idxMax', 'calcolaMassimoEMinimo(V, N)'),
          X.out('"Minimo " & min & " in posizione " & idxMin'),
          X.out('"Massimo " & max & " in posizione " & idxMax'),
        ], [f]);
      },
    },
    {
      id: 'matrici', title: 'Matrici e cubi (array a più dimensioni)', tags: 'Array 2D · 3D · 4D',
      make: () => prog('Matrici e cubi', 'Riempie una tavola pitagorica 10 × 10, un cubo 4 × 6 × 8 e un array a 4 dimensioni. Apri gli array dalla scheda Variabili ed esegui con Passo.', [
        X.com('Apri la scheda Variabili e premi il pulsante accanto a un array per vederlo in una finestra.'),
        X.cost('N', 'Integer', '10'),
        X.decl('tavola', 'Integer', 'N, N'), X.decl('cubo', 'Integer', '4, 6, 8'), X.decl('quattro', 'Integer', '2, 3, 4, 5'),
        X.decl('i, j, k, l', 'Integer'),
        X.for('i', '0', 'N - 1', [X.for('j', '0', 'N - 1', [X.set('tavola[i, j]', '(i + 1) * (j + 1)')])]),
        X.for('i', '0', 'Size(cubo, 0) - 1', [X.for('j', '0', 'Size(cubo, 1) - 1', [X.for('k', '0', 'Size(cubo, 2) - 1', [X.set('cubo[i][j][k]', 'i * 100 + j * 10 + k')])])]),
        X.for('i', '0', '1', [X.for('j', '0', '2', [X.for('k', '0', '3', [X.for('l', '0', '4', [X.set('quattro[i, j, k, l]', 'i + j + k + l')])])])]),
        X.out('"7 × 8 = " & tavola[6, 7] & " · cubo[3, 5, 7] = " & cubo[3, 5, 7] & " · somma diagonale = " & SommaDiagonale(tavola)'),
      ], [
        fn('SommaDiagonale', 'Integer', 's', [['m', 'Integer', true]], [
          X.decl('s, i', 'Integer'), X.set('s', '0'),
          X.for('i', '0', 'Size(m) - 1', [X.set('s', 's + m[i, i]')]),
        ]),
      ]).also((p) => { p.functions[1].params[0].dims = 2; }),
    },
    {
      id: 'conto', title: 'Conto in banca (classi e incapsulamento)', tags: 'Oggetti · privato · costruttori',
      make: () => ooProg('Conto in banca', 'Una classe con attributi privati, due costruttori e un attributo statico che conta i conti aperti.', [
        X.com('Prova ad aggiungere il blocco  a.saldo ← 1000000 : saldo è privato e il programma si ferma con un errore.'),
        X.decl('a, b', 'ContoBancario'),
        X.set('a', 'new ContoBancario("Anna", 100)'),
        X.set('b', 'new ContoBancario("Bruno")'),
        X.call('a.deposita(50)'),
        X.if('a.preleva(30)', [X.out('"Anna ha prelevato 30 €"')]),
        X.if('not b.preleva(10)', [X.out('"Bruno non ha abbastanza soldi per prelevare 10 €"')]),
        X.out('a.descrivi()'), X.out('b.descrivi()'),
        X.out('"Conti aperti: " & ContoBancario.contiAperti'),
      ], {
        ContoBancario: { x: 360, y: 40, attrs: [['titolare', 'String'], ['saldo', 'Real'], ['contiAperti', 'Integer', 'public', { static: true, init: '0' }]] },
      }, [
        { cls: 'ContoBancario', ctor: true, params: [['nome', 'String']], body: [X.set('titolare', 'nome'), X.set('saldo', '0'), X.set('contiAperti', 'contiAperti + 1')] },
        { cls: 'ContoBancario', ctor: true, params: [['nome', 'String'], ['iniziale', 'Real']], body: [X.set('titolare', 'nome'), X.set('saldo', 'iniziale'), X.set('contiAperti', 'contiAperti + 1')] },
        { cls: 'ContoBancario', name: 'deposita', params: [['importo', 'Real']], body: [X.if('importo > 0', [X.set('saldo', 'saldo + importo')], [X.out('"Importo non valido"')])] },
        { cls: 'ContoBancario', name: 'preleva', params: [['importo', 'Real']], rets: [['riuscito', 'Boolean']], body: [X.decl('riuscito', 'Boolean'), X.if('importo > 0 and importo <= saldo', [X.set('saldo', 'saldo - importo'), X.set('riuscito', 'true')], [X.set('riuscito', 'false')])] },
        { cls: 'ContoBancario', name: 'getSaldo', rets: [['s', 'Real']], body: [X.decl('s', 'Real'), X.set('s', 'saldo')] },
        { cls: 'ContoBancario', name: 'descrivi', rets: [['testo', 'String']], body: [X.decl('testo', 'String'), X.set('testo', 'titolare & ": " & ToFixed(saldo, 2) & " €"')] },
      ], { x: 40, y: 60 }),
    },
    {
      id: 'forme', title: 'Forme geometriche (ereditarietà e polimorfismo)', tags: 'Oggetti · super · override',
      make: () => ooProg('Forme geometriche', 'Rettangolo, Quadrato e Cerchio ereditano da Forma e ridefiniscono area e perimetro. Il Disegno contiene un array di forme: ogni forma usa la propria versione dei metodi.', [
        X.decl('d', 'Disegno'),
        X.set('d', 'new Disegno()'),
        X.call('d.aggiungi(new Rettangolo(3, 2))'),
        X.call('d.aggiungi(new Quadrato(4))'),
        X.call('d.aggiungi(new Cerchio(1.5))'),
        X.call('d.stampa()'),
        X.out('"Area totale: " & ToFixed(d.areaTotale(), 2)'),
      ], {
        Forma: { x: 330, y: 40, attrs: [['nome', 'String', 'protected']] },
        Rettangolo: { parent: 'Forma', x: 140, y: 300, attrs: [['base', 'Real'], ['altezza', 'Real']] },
        Cerchio: { parent: 'Forma', x: 540, y: 300, attrs: [['raggio', 'Real']] },
        Quadrato: { parent: 'Rettangolo', x: 140, y: 560 },
        Disegno: { x: 780, y: 40, attrs: [['forme', 'Forma', 'private', { array: true, size: '10' }], ['quante', 'Integer', 'private', { init: '0' }]] },
      }, [
        { cls: 'Forma', ctor: true, params: [['n', 'String']], body: [X.set('nome', 'n')] },
        { cls: 'Forma', name: 'area', rets: [['a', 'Real']], body: [X.decl('a', 'Real'), X.set('a', '0')] },
        { cls: 'Forma', name: 'perimetro', rets: [['p', 'Real']], body: [X.decl('p', 'Real'), X.set('p', '0')] },
        { cls: 'Forma', name: 'descrivi', rets: [['testo', 'String']], body: [X.decl('testo', 'String'), X.set('testo', 'nome & ": area " & ToFixed(area(), 2) & ", perimetro " & ToFixed(perimetro(), 2)')] },
        { cls: 'Rettangolo', ctor: true, params: [['b', 'Real'], ['h', 'Real']], body: [X.call('super("rettangolo")'), X.set('base', 'b'), X.set('altezza', 'h')] },
        { cls: 'Rettangolo', name: 'area', rets: [['a', 'Real']], body: [X.decl('a', 'Real'), X.set('a', 'base * altezza')] },
        { cls: 'Rettangolo', name: 'perimetro', rets: [['p', 'Real']], body: [X.decl('p', 'Real'), X.set('p', '2 * (base + altezza)')] },
        { cls: 'Quadrato', ctor: true, params: [['lato', 'Real']], body: [X.call('super(lato, lato)'), X.set('nome', '"quadrato"')] },
        { cls: 'Cerchio', ctor: true, params: [['r', 'Real']], body: [X.call('super("cerchio")'), X.set('raggio', 'r')] },
        { cls: 'Cerchio', name: 'area', rets: [['a', 'Real']], body: [X.decl('a', 'Real'), X.set('a', 'Pi * raggio ^ 2')] },
        { cls: 'Cerchio', name: 'perimetro', rets: [['p', 'Real']], body: [X.decl('p', 'Real'), X.set('p', '2 * Pi * raggio')] },
        { cls: 'Disegno', name: 'aggiungi', params: [['f', 'Forma']], body: [X.if('quante < Size(forme)', [X.set('forme[quante]', 'f'), X.set('quante', 'quante + 1')], [X.out('"Il disegno è pieno"')])] },
        { cls: 'Disegno', name: 'areaTotale', rets: [['t', 'Real']], body: [X.decl('t', 'Real'), X.decl('i', 'Integer'), X.set('t', '0'), X.for('i', '0', 'quante - 1', [X.set('t', 't + forme[i].area()')])] },
        { cls: 'Disegno', name: 'stampa', body: [X.decl('i', 'Integer'), X.for('i', '0', 'quante - 1', [X.out('forme[i].descrivi()')])] },
      ], { x: 780, y: 330 }),
    },
    {
      id: 'lista', title: 'Lista collegata (oggetti che puntano ad altri oggetti)', tags: 'Oggetti · null · associazione',
      make: () => ooProg('Lista collegata', 'Ogni Nodo contiene un valore e il riferimento al nodo successivo (null alla fine). Apri la scheda Variabili ed esegui con Passo per seguire i riferimenti.', [
        X.decl('lista', 'Lista'), X.decl('i', 'Integer'),
        X.set('lista', 'new Lista()'),
        X.for('i', '1', '5', [X.call('lista.aggiungiInTesta(i * i)')]),
        X.call('lista.stampa()'),
        X.out('"Contiene 9? " & lista.contiene(9) & " · contiene 10? " & lista.contiene(10)'),
      ], {
        Nodo: { x: 420, y: 300, attrs: [['valore', 'Integer', 'public'], ['prossimo', 'Nodo', 'public']] },
        Lista: { x: 420, y: 40, attrs: [['testa', 'Nodo'], ['lunghezza', 'Integer', 'private', { init: '0' }]] },
      }, [
        { cls: 'Nodo', ctor: true, params: [['v', 'Integer'], ['dopo', 'Nodo']], body: [X.set('valore', 'v'), X.set('prossimo', 'dopo')] },
        { cls: 'Lista', name: 'aggiungiInTesta', params: [['v', 'Integer']], body: [X.set('testa', 'new Nodo(v, testa)'), X.set('lunghezza', 'lunghezza + 1')] },
        { cls: 'Lista', name: 'contiene', params: [['v', 'Integer']], rets: [['trovato', 'Boolean']], body: [X.decl('trovato', 'Boolean'), X.decl('n', 'Nodo'), X.set('trovato', 'false'), X.set('n', 'testa'), X.while('n != null and not trovato', [X.if('n.valore = v', [X.set('trovato', 'true')]), X.set('n', 'n.prossimo')])] },
        { cls: 'Lista', name: 'stampa', body: [X.decl('n', 'Nodo'), X.set('n', 'testa'), X.out('"Lista (" & lunghezza & " elementi): "', false), X.while('n != null', [X.out('n.valore & " "', false), X.set('n', 'n.prossimo')]), X.out('""')] },
      ], { x: 40, y: 60 }),
    },
    {
      id: 'file', title: 'Scrivere e leggere un file', tags: 'File',
      make: () => prog('Quadrati su file', 'Scrive i quadrati su un file e poi li rilegge finché il file non finisce.', [
        X.decl('i, q, somma', 'Integer'),
        X.open('"quadrati.txt"', 'write'),
        X.for('i', '1', '5', [X.write('i * i')]),
        X.close('write'),
        X.out('"Ho scritto quadrati.txt (lo trovi nella scheda File)"'),
        X.set('somma', '0'),
        X.open('"quadrati.txt"', 'read'),
        X.while('not EOF()', [X.read('q'), X.out('"Letto " & q'), X.set('somma', 'somma + q')]),
        X.close('read'),
        X.out('"Somma = " & somma'),
      ]),
    },
  ];
  return { list, get: (id) => list.find((e) => e.id === id) };
})();
