// 조항 안 글자/단어 단위 차이 계산
'use strict';

const TextDiff = (() => {
  // a, b: 토큰 배열 → [[op, 문자열]] (op: 0 같음, -1 삭제, 1 추가)
  function diffTokens(a, b) {
    let pre = 0;
    while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
    let suf = 0;
    while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
    const A = a.slice(pre, a.length - suf), B = b.slice(pre, b.length - suf);
    const ops = [];
    if (pre) ops.push([0, a.slice(0, pre)]);
    if (!A.length && B.length) ops.push([1, B]);
    else if (A.length && !B.length) ops.push([-1, A]);
    else if (A.length && B.length) {
      if (A.length * B.length > 4e6) { ops.push([-1, A], [1, B]); }
      else {
        const n = A.length, m = B.length, W = m + 1;
        const L = new Uint16Array((n + 1) * W);
        for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
          L[i * W + j] = A[i] === B[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
        let i = 0, j = 0;
        while (i < n && j < m) {
          if (A[i] === B[j]) { ops.push([0, [A[i]]]); i++; j++; }
          else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) { ops.push([-1, [A[i]]]); i++; }
          else { ops.push([1, [B[j]]]); j++; }
        }
        if (i < n) ops.push([-1, A.slice(i)]);
        if (j < m) ops.push([1, B.slice(j)]);
      }
    }
    if (suf) ops.push([0, a.slice(a.length - suf)]);
    return merge(ops.map(([o, t]) => [o, t.join('')]));
  }

  function merge(ops) {
    // 같은 종류끼리 합치고, 삭제·추가 순서를 정리
    const out = [];
    let del = '', ins = '';
    const flush = () => { if (del) out.push([-1, del]); if (ins) out.push([1, ins]); del = ins = ''; };
    for (const [o, t] of ops) {
      if (!t) continue;
      if (o === -1) del += t; else if (o === 1) ins += t;
      else { flush(); if (out.length && out[out.length - 1][0] === 0) out[out.length - 1][1] += t; else out.push([0, t]); }
    }
    flush();
    return out;
  }

  // 변경 사이에 낀 짧은 같은 부분(1~2글자)은 변경에 흡수해 읽기 쉽게
  function cleanup(ops) {
    let changed = true;
    while (changed) {
      changed = false;
      for (let k = 1; k < ops.length - 1; k++) {
        const [o, t] = ops[k];
        if (o === 0 && t.replace(/\s/g, '').length <= 2 && t.length <= 3 && ops[k - 1][0] !== 0 && ops[k + 1][0] !== 0) {
          ops.splice(k, 1, [-1, t], [1, t]);
          ops = merge(ops); changed = true; break;
        }
      }
    }
    return ops;
  }

  const tokenize = (s, mode) => mode === 'word' ? (s.match(/\s+|[가-힣A-Za-z0-9]+|[^\s가-힣A-Za-z0-9]/g) || []) : Array.from(s);

  // 줄 단위로 먼저 맞추고, 바뀐 줄끼리 세부 비교
  function diff(oldText, newText, mode = 'char') {
    const ol = oldText.split('\n'), nl = newText.split('\n');
    const lineOps = diffTokens(ol.map((l) => l + '\n'), nl.map((l) => l + '\n'));
    const out = [];
    for (let k = 0; k < lineOps.length; k++) {
      const [o, t] = lineOps[k];
      if (o === -1 && lineOps[k + 1] && lineOps[k + 1][0] === 1) {
        const dl = t.split(/(?<=\n)/), il = lineOps[k + 1][1].split(/(?<=\n)/);
        const n = Math.min(dl.length, il.length);
        for (let x = 0; x < n; x++) {
          const ops = diffTokens(tokenize(dl[x], mode), tokenize(il[x], mode));
          out.push(...(mode === 'word' ? ops : cleanup(ops)));
        }
        if (dl.length > n) out.push([-1, dl.slice(n).join('')]);
        if (il.length > n) out.push([1, il.slice(n).join('')]);
        k++;
      } else out.push([o, t]);
    }
    return merge(out);
  }

  // ops → [기존 HTML, 개정 HTML]. 각 줄 끝에 붙인 줄바꿈은 마지막 것만 떼어 냄
  function toHtml(ops, esc, delTag = ['<del>', '</del>'], insTag = ['<ins>', '</ins>']) {
    let L = '', R = '';
    for (const [op, t] of ops) {
      if (op === 0) { L += esc(t); R += esc(t); }
      else if (op === -1) L += delTag[0] + esc(t) + delTag[1];
      else R += insTag[0] + esc(t) + insTag[1];
    }
    const trim = (s) => s.replace(/\n((?:<\/[a-z]+>)*)$/, '$1');
    return [trim(L), trim(R)];
  }

  return { diff, toHtml };
})();
