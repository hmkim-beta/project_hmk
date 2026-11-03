// 작성자용 도구 화면
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pct = (x) => `${Math.round(x * 100)}%`;
const today = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };
const hhmm = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const fileSafe = (s) => String(s || '').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

const CHANGE_TYPES = ['수정', '추가', '삭제', '이동'];
const ALL_TYPES = [...CHANGE_TYPES, '동일'];
const REVIEW = ['반영', '부분반영', '미반영'];
const CATEGORIES = ['오타·표현', '내용 수정', '추가', '삭제', '그림 변경'];

function newProject() {
  return {
    format: 'kyobeom-project', version: 1,
    meta: { manual: '', author: '', updatedAt: null, lastBackupAt: null },
    settings: { patterns: DEFAULT_PATTERNS, threshold: 0.45, moveThreshold: 0.6, includeTextbox: false, ignoreDots: true, ignoreSpace: false },
    oldDoc: null, newDoc: null,
    links: [], unlinks: [], notes: {},
    edits: {}, // 신규 조항 id → { text, at } : 작성자가 직접 고친 최종본
    proposals: [], summary: { overall: '' },
    apply: null, // 수정 반영 탭 상태 (apply.js)
  };
}

let P = newProject();
let R = { old: [], neu: [], pairs: [], byO: new Map(), byN: new Map(), pairByClause: new Map() };
const UI = {
  tab: 'compare', view: 'changes', types: new Set(CHANGE_TYPES), q: '', diffMode: 'char', exportAll: false,
  pf: { cat: '', res: '', q: '' }, psort: { key: 'no', dir: 1 },
};

// ------------------------------------------------------------ 저장 (IndexedDB)
const Store = (() => {
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('kyobeom-compare-tool', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction('kv', mode), st = t.objectStore('kv');
      const req = fn(st);
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    get: (k) => tx('readonly', (s) => s.get(k)),
    set: (k, v) => tx('readwrite', (s) => s.put(v, k)),
  };
})();

let saveTimer = null;
function dirty() {
  P.meta.updatedAt = new Date().toISOString();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try { await Store.set('project', P); renderSaveState(); }
    catch (e) { renderSaveState('브라우저 저장 실패: 작업 파일로 저장해 주세요'); }
  }, 500);
  renderSaveState('저장 중…');
}

function renderSaveState(msg) {
  const el = $('#saveState');
  if (msg) { el.textContent = msg; el.className = 'save-state'; return; }
  const stale = P.meta.updatedAt && (!P.meta.lastBackupAt || new Date(P.meta.updatedAt) - new Date(P.meta.lastBackupAt) > 30 * 60 * 1000);
  el.innerHTML = `자동 저장됨 ${hhmm(P.meta.updatedAt)}<br><span class="${stale ? 'warn' : ''}">작업 파일 백업: ${P.meta.lastBackupAt ? hhmm(P.meta.lastBackupAt) : '없음'}</span>`;
  el.className = 'save-state' + (stale ? ' stale' : '');
  el.title = stale ? '마지막 백업 이후 30분 넘게 작업했습니다. [작업 파일 저장]으로 백업해 두세요.' : '';
}

// ------------------------------------------------------------ 분석
function segmentSide(doc, side) {
  return doc ? Segmenter.segment(doc.blocks, P.settings.patterns, side, P.settings) : [];
}

function analyze() {
  const old = segmentSide(P.oldDoc, 'o'), neu = segmentSide(P.newDoc, 'n');
  R = { old, neu, pairs: [], byO: new Map(old.map((c) => [c.id, c])), byN: new Map(neu.map((c) => [c.id, c])), pairByClause: new Map() };
  if (old.length && neu.length) {
    const res = Matcher.match(old, neu, { threshold: +P.settings.threshold, moveThreshold: +P.settings.moveThreshold, links: P.links, unlinks: P.unlinks });
    R.pairs = res.pairs; R.S = res.S; R.m = res.m;
  } else if (old.length || neu.length) {
    // 한쪽만 올린 상태: 목록만 보여 줌
    R.pairs = (old.length ? old : neu).map((c, i) => ({ key: `${c.id}`, oldId: old.length ? c.id : null, newId: old.length ? null : c.id, type: '대기', order: i, sim: 0 }));
  }
  for (const p of R.pairs) {
    if (p.oldId) R.pairByClause.set(p.oldId, p);
    if (p.newId) R.pairByClause.set(p.newId, p);
  }
  applyEdits();
}

// ------------------------------------------------------------ 직접 수정(최종본)
const finalText = (n) => (n ? (P.edits[n.id]?.text ?? n.text) : '');

// 번호를 뺀 비교용 글자 (분할기의 cmp와 같은 규칙)
function canon(text, num) {
  let t = text;
  if (num) {
    let k = 0, i = 0;
    while (i < t.length && k < num.length) { if (!/\s/.test(t[i])) k++; i++; }
    if (t.replace(/\s+/g, '').startsWith(num)) t = t.slice(i).replace(/^[\s.]+/, '');
  }
  t = t.replace(/\s+/g, ' ').trim();
  if (P.settings.ignoreDots) t = t.replace(/[·ㆍ․‧∙•・⋅･]/g, '·');
  if (P.settings.ignoreSpace) t = t.replace(/\s+/g, '');
  return t;
}

// 두 글의 글자쌍(bigram) 유사도 0~1 (직접 고친 조항의 변경 폭 계산용)
function textSim(a, b) {
  const g = (s) => { s = s.replace(/\s+/g, ''); const set = new Set(); for (let i = 0; i < s.length - 1; i++) set.add(s.substr(i, 2)); return set; };
  const A = g(a), B = g(b);
  if (!A.size && !B.size) return 1;
  let c = 0; for (const x of A) if (B.has(x)) c++;
  return (2 * c) / (A.size + B.size);
}

// 직접 고친 조항은 고친 글을 기준으로 유형을 다시 판정
function applyEdits() {
  for (const p of R.pairs) {
    const n = p.newId && R.byN.get(p.newId);
    p.edited = !!(n && P.edits[n.id]);
    if (!p.edited) continue;
    const o = p.oldId && R.byO.get(p.oldId);
    if (!o) continue;
    const same = canon(o.text, o.num) === canon(finalText(n), n.num);
    p.textChanged = !same;
    p.sim = textSim(o.text, finalText(n));
    p.minor = same && o.text !== finalText(n);
    if (p.type === '동일' || p.type === '수정') p.type = same ? '동일' : '수정';
  }
}

// 다시 그려도 보고 있던 카드가 같은 자리에 있도록
function rerenderKeeping(key) {
  const el = $(`#pairList .card[data-key="${CSS.escape(key)}"]`);
  const top = el ? el.getBoundingClientRect().top : null;
  reanalyze();
  const again = $(`#pairList .card[data-key="${CSS.escape(key)}"]`);
  if (again && top !== null) window.scrollBy(0, again.getBoundingClientRect().top - top);
}

function startEdit(card) {
  const p = R.pairs.find((x) => x.key === card.dataset.key);
  const n = clauseOf(p, 'n');
  const box = $('.side.new .txt', card);
  if (!n || !box || card.classList.contains('editing')) return;
  card.classList.add('editing');
  $('.edit-btn', card).hidden = true;
  box.outerHTML = `<div class="edit-wrap"><textarea class="editor" spellcheck="false">${esc(finalText(n))}</textarea>
    <div class="edit-actions"><button class="primary" data-act="esave">최종본으로 저장</button><button data-act="ecancel">취소</button>
    ${p.edited ? '<button class="ghost" data-act="erevert">개정 원문으로 되돌리기</button>' : ''}<small>Ctrl+Enter 저장 · Esc 취소</small></div></div>`;
  const ta = $('.editor', card);
  const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.max(140, ta.scrollHeight + 4) + 'px'; };
  ta.addEventListener('input', fit);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEdit(card); }
    if (e.key === 'Escape') { e.preventDefault(); rerenderKeeping(card.dataset.key); }
  });
  fit(); ta.focus();
}

function saveEdit(card, revert = false) {
  const key = card.dataset.key;
  const n = clauseOf(R.pairs.find((x) => x.key === key), 'n');
  const value = revert ? n.text : $('.editor', card).value.replace(/\s+$/, '');
  if (value.trim() === n.text.trim()) delete P.edits[n.id];
  else P.edits[n.id] = { text: value, at: new Date().toISOString() };
  dirty();
  rerenderKeeping(key);
  toast(revert ? `${n.label}: 개정 원문으로 되돌렸습니다.` : P.edits[n.id] ? `${n.label}: 최종본으로 저장했습니다. 대비표와 최종본 파일에 반영됩니다.` : `${n.label}: 원문과 같아 직접 수정 표시를 지웠습니다.`);
}

