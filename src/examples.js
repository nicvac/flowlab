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
