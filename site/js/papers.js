// 상장 용지: 시판 상장 용지(A4, 금색 이중 테두리) 하나만 쓴다.
// 테두리는 수치로 그리는 벡터라 1단계에서 미세 조정할 수 있고,
// 화면 미리보기 배경으로만 쓰며 인쇄에는 기본으로 넣지 않는다(빈 종이 인쇄용 선택 가능).

export const PAPER = { w: 210, h: 297, label: 'A4 세로 (210×297mm)' };
export const SIZES = { A4P: PAPER };

// 시판 기본값: 보내 준 용지 사진 비율 기준(테두리가 가장자리에서 약 21mm 안쪽)
export const BORDER_DEFAULT = {
  inset: 21,     // 용지 가장자리 → 굵은 선(mm)
  thick: 1.5,    // 굵은 선 두께(mm)
  gap: 2.3,      // 굵은 선 → 가는 선 간격(mm)
  thin: 0.4,     // 가는 선 두께(mm)
  notch: 5.2,    // 모서리 오목한 반지름(mm)
  ornOn: false,  // 모서리 장식 켜기(기본은 끔)
  ornType: 'vine', // 장식 종류: vine 덩굴 · flower 꽃 · leaf 잎 · dot 점
  ornament: 1,   // 장식 크기 배율
  color: '#d9a521',
  pad: 9,        // 가는 선 → 글 영역 안쪽 여백(mm)
};

export const BORDER_LIMITS = {
  inset: [8, 40, 0.5], thick: [0.2, 4, 0.1], gap: [0.5, 8, 0.1], thin: [0, 2, 0.05],
  notch: [0, 15, 0.2], ornament: [0.3, 2, 0.05], pad: [2, 30, 0.5],
};

export const ORNAMENT_TYPES = [
  { id: 'vine', name: '덩굴' }, { id: 'flower', name: '꽃' }, { id: 'leaf', name: '잎' }, { id: 'dot', name: '점' },
];

export function normBorder(b) {
  const o = { ...BORDER_DEFAULT, ...(b || {}) };
  o.ornOn = !!o.ornOn;
  if (!ORNAMENT_TYPES.some(t => t.id === o.ornType)) o.ornType = BORDER_DEFAULT.ornType;
  for (const [k, [lo, hi]] of Object.entries(BORDER_LIMITS)) {
    const v = Number(o[k]);
    o[k] = Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : BORDER_DEFAULT[k];
  }
  if (!/^#[0-9a-f]{6}$/i.test(o.color)) o.color = BORDER_DEFAULT.color;
  return o;
}

/** 글을 놓을 수 있는 영역(가는 선 안쪽 + 여백) */
export function contentRect(b, paper = PAPER) {
  const B = normBorder(b);
  const i = B.inset + B.gap + B.thin / 2 + B.pad;
  return { x: i, y: i, w: paper.w - 2 * i, h: paper.h - 2 * i };
}

const n2 = v => Math.round(v * 1000) / 1000;

// 모서리를 안으로 오목하게 판 사각형. 원의 중심은 굵은 선 꼭짓점.
function concavePath(paper, m, inset, rad) {
  const { w, h } = paper;
  const off = inset - m;
  const L = inset, T = inset, R = w - inset, B = h - inset;
  const cl = m, ct = m, cr = w - m, cb = h - m;
  if (rad <= off + 0.01) return `M${n2(L)} ${n2(T)} H${n2(R)} V${n2(B)} H${n2(L)} Z`;
  const k = Math.sqrt(rad * rad - off * off);
  return `M${n2(cl + k)} ${n2(T)} H${n2(cr - k)} A${n2(rad)} ${n2(rad)} 0 0 0 ${n2(R)} ${n2(ct + k)} V${n2(cb - k)} A${n2(rad)} ${n2(rad)} 0 0 0 ${n2(cr - k)} ${n2(B)} H${n2(cl + k)} A${n2(rad)} ${n2(rad)} 0 0 0 ${n2(L)} ${n2(cb - k)} V${n2(ct + k)} A${n2(rad)} ${n2(rad)} 0 0 0 ${n2(cl + k)} ${n2(T)} Z`;
}

// 모서리 덩굴: 왼쪽 위 모서리 기준(바깥이 -x,-y)으로 그린 뒤 뒤집어 네 모서리에 쓴다
function ornamentPath(r, s) {
  const p = (x, y) => `${n2(x * s)} ${n2(y * s)}`;
  const R = Math.max(r / s, 3.2);
  const A = `M${p(R, 0)} C${p(R - 1.8, 0)} ${p(R - 3.6, -0.6)} ${p(R - 4.3, -2.2)} C${p(R - 4.9, -3.6)} ${p(R - 3.8, -4.9)} ${p(R - 2.5, -4.6)} C${p(R - 1.3, -4.3)} ${p(R - 1.2, -2.8)} ${p(R - 2.2, -2.4)} C${p(R - 2.9, -2.1)} ${p(R - 3.5, -2.7)} ${p(R - 3.2, -3.2)}`;
  const B = A.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, '$2 $1');
  return `${A} ${B}`;
}