// ------------------------------------------------------------ 최종본 저장 (HWPX / TXT) — 신·구 비교, 수정 반영 공용
const bufToB64 = (buf) => { const u8 = new Uint8Array(buf); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const b64ToBuf = (b64) => { const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8.buffer; };
// 원본 바이트를 보관 (HWPX는 최종본을 원본에 덮어쓰기 위해 필요)
const docSource = (name, buf) => {
  const u8 = new Uint8Array(buf, 0, 2);
  const kind = u8[0] === 0x50 && u8[1] === 0x4B ? 'hwpx' : 'hwp';
  return { kind, src: kind === 'hwpx' ? bufToB64(buf) : null };
};
const docKind = (d) => d.kind || (/\.hwpx$/i.test(d.name) ? 'hwpx' : 'hwp');

// job: { title, doc:{name,kind,src}, clauses, finalOf(c), base }
function finalSaveDialog(job) {
  const changed = job.clauses.filter((c) => job.finalOf(c) !== c.text);
  const kind = docKind(job.doc);
  modal(`<h3>${esc(job.title)}</h3>
    <p class="muted">기준 파일: <b>${esc(job.doc.name)}</b> · 바뀐 조항 <b>${changed.length}</b>개</p>
    <div class="save-opts">
      <button class="opt" data-k="hwpx"><span class="eyebrow">HWPX · 한글</span><b>한글 파일로 저장</b>
        <span>${kind === 'hwpx' ? '원본 HWPX의 서식·표·그림·쪽 설정을 그대로 두고, 바뀐 글자만 고쳐 저장합니다.' : '원본이 HWP라 서식 없이 글자만 담은 HWPX를 만듭니다. 서식을 살리려면 한글에서 원본을 HWPX로 저장해 다시 올려 주세요.'}</span></button>
      <button class="opt" data-k="txt"><span class="eyebrow">TXT</span><b>텍스트로 저장</b><span>조항 순서대로 최종 글만 담은 .txt 파일입니다.</span></button>
    </div>
    <div class="modal-f"><button data-close>닫기</button></div>`, (box, close) => {
    $('.save-opts', box).onclick = async (e) => {
      const b = e.target.closest('[data-k]'); if (!b) return;
      close();
      if (b.dataset.k === 'txt') return saveFinalText(job, changed.length);
      try { await saveFinalHwpx(job, kind); } catch (err) { console.error(err); toast(`HWPX 저장 실패: ${err.message}`, 'error'); }
    };
  });
}

function saveFinalText(job, n) {
  const head = [`${P.meta.manual || '교범'} ${job.title}`, `기준 파일: ${job.doc.name}`, `저장: ${new Date().toLocaleString('ko-KR')}`, `바뀐 조항: ${n}개`, '='.repeat(40), ''];
  const body = job.clauses.map((c) => job.finalOf(c)).join('\n\n');
  download(`${job.base}_${fileSafe(P.meta.manual) || '교범'}_${today()}.txt`, '﻿' + head.join('\r\n') + body.replace(/\n/g, '\r\n') + '\r\n', 'text/plain;charset=utf-8');
  toast('텍스트 파일로 저장했습니다.');
}

async function saveFinalHwpx(job, kind) {
  const name = `${job.base}_${fileSafe(P.meta.manual) || '교범'}_${today()}.hwpx`;
  toast('HWPX 파일을 만드는 중입니다…');
  let bytes, warnings = [], changed;
  if (kind === 'hwpx') {
    if (!job.doc.src) throw new Error('원본 파일 내용이 보관되어 있지 않습니다. 같은 HWPX 파일을 다시 올린 뒤 저장해 주세요.');
    const edits = new Map(job.clauses.filter((c) => job.finalOf(c) !== c.text).map((c) => [c.id, { orig: c.text, text: job.finalOf(c) }]));
    ({ bytes, warnings, changed } = await HwpxWriter.patch(b64ToBuf(job.doc.src), edits, P.settings.patterns, P.settings));
  } else {
    bytes = await HwpxWriter.plain(job.clauses.flatMap((c) => job.finalOf(c).split('\n')));
    warnings = ['원본이 HWP라 서식(글꼴·표·그림·쪽 설정) 없이 글자만 담았습니다.'];
  }
  download(name, new Blob([bytes], { type: 'application/hwp+zip' }));
  if (warnings.length) {
    modal(`<h3>HWPX를 저장했습니다 · 확인할 점 ${warnings.length}건</h3>
      <p class="muted">${esc(name)}${changed !== undefined ? ` · 고친 조항 ${changed}개` : ''}. 아래 내용은 한글에서 직접 확인·수정해 주세요.</p>
      <ul class="warn-list">${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
      <div class="modal-f"><button data-close class="primary">확인</button></div>`);
  } else toast(`${name} 저장 완료 (고친 조항 ${changed}개). 한글에서 열어 확인해 주세요.`);
}

function saveFinalDoc() {
  if (!R.neu.length) return toast('신규 교범 파일을 먼저 올려 주세요.', 'error');
  finalSaveDialog({ title: '최종본 저장', doc: P.newDoc, clauses: R.neu, finalOf: finalText, base: '최종본' });
}

// 문서를 다시 읽거나 패턴이 바뀌어 조항 id가 달라질 때, 사유·수동 연결을 새 id로 옮김
function remapSide(side, prev, next) {
  if (!prev.length || !next.length) return 0;
  const { pairs } = Matcher.match(prev, next, { threshold: 0.5, moveThreshold: 0.6 });
  const map = new Map(pairs.filter((p) => p.oldId && p.newId).map((p) => [p.oldId, p.newId]));
  const fix = (id) => (id === null || id === undefined ? id : map.get(id) ?? '');
  const k = side === 'o' ? 'oldId' : 'newId';
  P.links = P.links.map((l) => ({ ...l, [k]: fix(l[k]) })).filter((l) => l[k]);
  P.unlinks = P.unlinks.map((l) => ({ ...l, [k]: fix(l[k]) })).filter((l) => l[k]);
  const notes = {}; let lost = 0;
  for (const [key, v] of Object.entries(P.notes)) {
    const [o, n] = key.split('|');
    const cur = side === 'o' ? o : n;
    const moved = cur ? fix(cur) : cur;
    if (cur && !moved) { if (v.reason || v.ref) lost++; continue; }
    notes[side === 'o' ? `${moved}|${n}` : `${o}|${moved}`] = v;
  }
  P.notes = notes;
  if (side === 'n') {
    const edits = {};
    for (const [id, v] of Object.entries(P.edits || {})) { const m = map.get(id); if (m) edits[m] = v; else lost++; }
    P.edits = edits;
  }
  return lost;
}

// 쌍이 바뀌었을 때(재매칭 등) 기존 사유를 같은 조항의 새 쌍으로 옮김
function carryNotes() {
  const valid = new Set(R.pairs.map((p) => p.key));
  for (const [key, v] of Object.entries(P.notes)) {
    if (valid.has(key) || !(v.reason || v.ref)) continue;
    const [o, n] = key.split('|');
    const p = (n && R.pairByClause.get(n)) || (o && R.pairByClause.get(o));
    if (p && !P.notes[p.key]) { P.notes[p.key] = v; delete P.notes[key]; }
  }
}

function reanalyze() { analyze(); carryNotes(); dirty(); render(); }

// ------------------------------------------------------------ 공통 헬퍼
const clauseOf = (p, side) => (side === 'o' ? R.byO.get(p.oldId) : R.byN.get(p.newId));
const pathText = (c) => c ? c.path.filter((x) => x.level > 0).map((x) => `${x.num} ${x.title}`.trim()).join(' > ') : '';
const shortCaps = (c) => c ? [...c.tables, ...c.figures].map((t) => (t.caption.match(/(표|그림)\s*\d+(\s*[-–.]\s*\d+)*/) || [''])[0].replace(/\s+/g, ' ')).filter(Boolean) : [];

function locText(p) {
  const o = clauseOf(p, 'o'), n = clauseOf(p, 'n'), c = n || o;
  let s = [pathText(c), c.label].filter(Boolean).join(' > ');
  if (o && n && o.num !== n.num) s += `\n(번호 변경: ${o.num} → ${n.num})`;
  if (p.type === '이동' && o) s += `\n(기존 위치: ${[pathText(o), o.label].filter(Boolean).join(' > ')})`;
  const caps = [...new Set([...shortCaps(o), ...shortCaps(n)])];
  if (caps.length) s += `\n${caps.join(', ')}`;
  return s;
}

function chapterKey(p) {
  const c = clauseOf(p, 'n') || clauseOf(p, 'o');
  if (!c) return null;
  if (c.level === 1) return p.key;
  const ch = c.path.find((x) => x.level === 1);
  const hp = ch && R.pairByClause.get(ch.id);
  return hp ? hp.key : '(머리말)';
}

function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

let toastTimer;
function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg; t.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), kind === 'error' ? 6000 : 3000);
}

function modal(html, onMount) {
  const m = $('#modal');
  m.innerHTML = `<div class="modal-box">${html}</div>`;
  m.classList.remove('hidden');
  const close = () => { m.classList.add('hidden'); m.innerHTML = ''; };
  m.onclick = (e) => { if (e.target === m || e.target.closest('[data-close]')) close(); };
  if (onMount) onMount(m.firstElementChild, close);
  return close;
}

// ------------------------------------------------------------ 렌더링: 공통
function render() {
  $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === UI.tab));
  $$('main > section').forEach((s) => (s.hidden = s.id !== `tab-${UI.tab}`));
  $('#manualName').value = P.meta.manual;
  $('#authorName').value = P.meta.author;
  renderSaveState();
  if (UI.tab === 'compare') renderCompare();
  if (UI.tab === 'proposals') renderProposals();
  if (UI.tab === 'apply') ApplyTab.render();
  if (UI.tab === 'report') renderReport();
}

// ------------------------------------------------------------ A. 신·구 비교
function docSlot(side) {
  const d = side === 'o' ? P.oldDoc : P.newDoc;
  const cl = side === 'o' ? R.old : R.neu;
  const label = side === 'o' ? '기존 교범' : '신규 교범';
  const eyebrow = side === 'o' ? '01 ORIGINAL · 구' : '02 REVISION · 신';
  if (!d) return `<div class="drop" data-side="${side}"><span class="eyebrow">${eyebrow}</span><b>${label}</b><span>${side === 'o' ? '개정 전' : '작업 중인'} HWPX 파일을 놓거나 눌러서 선택</span><span class="ftag">.hwpx · .hwp</span></div>`;
  const nt = cl.reduce((s, c) => s + c.tables.length, 0), nf = cl.reduce((s, c) => s + c.figures.length, 0);
  const warn = [...(d.warnings || [])];
  if (!cl.some((c) => c.level >= 1)) warn.push('조항 번호를 하나도 찾지 못했습니다. [설정]에서 번호 패턴을 확인해 주세요.');
  return `<div class="drop loaded" data-side="${side}"><span class="eyebrow">${eyebrow}</span><span class="fname">${esc(d.name)}</span>
    <span class="stat">조항 ${cl.length}개 · 표 ${nt}개 · 그림 ${nf}개</span>
    ${warn.map((w) => `<span class="warn-line">⚠ ${esc(w)}</span>`).join('')}
    <span class="hint">다른 파일로 바꾸려면 끌어 놓거나 누르세요</span></div>`;
}

function counts() {
  const c = Object.fromEntries(ALL_TYPES.map((t) => [t, 0]));
  for (const p of R.pairs) if (c[p.type] !== undefined) c[p.type]++;
  return c;
}

