"""단독망(인터넷 없는 PC)용 실행 패키지를 만든다.

결과: release/신구대조전_단독망_YYYYMMDD.zip
  신구대조전/
    시작하기.bat        ← 더블클릭: 로컬 서버(127.0.0.1:8080)를 띄우고 브라우저를 엶
    index.html          ← 서버 없이 더블클릭해도 동작
    교범비교도구.html, 수정제안폼.html
    samples/            ← 연습용 가상 교범·제안 파일
    tools/serve.ps1     ← PowerShell만으로 동작하는 로컬 웹 서버
    사용안내.txt

- 온라인(Supabase) 설정 config.js는 넣지 않는다 → 항상 오프라인 모드.
- 실행 전 python src/build.py 로 HTML을 최신으로 만든다 (--no-build로 생략 가능).
실행: python tools/make_offline_package.py
"""
import datetime, os, re, shutil, subprocess, sys, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'release')
PKG = '신구대조전'
PAGES = ['index.html', '교범비교도구.html', '수정제안폼.html']

BAT = r'''@echo off
chcp 949 >nul
title 신구대조전 (단독망)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\serve.ps1"
if errorlevel 1 (
  echo.
  echo [안내] 로컬 서버를 시작하지 못했습니다.
  echo        index.html 을 더블클릭해서 브라우저로 바로 열어도 모든 기능을 쓸 수 있습니다.
  echo.
  pause
)
'''

GUIDE = '''신구대조전 — 교범 신·구 비교 도구 (단독망용)
=====================================================

인터넷이 연결되지 않은 PC에서 쓰는 패키지입니다.
설치할 것이 없고, 모든 처리는 이 PC 안에서만 이루어집니다. 외부로 전송되는 내용이 없습니다.


1. 시작하기 (둘 중 하나)
-----------------------------------------------------
[방법 1] 시작하기.bat 더블클릭  ← 권장
  - 검은 창(로컬 서버)이 뜨고, 브라우저가 http://127.0.0.1:8080/ 으로 열립니다.
  - 작업하는 동안 검은 창을 닫지 마세요. 창을 닫으면 서버가 멈춥니다.
  - 이 주소는 이 PC 안에서만 열립니다. 다른 PC에서는 접속할 수 없습니다.

[방법 2] index.html 더블클릭
  - 서버 없이 브라우저로 바로 열립니다. 기능은 같습니다.
  - PowerShell 실행이 막혀 있는 PC에서는 이 방법을 쓰세요.

권장 브라우저: Chrome 또는 Edge (최신 버전)


2. 처음 쓰는 경우
-----------------------------------------------------
  - 홈 화면의 [샘플로 체험하기] : 가상 교범 2권과 샘플 제안 6건으로 작성자 도구 전 과정을
    10단계 안내에 따라 연습합니다. 실제 작업과 따로 저장됩니다.
  - 홈 화면의 [작성 예시 보기] : 제안서 작성 예시와 작성 요령을 봅니다.
  - samples 폴더에 연습용 가상 교범(HWPX)과 제안 파일(.json)이 있습니다.


3. 화면 구성
-----------------------------------------------------
  - index.html          홈 (작성자용·제안자용 입구)
  - 교범비교도구.html     작성자용: 신·구 비교, 제안 종합, 수정 반영, 종합 평가
  - 수정제안폼.html       제안자용: 수정 제안 작성 → .json 파일로 저장해 담당자에게 전달


4. 작업 저장과 백업 (중요)
-----------------------------------------------------
  - 작업 내용은 브라우저에 자동 저장됩니다.
  - 브라우저는 "주소마다" 따로 저장합니다.
      http://127.0.0.1:8080/ 에서 한 작업과, index.html 을 직접 연 작업은 서로 보이지 않습니다.
      한 가지 방법으로 계속 쓰세요.
  - 브라우저의 "쿠키 및 사이트 데이터"를 지우면 작업이 사라집니다.
    작성자 도구의 [작업 파일 저장]으로 수시로 .json 백업을 남기고,
    다른 PC나 다른 방법으로 옮길 때는 [작업 파일 불러오기]를 쓰세요.


5. 단독망에서의 동작
-----------------------------------------------------
  - 수정 제안은 [제안 파일 저장]으로 만든 .json 파일을 USB·공유폴더 등으로 전달합니다.
    (온라인 제출 기능은 이 패키지에서 꺼져 있습니다.)
  - 작성자 총평은 [통계 기반 초안 작성]으로 LLM 없이 만듭니다.
    폐쇄망 LLM이 있으면 [TXT 내려받기]·[PDF 내려받기]로 요청문을 받아 직접 넣으세요.
  - 결과 파일: 대비표·종합 엑셀(.xlsx), 최종본(.hwpx), 첨부 이미지(.zip)는 브라우저의
    "다운로드" 폴더에 저장됩니다.


6. 문제가 생기면
-----------------------------------------------------
  - "8080 포트를 다른 프로그램이 쓰고 있어…" : 다른 포트(8081 등)로 열립니다.
    이때 브라우저에 저장된 작업은 포트마다 따로 보이므로, 작업 파일로 옮기세요.
  - 검은 창이 바로 닫히거나 "서버를 시작하지 못했습니다" : [방법 2]로 여세요.
  - 화면이 이상하면 브라우저에서 Ctrl+F5 (새로고침)를 눌러 보세요.

패키지 생성일: {date}
'''


