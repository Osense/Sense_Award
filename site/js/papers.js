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
  ornament: 1,   // 모서리 덩굴 장식 크기 배율(0이면 없음)
  color: '#d9a521',
  pad: 9,        // 가는 선 → 글 영역 안쪽 여백(mm)
};

export const BORDER_LIMITS = {
  inset: [8, 40, 0.5], thick: [0.2, 4, 0.1], gap: [0.5, 8, 0.1], thin: [0, 2, 0.05],
  notch: [0, 15, 0.2], ornament: [0, 2, 0.05], pad: [2, 30, 0.5],
};

export function normBorder(b) {
  const o = { ...BORDER_DEFAULT, ...(b || {}) };
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
  if (B.ornament > 0) {
    const s = B.ornament;
    const base = ornamentPath(B.notch, s);
    for (const [x, y, sx, sy] of [[m, m, 1, 1], [w - m, m, -1, 1], [m, h - m, 1, -1], [w - m, h - m, -1, -1]]) {
      out.push({ d: transformPath(base, x, y, sx, sy), stroke: B.color, width: 0.65 * Math.max(0.6, s), fill: null, cap: 'round', main: true });
      const r = 0.6 * s;
      const cx = x - sx * 0.9 * s, cy = y - sy * 0.9 * s;
      out.push({ d: `M${n2(cx - r)} ${n2(cy)} A${n2(r)} ${n2(r)} 0 1 0 ${n2(cx + r)} ${n2(cy)} A${n2(r)} ${n2(r)} 0 1 0 ${n2(cx - r)} ${n2(cy)} Z`, stroke: null, width: 0, fill: B.color });
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
const base = {
  font: 'chosun-gs', bold: false, color: '#111111',
  align: 'left', valign: 'middle', lineHeight: 160, maxLines: 1,
  scale: 100, minScale: 80, spacing: 0, minSpacing: -8,
  manual: false,
};

export const FIELD_DEFS = [
  { id: 'number', label: '상장번호', text: '제 {{상장번호}} 호', align: 'left' },
  { id: 'title', label: '상장명', text: '{{상장명}}', align: 'distribute' },
  { id: 'affiliation', label: '소속', text: '{{소속}}', align: 'right' },
  { id: 'name', label: '이름', text: '{{이름}}', align: 'right' },
  { id: 'body', label: '내용', text: '{{내용}}', align: 'justify', valign: 'middle', lineHeight: 190, maxLines: 0 },
  { id: 'date', label: '날짜', text: '{{날짜}}', align: 'center' },
  { id: 'presenter', label: '수여자', text: '{{수여자}}', align: 'center' },
];

export function defaultFields() {
  // 자리값은 자동 배치가 곧바로 채운다
  return FIELD_DEFS.map(d => ({ ...base, ...d, x: 30, y: 30, w: 100, h: 10, size: 16, minSize: 12 }));
}

export const SAMPLE = {
  columns: ['상장번호', '상장명', '소속', '이름', '내용', '날짜', '수여자'],
  rows: [
    ['2026-001', '상장', '6학년 3반', '김하늘', '위 어린이는 2026 한울 예술제 독서 골든벨 대회에서 뛰어난 실력을 보여 최우수상을 받았으므로 이 상장을 주어 칭찬합니다.', '2026년 11월 20일', '한울초등학교장'],
    ['2026-002', '표창장', '5학년 1반', '이도윤', '위 어린이는 평소 학교생활에 모범이 되며 친구들을 배려하는 마음으로 학급 일에 앞장서 다른 어린이의 본보기가 되었고, 특히 한 해 동안 꾸준히 봉사 활동에 참여하여 학교를 아름답게 가꾸는 데 크게 이바지하였으므로 이 표창장을 주어 칭찬합니다.', '2026년 11월 20일', '한울초등학교장'],
    ['2026-003', '상장', '4학년 2반 다꿈 발표회 사회자', '남궁서연비', '위 어린이는 다꿈 발표회에서 사회를 맡아 행사를 훌륭히 이끌었으므로 이 상장을 줍니다.', '2026년 11월 20일', '한울초등학교장'],
  ],
};
