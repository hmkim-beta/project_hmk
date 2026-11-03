"""테스트용 샘플 생성기.

- samples/샘플_기존교범.hwpx, samples/샘플_신규교범.hwpx : 번호 밀림·추가·삭제·수정·이동·표·그림 변경을 넣은 가상 교범
- samples/샘플_정답지.md : 두 샘플 사이에 일부러 넣은 변경 목록
- samples/제안_*.json : 수정제안폼에서 저장한 것과 같은 형식의 제안 파일 3개

실행: python tools/make_samples.py
필요: 한글(한컴오피스)과 pywin32. 샘플 HWPX는 한글 자동화로 직접 만들어 저장하므로 한글에서 그대로 열린다.
"""
import base64, json, os, struct, sys, tempfile, time, zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'samples')


# ---------------------------------------------------------------- 문서 내용
# 항목: ('p', 텍스트) / ('toc', [줄...]) / ('table', 캡션, [[셀...]...]) / ('pic', 캡션)

def doc_old():
    return [
        ('p', '가상 야전교범 0-00 소부대 경계작전'),
        ('p', '(테스트용 가상 문서)'),
        ('toc', ['제1장 총칙\t1', '1-1. 목적\t1', '1-2. 적용 범위\t1', '제2장 경계 준비\t2', '제3장 경계 실시\t5']),
        ('p', '제1장 총칙'),
        ('p', '1-1. 목적'),
        ('p', '이 교범은 소대급 이하 부대가 경계작전을 계획하고 실시하는 데 필요한 절차와 방법을 제시하는 데 목적이 있다.'),
        ('p', '1-2. 적용 범위'),
        ('p', '이 교범은 보병 소대 및 분대에 적용하며, 다른 병과 부대는 임무와 편성에 맞게 준용한다.'),
        ('p', '1-3. 용어 정의'),
        ('p', '이 교범에서 사용하는 용어의 뜻은 다음과 같다.'),
        ('p', '가. "경계"란 적의 기습을 방지하고 아군의 행동의 자유를 보장하기 위한 제반 조치를 말한다.'),
        ('p', '나. "경계 진지"란 경계 임무를 수행하기 위하여 점령하는 진지를 말한다.'),
        ('p', '제2장 경계 준비'),
        ('p', '제1절 계획 수립'),
        ('p', '2-1. 임무 분석'),
        ('p', '소대장은 상급 부대 작전명령을 수령하면 즉시 임무를 분석하고 가용 시간을 판단한다.'),
        ('p', '2-2. 경계 계획 작성'),
        ('p', '경계 계획에는 경계 구역, 근무 편성, 보고 절차가 포함되어야 하며 세부 내용은 표 2-1과 같다.'),
        ('table', '표 2-1 경계 계획 구성 요소', [['구분', '내용', '담당'], ['경계 구역', '책임 지역과 인접 부대 협조점', '소대장'], ['근무 편성', '근무 조와 교대 시간', '부소대장']]),
        ('p', '2-3. 보고 체계'),
        ('p', '경계 근무 간 모든 보고는 분대장을 거쳐 소대장에게 하며, 긴급 상황은 직접 보고할 수 있다.'),
        ('p', '제2절 경계 편성'),
        ('p', '2-4. 경계 진지 선정'),
        ('p', '경계 진지는 관측과 사계가 양호하고 은폐와 엄폐가 가능한 곳에 선정한다.'),
        ('p', '2-5. 장애물 설치'),
        ('p', '장애물은 접근로를 차단하도록 설치하며, 설치 예는 그림 2-1과 같다.'),
        ('pic', '그림 2-1 철조망 설치 예'),
        ('p', '2-6. 통신 수단 운용'),
        ('p', '경계 진지와 소대 지휘소 간에는 유선과 무선을 함께 운용하여 통신 두절에 대비한다.'),
        ('p', '제3장 경계 실시'),
        ('p', '3-1. 근무 교대'),
        ('p', '근무 교대는 정해진 시간에 실시하며, 교대 시 인계 사항을 구두로 확인한다.'),
        ('p', '3-2. 이상 징후 식별'),
        ('p', '경계병은 소리, 불빛, 움직임 등 이상 징후를 식별하면 즉시 보고한다.'),
        ('p', '3-3. 상황 보고'),
        ('p', '상황 보고는 육하원칙에 따라 간결하게 한다.'),
        ('p', '3-4. 야간 경계'),
        ('p', '야간에는 청음 위주로 경계하며 야간 투시 장비를 적극 활용한다. 운용 예는 그림 3-1과 같다.'),
        ('pic', '그림 3-1 야간 투시 장비 운용 예'),
        ('p', '3-5. 철수'),
        ('p', '경계 임무가 종료되면 장애물과 진지를 정리하고 지정된 집결지로 철수한다.'),
    ]