function visiblePairs() {
  const q = UI.q.trim().replace(/\s+/g, '');
  return R.pairs.filter((p) => {
    if (p.type === '대기') return true;
    if (p.type === '동일') { if (UI.view !== 'all') return false; }
    else if (!UI.types.has(p.type)) return false;
    if (q) {
      const o = clauseOf(p, 'o'), n = clauseOf(p, 'n'), note = P.notes[p.key] || {};
      const hay = [o?.text, finalText(n), note.reason, note.ref].join(' ').replace(/\s+/g, '');
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderCompare() {
  $('#slotOld').innerHTML = docSlot('o');
  $('#slotNew').innerHTML = docSlot('n');
  $('#cmpHero').hidden = !!(P.oldDoc || P.newDoc);
  const both = R.old.length && R.neu.length;
  $('#cmpBody').hidden = !R.pairs.length;
  $('#cmpEmpty').hidden = !!R.pairs.length;
  if (!R.pairs.length) return;
  const c = counts();
  $('#viewToggle').innerHTML = [['changes', '변경만 보기'], ['all', '전체 보기']].map(([v, l]) => `<button data-view="${v}" class="${UI.view === v ? 'on' : ''}">${l}</button>`).join('');
  $('#typeChips').innerHTML = both ? CHANGE_TYPES.map((t) => `<button class="chip t-${t} ${UI.types.has(t) ? 'on' : ''}" data-type="${t}">${t} <b>${c[t]}</b></button>`).join('') + `<span class="chip-same">동일 ${c['동일']}</span>` + (Object.keys(P.edits).length ? `<span class="chip-edit">직접 수정 ${R.pairs.filter((p) => p.edited).length}</span>` : '') :'<span class="muted">양쪽 파일을 모두 올리면 비교가 시작됩니다.</span>';
  renderToc();
  renderPairs();
}

function renderToc() {
  const nodes = [];
  const chCount = new Map();
  for (const p of R.pairs) {
    if (p.type === '동일' || p.type === '대기') continue;
    const c = clauseOf(p, 'n') || clauseOf(p, 'o');
    const keys = [chapterKey(p)];
    const sec = c && (c.level === 2 ? p.key : (c.path.find((x) => x.level === 2) && R.pairByClause.get(c.path.find((x) => x.level === 2).id)?.key));
    if (sec && c.level >= 2) keys.push(sec);
    for (const k of keys) if (k) chCount.set(k, (chCount.get(k) || 0) + 1);
  }
  const pre = chCount.get('(머리말)');
  if (pre) nodes.push(`<li class="lv1" data-jump="(머리말)">(머리말)<span class="cnt">${pre}</span></li>`);
  for (const p of R.pairs) {
    const c = clauseOf(p, 'n') || clauseOf(p, 'o');
    if (!c || c.level < 1 || c.level > 2) continue;
    const n = chCount.get(p.key) || 0;
    nodes.push(`<li class="lv${c.level} ${p.type === '삭제' ? 'gone' : ''} ${p.type === '추가' ? 'new' : ''}" data-jump="${esc(p.key)}" title="${esc(c.label)}">${esc(c.label)}${n ? `<span class="cnt">${n}</span>` : ''}</li>`);
  }
  $('#toc').innerHTML = `<div class="toc-h">목차 <small>(변경 건수)</small></div><ul>${nodes.join('') || '<li class="muted">장·절이 없습니다</li>'}</ul>`;
}

function diffHtml(o, n) {
  return TextDiff.toHtml(TextDiff.diff(o, n, UI.diffMode), esc);
}

function cardHtml(p) {
  const o = clauseOf(p, 'o'), n = clauseOf(p, 'n'), nt = finalText(n);
  let L = '', Rr = '';
  if (o && n) {
    if (p.textChanged || p.minor) [L, Rr] = diffHtml(o.text, nt);
    else { L = esc(o.text); Rr = esc(nt); }
  } else { L = o ? `<del class="whole">${esc(o.text)}</del>` : ''; Rr = n ? `<ins class="whole">${esc(nt)}</ins>` : ''; }
  if (p.type === '대기') { L = o ? esc(o.text) : ''; Rr = n ? esc(nt) : ''; }
  const note = P.notes[p.key] || {};
  const typeLabel = p.type === '이동' && p.textChanged ? '이동·수정' : p.type;
  const loc = pathText(n || o);
  return `<article class="card t-${p.type}" data-key="${esc(p.key)}" data-order="${p.order}">
    <header>
      <span class="tbadge">${typeLabel}</span>
      ${o && n && p.numChanged ? `<span class="nbadge">번호 변경: ${esc(o.num)} → ${esc(n.num)}</span>` : ''}
      ${p.edited ? `<span class="ebadge" title="${esc(hhmm(P.edits[n.id].at))}에 직접 수정">직접 수정</span>` : ''}
      ${p.minor ? '<span class="nbadge" title="설정에서 무시하도록 한 가운뎃점·띄어쓰기 차이만 있습니다">표기 차이</span>' : ''}
      ${p.type === '이동' && o ? `<span class="nbadge blue">기존 위치: ${esc(pathText(o) || '-')}</span>` : ''}
      <span class="loc">${esc(loc)}</span>
      <span class="sp"></span>
      ${o && n ? `<span class="sim" title="제목·본문 유사도">유사도 ${pct(p.sim)}</span>` : ''}
      ${p.manual ? '<span class="mbadge">수동 연결</span>' : ''}
      ${p.type === '대기' ? '' : o && n ? '<button class="btn-s" data-act="unlink">연결 해제</button>' : '<button class="btn-s" data-act="link">수동 연결…</button>'}
    </header>
    <div class="cols">
      <div class="side old">${o ? `<div class="lbl">기존 · ${esc(o.label)}</div><div class="txt">${L}</div>` : '<div class="none">&lt;신 설&gt;</div>'}</div>
      <div class="side new">${n ? `<div class="lbl">개정 · ${esc(n.label)}${p.edited ? ' · 최종본' : ''}<span class="sp"></span>
        <button class="btn-s edit-btn" data-act="edit" title="개정 내용을 직접 고쳐 최종본으로 저장">수정</button></div><div class="txt">${Rr}</div>` : '<div class="none">&lt;삭 제&gt;</div>'}</div>
    </div>
    ${p.type !== '동일' && p.type !== '대기' ? `<footer>
      <input data-f="reason" placeholder="변경 사유" value="${esc(note.reason || '')}">
      <input data-f="ref" class="ref" placeholder="관련 제안번호 (예: P-003)" value="${esc(note.ref || '')}">
    </footer>` : ''}
  </article>`;
}

function renderPairs() {
  const list = visiblePairs();
  $('#pairList').innerHTML = list.length ? list.map(cardHtml).join('') : '<div class="empty-list">조건에 맞는 조항이 없습니다.</div>';
  $('#listCount').textContent = `${list.length}건 표시`;
}

function jumpTo(key) {
  let target;
  if (key === '(머리말)') target = $('#pairList .card');
  else {
    const p = R.pairs.find((x) => x.key === key);
    if (!p) return;
    target = $$('#pairList .card').find((el) => +el.dataset.order >= p.order);
  }
  if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); target.classList.add('flash'); setTimeout(() => target.classList.remove('flash'), 1200); }
  else toast('현재 보기에서는 해당 위치 이후에 표시할 조항이 없습니다.');
}

async function loadDoc(side, name, buf) {
  try {
    const { blocks, warnings } = await DocParser.parse(name, buf);
    const prev = side === 'o' ? R.old : R.neu;
    const doc = { name, blocks, warnings, loadedAt: new Date().toISOString(), ...docSource(name, buf) };
    if (side === 'o') P.oldDoc = doc; else P.newDoc = doc;
    const next = segmentSide(doc, side);
    const lost = remapSide(side, prev, next);
    if (!P.meta.manual && side === 'n') {
      const first = blocks.find((b) => b.type === 'p' && b.text.trim());
      if (first) P.meta.manual = first.text.replace(/\s+/g, ' ').trim().slice(0, 60);
    }
    reanalyze();
    toast(`${name} 읽기 완료${lost ? ` · 연결할 조항을 찾지 못한 사유 ${lost}건은 삭제됨` : ''}`);
  } catch (e) {
    console.error(e);
    toast(`${name}: ${e.message}`, 'error');
  }
}

function unlinkPair(p) {
  P.links = P.links.filter((l) => !(l.oldId === p.oldId && l.newId === p.newId));
  if (!P.unlinks.some((l) => l.oldId === p.oldId && l.newId === p.newId)) P.unlinks.push({ oldId: p.oldId, newId: p.newId });
  const note = P.notes[p.key];
  if (note) { P.notes[`${p.oldId}|`] = { ...note }; delete P.notes[p.key]; }
  reanalyze();
  toast('연결을 해제했습니다. 두 조항은 각각 삭제·추가로 표시됩니다.');
}

function linkDialog(p) {
  const fromOld = !!p.oldId;
  const src = fromOld ? R.byO.get(p.oldId) : R.byN.get(p.newId);
  const pool = fromOld ? R.neu : R.old;
  const srcIdx = (fromOld ? R.old : R.neu).indexOf(src);
  const items = pool.map((c, k) => {
    const sim = R.S ? (fromOld ? R.S[srcIdx * R.m + k] : R.S[k * R.m + srcIdx]) : 0;
    const cur = R.pairByClause.get(c.id);
    const paired = !!(cur && cur.oldId && cur.newId);
    return { c, sim, paired, cur };
  }).sort((a, b) => (a.paired - b.paired) || (b.sim - a.sim));
  modal(`<h3>수동 연결</h3>
    <p class="muted">${fromOld ? '기존' : '신규'} 조항 <b>${esc(src.label)}</b> 과(와) 연결할 ${fromOld ? '신규' : '기존'} 조항을 고르세요. 이미 짝이 있는 조항을 고르면 그 짝은 해제됩니다.</p>
    <input class="search" placeholder="번호나 내용으로 찾기">
    <ul class="pick">${items.map((it, i) => `<li data-i="${i}" data-hay="${esc((it.c.label + it.c.text).replace(/\s+/g, ''))}">
      <span class="sim">${pct(it.sim)}</span><b>${esc(it.c.label)}</b> <span class="muted">${esc(pathText(it.c))}</span>
      ${it.paired ? '<span class="paired">짝 있음</span>' : '<span class="free">짝 없음</span>'}
      <div class="prev">${esc(it.c.text.slice(0, 140))}</div></li>`).join('')}</ul>
    <div class="modal-f"><button data-close>취소</button></div>`, (box, close) => {
    const inp = $('.search', box);
    inp.focus();
    inp.oninput = () => { const q = inp.value.replace(/\s+/g, ''); $$('.pick li', box).forEach((li) => (li.hidden = q && !li.dataset.hay.includes(q))); };
    $('.pick', box).onclick = (e) => {
      const li = e.target.closest('li'); if (!li) return;
      const it = items[+li.dataset.i];
      const oldId = fromOld ? src.id : it.c.id, newId = fromOld ? it.c.id : src.id;
      const note = P.notes[p.key];
      P.links = P.links.filter((l) => l.oldId !== oldId && l.newId !== newId);
      P.links.push({ oldId, newId });
      P.unlinks = P.unlinks.filter((l) => !(l.oldId === oldId && l.newId === newId));
      if (note && !P.notes[`${oldId}|${newId}`]) { P.notes[`${oldId}|${newId}`] = note; delete P.notes[p.key]; }
      close();
      reanalyze();
      toast(`${src.label} ↔ ${it.c.label} 수동 연결했습니다.`);
    };
  });
}

// 대비표 행
function compareRows(all) {
  return R.pairs.filter((p) => p.type !== '대기' && (all || p.type !== '동일')).map((p, i) => {
    const o = clauseOf(p, 'o'), n = clauseOf(p, 'n'), note = P.notes[p.key] || {};
    return { no: i + 1, p, o, n, nt: finalText(n), loc: locText(p), type: p.type === '이동' && p.textChanged ? '이동·수정' : p.type, reason: note.reason || '', ref: note.ref || '' };
  });
}

function exportCompareXlsx() {
  if (!R.old.length || !R.neu.length) return toast('기존·신규 파일을 모두 올려 주세요.', 'error');
  const rows = compareRows(UI.exportAll);
  const sheet = {
    name: '신구대비표', header: true, widths: [6, 28, 10, 55, 55, 30, 14],
    rows: [['연번', '위치', '변경 유형', '기존 내용', '개정 내용', '변경 사유', '관련 제안'],
      ...rows.map((r) => [{ v: r.no, s: 'center' }, r.loc, { v: r.type, s: 'center' }, r.o ? r.o.text : '<신 설>', r.n ? r.nt : '<삭 제>', r.reason, r.ref])],
  };
  download(`신구대비표_${fileSafe(P.meta.manual) || '교범'}_${today()}.xlsx`, Xlsx.build([sheet]), XLSX_TYPE);
  toast(`대비표 ${rows.length}행을 엑셀로 내보냈습니다.`);
}

// 한글에 붙여넣기 좋은 HTML 표로 클립보드 복사 (바뀐 부분 밑줄)
function copyCompareTable() {
  if (!R.old.length || !R.neu.length) return toast('기존·신규 파일을 모두 올려 주세요.', 'error');
  const rows = compareRows(UI.exportAll);
  const cell = (s) => `<td style="border:1px solid #000;padding:4px;vertical-align:top;font-family:'맑은 고딕';font-size:10pt">${s}</td>`;
  const br = (s) => s.replace(/\n/g, '<br>');
  const body = rows.map((r) => {
    let L = r.o ? esc(r.o.text) : '&lt;신 설&gt;', Rr = r.n ? esc(r.nt) : '&lt;삭 제&gt;';
    if (r.o && r.n && r.p.textChanged) [L, Rr] = TextDiff.toHtml(TextDiff.diff(r.o.text, r.nt, 'word'), esc, ['<u>', '</u>'], ['<u><b>', '</b></u>']);
    return `<tr>${cell(r.no)}${cell(br(esc(r.loc)))}${cell(r.type)}${cell(br(L))}${cell(br(Rr))}${cell(br(esc(r.reason)))}</tr>`;
  }).join('');
  const th = (s) => `<th style="border:1px solid #000;padding:4px;background:#e5e5e5;font-family:'맑은 고딕';font-size:10pt">${s}</th>`;
  const html = `<table style="border-collapse:collapse"><tr>${th('연번')}${th('위치')}${th('변경 유형')}${th('현 행')}${th('개 정 안')}${th('개정 사유')}</tr>${body}</table>`;
  const holder = document.createElement('div');
  holder.contentEditable = 'true';
  holder.style.cssText = 'position:fixed;left:-9999px;top:0';
  holder.innerHTML = html;
  document.body.appendChild(holder);
  const range = document.createRange(); range.selectNodeContents(holder);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
  const ok = document.execCommand('copy');
  sel.removeAllRanges(); holder.remove();
  toast(ok ? `대비표 ${rows.length}행을 복사했습니다. 한글 문서에 붙여넣으세요 (바뀐 부분은 밑줄).` : '복사하지 못했습니다. 엑셀 내보내기를 이용해 주세요.', ok ? '' : 'error');
}

// ------------------------------------------------------------ B. 제안 종합
function importProposalJson(name, text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { return { error: `${name}: JSON 형식이 아닙니다.` }; }
  if (!data || data.type !== 'kyobeom-proposal' || !Array.isArray(data.items)) return { error: `${name}: 수정 제안 파일이 아닙니다.` };
  let added = 0, dup = 0;
  let seq = P.proposals.reduce((m, x) => Math.max(m, +String(x.no).replace(/\D/g, '') || 0), 0);
  for (const it of data.items) {
    const uid = it.uid || `${name}#${data.items.indexOf(it)}`;
    if (P.proposals.some((x) => x.uid === uid)) { dup++; continue; }
    seq++;
    P.proposals.push({
      uid, no: `P-${String(seq).padStart(3, '0')}`, receivedAt: data.savedAt || new Date().toISOString(), sourceFile: name,
      proposer: { unit: '', rank: '', name: '', contact: '', ...(data.proposer || {}) },
      location: { manual: data.manual || '', page: '', clause: '', table: '', figure: '', ...(it.location || {}) },
      category: it.category || '', current: it.current || '', proposed: it.proposed || '', reason: it.reason || '',
      images: Array.isArray(it.images) ? it.images : [], review: { result: '', reason: '' },
    });
    added++;
  }
  return { added, dup };
}

async function importProposalFiles(files) {
  let added = 0, dup = 0; const errors = [];
  for (const f of files) {
    const r = importProposalJson(f.name, await f.text());
    if (r.error) errors.push(r.error); else { added += r.added; dup += r.dup; }
  }
  dirty(); render();
  toast(`제안 ${added}건을 불러왔습니다${dup ? ` (이미 있는 ${dup}건 제외)` : ''}${errors.length ? ` · 오류: ${errors.join(' / ')}` : ''}`, errors.length ? 'error' : '');
}

const locShort = (l) => [l.page && `${l.page}쪽`, l.clause, l.table, l.figure].filter(Boolean).join(' / ');
const proposerText = (p) => [p.unit, p.rank, p.name].filter(Boolean).join(' ') + (p.contact ? `\n(${p.contact})` : '');

function filteredProposals() {
  const { cat, res, q } = UI.pf;
  const qq = q.replace(/\s+/g, '');
  const list = P.proposals.filter((x) => (!cat || x.category === cat) && (!res || (res === '미심의' ? !x.review.result : x.review.result === res)) &&
    (!qq || [x.no, proposerText(x.proposer), locShort(x.location), x.current, x.proposed, x.reason, x.review.reason].join(' ').replace(/\s+/g, '').includes(qq)));
  const { key, dir } = UI.psort;
  const val = (x) => key === 'no' ? x.no : key === 'cat' ? x.category : key === 'res' ? (x.review.result || 'ㅎ') : key === 'unit' ? x.proposer.unit : key === 'loc' ? locShort(x.location) : x.no;
  return list.sort((a, b) => String(val(a)).localeCompare(String(val(b)), 'ko', { numeric: true }) * dir);
}

// [제안 종합] 탭에 제안이 없으면 [수정 반영]에 올린 종합 엑셀의 심의 결과로 집계
function reviewStats() {
  const results = P.proposals.length ? P.proposals.map((x) => x.review.result) : (P.apply?.rows || []).map((r) => r.result);
  const s = { total: results.length, 반영: 0, 부분반영: 0, 미반영: 0, 미심의: 0 };
  for (const r of results) s[r || '미심의']++;
  s.done = s.total - s.미심의;
  s.rate = s.done ? (s.반영 + s.부분반영) / s.done : 0;
  return s;
}

function renderProposals() {
  const s = reviewStats();
  $('#propStats').innerHTML = `접수 <b>${s.total}</b>건 · 반영 <b>${s.반영}</b> · 부분반영 <b>${s.부분반영}</b> · 미반영 <b>${s.미반영}</b> · 미심의 <b>${s.미심의}</b>`;
  $('#pfCat').innerHTML = `<option value="">구분 전체</option>${CATEGORIES.map((c) => `<option ${UI.pf.cat === c ? 'selected' : ''}>${c}</option>`).join('')}`;
  $('#pfRes').innerHTML = `<option value="">심의 전체</option>${[...REVIEW, '미심의'].map((c) => `<option ${UI.pf.res === c ? 'selected' : ''}>${c}</option>`).join('')}`;
  const list = filteredProposals();
  const arrow = (k) => UI.psort.key === k ? (UI.psort.dir > 0 ? ' ▲' : ' ▼') : '';
  $('#propTable').innerHTML = P.proposals.length ? `<table class="ptable"><thead><tr>
      <th data-sort="no">번호${arrow('no')}</th><th data-sort="unit">제안자${arrow('unit')}</th><th data-sort="loc">위치${arrow('loc')}</th><th data-sort="cat">구분${arrow('cat')}</th>
      <th>현행 내용</th><th>수정 제안</th><th>근거</th><th>첨부</th><th data-sort="res">심의 결과${arrow('res')}</th><th>사유</th><th></th></tr></thead><tbody>
      ${list.map((x) => `<tr data-uid="${esc(x.uid)}" class="${x.review.result ? 'r-' + x.review.result : ''}">
        <td class="no"><a href="#" data-act="detail">${esc(x.no)}</a></td>
        <td>${esc(proposerText(x.proposer)).replace(/\n/g, '<br>')}</td>
        <td>${esc(locShort(x.location))}</td>
        <td><span class="cat">${esc(x.category)}</span></td>
        <td data-act="detail"><div class="clip">${esc(x.current)}</div></td>
        <td data-act="detail"><div class="clip">${esc(x.proposed)}</div></td>
        <td data-act="detail"><div class="clip">${esc(x.reason)}</div></td>
        <td>${x.images.length ? `<a href="#" data-act="detail">${x.images.length}장</a>` : '-'}</td>
        <td><select data-f="result"><option value="">미심의</option>${REVIEW.map((r) => `<option ${x.review.result === r ? 'selected' : ''}>${r}</option>`).join('')}</select></td>
        <td><textarea data-f="rreason" rows="2" placeholder="심의 사유">${esc(x.review.reason)}</textarea></td>
        <td><button class="btn-x" data-act="del" title="이 제안 삭제">✕</button></td></tr>`).join('')}
      </tbody></table>${list.length ? '' : '<div class="empty-list">조건에 맞는 제안이 없습니다.</div>'}`
    : '<div class="empty-list">아직 불러온 제안이 없습니다. 제안자에게 받은 <b>.json</b> 파일을 위 영역에 끌어 놓으세요.</div>';
}

// 온라인 제출 제안 가져오기 (Supabase · 작성자 접근 키)
const KEY_STORE = 'singu-author-key';
const sessionKey = { get: () => { try { return sessionStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; } }, set: (v) => { try { v ? sessionStorage.setItem(KEY_STORE, v) : sessionStorage.removeItem(KEY_STORE); } catch (e) { /* 저장 불가 */ } } };

function askAuthorKey() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    modal(`<h3>작성자 접근 키</h3>
      <p class="muted">온라인으로 제출된 제안을 읽으려면 작성자 접근 키가 필요합니다. 키는 Supabase 설정 때 정한 값입니다.</p>
      <input id="akey" type="password" class="search" autocomplete="off" placeholder="작성자 접근 키">
      <label class="chk"><input id="akeyKeep" type="checkbox" checked> 이 창을 닫을 때까지 기억</label>
      <div class="modal-f"><button data-close>취소</button><button id="akeyOk" class="primary">불러오기</button></div>`, (box, close) => {
      const inp = $('#akey', box);
      inp.focus();
      const ok = () => { const v = inp.value.trim(); if (!v) return inp.focus(); const keep = $('#akeyKeep', box).checked; close(); finish({ key: v, keep }); };
      $('#akeyOk', box).onclick = ok;
      inp.onkeydown = (e) => { if (e.key === 'Enter') ok(); };
      $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) finish(null); });
    });
  });
}

