import re, pathlib
src = pathlib.Path('src')
js_files = ['i18n.js','expr.js','model.js','interp.js','codegen.js','render.js','uml.js','pdf.js','examples.js','arrayview.js','app.js']
js = '\n'.join((src/f).read_text() for f in js_files)
# module library (modules/<topic>/<Name>.fprg) built into the page: used when GitHub cannot be reached
import json
mod_root = pathlib.Path('modules')
title = lambda t: (lambda x: x[:1].upper() + x[1:])(re.sub(r'[_-]+', ' ', t).strip())
lib = [{'topic': t.name, 'topicTitle': title(t.name), 'id': f.stem, 'text': f.read_text()}
       for t in sorted(p for p in mod_root.iterdir() if p.is_dir()) for f in sorted(t.glob('*.fprg'))]
# examples (examples/<code>/index.json and the .fprg files) built into the page
exs = {}
for d in sorted(p for p in pathlib.Path('examples').iterdir() if p.is_dir() and (p/'index.json').exists()):
    exs[d.name] = [dict(e, text=(d/(e['id'] + '.fprg')).read_text()) for e in json.loads((d/'index.json').read_text())]
js = 'const EXAMPLES = ' + json.dumps(exs, ensure_ascii=False).replace('</', '<\\/') + ';\n' + js
# languages (languages/<code>.json) built into the page: they work offline
langs = {f.stem: json.loads(f.read_text()) for f in sorted(pathlib.Path('languages').glob('*.json'))}
js = 'const LANGUAGES = ' + json.dumps(langs, ensure_ascii=False).replace('</', '<\\/') + ';\n' + js
js = 'const ModuleLibrary = ' + json.dumps(lib, ensure_ascii=False).replace('</', '<\\/') + ';\n' + js
# Stage: its code (src/stage.js) and the stages of the examples (stages/) are only text in the page, run only when a stage is opened
stage_dir = pathlib.Path('stages')
stage_lib = [dict(e, text=(stage_dir/(e['id'] + '.flstage')).read_text()) for e in json.loads((stage_dir/'index.json').read_text())]
js = 'const STAGE_SRC = ' + json.dumps((src/'stage.js').read_text(), ensure_ascii=False).replace('</', '<\\/') + ';\nconst STAGE_LIB = ' + json.dumps(stage_lib, ensure_ascii=False).replace('</', '<\\/') + ';\n' + js
assert '</script' not in js
css = (src/'style.css').read_text()
body = (src/'body.html').read_text()
fonts = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=JetBrains+Mono:wght@400;600&display=swap">'
title = '<title>FlowLab</title>'
inner = f'{title}\n<meta name="description" content="Flowchart editor and runner compatible with .fprg files">\n{fonts}\n<style>\n{css}\n</style>\n{body}\n<script>\n{js}\n</script>\n'
out = pathlib.Path('dist'); out.mkdir(exist_ok=True)
(out/'artifact.html').write_text(inner)
favicon = '<link rel="icon" href="data:image/svg+xml,' + __import__('urllib.parse').parse.quote((src/'pwa'/'icon.svg').read_text().replace('\n', '')) + '">\n<meta name="theme-color" content="#0c6c80">'
full = f'<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n{title}\n{favicon}\n<meta name="description" content="Flowchart editor and runner compatible with .fprg files">\n{fonts}\n<style>\n{css}\n</style>\n</head>\n<body>\n{body}\n<script>\n{js}\n</script>\n</body>\n</html>\n'
(out/'FlowLab.html').write_text(full)
# installation as an app (PWA) from the online version: manifest, service worker (version = fingerprint of the page), icons
import hashlib, shutil
manifest = {
  'id': './FlowLab.html', 'name': 'FlowLab', 'short_name': 'FlowLab', 'lang': 'en',
  'description': 'Flowchart editor and runner compatible with .fprg files',
  'start_url': './FlowLab.html', 'scope': './', 'display': 'standalone',
  'background_color': '#e9edf1', 'theme_color': '#0c6c80',
  'icons': [{'src': 'icon-192.png', 'sizes': '192x192', 'type': 'image/png', 'purpose': 'any'},
            {'src': 'icon-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'any'},
            {'src': 'icon-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'maskable'}],
  # installed app: opens .fprg files (double-click, «Open with»), each in its own window
  'file_handlers': [{'action': './FlowLab.html', 'accept': {'application/x-fprg': ['.fprg']},
                     'icons': [{'src': 'icon-512.png', 'sizes': '512x512', 'type': 'image/png'}], 'launch_type': 'multiple-clients'}],
}
(out/'manifest.webmanifest').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
(out/'sw.js').write_text((src/'pwa'/'sw.js').read_text().replace('__VERSION__', hashlib.sha1(full.encode()).hexdigest()[:12]))
for n in ('icon-192.png', 'icon-512.png'): shutil.copy(src/'pwa'/n, out/n)
print(len(full)//1024, 'KB')
