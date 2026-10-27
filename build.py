import re, pathlib
src = pathlib.Path('src')
js_files = ['expr.js','model.js','interp.js','codegen.js','render.js','examples.js','arrayview.js','app.js']
js = '\n'.join((src/f).read_text() for f in js_files)
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
