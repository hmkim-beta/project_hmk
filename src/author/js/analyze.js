// 조항 분할(Segmenter)과 신·구 조항 매칭(Matcher)
'use strict';

const DEFAULT_PATTERNS = [
  '# 한 줄에 하나씩: 레벨|이름|정규식',
  '# 레벨 1=장급, 2=절급, 3=조항급, 4=하위 항목(필요할 때만 추가)',
  '# 줄 맨 앞이 정규식과 맞으면 새 조항의 시작으로 봅니다.',
  '1|장|^제\\s*\\d+\\s*장(\\s|$)',
  '1|부칙|^부\\s*칙(\\s|$|[<〈(])',
  '1|별표·별지 목차|^별\\s*(표|지)\\s*(및\\s*별\\s*지\\s*)?목\\s*차',
  '2|절|^제\\s*\\d+\\s*절(\\s|$)',
  '2|별표·별지|^[\\[［(<〈【]?\\s*별\\s*(표|지)\\s*(제\\s*)?\\d+(\\s*호)?(\\s*서식)?\\s*[\\]］)>〉】]?',
  '3|조|^제\\s*\\d+\\s*조(\\s*의\\s*\\d+)?\\s*([(（]|삭\\s*제|$)',
  '3|항(N-N.)|^\\d+\\s*-\\s*\\d+\\s*\\.(?!\\d)',
].join('\n');