// 원을 베지어 4개로(좌표 쌍만 쓰므로 뒤집기·옮기기가 쉽다)
function circleD(cx, cy, r) {
  const k = 0.5523 * r;
  return `M${n2(cx + r)} ${n2(cy)} C${n2(cx + r)} ${n2(cy + k)} ${n2(cx + k)} ${n2(cy + r)} ${n2(cx)} ${n2(cy + r)} `
    + `C${n2(cx - k)} ${n2(cy + r)} ${n2(cx - r)} ${n2(cy + k)} ${n2(cx - r)} ${n2(cy)} `
    + `C${n2(cx - r)} ${n2(cy - k)} ${n2(cx - k)} ${n2(cy - r)} ${n2(cx)} ${n2(cy - r)} `
    + `C${n2(cx + k)} ${n2(cy - r)} ${n2(cx + r)} ${n2(cy - k)} ${n2(cx + r)} ${n2(cy)} Z`;
}
// 가운데(cx,cy)에서 각도 a 쪽으로 뻗은 꽃잎(물방울 모양)
function petalD(cx, cy, a, len, wid) {
  const ux = Math.cos(a), uy = Math.sin(a), px = -uy, py = ux;
  const tx = cx + ux * len, ty = cy + uy * len;
  const c1x = cx + ux * len * 0.35 + px * wid, c1y = cy + uy * len * 0.35 + py * wid;
  const c2x = cx + ux * len * 0.85 + px * wid * 0.6, c2y = cy + uy * len * 0.85 + py * wid * 0.6;
  const c3x = cx + ux * len * 0.85 - px * wid * 0.6, c3y = cy + uy * len * 0.85 - py * wid * 0.6;
  const c4x = cx + ux * len * 0.35 - px * wid, c4y = cy + uy * len * 0.35 - py * wid;
  return `M${n2(cx)} ${n2(cy)} C${n2(c1x)} ${n2(c1y)} ${n2(c2x)} ${n2(c2y)} ${n2(tx)} ${n2(ty)} C${n2(c3x)} ${n2(c3y)} ${n2(c4x)} ${n2(c4y)} ${n2(cx)} ${n2(cy)} Z`;
}

/** 장식 도형(왼쪽 위 모서리 기준, 바깥이 -x,-y). 선은 stroke, 면은 fill 로 */
function ornamentShapes(type, notch, s) {
  const D = Math.PI / 180;
  if (type === 'vine') return { stroke: ornamentPath(notch, s), fill: circleD(-0.9 * s, -0.9 * s, 0.6 * s) };
  // 오목한 모서리(꼭짓점을 중심으로 반지름 notch 만큼 비어 있음) 안쪽에 앉힌다
  const k = Math.max(0.6, notch * 0.22);
  if (type === 'dot') return { stroke: '', fill: circleD(k, k, 1.1 * s) };
  if (type === 'flower') {
    // 모서리 바깥쪽을 향한 네 잎 꽃
    const c = k;
    const petals = [45, 135, 225, 315].map(a => petalD(c, c, a * D, 2.4 * s, 0.95 * s)).join(' ');
    return { stroke: '', fill: `${petals} ${circleD(c, c, 0.55 * s)}` };
  }
  if (type === 'leaf') {
    // 모서리에서 바깥으로 부채꼴로 퍼지는 잎 세 장
    const b = Math.max(1.2, notch * 0.55);
    return { stroke: '', fill: [225, 192, 258].map((a, i) => petalD(b, b, a * D, (i ? 3.0 : 4.0) * s, (i ? 0.75 : 0.95) * s)).join(' ') };
  }
  return { stroke: '', fill: '' };
}

function transformPath(d, tx, ty, sx, sy) {
  // 절대 좌표(M/C/A 끝점) 쌍을 옮기고 뒤집는다. A 명령은 쓰지 않는 경로에만 사용.
  return d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (m, x, y) => `${n2(tx + sx * Number(x))} ${n2(ty + sy * Number(y))}`);
}

function shade(hex, t) {
  // t>0 이면 흰색 쪽으로 밝게
  const v = hex.replace('#', '');
  const c = [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16));
  return '#' + c.map(x => Math.round(x + (255 - x) * t).toString(16).padStart(2, '0')).join('');
}

/**
 * 테두리 도형 목록(mm, 위가 0). 미리보기 SVG와 PDF 벡터 출력이 같은 도형을 쓴다.
 * { d, stroke, width, fill, cap, main }
 */
export function borderShapes(b, paper = PAPER) {
  const B = normBorder(b);
  const { w, h } = paper;
  const m = B.inset;
  const out = [];
  out.push({ d: concavePath(paper, m, m, B.notch), stroke: B.color, width: B.thick, fill: null, main: true });
  if (B.thin > 0) {
    out.push({ d: concavePath(paper, m, m + B.gap, B.notch + B.gap), stroke: shade(B.color, 0.12), width: B.thin, fill: null });
  }
  if (B.ornOn) {
    const s = B.ornament;
    const orn = ornamentShapes(B.ornType, B.notch, s);
    for (const [x, y, sx, sy] of [[m, m, 1, 1], [w - m, m, -1, 1], [m, h - m, 1, -1], [w - m, h - m, -1, -1]]) {
      if (orn.stroke) out.push({ d: transformPath(orn.stroke, x, y, sx, sy), stroke: B.color, width: 0.65 * Math.max(0.6, s), fill: null, cap: 'round', main: true });
      if (orn.fill) out.push({ d: transformPath(orn.fill, x, y, sx, sy), stroke: null, width: 0, fill: B.color });
    }
  }
  return out;
}

