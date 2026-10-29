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
- **Blocchi:** Dichiara (con valore iniziale facoltativo: `a, b: Intero = 0`), Costante, Assegna, Input, Output, Chiama, Se, Mentre, Per, Fai-mentre, Commento, Punto di interruzione, File (Apri, Leggi, Scrivi, Chiudi). Se il testo di un blocco non sta nel riquadro, il pulsante + lo mostra tutto su più righe.
- **Esecuzione:** quattro velocità, esecuzione passo-passo (Passo entra nelle funzioni chiamate, Passo sopra le esegue senza entrarci) con evidenziazione del blocco corrente e un cursore che percorre le frecce seguite (rami dei Se e ritorni dei cicli compresi), punti di interruzione, messaggi di errore in italiano con il blocco in errore segnato in rosso.
- **Pannelli:** console di input/output, variabili (in giallo quelle appena cambiate, con lo stack delle chiamate), file di testo virtuali. Le schede si riordinano trascinandole e si possono sganciare in finestre mobili da posizionare ovunque, riducibili alla sola barra del titolo; il pannello laterale si nasconde e si riapre con il pulsantino sul divisore. La disposizione viene ricordata.
- **Array a più dimensioni**: `m[3, 4]` si dichiara indicando le dimensioni separate da virgola e si usa con `m[i, j]` oppure `m[i][j]`; `Size(m, d)` dà il numero di elementi della dimensione `d`.
- **Visualizzatore di array per il debug**: dalla scheda Variabili ogni array si apre in una finestra mobile. Un array a una dimensione è una striscia, a due una scacchiera, a tre un cubo aperto a libro (si sfoglia la prima dimensione, ogni pagina è una scacchiera su carta a quadretti); oltre le tre dimensioni le prime si scelgono con dei selettori di indice. Si vedono solo le celle che entrano nella finestra, con una sfumatura verso la trasparenza dove ce ne sono altre, e durante l'esecuzione la vista si sposta sulla cella appena modificata.
- **Costanti**: un blocco dedicato (`MAX: Intero = 100`) con un valore che non può essere modificato; nel codice diventano `const` (C++, C#, JavaScript), `final` (Java) o una variabile in maiuscolo (Python).
- **Funzioni con più valori restituiti**, come in Python: `min, max, idxMin, idxMax ← calcolaMassimoEMinimo(V, N)`. Nel codice generato diventano tuple in Python e C#, `std::tie` in C++, un `record` in Java (16+), un array destrutturato in JavaScript. È un'estensione di FlowLab: gli altri programmi che usano il formato `.fprg` non possono eseguire questi programmi.
- **Classi e oggetti (vista Oggetti)**: il comando *Funzioni / Oggetti* nella barra cambia vista. Nella vista Oggetti il foglio mostra un **diagramma delle classi UML**: ogni classe ha attributi e metodi con i modificatori d'accesso (`+` pubblico, `-` privato, `#` protetto), i membri statici sono sottolineati, le frecce indicano l'ereditarietà e le associazioni (attributi che hanno come tipo un'altra classe, con la molteplicità). All'inizio il programma è un'unica classe con le funzioni come metodi statici; la vista Funzioni resta disponibile finché c'è una sola classe con soli metodi statici e pubblici.
  - Doppio clic su un metodo: si apre il suo diagramma di flusso, che si disegna come una funzione. Clic destro su una classe: nuovi attributi, metodi e costruttori. Le classi si spostano trascinandole.
  - Nelle espressioni: `p ← new Punto(1, 2)`, `p.x`, `p.sposta(3, 4)`, `this.x`, `Punto.contatore`, `super(...)` come primo blocco di un costruttore, `super.metodo()`, `null`.
  - Ereditarietà con ridefinizione dei metodi (polimorfismo), più costruttori con parametri diversi, attributi e metodi statici, valori iniziali degli attributi.
  - **Classi e metodi astratti**: una classe astratta («abstract», nome in corsivo) non crea oggetti; un metodo astratto non ha corpo e lo definiscono le sottoclassi (aprendolo si vedono le loro versioni). FlowLab segnala le sottoclassi concrete che non definiscono un metodo astratto ereditato. Nel codice: `abstract` in Java e C#, `= 0` in C++, `ABC` e `@abstractmethod` in Python. I modificatori d'accesso sono controllati durante l'esecuzione: leggere un attributo privato da fuori della classe dà errore, come in Java.
  - Nella scheda Variabili gli oggetti si aprono con la freccina per vedere i loro attributi; compaiono anche `this` e gli attributi statici.
  - Nel codice generato diventano classi vere: `extends`/`super` in Java, `: base(...)` e `virtual`/`override` in C#, puntatori, `virtual` e liste di inizializzazione in C++, `self` e `super().__init__` in Python, `class`/`extends` in JavaScript. In Python e JavaScript, che non hanno l'overloading, le versioni con parametri diversi sono raccolte in un unico metodo che sceglie in base agli argomenti.
- **Codice generato:** pseudocodice italiano, Python, C++, Java, C#, JavaScript.
- **Esportazione:** `.fprg`, SVG, PNG, codice sorgente e **tutto il progetto in PDF** (copertina con indice, diagramma delle classi, diagramma di flusso di ogni funzione o metodo con i testi espansi, codice sorgente nel linguaggio scelto nella scheda Codice).
- **Esempi pronti:** media dei voti, pari/dispari, tabellina, MCD di Euclide, indovina il numero, fattoriale ricorsivo, ordinamento a bolle, minimo e massimo, matrici e cubi, conto in banca, forme geometriche, animali (classi astratte), lista collegata, lettura/scrittura di file.

## Compatibilità con il formato .fprg

FlowLab è compatibile con il **formato `.fprg` standard**.

- **Apertura:** i file `.fprg` standard si aprono in FlowLab. I blocchi della grafica tartaruga non sono supportati e vengono scartati con un avviso.
- **Salvataggio:** se il programma non usa le funzionalità estese, FlowLab salva in formato `.fprg` standard e il file si apre negli altri editor che usano questo formato.
- Come previsto dal formato, i nomi di variabili e funzioni non distinguono maiuscole e minuscole. Le stringhe scritte tra apici singoli vengono salvate tra virgolette doppie.

### Formato .fprg esteso

Se il programma usa una delle funzionalità estese di FlowLab, il file viene salvato in un **formato `.fprg` esteso, non standard**. Le funzionalità estese sono:

- costanti
- array a più dimensioni
- funzioni con più valori restituiti
- classi e oggetti
- dichiarazioni con valore iniziale

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
  uml.js       diagramma delle classi
  pdf.js       scrittura dei file PDF
  arrayview.js finestre per visualizzare gli array
  examples.js  programmi di esempio
  app.js       interfaccia
  style.css, body.html
build.py       unisce i sorgenti in dist/FlowLab.html (standalone) e dist/artifact.html
test/          test Node e Playwright
```

Per ricostruire: `python3 build.py`.
Test: `node test/node_interp.js`, `node test/node_codegen.js all`, `node test/node_oo.js`, `node test/node_codegen_oo.js run` (compila ed esegue il codice a oggetti generato e lo confronta con l'interprete), `node test/ui.mjs` e `node test/oo_ui.mjs` (richiedono Playwright).

