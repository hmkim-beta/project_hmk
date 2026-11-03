// ZIP 읽기/쓰기 + raw deflate 해제 (외부 라이브러리 없이 동작)
'use strict';

const Inflate = (() => {
  const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  function huff(lengths) {
    const count = new Uint16Array(16), symbol = new Uint16Array(lengths.length), offs = new Uint16Array(16);
    for (const l of lengths) count[l]++;
    count[0] = 0;
    for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + count[i - 1];
    lengths.forEach((l, i) => { if (l) symbol[offs[l]++] = i; });
    return { count, symbol };
  }

  let FIXED = null;
  function fixed() {
    if (!FIXED) {
      const l = new Array(288);
      for (let i = 0; i < 288; i++) l[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8;
      FIXED = [huff(l), huff(new Array(30).fill(5))];
    }
    return FIXED;
  }

  function inflateRaw(data) {
    let pos = 0, bitbuf = 0, bitcnt = 0, olen = 0;
    let out = new Uint8Array(Math.max(1024, data.length * 4));
    const bits = (n) => {
      while (bitcnt < n) {
        if (pos >= data.length) throw new Error('압축 데이터가 손상되었습니다.');
        bitbuf |= data[pos++] << bitcnt; bitcnt += 8;
      }
      const v = bitbuf & ((1 << n) - 1);
      bitbuf >>>= n; bitcnt -= n;
      return v;
    };
    const ensure = (n) => {
      if (olen + n <= out.length) return;
      let len = out.length * 2;
      while (len < olen + n) len *= 2;
      const o = new Uint8Array(len); o.set(out.subarray(0, olen)); out = o;
    };
    const decode = (h) => {
      let code = 0, first = 0, index = 0;
      for (let len = 1; len < 16; len++) {
        code |= bits(1);
        const c = h.count[len];
        if (code - c < first) return h.symbol[index + (code - first)];
        index += c; first += c; first <<= 1; code <<= 1;
      }
      throw new Error('압축 데이터가 손상되었습니다.');
    };
    const codes = (lh, dh) => {
      for (;;) {
        let sym = decode(lh);
        if (sym < 256) { ensure(1); out[olen++] = sym; continue; }
        if (sym === 256) return;
        sym -= 257;
        const len = LBASE[sym] + bits(LEXT[sym]);
        const ds = decode(dh);
        const dist = DBASE[ds] + bits(DEXT[ds]);
        if (dist > olen) throw new Error('압축 데이터가 손상되었습니다.');
        ensure(len);
        for (let i = 0; i < len; i++, olen++) out[olen] = out[olen - dist];
      }
    };
    let last;
    do {
      last = bits(1);
      const type = bits(2);
      if (type === 0) {
        bitbuf = 0; bitcnt = 0;
        const len = data[pos] | (data[pos + 1] << 8);
        pos += 4;
        ensure(len); out.set(data.subarray(pos, pos + len), olen); olen += len; pos += len;
      } else if (type === 1) {
        const [l, d] = fixed(); codes(l, d);
      } else if (type === 2) {
        const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
        const cl = new Array(19).fill(0);
        for (let i = 0; i < ncode; i++) cl[ORDER[i]] = bits(3);
        const ch = huff(cl);
        const lens = [];
        while (lens.length < nlen + ndist) {
          const sym = decode(ch);
          if (sym < 16) lens.push(sym);
          else if (sym === 16) { const p = lens[lens.length - 1]; for (let r = 3 + bits(2); r > 0; r--) lens.push(p); }
          else if (sym === 17) for (let r = 3 + bits(3); r > 0; r--) lens.push(0);
          else for (let r = 11 + bits(7); r > 0; r--) lens.push(0);
        }
        codes(huff(lens.slice(0, nlen)), huff(lens.slice(nlen)));
      } else throw new Error('압축 데이터가 손상되었습니다.');
    } while (!last);
    return out.slice(0, olen);
  }
  return { inflateRaw };
})();

const Zip = (() => {
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  async function inflateRaw(u8) {
    if (typeof DecompressionStream !== 'undefined' && !Zip.forceFallback) {
      try {
        const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      } catch (e) { /* 일부 데이터는 아래 구현으로 다시 시도 */ }
    }
    return Inflate.inflateRaw(u8);
  }

  // buf: ArrayBuffer → { names, has(name), read(name) → Promise<Uint8Array>, text(name) }
  function open(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('ZIP 형식이 아닙니다.');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = new Map();
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true);
      const xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = new TextDecoder('utf-8').decode(u8.subarray(p + 46, p + 46 + nlen));
      entries.set(name, { method, csize, lho });
      p += 46 + nlen + xlen + clen;
    }
    async function read(name) {
      const e = entries.get(name);
      if (!e) throw new Error('파일 없음: ' + name);
      const start = e.lho + 30 + dv.getUint16(e.lho + 26, true) + dv.getUint16(e.lho + 28, true);
      const data = u8.subarray(start, start + e.csize);
      if (e.method === 0) return data.slice();
      if (e.method === 8) return inflateRaw(data);
      throw new Error('지원하지 않는 압축 방식: ' + e.method);
    }
    return {
      names: [...entries.keys()],
      has: (n) => entries.has(n),
      read,
      text: async (n) => new TextDecoder('utf-8').decode(await read(n)),
    };
  }

  async function deflateRaw(u8) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const stream = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (e) { return null; }
  }

  // 압축해서 묶기 (store: true 인 파일과 압축을 못 하는 브라우저는 무압축)
  async function buildCompressed(files) {
    const enc = new TextEncoder();
    const out = [];
    for (const f of files) {
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const cdata = f.store ? null : await deflateRaw(data);
      out.push({ name: f.name, data, cdata: cdata && cdata.length < data.length ? cdata : null });
    }
    return build(out);
  }

  // files: [{ name, data: Uint8Array|string, cdata?: 압축된 바이트 }] → Uint8Array
  function build(files) {
    const enc = new TextEncoder();
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const locals = [], centrals = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const payload = f.cdata || data, method = f.cdata ? 8 : 0;
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x800, true);
      lh.setUint16(8, method, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, payload.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x800, true); ch.setUint16(10, method, true); ch.setUint16(12, dosTime, true);
      ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true); ch.setUint32(20, payload.length, true);
      ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      locals.push(new Uint8Array(lh.buffer), name, payload);
      centrals.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + payload.length;
    }
    const csize = centrals.reduce((s, a) => s + a.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, csize, true); end.setUint32(16, offset, true);
    const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
    const out = new Uint8Array(parts.reduce((s, a) => s + a.length, 0));
    let o = 0;
    for (const a of parts) { out.set(a, o); o += a.length; }
    return out;
  }

  return { open, build, buildCompressed, crc32, inflateRaw, forceFallback: false };
})();
