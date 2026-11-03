// 종합 평가 총평 초안 (LLM)
// - 지금 버전: Google Gemini API (무료 키 사용 가능). 키는 작성자가 화면에서 넣고, 그 브라우저에만 저장한다.
//   키를 코드·Vercel 환경 변수에 넣지 않는다 → 배포 사이트를 연 누구나 그 키를 쓰게 되기 때문.
// - 폐쇄망 LLM: 아래 [폐쇄망] 부분은 주석 처리해 두었다. 연결 방법은 docs/LLM_연동_메모.md 참고.
'use strict';

const LLM = (() => {
  // ---------------------------------------------------------------- Gemini 설정
  const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';
  const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];
  const STORE = 'singu-gemini'; // { key, model, remember }
  const TIMEOUT_MS = 90000;

  // 키 저장: '기억'을 켜면 localStorage(이 브라우저), 끄면 sessionStorage(탭을 닫으면 지워짐)
  function loadSettings() {
    const read = (s) => { try { return JSON.parse(s.getItem(STORE) || 'null'); } catch (e) { return null; } };
    const v = read(localStorage) || read(sessionStorage) || {};
    return { key: v.key || '', model: v.model || GEMINI_MODELS[0], remember: v.remember !== false };
  }
  function saveSettings({ key, model, remember }) {
    const v = JSON.stringify({ key, model, remember });
    try { localStorage.removeItem(STORE); sessionStorage.removeItem(STORE); } catch (e) { /* 저장 불가 */ }
    try { (remember ? localStorage : sessionStorage).setItem(STORE, v); } catch (e) { /* 저장 불가 */ }
  }
  const ready = () => !!loadSettings().key;

  // ---------------------------------------------------------------- [폐쇄망] LLM 서버 설정 (연결 시 주석 해제)
  // 대부분의 사내 LLM 서버(vLLM, Ollama, TGI 등)는 OpenAI 호환 /v1/chat/completions 형식을 지원한다.
  // const CLOSED_CONFIG = {
  //   endpoint: 'http://llm.내부망주소:8000/v1/chat/completions', // 폐쇄망 LLM 주소 (HTTPS 권장)
  //   model: '모델이름',                                         // 서버에 올라간 모델 이름
  //   apiKey: '',                                                // 인증이 필요하면 토큰 (HTML 파일에 직접 넣지 말 것 → 메모 참고)
  //   temperature: 0.2,
  //   maxTokens: 1200,
  //   timeoutMs: 60000,
  // };

  const SYSTEM = [
    '당신은 국방 교범·훈령 개정 업무를 돕는 보조자입니다.',
    '주어진 신·구 비교 통계와 주요 변경 사항만 근거로, 결재권자에게 보고할 "개정 총평" 초안을 한국어 보고서 문체(~함, ~임)로 작성하십시오.',
    '구성: 1) 개정 개요(규모·범위) 2) 주요 개정 방향 3) 핵심 변경 사항(3~5개, 조항 번호 포함) 4) 제안 반영 결과 5) 검토 시 유의 사항.',
    '주어지지 않은 사실을 지어내지 말고, 수치는 주어진 값을 그대로 쓰십시오. 15줄 이내로 작성하십시오. 마크다운 기호(#, *, **)는 쓰지 마십시오.',
  ].join('\n');

  const cut = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };

  // 종합 평가 데이터 → { system, user } (대략 6,000자 이내로 줄임)
  function buildPrompt(d, ctx) {
    const lines = [];
    lines.push(`[교범] ${ctx.manual || '(교범명 미입력)'}`);
    lines.push(`[파일] 기존: ${ctx.oldName || '-'} / 신규: ${ctx.newName || '-'}`);
    lines.push(`[조항 수] 기존 ${ctx.oldCount}개, 신규 ${ctx.newCount}개`);
    lines.push(`[유형별 변경] ${['수정', '추가', '삭제', '이동'].map((t) => `${t} ${d.c[t]}건`).join(', ')}, 동일 ${d.c['동일']}건 (번호만 변경 ${d.numOnly}건)`);
    lines.push(`[장별 변경] ${d.chapters.filter((r) => r.total).map((r) => `${r.label} ${r.total}건`).join(', ') || '없음'}`);
    lines.push('[변경 폭이 큰 조항]');
    for (const x of ctx.top) lines.push(`- ${x.loc} (유사도 ${x.sim}) 삭제: "${cut(x.del, 120)}" / 추가: "${cut(x.ins, 120)}"${x.reason ? ` / 사유: ${cut(x.reason, 80)}` : ''}`);
    if (ctx.added.length) lines.push(`[신설 조항] ${ctx.added.join(', ')}`);
    if (ctx.deleted.length) lines.push(`[삭제 조항] ${ctx.deleted.join(', ')}`);
    if (d.tf.length) lines.push(`[표·그림 변경] ${d.tf.map((x) => `${x.kind} ${x.change}(${cut(x.after || x.before, 30)})`).join(', ')}`);
    lines.push(`[제안 반영] 접수 ${d.rs.total}건, 반영 ${d.rs.반영}, 부분반영 ${d.rs.부분반영}, 미반영 ${d.rs.미반영}, 미심의 ${d.rs.미심의}`);
    if (ctx.reasons.length) lines.push(`[작성자가 적은 변경 사유] ${ctx.reasons.map((r) => cut(r, 60)).join(' / ')}`);
    let user = lines.join('\n');
    if (user.length > 6000) user = user.slice(0, 6000) + '\n…(이하 생략)';
    return { system: SYSTEM, user };
  }

  // ---------------------------------------------------------------- Gemini 호출
  async function geminiFetch(path, init = {}, key = loadSettings().key) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${GEMINI_ENDPOINT}/${path}`, { ...init, signal: ctrl.signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key, ...(init.headers || {}) } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const reason = data.error?.details?.find((x) => x.reason)?.reason || data.error?.status || '';
        const msg = data.error?.message || '';
        if (reason === 'API_KEY_INVALID' || /api key not valid/i.test(msg)) throw new Error('Gemini API 키가 올바르지 않습니다. [AI 설정]에서 키를 확인해 주세요.');
        if (res.status === 429) throw new Error('Gemini 무료 사용량을 초과했습니다. 잠시 뒤 다시 시도하거나 다른 모델을 골라 주세요.');
        if (res.status === 404) throw new Error(`모델을 찾을 수 없습니다(${loadSettings().model}). [AI 설정]에서 다른 모델을 골라 주세요.`);
        if (res.status === 403) throw new Error('이 키로는 Gemini API를 쓸 수 없습니다. Google AI Studio에서 키 권한을 확인해 주세요.');
        throw new Error(`Gemini 오류 (${res.status})${msg ? ': ' + msg : ''}`);
      }
      return data;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Gemini가 응답하지 않습니다. 잠시 뒤 다시 시도해 주세요.');
      if (e instanceof TypeError) throw new Error('Gemini 서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요. (내부망에서는 쓸 수 없습니다)');
      throw e;
    } finally { clearTimeout(timer); }
  }

  // 키 확인: 모델 목록을 읽어 봄 (교범 내용은 보내지 않음)
  async function testKey(key) {
    const data = await geminiFetch('models?pageSize=100', { method: 'GET' }, key);
    return (data.models || []).map((m) => m.name.replace(/^models\//, '')).filter((n) => /^gemini/.test(n));
  }

  async function draftSummary(prompt) {
    const { key, model } = loadSettings();
    if (!key) throw new Error('Gemini API 키가 없습니다. [AI 설정]에서 키를 넣어 주세요.');
    const data = await geminiFetch(`models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: prompt.system }] },
        contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
      }),
    });
    const cand = data.candidates?.[0];
    const text = (cand?.content?.parts || []).map((p) => p.text || '').join('').trim();
    if (!text) {
      const why = data.promptFeedback?.blockReason || cand?.finishReason || '빈 응답';
      throw new Error(`Gemini가 초안을 만들지 못했습니다 (${why}). 다시 시도해 주세요.`);
    }
    return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#+\s*/gm, '');

    // ---------------------------------------------------------------- [폐쇄망] LLM 호출 (연결 시 위 Gemini 호출 대신 주석 해제)
    // const ctrl = new AbortController();
    // const timer = setTimeout(() => ctrl.abort(), CLOSED_CONFIG.timeoutMs);
    // try {
    //   const res = await fetch(CLOSED_CONFIG.endpoint, {
    //     method: 'POST',
    //     signal: ctrl.signal,
    //     headers: { 'Content-Type': 'application/json', ...(CLOSED_CONFIG.apiKey ? { Authorization: `Bearer ${CLOSED_CONFIG.apiKey}` } : {}) },
    //     body: JSON.stringify({
    //       model: CLOSED_CONFIG.model,
    //       temperature: CLOSED_CONFIG.temperature,
    //       max_tokens: CLOSED_CONFIG.maxTokens,
    //       messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
    //     }),
    //   });
    //   if (!res.ok) throw new Error(`LLM 서버 오류 (${res.status})`);
    //   const data = await res.json();
    //   return data.choices?.[0]?.message?.content?.trim() || '';
    // } finally { clearTimeout(timer); }
  }

  return { buildPrompt, draftSummary, testKey, ready, loadSettings, saveSettings, MODELS: GEMINI_MODELS, PROVIDER: 'Google Gemini' };
})();
