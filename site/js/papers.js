// 견본 용지(미리보기 전용 배경)와 용지별 기본 배치
// 배경 그림은 화면에서만 보이고 PDF·HWPX 인쇄 결과에는 들어가지 않는다.

export const SIZES = {
  A4P: { w: 210, h: 297, label: 'A4 세로' },
  A4L: { w: 297, h: 210, label: 'A4 가로' },
  B5P: { w: 182, h: 257, label: 'B5 세로' },
};

const GOLD = '#a8842c';
const NAVY = '#24406a';
const GREEN = '#2f5d4a';

function keyPattern(id, color, size = 8, rotate = 0) {
  const u = size / 8;
  const d = `M${0.8 * u} ${7.2 * u} H${7.2 * u} V${0.8 * u} H${2.4 * u} V${5.6 * u} H${5.6 * u} V${2.4 * u} H${4 * u} V${4 * u}`;
  return `<pattern id="${id}" width="${size}" height="${size}" patternUnits="userSpaceOnUse"${rotate ? ` patternTransform="rotate(${rotate})"` : ''}><path d="${d}" fill="none" stroke="${color}" stroke-width="${0.55 * u}" stroke-linecap="square"/></pattern>`;
}

function flower(cx, cy, r, color) {
  let petals = '';
  for (let i = 0; i < 5; i++) {
    const a = (i * 72 - 90) * Math.PI / 180;
    const px = cx + Math.cos(a) * r * 0.55;
    const py = cy + Math.sin(a) * r * 0.55;
    petals += `<ellipse cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" rx="${(r * 0.5).toFixed(2)}" ry="${(r * 0.32).toFixed(2)}" transform="rotate(${i * 72} ${px.toFixed(2)} ${py.toFixed(2)})" fill="none" stroke="${color}" stroke-width="0.35"/>`;
  }
  return `${petals}<circle cx="${cx}" cy="${cy}" r="${(r * 0.18).toFixed(2)}" fill="${color}"/>`;
}

function classicSvg(w, h) {
  const m = 13, b = 8; // 띠 시작, 띠 두께
  const corners = [[m, m], [w - m - b, m], [m, h - m - b], [w - m - b, h - m - b]]
    .map(([x, y]) => `<rect x="${x}" y="${y}" width="${b}" height="${b}" fill="#fbf8ef" stroke="${GOLD}" stroke-width="0.5"/>${flower(x + b / 2, y + b / 2, 3.2, GOLD)}`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}mm" height="${h}mm">
<defs>${keyPattern('kh', GOLD)}${keyPattern('kv', GOLD, 8, 90)}</defs>
<rect width="${w}" height="${h}" fill="#fbf8ef"/>
<rect x="${m - 2.5}" y="${m - 2.5}" width="${w - 2 * m + 5}" height="${h - 2 * m + 5}" fill="none" stroke="${GOLD}" stroke-width="1.1"/>
<rect x="${m}" y="${m}" width="${w - 2 * m}" height="${b}" fill="url(#kh)"/>
<rect x="${m}" y="${h - m - b}" width="${w - 2 * m}" height="${b}" fill="url(#kh)"/>
<rect x="${m}" y="${m}" width="${b}" height="${h - 2 * m}" fill="url(#kv)"/>
<rect x="${w - m - b}" y="${m}" width="${b}" height="${h - 2 * m}" fill="url(#kv)"/>
<rect x="${m}" y="${m}" width="${w - 2 * m}" height="${h - 2 * m}" fill="none" stroke="${GOLD}" stroke-width="0.45"/>
<rect x="${m + b}" y="${m + b}" width="${w - 2 * (m + b)}" height="${h - 2 * (m + b)}" fill="none" stroke="${GOLD}" stroke-width="0.45"/>
<rect x="${m + b + 2}" y="${m + b + 2}" width="${w - 2 * (m + b + 2)}" height="${h - 2 * (m + b + 2)}" fill="none" stroke="${GOLD}" stroke-width="0.9"/>
${corners}
${flower(w / 2, m + b + 9, 4.2, GOLD)}
</svg>`;
}

function simpleSvg(w, h) {
  const m = 12;
  const L = 16;
  const br = (x, y, sx, sy) => `<path d="M${x} ${y + sy * L} V${y} H${x + sx * L}" fill="none" stroke="${NAVY}" stroke-width="1.4"/>`;
  const i = m + 6;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}mm" height="${h}mm">
<rect width="${w}" height="${h}" fill="#ffffff"/>
<rect x="${m}" y="${m}" width="${w - 2 * m}" height="${h - 2 * m}" fill="none" stroke="${NAVY}" stroke-width="1.6"/>
<rect x="${m + 2.2}" y="${m + 2.2}" width="${w - 2 * m - 4.4}" height="${h - 2 * m - 4.4}" fill="none" stroke="${NAVY}" stroke-width="0.4"/>
${br(i, i, 1, 1)}${br(w - i, i, -1, 1)}${br(i, h - i, 1, -1)}${br(w - i, h - i, -1, -1)}
<path d="M${w / 2 - 22} ${m + 20} H${w / 2 - 4} M${w / 2 + 4} ${m + 20} H${w / 2 + 22}" stroke="${NAVY}" stroke-width="0.4"/>
<rect x="${w / 2 - 2}" y="${m + 18}" width="4" height="4" transform="rotate(45 ${w / 2} ${m + 20})" fill="${NAVY}"/>
</svg>`;
}

