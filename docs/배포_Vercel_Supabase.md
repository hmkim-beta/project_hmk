# Vercel + Supabase 배포 안내 (수정 제안 온라인 제출)

온라인으로 쓰는 것은 **수정 제안 제출·수집**뿐입니다. 교범 HWPX 파일과 비교·대비표 작업은 지금처럼 각 PC의 브라우저 안에서만 처리되며 서버로 올라가지 않습니다.

```
제안자 ─[온라인 제출]→ Supabase(proposals 표) ←[온라인 제안 불러오기 + 작성자 접근 키]─ 작성자
                ↑ 공개 키로는 "추가"만 가능, 읽기 불가
```

설정이 없거나 인터넷이 안 되면 도구는 자동으로 **오프라인 모드**(.json 파일 주고받기)로 동작합니다.

---

## 1. Supabase 프로젝트 만들기

1. https://supabase.com 에 로그인 → **New project**.
   - Region: 가까운 곳(예: Northeast Asia (Seoul)).
   - Database password는 따로 안전하게 보관합니다(이 도구에는 필요 없음).
2. 프로젝트가 만들어지면 왼쪽 **SQL Editor** → **New query**.
3. 이 저장소의 [`supabase/schema.sql`](../supabase/schema.sql) 내용을 붙여넣고 **Run**.

## 2. 작성자 접근 키 정하기

작성자가 제안을 읽을 때 쓰는 비밀번호입니다. 서버에는 해시로만 저장됩니다.

1. 20자 이상 무작위 문자열을 정합니다. (예: 비밀번호 관리자에서 생성)
2. SQL Editor에서 다음을 실행합니다 (`'…'` 안을 바꿔서):

```sql
insert into private.author_keys (label, key_hash)
values ('교리연구 담당', extensions.crypt('여기에-정한-접근키', extensions.gen_salt('bf')));
```

- 키를 바꿀 때: `delete from private.author_keys;` 후 위 문장을 새 키로 다시 실행.
- 작성자가 여러 명이면 사람마다 다른 키를 한 줄씩 넣어도 됩니다.

## 3. 주소와 공개 키 확인

Supabase **Project Settings → API Keys**(또는 API)에서 두 값을 복사합니다.

| 이름 | 어디에 쓰나 |
|---|---|
| Project URL (`https://xxxx.supabase.co`) | `SUPABASE_URL` |
| **publishable** 키 (`sb_publishable_…`) 또는 **anon public** 키 (`eyJ…`) | `SUPABASE_ANON_KEY` |

> ⚠ **secret / service_role 키는 절대 넣지 마세요.** 웹 페이지에 그대로 실리는 값입니다. 빌드 스크립트가 비밀 키를 발견하면 배포를 멈춥니다.

## 4. Vercel에 배포 (GitHub 연결)

1. https://vercel.com 에 GitHub 계정으로 로그인 → **Add New… → Project**.
2. `hmkim-beta/project_hmk` 저장소를 **Import**.
3. 설정 화면에서
   - Framework Preset: **Other** (vercel.json이 빌드 방법을 정해 둠)
   - **Environment Variables**에 3단계의 두 값을 추가: `SUPABASE_URL`, `SUPABASE_ANON_KEY`
4. **Deploy**. 이후에는 `main`에 push할 때마다 자동으로 다시 배포됩니다.

배포되는 파일은 `index.html`, `교범비교도구.html`, `수정제안폼.html`, `samples/`, 그리고 자동 생성되는 `config.js`뿐입니다(`src/`, `tools/`, 문서는 올라가지 않음). 짧은 주소도 있습니다.

| 주소 | 화면 |
|---|---|
| `https://<프로젝트>.vercel.app/` | 홈 |
| `https://<프로젝트>.vercel.app/propose` | 수정 제안서 (제안자에게 이 주소를 공유) |
| `https://<프로젝트>.vercel.app/author` | 작성자 도구 |

환경 변수를 바꾼 뒤에는 Vercel에서 **Redeploy**해야 반영됩니다.

## 5. 확인

1. `/propose`를 열면 머리글에 "온라인 제출 가능"이 보이고 **[온라인 제출]** 버튼이 생깁니다.
2. 시험 제안을 제출하면 "접수번호 ……"가 표시됩니다.
3. `/author` → [제안 종합] → **[온라인 제안 불러오기]** → 작성자 접근 키 입력 → 시험 제안이 목록에 들어오면 완료.
4. Supabase **Table Editor → proposals**에서도 행을 볼 수 있습니다(관리자 화면).

## 내 PC에서 온라인 기능 시험

`config.example.js`를 `config.js`로 복사해 두 값을 넣고, 프로젝트 폴더를 로컬 서버로 엽니다(`config.js`는 git에 올라가지 않음).

## 운영 시 주의

- **개인정보**: 제안에는 소속·계급·성명·연락처와 첨부 이미지가 들어갑니다. 소속 기관의 개인정보·보안 규정상 외부 클라우드(Supabase) 저장이 허용되는지 먼저 확인하세요. 허용되지 않으면 환경 변수를 비워 오프라인 모드로만 쓰면 됩니다.
- **공개 제출**: 제안 폼 주소를 아는 누구나 제출할 수 있습니다(로그인 없음). 장난 제출은 작성자 목록에서 ✕로 빼고, 필요하면 SQL Editor에서 지웁니다(`schema.sql` 맨 아래 참고).
- **크기 제한**: 한 번 제출은 이미지 포함 약 8MB까지입니다. 넘으면 [제안 파일 저장]으로 보내도록 안내됩니다.
- **접근 키 관리**: 키를 아는 사람은 모든 제안을 읽을 수 있습니다. 담당자가 바뀌면 키를 바꾸세요. 작성자 도구는 키를 브라우저 탭을 닫을 때까지만 기억합니다.
- **심의 결과**는 지금처럼 작성자 PC(작업 파일)에만 저장됩니다. 서버의 제안은 바뀌지 않습니다.
