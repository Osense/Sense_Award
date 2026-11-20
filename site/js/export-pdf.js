// PDF 만들기 — 배치 엔진의 글자 좌표를 그대로 찍는다(견본 배경은 넣지 않음)
import { computeRecord } from './render.js';
import { borderShapes } from './papers.js';

const MM = 72 / 25.4;

/**
 * opts: { PDFLib, fontkit, doc, store, indices, paper:{w,h}, offset:{x,y}, scale(배율 보정, 1=그대로),
 *         stampPng: Uint8Array|null, border: 테두리 설정|null(넣지 않음), onProgress,
 *         subset: (bytes, codepoints) => Promise<Uint8Array> — HarfBuzz 서브셋 }
 */
export async function buildPdf(opts) {
  const { PDFLib, fontkit, doc, store, indices, paper, offset = { x: 0, y: 0 }, scale = 1, stampPng, border, onProgress, subset } = opts;
  const {
    PDFDocument, pushGraphicsState, popGraphicsState, beginText, endText,
    setFontAndSize, setTextMatrix, showText, setFillingRgbColor, setStrokingRgbColor,
    setLineWidth, setTextRenderingMode, TextRenderingMode, concatTransformationMatrix, PrintScaling, rgb,
  } = PDFLib;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle('상장');
  pdf.setCreator('쎈스 어워드 · WSNS studio');
  pdf.setProducer('쎈스 어워드');
  // 인쇄 대화상자의 기본값을 '실제 크기(100%)'로: 프린터 여백에 맞춰 줄이면 상장 용지 칸과 어긋난다
  try {
    const vp = pdf.catalog.getOrCreateViewerPreferences();
    vp.setPrintScaling(PrintScaling.None);
    vp.setPickTrayByPDFSize(true);
  } catch {}

  // 1) 모든 장을 먼저 배치해 글꼴마다 실제로 쓴 글자를 모은다
  const recs = indices.map(idx => ({ idx, rec: computeRecord(doc, idx, store) }));
  const used = new Map(); // handle.key → { handle, cps:Set }
  for (const { rec } of recs) {
    for (const res of rec.fields) {
      if (res.pending) continue;
      for (const line of res.lines) for (const c of line.chars) {
        const handle = c.fb && res.fallback ? res.fallback : res.font;
        if (handle.empty(c.cp)) continue;
        if (!used.has(handle.key)) used.set(handle.key, { handle, cps: new Set() });
        used.get(handle.key).cps.add(c.cp);
      }
    }
  }
  // 2) 쓴 글자만 남긴 글꼴을 넣는다(HarfBuzz 서브셋, 없으면 pdf-lib 서브셋)
  const embedded = new Map();
  for (const [key, u] of used) {
    if (subset) embedded.set(key, await pdf.embedFont(await subset(u.handle.bytes, [...u.cps]), { subset: false }));
    else embedded.set(key, await pdf.embedFont(u.handle.bytes, { subset: true }));
  }
  const embedFont = async (handle) => embedded.get(handle.key);
  const stampImg = stampPng ? await pdf.embedPng(stampPng) : null;
  const W = paper.w * MM;
  const H = paper.h * MM;
  const warnings = [];

  for (let n = 0; n < recs.length; n++) {
    const { idx, rec } = recs[n];
    const page = pdf.addPage([W, H]);
    // 배율 보정: 용지 가운데를 기준으로 전체를 키우거나 줄인다
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(scale, 0, 0, scale, (W / 2) * (1 - scale), (H / 2) * (1 - scale)));
    if (border) {
      for (const s of borderShapes(border, paper)) {
        const o = { x: offset.x * MM, y: H - offset.y * MM, scale: MM };
        if (s.fill) page.drawSvgPath(s.d, { ...o, color: rgb(...hexToRgb(s.fill)), borderWidth: 0 });
        else page.drawSvgPath(s.d, { ...o, borderColor: rgb(...hexToRgb(s.stroke)), borderWidth: s.width, borderLineCap: s.cap ? 1 : 0 });
      }
    }
    // 도장은 글씨 뒤에: 글보다 먼저 찍는다
    if (rec.stamp && stampImg) {
      const s = rec.stamp;
      page.drawImage(stampImg, {
        x: (s.x + offset.x) * MM,
        y: H - (s.y + s.h + offset.y) * MM,
        width: s.w * MM, height: s.h * MM,
      });
    }
    const fontKeys = new Map();
    const keyFor = async (handle) => {
      if (!fontKeys.has(handle.key)) {
        const f = await embedFont(handle);
        fontKeys.set(handle.key, { pdfFont: f, name: page.node.newFontDictionary(f.name, f.ref) });
      }
      return fontKeys.get(handle.key);
    };
    for (const res of rec.fields) {
      if (res.pending) continue;
      if (res.overflow) warnings.push({ index: idx, field: res.field.label });
      const color = hexToRgb(res.field.color || '#111111');
      const ops = [pushGraphicsState(), setFillingRgbColor(...color)];
      if (res.faux) {
        ops.push(setStrokingRgbColor(...color), setLineWidth(res.sizePt * 0.035), setTextRenderingMode(TextRenderingMode.FillAndOutline));
      }
      ops.push(beginText());
      let current = null;
      for (const line of res.lines) {
        for (const c of line.chars) {
          const handle = c.fb && res.fallback ? res.fallback : res.font;
          if (handle.empty(c.cp)) continue;
          const fk = await keyFor(handle);
          if (current !== handle.key) { ops.push(setFontAndSize(fk.name, res.sizePt)); current = handle.key; }
          const x = (c.x + offset.x) * MM;
          const y = H - (line.baseline + offset.y) * MM;
          ops.push(setTextMatrix(res.scale / 100, 0, 0, 1, x, y), showText(fk.pdfFont.encodeText(c.ch)));
        }
      }
      ops.push(endText(), popGraphicsState());
      page.pushOperators(...ops);
    }
    page.pushOperators(popGraphicsState());
    if (onProgress) await onProgress(n + 1, recs.length);
  }
  const bytes = await pdf.save();
  return { bytes, warnings };
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h.padEnd(6, '0');
  return [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16) / 255);
}

