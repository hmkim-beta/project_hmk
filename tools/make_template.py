"""한글에서 저장한 빈 HWPX를 도구용 틀(src/author/assets/blank.hwpx)로 정리한다.

작성자·저장자·날짜 같은 개인 정보를 지운다. HWP 원본의 최종본을 HWPX로 만들 때 이 틀을 쓴다.
실행: python tools/make_template.py <한글에서 저장한 빈 문서.hwpx>
"""
import os, re, sys, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'src', 'author', 'assets', 'blank.hwpx')


def scrub(name, data):
    if name == 'Contents/content.hpf':
        s = data.decode('utf-8')
        s = re.sub(r'(<opf:meta name="(creator|lastsaveby|CreatedDate|ModifiedDate|date)" content="text">)[^<]*(</opf:meta>)', r'\1\3', s)
        return s.encode('utf-8')
    return data


def main(src):
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    zin = zipfile.ZipFile(src)
    with zipfile.ZipFile(OUT, 'w') as zout:
        for info in zin.infolist():
            data = scrub(info.filename, zin.read(info.filename))
            zout.writestr(info.filename, data, compress_type=zipfile.ZIP_STORED if info.filename == 'mimetype' else zipfile.ZIP_DEFLATED)
    print('template written', OUT, os.path.getsize(OUT), 'bytes')


if __name__ == '__main__':
    main(sys.argv[1])