def doc_new():
    return [
        ('p', '가상 야전교범 0-00 소부대 경계작전'),
        ('p', '(테스트용 가상 문서)'),
        ('toc', ['제1장 총칙\t1', '1-1. 목적\t1', '1-2. 기본 원칙\t1', '제2장 경계 준비\t2', '제3장 경계 근무 실시\t5']),
        ('p', '제1장 총칙'),
        ('p', '1-1. 목적'),
        ('p', '이 교범은 소대급 이하 부대가 경계작전을 계획하고 실시하는 데 필요한 절차와 방법을 제시하는 데 목적이 있다.'),
        # [C1] 추가
        ('p', '1-2. 기본 원칙'),
        ('p', '경계작전은 조기 경보, 지속적 관측, 신속한 보고를 기본 원칙으로 한다.'),
        # 번호만 변경 (1-2 → 1-3)
        ('p', '1-3. 적용 범위'),
        ('p', '이 교범은 보병 소대 및 분대에 적용하며, 다른 병과 부대는 임무와 편성에 맞게 준용한다.'),
        # [C2] 수정 (번호도 1-3 → 1-4)
        ('p', '1-4. 용어 정의'),
        ('p', '이 교범에서 사용하는 용어의 뜻은 다음과 같다.'),
        ('p', '가. "경계"란 적의 기습을 방지하고 아군의 행동의 자유를 보장하기 위한 제반 조치를 말한다.'),
        ('p', '나. "경계 진지"란 경계 임무를 수행하기 위하여 점령하는 진지를 말한다.'),
        ('p', '다. "청음초"란 적의 접근을 소리로 조기에 탐지하기 위하여 운용하는 경계 요소를 말한다.'),
        ('p', '제2장 경계 준비'),
        ('p', '제1절 계획 수립'),
        ('p', '2-1. 임무 분석'),
        ('p', '소대장은 상급 부대 작전명령을 수령하면 즉시 임무를 분석하고 가용 시간을 판단한다.'),
        # [C5] 표 셀 수정
        ('p', '2-2. 경계 계획 작성'),
        ('p', '경계 계획에는 경계 구역, 근무 편성, 보고 절차가 포함되어야 하며 세부 내용은 표 2-1과 같다.'),
        ('table', '표 2-1 경계 계획 구성 요소', [['구분', '내용', '담당'], ['경계 구역', '책임 지역과 인접 부대 협조점', '소대장'], ['근무 편성', '근무 조와 교대 시간', '분대장']]),
        # [C3] 2-3 보고 체계 삭제
        ('p', '제2절 경계 편성'),
        ('p', '2-3. 경계 진지 선정'),
        ('p', '경계 진지는 관측과 사계가 양호하고 은폐와 엄폐가 가능한 곳에 선정한다.'),
        # [C6] 그림 캡션 변경 (번호도 2-5 → 2-4)
        ('p', '2-4. 장애물 설치'),
        ('p', '장애물은 접근로를 차단하도록 설치하며, 설치 예는 그림 2-1과 같다.'),
        ('pic', '그림 2-1 철조망 및 지뢰 설치 예'),
        # [C9] 장 제목 수정
        ('p', '제3장 경계 근무 실시'),
        ('p', '3-1. 근무 교대'),
        ('p', '근무 교대는 정해진 시간에 실시하며, 교대 시 인계 사항을 구두로 확인한다.'),
        # [C4] 이동 (제2장 2-6 → 제3장 3-2)
        ('p', '3-2. 통신 수단 운용'),
        ('p', '경계 진지와 소대 지휘소 간에는 유선과 무선을 함께 운용하여 통신 두절에 대비한다.'),
        # [C8] 수정
        ('p', '3-3. 이상 징후 식별'),
        ('p', '경계병은 소리, 불빛, 움직임, 냄새 등 이상 징후를 식별하면 즉시 분대장에게 보고하고 관측을 계속한다.'),
        ('p', '3-4. 상황 보고'),
        ('p', '상황 보고는 육하원칙에 따라 간결하게 한다.'),
        # [C7] 그림 삭제
        ('p', '3-5. 야간 경계'),
        ('p', '야간에는 청음 위주로 경계하며 야간 투시 장비를 적극 활용한다. 운용 예는 그림 3-1과 같다.'),
        ('p', '3-6. 철수'),
        ('p', '경계 임무가 종료되면 장애물과 진지를 정리하고 지정된 집결지로 철수한다.'),
        # [C10] 추가
        ('p', '3-7. 사후 강평'),
        ('p', '철수 후 소대장은 경계 근무 간 식별된 문제점과 개선 사항을 강평하고 결과를 상급 부대에 보고한다.'),
    ]