/** 미리보기용 테두리 SVG(금박 느낌 그라데이션). guides=true 이면 글 영역을 점선으로 */
export function borderSvg(b, { paper = PAPER, guides = false, bg = true } = {}) {
  const B = normBorder(b);
  const { w, h } = paper;
  const grad = `<linearGradient id="gg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${w}" y2="${h}">`
    + `<stop offset="0" stop-color="${shade(B.color, 0.18)}"/><stop offset=".3" stop-color="${shade(B.color, 0.45)}"/>`
    + `<stop offset=".5" stop-color="${B.color}"/><stop offset=".75" stop-color="${shade(B.color, 0.3)}"/><stop offset="1" stop-color="${B.color}"/></linearGradient>`;
  const body = borderShapes(B, paper).map(s => s.fill
    ? `<path d="${s.d}" fill="${s.fill}"/>`
    : `<path d="${s.d}" fill="none" stroke="${s.main ? 'url(#gg)' : s.stroke}" stroke-width="${s.width}"${s.cap ? ' stroke-linecap="round"' : ''}/>`).join('');
  let g = '';
  if (guides) {
    const c = contentRect(B, paper);
    g = `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" fill="none" stroke="#7c5cf0" stroke-opacity=".6" stroke-width="0.3" stroke-dasharray="1.5 1"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}mm" height="${h}mm"><defs>${grad}</defs>${bg ? `<rect width="${w}" height="${h}" fill="#fdfdfb"/>` : ''}${body}${g}</svg>`;
}

// 칸 정의(글꼴·정렬 기본값). 위치·크기·글자 크기는 autolayout.js가 정한다.
export const FIELD_BASE = {
  font: 'chosun-gs', bold: false, color: '#111111',
  align: 'left', valign: 'middle', lineHeight: 160, maxLines: 1,
  scale: 100, minScale: 80, spacing: 0, minSpacing: -8,
  manual: false,
};

export const FIELD_DEFS = [
  { id: 'number', label: '상장번호', text: '제{{상장번호}}호', align: 'left' },
  { id: 'title', label: '상장명', text: '{{상장명}}', align: 'distribute' },
  { id: 'affiliation', label: '소속', text: '{{소속}}', align: 'right' },
  // 이름은 참고 상장처럼 자간을 벌려(박 연 우) 오른쪽 끝에 맞춘다
  { id: 'name', label: '이름', text: '{{이름}}', align: 'right', spacing: 25 },
  { id: 'body', label: '내용', text: '{{내용}}', align: 'justify', valign: 'top', lineHeight: 170, maxLines: 0 },
  { id: 'date', label: '날짜', text: '{{날짜}}', align: 'center' },
  // 수여자는 '직함 / 이름'처럼 두세 줄도 쓴다
  { id: 'presenter', label: '수여자', text: '{{수여자}}', align: 'center', lineHeight: 145, maxLines: 3 },
];

export function defaultFields() {
  // 자리값은 자동 배치가 곧바로 채운다
  return FIELD_DEFS.map(d => ({ ...FIELD_BASE, ...d, x: 30, y: 30, w: 100, h: 10, size: 16, minSize: 12 }));
}

export const SAMPLE = {
  columns: ['상장번호', '상장명', '소속', '이름', '내용', '날짜', '수여자'],
  rows: [
    ['2000-1771', '표창장', '3학년', '김웨스', ' 위 어린이는 평소 맡은 일에 책임을 다하고 친구들을 따뜻하게 배려하며, 창의적인 생각으로 즐거운 배움의 분위기를 만드는 데 앞장서 다른 어린이의 본보기가 되었으므로 이에 표창합니다.', '2026년 11월 21일', '웨스엔에스\n스튜디오'],
    ['2000-1772', '상장', '5학년 1반', '이도윤', ' 위 어린이는 독서 골든벨 대회에서 뛰어난 실력을 보여 최우수상을 받았으므로 이 상장을 주어 칭찬합니다.', '2026년 11월 21일', '웨스엔에스\n스튜디오'],
    ['2000-1773', '상장', '4학년 2반 발표회 사회자', '남궁서연비', ' 위 어린이는 학예 발표회에서 사회를 맡아 차분하고 재치 있는 진행으로 행사를 훌륭히 이끌었고, 준비 과정에서도 친구들의 의견을 귀 기울여 듣고 서로 돕도록 이끌어 모두가 함께 즐기는 무대를 만드는 데 크게 이바지하였으므로 이 상장을 주어 칭찬합니다.', '2026년 11월 21일', '웨스엔에스\n스튜디오'],
  ],
};
