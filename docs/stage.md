# FlowLab Stage — format of the `.flstage` files

A **stage** is an animated scene that follows the variables of a FlowLab program while it runs: a row of penguins for an
array being sorted, a tower of blocks for the recursive calls, two sticks for Euclid's algorithm. The program and the
stage are separate files: the stage says which variables it needs (its **slots**), and the program names its stages and
says which of its variables each slot follows. The stage file knows nothing of the program.

This page is the specification: it is written so that it can be given as it is to an AI that writes new stages.

## How FlowLab runs a stage

- **A program links its stages.** A `.fprg` can name 0, 1 or more stages: the `.flstage` files **in the same folder
  as the program** (it saves only their name), or stages at a web address (it saves the address). For each stage the
  program also saves the variables bound to its slots, which stage is active and whether the window is collapsed.
  This is a FlowLab extension of the format (`<flowlab-stages>`): other programs reading the `.fprg` ignore it.
  ```xml
  <flowlab-stages active="0" collapsed="False">
      <stage file="bubble_sort_ice.flstage">
          <bind slot="fila" variable="Main.dati"/>
          <bind slot="j" variable="Ordina.j"/>
      </stage>
  </flowlab-stages>
  ```
- Stages are linked from *File › Stage* (files, also several at once, or a web address) and unlinked from the window
  (or the same menu). The examples of FlowLab come linked to their stages.
- **Finding the files.** A program opened from a web address finds its stages next to it by itself. A program opened
  from the computer cannot read the files next to it (the browser does not allow it): open the program together with
  its stages (select them all in *Open*, or drag them all at once), or press *Choose the files* in the window of the
  stage when it says a file is missing. The browser keeps a copy of the last stages used, only to find them again
  when the page is reloaded.
- **Without stages nothing changes**: the code of the stages is not even loaded and the execution has no hook.
- The stages of the program are in a floating window: in its title bar the active stage is chosen (one at a time),
  then the speed of the animations, the bindings, the download of the stage file, the unlinking and the collapse.
  **Collapsed to its title bar the stage is unloaded**: no frame, no hook, the program runs as without stages;
  expanded again it is loaded and starts from the values of that moment.
- The code of the stage runs in an isolated frame (an `iframe` with `sandbox="allow-scripts"`): it cannot see the page
  of FlowLab, its data or the browser storage. It can load libraries from the internet.
- **The program waits for the animations**: after each block of the flowchart FlowLab compares the bound variables
  with their values before the block. If something changed it sends the changes to the stage and waits until the
  stage says the animation is over (the Promise returned by `update` is resolved), at any speed of execution.
  During the animation the block that made the change stays lit; the cursor goes to the next block when the
  animation ends. In step-by-step mode a Step pressed during an animation is ignored (the steps do not pile up).
  An animation longer than 15 seconds (at 1×; more when the animations are slowed down) is not waited for: the
  program goes on and the stage window reports it.
- The window has its own speed slider (from 0.25× to 4×), passed to the stage as `stage.speed`.
- Each *Run* starts the stage again (`reset`). At the end of the program the stage stays as it is; *Stop* calls `stop`.

## The file

A `.flstage` file is a **JavaScript module** (UTF-8 text). It has:

1. `export const bindings = { … };` — **one line**, a JSON object: slot name → variable of the program. These are
   only the defaults, used when the stage is linked to a program for the first time: then the program keeps its own
   bindings. FlowLab rewrites this line when the stage file is downloaded from its window; everything else is never
   changed.
2. `import` lines for the libraries, with full addresses of a CDN and an exact version
   (e.g. `import { gsap } from 'https://cdn.jsdelivr.net/npm/gsap@3.12.5/index.js';`).
3. `export default { … };` — the scene.

No other `export`. Images and sounds are inside the file (SVG drawn by code, or `data:` URLs).

