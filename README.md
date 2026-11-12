# FlowLab

Editor ed esecutore di **diagrammi di flusso** che gira interamente nel browser.
È un unico file HTML: si apre in Chrome con un doppio clic e funziona anche offline.
Legge e salva i programmi nel formato **`.fprg`** (XML) usato dagli editor di diagrammi di flusso più diffusi a scuola.

Il software è stato creato con **Claude Opus 5.5** di Anthropic.

👉 **Per usarlo:**
- **online**, senza installare nulla: apri <https://nicvac.github.io/flowlab/dist/FlowLab.html>;
- **come app**: dalla versione online, menu File › *Installa FlowLab come app* (Chrome o Edge); si apre in una finestra sua e funziona anche senza rete;
- **offline**: scarica [`dist/FlowLab.html`](dist/FlowLab.html) e aprilo con Chrome.

### Aprire un programma da un indirizzo web

Aggiungendo `?url=` seguito dall'indirizzo di un file `.fprg`, FlowLab apre direttamente quel programma:

```
https://nicvac.github.io/flowlab/dist/FlowLab.html?url=https://github.com/utente/repo/blob/main/esercizio.fprg
```

- Vanno bene i file su GitHub (anche il link «blob» della pagina del file: FlowLab lo trasforma nel file grezzo), nei Gist e su GitHub Pages. Altri siti funzionano se permettono la lettura da altre pagine (CORS).
- Dopo l'apertura il parametro sparisce dalla barra degli indirizzi: ricaricando la pagina si ritrova il proprio lavoro. Il programma che c'era prima si recupera con Ctrl+Z.
- Dal menu File: *Apri da indirizzo web…* e *Copia il link a questo programma*, per condividerlo con la classe.
- Nella cartella [`esempi/`](esempi/) ci sono tutti gli esempi in formato `.fprg`, con i link che li aprono direttamente in FlowLab.

## Funzionalità

