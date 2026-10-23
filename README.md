# FlowLab

Editor ed esecutore di **diagrammi di flusso** che gira interamente nel browser.
È un unico file HTML: si apre in Chrome con un doppio clic e funziona anche offline.
Legge e salva i programmi nel formato **`.fprg`** (XML) usato dagli editor di diagrammi di flusso più diffusi a scuola.

Il software è stato creato con **Claude Opus 5.5** di Anthropic.

👉 **Per usarlo:** scarica [`dist/FlowLab.html`](dist/FlowLab.html) e aprilo con Chrome.

## Funzionalità

- **Editor:** clic su una freccia per aggiungere un blocco, doppio clic per modificarlo, trascinamento per spostarlo; copia/incolla, annulla/ripeti, più funzioni con parametri e array.
- **Blocchi:** Dichiara, Assegna, Input, Output, Chiama, Se, Mentre, Per, Fai-mentre, Commento, Punto di interruzione, File (Apri, Leggi, Scrivi, Chiudi).
- **Esecuzione:** quattro velocità, esecuzione passo-passo con evidenziazione del blocco corrente, punti di interruzione, messaggi di errore in italiano con il blocco in errore segnato in rosso.
- **Pannelli:** console di input/output, variabili (in giallo quelle appena cambiate, con lo stack delle chiamate), file di testo virtuali.
- **Codice generato:** pseudocodice italiano, Python, C++, Java, C#, JavaScript.
- **Esportazione:** `.fprg`, SVG, PNG, codice sorgente.
- **Esempi pronti:** media dei voti, pari/dispari, tabellina, MCD di Euclide, indovina il numero, fattoriale ricorsivo, ordinamento a bolle, lettura/scrittura di file.

## Linguaggio delle espressioni

| Operatori | Significato |
|---|---|
| `+ - * /` | aritmetica (`/` dà sempre un reale) |
| `mod` `%` | resto |
| `^` | potenza |
| `&` | concatenazione di testi e numeri |
| `=` `==` `!=` `<>` `<` `<=` `>` `>=` | confronti |
| `and` `&&` `or` `\|\|` `not` `!` | logici |

Funzioni integrate: `Abs, Arccos, Arcsin, Arctan, Cos, Sin, Tan, Cosh, Sinh, Tanh, Int, Ln, Log, Log10, Sgn, Sqrt, Random, Len, Char, ToChar, ToCode, ToFixed, ToInteger, ToReal, ToString, Size, EOF`, costante `Pi`.

## Struttura

```
src/
  expr.js      lessico, parser, valori tipizzati, funzioni integrate, valutatore
  model.js     modello del programma, lettura/scrittura .fprg
  interp.js    interprete a generatore (passo-passo, input, interruzioni)
  codegen.js   generatori di codice (pseudocodice, Python, C++, Java, C#, JS)
  render.js    impaginazione e disegno SVG del diagramma
  examples.js  programmi di esempio
  app.js       interfaccia
  style.css, body.html
build.py       unisce i sorgenti in dist/FlowLab.html (standalone) e dist/artifact.html
test/          test Node e Playwright
```

Per ricostruire: `python3 build.py`.
Test: `node test/node_interp.js`, `node test/node_codegen.js all`, `node test/ui.mjs` (richiede Playwright).

