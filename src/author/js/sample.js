// 샘플 체험: 가상 교범 2개와 샘플 제안 6건으로 모든 기능을 연습한다.
// - 체험 중 작업은 브라우저 저장소의 'sample' 칸에 따로 저장되어, 실제 작업('project')은 건드리지 않는다.
// - 안내 패널이 단계마다 해당 화면으로 데려가고 무엇을 볼지 알려 준다.
// - 데이터(SAMPLE_DATA)는 빌드 때 도구 안에 들어가므로 인터넷 없이도 체험할 수 있다.
'use strict';

const Sample = (() => {
  const FLAG = 'singu-sample';
  const TOUR = 'singu-tour';
  const ss = {
    get: (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { v === null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e) { /* 저장 불가 */ } },
  };
  const active = () => STORE_KEY === 'sample';

  // ---------------------------------------------------------------- 안내 단계
  const STEPS = [
    { t: '바뀐 곳 한눈에 보기', d: '[신·구 비교] 탭의 [변경만 보기]에 일부러 넣은 변경 10건이 모두 보입니다. 카드 왼쪽 색이 유형(수정·추가·삭제·이동)이고, 왼쪽 목차의 숫자는 장별 변경 건수입니다.', go: { tab: 'compare', view: 'changes' } },
    { t: '번호가 밀린 조항', d: '1-2 "기본 원칙"이 새로 생겨 뒤 조항 번호가 하나씩 밀렸습니다. "번호 변경: 1-3 → 1-4" 배지를 보세요. 번호만 바뀐 조항은 [전체 보기]를 누르면 회색(동일)으로 보입니다.', go: { tab: 'compare', view: 'changes', jump: '1-4' } },
    { t: '자리를 옮긴 조항', d: '파란색 [이동] 카드: "통신 수단 운용"이 제2장에서 제3장으로 옮겨졌습니다. 내용이 같으면 번호·위치가 달라도 짝을 찾습니다.', go: { tab: 'compare', view: 'changes', jump: '3-2' } },
    { t: '표·그림 변경', d: '2-2 표의 담당자(부소대장 → 분대장), 2-4 그림 캡션, 3-5 그림 삭제가 글자 단위로 표시됩니다. 빨간 줄은 지운 글자, 초록 밑줄은 더한 글자입니다.', go: { tab: 'compare', view: 'changes', jump: '2-2' } },
    { t: '잘못된 짝 고치기', d: '아무 [수정] 카드에서 [연결 해제]를 눌러 보세요. 삭제·추가 카드로 나뉩니다. 삭제 카드의 [수동 연결…]로 원래 짝을 골라 다시 이을 수 있습니다.', go: { tab: 'compare', view: 'changes' } },
    { t: '개정 내용 직접 고치기', d: '3-7 "사후 강평" 카드 오른쪽의 [수정]을 눌러 문구를 고치고 [최종본으로 저장]을 누르세요. "직접 수정" 배지가 붙고 대비표와 최종본(HWPX)에 반영됩니다.', go: { tab: 'compare', view: 'changes', jump: '3-7' } },
    { t: '사유 적고 대비표 만들기', d: '카드 아래 칸에 변경 사유와 관련 제안번호를 적고, 위의 [대비표 엑셀] 또는 [대비표 복사](한글에 붙여넣기용)를 눌러 보세요. [최종본 저장]은 HWPX로 내려받습니다.', go: { tab: 'compare', view: 'changes' } },
    { t: '제안 심의하기', d: '[제안 종합] 탭에 일선부대 샘플 제안 6건이 있고, 심의 결과가 미리 들어 있습니다. 번호를 누르면 첨부 이미지까지 보입니다. 결과(반영·부분반영·미반영)와 사유를 바꿔 보고, [종합 엑셀]도 내려받아 보세요.', go: { tab: 'proposals' } },
    { t: '제안을 교범에 반영하기', d: '[수정 반영] 탭에서 [엑셀 대신 [제안 종합] 탭의 제안 목록 사용]을 누르세요(현재 교범은 샘플이 들어 있음). 현행 문구를 찾은 제안은 "반영됨", 못 찾은 제안은 "직접 수정 필요"로 나옵니다. 아래 조항 카드의 [수정]으로 직접 반영해 보세요. 미반영 제안은 "제외"됩니다.', go: { tab: 'apply' } },
    { t: '종합 평가 보기', d: '[종합 평가] 탭에서 유형·장별 통계, 변경 폭 Top 10, 제안 반영률을 확인하고 총평을 적어 보세요. Gemini 키가 있으면 [AI 총평 초안 생성]도 써 볼 수 있습니다.', go: { tab: 'report' } },
  ];

  const tourState = () => { try { return { open: true, step: 0, done: [], ...JSON.parse(ss.get(TOUR) || '{}') }; } catch (e) { return { open: true, step: 0, done: [] }; } };
  const saveTour = (t) => ss.set(TOUR, JSON.stringify(t));

  function go(g) {
    UI.tab = g.tab;
    if (g.view) UI.view = g.view;
    if (g.tab === 'compare') { UI.types = new Set(CHANGE_TYPES); UI.q = ''; const q = $('#q'); if (q) q.value = ''; }
    render();
    window.scrollTo(0, 0);
    if (g.jump) {
      const p = R.pairs.find((x) => (R.byN.get(x.newId) || R.byO.get(x.oldId))?.label.startsWith(g.jump));
      if (p) setTimeout(() => jumpTo(p.key), 60);
    }
  }

  function renderTour() {
    const box = $('#tour');
    if (!active()) { box.hidden = true; return; }
    const t = tourState();
    box.hidden = false;
    box.className = 'tour' + (t.open ? '' : ' min');
    const n = t.done.length;
    if (!t.open) {
      box.innerHTML = `<button class="tour-pill" data-t="open">체험 안내 <b>${n}/${STEPS.length}</b></button>`;
      return;
    }
    box.innerHTML = `<header><span class="eyebrow">SAMPLE TOUR</span><b>샘플 체험 안내</b><span class="prog">${n}/${STEPS.length}</span><button class="ghost btn-s" data-t="min" title="접기">접기</button></header>
      <div class="bar"><i style="width:${(n / STEPS.length) * 100}%"></i></div>
      <ol>${STEPS.map((s, i) => `<li class="${i === t.step ? 'cur' : ''} ${t.done.includes(i) ? 'done' : ''}">
        <button class="tstep" data-t="step" data-i="${i}"><span>${t.done.includes(i) ? '✓' : String(i + 1).padStart(2, '0')}</span>${esc(s.t)}</button>
        ${i === t.step ? `<p>${esc(s.d)}</p><div class="tacts"><button class="btn-s" data-t="go" data-i="${i}">이 화면으로 가기</button><button class="btn-s primary" data-t="next" data-i="${i}">${i === STEPS.length - 1 ? '체험 마치기' : '다음 단계'}</button></div>` : ''}
      </li>`).join('')}</ol>
      <footer><button class="ghost btn-s" data-t="reset">샘플 처음부터</button><button class="ghost btn-s" data-t="exit">체험 끝내기</button></footer>`;
  }

  function onTour(e) {
    const b = e.target.closest('[data-t]'); if (!b) return;
    const t = tourState(), i = +b.dataset.i, act = b.dataset.t;
    if (act === 'open' || act === 'min') { t.open = act === 'open'; saveTour(t); return renderTour(); }
    if (act === 'step') { t.step = i; saveTour(t); renderTour(); return go(STEPS[i].go); }
    if (act === 'go') return go(STEPS[i].go);
    if (act === 'next') {
      if (!t.done.includes(i)) t.done.push(i);
      if (i < STEPS.length - 1) { t.step = i + 1; saveTour(t); renderTour(); return go(STEPS[i + 1].go); }
      saveTour(t); renderTour();
      return toast('샘플 체험을 모두 마쳤습니다! 실제 교범으로 작업하려면 [체험 끝내기]를 누르세요.');
    }
    if (act === 'reset') return reset();
    if (act === 'exit') return exit();
  }

  function renderBar() {
    $('#sampleBar').hidden = !active();
    const b = $('#btnSample');
    b.textContent = active() ? '체험 끝내기' : '샘플 체험';
    b.title = active() ? '샘플 체험을 끝내고 원래 작업으로 돌아갑니다' : '가상 교범으로 모든 기능을 연습합니다 (지금 작업은 그대로 보관)';
    const tryBox = $('#tryBox'); if (tryBox) tryBox.hidden = active();
  }

  // ---------------------------------------------------------------- 샘플 작업 만들기
  async function build() {
    const mk = async (name, b64) => {
      const buf = b64ToBuf(b64);
      const { blocks, warnings } = await DocParser.parse(name, buf);
      return { name, blocks, warnings, loadedAt: new Date().toISOString(), ...docSource(name, buf) };
    };
    const proj = newProject();
    proj.meta.manual = '가상 야전교범 0-00 소부대 경계작전 (샘플)';
    proj.meta.author = '체험용';
    proj.oldDoc = await mk('샘플_기존교범.hwpx', SAMPLE_DATA.oldHwpx);
    proj.newDoc = await mk('샘플_신규교범.hwpx', SAMPLE_DATA.newHwpx);
    // [수정 반영] 연습: 현재 교범 자리에 개정 전 교범을 미리 넣어 둠
    proj.apply = { xlsxName: '', rows: [], docName: proj.oldDoc.name, blocks: proj.oldDoc.blocks, warnings: proj.oldDoc.warnings, kind: proj.oldDoc.kind, src: proj.oldDoc.src, targets: {}, excluded: {}, edits: {} };
    P = proj;
    for (const f of SAMPLE_DATA.proposals) importProposalJson(f.name, JSON.stringify(f.data));
    // 심의 결과를 미리 채워 둠: [수정 반영]에서 자동 반영·직접 수정·제외가 모두 나오게
    const REVIEW_PRESET = {
      'smp-001': ['반영', '1-4에 "청음초" 정의를 다목으로 신설'],
      'smp-002': ['반영', '표 2-1 근무 편성 담당 현행화'],
      'smp-003': ['부분반영', '캡션만 수정, 그림은 차기 개정 때 교체'],
      'smp-004': ['반영', '보고 대상과 후속 조치 명확화'],
      'smp-005': ['미반영', '그림은 유지하되 장비 사진만 차기 개정 때 교체'],
      'smp-006': ['반영', '표현 통일'],
    };
    for (const x of P.proposals) {
      const r = REVIEW_PRESET[x.uid];
      if (r) x.review = { result: r[0], reason: r[1] };
    }
    analyze();
  }

  async function enter() {
    if (active()) return;
    STORE_KEY = 'sample';
    ss.set(FLAG, '1');
    saveTour({ open: true, step: 0, done: [] });
    try { await build(); } catch (e) { console.error(e); toast(`샘플을 불러오지 못했습니다: ${e.message}`, 'error'); return exit(); }
    dirty();
    UI.tab = 'compare'; UI.view = 'changes'; UI.types = new Set(CHANGE_TYPES);
    render(); window.scrollTo(0, 0);
    toast('샘플 체험을 시작합니다. 오른쪽 아래 안내를 따라 해 보세요. 지금 작업은 그대로 보관됩니다.');
  }

  async function reset() {
    if (!confirm('샘플을 처음 상태로 되돌릴까요? 체험 중 고친 내용이 지워집니다.')) return;
    saveTour({ open: true, step: 0, done: [] });
    await build(); dirty();
    UI.tab = 'compare'; UI.view = 'changes'; render(); window.scrollTo(0, 0);
    toast('샘플을 처음 상태로 되돌렸습니다.');
  }

  async function exit() {
    ss.set(FLAG, null); ss.set(TOUR, null);
    STORE_KEY = 'project';
    let saved = null;
    try { saved = await Store.get('project'); } catch (e) { /* 저장소 없음 */ }
    P = saved && saved.format === 'kyobeom-project' ? Object.assign(newProject(), saved) : newProject();
    if (saved) P.settings = { ...newProject().settings, ...saved.settings };
    analyze();
    UI.tab = 'compare'; render(); window.scrollTo(0, 0);
    toast('샘플 체험을 끝내고 원래 작업으로 돌아왔습니다.');
  }

  function bind() {
    $('#tour').addEventListener('click', onTour);
    $('#btnSample').onclick = () => (active() ? exit() : enter());
    $('#sampleExit').onclick = exit;
    $('#sampleGuide').onclick = () => { const t = tourState(); t.open = true; saveTour(t); renderTour(); };
    const tryBtn = $('#btnTry'); if (tryBtn) tryBtn.onclick = enter;
  }

  return { active, enter, exit, bind, renderTour, renderBar, wantsStart: () => /[?&]sample=1\b/.test(location.search) };
})();
