// 쎈스 어워드 — 자동 배치(상장 디자인 규칙)
//
// 1) 글 영역(테두리 안쪽 여백까지 뺀 사각형)을 황금비로 나눈다.
//    머리(상장번호·제목·소속·이름) : 아래(본문·날짜·수여자) = 0.382 : 0.618
//    아래 영역은 다시 본문 : 맺음(날짜·수여자) = 0.618 : 0.382
// 2) 글자 크기는 명단 전체에서 가장 긴 글을 기준으로 정한다.
//    - 제목이 가장 크다(글 영역 너비의 약 10.5%, 긴 상장명이면 너비에 맞춰 줄임)
//    - 본문은 가장 긴 내용이 본문 칸에 다 들어가는 가장 큰 크기(최대 20pt, 최소 11pt)
//      → 글이 많을수록 작아진다
//    - 본문 ≤ 날짜·소속 ≤ 이름 ≤ 수여자 ≤ 제목 순서를 지킨다
// 3) 사용자가 직접 옮기거나 크기를 바꾼 칸(manual)은 건드리지 않는다.
import { contentRect, PAPER } from './papers.js';
import { fillTemplate } from './data.js';
import { variantKey } from './fonts.js';

export const PHI = (1 + Math.sqrt(5)) / 2;
const G = 1 / PHI;          // 0.618
const g = 1 - G;            // 0.382
const PT = 25.4 / 72;       // 1pt = 0.3528mm
const toPt = mm => Math.round((mm / PT) * 2) / 2;   // 0.5pt 단위
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

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
    let maxPars = [''];
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
    // 어절 단위 줄 나눔으로 줄 끝이 비는 것을 감안해 6% 여유
    const lines = pars.reduce((a, em) => a + Math.max(1, Math.ceil((em * s * 1.06) / boxW)), 0);
    const h = (lines - 1) * s * lh + s;
    if (h <= boxH * 0.94) return s;
  }
  return loMm;
}

/**
 * 자동 배치 계산. 반환: { fields: {id: {x,y,w,h,size,minSize}}, stamp: {size}, areas }
 */
export function computeAutoLayout(doc, store, border, paper = PAPER) {
  const C = contentRect(border, paper);
  const st = textStats(doc, store);
  const head = C.h * g;              // 머리 영역
  const lower = C.h - head;          // 아래 영역
  const bodyArea = lower * G;        // 본문 영역
  const foot = lower - bodyArea;     // 맺음 영역
  const em = id => Math.max(st[id] ? st[id].maxEm : 0, 1);

  // --- 글자 크기(mm)
  const titleW = C.w * G;
  let T = Math.min(C.w * 0.105, head * 0.3, (C.w * 0.92) / (em('title') * 1.08));
  // 본문 칸
  const gapTop = 0; // 본문 위 여백은 아래에서 본문 크기로 정한다
  const bodyF = doc.fields.find(f => f.id === 'body');
  const lhBody = bodyF ? bodyF.lineHeight : 190;
  let B = bodySize(st.body ? st.body.pars : [1], C.w, bodyArea * 0.92, lhBody, Math.min(T * 0.5, 20 * PT), 11 * PT);
  B = Math.min(B, T);
  // 수여자: 본문 이상, 제목 이하. 둘 사이의 약 30% 지점, 한 줄에 들어가게
  let P = clamp(B + (T - B) * 0.27, B, T);
  P = clamp(Math.min(P, (C.w * 0.9) / (em('presenter') * 1.06)), B, T);
  // 이름: 본문 이상, 수여자 이하
  let N = clamp(B + (T - B) * 0.22, B, P);
  N = clamp(Math.min(N, (C.w * G) / (em('name') * 1.04)), B, P);
  // 소속·날짜: 본문보다 살짝 작게(본문의 90%), 이름 이하
  let A = clamp(Math.min(B * 0.92, (C.w * G) / (em('affiliation') * 1.03)), B * 0.75, N);
  let D = clamp(B * 0.92, B * 0.8, P);
  const Num = clamp(B * 0.6, 8.5 * PT, 11 * PT);

  const out = {};
  const put = (id, box, sizeMm, minRatio) => {
    const size = toPt(sizeMm);
    out[id] = { ...box, size, minSize: Math.max(6, Math.round(size * minRatio * 2) / 2) };
  };
  const r = v => Math.round(v * 10) / 10;

  // --- 자리
  // 상장번호: 왼쪽 위
  put('number', { x: r(C.x), y: r(C.y), w: r(C.w * g + C.w * g * g), h: r(Num * 1.6) }, Num, 0.8);
  // 제목: 가운데, 머리 영역의 0.382 지점에 중심
  const tW = clamp(em('title') * T * 2.1, C.w * 0.45, Math.max(titleW, em('title') * T * 1.08));
  const tH = T * 1.5;
  const tCy = C.y + head * g + Num * 0.6;
  put('title', { x: r(C.x + (C.w - Math.min(tW, C.w)) / 2), y: r(tCy - tH / 2), w: r(Math.min(tW, C.w)), h: r(tH) }, T, 0.7);
  // 소속·이름: 오른쪽, 머리 영역 바닥에 붙여서
  const rw = C.w * G;
  const nH = N * 1.5, aH = A * 1.5;
  const nY = C.y + head - nH - B * 0.2;
  const aY = nY - aH - A * 0.25;
  put('name', { x: r(C.x + C.w - rw), y: r(nY), w: r(rw), h: r(nH) }, N, 0.7);
  put('affiliation', { x: r(C.x + C.w - rw), y: r(aY), w: r(rw), h: r(aH) }, A, 0.7);
  // 본문: 아래 영역의 0.618
  const bTop = C.y + head + B * 0.9;
  put('body', { x: r(C.x), y: r(bTop), w: r(C.w), h: r(C.y + head + bodyArea - bTop) }, B, 0.8);
  // 맺음: 날짜는 맺음 영역 위쪽, 수여자는 맺음 영역의 0.618 지점
  const fTop = C.y + head + bodyArea;
  const dH = D * 1.6;
  put('date', { x: r(C.x), y: r(fTop + foot * g * 0.4), w: r(C.w), h: r(dH) }, D, 0.75);
  const pH = P * 1.6;
  const pCy = Math.min(fTop + foot * G, C.y + C.h - pH / 2);
  put('presenter', { x: r(C.x), y: r(pCy - pH / 2), w: r(C.w), h: r(pH) }, P, 0.7);

  return {
    fields: out,
    stamp: { size: Math.round(clamp(P * 2.2, 14, 24) * 2) / 2 },
    areas: { content: C, head, bodyArea, foot },
    sizes: { title: toPt(T), presenter: toPt(P), name: toPt(N), affiliation: toPt(A), date: toPt(D), body: toPt(B), number: toPt(Num) },
  };
}

/** 직접 손대지 않은 칸에 자동 배치를 적용한다. 바뀐 것이 있으면 true */
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
