// HWPX(한글) 만들기 — 칸마다 글상자를 종이 기준 절대 위치에 놓는다.
// 줄 나눔은 배치 엔진이 정한 대로 강제 줄 바꿈(<hp:lineBreak/>)으로 넣고,
// 장평·자간·글자 크기도 엔진이 정한 값을 글자 모양으로 그대로 쓴다.
import { computeRecord } from './render.js';
import { fontInfo } from './fonts.js';

const HU = 7200 / 25.4; // mm → HWPUNIT
const hu = mm => Math.round(mm * HU);
const LANGS = ['HANGUL', 'LATIN', 'HANJA', 'JAPANESE', 'OTHER', 'SYMBOL', 'USER'];
const langAttr = l => l.toLowerCase();

export const TEMPLATE_FILES = [
  'mimetype', 'version.xml', 'settings.xml',
  'META-INF/container.xml', 'META-INF/container.rdf', 'META-INF/manifest.xml',
  'Contents/content.hpf', 'Contents/header.xml', 'Contents/section0.xml',
  'Preview/PrvText.txt', 'Preview/PrvImage.png',
];

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * opts: { JSZip, template: {path: string|Uint8Array}, doc, store, indices, paper:{w,h,orient},
 *         offset, scale(배율 보정, 1=그대로), stampPng: Uint8Array|null, stampPx:{w,h} }
 */
