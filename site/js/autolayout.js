// 쎈스 어워드 — 자동 배치(상장 디자인 규칙)
//
// 실제 상장·표창장 4종(회사 상장, 학교 상장, 문체부·지경부 표창장)을 재어 얻은
// 요소별 세로 위치(용지 높이 비율, 요소 가운데 기준)의 대푯값:
//   상장번호 0.16 · 제목 0.27 · 받는 사람 줄 0.385 · 본문 0.465~0.635 · 날짜 0.77 · 수여자 0.865
// 받는 사람 줄(0.385)과 본문 끝(0.635)이 황금비 분할점(0.382 / 0.618) 부근에 놓인다.
// 본문 너비는 용지의 약 2/3, 제목은 글자 수와 상관없이 용지 폭의 약 0.29를 차지한다.
//
// 위 비율은 기본 테두리의 글 영역(용지의 0.109~0.891)에 맞춰 글 영역 비율로 바꿔 쓴다.
// 그래서 1단계에서 테두리를 옮기면 배치도 함께 따라온다.
//
// 글자 크기 규칙
//   - 제목이 가장 크다(글 영역 너비의 약 11%, 긴 상장명이면 너비에 맞춰 줄임)
//   - 본문은 가장 긴 내용이 본문 칸에 다 들어가는 가장 큰 크기(12~22pt).
//     글이 많아 16pt보다 작아지면 본문 칸을 위아래로 넓힌 뒤 다시 맞춘다
//   - 본문 ≤ 이름 ≤ 수여자 ≤ 제목. 날짜는 본문의 95%, 소속은 본문 크기(길면 칸에 맞춰 줄임)
// 사용자가 직접 옮기거나 크기를 바꾼 칸(manual)은 건드리지 않는다.
import { contentRect, PAPER } from './papers.js';
import { fillTemplate } from './data.js';
import { variantKey } from './fonts.js';

export const PHI = (1 + Math.sqrt(5)) / 2;
const PT = 25.4 / 72;       // 1pt = 0.3528mm
const toPt = mm => Math.round((mm / PT) * 2) / 2;   // 0.5pt 단위
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// 참고 상장에서 잰 용지 높이 비율
export const REF_PAGE = {
  number: 0.16, title: 0.27, row: 0.385,
  bodyTop: 0.465, bodyBottom: 0.635, date: 0.77, presenter: 0.865,
  bodyWidth: 0.66, titleWidth: 0.29,
};
// 기본 테두리의 글 영역 위아래(용지 비율)
const BASE_TOP = 0.1094, BASE_BOTTOM = 0.8906;
const toContent = p => (p - BASE_TOP) / (BASE_BOTTOM - BASE_TOP);

/** 글 너비를 em 단위로(글꼴이 아직 없으면 한글 1, 그 밖 0.55로 어림) */
function emWidth(text, font) {
  let w = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (font) w += font.adv(cp);
    else w += (cp >= 0x1100 && cp <= 0xD7FF) || cp >= 0x3000 ? 1 : 0.55;
  }
  return w;
}

/** 명단 전체에서 칸별로 가장 긴 글의 길이(em)와 문단 목록 */
function textStats(doc, store) {
  const stats = {};
  const n = Math.max(1, doc.rows.length);
  for (const f of doc.fields) {
    const font = store ? store.get(variantKey(f.font, f.bold)) : null;
    let maxEm = 0;
    let maxPars = [0];
    for (let i = 0; i < n; i++) {
      const ov = doc.overrides && doc.overrides[i] ? doc.overrides[i][f.id] : undefined;
      const text = typeof ov === 'string' ? ov : fillTemplate(f.text, doc.columns, doc.rows[i] || [], i).text;
      const pars = text.split(/\r?\n/);
      const em = pars.reduce((a, p) => a + emWidth(p, font), 0);
      if (em > maxEm) { maxEm = em; maxPars = pars.map(p => emWidth(p, font)); }
    }
    stats[f.id] = { maxEm, pars: maxPars };
  }
  return stats;
}

/** 본문: 가장 긴 내용이 칸에 들어가는 가장 큰 글자(mm) */
function bodySize(pars, boxW, boxH, lineHeight, hiMm, loMm) {
  const lh = lineHeight / 100;
  for (let s = hiMm; s >= loMm; s -= PT / 2) {
    // 어절 단위 줄 나눔으로 줄 끝이 비는 것을 감안해 7% 여유
    const lines = pars.reduce((a, em) => a + Math.max(1, Math.ceil((em * s * 1.07) / boxW)), 0);
    const h = (lines - 1) * s * lh + s;
    if (h <= boxH) return s;
  }
  return loMm;
}

/**
 * 자동 배치 계산. 반환: { fields: {id: {x,y,w,h,size,minSize}}, stamp: {size}, sizes }
 */
