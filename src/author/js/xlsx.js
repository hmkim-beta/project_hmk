// 최소 기능 엑셀(.xlsx) 생성기
// sheets: [{ name, widths:[열너비], rows:[[값|{v, s}]], header:true, title? }]
// 스타일 s: 'head' | 'wrap' | 'center' | 'title' | 'bold'
'use strict';

const Xlsx = (() => {
  const STYLE = { default: 0, head: 1, wrap: 2, title: 3, center: 4, bold: 5 };
  const esc = (s) => String(s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const col = (i) => { let s = ''; i++; while (i) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };

  function sheetXml(sh) {
    const rows = sh.rows.map((r, ri) => {
      const cells = r.map((v, ci) => {
        const cell = v && typeof v === 'object' ? v : { v };
        const style = STYLE[cell.s || (ri === 0 && sh.header ? 'head' : 'wrap')] || 0;
        const ref = col(ci) + (ri + 1);
        if (cell.v === null || cell.v === undefined || cell.v === '') return `<c r="${ref}" s="${style}"/>`;
        if (typeof cell.v === 'number' && isFinite(cell.v)) return `<c r="${ref}" s="${style}"><v>${cell.v}</v></c>`;
        let t = String(cell.v);
        if (t.length > 32000) t = t.slice(0, 32000) + '…(이하 생략)';
        return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(t)}</t></is></c>`;
      }).join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    }).join('');
    const cols = sh.widths ? `<cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    const pane = sh.header ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
    const filter = sh.header && sh.rows.length > 1 ? `<autoFilter ref="A1:${col(Math.max(0, sh.rows[0].length - 1))}${sh.rows.length}"/>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${pane}<sheetFormatPr defaultRowHeight="16.5"/>${cols}<sheetData>${rows}</sheetData>${filter}<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape"/></worksheet>`;
  }

  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="10"/><name val="맑은 고딕"/><family val="3"/></font><font><b/><sz val="10"/><name val="맑은 고딕"/><family val="3"/></font><font><b/><sz val="14"/><name val="맑은 고딕"/><family val="3"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDE4EE"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF9AA5B1"/></left><right style="thin"><color rgb="FF9AA5B1"/></right><top style="thin"><color rgb="FF9AA5B1"/></top><bottom style="thin"><color rgb="FF9AA5B1"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs><cellStyles count="1"><cellStyle name="표준" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  function safeName(n, used) {
    let s = String(n).replace(/[\[\]:*?/\\]/g, ' ').slice(0, 31) || 'Sheet';
    let k = 2; const base = s;
    while (used.has(s)) s = base.slice(0, 28) + ' ' + k++;
    used.add(s);
    return s;
  }

  function build(sheets) {
    const used = new Set();
    const names = sheets.map((s) => safeName(s.name, used));
    const files = [
      { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${sheets.map((s, i) => s.header && s.rows.length > 1 ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(names[i])}'!$A$1:$${col(s.rows[0].length - 1)}$${s.rows.length}</definedName></definedNames>` : '').join('').replace(/<\/definedNames><definedNames>/g, '')}</workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', data: STYLES },
      ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
    ];
    return Zip.build(files);
  }

  // 첫 번째 시트를 [[셀 문자열]] 로 읽음 (엑셀에서 다시 저장한 파일 포함)
  async function read(buf) {
    const z = Zip.open(buf);
    const xml = async (n) => new DOMParser().parseFromString(await z.text(n), 'application/xml');
    const all = (el, name) => [...el.getElementsByTagNameNS('*', name)];
    const strings = [];
    if (z.has('xl/sharedStrings.xml')) {
      for (const si of all(await xml('xl/sharedStrings.xml'), 'si')) {
        // 일본어·한자 음 표기(rPh) 안의 글자는 빼고 이어 붙임
        strings.push(all(si, 't').filter((t) => t.parentNode.localName !== 'rPh').map((t) => t.textContent).join(''));
      }
    }
    let path = 'xl/worksheets/sheet1.xml';
    try {
      const sheet = all(await xml('xl/workbook.xml'), 'sheet')[0];
      const rid = sheet.getAttribute('r:id') || sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      const rel = all(await xml('xl/_rels/workbook.xml.rels'), 'Relationship').find((r) => r.getAttribute('Id') === rid);
      if (rel) { const t = rel.getAttribute('Target'); path = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, ''); }
    } catch (e) { /* 기본 경로 사용 */ }
    if (!z.has(path)) throw new Error('엑셀 시트를 찾을 수 없습니다.');
    const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
    const rows = [];
    for (const row of all(await xml(path), 'row')) {
      const arr = []; let next = 0;
      for (const c of all(row, 'c')) {
        const ref = c.getAttribute('r'), t = c.getAttribute('t');
        const col = ref ? colIndex(ref) : next;
        const v = all(c, 'v')[0]?.textContent ?? '';
        arr[col] = t === 's' ? strings[+v] ?? '' : t === 'inlineStr' ? all(c, 't').map((x) => x.textContent).join('') : v;
        next = col + 1;
      }
      rows[(+row.getAttribute('r') || rows.length + 1) - 1] = Array.from(arr, (x) => x ?? '');
    }
    return Array.from(rows, (r) => r || []);
  }

  return { build, read };
})();
