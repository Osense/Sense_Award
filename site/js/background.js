// 메일머지 배경: 그림(PNG·JPG·WEBP) 또는 PDF 첫 쪽을 용지 배경으로 깔고, 그 위에 글 상자({{변수}})를 얹는다.
// - 그림은 긴 변 3000px까지 줄여 저장(투명 그림은 PNG, 아니면 JPEG)
// - PDF는 화면·인쇄·한글용으로 첫 쪽을 그림으로 그려 두고(pdf.js), PDF로 내보낼 때는 원본 쪽을 벡터 그대로 넣는다(pdf-lib)

export const PAPER_PRESETS = [
  { key: 'bg', label: '배경 크기 그대로' },
  { key: 'A4P', label: 'A4 세로 (210×297)', w: 210, h: 297 },
  { key: 'A4L', label: 'A4 가로 (297×210)', w: 297, h: 210 },
  { key: 'B5P', label: 'B5 세로 (182×257)', w: 182, h: 257 },
  { key: 'A5P', label: 'A5 세로 (148×210)', w: 148, h: 210 },
  { key: 'A5L', label: 'A5 가로 (210×148)', w: 210, h: 148 },
  { key: 'LETTER', label: 'US Letter (216×279)', w: 215.9, h: 279.4 },
  { key: 'CARD', label: '명함 (90×50)', w: 90, h: 50 },
  { key: 'POST', label: '엽서 (100×148)', w: 100, h: 148 },
  { key: 'custom', label: '직접 입력 (mm)' },
];

export const BG_FITS = [
  { id: 'contain', name: '다 보이게' },
  { id: 'cover', name: '꽉 채우기' },
  { id: 'stretch', name: '늘려 맞추기' },
];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const MAX_PDF_B64 = 4.5 * 1024 * 1024;
export const MAX_PAGES = 30;            // 배경으로 쓰는 PDF 쪽 수 한도 // 저장 공간 때문에 원본 PDF는 이 크기까지만 보관

function readAs(file, how) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    if (how === 'url') r.readAsDataURL(file); else r.readAsArrayBuffer(file);
  });
}
function loadImg(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

function hasAlpha(g, w, h) {
  const p = g.getImageData(0, 0, w, h).data;
  for (let i = 3; i < p.length; i += 4 * 37) if (p[i] < 250) return true;
  return false;
}

/** 캔버스를 저장용 data URL로(투명하면 PNG) */
function canvasUrl(cv) {
  const g = cv.getContext('2d', { willReadFrequently: true });
  return hasAlpha(g, cv.width, cv.height) ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', 0.9);
}

let pdfjs = null;
async function loadPdfjs() {
  if (pdfjs) return pdfjs;
  pdfjs = await import('../vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
  return pdfjs;
}

function b64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * 배경 파일 읽기
 * 반환: { kind: 'image'|'pdf', name, src(그림 data URL), pxW, pxH, mmW?, mmH?(PDF 쪽 크기), pdf?(원본 base64), pages? }
 */
export async function loadBackground(file, onPage) {
  const name = file.name || '';
  const isPdf = /pdf$/i.test(file.type) || /\.pdf$/i.test(name);
  if (isPdf) {
    const buf = await readAs(file, 'buf');
    const lib = await loadPdfjs();
    const doc = await lib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
    const n = Math.min(doc.numPages, MAX_PAGES);
    // 쪽이 많을수록 저장 공간 때문에 화면용 그림을 조금 작게(PDF로 내보낼 때는 원본 벡터를 쓴다)
    const long = n === 1 ? 2600 : n <= 3 ? 2200 : n <= 8 ? 1700 : 1300;
    const pageImgs = [];
    for (let p = 1; p <= n; p++) {
      const page = await doc.getPage(p);
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: long / Math.max(vp1.width, vp1.height) });
      const cv = document.createElement('canvas');
      cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      const g = cv.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: g, viewport: vp }).promise;
      pageImgs.push({
        src: cv.toDataURL('image/jpeg', n === 1 ? 0.92 : 0.85), pxW: cv.width, pxH: cv.height,
        mmW: Math.round(vp1.width / 72 * 25.4 * 10) / 10, mmH: Math.round(vp1.height / 72 * 25.4 * 10) / 10,
      });
      if (onPage) onPage(p, n);
    }
    const enc = b64(buf);
    return {
      kind: 'pdf', name, ...pageImgs[0],
      pdf: enc.length <= MAX_PDF_B64 ? enc : null, pages: doc.numPages, pageImgs,
    };
  }
  const url = await readAs(file, 'url');
  const im = await loadImg(url);
  const k = Math.min(1, 3000 / Math.max(im.naturalWidth, im.naturalHeight));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(im.naturalWidth * k)); cv.height = Math.max(1, Math.round(im.naturalHeight * k));
  cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
  return { kind: 'image', name, src: canvasUrl(cv), pxW: cv.width, pxH: cv.height };
}

