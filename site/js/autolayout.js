// 쎈스 어워드 — 자동 배치(상장 디자인 규칙)
//
// 실제 상장·표창장 4종(회사 상장, 학교 상장, 문체부·지경부 표창장)을 재어 얻은
// 요소별 세로 위치(용지 높이 비율, 요소 가운데 기준)의 대푯값:
//   상장번호 0.16 · 제목 0.27 · 받는 사람 줄 0.385 · 본문 0.465~0.635 · 날짜 0.77 · 수여자 0.865
// 받는 사람은 소속을 이름 위에 쌓고 둘 다 오른쪽 끝에 맞춘다(학교 상장의 '6학년 3반 / 김하늘' 꼴)
// 받는 사람 줄(0.385)과 본문 끝(0.635)이 황금비 분할점(0.382 / 0.618) 부근에 놓인다.
// 본문 너비는 용지의 약 2/3, 제목은 글자 수와 상관없이 용지 폭의 약 0.29를 차지한다.
//
// 위 비율은 기본 테두리의 글 영역(용지의 0.109~0.891)에 맞춰 글 영역 비율로 바꿔 쓴다.
// 그래서 1단계에서 테두리를 옮기면 상자 자리와 크기는 함께 따라오고, 글자 크기는 견본 용지 기준 그대로다.
//
// 글자 크기 규칙
//   - 제목이 가장 크다(글 영역 너비의 약 11%, 긴 상장명이면 너비에 맞춰 줄임)
//   - 본문은 위 정렬이고, 본문 시작(0.465)부터 날짜 바로 위까지를 채우는 가장 큰 크기(12pt~, 한 줄 16자 이상이 되는 크기까지).
//     글이 짧으면 커지고 많으면 작아진다. 15pt보다 작아지면 본문 시작을 조금 올려 다시 맞춘다
//   - 본문 ≤ 이름 ≤ 수여자 ≤ 제목. 날짜는 본문의 95%, 소속은 본문 크기(길면 칸에 맞춰 줄임)
//   - 다른 항목은 본문 크기에 비례하므로 본문이 커지면 함께 커진다(제목보다 커지지는 않음)
// 사용자가 직접 옮기거나 크기를 바꾼 칸(manual)은 건드리지 않는다.
import { contentRect, PAPER, BORDER_DEFAULT } from './papers.js';
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
const BASE_INSET = 32.5; // 기본 테두리의 글 영역 안쪽 거리(mm): 21 + 2.3 + 0.2 + 9
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
function textStats(doc, store, only) {
  const stats = {};
  const n = Math.max(1, doc.rows.length);
  const list = Number.isInteger(only) ? [only] : [...Array(n).keys()];
  for (const f of doc.fields) {
    const font = store ? store.get(variantKey(f.font, f.bold)) : null;
    let maxEm = 0;
    let maxPars = [0];
    for (const i of list) {
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

/**
 * 본문: 가장 긴 내용이 칸에 들어가는 가장 큰 글자(mm).
 * boxH(s) 는 글자 크기에 따라 달라지는 칸 높이(날짜와 띄울 간격이 글자 크기에 비례).
 */
function bodySize(pars, boxW, boxH, lineHeight, hiMm, loMm) {
  const lh = lineHeight / 100;
  for (let s = hiMm; s >= loMm; s -= PT / 2) {
    // 어절 단위 줄 나눔으로 줄 끝이 비는 것을 감안해 7% 여유
    const lines = pars.reduce((a, em) => a + Math.max(1, Math.ceil((em * s * 1.07) / boxW)), 0);
    const h = (lines - 1) * s * lh + s;
    if (h <= boxH(s)) return s;
  }
  return loMm;
}

/**
 * 자동 배치 계산. index 를 주면 그 상장 한 장의 글 길이로 계산한다(장마다 본문이 길이에 맞게 커지고 작아짐).
 * 반환: { fields: {id: {x,y,w,h,size,minSize}}, stamp: {size}, sizes }
 */
export function computeAutoLayout(doc, store, border, paper = PAPER, index) {
  const W = paper.w;
  const st = textStats(doc, store, index);
  const em = id => Math.max(st[id] ? st[id].maxEm : 0, 1);
  // 글 영역 하나에 대한 배치 기준: 세로 비율 → y, 본문 너비(기본 글 영역에서 용지의 2/3 = 글 영역의 95.6%)
  const geo = Cx => {
    const Yf = p => Cx.y + toContent(p) * Cx.h;
    const bwf = Cx.w * (W * REF_PAGE.bodyWidth) / (W - 2 * BASE_INSET);
    return { C: Cx, Y: Yf, bw: bwf, bx: Cx.x + (Cx.w - bwf) / 2, bottomFor: sz => Yf(REF_PAGE.date) - sz * 0.95 * 0.8 - sz * 1.1 };
  };
  // 글자 크기는 견본 용지(기본 테두리) 기준으로 정한다 → 1단계에서 여백을 바꿔도 글자 크기는 그대로.
  // 상자 자리와 크기는 지금 글 영역 기준 → 여백을 줄이면 상자만 오므라든다.
  const g0 = geo(contentRect(BORDER_DEFAULT, paper));
  const g = geo(contentRect(border, paper));
  const C = g.C, Y = g.Y, bw = g.bw, bx = g.bx;

  // --- 글자 크기(mm): 견본 용지 기준(g0)
  const T = Math.min(g0.C.w * 0.11, (g0.C.w * 0.92) / (em('title') * 1.08), (g0.Y(REF_PAGE.row) - g0.Y(REF_PAGE.number)) * 0.42);
  const bodyF = doc.fields.find(f => f.id === 'body');
  const lhBody = bodyF ? bodyF.lineHeight : 170;
  const pars = st.body ? st.body.pars : [1];
  // 본문은 위 정렬. 칸은 본문 시작(0.465)부터 날짜 바로 위까지 쓰고,
  // 그 공간을 채우는 가장 큰 글자를 고른다 → 글이 짧으면 글자가 커져 아래가 휑하게 비지 않는다.
  // 한 줄에 16자 이상(참고 상장 본문은 한 줄 16~18자) 들어가는 크기까지만 키운다.
  const hiB = Math.min(28 * PT, T * 0.62, g0.bw / 16);
  let topP = REF_PAGE.bodyTop;
  let B = bodySize(pars, g0.bw, sz => g0.bottomFor(sz) - g0.Y(topP), lhBody, hiB, 12 * PT);
  if (B < 15 * PT) {
    // 글이 아주 많으면 본문 시작을 받는 사람 줄 쪽으로 조금 올린다
    topP = 0.445;
    B = bodySize(pars, g0.bw, sz => g0.bottomFor(sz) - g0.Y(topP), lhBody, hiB, 11 * PT);
  }
  B = Math.min(B, T);
  // 수여자: 본문보다 조금 크게(참고 상장 평균 1.2배), 제목의 68% 이하, 한 줄에 들어가게
  let P = clamp(Math.min(B * 1.2, T * 0.68), B, T);
  P = clamp(Math.min(P, (g0.C.w * 0.92) / (em('presenter') * 1.06)), B, T);
  // 이름: 본문 이상, 수여자 이하. 받는 사람 줄의 오른쪽 절반에 들어가게(자간을 벌리므로 1.3배로 잰다)
  let N = clamp(Math.min(B * 1.08, T * 0.62), B, P);
  N = clamp(Math.min(N, (g0.bw * 0.62) / (em('name') * 1.3)), B * 0.8, P);
  // 소속(이름 위): 본문보다 살짝 작게, 이름 이하, 한 줄에 들어가게
  const A = clamp(Math.min(B * 0.92, (g0.bw * 0.62) / (em('affiliation') * 1.03)), B * 0.7, N);
  // 날짜: 본문보다 살짝 작게
  const D = clamp(B * 0.95, B * 0.85, P);
  const Num = clamp(B * 0.52, 9 * PT, 11 * PT);

  // --- 본문 칸: 지금 글 영역 기준(g)
  const bTop = Y(topP);
  const bBot = Math.max(bTop + B * 1.5, g.bottomFor(B));

  const out = {};
  const r = v => Math.round(v * 10) / 10;
  const put = (id, box, sizeMm, minRatio) => {
    const size = toPt(sizeMm);
    out[id] = { x: r(box.x), y: r(box.y), w: r(box.w), h: r(box.h), size, minSize: Math.max(6, Math.round(size * minRatio * 2) / 2) };
  };
  const centered = (cy, h) => cy - h / 2;

  // --- 자리
  put('number', { x: bx, y: Math.max(C.y, centered(Y(REF_PAGE.number), Num * 1.6)), w: bw * 0.5, h: Num * 1.6 }, Num, 0.8);
  const tW = clamp(em('title') * T * 1.08, C.w * (W * REF_PAGE.titleWidth) / (W - 2 * BASE_INSET), C.w);
  put('title', { x: C.x + (C.w - tW) / 2, y: centered(Y(REF_PAGE.title), T * 1.5), w: tW, h: T * 1.5 }, T, 0.7);
  // 받는 사람: 소속을 이름 바로 위에 두고 둘 다 본문 오른쪽 끝에 맞춘다. 이름이 받는 사람 줄(0.385)에 놓인다
  const rw = bw * 0.62;
  const nH = N * 1.55, aH = A * 1.5;
  const nY = centered(Y(REF_PAGE.row), nH);
  put('name', { x: bx + bw - rw, y: nY, w: rw, h: nH }, N, 0.7);
  put('affiliation', { x: bx + bw - rw, y: nY - aH - A * 0.15, w: rw, h: aH }, A, 0.7);
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

/**
 * 한 장의 칸 목록: 직접 손대지 않은 칸은 그 장의 글 길이에 맞춘 자동 배치를 쓴다.
 * 반환: { fields, stampSize }
 */
export function layoutForRecord(doc, store, border, index, paper = PAPER) {
  const res = computeAutoLayout(doc, store, border, paper, index);
  const fields = doc.fields.map(f => (f.manual || !res.fields[f.id]) ? f : { ...f, ...res.fields[f.id] });
  return { fields, stampSize: doc.stamp && doc.stamp.manual ? doc.stamp.size : res.stamp.size };
}

/** 직접 손대지 않은 칸에 자동 배치를 적용한다(index: 기준이 될 장, 화면에 보이는 장) */
export function applyAutoLayout(doc, store, border, paper = PAPER, index) {
  const res = computeAutoLayout(doc, store, border, paper, index);
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
