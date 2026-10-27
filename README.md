# FlowLab

Editor ed esecutore di **diagrammi di flusso** che gira interamente nel browser.
È un unico file HTML: si apre in Chrome con un doppio clic e funziona anche offline.
Legge e salva i programmi nel formato **`.fprg`** (XML) usato dagli editor di diagrammi di flusso più diffusi a scuola.

Il software è stato creato con **Claude Opus 5.5** di Anthropic.

👉 **Per usarlo:**
- **online**, senza installare nulla: apri <https://nicvac.github.io/flowlab/dist/FlowLab.html>;
- **offline**: scarica [`dist/FlowLab.html`](dist/FlowLab.html) e aprilo con Chrome.

## Funzionalità

- **Editor:** clic su una freccia per aggiungere un blocco, doppio clic per modificarlo, trascinamento per spostarlo; copia/incolla, annulla/ripeti, più funzioni con parametri e array.
- **Blocchi:** Dichiara, Costante, Assegna, Input, Output, Chiama, Se, Mentre, Per, Fai-mentre, Commento, Punto di interruzione, File (Apri, Leggi, Scrivi, Chiudi).
- **Esecuzione:** quattro velocità, esecuzione passo-passo con evidenziazione del blocco corrente e un cursore che percorre le frecce seguite (rami dei Se e ritorni dei cicli compresi), punti di interruzione, messaggi di errore in italiano con il blocco in errore segnato in rosso.
- **Pannelli:** console di input/output, variabili (in giallo quelle appena cambiate, con lo stack delle chiamate), file di testo virtuali. Le schede si riordinano trascinandole e si possono sganciare in finestre mobili da posizionare ovunque, riducibili alla sola barra del titolo; il pannello laterale si nasconde e si riapre con il pulsantino sul divisore. La disposizione viene ricordata.
- **Costanti**: un blocco dedicato (`MAX: Intero = 100`) con un valore che non può essere modificato; nel codice diventano `const` (C++, C#, JavaScript), `final` (Java) o una variabile in maiuscolo (Python).
- **Funzioni con più valori restituiti**, come in Python: `min, max, idxMin, idxMax ← calcolaMassimoEMinimo(V, N)`. Nel codice generato diventano tuple in Python e C#, `std::tie` in C++, un `record` in Java (16+), un array destrutturato in JavaScript. È un'estensione di FlowLab: gli altri programmi che usano il formato `.fprg` non possono eseguire questi programmi.
- **Codice generato:** pseudocodice italiano, Python, C++, Java, C#, JavaScript.
- **Esportazione:** `.fprg`, SVG, PNG, codice sorgente.
- **Esempi pronti:** media dei voti, pari/dispari, tabellina, MCD di Euclide, indovina il numero, fattoriale ricorsivo, ordinamento a bolle, lettura/scrittura di file.

## Compatibilità con il formato .fprg

FlowLab è compatibile con il **formato `.fprg` standard**.

- **Apertura:** i file `.fprg` standard si aprono in FlowLab. I blocchi della grafica tartaruga non sono supportati e vengono scartati con un avviso.
- **Salvataggio:** se il programma non usa le funzionalità estese, FlowLab salva in formato `.fprg` standard e il file si apre negli altri editor che usano questo formato.
- Come previsto dal formato, i nomi di variabili e funzioni non distinguono maiuscole e minuscole. Le stringhe scritte tra apici singoli vengono salvate tra virgolette doppie.

### Formato .fprg esteso

Se il programma usa una delle funzionalità estese di FlowLab, il file viene salvato in un **formato `.fprg` esteso, non standard**. Le funzionalità estese sono:

| Funzionalità | Come viene salvata | Negli altri editor |
|---|---|---|
| **Costanti** | dichiarazione con l'attributo `flowlab-const="True"`, seguita dall'assegnamento del valore | il file si apre e il programma gira: la costante è vista come una variabile normale |
| **Funzioni con più valori restituiti** | attributo `flowlab-returns` sulla funzione e assegnamento con più variabili (`a, b ← f(...)`) | il programma non si può eseguire |

FlowLab apre e salva i file in formato esteso senza perdere nulla. Al salvataggio di un programma con più valori restituiti compare un avviso.

### Verifica

`node test/compat.mjs <cartella con file .fprg>` apre ogni file, controlla blocchi, espressioni e nomi, salva e riapre, verifica che il file salvato usi solo il formato standard ed esegue il programma.

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