```js
// FlowLab Stage — «Name of the stage»: one or two lines on what it shows.
export const bindings = {"fila":"Main.dati","j":"Ordina.j"};

import { gsap } from 'https://cdn.jsdelivr.net/npm/gsap@3.12.5/index.js';

/* the texts in the language of FlowLab (stage.lang): Italian and English; any other language takes English */
const TEXTS = {
  it: { title: 'La fila dei pinguini' },
  en: { title: 'The penguin row' },
};
let T = TEXTS.en;
let st; // the stage, kept by setup

export default {
  name: { it: 'La fila dei pinguini', en: 'The penguin row' },
  description: { it: 'Cosa mostra lo stage, per chi aggancia le variabili.', en: 'What the stage shows, for the person who binds the variables.' },
  slots: {
    fila: { type: 'Integer[]', label: { it: 'La fila (array di interi)', en: 'The row (array of integers)' } },
    j: { type: 'Integer', label: { it: 'Posizione confrontata (j)', en: 'Position compared (j)' }, optional: true },
  },
  setup(stage) { st = stage; T = TEXTS[stage.lang] || TEXTS.en; stage.onSpeed((s) => gsap.globalTimeline.timeScale(s)); /* draw the background, with T.title */ },
  reset(stage, values) { /* draw the state of values (null = variable not there yet) */ },
  async update(stage, events, values) { for (const e of events) { /* animate e; await the animation */ } },
  stop(stage) { /* optional: end the animations at once */ },
};
```

### The scene object

| Field | Meaning |
|---|---|
| `name` | Title of the stage (window title, binding dialog): a text, or a text for each language `{ it: '…', en: '…' }`. |
| `description` | One or two sentences, shown in the binding dialog (a text, or a text for each language). |
| `slots` | The variables the stage needs: `{ name: { type, label, optional } }` (`label`: a text, or a text for each language). |
| `setup(stage)` | Called once, when the stage is loaded: keep `stage`, draw what does not change. |
| `reset(stage, values)` | Called when the stage is loaded, at each *Run* and after binding the variables. `values` has a field for each slot: its current value, or `null` if the variable does not exist yet (its function has not been called or the declaration has not been run). Draw that state **without** long animations. |
| `update(stage, events, values)` | Called after a block that changed one or more bound variables. Animate each event in order and **return a Promise that ends when the animation ends** (an `async` function that `await`s its animations). `values` are all the values after the block. |
| `stop(stage)` | Optional: *Stop* was pressed. |

### Slot types

| Type | A variable of the program… |
|---|---|
| `Integer`, `Real`, `String`, `Boolean` | of that type |
| `Number` | Integer or Real |
| `Integer[]`, `Real[]`, `String[]`, `Boolean[]`, `Number[]` | array with one dimension |
| `Integer[][]` … | array with two dimensions (the value is an array of rows) |
| `ArrayList<Integer>`, `Stack<Integer>`, `Queue<Integer>` | object of that class of the official modules (the value is the array of its items, in order: for a stack from the bottom, for a queue from the first to leave) |
| `List<Integer>` | any of the three above |
| `*` | any variable |

`optional: true`: the stage works also without that variable (the binding dialog offers *(none)*).

### Bindings

`"Function.variable"` (functions view) — the variable in the most recent call of the function, so with recursion the
deepest call; `"Class.method.variable"` (objects view); `"Class.attribute"` for a static attribute. While the variable
does not exist (its function is not running, or the declaration has not been run yet) its value is `null` and the
events say `vanish`/`appear`. The bindings of a stage just linked come from its `bindings` line, and are only a
proposal: if they are not in the program, FlowLab asks to choose them (and proposes a variable with the same name, or
the only one of the right type). The choices are saved in the program.

### Events

Each event is an object with `slot`, `kind`, `before` and `after` (the whole value before and after the block) and,
depending on the kind:

| `kind` | When | Fields |
|---|---|---|
| `appear` | the variable now exists | `value` |
| `vanish` | the variable does not exist any more (its function ended) | `value` (the last one) |
| `value` | a variable that is not an array changed | `old`, `value` |
| `set` | one element of an array / list changed | `index` (for two dimensions `[row, col]`), `old`, `value` |
| `swap` | two elements exchanged their values in one block | `index`, `index2` |
| `insert` | a list got one more element | `index`, `value` |
| `remove` | a list lost one element | `index`, `value` |
| `change` | anything else (several elements at once, different size…): redraw from `after` | — |

