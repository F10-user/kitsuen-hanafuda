"""更新するたびに動かす。読み込むファイル名に版の番号を付けて、スマホのブラウザが古いファイルを使い続けないようにする。
使い方: python tools/bump_version.py
"""
import datetime
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
v = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).strftime('%Y%m%d-%H%M')

(ROOT / 'js' / 'version.js').write_text(f"export const VERSION = '{v}';\n", encoding='utf-8')

pat = re.compile(r"""((?:from|import)\s*\(?\s*['"]\./[\w-]+\.js)(\?v=[\w-]+)?(['"])""")
for f in (ROOT / 'js').glob('*.js'):
    text = f.read_text(encoding='utf-8')
    new = pat.sub(lambda m: f"{m.group(1)}?v={v}{m.group(3)}", text)
    if new != text:
        f.write_text(new, encoding='utf-8')

html = ROOT / 'index.html'
text = html.read_text(encoding='utf-8')
text = re.sub(r'(src="js/app\.js|href="css/style\.css)(\?v=[\w-]+)?"', lambda m: f'{m.group(1)}?v={v}"', text)
html.write_text(text, encoding='utf-8')
print('version', v)