function wideSvg(w, h) {
  const m = 11;
  const dots = [];
  for (let x = m + 14; x <= w - m - 14; x += 6) dots.push(`<rect x="${x - 0.9}" y="${m + 6.1}" width="1.8" height="1.8" transform="rotate(45 ${x} ${m + 7})" fill="${GREEN}" opacity="0.55"/>`);
  for (let x = m + 14; x <= w - m - 14; x += 6) dots.push(`<rect x="${x - 0.9}" y="${h - m - 7.9}" width="1.8" height="1.8" transform="rotate(45 ${x} ${h - m - 7})" fill="${GREEN}" opacity="0.55"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}mm" height="${h}mm">
<rect width="${w}" height="${h}" fill="#fcfbf6"/>
<rect x="${m}" y="${m}" width="${w - 2 * m}" height="${h - 2 * m}" fill="none" stroke="${GREEN}" stroke-width="2.2"/>
<rect x="${m + 3}" y="${m + 3}" width="${w - 2 * m - 6}" height="${h - 2 * m - 6}" fill="none" stroke="${GOLD}" stroke-width="0.5"/>
<rect x="${m + 10}" y="${m + 10}" width="${w - 2 * m - 20}" height="${h - 2 * m - 20}" fill="none" stroke="${GOLD}" stroke-width="0.3"/>
${dots.join('')}
${flower(m + 5.5, m + 5.5, 3, GOLD)}${flower(w - m - 5.5, m + 5.5, 3, GOLD)}${flower(m + 5.5, h - m - 5.5, 3, GOLD)}${flower(w - m - 5.5, h - m - 5.5, 3, GOLD)}
</svg>`;
}


// 많이 쓰는 시판 상장 용지 모양: 금색 이중 테두리, 오목한 모서리와 덩굴 장식 (A4, 테두리는 가장자리에서 약 21mm 안쪽)
function goldFrameSvg(w, h) {
  const m = 21, r = 5.2, gap = 2.3;
  const concave = (inset, rad) => {
    // 모서리를 안으로 오목하게 판 사각형 (원의 중심은 바깥 테두리 꼭짓점)
    const off = inset - m;
    const k = Math.sqrt(Math.max(rad * rad - off * off, 0));
    const L = inset, T = inset, R = w - inset, B = h - inset;
    const cl = m, ct = m, cr = w - m, cb = h - m;
    return `M${cl + k} ${T} H${cr - k} A${rad} ${rad} 0 0 0 ${R} ${ct + k} V${cb - k} A${rad} ${rad} 0 0 0 ${cr - k} ${B} H${cl + k} A${rad} ${rad} 0 0 0 ${L} ${cb - k} V${ct + k} A${rad} ${rad} 0 0 0 ${cl + k} ${T} Z`;
  };
  // 오목한 모서리 끝에서 바깥으로 말려 나가는 덩굴 두 개 + 꼭짓점 점
  const A = `M${r} 0 C${r - 1.8} 0 ${r - 3.6} -0.6 ${r - 4.3} -2.2 C${r - 4.9} -3.6 ${r - 3.8} -4.9 ${r - 2.5} -4.6 C${r - 1.3} -4.3 ${r - 1.2} -2.8 ${r - 2.2} -2.4 C${r - 2.9} -2.1 ${r - 3.5} -2.7 ${r - 3.2} -3.2`;
  const B = A.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, '$2 $1');
  const corner = (x, y, sx, sy) => `<g transform="translate(${x} ${y}) scale(${sx} ${sy})"><path d="${A} ${B}" fill="none" stroke="url(#gg)" stroke-width="0.65" stroke-linecap="round"/><circle cx="-0.9" cy="-0.9" r="0.6" fill="#d9a521"/></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}mm" height="${h}mm">
<defs><linearGradient id="gg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e9bf3c"/><stop offset=".45" stop-color="#f6dc7c"/><stop offset=".55" stop-color="#d9a521"/><stop offset="1" stop-color="#c38d17"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="#fdfdfb"/>
<path d="${concave(m, r)}" fill="none" stroke="url(#gg)" stroke-width="1.5"/>
<path d="${concave(m + gap, r + gap)}" fill="none" stroke="#dcb04a" stroke-width="0.4"/>
${corner(m, m, 1, 1)}${corner(w - m, m, -1, 1)}${corner(m, h - m, 1, -1)}${corner(w - m, h - m, -1, -1)}
</svg>`;
}