async function fetchCloudProposals() {
  let key = sessionKey.get(), keep = true;
  if (!key) { const r = await askAuthorKey(); if (!r) return; ({ key, keep } = r); }
  const btn = $('#btnCloud');
  btn.disabled = true; btn.textContent = '불러오는 중…';
  try {
    const rows = await Cloud.listProposals(key);
    sessionKey.set(keep ? key : '');
    let added = 0, dup = 0;
    for (const row of rows || []) {
      const r = importProposalJson(`온라인 제출 ${String(row.id).slice(0, 8).toUpperCase()}`, JSON.stringify({
        type: 'kyobeom-proposal', version: 1, savedAt: row.created_at, proposer: row.proposer, manual: row.manual, items: row.items,
      }));
      if (!r.error) { added += r.added; dup += r.dup; }
    }
    dirty(); render();
    toast(`온라인 제출 ${rows.length}건 확인 · 새 제안 ${added}건 추가${dup ? ` (이미 있는 ${dup}건 제외)` : ''}`);
  } catch (e) {
    if (e.invalidKey) sessionKey.set('');
    toast(e.message, 'error');
  } finally { btn.disabled = false; btn.textContent = '온라인 제안 불러오기'; }
}

function proposalDetail(x) {
  modal(`<h3>${esc(x.no)} · ${esc(x.category)}</h3>
    <dl class="detail">
      <dt>제안자</dt><dd>${esc(proposerText(x.proposer)).replace(/\n/g, ' ')}</dd>
      <dt>교범</dt><dd>${esc(x.location.manual)}</dd>
      <dt>위치</dt><dd>${esc(locShort(x.location)) || '-'}</dd>
      <dt>현행 내용</dt><dd class="pre">${esc(x.current)}</dd>
      <dt>수정 제안</dt><dd class="pre">${esc(x.proposed)}</dd>
      <dt>제안 근거</dt><dd class="pre">${esc(x.reason)}</dd>
      <dt>접수</dt><dd>${esc(hhmm(x.receivedAt))} · ${esc(x.sourceFile)}</dd>
    </dl>
    ${x.images.length ? `<div class="imgs">${x.images.map((im) => `<figure><img src="${esc(im.data)}" alt="${esc(im.name)}"><figcaption>${esc(im.name)}</figcaption></figure>`).join('')}</div><p class="muted">이미지를 누르면 크게 보입니다.</p>` : ''}
    <div class="modal-f"><button data-close>닫기</button></div>`, (box) => {
    box.classList.add('wide');
    $$('.imgs img', box).forEach((img) => (img.onclick = () => img.closest('figure').classList.toggle('zoom')));
  });
}