def check_offline(html, name):
    """외부 주소에서 스크립트·스타일·그림을 불러오는 코드가 없는지 검사."""
    bad = re.findall(r'''(?:src|href)\s*=\s*["'](https?:)?//[^"']+''', html)
    bad += re.findall(r'''@import\s+url\(\s*["']?https?://''', html)
    if bad:
        raise SystemExit(f'{name}: 외부 주소를 불러오는 코드가 있습니다 → {bad[:3]}')


def main():
    if '--no-build' not in sys.argv:
        subprocess.run([sys.executable, os.path.join(ROOT, 'src', 'build.py')], check=True)
    date = datetime.date.today().strftime('%Y%m%d')
    stage = os.path.join(OUT_DIR, 'stage', PKG)
    shutil.rmtree(os.path.join(OUT_DIR, 'stage'), ignore_errors=True)
    os.makedirs(os.path.join(stage, 'tools'))

    for page in PAGES:
        with open(os.path.join(ROOT, page), encoding='utf-8') as f:
            check_offline(f.read(), page)
        shutil.copy2(os.path.join(ROOT, page), stage)
    shutil.copytree(os.path.join(ROOT, 'samples'), os.path.join(stage, 'samples'))

    # PowerShell 5.1은 BOM이 없으면 한글을 깨뜨리므로 UTF-8(BOM)으로 저장
    with open(os.path.join(ROOT, 'tools', 'offline', 'serve.ps1'), encoding='utf-8') as f:
        ps = f.read()
    with open(os.path.join(stage, 'tools', 'serve.ps1'), 'w', encoding='utf-8-sig', newline='\r\n') as f:
        f.write(ps)
    # 배치 파일은 한글 윈도우 기본 코드페이지(949)로
    with open(os.path.join(stage, '시작하기.bat'), 'w', encoding='cp949', newline='\r\n') as f:
        f.write(BAT)
    with open(os.path.join(stage, '사용안내.txt'), 'w', encoding='utf-8-sig', newline='\r\n') as f:
        f.write(GUIDE.replace('{date}', datetime.date.today().isoformat()))

    assert not os.path.exists(os.path.join(stage, 'config.js'))
    zpath = os.path.join(OUT_DIR, f'{PKG}_단독망_{date}.zip')
    if os.path.exists(zpath):
        os.remove(zpath)
    with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED) as z:
        for base, _, files in os.walk(os.path.join(OUT_DIR, 'stage')):
            for name in sorted(files):
                full = os.path.join(base, name)
                z.write(full, os.path.relpath(full, os.path.join(OUT_DIR, 'stage')))
    size = os.path.getsize(zpath) // 1024
    print(f'패키지: {zpath} ({size} KB)')
    for n in zipfile.ZipFile(zpath).namelist():
        print('  ', n)


if __name__ == '__main__':
    main()
