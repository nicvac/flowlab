// Scrive gli esempi di FlowLab in esempi/*.fprg e l'elenco con i link in esempi/README.md
// Uso: node tools/esempi.js
const fs = require('fs'), path = require('path');
global.ExprLib = require('../src/expr.js');
const M = global.ModelLib = require('../src/model.js');
const Examples = eval(fs.readFileSync(path.join(__dirname, '../src/examples.js'), 'utf8') + ';Examples');
const dir = path.join(__dirname, '../esempi');
fs.mkdirSync(dir, { recursive: true });
const PAGE = 'https://nicvac.github.io/flowlab/dist/FlowLab.html';
const rows = [];
for (const ex of Examples.list) {
  const p = ex.make();
  // date fisse: rigenerando, i file non cambiano se l'esempio non cambia
  p.attrs.created = Buffer.from('flowlab;esempi;2026-10-29 08:00:00 PM;1').toString('base64');
  let xml = M.serializeFprg(p);
  xml = xml.replace(/<attribute name="saved" value="[^"]*"\/>/, '<attribute name="saved" value="2026-10-29 08:00:00 PM"/>')
    .replace(/<attribute name="edited" value="[^"]*"\/>/, `<attribute name="edited" value="${Buffer.from('flowlab;esempi;2026-10-29 08:00:00 PM;1').toString('base64')}"/>`);
  fs.writeFileSync(path.join(dir, ex.id + '.fprg'), xml);
  const ext = M.extendedFeatures(p);
  rows.push(`| [${ex.title}](${PAGE}?url=../esempi/${ex.id}.fprg) | ${ex.tags} | [${ex.id}.fprg](${ex.id}.fprg) | ${ext.length ? 'esteso (' + ext.join(', ') + ')' : 'standard'} |`);
}
fs.writeFileSync(path.join(dir, 'README.md'), `# Esempi

I programmi di esempio di FlowLab in formato \`.fprg\`. Il link nella prima colonna apre l'esempio direttamente in FlowLab.

| Esempio | Argomenti | File | Formato |
|---|---|---|---|
${rows.join('\n')}

Per aprire in FlowLab un qualsiasi file \`.fprg\` pubblicato online si aggiunge \`?url=\` all'indirizzo di FlowLab, per esempio:

\`\`\`
${PAGE}?url=https://github.com/utente/repo/blob/main/esercizio.fprg
\`\`\`

Questa cartella si rigenera con \`node tools/esempi.js\`.
`);
console.log(Examples.list.length, 'esempi scritti in', dir);
