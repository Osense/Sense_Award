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
  for (const f of doc.fields) {
    const { text, missing: ms } = fillTemplate(f.text, doc.columns, row, index);
    ms.forEach(m => missing.add(m));
    const font = store.get(variantKey(f.font, f.bold));
    if (!font) { out.pending = true; out.fields.push({ field: f, text, pending: true }); continue; }
    if (!fallback) {
      for (const ch of text) { const cp = ch.codePointAt(0); if (cp > 32 && !font.has(cp)) { out.needFallback = true; break; } }
    }
    const fb = fallback && fallback !== font ? fallback : null;
    const lay = layoutField(text, f, f, font, fb);
    out.fields.push({ field: f, text, ...lay, font, fallback: fb, faux: needsFauxBold(f.font, f.bold) });
  }
  out.missing = [...missing];
  out.stamp = stampPlacement(doc, out.fields);
  return out;
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
    const line = pres.lines[pres.lines.length - 1];
    const last = line.chars[line.chars.length - 1];
    if (last) {
      cx = last.x + last.w + (st.dx || 0);
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
    s += `<g data-field="${res.field.id}" fill="${res.field.color || '#111'}"${faux}>${glyphPathsSvg(res)}</g>`;
  }
  return s;
}