ANSWER = """# 샘플 정답지 (샘플_기존교범.hwpx → 샘플_신규교범.hwpx)

일부러 넣은 변경 **10건**입니다. 도구가 이 10건을 모두 잡아내야 합니다.

| # | 유형 | 기존 | 신규 | 내용 |
|---|---|---|---|---|
| C1 | 추가 | - | 1-2. 기본 원칙 | 조항 신설 (이후 제1장 번호가 하나씩 밀림) |
| C2 | 수정 | 1-3. 용어 정의 | 1-4. 용어 정의 | "다. 청음초" 정의 추가 (번호 변경 포함) |
| C3 | 삭제 | 2-3. 보고 체계 | - | 조항 삭제 (이후 제2장 번호가 하나씩 당겨짐) |
| C4 | 이동 | 2-6. 통신 수단 운용 (제2장) | 3-2. 통신 수단 운용 (제3장) | 내용 동일, 위치 이동 |
| C5 | 수정 | 2-2. 경계 계획 작성 | 2-2. 경계 계획 작성 | 표 2-1 셀 "부소대장" → "분대장" |
| C6 | 수정 | 2-5. 장애물 설치 | 2-4. 장애물 설치 | 그림 2-1 캡션 변경 (번호 변경 포함) |
| C7 | 수정 | 3-4. 야간 경계 | 3-5. 야간 경계 | 그림 3-1 삭제 (번호 변경 포함) |
| C8 | 수정 | 3-2. 이상 징후 식별 | 3-3. 이상 징후 식별 | 문장 수정 (번호 변경 포함) |
| C9 | 수정 | 제3장 경계 실시 | 제3장 경계 근무 실시 | 장 제목 변경 |
| C10 | 추가 | - | 3-7. 사후 강평 | 조항 신설 |

## 번호만 바뀐 조항 (동일로 분류되고 "번호 변경" 배지가 붙어야 함)

- 1-2. 적용 범위 → 1-3
- 2-4. 경계 진지 선정 → 2-3
- 3-3. 상황 보고 → 3-4
- 3-5. 철수 → 3-6

## 그 밖의 확인 사항

- 앞쪽 목차(탭 + 쪽 번호 줄)는 조항으로 인식하지 않아야 합니다.
"""

