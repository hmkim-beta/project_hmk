// 수정 반영: 종합 엑셀의 심의 결과대로 현재 교범에 제안을 반영해 변경 내용을 보여 줌
// 원칙: 제안의 '현행 내용' 문구를 교범에서 찾아 '수정 제안 내용'으로 바꾼다.
//       찾지 못한 제안은 작성자가 대상 조항을 고르고 [수정]으로 직접 반영한다.
'use strict';

const ApplyTab = (() => {
  const SCOPES = ['반영', '부분반영', '미심의', '미반영'];
  const DEFAULT_SCOPE = { 반영: true, 부분반영: true, 미심의: false, 미반영: false };

  const empty = () => ({ xlsxName: '', rows: [], docName: '', blocks: null, warnings: [], scope: { ...DEFAULT_SCOPE }, targets: {}, excluded: {}, edits: {} });
  const A = () => (P.apply = P.apply && typeof P.apply === 'object' ? { ...empty(), ...P.apply } : empty());

  // ---------------------------------------------------------- 엑셀 → 제안 행
  const compact = (s) => String(s || '').replace(/\s+/g, '');
  const COLS = {
    seq: ['연번'], no: ['제안번호', '번호'], proposer: ['제안자'], loc: ['위치'], cat: ['구분'],
    cur: ['현행내용', '현행'], prop: ['수정제안', '제안내용', '개정안'], basis: ['근거', '제안근거'], result: ['심의결과', '반영여부', '결과'], rreason: ['사유', '심의사유'],
  };

  function rowsFromSheet(sheet) {
    const hi = sheet.findIndex((r) => r.some((c) => compact(c).includes('현행')) && r.some((c) => /수정제안|제안내용|개정안/.test(compact(c))));
    if (hi < 0) throw new Error('엑셀에서 "현행 내용"과 "수정 제안" 열을 찾지 못했습니다. [제안 종합] 탭에서 내보낸 종합 엑셀을 올려 주세요.');
    const head = sheet[hi].map(compact);
    const col = {};
    for (const [k, names] of Object.entries(COLS)) {
      // 더 구체적인 이름을 먼저 찾고, '사유'는 심의 사유 열(뒤쪽)을 우선
      for (const nm of names) {
        const idx = k === 'rreason' ? head.lastIndexOf(head.filter((h) => h.includes(nm)).pop()) : head.findIndex((h) => h.includes(nm) && !(k === 'cur' && h.includes('제안')));
        if (idx >= 0 && !Object.values(col).includes(idx)) { col[k] = idx; break; }
      }
    }
    const out = [];
    sheet.slice(hi + 1).forEach((r, i) => {
      const get = (k) => (col[k] === undefined ? '' : String(r[col[k]] ?? '').trim());
      if (!get('cur') && !get('prop')) return;
      const result = get('result').replace(/\s+/g, '');
      out.push({
        key: get('no') || `R${i + 1}`, no: get('no') || `${get('seq') || i + 1}번`, proposer: get('proposer'), loc: get('loc'), cat: get('cat'),
        cur: get('cur'), prop: get('prop'), basis: get('basis'), result: REVIEW.includes(result) ? result : '', rreason: get('rreason'),
      });
    });
    if (!out.length) throw new Error('엑셀에 제안 행이 없습니다.');
    return out;
  }

  function rowsFromProposals() {
    return P.proposals.map((x) => ({
      key: x.no, no: x.no, proposer: proposerText(x.proposer).replace(/\n/g, ' '), cat: x.category,
      loc: [x.location.page && `페이지: ${x.location.page}`, x.location.clause && `장·절·항: ${x.location.clause}`, x.location.table && `표: ${x.location.table}`, x.location.figure && `그림: ${x.location.figure}`].filter(Boolean).join('\n'),
      cur: x.current, prop: x.proposed, basis: x.reason, result: x.review.result, rreason: x.review.reason,
    }));
  }

  // ---------------------------------------------------------- 문구 찾기 (띄어쓰기·가운뎃점·따옴표 차이 무시)
  const normCh = (ch) => /[·ㆍ․‧∙•・⋅･]/.test(ch) ? '·' : /[“”"]/.test(ch) ? '"' : /[‘’']/.test(ch) ? "'" : ch;
  function locate(text, needle) {
    const nd = Array.from(compact(needle), normCh).join('');
    if (!nd) return null;
    const map = [], hay = [];
    for (let i = 0; i < text.length; i++) if (!/\s/.test(text[i])) { hay.push(normCh(text[i])); map.push(i); }
    const h = hay.join('');
    const k = h.indexOf(nd);
    if (k < 0) return null;
    return { start: map[k], end: map[k + nd.length - 1] + 1, count: h.split(nd).length - 1 };
  }

  // 위치 칸의 조항 번호·표·그림 번호로 후보 조항 추정
  function hintClauses(loc, clauses) {
    const CAP = /(표|그림)\s*\d+(\s*[-–.]\s*\d+)*/g;
    const s = String(loc || '');
    const caps = [...s.matchAll(CAP)].map((m) => m[0].replace(/\s+/g, ''));
    // 표·그림 번호(예: 그림 2-1)를 조항 번호(2-1)로 오인하지 않도록 먼저 지움
    const rest = s.replace(CAP, ' ').replace(/페이지\s*:?\s*[\d\s,~-]+/g, ' ');
    const nums = [...rest.matchAll(/제\s*\d+\s*조(\s*의\s*\d+)?|\d+\s*-\s*\d+(?!\s*-)|제\s*\d+\s*[장절]/g)].map((m) => m[0].replace(/\s+/g, ''));
    return clauses.filter((c) => nums.includes(c.num) || [...c.tables, ...c.figures].some((t) => caps.some((cp) => compact(t.caption).startsWith(cp))));
  }

  const isDelete = (r) => r.cat === '삭제' && (!r.prop.trim() || /^(삭제|그림\s*삭제|<\s*삭\s*제\s*>)$/.test(r.prop.trim()));

  // ---------------------------------------------------------- 반영 계산
  function compute() {
    const st = A();
    if (!st.blocks) return null;
    const clauses = Segmenter.segment(st.blocks, P.settings.patterns, 'n', P.settings);
    const byId = new Map(clauses.map((c) => [c.id, c]));
    const work = new Map(); // clauseId → 반영 중인 글
    const items = st.rows.map((r) => {
      const it = { ...r, status: '', note: '', clauseId: null, hint: hintClauses(r.loc, clauses) };
      if (!st.scope[r.result || '미심의']) { it.status = '제외'; it.note = `심의 결과: ${r.result || '미심의'}`; return it; }
      if (st.excluded[r.key]) { it.status = '제외'; it.note = '작성자가 제외'; return it; }
      const manual = st.targets[r.key] && byId.get(st.targets[r.key]);
      let target = manual, found = null;
      if (manual) found = locate(work.get(manual.id) ?? manual.text, r.cur);
      else {
        const cands = clauses.map((c) => ({ c, f: locate(work.get(c.id) ?? c.text, r.cur) })).filter((x) => x.f);
        const pick = cands.find((x) => it.hint.includes(x.c)) || (cands.length ? cands[0] : null);
        if (pick) { target = pick.c; found = pick.f; if (cands.length > 1 && !cands.some((x) => it.hint.includes(x.c))) it.note = `현행 문구가 ${cands.length}개 조항에 있어 첫 번째에 반영`; }
        else if (it.hint.length === 1) target = it.hint[0];
      }
      if (target) it.clauseId = target.id;
      if (target && found) {
        const base = work.get(target.id) ?? target.text;
        const rep = isDelete(r) ? '' : r.prop;
        work.set(target.id, base.slice(0, found.start) + rep + base.slice(found.end));
        it.status = '반영됨';
        if (found.count > 1 && !it.note) it.note = '같은 문구가 조항 안에 여러 번 있어 첫 번째만 바꿈';
      } else if (target) { it.status = '직접 수정 필요'; it.note = r.cat === '그림 변경' ? '그림은 직접 처리해 주세요' : '현행 문구를 찾지 못해 조항만 지정됨'; }
      else { it.status = '위치 확인 필요'; it.note = '현행 문구를 찾지 못했습니다. 대상 조항을 골라 주세요.'; }
      return it;
    });
    const ids = new Set([...items.filter((x) => x.clauseId && x.status !== '제외').map((x) => x.clauseId), ...Object.keys(st.edits)]);
    const changed = clauses.filter((c) => ids.has(c.id)).map((c) => ({
      c, before: c.text, after: st.edits[c.id]?.text ?? work.get(c.id) ?? c.text, edited: !!st.edits[c.id],
      items: items.filter((x) => x.clauseId === c.id && x.status !== '제외'),
    }));
    return { clauses, items, changed };
  }

  // ---------------------------------------------------------- 화면
  const STATUS_CLASS = { 반영됨: 'ok', '직접 수정 필요': 'warn', '위치 확인 필요': 'bad', 제외: 'off' };

  function slot(kind) {
    const st = A();
    if (kind === 'x') {
      if (!st.rows.length) return `<div class="drop" data-slot="x"><span class="eyebrow">01 PROPOSALS · 종합 엑셀</span><b>수정사항 종합 엑셀</b><span>[제안 종합]에서 내보내고 심의 결과를 적은 .xlsx 파일</span><span class="ftag">.xlsx</span></div>`;
      const c = SCOPES.map((s) => `${s} ${st.rows.filter((r) => (r.result || '미심의') === s).length}`).join(' · ');
      return `<div class="drop loaded" data-slot="x"><span class="eyebrow">01 PROPOSALS · 종합 엑셀</span><span class="fname">${esc(st.xlsxName)}</span><span class="stat">제안 ${st.rows.length}건</span><span>${c}</span><span class="hint">다른 파일로 바꾸려면 끌어 놓거나 누르세요</span></div>`;
    }
    if (!st.blocks) return `<div class="drop" data-slot="d"><span class="eyebrow">02 CURRENT · 현재 교범</span><b>현재 시점 교범</b><span>제안을 반영할 지금 교범의 HWPX 파일</span><span class="ftag">.hwpx · .hwp</span></div>`;
    return `<div class="drop loaded" data-slot="d"><span class="eyebrow">02 CURRENT · 현재 교범</span><span class="fname">${esc(st.docName)}</span>${(st.warnings || []).map((w) => `<span class="warn-line">⚠ ${esc(w)}</span>`).join('')}<span class="hint">다른 파일로 바꾸려면 끌어 놓거나 누르세요</span></div>`;
  }

  function draw() {
    const st = A();
    $('#apSlotX').innerHTML = slot('x');
    $('#apSlotD').innerHTML = slot('d');
    $('#apUseProps').hidden = !P.proposals.length;
    const r = compute();
    $('#apBody').hidden = !(r && st.rows.length);
    $('#apEmpty').hidden = !!(r && st.rows.length);
    if (!r || !st.rows.length) return;
    const cnt = (s) => r.items.filter((x) => x.status === s).length;
    $('#apScope').innerHTML = SCOPES.map((s) => `<label class="chk"><input type="checkbox" data-scope="${s}" ${st.scope[s] ? 'checked' : ''}> ${s}</label>`).join('');
    $('#apStats').innerHTML = `<span class="pill ok">반영됨 ${cnt('반영됨')}</span><span class="pill warn">직접 수정 필요 ${cnt('직접 수정 필요')}</span><span class="pill bad">위치 확인 필요 ${cnt('위치 확인 필요')}</span><span class="pill off">제외 ${cnt('제외')}</span><span class="muted">바뀐 조항 ${r.changed.length}개</span>`;
    const opts = (sel) => `<option value="">— 대상 조항 선택 —</option>${r.clauses.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc([pathText(c), c.label].filter(Boolean).join(' > ').slice(0, 70))}</option>`).join('')}`;
    $('#apItems').innerHTML = `<table class="ptable"><thead><tr><th>제안번호</th><th>구분</th><th>심의</th><th>위치(제안자 기재)</th><th>현행 내용</th><th>수정 제안</th><th>반영 상태</th><th>대상 조항</th><th></th></tr></thead><tbody>
      ${r.items.map((x) => `<tr data-key="${esc(x.key)}">
        <td class="no"><b>${esc(x.no)}</b></td><td><span class="cat">${esc(x.cat || '-')}</span></td><td>${esc(x.result || '미심의')}</td>
        <td>${esc(x.loc).replace(/\n/g, '<br>')}</td>
        <td><div class="clip">${esc(x.cur)}</div></td><td><div class="clip">${esc(x.prop)}</div></td>
        <td><span class="pill ${STATUS_CLASS[x.status]}">${x.status}</span>${x.note ? `<div class="hint">${esc(x.note)}</div>` : ''}</td>
        <td>${x.status === '제외' && !st.excluded[x.key] ? '-' : `<select data-target>${opts(st.targets[x.key] || (x.status !== '위치 확인 필요' ? x.clauseId : ''))}</select>`}</td>
        <td>${st.scope[x.result || '미심의'] ? `<button class="btn-s" data-act="${st.excluded[x.key] ? 'include' : 'exclude'}">${st.excluded[x.key] ? '다시 포함' : '제외'}</button>` : ''}</td></tr>`).join('')}
      </tbody></table>`;
    $('#apCards').innerHTML = r.changed.length ? r.changed.map(cardHtml).join('') : '<div class="empty-list">반영된 조항이 없습니다. 위 표에서 대상 조항을 고르거나 심의 범위를 넓혀 보세요.</div>';
  }

  function cardHtml(x) {
    const [L, Rr] = x.before === x.after ? [esc(x.before), esc(x.after)] : TextDiff.toHtml(TextDiff.diff(x.before, x.after, UI.diffMode), esc);
    const need = x.items.some((i) => i.status === '직접 수정 필요') && !x.edited;
    return `<article class="card ${x.before === x.after ? 't-동일' : 't-수정'}" data-cid="${x.c.id}">
      <header><span class="tbadge">${x.before === x.after ? '변경 없음' : '반영'}</span><b>${esc(x.c.label)}</b><span class="loc">${esc(pathText(x.c))}</span>
        ${x.items.map((i) => `<span class="pill ${STATUS_CLASS[i.status]}" title="${esc(i.status)}">${esc(i.no)}</span>`).join('')}
        ${x.edited ? '<span class="ebadge">직접 수정</span>' : ''}${need ? '<span class="pill warn">직접 수정 필요</span>' : ''}</header>
      <div class="cols">
        <div class="side old"><div class="lbl">반영 전 · 현재 교범</div><div class="txt">${L}</div></div>
        <div class="side new"><div class="lbl">반영 후${x.edited ? ' · 최종본' : ''}<span class="sp"></span><button class="btn-s edit-btn" data-act="edit">수정</button></div><div class="txt">${Rr}</div></div>
      </div></article>`;
  }

  function startEdit(card) {
    const r = compute(), x = r.changed.find((y) => y.c.id === card.dataset.cid);
    if (!x || card.classList.contains('editing')) return;
    card.classList.add('editing');
    $('.edit-btn', card).hidden = true;
    $('.side.new .txt', card).outerHTML = `<div class="edit-wrap"><textarea class="editor" spellcheck="false">${esc(x.after)}</textarea>
      <div class="edit-actions"><button class="primary" data-act="esave">최종본으로 저장</button><button data-act="ecancel">취소</button>
      ${x.edited ? '<button class="ghost" data-act="erevert">자동 반영 결과로 되돌리기</button>' : ''}<small>Ctrl+Enter 저장 · Esc 취소</small></div></div>`;
    const ta = $('.editor', card);
    const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.max(140, ta.scrollHeight + 4) + 'px'; };
    ta.addEventListener('input', fit);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEdit(card); }
      if (e.key === 'Escape') { e.preventDefault(); draw(); }
    });
    fit(); ta.focus();
  }

  function saveEdit(card, revert = false) {
    const st = A(), id = card.dataset.cid;
    if (revert) delete st.edits[id];
    else st.edits[id] = { text: $('.editor', card).value.replace(/\s+$/, ''), at: new Date().toISOString() };
    dirty(); draw();
    toast(revert ? '자동 반영 결과로 되돌렸습니다.' : '반영 후 내용을 최종본으로 저장했습니다.');
  }

  // ---------------------------------------------------------- 내보내기
  function exportXlsx() {
    const r = compute();
    if (!r) return toast('종합 엑셀과 현재 교범을 모두 올려 주세요.', 'error');
    const label = (id) => { const c = r.clauses.find((x) => x.id === id); return c ? [pathText(c), c.label].filter(Boolean).join(' > ') : ''; };
    const sheets = [
      { name: '반영 대비표', header: true, widths: [6, 30, 55, 55, 16, 36], rows: [['연번', '위치', '반영 전 (현행)', '반영 후 (개정안)', '관련 제안', '사유'],
        ...r.changed.filter((x) => x.before !== x.after).map((x, i) => [{ v: i + 1, s: 'center' }, label(x.c.id), x.before, x.after, x.items.map((y) => y.no).join(', '), x.items.map((y) => y.rreason || y.basis).filter(Boolean).join('\n')])] },
      { name: '제안별 반영 상태', header: true, widths: [10, 11, 10, 22, 40, 40, 14, 30, 30], rows: [['제안번호', '구분', '심의 결과', '위치(제안자 기재)', '현행 내용', '수정 제안', '반영 상태', '대상 조항', '비고'],
        ...r.items.map((x) => [{ v: x.no, s: 'center' }, { v: x.cat, s: 'center' }, { v: x.result || '미심의', s: 'center' }, x.loc, x.cur, x.prop, { v: x.status, s: 'center' }, label(x.clauseId), x.note])] },
    ];
    download(`수정반영_${fileSafe(P.meta.manual) || '교범'}_${today()}.xlsx`, Xlsx.build(sheets), XLSX_TYPE);
    toast('반영 결과를 엑셀로 내보냈습니다.');
  }

  function exportText() {
    const st = A(), r = compute();
    if (!r) return toast('종합 엑셀과 현재 교범을 모두 올려 주세요.', 'error');
    const after = new Map(r.changed.map((x) => [x.c.id, x.after]));
    finalSaveDialog({ title: '제안 반영본 저장', doc: { name: st.docName, kind: st.kind, src: st.src }, clauses: r.clauses, finalOf: (c) => after.get(c.id) ?? c.text, base: '제안반영본' });
  }

  // 신·구 비교로 보내기: 현재 교범을 '기존', 반영본을 '신규'로 놓고 반영 내용을 직접 수정(최종본)으로 넘김
  function sendToCompare() {
    const st = A(), r = compute();
    if (!r) return toast('종합 엑셀과 현재 교범을 모두 올려 주세요.', 'error');
    const changed = r.changed.filter((x) => x.before !== x.after);
    if (!changed.length) return toast('반영된 내용이 없습니다.', 'error');
    if ((P.oldDoc || P.newDoc) && !confirm('[신·구 비교] 화면의 지금 비교 대상(매칭·사유·직접 수정 포함)을 이 반영 결과로 바꿉니다. 계속할까요?')) return;
    const doc = { name: st.docName, blocks: st.blocks, warnings: st.warnings, loadedAt: new Date().toISOString(), kind: st.kind, src: st.src };
    P.oldDoc = doc;
    P.newDoc = { ...doc, name: `${st.docName} (제안 반영본)` };
    P.links = []; P.unlinks = []; P.notes = {}; P.edits = {};
    for (const x of changed) {
      P.edits[x.c.id] = { text: x.after, at: new Date().toISOString() };
      P.notes[`o${x.c.id.slice(1)}|${x.c.id}`] = { reason: x.items.map((y) => y.rreason || y.basis).filter(Boolean).join(' / '), ref: x.items.map((y) => y.no).join(', ') };
    }
    analyze(); UI.tab = 'compare'; UI.view = 'changes'; dirty(); render(); window.scrollTo(0, 0);
    toast(`반영된 ${changed.length}개 조항을 [신·구 비교]로 보냈습니다. 대비표 엑셀로 내보낼 수 있습니다.`);
  }

  // ---------------------------------------------------------- 이벤트
  async function loadXlsx(file) {
    try {
      const rows = rowsFromSheet(await Xlsx.read(await file.arrayBuffer()));
      Object.assign(A(), { xlsxName: file.name, rows, targets: {}, excluded: {} });
      dirty(); draw();
      toast(`${file.name}: 제안 ${rows.length}건을 읽었습니다.`);
    } catch (e) { console.error(e); toast(`${file.name}: ${e.message}`, 'error'); }
  }

  async function loadDocFile(name, buf) {
    try {
      const { blocks, warnings } = await DocParser.parse(name, buf);
      Object.assign(A(), { docName: name, blocks, warnings, targets: {}, edits: {}, ...docSource(name, buf) });
      dirty(); draw();
      toast(`${name} 읽기 완료`);
    } catch (e) { console.error(e); toast(`${name}: ${e.message}`, 'error'); }
  }

  function bind() {
    const slotX = $('#apSlotX'), slotD = $('#apSlotD');
    slotX.onclick = () => pickFiles('.xlsx', false, (f) => f[0] && loadXlsx(f[0]));
    bindDrop(slotX, (f) => f[0] && loadXlsx(f[0]));
    slotD.onclick = () => pickFiles('.hwpx,.hwp', false, async (f) => { if (f[0]) loadDocFile(f[0].name, await f[0].arrayBuffer()); });
    bindDrop(slotD, async (f) => { if (f[0]) loadDocFile(f[0].name, await f[0].arrayBuffer()); });
    $('#apUseProps').onclick = () => {
      Object.assign(A(), { xlsxName: '[제안 종합] 탭의 제안 목록', rows: rowsFromProposals(), targets: {}, excluded: {} });
      dirty(); draw(); toast(`[제안 종합] 탭의 제안 ${P.proposals.length}건을 불러왔습니다.`);
    };
    $('#apScope').onchange = (e) => { const s = e.target.dataset.scope; if (s) { A().scope[s] = e.target.checked; dirty(); draw(); } };
    $('#apItems').onchange = (e) => {
      if (!e.target.matches('[data-target]')) return;
      const key = e.target.closest('tr').dataset.key, st = A();
      if (e.target.value) st.targets[key] = e.target.value; else delete st.targets[key];
      dirty(); draw();
    };
    $('#apItems').onclick = (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const key = b.closest('tr').dataset.key, st = A();
      if (b.dataset.act === 'exclude') st.excluded[key] = true; else delete st.excluded[key];
      dirty(); draw();
    };
    $('#apCards').onclick = (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const card = b.closest('.card'), act = b.dataset.act;
      if (act === 'edit') startEdit(card);
      else if (act === 'esave') saveEdit(card);
      else if (act === 'erevert') saveEdit(card, true);
      else if (act === 'ecancel') draw();
    };
    $('#apXlsx').onclick = exportXlsx;
    $('#apText').onclick = exportText;
    $('#apSend').onclick = sendToCompare;
    $('#apReset').onclick = () => { if (confirm('수정 반영 화면의 엑셀·교범·직접 수정 내용을 비울까요?')) { P.apply = empty(); dirty(); draw(); } };
  }

  return { render: draw, bind, compute, rowsFromSheet, locate };
})();