export async function buildHwpx(opts) {
  const { JSZip, template, doc, store, indices, paper, offset = { x: 0, y: 0 }, scale: k = 1, stampPng, stampPx } = opts;
  // 배율 보정은 용지 가운데 기준, 위치 보정은 그다음
  const PX = x => paper.w / 2 + (x - paper.w / 2) * k + offset.x;
  const PY = y => paper.h / 2 + (y - paper.h / 2) * k + offset.y;
  let header = template['Contents/header.xml'];
  let section = template['Contents/section0.xml'];
  let hpf = template['Contents/content.hpf'];

  // ---- 글꼴: 각 언어 목록 끝에 붙인다
  const faces = [];
  for (const f of doc.fields) { const face = fontInfo(f.font).hwpFace; if (!faces.includes(face)) faces.push(face); }
  const faceIndex = {}; // lang → face → id
  header = header.replace(/<hh:fontface lang="(\w+)" fontCnt="(\d+)">([\s\S]*?)<\/hh:fontface>/g, (m, lang, cnt, inner) => {
    const base = Number(cnt);
    faceIndex[lang] = {};
    const added = faces.map((face, i) => {
      faceIndex[lang][face] = base + i;
      return `<hh:font id="${base + i}" face="${esc(face)}" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_MYUNGJO" weight="6" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/></hh:font>`;
    }).join('');
    return `<hh:fontface lang="${lang}" fontCnt="${base + faces.length}">${inner}${added}</hh:fontface>`;
  });

  // ---- 글자 모양·문단 모양: 필요한 것만 만들어 끝에 붙인다
  const charCount = Number((header.match(/<hh:charProperties itemCnt="(\d+)"/) || [])[1] || 0);
  const paraCount = Number((header.match(/<hh:paraProperties itemCnt="(\d+)"/) || [])[1] || 0);
  const charPrs = new Map(); // key → {id, xml}
  const paraPrs = new Map();
  const charPrId = (face, sizePt, scale, spacing, bold, color) => {
    const height = Math.round(sizePt * 100);
    const ratio = Math.round(scale);
    const sp = Math.round(spacing);
    const key = [face, height, ratio, sp, bold ? 1 : 0, color].join('|');
    if (!charPrs.has(key)) {
      const id = charCount + charPrs.size;
      const all = v => LANGS.map(l => `${langAttr(l)}="${v}"`).join(' ');
      const fontRef = LANGS.map(l => `${langAttr(l)}="${faceIndex[l]?.[face] ?? 0}"`).join(' ');
      const xml = `<hh:charPr id="${id}" height="${height}" textColor="${color}" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="2">`
        + `<hh:fontRef ${fontRef}/><hh:ratio ${all(ratio)}/><hh:spacing ${all(sp)}/><hh:relSz ${all(100)}/><hh:offset ${all(0)}/>`
        + (bold ? '<hh:bold/>' : '')
        + '<hh:underline type="NONE" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/><hh:shadow type="NONE" color="#C0C0C0" offsetX="10" offsetY="10"/></hh:charPr>';
      charPrs.set(key, { id, xml });
    }
    return charPrs.get(key).id;
  };
  const ALIGN = { left: 'LEFT', center: 'CENTER', right: 'RIGHT', justify: 'JUSTIFY', distribute: 'DISTRIBUTE' };
  const paraPrId = (align, lineHeight) => {
    const key = `${align}|${lineHeight}`;
    if (!paraPrs.has(key)) {
      const id = paraCount + paraPrs.size;
      const margin = '<hh:margin><hc:intent value="0" unit="HWPUNIT"/><hc:left value="0" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/><hc:prev value="0" unit="HWPUNIT"/><hc:next value="0" unit="HWPUNIT"/></hh:margin>';
      const ls = `<hh:lineSpacing type="PERCENT" value="${Math.round(lineHeight)}" unit="HWPUNIT"/>`;
      const xml = `<hh:paraPr id="${id}" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="0" suppressLineNumbers="0" checked="0" textDir="LTR">`
        + `<hh:align horizontal="${ALIGN[align] || 'LEFT'}" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/>`
        + '<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>'
        + '<hh:autoSpacing eAsianEng="0" eAsianNum="0"/>'
        + `<hp:switch><hp:case hp:required-namespace="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar">${margin}${ls}</hp:case><hp:default>${margin}${ls}</hp:default></hp:switch>`
        + '<hh:border borderFillIDRef="2" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/></hh:paraPr>';
      paraPrs.set(key, { id, xml });
    }
    return paraPrs.get(key).id;
  };

  // ---- 쪽마다 개체 만들기
  let uid = 1000;
  const nextId = () => String(++uid);
  const SLACK = 1.2; // 한글 측정 차이로 줄이 더 넘어가지 않게 주는 여유(mm)
  const warnings = [];
  const pages = [];
  for (const idx of indices) {
    const rec = computeRecord(doc, idx, store);
    const objs = [];
    let z = 0;
    for (const res of rec.fields) {
      if (res.pending || !res.lines.length) continue;
      if (res.overflow) warnings.push({ index: idx, field: res.field.label });
      const f = res.field;
      const face = fontInfo(f.font).hwpFace;
      const cId = charPrId(face, res.sizePt * k, res.scale, res.spacing, f.bold, (f.color || '#111111').toUpperCase());
      const pId = paraPrId(f.align, f.lineHeight);
      const text = res.lines.map(l => esc(l.text)).join('<hp:lineBreak/>');
      if (!text.replace(/<hp:lineBreak\/>/g, '').trim()) continue;
      let x = f.x;
      if (f.align === 'center') x -= SLACK / 2;
      else if (f.align === 'right') x -= SLACK;
      const w = f.w + (f.align === 'justify' || f.align === 'distribute' ? 0 : SLACK);
      // 글자 크기보다 상자가 낮으면 한글이 잘라내므로 넉넉히
      const h = Math.max(f.h, res.contentH + 1);
      let y = f.y;
      if (h > f.h) y -= (h - f.h) / 2;
      const vAlign = f.valign === 'top' ? 'TOP' : f.valign === 'bottom' ? 'BOTTOM' : 'CENTER';
      objs.push(rectXml({
        id: nextId(), z: z++, x: PX(x), y: PY(y), w: w * k, h: h * k, vAlign,
        para: `<hp:p id="0" paraPrIDRef="${pId}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="${cId}"><hp:t>${text}</hp:t></hp:run></hp:p>`,
      }));
    }
    if (rec.stamp && stampPng) {
      const s = rec.stamp;
      objs.push(picXml({ id: nextId(), z: z++, x: PX(s.x), y: PY(s.y), w: s.w * k, h: s.h * k, px: stampPx }));
    }
    pages.push(objs);
  }

  // ---- 문서 조립
  header = header.replace(/<hh:charProperties itemCnt="\d+">([\s\S]*?)<\/hh:charProperties>/, (m, inner) =>
    `<hh:charProperties itemCnt="${charCount + charPrs.size}">${inner}${[...charPrs.values()].map(c => c.xml).join('')}</hh:charProperties>`);
  header = header.replace(/<hh:paraProperties itemCnt="\d+">([\s\S]*?)<\/hh:paraProperties>/, (m, inner) =>
    `<hh:paraProperties itemCnt="${paraCount + paraPrs.size}">${inner}${[...paraPrs.values()].map(p => p.xml).join('')}</hh:paraProperties>`);
  if (stampPng) {
    header = header.replace('</hh:refList>', '<hh:binDataList itemCnt="1"><hh:binItem id="0" Type="Embedding" BinData="BIN0001.png" Format="png"/></hh:binDataList></hh:refList>');
    hpf = hpf.replace('</opf:manifest>', '<opf:item id="BIN0001" href="BinData/BIN0001.png" media-type="image/png" isEmbeded="1"/></opf:manifest>');
  }
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  hpf = hpf.replace(/synthetic-fixture-author/g, '쎈스 어워드')
    .replace(/(name="CreatedDate" content="text">)[^<]*/, `$1${now}`)
    .replace(/(name="ModifiedDate" content="text">)[^<]*/, `$1${now}`)
    .replace(/<opf:title\/>/, '<opf:title>상장</opf:title>');

  // 용지: 가로는 NARROWLY + 세로 기준 너비·높이
  const portraitW = Math.min(paper.w, paper.h);
  const portraitH = Math.max(paper.w, paper.h);
  section = section.replace(/<hp:pagePr landscape="\w+" width="\d+" height="\d+"/,
    `<hp:pagePr landscape="${paper.w > paper.h ? 'NARROWLY' : 'WIDELY'}" width="${hu(portraitW)}" height="${hu(portraitH)}"`);
  section = section.replace(/<hp:margin header="\d+" footer="\d+" gutter="\d+" left="\d+" right="\d+" top="\d+" bottom="\d+"\/>/,
    '<hp:margin header="0" footer="0" gutter="0" left="1417" right="1417" top="1417" bottom="1417"/>');
  // 첫 문단: 구역 정의 + 첫 쪽 개체. 나머지 쪽은 쪽 나눔 문단
  const firstP = section.match(/<hp:p [\s\S]*<\/hp:p>/)[0];
  const secRun = firstP.match(/<hp:run charPrIDRef="0"><hp:secPr[\s\S]*?<\/hp:run>/)[0];
  const run = o => `<hp:run charPrIDRef="0">${o}</hp:run>`;
  const paras = pages.map((objs, i) => {
    const head = `<hp:p id="${i === 0 ? 0 : nextId()}" paraPrIDRef="0" styleIDRef="0" pageBreak="${i === 0 ? 0 : 1}" columnBreak="0" merged="0">`;
    return `${head}${i === 0 ? secRun : ''}${objs.map(run).join('')}<hp:run charPrIDRef="0"><hp:t/></hp:run></hp:p>`;
  });
  if (!paras.length) paras.push(`<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${secRun}<hp:run charPrIDRef="0"><hp:t/></hp:run></hp:p>`);
  section = section.replace(firstP, paras.join(''));

  const zip = new JSZip();
  zip.file('mimetype', template['mimetype'], { compression: 'STORE' });
  for (const p of TEMPLATE_FILES) {
    if (p === 'mimetype') continue;
    let v = template[p];
    if (p === 'Contents/header.xml') v = header;
    if (p === 'Contents/section0.xml') v = section;
    if (p === 'Contents/content.hpf') v = hpf;
    if (p === 'Preview/PrvText.txt') v = '상장';
    zip.file(p, v);
  }
  if (stampPng) zip.file('BinData/BIN0001.png', stampPng);
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/hwp+zip' });
  return { bytes, warnings };
}