export function computeAutoLayout(doc, store, border, paper = PAPER) {
  const C = contentRect(border, paper);
  const W = paper.w;
  const st = textStats(doc, store);
  const em = id => Math.max(st[id] ? st[id].maxEm : 0, 1);
  const Y = p => C.y + toContent(p) * C.h; // 용지 비율 → 지금 글 영역의 y(mm)

  // 본문 너비: 용지의 2/3, 글 영역을 넘지 않게
  const bw = Math.min(C.w, W * REF_PAGE.bodyWidth);
  const bx = (W - bw) / 2;

  // --- 글자 크기(mm)
  const T = Math.min(C.w * 0.11, (C.w * 0.92) / (em('title') * 1.08), (Y(REF_PAGE.row) - Y(REF_PAGE.number)) * 0.42);
  const bodyF = doc.fields.find(f => f.id === 'body');
  const lhBody = bodyF ? bodyF.lineHeight : 170;
  const pars = st.body ? st.body.pars : [1];
  let bTop = Y(REF_PAGE.bodyTop), bBot = Y(REF_PAGE.bodyBottom);
  let B = bodySize(pars, bw, bBot - bTop, lhBody, Math.min(22 * PT, T * 0.55), 12 * PT);
  if (B < 16 * PT) {
    // 글이 많으면 본문 칸을 위아래로 넓힌다(받는 사람 줄·날짜와는 띄운 채로)
    bTop = Y(0.44); bBot = Y(0.715);
    B = bodySize(pars, bw, bBot - bTop, lhBody, Math.min(22 * PT, T * 0.55), 11 * PT);
  }
  B = Math.min(B, T);
  // 수여자: 본문보다 조금 크게(참고 상장 평균 1.2배), 제목 이하, 한 줄에 들어가게
  let P = clamp(B * 1.2, B, T);
  P = clamp(Math.min(P, (C.w * 0.92) / (em('presenter') * 1.06)), B, T);
  // 이름: 본문 이상, 수여자 이하. 받는 사람 줄의 오른쪽 절반에 들어가게(자간을 벌리므로 1.3배로 잰다)
  let N = clamp(B * 1.08, B, P);
  N = clamp(Math.min(N, ((bw - 2) / 2) / (em('name') * 1.3)), B * 0.8, P);
  // 소속(받는 사람 줄 왼쪽): 본문 크기, 이름 이하
  const A = clamp(Math.min(B, ((bw - 2) / 2) / (em('affiliation') * 1.03)), B * 0.7, N);
  // 날짜: 본문보다 살짝 작게
  const D = clamp(B * 0.95, B * 0.85, P);
  const Num = clamp(B * 0.52, 9 * PT, 11 * PT);

  const out = {};
  const r = v => Math.round(v * 10) / 10;
  const put = (id, box, sizeMm, minRatio) => {
    const size = toPt(sizeMm);
    out[id] = { x: r(box.x), y: r(box.y), w: r(box.w), h: r(box.h), size, minSize: Math.max(6, Math.round(size * minRatio * 2) / 2) };
  };
  const centered = (cy, h) => cy - h / 2;

  // --- 자리
  put('number', { x: bx, y: Math.max(C.y, centered(Y(REF_PAGE.number), Num * 1.6)), w: bw * 0.5, h: Num * 1.6 }, Num, 0.8);
  const tW = clamp(em('title') * T * 1.08, W * REF_PAGE.titleWidth, C.w);
  put('title', { x: (W - tW) / 2, y: centered(Y(REF_PAGE.title), T * 1.5), w: tW, h: T * 1.5 }, T, 0.7);
  const rowH = Math.max(A, N) * 1.55;
  const rowY = centered(Y(REF_PAGE.row), rowH);
  // 받는 사람 줄: 왼쪽 절반은 소속(부문), 오른쪽 절반은 이름. 가운데 2mm 띄움
  const half = (bw - 2) / 2;
  put('affiliation', { x: bx, y: rowY, w: half, h: rowH }, A, 0.7);
  put('name', { x: bx + half + 2, y: rowY, w: half, h: rowH }, N, 0.7);
  put('body', { x: bx, y: bTop, w: bw, h: bBot - bTop }, B, 0.8);
  put('date', { x: bx, y: centered(Y(REF_PAGE.date), D * 1.6), w: bw, h: D * 1.6 }, D, 0.75);
  const pH = P * 1.6;
  const pY = Math.min(centered(Y(REF_PAGE.presenter), pH), C.y + C.h - pH);
  put('presenter', { x: bx, y: pY, w: bw, h: pH }, P, 0.7);

  return {
    fields: out,
    stamp: { size: Math.round(clamp(P * 2.0, 14, 24) * 2) / 2 },
    sizes: { title: toPt(T), presenter: toPt(P), name: toPt(N), affiliation: toPt(A), date: toPt(D), body: toPt(B), number: toPt(Num) },
  };
}

/** 직접 손대지 않은 칸에 자동 배치를 적용한다 */
export function applyAutoLayout(doc, store, border, paper = PAPER) {
  const res = computeAutoLayout(doc, store, border, paper);
  let changed = false;
  for (const f of doc.fields) {
    if (f.manual) continue;
    const a = res.fields[f.id];
    if (!a) continue;
    for (const k of ['x', 'y', 'w', 'h', 'size', 'minSize']) {
      if (f[k] !== a[k]) { f[k] = a[k]; changed = true; }
    }
  }
  if (doc.stamp && !doc.stamp.manual && doc.stamp.size !== res.stamp.size) { doc.stamp.size = res.stamp.size; changed = true; }
  return { changed, res };
}
