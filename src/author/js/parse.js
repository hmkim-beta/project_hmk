// HWP(5.0 바이너리) / HWPX 문서를 공통 블록 목록으로 변환
// 블록: { type:'p', text } | { type:'table', caption, rows:[[셀]] } | { type:'figure', caption, label }
'use strict';

const DocParser = (() => {
  // ------------------------------------------------------------ HWP: OLE 복합 문서
  function readCfb(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0xE011CFD0) throw new Error('HWP 파일 형식이 아닙니다.');
    const ss = 1 << dv.getUint16(0x1E, true), mss = 1 << dv.getUint16(0x20, true);
    const nfat = dv.getUint32(0x2C, true), dir1 = dv.getUint32(0x30, true), cutoff = dv.getUint32(0x38, true);
    const minifat1 = dv.getUint32(0x3C, true), nminifat = dv.getUint32(0x40, true);
    let difatSec = dv.getUint32(0x44, true), ndifat = dv.getUint32(0x48, true);
    const secOff = (i) => (i + 1) * ss;
    const difat = [];
    for (let i = 0; i < 109; i++) difat.push(dv.getUint32(0x4C + i * 4, true));
    while (ndifat-- > 0 && difatSec < 0xFFFFFFFA) {
      const o = secOff(difatSec), n = ss / 4;
      for (let i = 0; i < n - 1; i++) difat.push(dv.getUint32(o + i * 4, true));
      difatSec = dv.getUint32(o + (n - 1) * 4, true);
    }
    const fat = [];
    for (let k = 0; k < nfat; k++) {
      const o = secOff(difat[k]);
      for (let i = 0; i < ss / 4; i++) fat.push(dv.getUint32(o + i * 4, true));
    }
    const readChain = (start) => {
      const parts = [];
      for (let i = start, guard = 0; i < 0xFFFFFFFA && guard < fat.length + 1; i = fat[i], guard++) parts.push(u8.subarray(secOff(i), secOff(i) + ss));
      return concat(parts);
    };
    const dir = readChain(dir1), ddv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
    const ents = [];
    for (let o = 0; o + 128 <= dir.length; o += 128) {
      const nl = ddv.getUint16(o + 0x40, true);
      let name = '';
      for (let i = 0; i < Math.max(0, nl - 2); i += 2) name += String.fromCharCode(ddv.getUint16(o + i, true));
      ents.push({ name, type: dir[o + 0x42], l: ddv.getInt32(o + 0x44, true), r: ddv.getInt32(o + 0x48, true), c: ddv.getInt32(o + 0x4C, true), start: ddv.getUint32(o + 0x74, true), size: ddv.getUint32(o + 0x78, true) });
    }
    const ministream = ents[0].start < 0xFFFFFFFA ? readChain(ents[0].start) : new Uint8Array(0);
    const minifat = [];
    if (nminifat) {
      const mf = readChain(minifat1), mdv = new DataView(mf.buffer, mf.byteOffset, mf.byteLength);
      for (let i = 0; i + 4 <= mf.length; i += 4) minifat.push(mdv.getUint32(i, true));
    }
    const readMini = (start, size) => {
      const parts = [];
      for (let i = start, guard = 0; i < 0xFFFFFFFA && guard < minifat.length + 1; i = minifat[i], guard++) parts.push(ministream.subarray(i * mss, (i + 1) * mss));
      return concat(parts).subarray(0, size);
    };
    const streams = {};
    const walk = (idx, path, depth) => {
      if (idx < 0 || idx >= ents.length || depth > 64) return;
      const e = ents[idx];
      walk(e.l, path, depth + 1); walk(e.r, path, depth + 1);
      const p = path ? path + '/' + e.name : e.name;
      if (e.type === 2) streams[p] = e.size < cutoff ? readMini(e.start, e.size) : readChain(e.start).subarray(0, e.size);
      else if (e.type === 1) walk(e.c, p, depth + 1);
    };
    walk(ents[0].c, '', 0);
    return streams;
  }

  function concat(parts) {
    const out = new Uint8Array(parts.reduce((s, a) => s + a.length, 0));
    let o = 0;
    for (const a of parts) { out.set(a, o); o += a.length; }
    return out;
  }

  const T = { PARA_HEADER: 66, PARA_TEXT: 67, CTRL_HEADER: 71, LIST_HEADER: 72, TABLE: 77, SHAPE: 76 };
  const EXT_CTRL = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);

  function hwpParaText(d) {
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    let s = '';
    for (let i = 0; i + 1 < d.length;) {
      const c = dv.getUint16(i, true);
      if (c < 32) {
        if (EXT_CTRL.has(c)) { if (c === 9) s += '\t'; i += 16; continue; }
        if (c === 10) s += '\n'; else if (c === 30 || c === 31) s += ' '; else if (c === 24) s += '-';
        i += 2; continue;
      }
      s += String.fromCharCode(c); i += 2;
    }
    return s;
  }

  async function parseHwp(buf) {
    const st = readCfb(buf);
    const hdr = st['FileHeader'];
    if (!hdr) throw new Error('HWP 파일 헤더를 찾을 수 없습니다.');
    const props = new DataView(hdr.buffer, hdr.byteOffset, hdr.byteLength).getUint32(36, true);
    if (props & 2) throw new Error('암호가 걸린 HWP 파일은 읽을 수 없습니다. 암호를 해제한 뒤 다시 올려 주세요.');
    if (props & 4) throw new Error('배포용 문서는 읽을 수 없습니다. 일반 문서로 저장한 뒤 다시 올려 주세요.');
    const compressed = props & 1;
    const secs = Object.keys(st).filter((k) => /^BodyText\/Section\d+$/.test(k)).sort((a, b) => +a.match(/\d+$/)[0] - +b.match(/\d+$/)[0]);
    const ctx = { blocks: [], warn: { textbox: 0 } };
    for (const k of secs) {
      const raw = compressed ? await Zip.inflateRaw(st[k]) : st[k];
      const root = buildTree(raw);
      for (const n of root.children) if (n.tag === T.PARA_HEADER) hwpPara(n, ctx);
    }
    return { blocks: ctx.blocks, warnings: warnText(ctx.warn) };
  }

  function buildTree(raw) {
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const root = { level: -1, children: [] }, stack = [root];
    for (let o = 0; o + 4 <= raw.length;) {
      const h = dv.getUint32(o, true); o += 4;
      const tag = h & 0x3FF, level = (h >>> 10) & 0x3FF;
      let size = h >>> 20;
      if (size === 0xFFF) { size = dv.getUint32(o, true); o += 4; }
      const node = { tag, level, data: raw.subarray(o, o + size), children: [] };
      o += size;
      while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    }
    return root;
  }

  const ctrlId = (d) => d.length >= 4 ? String.fromCharCode(d[3], d[2], d[1], d[0]) : '';

  // 노드 자식 중 LIST_HEADER 뒤에 오는 PARA_HEADER들을 묶어 리스트로 반환
  function lists(children) {
    const out = []; let cur = null;
    for (const c of children) {
      if (c.tag === T.LIST_HEADER) { cur = { header: c.data, paras: [] }; out.push(cur); }
      else if (c.tag === T.PARA_HEADER && cur) cur.paras.push(c);
    }
    return out;
  }

  function paraPlain(p) {
    const t = p.children.find((c) => c.tag === T.PARA_TEXT);
    return t ? hwpParaText(t.data) : '';
  }

  // 표 셀 안 문단(중첩 표 포함)을 하나의 문자열로
  function paraDeep(p) {
    let s = paraPlain(p).replace(/\s+$/, '');
    for (const c of p.children) {
      if (c.tag !== T.CTRL_HEADER) continue;
      const id = ctrlId(c.data);
      if (id === 'tbl ') { const t = hwpTable(c); s += (s ? '\n' : '') + tableText(t); }
    }
    return s;
  }

  function hwpTable(ctrl) {
    let seenTable = false; const caption = [], cells = [];
    let cur = null;
    for (const c of ctrl.children) {
      if (c.tag === T.TABLE) { seenTable = true; continue; }
      if (c.tag === T.LIST_HEADER) {
        cur = { header: c.data, paras: [] };
        (seenTable ? cells : caption).push(cur);
      } else if (c.tag === T.PARA_HEADER && cur) cur.paras.push(c);
    }
    const rows = [];
    cells.forEach((cell, i) => {
      const d = cell.header;
      const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
      const col = d.length >= 12 ? dv.getUint16(8, true) : i;
      const row = d.length >= 12 ? dv.getUint16(10, true) : 0;
      (rows[row] = rows[row] || []).push({ col, text: cell.paras.map(paraDeep).join('\n').trim() });
    });
    return {
      caption: caption.map((l) => l.paras.map(paraPlain).join(' ')).join(' ').replace(/\s+/g, ' ').trim(),
      rows: rows.filter(Boolean).map((r) => r.sort((a, b) => a.col - b.col).map((c) => c.text)),
    };
  }

  function collectText(node, out) {
    if (node.tag === T.PARA_TEXT) out.push(hwpParaText(node.data));
    for (const c of node.children) collectText(c, out);
  }

  function hwpPara(p, ctx) {
    const text = paraPlain(p);
    if (text.trim()) ctx.blocks.push({ type: 'p', text: text.replace(/\r/g, '') });
    for (const c of p.children) {
      if (c.tag !== T.CTRL_HEADER) continue;
      const id = ctrlId(c.data);
      if (id === 'tbl ') {
        const t = hwpTable(c);
        ctx.blocks.push({ type: 'table', caption: t.caption, rows: t.rows });
      } else if (id === 'gso ') {
        const capLists = lists(c.children);
        const caption = capLists.map((l) => l.paras.map(paraPlain).join(' ')).join(' ').replace(/\s+/g, ' ').trim();
        const label = [];
        for (const k of c.children) if (k.tag === T.SHAPE) collectText(k, label);
        const labelText = label.join(' ').replace(/\s+/g, ' ').trim();
        if (labelText) ctx.warn.textbox++;
        ctx.blocks.push({ type: 'figure', caption, label: labelText });
      }
    }
  }

  // ------------------------------------------------------------ HWPX
  const SKIP = new Set(['secPr', 'ctrl', 'linesegarray', 'header', 'footer', 'footNote', 'endNote', 'fieldBegin', 'fieldEnd', 'pageNum', 'pageHiding', 'bookmark', 'markpenBegin', 'markpenEnd']);
  const SHAPES = new Set(['pic', 'container', 'rect', 'ellipse', 'line', 'arc', 'polygon', 'curve', 'connectLine', 'ole', 'textart', 'video', 'chart']);

  // withRefs: 블록마다 원본 XML 요소를 함께 돌려줌 (HWPX 최종본 쓰기용)
  async function parseHwpx(buf, withRefs = false) {
    const z = Zip.open(buf);
    let secNames = [];
    const hpf = z.names.find((n) => /content\.hpf$/i.test(n));
    if (hpf) {
      const doc = new DOMParser().parseFromString(await z.text(hpf), 'application/xml');
      const items = {};
      for (const it of doc.getElementsByTagNameNS('*', 'item')) items[it.getAttribute('id')] = it.getAttribute('href');
      for (const ref of doc.getElementsByTagNameNS('*', 'itemref')) {
        const href = items[ref.getAttribute('idref')];
        if (href && /section\d+\.xml$/i.test(href)) secNames.push(href.startsWith('Contents/') ? href : 'Contents/' + href.replace(/^\.?\//, ''));
      }
      secNames = secNames.filter((n) => z.has(n));
    }
    if (!secNames.length) secNames = z.names.filter((n) => /^Contents\/section\d+\.xml$/i.test(n)).sort((a, b) => +a.match(/(\d+)\.xml$/i)[1] - +b.match(/(\d+)\.xml$/i)[1]);
    if (!secNames.length) throw new Error('HWPX 본문(section)을 찾을 수 없습니다.');
    const ctx = { blocks: [], refs: [], warn: { textbox: 0 } };
    const docs = [];
    for (const n of secNames) {
      const doc = new DOMParser().parseFromString(await z.text(n), 'application/xml');
      if (doc.getElementsByTagName('parsererror').length) throw new Error('HWPX 본문 XML을 해석할 수 없습니다: ' + n);
      docs.push({ name: n, doc });
      for (const el of doc.documentElement.children) if (el.localName === 'p') xPara(el, ctx);
    }
    const out = { blocks: ctx.blocks, warnings: warnText(ctx.warn) };
    return withRefs ? { ...out, refs: ctx.refs, docs, zip: z } : out;
  }

  // 문단의 텍스트와 그 안의 표·그림 컨트롤을 분리해 반환
  function xSplit(p) {
    let text = ''; const ctrls = [];
    const visit = (node) => {
      for (const c of node.childNodes) {
        if (c.nodeType !== 1) continue;
        const ln = c.localName;
        if (ln === 't') {
          for (const t of c.childNodes) {
            if (t.nodeType === 3) text += t.nodeValue;
            else if (t.nodeType === 1) text += t.localName === 'tab' ? '\t' : t.localName === 'lineBreak' ? '\n' : t.localName === 'hyphen' ? '-' : /Space$/.test(t.localName) ? ' ' : '';
          }
        } else if (ln === 'tbl' || SHAPES.has(ln)) ctrls.push(c);
        else if (ln === 'switch') {
          const pick = [...c.children].find((k) => k.localName === 'default') || [...c.children].find((k) => k.localName === 'case');
          if (pick) visit(pick);
        } else if (!SKIP.has(ln)) visit(c);
      }
    };
    visit(p);
    return { text, ctrls };
  }

  const kids = (el, name) => [...el.children].filter((k) => k.localName === name);
  const subParas = (el) => {
    const out = [];
    for (const sl of kids(el, 'subList')) out.push(...kids(sl, 'p'));
    return out;
  };

  function xParaDeep(p) {
    const { text, ctrls } = xSplit(p);
    let s = text.replace(/\s+$/, '');
    for (const c of ctrls) if (c.localName === 'tbl') s += (s ? '\n' : '') + tableText(xTable(c));
    return s;
  }

  function xCaption(el) {
    const cap = kids(el, 'caption')[0];
    return cap ? subParas(cap).map((p) => xSplit(p).text).join(' ').replace(/\s+/g, ' ').trim() : '';
  }

  function xTable(tbl) {
    const rows = kids(tbl, 'tr').map((tr) => kids(tr, 'tc').map((tc) => subParas(tc).map(xParaDeep).join('\n').trim()));
    return { caption: xCaption(tbl), rows };
  }

  function xPara(p, ctx) {
    const { text, ctrls } = xSplit(p);
    if (text.trim()) { ctx.blocks.push({ type: 'p', text }); ctx.refs.push({ el: p }); }
    for (const c of ctrls) {
      ctx.refs.push({ el: c, host: p });
      if (c.localName === 'tbl') {
        const t = xTable(c);
        ctx.blocks.push({ type: 'table', caption: t.caption, rows: t.rows });
      } else {
        const label = [];
        for (const dt of c.getElementsByTagNameNS('*', 'drawText')) for (const pp of subParas(dt)) label.push(xSplit(pp).text);
        const labelText = label.join(' ').replace(/\s+/g, ' ').trim();
        if (labelText) ctx.warn.textbox++;
        ctx.blocks.push({ type: 'figure', caption: xCaption(c), label: labelText });
      }
    }
  }

  // ------------------------------------------------------------ 공통
  function tableText(t) {
    return t.rows.map((r) => r.map((c) => c.replace(/\s*\n\s*/g, ' ')).join(' | ')).join('\n');
  }

  function warnText(w) {
    const out = [];
    if (w.textbox) out.push(`그림·글상자 ${w.textbox}개 안의 글자는 비교에서 제외했습니다 (그림은 캡션과 유무만 비교).`);
    return out;
  }

  async function parse(name, buf) {
    const head = new Uint8Array(buf.slice(0, 4));
    if (head[0] === 0x50 && head[1] === 0x4B) return parseHwpx(buf);
    if (head[0] === 0xD0 && head[1] === 0xCF) return parseHwp(buf);
    throw new Error(`${name}: HWPX 또는 HWP 파일이 아닙니다.`);
  }

  return { parse, parseHwpx, tableText, xSplit, kids, subParas, SKIP, SHAPES };
})();
