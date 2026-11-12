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
favicon = '<link rel="icon" href="data:image/svg+xml,' + __import__('urllib.parse').parse.quote((src/'pwa'/'icona.svg').read_text().replace('\n', '')) + '">\n<meta name="theme-color" content="#0c6c80">'
full = f'<!doctype html>\n<html lang="it">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n{title}\n{favicon}\n<meta name="description" content="Editor ed esecutore di diagrammi di flusso compatibile con i file .fprg">\n{fonts}\n<style>\n{css}\n</style>\n</head>\n<body>\n{body}\n<script>\n{js}\n</script>\n</body>\n</html>\n'
(out/'FlowLab.html').write_text(full)
# installazione come app (PWA) dalla versione online: manifest, service worker (versione = impronta della pagina), icone
import hashlib, shutil
manifest = {
  'id': './FlowLab.html', 'name': 'FlowLab', 'short_name': 'FlowLab', 'lang': 'it',
  'description': 'Editor ed esecutore di diagrammi di flusso compatibile con i file .fprg',
  'start_url': './FlowLab.html', 'scope': './', 'display': 'standalone',
  'background_color': '#e9edf1', 'theme_color': '#0c6c80',
  'icons': [{'src': 'icona-192.png', 'sizes': '192x192', 'type': 'image/png', 'purpose': 'any'},
            {'src': 'icona-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'any'},
            {'src': 'icona-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'maskable'}],
}
(out/'manifest.webmanifest').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
(out/'sw.js').write_text((src/'pwa'/'sw.js').read_text().replace('__VERSIONE__', hashlib.sha1(full.encode()).hexdigest()[:12]))
for n in ('icona-192.png', 'icona-512.png'): shutil.copy(src/'pwa'/n, out/n)
print(len(full)//1024, 'KB')
