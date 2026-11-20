// 쎈스 어워드 — 자동 배치(상장 디자인 규칙)
//
// 기준: 참고 상장·표창장 4종을 '테두리 안쪽 틀' 기준으로 다시 잰 값.
//   (용지 전체 비율을 글 영역에 욱여넣으면 수여자가 바닥 테두리에 붙는다 → 틀 기준으로 잰다)
//   틀 안쪽 높이 비율(가운데 기준) 평균: 제목 0.18 · 받는 사람 0.34 · 본문 시작 0.45 · 날짜 0.72 · 수여자 0.85
//   수여자 아래 빈 곳은 틀 높이의 12~14%(30~38mm), 위쪽 빈 곳(틀→제목 윗선)과 비슷하게 둔다.
//
// 세로 리듬(견본 용지, mm): 글 영역 32.5~264.5
//   상장번호 윗선 33 · 제목 가운데 64 · 이름 가운데 99(소속은 그 위) · 본문 116~ · 날짜 205 · 수여자 234
//   → 위·아래 여백이 맞물려 무게중심이 용지 가운데(광학 중심)에 온다.
//   이 값은 글 영역 비율로 바꿔 써서 1단계에서 테두리·여백을 바꾸면 자리도 따라간다(글자 크기는 그대로).
//
// 글자 크기 규칙(참고 상장 실측: 제목 36~44pt, 본문 18~22pt, 수여자 본문의 1.2~1.4배, 호수 10~14pt)
//   - 제목이 가장 크다(글 영역 너비의 약 11%). 글자 수에 따라 자간을 넓혀 폭을 정한다(2자 '상 장'은 넓게, 4자 이상은 좁게)
//   - 본문은 위 정렬. 본문 시작부터 날짜 위까지를 채우는 가장 큰 크기(13~24pt).
//     최대 크기에 걸려도 공간이 남으면 본문 덩어리를 그 공간의 가운데 쪽으로 내려 위아래 숨을 맞춘다.
//     아주 길면 본문 시작을 이름 아래까지 올린다.
//   - 본문 ≤ 이름 ≤ 수여자 ≤ 제목 × 0.62. 날짜는 본문 비슷하게(수여자의 85% 이하), 호수는 본문의 0.66배(12~14.5pt)
//   - 다른 항목은 본문 크기를 따라 커지고 작아진다(바닥값이 있어 너무 작아지지 않음)
//   - 수여자가 두 줄(예: 직함 / 이름)이면 그만큼 칸을 키우되 아래 여백은 지킨다
// 사용자가 직접 옮기거나 크기를 바꾼 칸(manual)은 건드리지 않는다.
import { contentRect, PAPER, BORDER_DEFAULT } from './papers.js';
import { fillTemplate } from './data.js';
import { variantKey } from './fonts.js';

export const PHI = (1 + Math.sqrt(5)) / 2;
const PT = 25.4 / 72;       // 1pt = 0.3528mm
const toPt = mm => Math.round((mm / PT) * 2) / 2;   // 0.5pt 단위
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// 견본 용지(기본 테두리)에서 정한 세로 자리(mm). 글 영역(32.5~264.5) 비율로 바꿔 쓴다.
const BASE = { top: 32.5, bottom: 264.5 };
const REF_MM = { number: 33, title: 64, name: 99, bodyTop: 116, date: 205, presenter: 234 };
const toContent = mm => (mm - BASE.top) / (BASE.bottom - BASE.top);
export const REF_PAGE = Object.fromEntries(Object.entries(REF_MM).map(([k, v]) => [k, v / 297]));
const BODY_WIDTH = 0.955;   // 글 영역 너비 중 본문 폭

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

/** 본문 줄 수 어림(어절 줄 나눔으로 줄 끝이 비는 것을 감안해 7% 여유) */
const lineCount = (pars, s, boxW) => pars.reduce((a, em) => a + Math.max(1, Math.ceil((em * s * 1.07) / boxW)), 0);
const blockH = (lines, s, lh) => (lines - 1) * s * lh + s;

