"""로고 이미지를 화면용으로 정리한다.

- src/assets/logo.png      : 여백을 잘라낸 전체 로고 (홈 화면)
- src/assets/logo_mark.png : 문서 캐릭터 부분만 (도구 머리글 아이콘)
흰 배경은 투명하게 바꾼다. build.py가 이 파일들을 HTML 안에 넣는다.

실행: python tools/make_logo.py <로고 이미지>
"""
import os, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'src', 'assets')


def transparent_white(im, soft=40):
    # 흰색에 가까울수록 투명하게 (가장자리 계단 현상 방지)
    im = im.convert('RGBA')
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            d = 255 - min(r, g, b)
            if d < soft:
                px[x, y] = (r, g, b, int(a * d / soft))
    return im


def trim(im, pad=12):
    box = im.getchannel('A').point(lambda v: 255 if v > 16 else 0).getbbox()
    l, t, r, b = box
    return im.crop((max(0, l - pad), max(0, t - pad), min(im.width, r + pad), min(im.height, b + pad)))


def main(src):
    os.makedirs(OUT, exist_ok=True)
    im = trim(transparent_white(Image.open(src)))
    full = im.copy()
    full.thumbnail((960, 960), Image.LANCZOS)
    full.save(os.path.join(OUT, 'logo.png'), optimize=True)
    # 글자('신') 왼쪽까지가 캐릭터 부분: 전체 폭의 약 40%에서 가장 깨끗한 빈 세로줄을 찾음
    alpha = im.getchannel('A')
    cols = [sum(1 for y in range(im.height) if alpha.getpixel((x, y)) > 16) for x in range(im.width)]
    lo, hi = int(im.width * 0.33), int(im.width * 0.45)
    cut = min(range(lo, hi), key=lambda x: cols[x])
    mark = trim(im.crop((0, 0, cut, im.height)), pad=6)
    mark.thumbnail((256, 256), Image.LANCZOS)
    mark.save(os.path.join(OUT, 'logo_mark.png'), optimize=True)
    for n in ('logo.png', 'logo_mark.png'):
        p = os.path.join(OUT, n)
        print(n, Image.open(p).size, os.path.getsize(p), 'bytes')


if __name__ == '__main__':
    main(sys.argv[1])