const Segmenter = (() => {
  const CAPTION = /^[<〈《\[(（]?\s*(표|그림)\s*\d+(\s*[-–.]\s*\d+)*/;
  const TOC_TAIL = /(\t|\s{3,}|[.·‧∙ㆍ․・⋅･…‥-]{3,}|…+|‥+)\s*\d+\s*$/;
  const DOTS = /[·ㆍ․‧∙•・⋅･]/g;

  // 앞쪽 목차 범위(줄 번호)를 찾음: 쪽 번호로 끝나는 줄들과, 그 바로 앞의 장·절 제목줄
  function tocRange(blocks, pats) {
    const lines = [];
    for (const b of blocks) if (b.type === 'p') for (const raw of b.text.split('\n')) if (norm(raw)) lines.push(raw);
    let start = -1, end = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = norm(lines[i]), pat = pats.find((p) => p.re.test(line));
      if (TOC_TAIL.test(lines[i].replace(/\s+$/, ''))) { if (start < 0) start = i; end = i; }
      else if (pat && pat.level >= 3) break; // 본문 조항이 나오면 목차는 끝
    }
    if (start < 0) return [-1, -1];
    while (start > 0) {
      const line = norm(lines[start - 1]), pat = pats.find((p) => p.re.test(line));
      if ((pat && pat.level <= 2) || /^목\s*차$/.test(line)) start--; else break;
    }
    return [start, end];
  }

  function parsePatterns(text) {
    const pats = [], errors = [];
    for (const raw of String(text || '').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const m = line.match(/^(\d)\s*\|\s*([^|]*?)\s*\|\s*(.+)$/);
      if (!m) { errors.push(`형식 오류: ${line}`); continue; }
      try { pats.push({ level: +m[1], name: m[2], re: new RegExp(m[3]) }); } catch (e) { errors.push(`정규식 오류: ${line}`); }
    }
    return { pats, errors };
  }

  const norm = (s) => s.replace(/[\t 　]/g, ' ').replace(/\s+/g, ' ').trim();

  function splitHeading(line, m) {
    const numRaw = m[0].replace(/[\s(（]+$/, '');
    const num = numRaw.replace(/\s+/g, '').replace(/[.。]$/, '');
    let rest = line.slice(line.indexOf(numRaw) + numRaw.length).trim();
    let title = '', inline = '';
    const p = rest.match(/^[(（]([^)）]*)[)）]\s*(.*)$/);
    if (p) { title = p[1].trim(); inline = p[2]; }
    else if (rest.length <= 50 && !/다\.\s*$/.test(rest)) title = rest;
    else inline = rest;
    return { num, title, inline };
  }

  // blocks → clauses
  function segment(blocks, patternsText, side, opts = {}) {
    const { pats } = parsePatterns(patternsText);
    const clauses = [];
    const stack = []; // 상위 경로
    let cur = null, seenBody = false, lastLineCaption = '';
    // src: 각 줄이 어느 블록(b)의 몇 번째 줄(k)에서 왔는지 — HWPX 최종본을 원본에 덮어쓸 때 사용
    const open = (level, kind, num, title, firstLine, src) => {
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      cur = { id: `${side}${clauses.length}`, idx: clauses.length, level, kind, num, title, lines: [firstLine], src: [src], tables: [], figures: [], path: stack.map((s) => ({ ...s })) };
      clauses.push(cur);
      if (level < 3) stack.push({ id: cur.id, level, num, title });
    };
    const ensure = () => { if (!cur) open(0, '머리말', '', '(머리말)', '', null); };
    const push = (line, src) => { cur.lines.push(line); cur.src.push(src); };

    const [tocStart, tocEnd] = tocRange(blocks, pats);
    let k = -1;
    blocks.forEach((b, bi) => {
      if (b.type === 'p') {
        b.text.split('\n').forEach((raw, pk) => {
          const line = norm(raw);
          if (!line) return;
          k++;
          if (k >= tocStart && k <= tocEnd) return;
          if (!seenBody && /^목\s*차$/.test(line)) return;
          const pat = pats.find((p) => p.re.test(line));
          const toc = TOC_TAIL.test(raw.replace(/\s+$/, ''));
          if (toc && (pat || !seenBody)) return;
          if (pat) {
            const h = splitHeading(line, line.match(pat.re));
            seenBody = true;
            open(pat.level, pat.name, h.num, h.title, line, { b: bi, k: pk });
          } else {
            ensure();
            push(line, { b: bi, k: pk });
          }
          lastLineCaption = CAPTION.test(line) ? line : '';
        });
      } else if (b.type === 'table') {
        ensure();
        const cellCount = b.rows.reduce((s, r) => s + r.length, 0);
        if (cellCount <= 1 && !b.caption) {
          // 한 칸짜리 표(제목 상자 등)는 일반 문단처럼 취급
          (b.rows[0]?.[0] || '').split('\n').forEach((l, ck) => { if (norm(l)) push(norm(l), { b: bi, t: 'cell', k: ck }); });
          return;
        }
        const caption = norm(b.caption || '') || lastLineCaption;
        const body = DocParser.tableText(b);
        cur.tables.push({ caption, text: body });
        push(`[표] ${caption}`.trim() + '\n' + body, { b: bi, t: 'table', ownCap: !!norm(b.caption || '') });
        lastLineCaption = '';
      } else if (b.type === 'figure') {
        ensure();
        const caption = norm(b.caption || '') || lastLineCaption;
        cur.figures.push({ caption });
        push(`[그림] ${caption || '(캡션 없음)'}` + (opts.includeTextbox && b.label ? `\n[그림 속 글자] ${b.label}` : ''), { b: bi, t: 'fig', ownCap: !!norm(b.caption || '') });
        lastLineCaption = '';
      }
    });
    for (const c of clauses) finalize(c, opts);
    // 본문도 하위 조항도 없는 장·절 제목(목차 줄 등)은 버림
    const kept = clauses.filter((c, i) => {
      if (c.level === 0) return !!c.text.trim();
      if (c.level > 2 || c.lines.length > 1) return true;
      const next = clauses[i + 1];
      return !!next && next.level > c.level;
    });
    const keptIds = new Set(kept.map((c) => c.id));
    for (const c of kept) c.path = c.path.filter((p) => keptIds.has(p.id));
    return kept;
  }

  function finalize(c, opts = {}) {
    if (c.level === 0) { c.src = c.src.filter((_, i) => c.lines[i]); c.lines = c.lines.filter((l) => l); }
    c.text = c.lines.join('\n');
    const first = c.lines[0] || '';
    let headRest = first;
    if (c.num) {
      const compact = first.replace(/\s+/g, '');
      // 번호 부분을 뺀 첫 줄 (번호가 바뀌어도 같은 내용으로 보이도록)
      let k = 0, i = 0;
      while (i < first.length && k < c.num.length) { if (!/\s/.test(first[i])) k++; i++; }
      headRest = compact.startsWith(c.num) ? first.slice(i).replace(/^[\s.]+/, '') : first;
    }
    // cmpRaw: 실제 글자 그대로, cmp: 설정에 따라 표기 차이를 무시한 비교용 글자
    c.cmpRaw = [headRest, ...c.lines.slice(1)].join('\n').replace(/\s+/g, ' ').trim();
    c.cmp = c.cmpRaw;
    if (opts.ignoreDots) c.cmp = c.cmp.replace(DOTS, '·');
    if (opts.ignoreSpace) c.cmp = c.cmp.replace(/\s+/g, '');
    const sp = c.title ? headRest.indexOf(c.title) : -1;
    c.cmpBody = (c.title && sp >= 0 ? headRest.slice(sp + c.title.length).replace(/^[)）\s]+/, '') : headRest) + '\n' + c.lines.slice(1).join('\n');
    const sep = /조(의\d+)?$/.test(c.num) ? '' : /^\d+(-\d+)+$/.test(c.num) ? '. ' : ' ';
    c.label = c.num ? `${c.num}${c.title ? (sep ? sep + c.title : `(${c.title})`) : ''}` : (c.title || '(머리말)');
  }

  return { segment, parsePatterns };
})();

