import re, pathlib
src = pathlib.Path('src')
js_files = ['expr.js','model.js','interp.js','codegen.js','render.js','uml.js','pdf.js','examples.js','arrayview.js','app.js']
js = '\n'.join((src/f).read_text() for f in js_files)
# libreria dei moduli (moduli/<argomento>/<Nome>.fprg) inclusa nella pagina: serve quando GitHub non è raggiungibile
import json
mod_root = pathlib.Path('moduli')
title = lambda t: (lambda x: x[:1].upper() + x[1:])(re.sub(r'[_-]+', ' ', t).strip())
lib = [{'topic': t.name, 'topicTitle': title(t.name), 'id': f.stem, 'text': f.read_text()}
       for t in sorted(p for p in mod_root.iterdir() if p.is_dir()) for f in sorted(t.glob('*.fprg'))]
js = 'const ModuleLibrary = ' + json.dumps(lib, ensure_ascii=False).replace('</', '<\\/') + ';\n' + js
assert '</script' not in js
css = (src/'style.css').read_text()
body = (src/'body.html').read_text()
fonts = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=JetBrains+Mono:wght@400;600&display=swap">'
title = '<title>FlowLab</title>'
inner = f'{title}\n<meta name="description" content="Editor ed esecutore di diagrammi di flusso compatibile con i file .fprg">\n{fonts}\n<style>\n{css}\n</style>\n{body}\n<script>\n{js}\n</script>\n'
out = pathlib.Path('dist'); out.mkdir(exist_ok=True)
(out/'artifact.html').write_text(inner)
full = f'<!doctype html>\n<html lang="it">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n{title}\n<meta name="description" content="Editor ed esecutore di diagrammi di flusso compatibile con i file .fprg">\n{fonts}\n<style>\n{css}\n</style>\n</head>\n<body>\n{body}\n<script>\n{js}\n</script>\n</body>\n</html>\n'
(out/'FlowLab.html').write_text(full)
print(len(full)//1024, 'KB')
