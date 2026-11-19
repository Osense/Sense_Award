// PDF 만들기 — 배치 엔진의 글자 좌표를 그대로 찍는다(견본 배경은 넣지 않음)
import { computeRecord } from './render.js';

const MM = 72 / 25.4;

/**
 * opts: { PDFLib, fontkit, doc, store, indices, paper:{w,h}, offset:{x,y},
 *         stampPng: Uint8Array|null, bgPng: Uint8Array|null, onProgress }
 */
export async function buildPdf(opts) {
  const { PDFLib, fontkit, doc, store, indices, paper, offset = { x: 0, y: 0 }, stampPng, bgPng, onProgress } = opts;
  const {
    PDFDocument, pushGraphicsState, popGraphicsState, beginText, endText,
    setFontAndSize, setTextMatrix, showText, setFillingRgbColor, setStrokingRgbColor,
    setLineWidth, setTextRenderingMode, TextRenderingMode,
  } = PDFLib;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle('상장');
  pdf.setCreator('쎈스 어워드 · WSNS studio');
  pdf.setProducer('쎈스 어워드');

  const embedded = new Map(); // font handle key → PDFFont
  const embedFont = async (handle) => {
    if (!embedded.has(handle.key)) embedded.set(handle.key, await pdf.embedFont(handle.bytes, { subset: true }));
    return embedded.get(handle.key);
  };
  const stampImg = stampPng ? await pdf.embedPng(stampPng) : null;
  const bgImg = bgPng ? await pdf.embedPng(bgPng) : null;
  const W = paper.w * MM;
  const H = paper.h * MM;
  const warnings = [];

  for (let n = 0; n < indices.length; n++) {
    const idx = indices[n];
    const rec = computeRecord(doc, idx, store);
    const page = pdf.addPage([W, H]);
    if (bgImg) page.drawImage(bgImg, { x: 0, y: 0, width: W, height: H });
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
    if (rec.stamp && stampImg) {
      const s = rec.stamp;
      page.drawImage(stampImg, {
        x: (s.x + offset.x) * MM,
        y: H - (s.y + s.h + offset.y) * MM,
        width: s.w * MM, height: s.h * MM,
      });
    }
    if (onProgress) await onProgress(n + 1, indices.length);
  }
  const bytes = await pdf.save();
  return { bytes, warnings };
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h.padEnd(6, '0');
  return [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16) / 255);
}
