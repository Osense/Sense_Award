// 한 장(레코드)의 배치 계산과 미리보기 SVG
import { layoutField } from './layout.js';
import { fillTemplate } from './data.js';
import { variantKey, needsFauxBold, FALLBACK_FONT } from './fonts.js';

/** 이 문서를 그리는 데 필요한 글꼴 키 */
export function fontKeysFor(doc) {
  const keys = new Set();
  for (const f of doc.fields) keys.add(variantKey(f.font, f.bold));
  return [...keys];
}

/**
 * doc: { fields, columns, rows, stamp }
 * 반환: { fields: [...배치 결과], stamp: {x,y,w,h}|null, missing: [키], needFallback, pending }
 */
export function computeRecord(doc, index, store) {
  const row = doc.rows[index] || [];
  const out = { fields: [], stamp: null, missing: [], needFallback: false, pending: false };
  const missing = new Set();
  const fallback = store.get(variantKey(FALLBACK_FONT, false));
  // 장마다 자동 배치가 다르면(본문 길이에 따라 글자 크기가 바뀜) 그 장의 칸 목록을 쓴다
  const per = doc.layoutFor ? doc.layoutFor(index) : null;
  const fieldList = per ? per.fields : doc.fields;
  for (const f of fieldList) {
    // 이 상장만 직접 고친 글이 있으면 그것을 쓴다
    const ov = doc.overrides && doc.overrides[index] ? doc.overrides[index][f.id] : undefined;
    const edited = typeof ov === 'string';
    const { text, missing: ms } = edited ? { text: ov, missing: [] } : fillTemplate(f.text, doc.columns, row, index);
    ms.forEach(m => missing.add(m));
    const font = store.get(variantKey(f.font, f.bold));
    if (!font) { out.pending = true; out.fields.push({ field: f, text, edited, pending: true }); continue; }
    if (!fallback) {
      for (const ch of text) { const cp = ch.codePointAt(0); if (cp > 32 && !font.has(cp)) { out.needFallback = true; break; } }
    }
    const fb = fallback && fallback !== font ? fallback : null;
    const lay = layoutField(text, f, f, font, fb);
    out.fields.push({ field: f, text, edited, ...lay, font, fallback: fb, faux: needsFauxBold(f.font, f.bold), rules: fieldRules(f) });
  }
  out.missing = [...missing];
  out.stamp = stampPlacement(per ? { ...doc, stamp: { ...doc.stamp, size: per.stampSize }, fields: fieldList } : doc, out.fields);
  return out;
}

/**
 * 칸에 딸린 장식선(칸을 옮기면 같이 움직인다). 반환: [{x,y,w,h,color}] (mm, 채운 사각형)
 *  double-below: 칸 아래 이중선(굵은 선 + 가는 선) — 제목
 *  below: 칸 아래 밑줄 — 받는 사람 이름
 *  sig-above: 칸 위 서명선 — 서명자
 */
export function fieldRules(f) {
  if (!f.rule) return [];
  const color = f.ruleColor || f.color || '#111111';
  const w = Math.min(f.ruleW || f.w, f.w * 1.6);
  const x = f.x + (f.w - w) / 2;
  if (f.rule === 'double-below') return [
    { x, y: f.y + f.h + 0.8, w, h: 0.5, color },
    { x, y: f.y + f.h + 1.9, w, h: 0.22, color },
  ];
  if (f.rule === 'below') return [{ x, y: f.y + f.h + 0.3, w, h: 0.28, color }];
  if (f.rule === 'sig-above') return [{ x, y: f.y - 1.2, w, h: 0.3, color }];
  return [];
}

/** 도장 자리: 수여자 마지막 글자에 걸치게 */
export function stampPlacement(doc, fields) {
  const st = doc.stamp;
  if (!st || !st.enabled) return null;
  const size = st.size || 20;
  const aspect = st.imgW && st.imgH ? st.imgH / st.imgW : 1;
  const w = size;
  const h = size * aspect;
  const pres = fields.find(r => r.field.id === 'presenter');
  let cx, cy;
  if (pres && !pres.pending && pres.lines && pres.lines.length) {
    // 관례: 도장이 수여자 마지막 어절의 오른쪽 절반쯤에 걸친다
    //  → 도장 왼쪽 끝을 마지막 어절의 가운데에 두고, 세로는 글줄 가운데에 맞춘다
    const line = pres.lines[pres.lines.length - 1];
    const words = (line.text || '').trim().split(/\s+/);
    const n = Math.max(1, Array.from(words[words.length - 1] || '').length);
    const wc = line.chars.slice(-n);
    const first = wc[0], last = line.chars[line.chars.length - 1];
    if (first && last) {
      const mid = (first.x + last.x + last.w) / 2;
      cx = mid + w / 2 + (st.dx || 0);
      cy = line.baseline - pres.sizeMm * 0.36 + (st.dy || 0);
    }
  }
  if (cx === undefined) {
    const f = doc.fields.find(x => x.id === 'presenter');
    if (!f) return null;
    cx = f.x + f.w - size / 2 + (st.dx || 0);
    cy = f.y + f.h / 2 + (st.dy || 0);
  }
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

const r2 = n => Math.round(n * 1000) / 1000;

function glyphPathsSvg(res) {
  let s = '';
  for (const line of res.lines) {
    for (const c of line.chars) {
      const font = c.fb && res.fallback ? res.fallback : res.font;
      const d = font.path(c.cp);
      if (!d) continue;
      const k = res.sizeMm / font.upm;
      s += `<path d="${d}" transform="matrix(${r2(k * res.scale / 100)} 0 0 ${r2(-k)} ${r2(c.x)} ${r2(line.baseline)})"/>`;
    }
  }
  return s;
}

export function textLayerSvg(rec) {
  let s = '';
  for (const res of rec.fields) {
    if (res.pending) continue;
    const faux = res.faux ? ` stroke="${res.field.color}" stroke-width="${r2(res.font.upm * 0.035)}" stroke-linejoin="round"` : '';
    for (const r of res.rules || []) s += `<rect x="${r2(r.x)}" y="${r2(r.y)}" width="${r2(r.w)}" height="${r2(r.h)}" fill="${r.color}"/>`;
    s += `<g data-field="${res.field.id}" fill="${res.field.color || '#111'}"${faux}>${glyphPathsSvg(res)}</g>`;
  }
  return s;
}