/** 본문: 가장 긴 내용이 칸에 들어가는 가장 큰 글자(mm) */
function bodySize(pars, boxW, boxH, lineHeight, hiMm, loMm) {
  const lh = lineHeight / 100;
  for (let s = hiMm; s >= loMm; s -= PT / 2) {
    if (blockH(lineCount(pars, s, boxW), s, lh) <= boxH(s)) return s;
  }
  return loMm;
}

/** 제목 폭: 글자 수가 적을수록 자간을 넓힌다(균등 배분으로 채움) */
function titleWidth(n, T) {
  const gap = n <= 1 ? 0 : n === 2 ? 1.7 : n === 3 ? 0.95 : n === 4 ? 0.55 : 0.2;
  return T * (n + (n - 1) * gap);
}

/**
 * 자동 배치 계산. index 를 주면 그 상장 한 장의 글 길이로 계산한다(장마다 본문이 길이에 맞게 커지고 작아짐).
 * 반환: { fields: {id: {x,y,w,h,size,minSize}}, stamp: {size}, sizes }
 */
export function computeAutoLayout(doc, store, border, paper = PAPER, index) {
  const st = textStats(doc, store, index);
  const em = id => Math.max(st[id] ? st[id].maxEm : 0, 1);
  const lineN = id => (st[id] && st[id].pars ? st[id].pars.filter(x => x > 0).length : 1) || 1;
  // 글 영역 하나에 대한 배치 기준
  const geo = Cx => {
    const Yf = mm => Cx.y + toContent(mm) * Cx.h;
    const bwf = Cx.w * BODY_WIDTH;
    return { C: Cx, Y: Yf, k: Cx.h / (BASE.bottom - BASE.top), bw: bwf, bx: Cx.x + (Cx.w - bwf) / 2 };
  };
  // 글자 크기는 견본 용지 기준(g0) → 1단계에서 여백을 바꿔도 글자 크기는 그대로. 자리는 지금 글 영역(g) 기준
  const g0 = geo(contentRect(BORDER_DEFAULT, paper));
  const g = geo(contentRect(border, paper));
  const C = g.C, Y = g.Y, bw = g.bw, bx = g.bx;
  const titleChars = Math.max(1, Math.round(em('title')));

  // --- 글자 크기(mm)
  // 제목: 글 영역 너비의 11%, 글자 수에 맞춘 폭이 글 영역의 92%를 넘지 않게
  const T = Math.min(g0.C.w * 0.11, (g0.C.w * 0.92) / Math.max(em('title') * 1.05, titleWidth(titleChars, 1)));
  const bodyF = doc.fields.find(f => f.id === 'body');
  const lh = (bodyF ? bodyF.lineHeight : 170) / 100;
  const pars = st.body ? st.body.pars : [1];
  // 본문 칸 아래 끝: 날짜 윗선에서 본문 글자 2줄만큼 띈다
  const dateTop0 = g0.Y(REF_MM.date) - 0.8 * 13 * PT;
  const room = (top, s) => dateTop0 - s * 1.9 - top;
  const hiB = Math.min(24 * PT, T * 0.55, g0.bw / 15);
  let top0 = g0.Y(REF_MM.bodyTop);
  let B = bodySize(pars, g0.bw, s => room(top0, s), lh * 100, hiB, 13 * PT);
  if (B < 15 * PT) {
    // 아주 길면 본문 시작을 이름 바로 아래까지 올려 다시 맞춘다
    top0 = g0.Y(REF_MM.name) + 9;
    B = bodySize(pars, g0.bw, s => room(top0, s), lh * 100, hiB, 11 * PT);
  }
  B = Math.min(B, T);
  const Pmax = T * 0.62;
  // 수여자: 본문의 1.25배(바닥 18pt), 제목의 62% 이하, 한 줄에 들어가게
  let P = clamp(Math.max(B * 1.25, 18 * PT), B, Pmax);
  P = Math.max(B, Math.min(P, (g0.bw * 0.95) / (Math.max(...(st.presenter ? st.presenter.pars : [1]), 1) * 1.06)));
  // 이름: 본문의 1.12배(바닥 17pt), 수여자 이하. 자간을 벌리므로 1.3배로 재서 칸(본문 폭의 62%)에 들어가게
  let N = clamp(Math.max(B * 1.12, 17 * PT), B, P);
  N = clamp(Math.min(N, (g0.bw * 0.62) / (em('name') * 1.3)), B * 0.8, P);
  // 소속(이름 위): 본문의 0.92배(바닥 14pt), 이름 이하
  const A = clamp(Math.min(Math.max(B * 0.92, 14 * PT), (g0.bw * 0.62) / (em('affiliation') * 1.03)), B * 0.7, N);
  // 날짜: 본문과 비슷하게, 수여자의 85% 이하
  const D = clamp(Math.max(B * 0.95, 14 * PT), 12 * PT, P * 0.85);
  // 호수: 본문의 0.66배, 12~14.5pt
  const Num = clamp(B * 0.66, 12 * PT, 14.5 * PT);

  const out = {};
  const r = v => Math.round(v * 10) / 10;
  const put = (id, box, sizeMm, minRatio) => {
    const size = toPt(sizeMm);
    out[id] = { x: r(box.x), y: r(box.y), w: r(box.w), h: r(box.h), size, minSize: Math.max(6, Math.round(size * minRatio * 2) / 2) };
  };
  const centered = (cy, h) => cy - h / 2;

  // --- 머리: 호수, 제목
  const numH = Num * 1.6;
  put('number', { x: bx, y: Math.max(C.y, Y(REF_MM.number)), w: bw * 0.6, h: numH }, Num, 0.8);
  const tW = clamp(Math.max(titleWidth(titleChars, T), em('title') * T * 1.05), Math.min(C.w, T * 3), C.w * 0.92);
  const tH = T * 1.5;
  put('title', { x: C.x + (C.w - tW) / 2, y: Math.max(C.y + numH + 2, centered(Y(REF_MM.title), tH)), w: tW, h: tH }, T, 0.7);

  // --- 받는 사람: 소속을 이름 바로 위에, 둘 다 본문 오른쪽 끝에 맞춘다
  const rw = bw * 0.62;
  const nH = N * 1.55, aH = A * 1.5;
  const nY = centered(Y(REF_MM.name), nH);
  put('name', { x: bx + bw - rw, y: nY, w: rw, h: nH }, N, 0.7);
  put('affiliation', { x: bx + bw - rw, y: nY - aH - A * 0.1, w: rw, h: aH }, A, 0.7);

  // --- 꼬리: 날짜, 수여자(두 줄이면 칸을 키우되 아래 여백은 지킨다)
  const pLines = Math.min(3, lineN('presenter'));
  const pH = P * (1.6 + (pLines - 1) * 1.5);
  const pMaxBottom = C.y + C.h - 12 * g.k;          // 글 영역 아래 끝에서 12mm는 늘 비워 둔다
  const pY = Math.min(centered(Y(REF_MM.presenter), pH), pMaxBottom - pH);
  put('presenter', { x: bx, y: pY, w: bw, h: pH }, P, 0.7);
  const dH = D * 1.6;
  const dY = Math.min(centered(Y(REF_MM.date), dH), pY - dH - P * 0.9);
  put('date', { x: bx, y: dY, w: bw, h: dH }, D, 0.75);

  // --- 본문: 위 정렬. 크기가 최대에 걸려 공간이 남으면 덩어리를 아래로 내려(남는 공간의 40%) 위아래 숨을 맞춘다
  const ratio = g.k;
  let bTop = g.C.y + (top0 - g0.C.y) * ratio;
  const bBot = Math.max(bTop + B * 1.5, dY - B * 1.9);
  const used = blockH(lineCount(pars, B, g0.bw), B, lh) * ratio;
  const spare = (bBot - bTop) - used;
  if (spare > 0) bTop += Math.min(spare * 0.4, 14 * ratio);
  put('body', { x: bx, y: bTop, w: bw, h: Math.max(B * 1.5, bBot - bTop) }, B, 0.8);

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
