// 종합 평가 총평: LLM 요청문 만들기 (지금은 LLM을 직접 부르지 않음)
// - 총평 초안은 app.js의 statsDraft()가 통계만으로 만든다 (폐쇄망에서도 동작).
// - 폐쇄망 LLM이 생기면: 요청문을 TXT/PDF로 내려받아 LLM 화면에 넣고, 받은 결과를 총평 칸에 붙여넣는다 (수동 처리).
// - 아래 [보관] 부분: 폐쇄망 LLM 직접 연결 코드와 Google Gemini 연결 코드는 주석으로 남겨 두었다. docs/LLM_연동_메모.md 참고.
'use strict';

const LLM = (() => {
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

  // 수동 처리용 안내 (TXT·PDF 맨 위에 들어감)
  const HOWTO = [
    '1. 아래 "LLM에 넣을 내용" 전체([지시]와 [자료])를 복사해 폐쇄망 LLM 입력창에 붙여넣습니다.',
    '2. LLM이 만든 총평 초안을 복사해 작성자 도구 › [종합 평가] › 작성자 총평 칸에 붙여넣습니다.',
    '3. 수치·조항 번호는 종합 평가 화면의 통계와 반드시 대조해 고칩니다.',
  ];

  // 내려받을 TXT 내용
  function requestText(prompt, meta) {
    return [
      '신구대조전 · 종합 평가 총평 LLM 요청문',
      `교범: ${meta.manual || '(교범명 미입력)'}`,
      `작성: ${meta.author || '-'} · ${meta.date}`,
      '',
      '[사용 방법]',
      ...HOWTO,
      '',
      '※ 이 파일에는 교범의 변경 문구 일부와 변경 사유가 들어 있습니다. 보안 등급에 맞게 다뤄 주세요.',
      '',
      '==================== LLM에 넣을 내용 (여기부터) ====================',
      '[지시]',
      prompt.system,
      '',
      '[자료]',
      prompt.user,
      '==================== LLM에 넣을 내용 (여기까지) ====================',
      '',
    ].join('\r\n');
  }

  // PDF용 인쇄 문서 (브라우저 인쇄 → "PDF로 저장")
  function requestHtml(prompt, meta, esc) {
    const p = (s) => esc(s).replace(/\n/g, '<br>');
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(meta.fileTitle)}</title>
      <style>
        @page { size: A4; margin: 18mm 16mm; }
        body { font: 10.5pt/1.65 "Malgun Gothic", "맑은 고딕", sans-serif; color: #1b2b3c; }
        h1 { font-size: 15pt; margin: 0 0 4px; }
        .meta { color: #555; margin-bottom: 12px; }
        h2 { font-size: 11.5pt; margin: 14px 0 6px; padding-bottom: 3px; border-bottom: 1px solid #999; }
        ol { margin: 0; padding-left: 20px; }
        .warn { border: 1px solid #c98d12; background: #fcf5dc; padding: 6px 10px; margin: 10px 0; font-size: 9.5pt; }
        .box { border: 1px solid #999; padding: 10px 12px; white-space: normal; word-break: break-all; }
        .box h3 { font-size: 10.5pt; margin: 0 0 4px; }
      </style></head><body>
      <h1>종합 평가 총평 LLM 요청문</h1>
      <div class="meta">교범: ${esc(meta.manual || '(교범명 미입력)')} · 작성: ${esc(meta.author || '-')} · ${esc(meta.date)} · 신구대조전</div>
      <h2>사용 방법</h2><ol>${HOWTO.map((h) => `<li>${esc(h.replace(/^\d+\.\s*/, ''))}</li>`).join('')}</ol>
      <div class="warn">이 문서에는 교범의 변경 문구 일부와 변경 사유가 들어 있습니다. 보안 등급에 맞게 다뤄 주세요.</div>
      <h2>LLM에 넣을 내용</h2>
      <div class="box"><h3>[지시]</h3>${p(prompt.system)}<h3 style="margin-top:10px">[자료]</h3>${p(prompt.user)}</div>
      </body></html>`;
  }

  // ---------------------------------------------------------------- [보관] 폐쇄망 LLM 직접 연결 (연결 시 주석 해제)
  // 대부분의 사내 LLM 서버(vLLM, Ollama, TGI 등)는 OpenAI 호환 /v1/chat/completions 형식을 지원한다.
  // const CLOSED_CONFIG = {
  //   endpoint: 'http://llm.내부망주소:8000/v1/chat/completions', // 폐쇄망 LLM 주소 (HTTPS 권장)
  //   model: '모델이름',                                         // 서버에 올라간 모델 이름
  //   apiKey: '',                                                // 인증 토큰 (HTML에 직접 넣지 말 것 → 메모 참고)
  //   temperature: 0.2,
  //   maxTokens: 1200,
  //   timeoutMs: 60000,
  // };
  // async function draftSummary(prompt) {
  //   const ctrl = new AbortController();
  //   const timer = setTimeout(() => ctrl.abort(), CLOSED_CONFIG.timeoutMs);
  //   try {
  //     const res = await fetch(CLOSED_CONFIG.endpoint, {
  //       method: 'POST',
  //       signal: ctrl.signal,
  //       headers: { 'Content-Type': 'application/json', ...(CLOSED_CONFIG.apiKey ? { Authorization: `Bearer ${CLOSED_CONFIG.apiKey}` } : {}) },
  //       body: JSON.stringify({
  //         model: CLOSED_CONFIG.model,
  //         temperature: CLOSED_CONFIG.temperature,
  //         max_tokens: CLOSED_CONFIG.maxTokens,
  //         messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
  //       }),
  //     });
  //     if (!res.ok) throw new Error(`LLM 서버 오류 (${res.status})`);
  //     const data = await res.json();
  //     return data.choices?.[0]?.message?.content?.trim() || '';
  //   } finally { clearTimeout(timer); }
  // }

  // ---------------------------------------------------------------- [보관] Google Gemini 연결 (인터넷 환경용, 지금은 사용 안 함)
  // 브라우저가 Gemini API를 직접 부르는 방식. 키는 작성자 브라우저에만 저장했다(localStorage 'singu-gemini').
  // 무료 키는 보낸 내용이 Google 서비스 개선에 쓰일 수 있어 비공개 교범에는 쓰지 않는다.
  // 다시 쓰려면 아래 주석을 풀고, app.js의 총평 버튼에 [AI 설정]·[AI 초안] 화면을 다시 붙인다(git 기록 5b82b05~3395f84 참고).
  // const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';
  // async function geminiDraft(prompt, key, model = 'gemini-2.5-flash') {
  //   const res = await fetch(`${GEMINI_ENDPOINT}/models/${encodeURIComponent(model)}:generateContent`, {
  //     method: 'POST',
  //     headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
  //     body: JSON.stringify({
  //       systemInstruction: { parts: [{ text: prompt.system }] },
  //       contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
  //       generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
  //     }),
  //   });
  //   const data = await res.json();
  //   if (!res.ok) throw new Error(data.error?.message || `Gemini 오류 (${res.status})`);
  //   return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
  // }
  // async function geminiModels(key) { // 이 키로 쓸 수 있는 모델 목록 (모델 이름이 바뀌었을 때 고르기용)
  //   const res = await fetch(`${GEMINI_ENDPOINT}/models?pageSize=1000`, { headers: { 'x-goog-api-key': key } });
  //   const data = await res.json();
  //   return (data.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace(/^models\//, ''));
  // }

  return { buildPrompt, requestText, requestHtml };
})();