/** 여러 쪽 PDF에서 p쪽(0부터)을 배경 하나처럼 쓰는 보기(없으면 첫 쪽) */
export function bgOfPage(bg, p = 0) {
  if (!bg || !bg.pageImgs || !bg.pageImgs.length) return bg;
  const pg = bg.pageImgs[Math.max(0, Math.min(bg.pageImgs.length - 1, p | 0))];
  return { ...bg, ...pg, pageIndex: bg.pageImgs.indexOf(pg) };
}

/** 배경 크기로 정한 용지(mm): PDF는 쪽 크기 그대로, 그림은 긴 변을 297mm로 */
export function paperForBg(bg) {
  if (!bg) return { w: 210, h: 297 };
  if (bg.mmW && bg.mmH) return { w: bg.mmW, h: bg.mmH };
  const r = bg.pxW / bg.pxH;
  return r >= 1 ? { w: 297, h: Math.round(297 / r * 10) / 10 } : { w: Math.round(297 * r * 10) / 10, h: 297 };
}

/** 용지 위 배경 자리(mm) */
export function bgBox(bg, paper, fit = 'contain') {
  if (!bg) return null;
  const { w, h } = paper;
  if (fit === 'stretch') return { x: 0, y: 0, w, h };
  const s = (fit === 'cover' ? Math.max : Math.min)(w / bg.pxW, h / bg.pxH);
  const bw = bg.pxW * s, bh = bg.pxH * s;
  return { x: (w - bw) / 2, y: (h - bh) / 2, w: bw, h: bh };
}

/** 용지 크기 고르기 결과 */
export function resolvePaper(key, bg, custom) {
  if (key === 'bg') return { key, ...paperForBg(bg) };
  if (key === 'custom') return { key, w: clamp(Number(custom && custom.w) || 210, 30, 1000), h: clamp(Number(custom && custom.h) || 297, 30, 1000) };
  const p = PAPER_PRESETS.find(x => x.key === key) || PAPER_PRESETS[1];
  return { key: p.key, w: p.w, h: p.h };
}

/** 원본 PDF 바이트(base64 → Uint8Array) */
export function pdfBytes(bg) {
  if (!bg || !bg.pdf) return null;
  const s = atob(bg.pdf);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** 배경 그림을 PNG 바이트로(한글 내보내기용 — 틀 밖은 흰색) */
export async function bgPng(bg, paper, fit, dpi = 200) {
  const box = bgBox(bg, paper, fit);
  const k = Math.min(dpi / 25.4, 3200 / Math.max(paper.w, paper.h));
  const cv = document.createElement('canvas');
  cv.width = Math.round(paper.w * k); cv.height = Math.round(paper.h * k);
  const g = cv.getContext('2d');
  const im = await loadImg(bg.src);
  g.save();
  g.beginPath(); g.rect(0, 0, cv.width, cv.height); g.clip();
  g.drawImage(im, box.x * k, box.y * k, box.w * k, box.h * k);
  g.restore();
  const url = cv.toDataURL('image/png');
  const s = atob(url.split(',')[1]);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return { png: out, pxW: cv.width, pxH: cv.height, url };
}
