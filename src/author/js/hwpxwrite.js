// 최종본을 HWPX로 저장
// - 원본이 HWPX면: 원본 파일을 그대로 두고, 바뀐 문단·표 칸·캡션의 글자만 고친다 (서식·그림·쪽 설정 유지).
//   글자는 기존 run 안에서 바꾸므로 굵은 제목 등 글자 모양이 유지된다.
// - 원본이 HWP면: 한글에서 만든 빈 HWPX 틀(HWPX_TEMPLATE)에 글자만 담는다 (서식 없음).
'use strict';

const HwpxWriter = (() => {
  const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>';
  const isWs = (ch) => /\s/.test(ch);

  // 문단의 글자 조각들 (파서의 xSplit과 같은 순서·규칙)
  function items(p) {
    const out = [];
    const visit = (node) => {
      for (const c of node.childNodes) {
        if (c.nodeType !== 1) continue;
        const ln = c.localName;
        if (ln === 't') {
          let any = false;
          for (const t of c.childNodes) {
            if (t.nodeType === 3) { out.push({ k: 'text', node: t, t: t.nodeValue, holder: c }); any = true; }
            else if (t.nodeType === 1) {
              const ch = t.localName === 'tab' ? '\t' : t.localName === 'lineBreak' ? '\n' : t.localName === 'hyphen' ? '-' : /Space$/.test(t.localName) ? ' ' : '';
              if (ch) out.push({ k: 'el', node: t, t: ch });
            }
          }
          if (!any) out.push({ k: 'empty', holder: c, t: '' });
        } else if (ln === 'tbl' || DocParser.SHAPES.has(ln)) continue;
        else if (ln === 'switch') {
          const pick = [...c.children].find((k) => k.localName === 'default') || [...c.children].find((k) => k.localName === 'case');
          if (pick) visit(pick);
        } else if (!DocParser.SKIP.has(ln)) visit(c);
      }
    };
    visit(p);
    return out;
  }
  const rawOf = (p) => items(p).map((i) => i.t).join('');

  const make = (doc, ref, name) => doc.createElementNS(ref.namespaceURI, (ref.prefix ? ref.prefix + ':' : '') + name);
  const dropLineSeg = (p) => { for (const c of [...p.children]) if (c.localName === 'linesegarray') c.remove(); };

  // 문단 글자를 newRaw로 바꿈 (바뀐 글자만 고치고 run 구조는 유지)
  function setText(p, newRaw) {
    const its = items(p);
    const oldRaw = its.map((i) => i.t).join('');
    if (oldRaw === newRaw) return false;
    const chars = [];
    its.forEach((it) => { for (let k = 0; k < it.t.length; k++) chars.push({ it, ch: it.t[k], keep: true, before: '', after: '' }); });
    const ops = TextDiff.diff(oldRaw, newRaw, 'char');
    let pos = 0;
    const gaps = [];
    for (const [op, t] of ops) {
      if (op === 0) pos += t.length;
      else if (op === -1) { for (let k = 0; k < t.length && pos + k < chars.length; k++) chars[pos + k].keep = false; pos += t.length; }
      else { const s = pos >= chars.length ? t.replace(/\n$/, '') : t; if (s) gaps.push([Math.min(pos, chars.length), s.replace(/\n/g, ' ')]); } // 문단 안 줄바꿈은 새로 만들지 않음
    }
    const textAt = (i) => chars[i] && chars[i].it.k === 'text';
    let orphan = '';
    for (const [g, t] of gaps) {
      if (g > 0 && textAt(g - 1)) chars[g - 1].after += t;
      else if (textAt(g)) chars[g].before = t + chars[g].before;
      else {
        let j = g - 1; while (j >= 0 && !textAt(j)) j--;
        if (j >= 0) { chars[j].after += t; continue; }
        j = g; while (j < chars.length && !textAt(j)) j++;
        if (j < chars.length) chars[j].before = t + chars[j].before; else orphan += t;
      }
    }
    for (const it of its) {
      if (it.k === 'el') { if (chars.some((c) => c.it === it && !c.keep)) it.node.remove(); continue; }
      if (it.k !== 'text') continue;
      it.node.nodeValue = chars.filter((c) => c.it === it).map((c) => c.before + (c.keep ? c.ch : '') + c.after).join('');
    }
    if (orphan) {
      const empty = its.find((i) => i.k === 'empty');
      if (empty) empty.holder.appendChild(p.ownerDocument.createTextNode(orphan));
      else {
        let run = [...p.children].reverse().find((c) => c.localName === 'run');
        if (!run) { run = make(p.ownerDocument, p, 'run'); run.setAttribute('charPrIDRef', '0'); p.insertBefore(run, p.firstChild); }
        const t = make(p.ownerDocument, p, 't'); t.textContent = orphan; run.appendChild(t);
      }
    }
    dropLineSeg(p);
    return true;
  }

  // 정규화된 줄(공백 하나로 줄임)의 변경을 원래 공백·탭을 살려 원문에 옮김
  function rawApply(raw, newNorm) {
    const rs = [], re = [], ns = [];
    let i = 0, end = raw.length;
    while (i < end && isWs(raw[i])) i++;
    while (end > i && isWs(raw[end - 1])) end--;
    while (i < end) {
      if (isWs(raw[i])) { let j = i; while (j < end && isWs(raw[j])) j++; ns.push(' '); rs.push(i); re.push(j); i = j; }
      else { ns.push(raw[i]); rs.push(i); re.push(i + 1); i++; }
    }
    const lead = raw.slice(0, rs.length ? rs[0] : raw.length), trail = raw.slice(rs.length ? re[re.length - 1] : raw.length);
    let out = lead, p = 0;
    for (const [op, t] of TextDiff.diff(ns.join(''), newNorm, 'char')) {
      // TextDiff는 끝에 줄바꿈 하나를 더 붙여 돌려주므로 원문 길이를 넘는 위치는 건너뜀
      if (op === 0) { for (let k = 0; k < t.length && p + k < rs.length; k++) out += raw.slice(rs[p + k], re[p + k]); p += t.length; }
      else if (op === -1) p += t.length;
      else out += t;
    }
    return out + trail;
  }

  const hasStructure = (p) => [...p.getElementsByTagNameNS('*', '*')].some((e) => ['secPr', 'ctrl', 'tbl', 'pic', 'container', 'rect', 'ellipse', 'line', 'equation', 'ole'].includes(e.localName));

  function newParagraph(tpl, text) {
    const doc = tpl.ownerDocument;
    const p = tpl.cloneNode(false);
    p.setAttribute('pageBreak', '0'); p.setAttribute('columnBreak', '0');
    // 본문 글자 모양: 글자가 있는 마지막 run의 charPr
    const runs = [...tpl.children].filter((c) => c.localName === 'run' && [...c.children].some((t) => t.localName === 't' && t.textContent.trim()));
    const run = make(doc, tpl, 'run');
    run.setAttribute('charPrIDRef', runs.length ? runs[runs.length - 1].getAttribute('charPrIDRef') : '0');
    const t = make(doc, tpl, 't'); t.textContent = text;
    run.appendChild(t); p.appendChild(run);
    return p;
  }

  // 줄 단위 맞춤 (LCS) → [['=', i, j] | ['-', i] | ['+', j] | ['~', i, j]]
  function alignLines(a, b) {
    const n = a.length, m = b.length, W = m + 1, L = new Uint32Array((n + 1) * W);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i * W + j] = a[i] === b[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
    const raw = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { raw.push(['=', i++, j++]); }
      else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) raw.push(['-', i++]);
      else raw.push(['+', j++]);
    }
    while (i < n) raw.push(['-', i++]);
    while (j < m) raw.push(['+', j++]);
    // 붙어 있는 삭제·추가를 '바뀜'으로 짝지음
    const out = [];
    for (let k = 0; k < raw.length;) {
      if (raw[k][0] === '=') { out.push(raw[k++]); continue; }
      const dels = [], ins = [];
      while (k < raw.length && raw[k][0] !== '=') { (raw[k][0] === '-' ? dels : ins).push(raw[k]); k++; }
      const n2 = Math.min(dels.length, ins.length);
      for (let x = 0; x < n2; x++) out.push(['~', dels[x][1], ins[x][1]]);
      for (const d of dels.slice(n2)) out.push(d);
      for (const s of ins.slice(n2)) out.push(s);
    }
    return out;
  }

  function patchClause(c, newText, refs, W) {
    // 화면에 보이는 줄 ↔ 원본 위치
    const old = [];
    c.lines.forEach((line, i) => {
      const s = c.src[i];
      line.split('\n').forEach((part, r) => {
        if (!s) old.push({ text: part, s: null });
        else if (s.t === 'table') old.push({ text: part, s: r === 0 ? { ...s, t: 'tcap' } : { ...s, t: 'trow', r: r - 1 } });
        else if (s.t === 'fig') old.push({ text: part, s: r === 0 ? s : { ...s, t: 'figlabel' } });
        else old.push({ text: part, s });
      });
    });
    const neu = newText.split('\n');
    const warn = (m) => W.warnings.push(`${c.label}: ${m}`);
    const paraState = (p) => { let st = W.paras.get(p); if (!st) { st = { parts: rawOf(p).split('\n') }; W.paras.set(p, st); } return st; };
    const hostOf = (s) => (s.k !== undefined && !s.t ? refs[s.b].el : refs[s.b].host || refs[s.b].el);
    const bodyTpl = old.find((x, i) => i > 0 && x.s && x.s.k !== undefined && !x.s.t)?.s;
    const headEl = old[0]?.s && !old[0].s.t ? refs[old[0].s.b].el : null;
    const plainPs = new Set(old.filter((x) => x.s && !x.s.t).map((x) => refs[x.s.b].el));
    // 바로 앞 본문 문단을 본뜸 (제목 문단·표는 피함)
    const tplFor = (anchor) => (plainPs.has(anchor) && anchor !== headEl ? anchor : bodyTpl ? refs[bodyTpl.b].el : anchor);
    // 공백으로 들여쓴 문서(예: "  5. …")는 새 줄도 같은 들여쓰기로
    const leadOf = (p) => (plainPs.has(p) && p !== headEl ? (rawOf(p).match(/^[ \t　]*/) || [''])[0] : '');
    const cellParas = (tc) => DocParser.subParas(tc);
    const caption = (el) => { const cap = DocParser.kids(el, 'caption')[0]; return cap ? DocParser.subParas(cap) : []; };
    const setParas = (paras, newVal) => {
      if (!paras.length) return false;
      if (paras.length === 1) return setText(paras[0], rawApply(rawOf(paras[0]), newVal));
      setText(paras[0], newVal); paras.slice(1).forEach((p) => setText(p, ''));
      return true;
    };

    let anchor = null; // 마지막으로 지나온 원본 문단 (새 줄을 그 뒤에 넣음)
    const after = new Map(); // anchor 문단 → 그 뒤에 마지막으로 넣은 문단
    for (const op of alignLines(old.map((x) => x.text), neu)) {
      if (op[0] === '=') { const s = old[op[1]].s; if (s) anchor = hostOf(s); continue; }
      if (op[0] === '+') {
        const text = neu[op[1]];
        const base = anchor || (old[0]?.s && hostOf(old[0].s));
        if (!base) { warn('새 줄을 넣을 위치를 찾지 못했습니다.'); continue; }
        const tpl = tplFor(base);
        const p = newParagraph(tpl, leadOf(tpl) + text.replace(/^\s+/, ''));
        if (!anchor) base.parentNode.insertBefore(p, base);
        else { const prev = after.get(anchor) || anchor; prev.parentNode.insertBefore(p, prev.nextSibling); after.set(anchor, p); }
        W.dirty.add(base.ownerDocument);
        continue;
      }
      const o = old[op[1]], s = o.s, nt = op[0] === '~' ? neu[op[2]] : null;
      if (!s) { warn('원본 위치를 알 수 없는 줄은 바꾸지 못했습니다.'); continue; }
      anchor = hostOf(s);
      const ref = refs[s.b];
      W.dirty.add(ref.el.ownerDocument);
      if (!s.t) { const st = paraState(ref.el); st.parts[s.k] = nt === null ? null : rawApply(st.parts[s.k] ?? '', nt); }
      else if (s.t === 'cell') {
        const tc = ref.el.getElementsByTagNameNS('*', 'tc')[0];
        const paras = tc ? cellParas(tc) : [];
        if (paras[s.k]) setText(paras[s.k], nt === null ? '' : rawApply(rawOf(paras[s.k]), nt)); else warn('표 안 글자를 찾지 못했습니다.');
      } else if (s.t === 'tcap' || s.t === 'fig') {
        const kind = s.t === 'tcap' ? '표' : '그림';
        if (nt === null) { warn(`${kind} 삭제는 한글에서 직접 해 주세요.`); continue; }
        if (!s.ownCap) { warn(`${kind} 캡션이 본문 줄이라 [${kind}] 줄 대신 본문의 캡션 줄을 고쳐 주세요.`); continue; }
        if (!setParas(caption(ref.el), nt.replace(new RegExp(`^\\[${kind}\\]\\s*`), ''))) warn(`${kind} 캡션을 찾지 못했습니다.`);
      } else if (s.t === 'trow') {
        if (nt === null) { warn('표의 행 삭제는 한글에서 직접 해 주세요.'); continue; }
        const oc = o.text.split(' | '), nc = nt.split(' | ');
        const tr = DocParser.kids(ref.el, 'tr')[s.r];
        const tcs = tr ? DocParser.kids(tr, 'tc') : [];
        if (oc.length !== nc.length || tcs.length !== oc.length) { warn(`표 ${s.r + 1}행은 칸 수가 달라져 바꾸지 못했습니다 (칸 구분: " | ").`); continue; }
        oc.forEach((v, ci) => {
          if (v === nc[ci]) return;
          const paras = cellParas(tcs[ci]);
          const own = paras.map(rawOf).join(' ').replace(/\s+/g, ' ').trim();
          if (own !== v.replace(/\s+/g, ' ').trim()) { warn(`표 ${s.r + 1}행 ${ci + 1}칸은 안에 표가 있어 바꾸지 못했습니다.`); return; }
          setParas(paras, nc[ci]);
        });
      } else if (s.t === 'figlabel') warn('그림 속 글자는 바꾸지 못했습니다.');
    }
    // 표 행 추가는 위에서 새 문단으로 들어가므로 따로 알림
    if (neu.length > old.length && old.some((x) => x.s?.t === 'trow')) {
      const rowsAdded = alignLines(old.map((x) => x.text), neu).filter((x) => x[0] === '+' && neu[x[1]].includes(' | ')).length;
      if (rowsAdded) warn(`표에 추가한 ${rowsAdded}줄은 표 밖의 문단으로 들어갔습니다. 한글에서 표 행으로 옮겨 주세요.`);
    }
  }

  function flushParas(W) {
    for (const [p, st] of W.paras) {
      const kept = st.parts.filter((x) => x !== null);
      if (!kept.length && !hasStructure(p)) { p.remove(); continue; }
      setText(p, kept.join('\n'));
    }
  }

  const serialize = (doc) => { const s = new XMLSerializer().serializeToString(doc); return s.startsWith('<?xml') ? s : XML_DECL + s; };

  async function zipBack(zip, docs, dirty, extra = {}) {
    const files = [];
    const names = ['mimetype', ...zip.names.filter((n) => n !== 'mimetype')].filter((n) => zip.has(n));
    for (const name of names) {
      const d = docs.find((x) => x.name === name);
      const data = extra[name] !== undefined ? extra[name] : d && dirty.has(d.doc) ? serialize(d.doc) : await zip.read(name);
      files.push({ name, data, store: name === 'mimetype' });
    }
    return Zip.buildCompressed(files);
  }

  // 원본 HWPX에 최종본 반영. edits: Map(조항 id → { orig: 화면의 원래 글, text: 최종 글 })
  async function patch(srcBuf, edits, patterns, settings) {
    const parsed = await DocParser.parseHwpx(srcBuf, true);
    const clauses = Segmenter.segment(parsed.blocks, patterns, 'n', settings);
    const W = { warnings: [], dirty: new Set(), paras: new Map(), changed: 0 };
    const byId = new Map(clauses.map((c) => [c.id, c]));
    for (const [id, e] of edits) {
      const c = byId.get(id);
      if (!c || c.text !== e.orig) { W.warnings.push(`${c ? c.label : id}: 원본 파일의 내용이 화면과 달라 반영하지 못했습니다. 같은 파일을 다시 올려 주세요.`); continue; }
      if (e.text === c.text) continue;
      patchClause(c, e.text, parsed.refs, W);
      W.changed++;
    }
    flushParas(W);
    const bytes = await zipBack(parsed.zip, parsed.docs, W.dirty);
    return { bytes, warnings: W.warnings, changed: W.changed };
  }

  // HWP 원본용: 빈 HWPX 틀에 글자만 담음 (줄마다 문단 하나)
  async function plain(lines) {
    const bin = atob(HWPX_TEMPLATE), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const zip = Zip.open(u8.buffer);
    const name = 'Contents/section0.xml';
    const doc = new DOMParser().parseFromString(await zip.text(name), 'application/xml');
    const root = doc.documentElement;
    const first = [...root.children].find((e) => e.localName === 'p');
    [...root.children].filter((e) => e !== first).forEach((e) => e.remove());
    dropLineSeg(first);
    const run = [...first.children].find((c) => c.localName === 'run');
    for (const t of [...run.children]) if (t.localName === 't') t.remove();
    const t0 = make(doc, first, 't'); t0.textContent = lines[0] || ''; run.appendChild(t0);
    for (const line of lines.slice(1)) {
      const p = first.cloneNode(false); p.setAttribute('id', '0');
      const r = make(doc, first, 'run'); r.setAttribute('charPrIDRef', '0');
      const t = make(doc, first, 't'); t.textContent = line;
      r.appendChild(t); p.appendChild(r); root.appendChild(p);
    }
    return zipBack(zip, [{ name, doc }], new Set([doc]), { 'Preview/PrvText.txt': lines.slice(0, 40).join('\r\n') });
  }

  return { patch, plain };
})();