- **Editor:** clic su una freccia per aggiungere un blocco, doppio clic per modificarlo, trascinamento per spostarlo; copia/incolla, annulla/ripeti, più funzioni con parametri e array.
- **Blocchi:** Dichiara (con valore iniziale facoltativo: `a, b: Intero = 0`), Costante, Assegna, Input, Output, Chiama, Se, Mentre, Per, Fai-mentre, Commento, Punto di interruzione, File (Apri, Leggi, Scrivi, Chiudi). Se il testo di un blocco non sta nel riquadro, il pulsante + lo mostra tutto su più righe.
- **Esecuzione:** quattro velocità, esecuzione passo-passo (Passo entra nelle funzioni chiamate, Passo sopra le esegue senza entrarci, Esci dalla funzione esegue il resto della funzione in corso e si ferma dopo la chiamata) con evidenziazione del blocco corrente e un cursore che percorre le frecce seguite (rami dei Se e ritorni dei cicli compresi), punti di interruzione, messaggi di errore in italiano con il blocco in errore segnato in rosso.
- **Vista compatta** (pulsante *Compatta* in alto a sinistra sul diagramma, Maiusc+K): i blocchi semplici in sequenza (dichiarazioni e costanti, assegnazioni, input, output, chiamate, commenti, interruzioni) si toccano, senza frecce tra loro, e hanno la stessa larghezza; il diagramma diventa più corto. Un diagramma appena aperto è sempre nella vista estesa, e le esportazioni (SVG, PNG, PDF) usano sempre la vista estesa. In entrambe le viste, sotto il corpo di un ciclo la freccia di ritorno parte subito e, se il corpo finisce con un altro ciclo o con un Se, la sua uscita prosegue dritta nel ritorno, senza gradini.
- **Pannelli:** console di input/output, variabili (in giallo quelle appena cambiate, con lo stack delle chiamate), file di testo virtuali. Le schede si riordinano trascinandole e si possono sganciare in finestre mobili da posizionare ovunque, riducibili alla sola barra del titolo; il pannello laterale si nasconde e si riapre con il pulsantino sul divisore. La disposizione viene ricordata.
- **Array a più dimensioni**: `m[3, 4]` si dichiara indicando le dimensioni separate da virgola e si usa con `m[i, j]` oppure `m[i][j]`; `Size(m, d)` dà il numero di elementi della dimensione `d`.
- **Visualizzatore di array per il debug**: dalla scheda Variabili ogni array si apre in una finestra mobile. Un array a una dimensione è una striscia, a due una scacchiera, a tre un cubo aperto a libro (si sfoglia la prima dimensione, ogni pagina è una scacchiera su carta a quadretti); oltre le tre dimensioni le prime si scelgono con dei selettori di indice. Si vedono solo le celle che entrano nella finestra, con una sfumatura verso la trasparenza dove ce ne sono altre, e durante l'esecuzione la vista si sposta sulla cella appena modificata.
- **Costanti**: un blocco dedicato (`MAX: Intero = 100`) con un valore che non può essere modificato; nel codice diventano `const` (C++, C#, JavaScript), `final` (Java) o una variabile in maiuscolo (Python).
- **Funzioni con più valori restituiti**, come in Python: `min, max, idxMin, idxMax ← calcolaMassimoEMinimo(V, N)`. Nel codice generato diventano tuple in Python e C#, `std::tie` in C++, un `record` in Java (16+), un array destrutturato in JavaScript. È un'estensione di FlowLab: gli altri programmi che usano il formato `.fprg` non possono eseguire questi programmi.
- **Array come valori restituiti**, come i parametri: nel dialogo della funzione ogni valore restituito ha la sua forma (valore, array, matrice…). La chiamata si assegna a un array, `v ← quadrati(10)`, e `v` diventa l'array restituito (come in Java); con più valori `voti, n ← leggiVoti()`. Un metodo può restituire anche un attributo array della sua classe. Nel codice: `int[] quadrati(int n)` in Java, `int[,]` in C#, `vector<int>` in C++ (dove l'array restituito viene copiato).
- **Classi e oggetti (vista Oggetti)**: il comando *Funzioni / Oggetti* nella barra cambia vista. Nella vista Oggetti il foglio mostra un **diagramma delle classi UML**: ogni classe ha attributi e metodi con i modificatori d'accesso (`+` pubblico, `-` privato, `#` protetto), i membri statici sono sottolineati, le frecce indicano l'ereditarietà e le associazioni (attributi che hanno come tipo un'altra classe, con la molteplicità). All'inizio il programma è un'unica classe con le funzioni come metodi statici; la vista Funzioni resta disponibile finché c'è una sola classe con soli metodi statici e pubblici.
  - Doppio clic su un metodo: si apre il suo diagramma di flusso, che si disegna come una funzione. Clic destro su una classe: nuovi attributi, metodi e costruttori. Le classi si spostano trascinandole.
  - **Autocompletamento:** scrivendo il punto dopo un oggetto (`p.`, `this.`, `lista.get(0).`) o dopo il nome di una classe (`Punto.`) compare l'elenco dei metodi e degli attributi che si possono usare in quel punto, con i tipi (per un `ArrayList<Intero>` si vede `add(x: Intero)`), gli ereditati e il rispetto di privato e protetto; si sceglie con le frecce e Invio o Tab.
  - Nelle espressioni: `p ← new Punto(1, 2)`, `p.x`, `p.sposta(3, 4)`, `this.x`, `Punto.contatore`, `super(...)` come primo blocco di un costruttore, `super.metodo()`, `null`.
  - Ereditarietà con ridefinizione dei metodi (polimorfismo), più costruttori con parametri diversi, attributi e metodi statici, valori iniziali degli attributi.
  - **Classi e metodi astratti**: una classe astratta («abstract», nome in corsivo) non crea oggetti; un metodo astratto non ha corpo e lo definiscono le sottoclassi (aprendolo si vedono le loro versioni). FlowLab segnala le sottoclassi concrete che non definiscono un metodo astratto ereditato. Nel codice: `abstract` in Java e C#, `= 0` in C++, `ABC` e `@abstractmethod` in Python. I modificatori d'accesso sono controllati durante l'esecuzione: leggere un attributo privato da fuori della classe dà errore, come in Java.
  - Nella scheda Variabili gli oggetti si aprono con la freccina per vedere i loro attributi; compaiono anche `this` e gli attributi statici.
  - Nel codice generato diventano classi vere: `extends`/`super` in Java, `: base(...)` e `virtual`/`override` in C#, puntatori, `virtual` e liste di inizializzazione in C++, `self` e `super().__init__` in Python, `class`/`extends` in JavaScript. In Python e JavaScript, che non hanno l'overloading, le versioni con parametri diversi sono raccolte in un unico metodo che sceglie in base agli argomenti.
- **Tipi Generici** (`T`, `S`, `V`…): nel menu del tipo di un parametro o di un attributo c'è la voce *Nuovo Tipo Generico*. Scegliendola, FlowLab assegna un nome libero (prima `T`, poi `S`, `V`…) e da quel momento lo stesso Tipo Generico si può riusare negli altri menu («T (Tipo Generico)»), anche dentro un altro tipo (`Coppia<T>`). Non c'è nulla da dichiarare prima: il Tipo Generico nasce dove lo si usa e sparisce quando non lo usa più nessuno.
  - **Nelle classi**: un Tipo Generico usato in un attributo, in un costruttore o in un metodo non statico appartiene alla classe, che diventa `ArrayList<T>`, `Coppia<T, S>`. Le variabili si dichiarano `ArrayList<Intero>` e gli oggetti si creano con `new ArrayList<Intero>()` oppure `new ArrayList<>()` (il tipo si ricava dalla variabile); l'interprete controlla i tipi degli elementi. Una classe già usata nel programma non può acquistare o perdere Tipi Generici, e una classe con Tipi Generici non eredita e non ha sottoclassi. Due array si possono assegnare (`a ← b`): `a` diventa lo stesso array di `b`, come in Java.
  - **Nelle funzioni e nei metodi statici**: il Tipo Generico appartiene alla funzione (`massimo<T>(v: T[], n: Intero): T`). A ogni chiamata `T` si ricava dagli argomenti: `massimo(voti, 5)` con un array di Interi, `massimo(nomi, 3)` con uno di Stringhe; se gli argomenti danno a `T` due tipi diversi (un Intero e un Reale) l'interprete lo segnala. Per questo un Tipo Generico nuovo si crea nei parametri; nei valori restituiti e nelle dichiarazioni si usano quelli già presenti.
  - I valori di un Tipo Generico si confrontano con `= != < <= > >=`.
  - Nel codice: `class Coppia<T>` e `static <T> T massimo(T[] v, int n)` in Java, con `Objects.equals` e `compareTo` e con `T extends Comparable<T>` solo se servono i confronti `< >`; gli array di tipi base passati a una funzione con Tipo Generico diventano `Integer[]`, `Double[]`. In C# `class Coppia<T>` e `massimo<T>(...)` con `where T : IComparable<T>`; in C++ `template <typename T>`.
- **Moduli** (pulsante *Importa modulo* accanto a *Esempi*, oppure Ctrl+I): un modulo è un normale programma `.fprg` da riusare. I moduli si prendono da **raccolte su GitHub**: una raccolta è una cartella di un repository pubblico in cui ogni sottocartella è un argomento (`strutture_dati` diventa «Strutture dati») e contiene i file `.fprg`. Nel dialogo le raccolte si sfogliano ad albero (raccolta › argomento › moduli) e una raccolta si scarica da GitHub solo quando la si apre. Di default c'è la [raccolta ufficiale](moduli/) (strutture dati: `ArrayList<T>`, `Stack<T>`, `Queue<T>` con i costruttori di Java, compresi quelli con la capacità iniziale e quelli che copiano un'altra struttura; algoritmi di ordinamento e di ricerca); se ne possono aggiungere altre incollando il link della cartella, e un modulo si può importare anche da un file o da un indirizzo web. La descrizione mostrata è quella scritta in Proprietà del programma. Se il modulo ha delle classi, le classi compaiono in un riquadro «modulo …» del diagramma delle classi, che si può condensare (solo i nomi delle classi) o espandere con il pulsantino sul riquadro, con *Condensa i moduli* o con Maiusc+M; se ha solo funzioni, le funzioni si aggiungono al programma e si chiamano per nome, senza cambiare vista. In entrambi i casi restano in sola lettura (i loro diagrammi di flusso si possono aprire e seguire passo passo), si aggiornano e si rimuovono dallo stesso dialogo, e il Main del modulo serve solo per provarlo. Chiunque può scrivere un modulo, anche uno studente. Nel codice generato i moduli della raccolta ufficiale che hanno un equivalente nel linguaggio usano le classi già disponibili (`java.util.ArrayList`, `Stack`, `Queue`; `list` e `deque` in Python; `vector`, `stack`, `queue` in C++; `List`, `Stack`, `Queue` in C#; gli array in JavaScript); gli altri diventano classi o funzioni scritte nel codice.
- **Installazione come app** (menu File › *Installa FlowLab come app*, oppure l'icona di installazione nella barra degli indirizzi di Chrome o Edge): dalla [versione online](https://nicvac.github.io/flowlab/dist/FlowLab.html) FlowLab si installa sul computer o sul Chromebook e si apre in una finestra sua, con l'icona tra le app; funziona anche senza rete (la pagina si chiede prima alla rete, così c'è sempre l'ultima versione, e altrimenti si usa la copia salvata). Una volta installato, FlowLab apre i file `.fprg` con il doppio clic o con «Apri con» (ognuno nella sua finestra) e Ctrl+S li salva direttamente lì. La copia scaricata in locale non si installa: la voce del menu spiega dove farlo.
- **Codice generato:** pseudocodice italiano, Python, C++, Java, C#, JavaScript.
- **Esportazione:** `.fprg`, SVG, PNG, codice sorgente e **tutto il progetto in PDF** (copertina con indice, diagramma delle classi, diagramma di flusso di ogni funzione o metodo con i testi espansi, ciascuno intero su una pagina alta quanto serve, pensata per la lettura a schermo, con il testo dei blocchi sempre a 9 pt (i diagrammi più larghi di un A4 allargano la pagina); codice sorgente nel linguaggio scelto nella scheda Codice, su pagine A4 orizzontali e colorato come nella scheda).
- **Scorciatoie da tastiera** per tutte le operazioni, indicate nei menu contestuali, nei suggerimenti dei pulsanti e nella Guida rapida (F1). Una lettera aggiunge un blocco dopo quello selezionato (D Dichiara, A Assegna, I Input, O Output, S Se, M Mentre, P Per…; anche nel menu «Aggiungi un blocco»), Alt+↑/↓ sposta il blocco; nel diagramma delle classi A, M e C aggiungono attributo, metodo e costruttore alla classe selezionata, N una nuova classe; F2 modifica, Pag↑/Pag↓ passano da un diagramma all'altro.
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
- funzioni che restituiscono array
- classi e oggetti
- classi e funzioni con Tipi Generici
- moduli importati
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
  pwa/         installazione come app: service worker e icone (si rigenerano con node tools/icone.mjs)
esempi/        gli esempi in formato .fprg (si rigenerano con node tools/esempi.js)
moduli/        libreria dei moduli per argomento (si rigenera con node tools/moduli.js; build.py la include nella pagina)
build.py       unisce i sorgenti in dist/FlowLab.html (standalone) e dist/artifact.html; scrive anche manifest, service worker e icone per l'installazione come app
test/          test Node e Playwright
```

Per ricostruire: `python3 build.py`.
Test: `node test/node_interp.js`, `node test/node_codegen.js all`, `node test/node_oo.js`, `node test/node_codegen_oo.js run` (compila ed esegue il codice a oggetti generato e lo confronta con l'interprete), `node test/ui.mjs` e `node test/oo_ui.mjs` (richiedono Playwright).