const MATRIX = '<hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>';

function posXml(x, y) {
  return `<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="0" allowOverlap="1" holdAnchorAndSO="0" vertRelTo="PAPER" horzRelTo="PAPER" vertAlign="TOP" horzAlign="LEFT" vertOffset="${hu(y)}" horzOffset="${hu(x)}"/>`;
}

function rectXml({ id, z, x, y, w, h, vAlign, para }) {
  const W = hu(w), H = hu(h);
  return `<hp:rect id="${id}" zOrder="${z}" numberingType="NONE" textWrap="IN_FRONT_OF_TEXT" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${id}" ratio="0">`
    + `<hp:offset x="0" y="0"/><hp:orgSz width="${W}" height="${H}"/><hp:curSz width="${W}" height="${H}"/><hp:flip horizontal="0" vertical="0"/>`
    + `<hp:rotationInfo angle="0" centerX="${Math.round(W / 2)}" centerY="${Math.round(H / 2)}" rotateimage="1"/>${MATRIX}`
    + '<hp:lineShape color="#000000" width="0" style="NONE" endCap="FLAT" headStyle="NORMAL" tailStyle="NORMAL" headfill="1" tailfill="1" headSz="SMALL_SMALL" tailSz="SMALL_SMALL" outlineStyle="NORMAL" alpha="0"/>'
    + '<hp:shadow type="NONE" color="#B2B2B2" offsetX="0" offsetY="0" alpha="0"/>'
    + `<hp:drawText lastWidth="${W}" name="" editable="0"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="${vAlign}" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${para}</hp:subList><hp:textMargin left="0" right="0" top="0" bottom="0"/></hp:drawText>`
    + `<hc:pt0 x="0" y="0"/><hc:pt1 x="${W}" y="0"/><hc:pt2 x="${W}" y="${H}"/><hc:pt3 x="0" y="${H}"/>`
    + `<hp:sz width="${W}" widthRelTo="ABSOLUTE" height="${H}" heightRelTo="ABSOLUTE" protect="0"/>${posXml(x, y)}`
    + '<hp:outMargin left="0" right="0" top="0" bottom="0"/></hp:rect>';
}

