# 신구대조전 — 작업 인수인계 (Claude Code용)

교범(훈령) 개정 업무용 웹앱. 요구사항은 `PRD_교범_신구비교도구.md`, 사용자용 설명은 `README.md`, 소개글은 `docs/포트폴리오_소개.md`.
사용자와의 대화·화면 문구·문서는 **한국어**로 쓴다.

## 지켜야 할 원칙
- **폐쇄망 우선**: 외부 라이브러리·CDN·폰트 없이 HTML 파일만으로 동작해야 한다. 외부 주소를 불러오는 코드를 넣지 않는다(`tools/make_offline_package.py`가 검사함).
- **교범 내용은 PC 밖으로 보내지 않는다.** 온라인 기능은 수정 제안 제출·수집(Supabase)뿐이고, `config.js`가 없으면 자동으로 꺼진다.
- **루트의 HTML 3개는 빌드 결과물**이다. 직접 고치지 말고 `src/`를 고친 뒤 `python src/build.py`.
- 총평은 **LLM 없이 통계 기반**(`statsDraft()`). LLM은 요청문 TXT·PDF 내려받기로 수동 처리. 폐쇄망 LLM 직접 연결·Gemini 코드는 `src/author/js/llm.js`에 주석으로 보관.

## 구조
| 경로 | 내용 |
|---|---|
| `src/home/index.html` | 홈 → `index.html` |
| `src/author/` | 작성자 도구 → `교범비교도구.html` (index.html, style.css, js/) |
| `src/author/js/` | zip(ZIP·inflate), parse(HWP·HWPX), analyze(조항 분할·매칭), diff, xlsx(읽기·쓰기), hwpxwrite(최종본 HWPX), llm(요청문), apply(수정 반영), sample(샘플 체험), app(화면) |
| `src/form/form.html` | 제안자 폼 → `수정제안폼.html` |
| `src/shared/cloud.js` | Supabase REST 호출 (두 도구에 들어감) |
| `src/assets/` | 로고 (`tools/make_logo.py`), `src/author/assets/blank.hwpx` (`tools/make_template.py`) |
| `samples/` | 가상 교범 HWPX 2개(한글 COM으로 생성)·정답지·제안 JSON 3개. 빌드 때 작성자 도구에 샘플 체험 데이터로 들어감 |
| `supabase/schema.sql` | 제안 표(공개 키는 insert만), 작성자 접근 키 해시, `list_proposals` 함수 |
| `vercel.json`, `scripts/build-vercel.mjs` | Vercel: 배포 파일만 `dist/`로, 환경 변수로 `config.js` 생성 |
| `tools/offline/serve.ps1`, `tools/make_offline_package.py` | 단독망 패키지(`release/*.zip`, PowerShell 로컬 서버 포함) |
| `docs/` | LLM 연동 메모, Vercel·Supabase 배포 안내, 포트폴리오 소개 |

## 자주 쓰는 명령
```bash
python src/build.py                      # 원본 → 루트 HTML 3개
python tools/make_offline_package.py     # 단독망 ZIP (release/)
python tools/make_samples.py             # 샘플 재생성 (한글+pywin32 필요)
```
로컬 확인: `.claude/launch.json`의 `교범도구`(python http.server 8080). 온라인 기능 시험은 루트에 `config.js`(git 제외, `config.example.js` 참고).

## 시험 방법 (이전 작업에서 쓴 방식)
- 화면: 브라우저에서 `window.App`(P, R, Sample, ApplyTab, loadDoc …)으로 상태 확인. 샘플은 `교범비교도구.html?sample=1`.
- 정답 확인: 샘플 교범 비교 시 변경 10건·번호만 변경 4건이어야 함 (`samples/샘플_정답지.md`).
- HWPX 결과: 이 PC의 한글 2024 COM(`HWPFrame.HwpObject`)으로 열어 `GetTextFile('UNICODE','')` 텍스트를 원본과 diff, `CreatePageImage`로 쪽 이미지 확인. 한글은 저장한 파일을 열어 두므로 같은 경로에 다시 저장하지 말 것.
- Supabase·Gemini 등 외부 API는 실제 키 없이 fetch 가로채기(모의 응답)로 시험했다.

## 연결된 서비스
| 서비스 | 위치 | 비고 |
|---|---|---|
| GitHub | `hmkim-beta/project_hmk` (main) | push하면 Vercel 자동 배포 |
| Vercel | https://projecthmk.vercel.app | 환경 변수 `SUPABASE_URL`, `SUPABASE_ANON_KEY`(publishable) |
| Supabase | `https://mndnqqspcswcdumtdqhb.supabase.co` | `schema.sql` 적용됨, 작성자 접근 키는 사용자만 앎(해시 저장). 시험 제안 '연결 시험' 행은 정리 필요할 수 있음 |
비밀 값(secret/service_role 키, 작성자 접근 키, Gemini 키)은 저장소에 넣지 않는다.

## 남은 일·아이디어
- 실제 교범(교리연구 부서)으로 매칭 정확도 검증, 번호 패턴 보정
- PDF 요청문: 인쇄 창에서 "PDF로 저장" 마지막 단계는 사용자 확인 필요
- 범위 외(PRD): 제안↔변경 조항 자동 연결, 이미지 비교, 다중 작성자 협업
