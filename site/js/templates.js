// 양식: 한국 상장 · 미국식 증서(Certificate of Recognition)
// 양식마다 칸 정의·견본 명단·테두리 기본값·처음 넣어 둘 마크 프레임이 다르다.
import { FIELD_DEFS, FIELD_BASE, SAMPLE, BORDER_DEFAULT, contentRect, PAPER } from './papers.js';

// ---- 미국식 증서 ------------------------------------------------------------
// 참고한 미국 증서 5종(주 하원·주 상원·시·연방 하원·단체)의 공통 문법:
//  1) 맨 위 발행처를 대문자로 넓게 띄어 쓴다(STATE OF CALIFORNIA)
//  2) 제목은 필기체·장식체로 크게(Certificate of Recognition), 아래에 가는 이중선
//  3) "Presented to" 작은 기울임 → 받는 사람 이름을 가장 크게(밑줄) → 직함·단체를 기울임으로
//  4) 본문은 가운데 정렬 기울임 문단
//  5) "Presented this 21st day of November, 2026" 날짜 문장
//  6) 서명선 위에 서명, 아래에 서명자 이름(대문자)과 직함
//  7) 금색 인장(원형 마크)을 왼쪽 아래에, 기관 문장을 맨 위 가운데에
export const US_BORDER = {
  inset: 12, thick: 2, gap: 1.6, thin: 0.5, notch: 0,
  ornOn: false, ornType: 'dot', ornament: 1, color: '#b8913a', pad: 12,
};

export const US_FIELD_DEFS = [
  { id: 'issuer', label: '발행처', text: '{{발행처}}', font: 'cormorant', bold: true, align: 'center', spacing: 45, minSpacing: 10, color: '#2b2b2b' },
  { id: 'title', label: '증서명', text: '{{증서명}}', font: 'pinyon-script', align: 'center', color: '#1d1d1d', rule: 'double-below', ruleColor: '#b8913a' },
  { id: 'presented', label: '수여 문구', text: 'This certificate is proudly presented to', font: 'cormorant-italic', align: 'center', color: '#333333' },
  { id: 'name', label: '이름', text: '{{이름}}', font: 'pinyon-script', align: 'center', color: '#111111', rule: 'below', ruleColor: '#444444' },
  { id: 'affiliation', label: '소속', text: '{{소속}}', font: 'cormorant-italic', bold: true, align: 'center', color: '#222222' },
  { id: 'body', label: '내용', text: '{{내용}}', font: 'cormorant-italic', align: 'center', valign: 'top', lineHeight: 138, maxLines: 0, color: '#1b1b1b' },
  { id: 'date', label: '날짜', text: '{{날짜}}', font: 'cormorant-italic', align: 'center', color: '#222222' },
  { id: 'presenter', label: '서명자', text: '{{서명자}}', font: 'cormorant', bold: true, align: 'center', lineHeight: 125, maxLines: 3, color: '#111111', rule: 'sig-above', ruleColor: '#333333' },
];

export const US_SAMPLE = {
  columns: ['발행처', '증서명', '이름', '소속', '내용', '날짜', '서명자'],
  rows: [
    ['WSNS STUDIO', 'Certificate of Recognition', 'Wes Kwon', '3rd Grade, Creative Media Class',
      'In recognition of your outstanding creativity, steady effort, and kind leadership throughout the WSNS Studio film workshop. Your imagination and teamwork inspired everyone around you. Congratulations on a truly remarkable achievement!',
      'Presented this 21st day of November, 2026', 'Wes Kwon\nDirector, WSNS Studio'],
    ['WSNS STUDIO', 'Certificate of Appreciation', 'Sense Kim', '5th Grade Volunteer',
      'With sincere appreciation for your generous time and cheerful spirit as a volunteer. Thank you for making a positive impact on our community.',
      'Presented this 21st day of November, 2026', 'Wes Kwon\nDirector, WSNS Studio'],
  ],
};

// 처음 넣어 둘 마크 프레임(빈 프레임 → 눌러서 그림 넣기): 맨 위 문장, 왼쪽 아래 인장
// 서명은 서명선 바로 위(서명자 기둥 가운데)에 견본 서명 그림을 미리 넣어 둔다 — 눌러서 내 서명으로 바꾸기
export const SAMPLE_SIGNATURE = { src: 'img/sample-signature.png', imgW: 791, imgH: 208 };
function usMarks(border = US_BORDER, paper = PAPER) {
  const C = contentRect(border, paper);
  const kx = C.w / 158.3, ky = C.h / 245.3;            // 견본 테두리 기준 → 지금 글 영역
  const colCx = C.x + C.w * (0.35 + 0.31);             // 서명자 기둥 가운데(자동 배치와 같은 값)
  const sigW = 58 * kx, sigH = 15.2 * ky;
  const sigBottom = C.y + (241.8 - 25.85) * ky;         // 서명선 높이
  return [
    { id: 'emblem', name: '문장', shape: 'circle', x: paper.w / 2 - 12, y: C.y + 9, w: 24, h: 24 },
    { id: 'seal', name: '인장', shape: 'circle', x: C.x + 4, y: C.y + C.h - 54, w: 38, h: 38 },
    { id: 'signature', name: '서명', shape: 'square', fit: 'contain', x: colCx - sigW / 2, y: sigBottom - sigH, w: sigW, h: sigH, ...SAMPLE_SIGNATURE, zoom: 1, panX: 0, panY: 0 },
  ];
}