function exportProposalsXlsx() {
  if (!P.proposals.length) return toast('불러온 제안이 없습니다.', 'error');
  const list = filteredProposals();
  const sheet = {
    name: '수정사항 종합', header: true, widths: [6, 9, 22, 22, 11, 40, 40, 30, 12, 10, 30],
    rows: [['연번', '제안번호', '제안자 정보', '위치(페이지/장·절·항/표/그림)', '구분', '현행 내용', '수정 제안', '근거', '이미지 첨부', '심의 결과', '사유'],
      ...list.map((x, i) => [{ v: i + 1, s: 'center' }, { v: x.no, s: 'center' }, proposerText(x.proposer),
        [x.location.page && `페이지: ${x.location.page}`, x.location.clause && `장·절·항: ${x.location.clause}`, x.location.table && `표: ${x.location.table}`, x.location.figure && `그림: ${x.location.figure}`].filter(Boolean).join('\n'),
        { v: x.category, s: 'center' }, x.current, x.proposed, x.reason, { v: x.images.length ? `첨부 있음(${x.images.length}장)` : '없음', s: 'center' },
        { v: x.review.result || '미심의', s: 'center' }, x.review.reason])],
  };
  download(`수정사항종합_${fileSafe(P.meta.manual) || '교범'}_${today()}.xlsx`, Xlsx.build([sheet]), XLSX_TYPE);
  toast(`제안 ${list.length}건을 엑셀로 내보냈습니다.`);
}

