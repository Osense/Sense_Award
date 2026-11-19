// 데이터: 엑셀 붙여넣기(TSV) 해석, 변수 채우기

/** 엑셀에서 복사한 글(탭 구분)을 행·열 배열로. 셀 안 줄바꿈("...")도 처리한다. */
export function parseTSV(text) {
  const src = String(text).replace(/\r\n?/g, '\n');
  const rows = [];
  let row = [];
  let cell = '';
  let i = 0;
  let quoted = false;
  while (i < src.length) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      cell += c; i++; continue;
    }
    if (c === '"' && cell === '') { quoted = true; i++; continue; }
    if (c === '\t') { row.push(cell); cell = ''; i++; continue; }
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
    cell += c; i++;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  // 끝의 빈 줄 제거
  while (rows.length && rows[rows.length - 1].every(v => v.trim() === '')) rows.pop();
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  return rows.map(r => { const o = r.slice(); while (o.length < width) o.push(''); return o.map(v => v.trim()); });
}

/** 붙여넣은 표 → { columns, rows } */
export function tableFromPaste(text, firstRowIsHeader = true) {
  const grid = parseTSV(text);
  if (!grid.length) return null;
  if (firstRowIsHeader) {
    const columns = grid[0].map((h, i) => (h || `항목${i + 1}`).replace(/[{}]/g, ''));
    return { columns: dedupe(columns), rows: grid.slice(1) };
  }
  return { columns: grid[0].map((_, i) => `항목${i + 1}`), rows: grid };
}

function dedupe(cols) {
  const seen = new Map();
  return cols.map(c => {
    const n = seen.get(c) || 0;
    seen.set(c, n + 1);
    return n ? `${c}${n + 1}` : c;
  });
}

export const BUILTIN_VARS = ['순번', '오늘'];

function todayKorean(d = new Date()) {
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/**
 * {{키}}를 값으로 바꾼다. {{순번}} {{순번:3}}(자리수 맞춤) {{오늘}} 지원.
 * 반환: { text, missing: [없는 키] }
 */
export function fillTemplate(tpl, columns, row, index) {
  const missing = [];
  const text = String(tpl ?? '').replace(/\{\{\s*([^{}:]+?)\s*(?::\s*(\d+))?\s*\}\}/g, (m, key, pad) => {
    if (key === '순번') {
      const n = String(index + 1);
      return pad ? n.padStart(Number(pad), '0') : n;
    }
    if (key === '오늘') return todayKorean();
    const ci = columns.indexOf(key);
    if (ci < 0) { missing.push(key); return ''; }
    const v = row[ci] ?? '';
    return pad && /^\d+$/.test(v) ? v.padStart(Number(pad), '0') : v;
  });
  return { text, missing };
}

export function usedKeys(tpl) {
  const keys = [];
  String(tpl ?? '').replace(/\{\{\s*([^{}:]+?)\s*(?::\s*\d+)?\s*\}\}/g, (m, k) => { keys.push(k); return m; });
  return keys;
}