# ---------------------------------------------------------------- HWPX 쓰기 (한글이 직접 만듦)
# 한글 자동화(COM)로 문단·표·그림을 넣고 HWPX로 저장한다. 그래서 한글에서 그대로 열리는 진짜 한글 문서가 된다.
# 표·그림의 캡션은 개체 바로 앞 문단("표 2-1 …", "그림 2-1 …")으로 넣는다. 도구는 이 줄을 캡션으로 인식한다.

class Hangul:
    def __init__(self):
        import win32com.client  # pywin32
        self.hwp = win32com.client.Dispatch('HWPFrame.HwpObject')
        try:
            self.hwp.XHwpWindows.Item(0).Visible = False
        except Exception:
            pass

    def new(self):
        self.hwp.Clear(1)  # 지금 문서를 버리고 빈 문서로

    def text(self, s):
        act, ps = self.hwp.HAction, self.hwp.HParameterSet.HInsertText
        act.GetDefault('InsertText', ps.HSet)
        ps.Text = s
        act.Execute('InsertText', ps.HSet)

    def para(self, s=''):
        if s:
            self.text(s)
        self.hwp.HAction.Run('BreakPara')

    def table(self, rows):
        act, tc = self.hwp.HAction, self.hwp.HParameterSet.HTableCreation
        act.GetDefault('TableCreate', tc.HSet)
        tc.Rows, tc.Cols = len(rows), len(rows[0])
        tc.WidthType, tc.HeightType = 2, 0  # 단 너비에 맞춤, 높이 자동
        act.Execute('TableCreate', tc.HSet)
        cells = [c for r in rows for c in r]
        for i, c in enumerate(cells):
            self.text(c)
            if i < len(cells) - 1:
                act.Run('TableRightCell')
        act.Run('MoveDocEnd')  # 표 밖(문서 끝)으로
        self.para()

    def picture(self, path):
        # 포함(embedded), 지정 크기 60×36mm
        self.hwp.InsertPicture(path, True, 1, False, False, 0, 60, 36)
        self.hwp.HAction.Run('MoveDocEnd')
        self.para()

    def save(self, path):
        # 한글은 저장한 파일을 계속 열어 두므로, 같은 이름에 다시 저장하면 보이지 않는 대화상자에서 멈춘다.
        # 새 임시 경로에 저장하고 문서를 닫은 뒤 옮긴다.
        tmp = os.path.join(tempfile.mkdtemp(), 'out.hwpx')
        if not self.hwp.SaveAs(tmp, 'HWPX', ''):
            return False
        self.hwp.Clear(1)
        for _ in range(10):
            try:
                os.replace(tmp, path)
                return True
            except PermissionError:
                time.sleep(0.5)
        raise RuntimeError(f'{path} 파일이 다른 프로그램에서 열려 있어 바꾸지 못했습니다.')

    def quit(self):
        try:
            self.hwp.Clear(1)
            self.hwp.Quit()
        except Exception:
            pass


def write_hwpx(han, path, items, pic_path):
    print('한글로 만드는 중:', os.path.basename(path), flush=True)
    han.new()
    for it in items:
        if it[0] == 'p':
            han.para(it[1])
        elif it[0] == 'toc':
            han.para('목  차')
            for line in it[1]:
                han.para(line)
        elif it[0] == 'table':
            han.para(it[1])          # 캡션 줄
            han.table(it[2])
        elif it[0] == 'pic':
            han.para(it[1])          # 캡션 줄
            han.picture(pic_path)
    if not han.save(path):
        raise RuntimeError('한글에서 저장하지 못했습니다: ' + path)

# ---------------------------------------------------------------- 제안 파일

def tiny_png(w=64, h=40, rgb=(200, 60, 60)):
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))
    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xFFFFFFFF)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
    return 'data:image/png;base64,' + base64.b64encode(png).decode()


def proposal_file(name, proposer, items):
    manual = '가상 야전교범 0-00 소부대 경계작전'
    data = {
        'type': 'kyobeom-proposal', 'version': 1, 'savedAt': '2026-10-20T09:00:00.000Z',
        'proposer': proposer, 'manual': manual,
        'items': [dict(it, location=dict(it['location'], manual=manual)) for it in items],
    }
    with open(os.path.join(OUT, name), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)


