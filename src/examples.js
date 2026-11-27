/* ==========================================================================
   FlowLab — example programs
   The examples are .fprg files in examples/<language>/ (with index.json for the order,
   the titles and the topics), built into the page by build.py. FlowLab shows those of
   the chosen language, or the English ones if the language has no examples folder.
   ========================================================================== */
'use strict';

const Examples = (() => {
  const all = typeof EXAMPLES !== 'undefined' ? EXAMPLES : {};
  const lang = all[I18n.lang] ? I18n.lang : 'en', set = all[lang] || [];
  // stages: the example names stages (it is linked to animated scenes)
  const list = set.map((e) => ({ id: e.id, title: e.title, tags: e.tags, stages: /<flowlab-stages\b/.test(e.text), make: () => ModelLib.parseFprg(e.text) }));
  return { list, lang, get: (id) => list.find((e) => e.id === id) };
})();
