-- 신구대조전 · Supabase 설정 (수정 제안 온라인 제출·수집)
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행한다. 여러 번 실행해도 된다.
--
-- 권한 설계
--   - 웹 페이지에 들어가는 공개 키(anon)는 제안을 "추가"만 할 수 있다. 읽기·수정·삭제는 못 한다.
--   - 작성자는 list_proposals(작성자 접근 키)로만 제안을 읽는다. 키는 해시로만 저장된다.
--   - 첨부 이미지는 제안 행(items) 안에 들어 있어 같은 키로만 볼 수 있다.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;  -- API로 노출되지 않는 스키마

-- 1) 제안 -----------------------------------------------------------------------
create table if not exists public.proposals (
  id              uuid primary key,                       -- 제안 폼이 만든 접수 id
  created_at      timestamptz not null default now(),
  manual          text not null check (char_length(manual) between 1 and 200),
  proposer        jsonb not null,                         -- { unit, rank, name, contact }
  items           jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 50),
  client_saved_at timestamptz,
  constraint proposals_size check (octet_length(items::text) < 8000000)  -- 이미지 포함 약 8MB 이하
);

alter table public.proposals enable row level security;

revoke all on public.proposals from anon, authenticated;
grant insert on public.proposals to anon, authenticated;

drop policy if exists "anyone can submit" on public.proposals;
create policy "anyone can submit" on public.proposals
  for insert to anon, authenticated
  with check (true);
-- select / update / delete 정책은 만들지 않는다 → 공개 키로는 읽을 수 없음

-- 2) 작성자 접근 키 --------------------------------------------------------------
create table if not exists private.author_keys (
  id         serial primary key,
  label      text,
  key_hash   text not null,
  created_at timestamptz not null default now()
);

-- 작성자 접근 키 등록: 아래 '여기에-긴-접근키를-넣으세요'를 바꿔서 실행한다 (20자 이상, 무작위 권장).
-- 키를 바꿀 때: delete from private.author_keys; 후 다시 insert.
-- insert into private.author_keys (label, key_hash)
-- values ('교리연구 담당', extensions.crypt('여기에-긴-접근키를-넣으세요', extensions.gen_salt('bf')));

-- 3) 작성자용 읽기 함수 ----------------------------------------------------------
create or replace function public.list_proposals(p_key text, p_since timestamptz default null)
returns setof public.proposals
language plpgsql
security definer
set search_path = public, private, extensions
as $$
begin
  if p_key is null or char_length(p_key) < 8
     or not exists (select 1 from private.author_keys k where k.key_hash = extensions.crypt(p_key, k.key_hash)) then
    raise exception 'invalid key' using errcode = '28000';
  end if;
  return query
    select * from public.proposals
    where p_since is null or created_at > p_since
    order by created_at;
end;
$$;

revoke all on function public.list_proposals(text, timestamptz) from public;
grant execute on function public.list_proposals(text, timestamptz) to anon, authenticated;

-- 참고: 장난·중복 제출 정리 (SQL Editor에서 관리자만)
--   delete from public.proposals where id = '...';
--   delete from public.proposals where created_at < now() - interval '1 year';