// 칸 기본 서식
const base = {
  font: 'chosun-gs', bold: false, color: '#111111',
  align: 'left', valign: 'middle', lineHeight: 160, maxLines: 1,
  scale: 100, minScale: 80, spacing: 0, minSpacing: -8,
};

export const FIELD_DEFS = [
  { id: 'number', label: '상장번호', text: '제 {{상장번호}} 호' },
  { id: 'title', label: '상장명', text: '{{상장명}}' },
  { id: 'affiliation', label: '소속', text: '{{소속}}' },
  { id: 'name', label: '이름', text: '{{이름}}' },
  { id: 'body', label: '내용', text: '{{내용}}' },
  { id: 'date', label: '날짜', text: '{{날짜}}' },
  { id: 'presenter', label: '수여자', text: '{{수여자}}' },
];

function f(id, box, style) {
  const def = FIELD_DEFS.find(d => d.id === id);
  return { ...base, id, label: def.label, text: def.text, ...box, ...style };
}

export const PAPERS = [
  {
    id: 'gold', name: '금색 테두리 (시판 기본형)', size: 'A4P', svg: goldFrameSvg, inset: 28,
    fields: [
      f('number', { x: 31, y: 32, w: 62, h: 8 }, { size: 11, minSize: 8 }),
      f('title', { x: 52, y: 50, w: 106, h: 28 }, { size: 46, minSize: 28, align: 'distribute' }),
      f('affiliation', { x: 96, y: 92, w: 83, h: 9 }, { size: 15, minSize: 10, align: 'right' }),
      f('name', { x: 96, y: 103, w: 83, h: 13 }, { size: 21, minSize: 13, align: 'right' }),
      f('body', { x: 33, y: 128, w: 144, h: 82 }, { size: 18, minSize: 12, align: 'justify', valign: 'top', lineHeight: 200, maxLines: 0 }),
      f('date', { x: 33, y: 220, w: 144, h: 10 }, { size: 16, minSize: 11, align: 'center' }),
      f('presenter', { x: 33, y: 242, w: 144, h: 15 }, { size: 23, minSize: 14, align: 'center' }),
    ],
    stamp: { size: 21, dx: -5, dy: 0 },
  },
  {
    id: 'classic', name: '전통 문양', size: 'A4P', svg: classicSvg, inset: 26,
    fields: [
      f('number', { x: 30, y: 30, w: 62, h: 8 }, { size: 11, minSize: 8 }),
      f('title', { x: 52, y: 50, w: 106, h: 28 }, { size: 46, minSize: 28, align: 'distribute' }),
      f('affiliation', { x: 96, y: 92, w: 82, h: 9 }, { size: 15, minSize: 10, align: 'right' }),
      f('name', { x: 96, y: 103, w: 82, h: 13 }, { size: 21, minSize: 13, align: 'right' }),
      f('body', { x: 33, y: 128, w: 144, h: 80 }, { size: 18, minSize: 12, align: 'justify', valign: 'top', lineHeight: 200, maxLines: 0 }),
      f('date', { x: 33, y: 218, w: 144, h: 10 }, { size: 16, minSize: 11, align: 'center' }),
      f('presenter', { x: 33, y: 240, w: 144, h: 15 }, { size: 23, minSize: 14, align: 'center' }),
    ],
    stamp: { size: 21, dx: -5, dy: 0 },
  },
  {
    id: 'simple', name: '단정한 이중선', size: 'A4P', svg: simpleSvg, inset: 24,
    fields: [
      f('number', { x: 26, y: 24, w: 80, h: 8 }, { size: 11, minSize: 8 }),
      f('title', { x: 50, y: 42, w: 110, h: 30 }, { size: 48, minSize: 28, align: 'distribute' }),
      f('affiliation', { x: 92, y: 88, w: 90, h: 9 }, { size: 15, minSize: 10, align: 'right' }),
      f('name', { x: 92, y: 99, w: 90, h: 13 }, { size: 21, minSize: 13, align: 'right' }),
      f('body', { x: 30, y: 124, w: 150, h: 86 }, { size: 18, minSize: 12, align: 'justify', valign: 'top', lineHeight: 200, maxLines: 0 }),
      f('date', { x: 30, y: 222, w: 150, h: 10 }, { size: 16, minSize: 11, align: 'center' }),
      f('presenter', { x: 30, y: 244, w: 150, h: 15 }, { size: 23, minSize: 14, align: 'center' }),
    ],
    stamp: { size: 21, dx: -5, dy: 0 },
  },
  {
    id: 'wide', name: '가로형 감사장', size: 'A4L', svg: wideSvg, inset: 26,
    fields: [
      f('number', { x: 28, y: 26, w: 90, h: 8 }, { size: 11, minSize: 8 }),
      f('title', { x: 98, y: 32, w: 101, h: 24 }, { size: 40, minSize: 24, align: 'distribute' }),
      f('affiliation', { x: 172, y: 64, w: 96, h: 9 }, { size: 15, minSize: 10, align: 'right' }),
      f('name', { x: 172, y: 74, w: 96, h: 12 }, { size: 20, minSize: 12, align: 'right' }),
      f('body', { x: 40, y: 94, w: 217, h: 52 }, { size: 17, minSize: 11, align: 'justify', valign: 'top', lineHeight: 190, maxLines: 0 }),
      f('date', { x: 40, y: 152, w: 217, h: 9 }, { size: 15, minSize: 10, align: 'center' }),
      f('presenter', { x: 40, y: 166, w: 217, h: 13 }, { size: 21, minSize: 13, align: 'center' }),
    ],
    stamp: { size: 19, dx: -5, dy: 0 },
  },
];

