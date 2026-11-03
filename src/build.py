"""src 아래 원본을 배포용 HTML 3개로 묶는다.

- index.html          : 홈 (src/home/index.html)
- 교범비교도구.html     : 작성자용 (src/author)
- 수정제안폼.html       : 제안자용 (src/form/form.html)

로고(src/assets, tools/make_logo.py로 생성)는 HTML 안에 그림 데이터로 넣는다.
실행: python src/build.py
결과 파일은 외부 라이브러리·인터넷 없이 동작한다.
"""
import base64
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(HERE, 'author')
JS_ORDER = ['zip.js', 'parse.js', 'analyze.js', 'diff.js', 'xlsx.js', 'hwpxwrite.js', 'llm.js', 'apply.js', 'app.js']


def read(*p):
    with open(os.path.join(SRC, *p), encoding='utf-8') as f:
        return f.read()


def data_uri(name, mime='image/png'):
    with open(os.path.join(HERE, 'assets', name), 'rb') as f:
        return f'data:{mime};base64,{base64.b64encode(f.read()).decode()}'


def write(name, html):
    out = os.path.join(ROOT, name)
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        f.write(html)
    print('built', name, f'{len(html.encode("utf-8")) // 1024} KB')


def shared(name):
    with open(os.path.join(HERE, 'shared', name), encoding='utf-8') as f:
        return f.read()


def logos(html):
    html = html.replace('{{LOGO}}', data_uri('logo.png')).replace('{{LOGO_MARK}}', data_uri('logo_mark.png'))
    # 온라인 설정: 같은 폴더의 config.js (없으면 오프라인 모드로 동작)
    html = html.replace('<!--CONFIG-->', '<script src="config.js"></script>')
    return html.replace('<!--CLOUD-->', f'<script>\n{shared("cloud.js")}</script>')


def build_author():
    html = read('index.html')
    css = read('style.css')
    js = '// ---- shared/cloud.js\n' + shared('cloud.js') + '\n' + '\n'.join(f'// ---- {name}\n' + read('js', name) for name in JS_ORDER)
    # HWP 원본의 최종본을 HWPX로 만들 때 쓰는 빈 한글 문서 틀 (tools/make_template.py로 생성)
    with open(os.path.join(SRC, 'assets', 'blank.hwpx'), 'rb') as f:
        js = f"// ---- assets/blank.hwpx\nconst HWPX_TEMPLATE = '{base64.b64encode(f.read()).decode()}';\n" + js
    html = html.replace('<!--STYLE-->', f'<style>\n{css}</style>')
    html = html.replace('<!--SCRIPTS-->', f'<script>\n{js.replace("</script", "<\\/script")}</script>')
    write('교범비교도구.html', logos(html))


def build_page(src, name):
    with open(os.path.join(HERE, *src), encoding='utf-8') as f:
        write(name, logos(f.read()))


def main():
    build_page(('home', 'index.html'), 'index.html')
    build_author()
    build_page(('form', 'form.html'), '수정제안폼.html')


if __name__ == '__main__':
    main()