/** 맞춤 확인용 시험 인쇄 페이지: 100mm 자, 글 영역 모서리 표시, 테두리 윤곽 */
export async function buildTestPage(opts) {
  const { PDFLib, fontkit, fontHandle, subset, paper, border, content, offset = { x: 0, y: 0 }, scale = 1 } = opts;
  const { PDFDocument, rgb, PrintScaling, pushGraphicsState, popGraphicsState, concatTransformationMatrix } = PDFLib;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle('쎈스 어워드 맞춤 확인 인쇄');
  try { const vp = pdf.catalog.getOrCreateViewerPreferences(); vp.setPrintScaling(PrintScaling.None); vp.setPickTrayByPDFSize(true); } catch {}
  const lines = [
    '쎈스 어워드 · 맞춤 확인 인쇄',
    '1. 이 장을 빈 A4 종이에 "실제 크기(100%)"로 인쇄하세요. "용지에 맞춤"은 끄세요.',
    '2. 가운데 가로·세로 선의 길이를 자로 재세요. 정확히 100mm가 아니면 잰 값을 4단계 "인쇄 맞추기"에 넣으세요.',
    '3. 상장 용지와 겹쳐 빛에 비춰 보세요. 회색 선이 용지의 금색 테두리와, 빨간 십자가 글 영역 모서리와 맞아야 해요.',
    '   어긋나면 몇 mm 밀렸는지 재서 "가로·세로 보정"에 넣으세요(오른쪽·아래로 밀리면 음수).',
    '0', '100mm',
  ];
  const cps = new Set();
  for (const t of lines) for (const ch of t) { const cp = ch.codePointAt(0); if (!fontHandle.empty(cp)) cps.add(cp); }
  const font = subset ? await pdf.embedFont(await subset(fontHandle.bytes, [...cps]), { subset: false }) : await pdf.embedFont(fontHandle.bytes, { subset: true });
  const W = paper.w * MM, H = paper.h * MM;
  const page = pdf.addPage([W, H]);
  const X = mm => (mm + offset.x) * MM;
  const Y = mm => H - (mm + offset.y) * MM;
  const ink = rgb(0.1, 0.1, 0.1);
  const red = rgb(0.85, 0.15, 0.2);
  const line = (x1, y1, x2, y2, w = 0.25, c = ink) => page.drawLine({ start: { x: X(x1), y: Y(y1) }, end: { x: X(x2), y: Y(y2) }, thickness: w * MM, color: c });
  // 공백 글자는 넣지 않았으므로 어절마다 따로 찍고 공백 폭만큼 띄운다
  const text = (t, x, y, size = 9, c = ink) => {
    let cx = X(x);
    const sp = fontHandle.adv(32) * size;
    for (const word of t.split(' ')) {
      if (word) { page.drawText(word, { x: cx, y: Y(y), size, font, color: c }); cx += font.widthOfTextAtSize(word, size); }
      cx += sp;
    }
  };
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(scale, 0, 0, scale, (W / 2) * (1 - scale), (H / 2) * (1 - scale)));
  // 테두리 윤곽(회색)
  for (const s of borderShapes({ ...border, ornament: 0 }, paper)) {
    if (!s.fill) page.drawSvgPath(s.d, { x: X(0), y: Y(0), scale: MM, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.2 });
  }
  // 글 영역 모서리 십자
  const c = content;
  for (const [x, y] of [[c.x, c.y], [c.x + c.w, c.y], [c.x, c.y + c.h], [c.x + c.w, c.y + c.h]]) {
    line(x - 4, y, x + 4, y, 0.25, red); line(x, y - 4, x, y + 4, 0.25, red);
  }
  // 가운데 100mm 자(가로·세로)
  const cx = paper.w / 2, cy = paper.h / 2;
  line(cx - 50, cy, cx + 50, cy, 0.3);
  for (let i = 0; i <= 100; i += 1) {
    const L = i % 10 === 0 ? 4 : i % 5 === 0 ? 2.5 : 1.3;
    line(cx - 50 + i, cy, cx - 50 + i, cy - L, 0.15);
  }
  line(cx, cy - 50 + 0, cx, cy + 50, 0.3);
  for (let i = 0; i <= 100; i += 1) {
    const L = i % 10 === 0 ? 4 : i % 5 === 0 ? 2.5 : 1.3;
    line(cx, cy - 50 + i, cx + L, cy - 50 + i, 0.15);
  }
  text('0', cx - 51, cy + 4.5, 7); text('100mm', cx + 44, cy + 4.5, 7);
  // 안내

  lines.slice(0, 5).forEach((t, i) => text(t, c.x, c.y + 14 + i * 6.5, i === 0 ? 11 : 8.5, i === 0 ? red : ink));
  page.pushOperators(popGraphicsState());
  return pdf.save();
}