export function paperById(id) { return PAPERS.find(p => p.id === id) || PAPERS[0]; }

export function paperBackgroundSvg(paper) {
  const s = SIZES[paper.size];
  return paper.svg(s.w, s.h);
}

export const SAMPLE = {
  columns: ['상장번호', '상장명', '소속', '이름', '내용', '날짜', '수여자'],
  rows: [
    ['2026-001', '상장', '6학년 3반', '김하늘', '위 어린이는 2026 한울 예술제 독서 골든벨 대회에서 뛰어난 실력을 보여 최우수상을 받았으므로 이 상장을 주어 칭찬합니다.', '2026년 11월 20일', '한울초등학교장'],
    ['2026-002', '표창장', '5학년 1반', '이도윤', '위 어린이는 평소 학교생활에 모범이 되며 친구들을 배려하는 마음으로 학급 일에 앞장서 다른 어린이의 본보기가 되었고, 특히 한 해 동안 꾸준히 봉사 활동에 참여하여 학교를 아름답게 가꾸는 데 크게 이바지하였으므로 이 표창장을 주어 칭찬합니다.', '2026년 11월 20일', '한울초등학교장'],
    ['2026-003', '상장', '4학년 2반 다꿈 발표회 사회자', '남궁서연비', '위 어린이는 다꿈 발표회에서 사회를 맡아 행사를 훌륭히 이끌었으므로 이 상장을 줍니다.', '2026년 11월 20일', '한울초등학교장'],
  ],
};