Notes:
- In the methods of the modules (`ArrayList.add`, `Stack.pop`…) only the result is seen: `l.add(0, 3)` is one
  `insert`, not the steps of the method. A plain array changes one element per block: an exchange made with a third
  variable (`t ← v[j]`, `v[j] ← v[j + 1]`, `v[j + 1] ← t`) arrives as two `set` (and the change of `t`, if it is bound). A stage can recognise it: after `set(i)` with a value that is also at position `k`, wait; if the next event is `set(k)` with the old value of `i`, it was an exchange (this is what «La fila dei pinguini» does). With repeated values the same value can be at several positions: the partner is the position of the second `set` (the one that had the copied value), not the first position found with that value.
- An array that is filled for the first time arrives as `appear` (all `null`) and then one `set` per element.
- Values: numbers, strings, booleans, `null` for an element without a value, arrays for arrays and lists.

### The `stage` object

| Member | Meaning |
|---|---|
| `stage.svg` | The `<svg>` element where everything is drawn, `viewBox="0 0 800 450"` (it scales with the window). |
| `stage.width`, `stage.height` | 800, 450. |
| `stage.el(tag, attrs, parent)` | Creates an SVG element with those attributes (`text` sets its text) inside `parent` (default `stage.svg`) and returns it. |
| `stage.clear(parent)` | Empties `parent` (default the whole stage). |
| `stage.speed` | The speed chosen in the window (1 = normal). |
| `stage.onSpeed(fn)` | `fn(speed)` now and every time the speed changes (e.g. `gsap.globalTimeline.timeScale(speed)`). |
| `stage.t(seconds)` | A duration adjusted to the speed (for animations made without a library). |
| `stage.wait(seconds)` | A Promise that ends after that time (adjusted to the speed). |
| `stage.bound` | The names of the slots bound to a variable. |
| `stage.lang` | The language of FlowLab (`'it'`, `'en'`, …): the stage writes its texts in this language. |
| `stage.text(x)` | The text of `x` in the language of FlowLab: `x` is `{ it: '…', en: '…' }` (English if the language is missing, else the first); a plain string is returned as it is. |
| `stage.log(...)` | Writes in the browser console (for debugging). |

## Rules for good stages

- One clear metaphor per data structure: people in a row, plates on a pile, sticks, a number line, a grid of tiles.
- Each animation of `update` between 0.3 and 1.5 seconds at speed 1; `await` it, so the program waits.
- `reset` draws the state at once (no waiting), also with values `null` or arrays of `null`.
- An element of an array that is still `0` (the initial value) is being filled: do not take its `set` as the start of an exchange.
- Handle every event kind of the slots you declare, at least with `change` → redraw from `after`.
- Scale to the data: arrays from 1 to about 20 elements, values that can be large or negative.
- **Languages**: all the texts are in the stage file, at least in Italian and English: `name`, `description` and the
  slot labels as `{ it, en }`, the texts of the scene in a `TEXTS` table chosen in `setup` with `stage.lang` (English
  for the other languages). The names of the slots are identifiers and do not change with the language.
- Keep the code readable (it is shown to students).
- Use the CDN only with exact versions; [GSAP](https://gsap.com) (`https://cdn.jsdelivr.net/npm/gsap@3.12.5/index.js`)
  is a good choice for the animations of SVG.

## Writing a stage with an AI

Give it this page and a request like: *«Write a FlowLab stage (`.flstage`) for a program that inserts and removes the
elements of an `ArrayList<Integer>` called `lista` in `Main`: the list is a platform with people standing on it; when
an element is removed a trapdoor opens and the person falls into the water, when one is inserted a person arrives with a
parachute.»* Put the file in the folder of the program and link it with *File › Stage › Link stage files*; save the
program to keep the link.

The stages of the examples are next to them, in [examples/it](../examples/it) and [examples/en](../examples/en).