function picXml({ id, z, x, y, w, h, px }) {
  const W = hu(w), H = hu(h);
  const dw = Math.round((px?.w || 100) * 75), dh = Math.round((px?.h || 100) * 75);
  return `<hp:pic textWrap="IN_FRONT_OF_TEXT" textFlow="BOTH_SIDES" reverse="0" id="${id}" zOrder="${z}" numberingType="PICTURE" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${id}">`
    + `<hp:offset x="0" y="0"/><hp:orgSz width="${W}" height="${H}"/><hp:curSz width="${W}" height="${H}"/><hp:flip horizontal="0" vertical="0"/>`
    + `<hp:rotationInfo angle="0" centerX="${Math.round(W / 2)}" centerY="${Math.round(H / 2)}" rotateimage="1"/>${MATRIX}`
    + `<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="${W}" y="0"/><hc:pt2 x="${W}" y="${H}"/><hc:pt3 x="0" y="${H}"/></hp:imgRect>`
    + `<hp:imgClip left="0" right="${dw}" top="0" bottom="${dh}"/><hp:inMargin left="0" right="0" top="0" bottom="0"/><hp:imgDim dimwidth="${dw}" dimheight="${dh}"/>`
    + '<hc:img binaryItemIDRef="BIN0001" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/><hp:effects/>'
    + `<hp:sz width="${W}" widthRelTo="ABSOLUTE" height="${H}" heightRelTo="ABSOLUTE" protect="0"/>${posXml(x, y)}`
    + '<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:shapeComment/></hp:pic>';
}