const Matcher = (() => {
  function grams(s) {
    s = s.replace(/\s+/g, '');
    const set = new Set();
    if (s.length === 1) set.add(s);
    for (let i = 0; i < s.length - 1; i++) set.add(s.substr(i, 2));
    return set;
  }
  function dice(a, b) {
    if (!a.size && !b.size) return 1;
    if (!a.size || !b.size) return 0;
    const [x, y] = a.size < b.size ? [a, b] : [b, a];
    let c = 0;
    for (const g of x) if (y.has(g)) c++;
    return (2 * c) / (a.size + b.size);
  }

  function simMatrix(O, N) {
    const n = O.length, m = N.length;
    const S = new Float32Array(n * m);
    const ob = O.map((c) => grams(c.cmpBody)), nb = N.map((c) => grams(c.cmpBody));
    const ot = O.map((c) => grams(c.title || '')), nt = N.map((c) => grams(c.title || ''));
    const index = new Map();
    ob.forEach((set, i) => { for (const g of set) { let l = index.get(g); if (!l) index.set(g, (l = [])); l.push(i); } });
    const counts = new Int32Array(n);
    for (let j = 0; j < m; j++) {
      const touched = [];
      for (const g of nb[j]) {
        const l = index.get(g);
        if (l) for (const i of l) { if (!counts[i]) touched.push(i); counts[i]++; }
      }
      const body = new Float32Array(n);
      for (const i of touched) { body[i] = (2 * counts[i]) / (ob[i].size + nb[j].size); counts[i] = 0; }
      for (let i = 0; i < n; i++) {
        const o = O[i], c = N[j];
        if (o.level !== c.level) continue;
        let s;
        if (o.cmp === c.cmp) s = 1;
        else {
          const bothEmpty = !ob[i].size && !nb[j].size;
          const t = o.title && c.title ? dice(ot[i], nt[j]) : null;
          if (bothEmpty) s = t === null ? 0 : t;
          else if (t !== null) s = 0.3 * t + 0.7 * body[i];
          else s = body[i];
        }
        S[i * m + j] = s;
      }
    }
    return S;
  }

  // 문서 순서를 지키는 가중 정렬 (LCS 계열 DP)
  function align(oi, ni, S, m, T) {
    const a = oi.length, b = ni.length, W = b + 1;
    const dp = new Float32Array((a + 1) * W), dir = new Uint8Array((a + 1) * W);
    for (let i = 1; i <= a; i++) {
      const row = oi[i - 1] * m;
      for (let j = 1; j <= b; j++) {
        let best = dp[(i - 1) * W + j], d = 1;
        if (dp[i * W + j - 1] > best) { best = dp[i * W + j - 1]; d = 2; }
        const s = S[row + ni[j - 1]];
        if (s >= T && dp[(i - 1) * W + j - 1] + s > best) { best = dp[(i - 1) * W + j - 1] + s; d = 3; }
        dp[i * W + j] = best; dir[i * W + j] = d;
      }
    }
    const pairs = [];
    for (let i = a, j = b; i > 0 && j > 0;) {
      const d = dir[i * W + j];
      if (d === 3) { pairs.push([oi[i - 1], ni[j - 1]]); i--; j--; }
      else if (d === 1) i--; else j--;
    }
    return pairs.reverse();
  }

  // opts: { threshold, moveThreshold, links:[{oldId,newId}], unlinks:[{oldId,newId}] }
  function match(O, N, opts) {
    const m = N.length;
    const S = simMatrix(O, N);
    const oPos = new Map(O.map((c, i) => [c.id, i])), nPos = new Map(N.map((c, i) => [c.id, i]));
    for (const u of opts.unlinks || []) {
      const i = oPos.get(u.oldId), j = nPos.get(u.newId);
      if (i !== undefined && j !== undefined) S[i * m + j] = 0;
    }
    const usedO = new Set(), usedN = new Set(), raw = [];
    for (const l of opts.links || []) {
      const i = oPos.get(l.oldId), j = nPos.get(l.newId);
      if (i === undefined || j === undefined || usedO.has(i) || usedN.has(j)) continue;
      usedO.add(i); usedN.add(j); raw.push({ i, j, manual: true });
    }
    const oi = O.map((_, i) => i).filter((i) => !usedO.has(i));
    const ni = N.map((_, j) => j).filter((j) => !usedN.has(j));
    for (const [i, j] of align(oi, ni, S, m, opts.threshold)) { usedO.add(i); usedN.add(j); raw.push({ i, j }); }
    // 순서를 벗어난 조항: 남은 것끼리 유사도가 높으면 '이동'
    const cand = [];
    for (let i = 0; i < O.length; i++) {
      if (usedO.has(i)) continue;
      for (let j = 0; j < m; j++) if (!usedN.has(j) && S[i * m + j] >= opts.moveThreshold) cand.push([S[i * m + j], i, j]);
    }
    cand.sort((x, y) => y[0] - x[0]);
    for (const [, i, j] of cand) {
      if (usedO.has(i) || usedN.has(j)) continue;
      usedO.add(i); usedN.add(j); raw.push({ i, j, outOfOrder: true });
    }

    const o2n = new Map(raw.map((r) => [O[r.i].id, N[r.j].id]));
    const anc = (c, lv) => { const p = c.path.filter((x) => x.level === lv); return p.length ? p[p.length - 1].id : null; };
    const pairs = raw.map((r) => {
      const o = O[r.i], n = N[r.j];
      let moved = !!r.outOfOrder;
      if (o.level >= 2) {
        const oc = anc(o, 1), nc = anc(n, 1);
        if ((oc || nc) && (oc ? o2n.get(oc) : null) !== nc) moved = true;
      }
      if (o.level >= 3) {
        const os = anc(o, 2), ns = anc(n, 2);
        if (os && ns && o2n.get(os) !== ns) moved = true;
      }
      const same = o.cmp === n.cmp;
      return {
        oldId: o.id, newId: n.id, sim: S[r.i * m + r.j], manual: !!r.manual,
        type: moved ? '이동' : same ? '동일' : '수정',
        textChanged: !same, minor: same && o.cmpRaw !== n.cmpRaw, numChanged: o.num !== n.num, oi: r.i, ni: r.j,
      };
    });
    for (let i = 0; i < O.length; i++) if (!usedO.has(i)) pairs.push({ oldId: O[i].id, newId: null, sim: 0, type: '삭제', textChanged: true, oi: i, ni: -1 });
    for (let j = 0; j < m; j++) if (!usedN.has(j)) pairs.push({ oldId: null, newId: N[j].id, sim: 0, type: '추가', textChanged: true, oi: -1, ni: j });

    // 표시 순서: 신규 문서 순서, 삭제 조항은 직전 기존 조항의 짝 뒤에
    const oldToNi = new Map(pairs.filter((p) => p.oi >= 0 && p.ni >= 0).map((p) => [p.oi, p.ni]));
    for (const p of pairs) {
      if (p.ni >= 0) p.order = p.ni * 2 + 1;
      else {
        let k = p.oi - 1;
        while (k >= 0 && !oldToNi.has(k)) k--;
        p.order = (k >= 0 ? oldToNi.get(k) * 2 + 1 : 0) + 0.5 + p.oi * 1e-6;
      }
      p.key = `${p.oldId || ''}|${p.newId || ''}`;
    }
    pairs.sort((a, b) => a.order - b.order);
    return { pairs, S, m };
  }

  return { match };
})();