function dataUrlBytes(url) {
  const b64 = url.split(',')[1] || '';
  const bin = atob(b64), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function exportProposalImages() {
  const files = [];
  for (const x of P.proposals) {
    const used = new Set();
    x.images.forEach((im, k) => {
      let n = fileSafe(im.name) || `image${k + 1}`;
      if (!/\.\w+$/.test(n)) n += im.type === 'image/png' ? '.png' : '.jpg';
      while (used.has(n)) n = n.replace(/(\.\w+)$/, `_${k + 1}$1`);
      used.add(n);
      files.push({ name: `${x.no}_${fileSafe(x.proposer.unit)}_${fileSafe(x.proposer.name)}/${n}`, data: dataUrlBytes(im.data) });
    });
  }
  if (!files.length) return toast('첨부 이미지가 있는 제안이 없습니다.', 'error');
  download(`제안첨부이미지_${fileSafe(P.meta.manual) || '교범'}_${today()}.zip`, Zip.build(files), 'application/zip');
  toast(`이미지 ${files.length}장을 ZIP으로 내보냈습니다.`);
}

// ------------------------------------------------------------ C. 종합 평가
function tableFigureChanges() {
  const out = [];
  const add = (p, kind, change, before, after) => out.push({ p, kind, change, before, after });
  for (const p of R.pairs) {
    const o = clauseOf(p, 'o'), n = clauseOf(p, 'n');
    for (const [kind, key] of [['표', 'tables'], ['그림', 'figures']]) {
      const A = o ? o[key] : [], B = n ? n[key] : [];
      const usedB = new Set(), pairs = [], restA = [];
      A.forEach((a) => {
        const k = B.findIndex((b, i) => !usedB.has(i) && b.caption === a.caption && (kind === '그림' || b.text === a.text));
        const k2 = k >= 0 ? k : B.findIndex((b, i) => !usedB.has(i) && a.caption && b.caption === a.caption);
        if (k2 >= 0) { usedB.add(k2); pairs.push([a, B[k2]]); } else restA.push(a);
      });
      const restB = B.filter((_, i) => !usedB.has(i));
      while (restA.length && restB.length) pairs.push([restA.shift(), restB.shift()]);
      for (const [a, b] of pairs) {
        if (a.caption !== b.caption) add(p, kind, '캡션 변경', a.caption || '(캡션 없음)', b.caption || '(캡션 없음)');
        if (kind === '표' && a.text !== b.text) add(p, kind, '내용 변경', a.caption || '(캡션 없음)', b.caption || '(캡션 없음)');
      }
      restA.forEach((a) => add(p, kind, '삭제', a.caption || '(캡션 없음)', ''));
      restB.forEach((b) => add(p, kind, '추가', '', b.caption || '(캡션 없음)'));
    }
  }
  return out;
}

function reportData() {
  const c = counts();
  const total = R.pairs.filter((p) => p.type !== '대기').length;
  const changed = CHANGE_TYPES.reduce((s, t) => s + c[t], 0);
  const numOnly = R.pairs.filter((p) => p.type === '동일' && p.numChanged).length;
  const chapters = [];
  const chMap = new Map();
  const ensureCh = (key) => {
    if (!chMap.has(key)) {
      const p = R.pairs.find((x) => x.key === key);
      const cl = p && (clauseOf(p, 'n') || clauseOf(p, 'o'));
      const row = { key, label: cl ? cl.label : '(머리말)', 수정: 0, 추가: 0, 삭제: 0, 이동: 0, total: 0 };
      chMap.set(key, row); chapters.push(row);
    }
    return chMap.get(key);
  };
  for (const p of R.pairs) {
    if (p.type === '대기') continue;
    const k = chapterKey(p);
    if (!k) continue;
    const row = ensureCh(k);
    if (CHANGE_TYPES.includes(p.type)) { row[p.type]++; row.total++; }
  }
  const top = R.pairs.filter((p) => p.type === '수정' || (p.type === '이동' && p.textChanged)).sort((a, b) => a.sim - b.sim).slice(0, 10);
  return { c, total, changed, numOnly, chapters, top, tf: tableFigureChanges(), rs: reviewStats() };
}

function renderReport() {
  const box = $('#reportBody');
  $('.print-head').textContent = `${P.meta.manual || '교범'} 개정 종합 평가 · ${P.meta.author || ''} · ${new Date().toLocaleDateString('ko-KR')}`;
  if (!R.old.length || !R.neu.length) {
    box.innerHTML = '<div class="empty-list">[신·구 비교] 탭에서 기존·신규 교범을 모두 올리면 종합 평가가 만들어집니다.</div>' + overallBox() + proposalBlock(reviewStats());
    bindOverall();
    return;
  }
  const d = reportData();
  const max = Math.max(1, ...d.chapters.map((r) => r.total));
  box.innerHTML = `
    <div class="kpis">
      <div class="kpi"><span>기존 조항</span><b>${R.old.length}</b></div>
      <div class="kpi"><span>신규 조항</span><b>${R.neu.length}</b></div>
      <div class="kpi"><span>변경 조항</span><b>${d.changed}</b><small>${pct(d.total ? d.changed / d.total : 0)}</small></div>
      <div class="kpi"><span>번호만 변경</span><b>${d.numOnly}</b></div>
      <div class="kpi"><span>직접 수정(최종본)</span><b>${R.pairs.filter((p) => p.edited).length}</b></div>
      <div class="kpi accent"><span>제안 반영률</span><b>${d.rs.done ? pct(d.rs.rate) : '-'}</b><small>${d.rs.done}/${d.rs.total}건 심의</small></div>
    </div>
    <div class="grid2">
      <section class="panel"><h3>유형별 변경</h3>
        <table class="rtable"><tr><th>유형</th><th>건수</th><th>비율(전체 ${d.total}개 대비)</th></tr>
        ${ALL_TYPES.map((t) => `<tr><td><span class="dot t-${t}"></span>${t}</td><td class="num">${d.c[t]}</td><td><div class="bar"><i class="t-${t}" style="width:${d.total ? (d.c[t] / d.total) * 100 : 0}%"></i></div><span class="num">${pct(d.total ? d.c[t] / d.total : 0)}</span></td></tr>`).join('')}
        </table></section>
      <section class="panel"><h3>장별 변경 건수</h3>
        <div class="legend">${CHANGE_TYPES.map((t) => `<span><i class="dot t-${t}"></i>${t}</span>`).join('')}</div>
        <div class="hbars">${d.chapters.filter((r) => r.total).map((r) => `<div class="hrow"><span class="hl" title="${esc(r.label)}">${esc(r.label)}</span><div class="hb">${CHANGE_TYPES.map((t) => r[t] ? `<i class="t-${t}" style="width:${(r[t] / max) * 100}%" title="${t} ${r[t]}건"></i>` : '').join('')}</div><span class="num">${r.total}</span></div>`).join('') || '<p class="muted">변경이 없습니다.</p>'}</div>
      </section>
    </div>
    <section class="panel"><h3>변경 폭이 큰 조항 Top 10 <small>(유사도 낮은 순)</small></h3>
      <table class="rtable"><tr><th>순위</th><th>위치</th><th>유형</th><th>유사도</th><th>변경 사유</th></tr>
      ${d.top.map((p, i) => `<tr><td class="num">${i + 1}</td><td><a href="#" data-goto="${esc(p.key)}">${esc(locText(p).split('\n')[0])}</a></td><td>${p.type}</td><td class="num">${pct(p.sim)}</td><td>${esc(P.notes[p.key]?.reason || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">수정된 조항이 없습니다.</td></tr>'}
      </table></section>
    <section class="panel"><h3>표·그림 변경 목록</h3>
      <table class="rtable"><tr><th>구분</th><th>변경</th><th>기존</th><th>신규</th><th>조항</th></tr>
      ${d.tf.map((x) => `<tr><td>${x.kind}</td><td>${x.change}</td><td>${esc(x.before)}</td><td>${esc(x.after)}</td><td><a href="#" data-goto="${esc(x.p.key)}">${esc((clauseOf(x.p, 'n') || clauseOf(x.p, 'o')).label)}</a></td></tr>`).join('') || '<tr><td colspan="5" class="muted">표·그림 변경이 없습니다.</td></tr>'}
      </table></section>
    ${proposalBlock(d.rs)}
    ${overallBox()}`;
  bindOverall();
}

function proposalBlock(rs) {
  return `<section class="panel"><h3>제안 반영 현황</h3>
    <table class="rtable"><tr><th>접수</th><th>반영</th><th>부분반영</th><th>미반영</th><th>미심의</th><th>반영률<small> (반영+부분반영 / 심의 완료)</small></th></tr>
    <tr><td class="num">${rs.total}</td><td class="num">${rs.반영}</td><td class="num">${rs.부분반영}</td><td class="num">${rs.미반영}</td><td class="num">${rs.미심의}</td><td class="num">${rs.done ? pct(rs.rate) : '-'}</td></tr></table></section>`;
}

const overallBox = () => `<section class="panel"><h3>작성자 총평</h3><textarea id="overall" rows="7" placeholder="주요 개정 방향, 핵심 변경 사항 등을 적어 주세요.">${esc(P.summary.overall)}</textarea><div class="print-only overall-print">${esc(P.summary.overall).replace(/\n/g, '<br>')}</div>
  <div class="llm-row no-print">
    <button id="btnLlmDraft" title="Google Gemini로 총평 초안을 만들어 총평 칸 아래에 덧붙입니다">AI 총평 초안 생성</button>
    <button id="btnLlmSettings" class="ghost" title="Gemini API 키와 모델을 정합니다">AI 설정</button>
    <button id="btnLlmPrompt" class="ghost" title="LLM에 보낼 요청문을 복사합니다. 다른 LLM 화면에 붙여넣어 쓸 수도 있습니다">LLM 요청문 복사</button>
    <small id="llmStatus" class="muted">${esc(llmStatus())}</small>
  </div></section>`;

function llmStatus() {
  const s = LLM.loadSettings();
  return s.key ? `${LLM.PROVIDER} · ${s.model} · 키 ${s.remember ? '이 브라우저에 저장됨' : '이 탭에서만 사용'}` : 'Gemini API 키를 넣으면 AI 초안을 만들 수 있습니다 → [AI 설정]';
}

// Gemini API 키·모델 설정
function llmSettingsDialog(after) {
  const s = LLM.loadSettings();
  modal(`<h3>AI 설정 · Google Gemini</h3>
    <p class="muted">총평 초안은 Google Gemini API로 만듭니다. 무료 API 키는 <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio → Get API key</a>에서 받을 수 있습니다.</p>
    <label class="fld"><span>Gemini API 키</span>
      <div class="keyrow"><input id="gKey" type="password" autocomplete="off" spellcheck="false" placeholder="AIza…" value="${esc(s.key)}"><button id="gShow" class="ghost" type="button">보기</button></div>
      <small>키는 이 PC의 브라우저에만 저장되고, 작업 파일·GitHub·서버에는 들어가지 않습니다.</small></label>
    <label class="fld"><span>모델</span>
      <input id="gModel" list="gModels" value="${esc(s.model)}" spellcheck="false">
      <datalist id="gModels">${LLM.MODELS.map((m) => `<option value="${m}">`).join('')}</datalist>
      <small>[키 확인]을 누르면 이 키로 쓸 수 있는 모델로 목록이 바뀌고, 지금 모델을 못 쓰면 알맞은 모델로 자동으로 바꿉니다. 무료 사용량을 넘으면 이름에 lite가 들어간 가벼운 모델을 골라 보세요.</small></label>
    <label class="chk"><input id="gRemember" type="checkbox" ${s.remember ? 'checked' : ''}> 이 브라우저에 키 기억 (끄면 탭을 닫을 때 지워짐)</label>
    <aside class="callout" style="margin:12px 0 0"><b>보내는 내용 확인</b><p>초안을 만들 때 변경 통계, 조항 번호, 바뀐 문구 일부(조항당 약 120자), 작성자가 적은 변경 사유가 Google로 전송됩니다. <b>무료 키는 보낸 내용이 Google 서비스 개선에 쓰일 수 있습니다.</b> 공개되면 안 되는 교범에는 쓰지 마세요.</p></aside>
    <div id="gMsg" class="muted" style="margin-top:8px"></div>
    <div class="modal-f"><button id="gClear" class="ghost">키 지우기</button><span class="sp"></span><button id="gTest">키 확인</button><button data-close>취소</button><button id="gSave" class="primary">저장</button></div>`, (box, close) => {
    const val = () => ({ key: $('#gKey', box).value.trim(), model: $('#gModel', box).value.trim() || LLM.MODELS[0], remember: $('#gRemember', box).checked });
    const msg = (t, err) => { const m = $('#gMsg', box); m.textContent = t; m.style.color = err ? 'var(--c-del)' : ''; };
    $('#gShow', box).onclick = () => { const i = $('#gKey', box); i.type = i.type === 'password' ? 'text' : 'password'; $('#gShow', box).textContent = i.type === 'password' ? '보기' : '숨기기'; };
    $('#gTest', box).onclick = async () => {
      const v = val(); if (!v.key) return msg('키를 넣어 주세요.', true);
      msg('확인 중… (교범 내용은 보내지 않습니다)');
      try {
        const models = await LLM.testKey(v.key);
        if (!models.length) return msg('키는 정상이지만 글 생성에 쓸 수 있는 Gemini 모델이 없습니다.', true);
        // 모델 칸 목록을 이 키로 실제 쓸 수 있는 모델로 바꿈 (추천 모델을 맨 위에)
        const best = LLM.pickModel(models.slice());
        $('#gModels', box).innerHTML = [best, ...models.filter((m) => m !== best)].map((m) => `<option value="${esc(m)}">${m === best ? '추천' : ''}</option>`).join('');
        if (models.includes(v.model)) msg(`키가 정상입니다. ${v.model} 사용 가능 (쓸 수 있는 모델 ${models.length}개)`);
        else { $('#gModel', box).value = best; msg(`키가 정상입니다. ${v.model}은 쓸 수 없어 ${best}(으)로 바꿨습니다. [저장]을 눌러 주세요.`); }
      } catch (e) { msg(e.message, true); }
    };
    $('#gClear', box).onclick = () => { LLM.saveSettings({ key: '', model: val().model, remember: false }); $('#gKey', box).value = ''; msg('키를 지웠습니다.'); refreshLlmStatus(); };
    $('#gSave', box).onclick = () => {
      const v = val(); if (!v.key) return msg('키를 넣어 주세요.', true);
      LLM.saveSettings(v); close(); refreshLlmStatus(); toast('AI 설정을 저장했습니다.');
      if (after) after();
    };
  });
}
const refreshLlmStatus = () => { const el = $('#llmStatus'); if (el) el.textContent = llmStatus(); };

// 보내기 전 확인 (탭마다 처음 한 번 + 내용 미리보기)
function confirmLlmSend(prompt) {
  let ok = false;
  try { ok = sessionStorage.getItem('singu-llm-ok') === '1'; } catch (e) { /* 저장 불가 */ }
  if (ok) return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    modal(`<h3>Google Gemini로 보낼까요?</h3>
      <p class="muted">아래 요청문(${(prompt.system + prompt.user).length.toLocaleString()}자)이 Google 서버로 전송됩니다. 교범 파일 전체는 보내지 않습니다. 무료 키는 보낸 내용이 Google 서비스 개선에 쓰일 수 있습니다.</p>
      <details><summary>보낼 내용 보기</summary><pre class="llm-preview">${esc(prompt.user)}</pre></details>
      <label class="chk" style="margin-top:10px"><input id="llmOkKeep" type="checkbox"> 이 탭에서는 다시 묻지 않기</label>
      <div class="modal-f"><button data-close>취소</button><button id="llmOkGo" class="primary">보내고 초안 만들기</button></div>`, (box, close) => {
      $('#llmOkGo', box).onclick = () => {
        if ($('#llmOkKeep', box).checked) { try { sessionStorage.setItem('singu-llm-ok', '1'); } catch (e) { /* 저장 불가 */ } }
        close(); finish(true);
      };
      $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) finish(false); });
    });
  });
}

// LLM 요청문에 넣을 재료 (비교 결과에서 바로 뽑음)
function llmPrompt() {
  const d = reportData();
  const top = d.top.map((p) => {
    const o = clauseOf(p, 'o'), n = clauseOf(p, 'n');
    const ops = TextDiff.diff(o.text, finalText(n), 'word');
    return { loc: locText(p).split('\n')[0], sim: pct(p.sim), del: ops.filter((x) => x[0] < 0).map((x) => x[1]).join(' '), ins: ops.filter((x) => x[0] > 0).map((x) => x[1]).join(' '), reason: P.notes[p.key]?.reason || '' };
  });
  const lab = (p) => (clauseOf(p, 'n') || clauseOf(p, 'o')).label;
  return LLM.buildPrompt(d, {
    manual: P.meta.manual, oldName: P.oldDoc?.name, newName: P.newDoc?.name, oldCount: R.old.length, newCount: R.neu.length, top,
    added: R.pairs.filter((p) => p.type === '추가').map(lab).slice(0, 30), deleted: R.pairs.filter((p) => p.type === '삭제').map(lab).slice(0, 30),
    reasons: Object.values(P.notes).map((v) => v.reason).filter(Boolean).slice(0, 30),
  });
}

function bindOverall() {
  $('#overall').oninput = (e) => { P.summary.overall = e.target.value; $('.overall-print').innerHTML = esc(e.target.value).replace(/\n/g, '<br>'); dirty(); };
  $('#btnLlmPrompt').onclick = () => {
    if (!R.old.length || !R.neu.length) return toast('기존·신규 파일을 모두 올려 주세요.', 'error');
    const p = llmPrompt();
    const ta = document.createElement('textarea');
    ta.value = `[지시]\n${p.system}\n\n[자료]\n${p.user}`;
    ta.style.cssText = 'position:fixed;left:-9999px'; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove();
    toast(ok ? `LLM 요청문(${(p.system + p.user).length}자)을 복사했습니다.` : '복사하지 못했습니다.', ok ? '' : 'error');
  };
  $('#btnLlmSettings').onclick = () => llmSettingsDialog();
  const draft = async () => {
    if (!R.old.length || !R.neu.length) return toast('기존·신규 파일을 모두 올려 주세요.', 'error');
    if (!LLM.ready()) return llmSettingsDialog(draft); // 키를 넣고 저장하면 이어서 진행
    const prompt = llmPrompt();
    if (!(await confirmLlmSend(prompt))) return;
    const btn = $('#btnLlmDraft');
    btn.disabled = true; btn.textContent = 'AI 초안 만드는 중…';
    try {
      const text = await LLM.draftSummary(prompt, (from, to) => { toast(`${from} 모델을 쓸 수 없어 ${to}(으)로 바꿔 다시 시도합니다.`); refreshLlmStatus(); });
      if (P.summary.overall.trim() && !confirm('지금 총평 아래에 AI 초안을 덧붙일까요?')) return;
      const { model } = LLM.loadSettings();
      P.summary.overall = (P.summary.overall.trim() ? P.summary.overall.trim() + '\n\n' : '') + `[AI 초안 · ${LLM.PROVIDER} ${model} · 검토 필요]\n${text}`;
      dirty(); renderReport();
      toast('AI 초안을 총평 칸에 덧붙였습니다. 수치와 조항 번호를 꼭 확인해 주세요.');
    } catch (e) { toast(e.message, 'error'); }
    finally { const b = $('#btnLlmDraft'); if (b) { b.disabled = false; b.textContent = 'AI 총평 초안 생성'; } }
  };
  $('#btnLlmDraft').onclick = draft;
}

function exportReportXlsx() {
  if (!R.old.length || !R.neu.length) return toast('기존·신규 파일을 모두 올려 주세요.', 'error');
  const d = reportData();
  const sheets = [
    { name: '요약', widths: [24, 14, 14, 50], rows: [
      [{ v: `${P.meta.manual || '교범'} 개정 종합 평가`, s: 'title' }], [],
      [{ v: '작성자', s: 'bold' }, { v: P.meta.author, s: 'default' }], [{ v: '작성일', s: 'bold' }, { v: new Date().toLocaleDateString('ko-KR'), s: 'default' }],
      [{ v: '기존 파일', s: 'bold' }, { v: P.oldDoc?.name, s: 'default' }], [{ v: '신규 파일', s: 'bold' }, { v: P.newDoc?.name, s: 'default' }], [],
      [{ v: '구분', s: 'head' }, { v: '건수', s: 'head' }, { v: '비율', s: 'head' }],
      ['기존 조항 수', R.old.length, ''], ['신규 조항 수', R.neu.length, ''],
      ...ALL_TYPES.map((t) => [t, d.c[t], pct(d.total ? d.c[t] / d.total : 0)]),
      ['번호만 변경(동일에 포함)', d.numOnly, ''], [],
      [{ v: '제안 반영 현황', s: 'bold' }],
      [{ v: '접수', s: 'head' }, { v: '반영', s: 'head' }, { v: '부분반영', s: 'head' }, { v: '미반영', s: 'head' }, { v: '미심의', s: 'head' }, { v: '반영률', s: 'head' }],
      [d.rs.total, d.rs.반영, d.rs.부분반영, d.rs.미반영, d.rs.미심의, d.rs.done ? pct(d.rs.rate) : '-'], [],
      [{ v: '작성자 총평', s: 'bold' }], [P.summary.overall || ''],
    ] },
    { name: '장별 변경', header: true, widths: [36, 8, 8, 8, 8, 8], rows: [['장', '수정', '추가', '삭제', '이동', '합계'], ...d.chapters.filter((r) => r.total || r.label !== '(머리말)').map((r) => [r.label, r.수정, r.추가, r.삭제, r.이동, r.total])] },
    { name: '변경 폭 Top10', header: true, widths: [6, 50, 10, 10, 40], rows: [['순위', '위치', '유형', '유사도', '변경 사유'], ...d.top.map((p, i) => [i + 1, locText(p), p.type, pct(p.sim), P.notes[p.key]?.reason || ''])] },
    { name: '표·그림 변경', header: true, widths: [8, 12, 36, 36, 30], rows: [['구분', '변경', '기존', '신규', '조항'], ...d.tf.map((x) => [x.kind, x.change, x.before, x.after, (clauseOf(x.p, 'n') || clauseOf(x.p, 'o')).label])] },
  ];
  download(`종합평가_${fileSafe(P.meta.manual) || '교범'}_${today()}.xlsx`, Xlsx.build(sheets), XLSX_TYPE);
  toast('종합 평가 리포트를 엑셀로 내보냈습니다.');
}

// ------------------------------------------------------------ 작업 파일 / 설정
function saveWorkFile() {
  P.meta.lastBackupAt = new Date().toISOString();
  const json = JSON.stringify(P);
  download(`작업파일_${fileSafe(P.meta.manual) || '교범'}_${today()}.json`, json, 'application/json');
  dirty();
  toast('작업 파일을 저장했습니다. 안전한 곳에 보관하세요.');
}

async function loadWorkFile(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.type === 'kyobeom-proposal') return importProposalFiles([file]);
    if (data.format !== 'kyobeom-project') throw new Error('작업 파일 형식이 아닙니다.');
    if ((P.oldDoc || P.newDoc || P.proposals.length) && !confirm('지금 작업 내용을 불러온 작업 파일로 바꿉니다. 계속할까요?')) return;
    P = Object.assign(newProject(), data);
    P.settings = { ...newProject().settings, ...data.settings };
    analyze(); dirty(); render();
    toast(`${file.name} 작업 파일을 불러왔습니다.`);
  } catch (e) { toast(`${file.name}: ${e.message}`, 'error'); }
}

function settingsDialog() {
  const s = P.settings;
  modal(`<h3>설정</h3>
    <label class="fld"><span>조항 번호 패턴</span>
      <textarea id="setPat" rows="11" spellcheck="false">${esc(s.patterns)}</textarea>
      <small>형식: <code>레벨|이름|정규식</code>. 레벨 1~2는 목차(장·절), 3 이상은 조항입니다. 하위 항목(가., 1) 등)까지 나누려면 레벨 4 줄을 추가하세요. 예: <code>4|하위|^[가-하]\\.\\s</code></small>
      <div id="patErr" class="err"></div></label>
    <div class="row2">
      <label class="fld"><span>매칭 기준 유사도 <b id="thV">${pct(s.threshold)}</b></span><input id="setTh" type="range" min="0.2" max="0.9" step="0.05" value="${s.threshold}"><small>낮추면 크게 바뀐 조항도 '수정'으로 짝짓고, 높이면 '삭제+추가'로 나눕니다.</small></label>
      <label class="fld"><span>이동 판정 유사도 <b id="mvV">${pct(s.moveThreshold)}</b></span><input id="setMv" type="range" min="0.3" max="0.95" step="0.05" value="${s.moveThreshold}"><small>순서를 벗어난 조항끼리 이 값 이상이면 '이동'으로 짝짓습니다.</small></label>
    </div>
    <label class="chk"><input id="setDot" type="checkbox" ${s.ignoreDots ? 'checked' : ''}> 가운뎃점 표기 차이(·, ㆍ, ․ 등)는 변경으로 보지 않음</label><br>
    <label class="chk"><input id="setSp" type="checkbox" ${s.ignoreSpace ? 'checked' : ''}> 띄어쓰기 차이는 변경으로 보지 않음</label><br>
    <small class="muted">위 두 가지에 해당하는 조항은 '동일'로 분류하고 [전체 보기]에서 '표기 차이' 배지로 표시합니다.</small><br>
    <label class="chk"><input id="setTb" type="checkbox" ${s.includeTextbox ? 'checked' : ''}> 그림·글상자 안의 글자도 비교에 포함</label>
    <div class="modal-f"><button id="setReset">기본값</button><span class="sp"></span><button data-close>취소</button><button id="setOk" class="primary">적용</button></div>`, (box, close) => {
    $('#setTh', box).oninput = (e) => ($('#thV', box).textContent = pct(+e.target.value));
    $('#setMv', box).oninput = (e) => ($('#mvV', box).textContent = pct(+e.target.value));
    $('#setReset', box).onclick = () => { $('#setPat', box).value = DEFAULT_PATTERNS; $('#setTh', box).value = 0.45; $('#setMv', box).value = 0.6; $('#setTb', box).checked = false; $('#setDot', box).checked = true; $('#setSp', box).checked = false; $('#thV', box).textContent = '45%'; $('#mvV', box).textContent = '60%'; };
    $('#setOk', box).onclick = () => {
      const pat = $('#setPat', box).value;
      const { pats, errors } = Segmenter.parsePatterns(pat);
      if (errors.length || !pats.length) { $('#patErr', box).textContent = errors.join(' / ') || '패턴이 하나 이상 있어야 합니다.'; return; }
      const prevO = R.old, prevN = R.neu;
      P.settings = { patterns: pat, threshold: +$('#setTh', box).value, moveThreshold: +$('#setMv', box).value, includeTextbox: $('#setTb', box).checked, ignoreDots: $('#setDot', box).checked, ignoreSpace: $('#setSp', box).checked };
      const lost = remapSide('o', prevO, segmentSide(P.oldDoc, 'o')) + remapSide('n', prevN, segmentSide(P.newDoc, 'n'));
      close(); reanalyze();
      toast(`설정을 적용해 다시 매칭했습니다.${lost ? ` 연결할 조항을 찾지 못한 사유 ${lost}건은 삭제됨` : ''}`);
    };
  });
}

// ------------------------------------------------------------ 이벤트
function pickFiles(accept, multiple, cb) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = accept; inp.multiple = multiple;
  inp.onchange = () => cb([...inp.files]);
  inp.click();
}

function bindDrop(el, cb) {
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('over'); cb([...e.dataTransfer.files]); });
}

function bindHeader() {
  const top = $('#top'), btn = $('#menuBtn');
  const setOpen = (open) => { top.classList.toggle('open', open); btn.setAttribute('aria-expanded', open); };
  btn.onclick = (e) => { e.stopPropagation(); setOpen(!top.classList.contains('open')); };
  document.addEventListener('click', (e) => { if (!e.target.closest('#actions')) setOpen(false); });
  $('#actions').addEventListener('click', (e) => { if (e.target.closest('button')) setOpen(false); });
  // 헤더 높이가 화면 폭에 따라 바뀌므로, 고정 도구줄·목차 위치를 그 높이에 맞춤
  const sync = () => document.documentElement.style.setProperty('--hdr', `${top.offsetHeight}px`);
  if (window.ResizeObserver) new ResizeObserver(sync).observe(top); else window.addEventListener('resize', sync);
  sync();
}

function bind() {
  bindHeader();
  ApplyTab.bind();
  $('.tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) { UI.tab = b.dataset.tab; render(); window.scrollTo(0, 0); } };
  $('#manualName').oninput = (e) => { P.meta.manual = e.target.value; dirty(); };
  $('#authorName').oninput = (e) => { P.meta.author = e.target.value; dirty(); };
  $('#btnSaveWork').onclick = saveWorkFile;
  $('#btnLoadWork').onclick = () => pickFiles('.json', false, (f) => f[0] && loadWorkFile(f[0]));
  $('#btnSettings').onclick = settingsDialog;
  $('#btnNew').onclick = () => {
    if (!confirm('새 작업을 시작하면 지금 작업 내용이 지워집니다. 먼저 [작업 파일 저장]으로 백업했는지 확인하세요. 계속할까요?')) return;
    P = newProject(); analyze(); dirty(); render();
  };

  for (const [id, side] of [['#slotOld', 'o'], ['#slotNew', 'n']]) {
    const el = $(id);
    el.onclick = () => pickFiles('.hwpx,.hwp', false, async (f) => { if (f[0]) loadDoc(side, f[0].name, await f[0].arrayBuffer()); });
    bindDrop(el, async (f) => { if (f[0]) loadDoc(side, f[0].name, await f[0].arrayBuffer()); });
  }
  $('#btnRematch').onclick = () => { reanalyze(); toast('다시 매칭했습니다. 수동 연결은 그대로 유지됩니다.'); };
  $('#viewToggle').onclick = (e) => { const b = e.target.closest('button'); if (b) { UI.view = b.dataset.view; renderCompare(); } };
  $('#typeChips').onclick = (e) => {
    const b = e.target.closest('[data-type]'); if (!b) return;
    const t = b.dataset.type;
    if (UI.types.has(t)) UI.types.delete(t); else UI.types.add(t);
    renderCompare();
  };
  let qt;
  $('#q').oninput = (e) => { clearTimeout(qt); qt = setTimeout(() => { UI.q = e.target.value; renderPairs(); }, 250); };
  $('#diffMode').onchange = (e) => { UI.diffMode = e.target.value; renderPairs(); };
  $('#exportAll').onchange = (e) => { UI.exportAll = e.target.checked; };
  $('#btnXlsx').onclick = exportCompareXlsx;
  $('#btnCopy').onclick = copyCompareTable;
  $('#toc').onclick = (e) => { const li = e.target.closest('[data-jump]'); if (li) jumpTo(li.dataset.jump); };
  $('#btnFinal').onclick = saveFinalDoc;
  $('#pairList').onclick = (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const card = b.closest('.card'), act = b.dataset.act;
    const p = R.pairs.find((x) => x.key === card.dataset.key);
    if (act === 'unlink') unlinkPair(p);
    else if (act === 'link') linkDialog(p);
    else if (act === 'edit') startEdit(card);
    else if (act === 'esave') saveEdit(card);
    else if (act === 'erevert') saveEdit(card, true);
    else if (act === 'ecancel') rerenderKeeping(card.dataset.key);
  };
  $('#pairList').oninput = (e) => {
    const f = e.target.dataset.f; if (!f) return;
    const key = e.target.closest('.card').dataset.key;
    const note = P.notes[key] || (P.notes[key] = { reason: '', ref: '' });
    note[f] = e.target.value;
    dirty();
  };

  // 제안 종합
  bindDrop($('#propDrop'), (f) => importProposalFiles(f.filter((x) => /\.json$/i.test(x.name))));
  $('#propDrop').onclick = () => pickFiles('.json', true, importProposalFiles);
  $('#pfCat').onchange = (e) => { UI.pf.cat = e.target.value; renderProposals(); };
  $('#pfRes').onchange = (e) => { UI.pf.res = e.target.value; renderProposals(); };
  let pq;
  $('#pfQ').oninput = (e) => { clearTimeout(pq); pq = setTimeout(() => { UI.pf.q = e.target.value; renderProposals(); }, 250); };
  $('#btnPropXlsx').onclick = exportProposalsXlsx;
  $('#btnPropZip').onclick = exportProposalImages;
  $('#btnCloud').hidden = !Cloud.enabled;
  $('#btnCloud').onclick = fetchCloudProposals;
  $('#propTable').onclick = (e) => {
    const th = e.target.closest('th[data-sort]');
    if (th) { const k = th.dataset.sort; UI.psort = { key: k, dir: UI.psort.key === k ? -UI.psort.dir : 1 }; renderProposals(); return; }
    const a = e.target.closest('[data-act]'); if (!a) return;
    e.preventDefault();
    const x = P.proposals.find((y) => y.uid === a.closest('tr').dataset.uid);
    if (a.dataset.act === 'detail') proposalDetail(x);
    if (a.dataset.act === 'del' && confirm(`${x.no} 제안을 목록에서 지울까요?`)) { P.proposals = P.proposals.filter((y) => y !== x); dirty(); renderProposals(); }
  };
  const onReview = (e) => {
    const f = e.target.dataset.f; if (!f) return;
    const tr = e.target.closest('tr'), x = P.proposals.find((y) => y.uid === tr.dataset.uid);
    if (f === 'result') { x.review.result = e.target.value; tr.className = x.review.result ? 'r-' + x.review.result : ''; renderPropStatsOnly(); }
    if (f === 'rreason') x.review.reason = e.target.value;
    dirty();
  };
  $('#propTable').addEventListener('change', onReview);
  $('#propTable').addEventListener('input', onReview);

  // 종합 평가
  $('#btnReportXlsx').onclick = exportReportXlsx;
  $('#btnPrint').onclick = () => window.print();
  $('#reportBody').onclick = (e) => {
    const a = e.target.closest('[data-goto]'); if (!a) return;
    e.preventDefault();
    UI.tab = 'compare'; UI.view = 'all'; UI.types = new Set(CHANGE_TYPES); render();
    jumpTo(a.dataset.goto);
  };
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
}

function renderPropStatsOnly() {
  const s = reviewStats();
  $('#propStats').innerHTML = `접수 <b>${s.total}</b>건 · 반영 <b>${s.반영}</b> · 부분반영 <b>${s.부분반영}</b> · 미반영 <b>${s.미반영}</b> · 미심의 <b>${s.미심의}</b>`;
}

async function init() {
  bind();
  try {
    const saved = await Store.get('project');
    if (saved && saved.format === 'kyobeom-project') { P = Object.assign(newProject(), saved); P.settings = { ...newProject().settings, ...saved.settings }; }
  } catch (e) { toast('브라우저 저장소를 열 수 없습니다. 작업 파일 저장을 이용해 주세요.', 'error'); }
  analyze();
  render();
}

// 테스트·점검용
window.App = { get P() { return P; }, get R() { return R; }, ApplyTab, llmPrompt, loadDoc, importProposalJson, analyze, render, exportCompareXlsx, compareRows, reportData, Xlsx, Zip };

init();
