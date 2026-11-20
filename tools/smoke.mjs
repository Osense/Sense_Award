// 노드에서 배치·PDF·HWPX 생성을 점검한다: node tools/smoke.mjs <out-dir>
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const site = new URL('../site/', import.meta.url).pathname;
const PDFLib = require(path.join(site, 'vendor/pdf-lib.min.js'));
const fontkit = require(path.join(site, 'vendor/fontkit.umd.min.js'));
const JSZip = require(path.join(site, 'vendor/jszip.min.js'));
const { FontStore, FONTS, variantKey, FALLBACK_FONT } = await import(path.join(site, 'js/fonts.js'));
const { defaultFields, SAMPLE, PAPER, BORDER_DEFAULT } = await import(path.join(site, 'js/papers.js'));
const { applyAutoLayout, layoutForRecord } = await import(path.join(site, 'js/autolayout.js'));
const { computeRecord, fontKeysFor } = await import(path.join(site, 'js/render.js'));
const { buildPdf, buildTestPage } = await import(path.join(site, 'js/export-pdf.js'));
const { subsetFont } = await import(path.join(site, 'js/subset.js'));
const { contentRect } = await import(path.join(site, 'js/papers.js'));
const subset = (bytes, cps) => subsetFont(async () => fs.readFileSync(path.join(site, 'vendor/harfbuzz-subset.wasm')), bytes, cps);
const { buildHwpx, TEMPLATE_FILES } = await import(path.join(site, 'js/export-hwpx.js'));

const out = process.argv[2] || '/tmp/award-out';
fs.mkdirSync(out, { recursive: true });
const store = new FontStore(fontkit, async p => new Uint8Array(fs.readFileSync(path.join(site, p))));
const label = process.argv[3] || 'sample';
const fontId = process.argv[4] || 'chosun-gs';
const rows = label === 'long' ? SAMPLE.rows.map(r => r.map((v, i) => i === 4 ? v + ' ' + v : v)) : SAMPLE.rows;
const doc = {
  fields: defaultFields().map(f => ({ ...f, font: fontId })),
  columns: SAMPLE.columns, rows, overrides: [],
  stamp: { enabled: true, size: 20, dx: -5, dy: 0, imgW: 200, imgH: 200 },
};
for (const k of [...fontKeysFor(doc), variantKey(FALLBACK_FONT, false)]) await store.load(k);
const auto = applyAutoLayout(doc, store, BORDER_DEFAULT);
doc.layoutFor = i => layoutForRecord(doc, store, BORDER_DEFAULT, i);
for (let i = 0; i < doc.rows.length; i++) { const L = layoutForRecord(doc, store, BORDER_DEFAULT, i); console.log(`#${i + 1} 본문`, L.fields.find(f => f.id === 'body').size, 'pt 수여자', L.fields.find(f => f.id === 'presenter').size, 'pt 이름', L.fields.find(f => f.id === 'name').size, 'pt'); }
console.log('sizes', JSON.stringify(auto.res.sizes), 'stamp', doc.stamp.size);
for (let i = 0; i < doc.rows.length; i++) {
  const r = computeRecord(doc, i, store);
  console.log(`#${i + 1}`, r.fields.map(f => `${f.field.id}:${f.sizePt}pt/${f.scale}%/${f.spacing}${f.overflow ? '/넘침' : ''}/${f.lines.length}줄`).join(' '), 'missing', r.missing);
}
// 도장 샘플: 빨간 원 PNG
const stamp = process.env.STAMP ? fs.readFileSync(process.env.STAMP) : fs.readFileSync(path.join(site, 'brand/sample-stamp.png'));
const size = PAPER;
const t0 = Date.now();
const pdf = await buildPdf({ PDFLib, fontkit, doc, store, indices: doc.rows.map((_, i) => i), paper: size, stampPng: stamp, subset, border: process.env.BORDER ? BORDER_DEFAULT : null, scale: Number(process.env.SCALE || 1) });
fs.writeFileSync(path.join(out, `${label}.pdf`), pdf.bytes);
const template = {};
for (const f of TEMPLATE_FILES) {
  const p = path.join(site, 'hwpx-template', f);
  template[f] = f.endsWith('.png') ? new Uint8Array(fs.readFileSync(p)) : fs.readFileSync(p, 'utf8');
}
const hwpx = await buildHwpx({ JSZip, template, doc, store, indices: doc.rows.map((_, i) => i), paper: size, stampPng: stamp, stampPx: { w: 200, h: 200 } });
fs.writeFileSync(path.join(out, `${label}.hwpx`), hwpx.bytes);
console.log('pdf', pdf.bytes.length, 'hwpx', hwpx.bytes.length, 'ms', Date.now() - t0, 'warn', pdf.warnings);

// 맞춤 확인 인쇄 페이지
const gothic = await store.load('nanum-gothic:regular');
fs.writeFileSync(path.join(out, 'test-page.pdf'), await buildTestPage({ PDFLib, fontkit, fontHandle: gothic, subset, paper: size, border: BORDER_DEFAULT, content: contentRect(BORDER_DEFAULT) }));
