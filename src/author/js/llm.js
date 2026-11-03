// 종합 평가 총평 초안용 폐쇄망 LLM 연동 준비
// - 지금은 연결하지 않는다. 프롬프트 만들기(buildPrompt)만 동작하고, 서버 호출 부분은 주석 처리했다.
// - 연결 방법과 주의 사항은 docs/LLM_연동_메모.md 참고.
'use strict';

const LLM = (() => {
  // [연결 시 주석 해제] 폐쇄망 LLM 서버 설정 ---------------------------------------
  // 대부분의 사내 LLM 서버(vLLM, Ollama, TGI 등)는 OpenAI 호환 /v1/chat/completions 형식을 지원한다.
  // const CONFIG = {
  //   endpoint: 'http://llm.내부망주소:8000/v1/chat/completions', // 폐쇄망 LLM 주소 (HTTPS 권장)
  //   model: '모델이름',                                         // 서버에 올라간 모델 이름
  //   apiKey: '',                                                // 인증이 필요하면 토큰 (HTML 파일에 직접 넣지 말 것 → 메모 참고)
  //   temperature: 0.2,
  //   maxTokens: 1200,
  //   timeoutMs: 60000,
  // };
  const ENABLED = false; // 연결을 마치면 true로 바꾼다.

  const SYSTEM = [
    '당신은 국방 교범·훈령 개정 업무를 돕는 보조자입니다.',
    '주어진 신·구 비교 통계와 주요 변경 사항만 근거로, 결재권자에게 보고할 "개정 총평" 초안을 한국어 보고서 문체(~함, ~임)로 작성하십시오.',
    '구성: 1) 개정 개요(규모·범위) 2) 주요 개정 방향 3) 핵심 변경 사항(3~5개, 조항 번호 포함) 4) 제안 반영 결과 5) 검토 시 유의 사항.',
    '주어지지 않은 사실을 지어내지 말고, 수치는 주어진 값을 그대로 쓰십시오. 15줄 이내로 작성하십시오.',
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

  async function draftSummary(prompt) {
    if (!ENABLED) throw new Error('폐쇄망 LLM이 아직 연결되지 않았습니다. docs/LLM_연동_메모.md를 참고해 연결해 주세요.');
    // [연결 시 주석 해제] ---------------------------------------------------------------
    // const ctrl = new AbortController();
    // const timer = setTimeout(() => ctrl.abort(), CONFIG.timeoutMs);
    // try {
    //   const res = await fetch(CONFIG.endpoint, {
    //     method: 'POST',
    //     signal: ctrl.signal,
    //     headers: { 'Content-Type': 'application/json', ...(CONFIG.apiKey ? { Authorization: `Bearer ${CONFIG.apiKey}` } : {}) },
    //     body: JSON.stringify({
    //       model: CONFIG.model,
    //       temperature: CONFIG.temperature,
    //       max_tokens: CONFIG.maxTokens,
    //       messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
    //     }),
    //   });
    //   if (!res.ok) throw new Error(`LLM 서버 오류 (${res.status})`);
    //   const data = await res.json();
    //   return data.choices?.[0]?.message?.content?.trim() || '';
    // } finally { clearTimeout(timer); }
    return '';
  }

  return { ENABLED, buildPrompt, draftSummary };
})();
