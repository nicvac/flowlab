# Moduli

La libreria di moduli di FlowLab, divisa per argomenti. Un modulo è un normale programma `.fprg`:
le sue classi o funzioni si importano in un altro programma (pulsante «Importa modulo») e si usano come quelle
scritte a mano, ma restano in sola lettura. Il Main del modulo serve solo per provarlo e non viene importato.
Chiunque può scrivere un modulo, anche uno studente: basta salvare un programma con le classi da riusare.

| Argomento | Modulo | Classi o funzioni | Descrizione |
|---|---|---|---|
| Strutture dati | [ArrayList](strutture_dati/ArrayList.fprg) | `ArrayList<T>` | Lista di elementi di tipo T che cresce da sola, come java.util.ArrayList. Internamente usa un array: quando è pieno ne crea uno una volta e mezza più grande e copia gli elementi. |
| Strutture dati | [Stack](strutture_dati/Stack.fprg) | `Stack<T>` | Pila (LIFO) di elementi di tipo T, come java.util.Stack: l'ultimo elemento inserito con push è il primo tolto con pop. Usa un array che cresce quando è pieno. |
| Strutture dati | [Queue](strutture_dati/Queue.fprg) | `Queue<T>`, `Nodo<T>` | Coda (FIFO) di elementi di tipo T, come java.util.Queue: gli elementi escono nell'ordine in cui sono entrati. È una lista collegata di nodi Nodo<T>. |
| Algoritmi di ordinamento | [Ordinamento](algoritmi_di_ordinamento/Ordinamento.fprg) | `bubbleSort()`, `selectionSort()`, `insertionSort()` | Funzioni per ordinare in modo crescente un array di interi: bubbleSort(v, n), selectionSort(v, n) e insertionSort(v, n), dove n è il numero di elementi da ordinare. |
| Algoritmi di ricerca | [Ricerca](algoritmi_di_ricerca/Ricerca.fprg) | `ricercaLineare()`, `ricercaBinaria()` | Funzioni per cercare un valore x in un array di interi: ricercaLineare(v, n, x) per un array qualsiasi e ricercaBinaria(v, n, x) per un array ordinato. Restituiscono la posizione del valore oppure -1 se non c'è. |

Nel codice generato i moduli della libreria che hanno un equivalente nel linguaggio usano le classi
già disponibili (per esempio `java.util.ArrayList`, `list` in Python, `std::vector` in C++); gli altri
moduli diventano classi scritte nel codice.

Ogni sottocartella è un argomento: il suo nome, con gli spazi scritti come `_`, è quello mostrato in FlowLab
(`strutture_dati` diventa «Strutture dati»). La descrizione di ogni modulo è quella scritta in
Proprietà del programma › Descrizione. In FlowLab si possono aggiungere altre raccolte di moduli: basta il link
GitHub di una cartella organizzata nello stesso modo.

Questa cartella si rigenera con `node tools/moduli.js`.