// ---- 그림·PDF 배경 메일머지 ----------------------------------------------------------
// 초대장·이름표·수료증 같은 디자인을 배경으로 깔고, 글 상자 위치는 사용자가 정한다(자동 배치 없음)
export const CUSTOM_SAMPLE = {
  columns: ['이름', '소속', '날짜'],
  rows: [
    ['권웨스', '3학년 1반', '2026. 11. 23.'],
    ['김센스', '5학년 2반', '2026. 11. 23.'],
  ],
};
const CUSTOM_FIELD_DEFS = [
  { id: 't1', label: '소속', text: '{{소속}}', font: 'nanum-gothic', align: 'center', color: '#333333' },
  { id: 't2', label: '이름', text: '{{이름}}', font: 'nanum-myeongjo', bold: true, align: 'center', color: '#111111' },
  { id: 't3', label: '날짜', text: '{{날짜}}', font: 'nanum-gothic', align: 'center', color: '#333333' },
];
/** 그림 배경 양식의 처음 글 상자 자리(용지 비율로) */
export function placeCustomFields(fields, paper) {
  const { w, h } = paper;
  const k = Math.max(0.5, Math.sqrt(Math.min(w, h) / 210)); // 작은 용지(이름표·카드)에서도 읽히는 크기
  const spec = {
    t1: { cy: 0.40, ww: 0.6, size: 16 },
    t2: { cy: 0.48, ww: 0.5, size: 30 },
    t3: { cy: 0.62, ww: 0.5, size: 14 },
  };
  for (const f of fields) {
    const sp = spec[f.id];
    if (!sp) continue;
    const size = Math.round(sp.size * k * 2) / 2;
    const bh = size * 0.3528 * 1.7;
    Object.assign(f, { x: Math.round(w * (1 - sp.ww) / 2 * 10) / 10, y: Math.round((h * sp.cy - bh / 2) * 10) / 10, w: Math.round(w * sp.ww * 10) / 10, h: Math.round(bh * 10) / 10, size, minSize: Math.max(6, Math.round(size * 0.6)), manual: true });
  }
  return fields;
}

// ---- 한글·워드 문서 메일머지 ---------------------------------------------------------
export const DOC_SAMPLE = {
  columns: ['이름', '소속', '날짜'],
  rows: [
    ['권웨스', '3학년 1반', '2026. 11. 23.'],
    ['김센스', '5학년 2반', '2026. 11. 23.'],
  ],
};

// ---- 양식 목록 ---------------------------------------------------------------
export const TEMPLATES = {
  kr: {
    id: 'kr', name: '한국 상장', desc: '시판 금박 상장 용지 · 조선궁서체 · 호수·상장명·수여자',
    defs: FIELD_DEFS, sample: SAMPLE, border: BORDER_DEFAULT, bgInPdf: false, stamp: true, marks: () => [],
  },
  us: {
    id: 'us', name: '미국식 증서', desc: 'Certificate of Recognition · 필기체 제목 · 서명선 · 인장 마크',
    defs: US_FIELD_DEFS, sample: US_SAMPLE, border: US_BORDER, bgInPdf: true, stamp: false, marks: usMarks,
  },
  custom: {
    id: 'custom', name: '그림·PDF 메일머지', desc: '초대장·이름표·카드 디자인(그림·PDF) 위에 {{변수}} 글 상자',
    defs: CUSTOM_FIELD_DEFS, sample: CUSTOM_SAMPLE, border: BORDER_DEFAULT, bgInPdf: true, stamp: false, marks: () => [],
    steps: ['배경', '명단', '글 상자', '확인·내보내기'], free: true,
  },
  doc: {
    id: 'doc', name: '한글·워드 메일머지', desc: '{{변수}}를 넣은 한글(HWPX)·워드(DOCX) 문서를 명단만큼',
    defs: [], sample: DOC_SAMPLE, border: BORDER_DEFAULT, bgInPdf: false, stamp: false, marks: () => [],
    steps: ['문서', '명단', '미리보기', '내보내기'], free: true,
  },
};

export const tpl = id => TEMPLATES[id] || TEMPLATES.kr;

export function fieldsFor(id) {
  // 자리값은 자동 배치가 곧바로 채운다
  const fs = tpl(id).defs.map(d => ({ ...FIELD_BASE, ...d, x: 30, y: 30, w: 100, h: 10, size: 16, minSize: 12 }));
  return id === 'custom' ? placeCustomFields(fs, PAPER) : fs;
}
