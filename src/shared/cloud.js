// Supabase 연결 (선택 기능): 수정 제안 온라인 제출·수집
// config.js(window.SINGU_CONFIG)에 주소와 공개 키가 있을 때만 켜진다. 없으면 오프라인(.json 파일) 방식.
// 외부 라이브러리 없이 Supabase REST API를 직접 부른다. 권한 설계는 supabase/schema.sql 참고.
'use strict';

const Cloud = (() => {
  const cfg = (typeof window !== 'undefined' && window.SINGU_CONFIG) || {};
  const url = String(cfg.supabaseUrl || '').trim().replace(/\/+$/, '');
  const key = String(cfg.supabaseAnonKey || '').trim();
  const enabled = /^https?:\/\//.test(url) && key.length > 20 && !key.startsWith('sb_secret_');
  const MAX_BYTES = 7_500_000; // 서버 제한(약 8MB)보다 조금 작게

  async function post(path, body, extra = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch(`${url}/rest/v1/${path}`, {
        method: 'POST',
        signal: ctrl.signal,
        // 예전 형식(JWT) anon 키는 Authorization에도 넣고, 새 형식(sb_publishable_…)은 apikey 헤더만 쓴다
        headers: { 'Content-Type': 'application/json', apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}), ...extra },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });
      if (!res.ok) {
        let msg = '';
        try { const j = await res.json(); msg = j.message || j.error_description || j.error || ''; } catch (e) { /* 본문 없음 */ }
        const err = new Error(/invalid key/i.test(msg) ? '작성자 접근 키가 맞지 않습니다.' : `서버 오류 (${res.status})${msg ? ': ' + msg : ''}`);
        err.status = res.status; err.invalidKey = /invalid key/i.test(msg);
        throw err;
      }
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('서버가 응답하지 않습니다. 인터넷 연결을 확인해 주세요.');
      if (e instanceof TypeError) throw new Error('서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.');
      throw e;
    } finally { clearTimeout(timer); }
  }

  // 제안 제출 (공개 키로는 추가만 가능, 읽기 불가)
  async function submitProposal(row) {
    const body = JSON.stringify(row);
    if (body.length > MAX_BYTES) throw new Error('첨부 이미지가 너무 커서 온라인으로 보낼 수 없습니다. 이미지를 줄이거나 [제안 파일 저장]으로 보내 주세요.');
    await post('proposals', body, { Prefer: 'return=minimal' });
  }

  // 작성자: 접근 키로 제안 목록 읽기
  const listProposals = (authorKey, since = null) => post('rpc/list_proposals', { p_key: authorKey, p_since: since });

  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15);
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  }));

  return { enabled, url, submitProposal, listProposals, newId };
})();