def write_proposals():
    proposal_file('제안_가상교범_1사단_홍길동_20261020.json',
                  {'unit': '제1보병사단 11연대 3대대', 'rank': '중사', 'name': '홍길동', 'contact': '010-0000-0001'}, [
        {'uid': 'smp-001', 'location': {'page': '3', 'clause': '1-3', 'table': '', 'figure': ''}, 'category': '추가',
         'current': '가. 경계 / 나. 경계 진지 정의만 있음', 'proposed': '"청음초" 용어 정의 추가', 'reason': '야간 경계 시 청음초 운용이 일반화됨', 'images': []},
        {'uid': 'smp-002', 'location': {'page': '7', 'clause': '2-2', 'table': '표 2-1', 'figure': ''}, 'category': '내용 수정',
         'current': '근무 편성 담당: 부소대장', 'proposed': '근무 편성 담당: 분대장', 'reason': '실제 근무 편성은 분대장이 함', 'images': []},
    ])
    proposal_file('제안_가상교범_2사단_김철수_20261021.json',
                  {'unit': '제2보병사단 수색대대', 'rank': '상사', 'name': '김철수', 'contact': '010-0000-0002'}, [
        {'uid': 'smp-003', 'location': {'page': '9', 'clause': '2-5', 'table': '', 'figure': '그림 2-1'}, 'category': '그림 변경',
         'current': '철조망만 표시됨', 'proposed': '지뢰 설치 예도 함께 표시', 'reason': '실제 장애물 구성과 맞지 않음', 'images': [{'name': '그림2-1_수정안.png', 'type': 'image/png', 'data': tiny_png()}]},
    ])
    proposal_file('제안_가상교범_3여단_이영희_20261022.json',
                  {'unit': '제3기갑여단 본부중대', 'rank': '대위', 'name': '이영희', 'contact': '010-0000-0003'}, [
        {'uid': 'smp-004', 'location': {'page': '', 'clause': '3-2', 'table': '', 'figure': ''}, 'category': '내용 수정',
         'current': '이상 징후를 식별하면 즉시 보고한다.', 'proposed': '이상 징후를 식별하면 즉시 분대장에게 보고하고 관측을 계속한다.', 'reason': '보고 후 관측 중단 사례 다수', 'images': []},
        {'uid': 'smp-005', 'location': {'page': '12', 'clause': '3-4', 'table': '', 'figure': '그림 3-1'}, 'category': '삭제',
         'current': '그림 3-1 야간 투시 장비 운용 예', 'proposed': '그림 삭제', 'reason': '구형 장비 사진임', 'images': [{'name': '참고.png', 'type': 'image/png', 'data': tiny_png(rgb=(60, 120, 200))}]},
        {'uid': 'smp-006', 'location': {'page': '1', 'clause': '1-1', 'table': '', 'figure': ''}, 'category': '오타·표현',
         'current': '제시하는 데 목적이 있다.', 'proposed': '제시하는 것을 목적으로 한다.', 'reason': '표현 통일', 'images': []},
    ])


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    pic = os.path.join(tempfile.mkdtemp(), 'sample_figure.png')
    with open(pic, 'wb') as f:
        f.write(base64.b64decode(tiny_png(320, 192, (90, 150, 160)).split(',', 1)[1]))
    han = Hangul()
    try:
        write_hwpx(han, os.path.join(OUT, '샘플_기존교범.hwpx'), doc_old(), pic)
        write_hwpx(han, os.path.join(OUT, '샘플_신규교범.hwpx'), doc_new(), pic)
    finally:
        han.quit()
    with open(os.path.join(OUT, '샘플_정답지.md'), 'w', encoding='utf-8') as f:
        f.write(ANSWER)
    write_proposals()
    print('samples written to', OUT)
