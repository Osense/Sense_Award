// 문서 메일머지: {{변수}}가 들어간 한글(HWPX)·워드(DOCX) 문서를 명단 줄마다 채운다.
//
// 한글·워드는 같은 글자라도 서식·맞춤법 검사 때문에 여러 글자 조각(<hp:t>, <w:t>)으로 나뉘어 저장된다.
// 그래서 문단마다 글자 조각을 이어 붙여 {{…}}를 찾고, 바꾼 글을 조각별로 되돌려 쓴다(첫 조각에 값, 나머지 조각은 덜어 냄).
// 값 안의 줄바꿈은 한글 <hp:lineBreak/>, 워드 <w:br/>로 바꾼다. 한글은 바뀐 문단의 줄 배치 캐시(linesegarray)를 지워 다시 계산하게 한다.
//
// 내보내기
//  - 한 파일로 합치기: 본문을 명단 줄 수만큼 복제해 이어 붙이고 사이를 쪽 나눔(한글: 둘째부터 구역 설정 빼고 pageBreak, 워드: 쪽 나눔)
//  - 따로따로(ZIP): 줄마다 문서 하나. 파일 이름은 {{이름}}처럼 정할 수 있다

const NS = {
  hwpx: 'http://www.hancom.co.kr/hwpml/2011/paragraph',
  docx: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
};
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>';
const PH = /\{\{\s*([^{}]+?)\s*\}\}/g;
const NL = '\u0001';

const parse = s => new DOMParser().parseFromString(s, 'application/xml');
const ser = d => XML_DECL + new XMLSerializer().serializeToString(d.documentElement);

function partsOf(kind, zip) {
  const names = Object.keys(zip.files);
  if (kind === 'hwpx') return names.filter(n => /^Contents\/section\d+\.xml$/i.test(n)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  return names.filter(n => /^word\/(document|header\d*|footer\d*)\.xml$/i.test(n));
}
const mainPart = kind => (kind === 'hwpx' ? 'Contents/section0.xml' : 'word/document.xml');

/** 이 문단에 딸린(안쪽 표 문단 제외) 글자 조각 텍스트 노드 */
function textNodes(p, ns) {
  const out = [];
  const walk = el => {
    for (let c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      if (c.namespaceURI === ns && c.localName === 'p') continue;      // 표 안 문단은 따로
      if (c.namespaceURI === ns && c.localName === 't') {
        for (let t = c.firstChild; t; t = t.nextSibling) if (t.nodeType === 3 || t.nodeType === 4) out.push(t);
      } else walk(c);
    }
  };
  walk(p);
  return out;
}

function paragraphs(doc, ns) { return [...doc.getElementsByTagNameNS(ns, 'p')]; }

function paraText(p, ns) { return textNodes(p, ns).map(n => n.data).join(''); }

/** 문단 하나의 {{…}}를 바꾼다. resolve(key) → 문자열. 바뀌었으면 true */
function replaceInParagraph(p, ns, kind, resolve) {
  const nodes = textNodes(p, ns);
  if (!nodes.length) return false;
  const text = nodes.map(n => n.data).join('');
  const ms = [...text.matchAll(PH)];
  if (!ms.length) return false;
  const starts = [];
  let acc = 0;
  for (const n of nodes) { starts.push(acc); acc += n.data.length; }
  const at = pos => {
    // pos가 걸친 조각(끝 위치는 앞 조각에 붙여 계산)
    let i = nodes.length - 1;
    while (i > 0 && starts[i] > pos) i--;
    return [i, pos - starts[i]];
  };
  for (let m = ms.length - 1; m >= 0; m--) {
    const { index } = ms[m];
    const end = index + ms[m][0].length;
    const val = String(resolve(ms[m][1]) ?? '').replace(/\r\n?/g, '\n').replace(/\n/g, NL);
    const [si, so] = at(index);
    let [ei, eo] = at(end);
    if (eo === 0 && ei > si) { ei--; eo = nodes[ei].data.length; }
    if (si === ei) {
      const d = nodes[si].data;
      nodes[si].data = d.slice(0, so) + val + d.slice(eo);
    } else {
      nodes[si].data = nodes[si].data.slice(0, so) + val;
      for (let k = si + 1; k < ei; k++) nodes[k].data = '';
      nodes[ei].data = nodes[ei].data.slice(eo);
    }
    // 뒤쪽 시작 위치는 그대로 두고 앞쪽부터 바꾸지 않으므로(뒤에서부터) 위치가 어긋나지 않는다
  }
  // 줄바꿈 표시를 실제 줄바꿈 요소로
  for (const n of textNodes(p, ns)) {
    if (!n.data.includes(NL)) continue;
    const parts = n.data.split(NL);
    const t = n.parentNode;
    const doc = n.ownerDocument;
    if (kind === 'hwpx') {
      const frag = [];
      parts.forEach((s, i) => {
        if (i) frag.push(doc.createElementNS(ns, `${t.prefix ? t.prefix + ':' : ''}lineBreak`));
        frag.push(doc.createTextNode(s));
      });
      for (const f of frag) t.insertBefore(f, n);
      t.removeChild(n);
    } else {
      // 워드: <w:t>를 나누고 사이에 <w:br/>
      n.data = parts[0];
      let after = t;
      for (let i = 1; i < parts.length; i++) {
        const br = doc.createElementNS(ns, `${t.prefix || 'w'}:br`);
        const nt = doc.createElementNS(ns, `${t.prefix || 'w'}:t`);
        nt.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
        nt.appendChild(doc.createTextNode(parts[i]));
        after.parentNode.insertBefore(br, after.nextSibling);
        br.parentNode.insertBefore(nt, br.nextSibling);
        after = nt;
      }
    }
  }
  if (kind === 'docx') {
    for (const n of textNodes(p, ns)) {
      const t = n.parentNode;
      if (/^\s|\s$/.test(t.textContent)) t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
    }
  } else {
    // 한글: 줄 배치 캐시를 지워 다시 계산하게
    for (const c of [...p.childNodes]) if (c.nodeType === 1 && c.localName === 'linesegarray') p.removeChild(c);
  }
  return true;
}

function replaceAll(doc, kind, resolve) {
  const ns = NS[kind];
  let n = 0;
  for (const p of paragraphs(doc, ns)) if (replaceInParagraph(p, ns, kind, resolve)) n++;
  return n;
}

/**
 * 문서 읽기
 * 반환: { kind, name, vars: [변수 이름], preview: [문단 글], sections, headerVars: [머리말·꼬리말 변수], b64 }
 */
export async function loadDocument(file, JSZip) {
  const buf = await file.arrayBuffer();
  return inspectDocument(new Uint8Array(buf), file.name || '', JSZip);
}

export async function inspectDocument(bytes, name, JSZip) {
  const zip = await JSZip.loadAsync(bytes);
  let kind = null;
  if (zip.file('Contents/section0.xml')) kind = 'hwpx';
  else if (zip.file('word/document.xml')) kind = 'docx';
  if (!kind) throw new Error('한글(.hwpx) 또는 워드(.docx) 문서가 아니에요. 한글 .hwp 파일은 한글에서 "다른 이름으로 저장 → HWPX"로 바꿔 주세요.');
  const ns = NS[kind];
  const vars = [], headerVars = [], preview = [];
  const add = (list, k) => { if (!list.includes(k)) list.push(k); };
  for (const part of partsOf(kind, zip)) {
    const doc = parse(await zip.file(part).async('string'));
    const isHF = /header|footer/i.test(part);
    for (const p of paragraphs(doc, ns)) {
      const t = paraText(p, ns);
      for (const m of t.matchAll(PH)) { add(vars, m[1]); if (isHF) add(headerVars, m[1]); }
      if (part === mainPart(kind) && preview.length < 400) preview.push(t);
    }
  }
  return { kind, name, vars, headerVars, preview, sections: kind === 'hwpx' ? partsOf(kind, zip).length : 1, size: bytes.length };
}

/** 미리보기: 문단 글에서 {{…}}를 값으로(값 자리 표시를 위해 조각으로 나눠 반환) */
export function previewParagraphs(info, resolve) {
  return info.preview.map(t => {
    const segs = [];
    let last = 0;
    for (const m of t.matchAll(PH)) {
      if (m.index > last) segs.push({ t: t.slice(last, m.index) });
      const v = resolve(m[1]);
      segs.push({ t: v == null ? m[0] : String(v), v: true, missing: v == null, key: m[1] });
      last = m.index + m[0].length;
    }
    if (last < t.length) segs.push({ t: t.slice(last) });
    return segs;
  });
}

// 복제한 문단 안 그리기 개체의 id가 겹치지 않게 옮긴다
function shiftIds(el, k) {
  const all = [el, ...el.getElementsByTagName('*')];
  for (const e of all) {
    for (const a of ['instid']) if (e.hasAttribute && e.hasAttribute(a) && /^\d+$/.test(e.getAttribute(a))) e.setAttribute(a, String((Number(e.getAttribute(a)) + k * 7919) % 2147483647));
    if (e.localName && /^(tbl|pic|rect|ellipse|line|polygon|curve|arc|container|equation|ole|textart|docPr)$/.test(e.localName) && /^\d+$/.test(e.getAttribute('id') || '')) {
      e.setAttribute('id', String((Number(e.getAttribute('id')) + k * 7919) % 2147483647));
    }
  }
}

const HWPX_SECTION_CTRLS = new Set(['colPr', 'header', 'footer', 'pageNum', 'pageHiding', 'newNum', 'pageNumCtrl']);

/** 한 파일로 합치기 → Uint8Array */
async function mergeCombined(zip, kind, rows, resolveFor) {
  const ns = NS[kind];
  const path = mainPart(kind);
  const doc = parse(await zip.file(path).async('string'));
  if (kind === 'hwpx') {
    const sec = doc.documentElement;
    const tpl = [...sec.childNodes].filter(n => n.nodeType === 1);
    for (const n of tpl) sec.removeChild(n);
    rows.forEach((row, r) => {
      const clones = tpl.map(n => n.cloneNode(true));
      if (r > 0) {
        const first = clones.find(n => n.localName === 'p');
        if (first) {
          // 구역 설정(secPr)과 단·머리말·쪽 번호 같은 구역 조판 부호는 첫 묶음에만
          for (const s of [...first.getElementsByTagNameNS(ns, 'secPr')]) s.parentNode.removeChild(s);
          for (const c of [...first.getElementsByTagNameNS(ns, 'ctrl')]) {
            const kids = [...c.childNodes].filter(x => x.nodeType === 1);
            if (kids.length && kids.every(x => HWPX_SECTION_CTRLS.has(x.localName))) c.parentNode.removeChild(c);
          }
          first.setAttribute('pageBreak', '1');
        }
        clones.forEach(c => shiftIds(c, r));
      }
      const tmp = doc.createElementNS(sec.namespaceURI, sec.tagName);
      clones.forEach(c => tmp.appendChild(c));
      const resolve = resolveFor(row, r);
      for (const p of paragraphs(tmp, ns)) replaceInParagraph(p, ns, kind, resolve);
      while (tmp.firstChild) sec.appendChild(tmp.firstChild);
    });
  } else {
    const body = doc.getElementsByTagNameNS(ns, 'body')[0];
    const kids = [...body.childNodes].filter(n => n.nodeType === 1);
    const sectPr = kids.length && kids[kids.length - 1].localName === 'sectPr' ? kids.pop() : null;
    for (const n of kids) body.removeChild(n);
    rows.forEach((row, r) => {
      const clones = kids.map(n => n.cloneNode(true));
      if (r > 0) clones.forEach(c => shiftIds(c, r));
      const resolve = resolveFor(row, r);
      for (const c of clones) {
        if (c.localName === 'p') replaceInParagraph(c, ns, kind, resolve);
        for (const p of [...c.getElementsByTagNameNS(ns, 'p')]) replaceInParagraph(p, ns, kind, resolve);
      }
      if (r > 0) {
        // 쪽 나눔: 앞 묶음 마지막 문단 끝에 넣는다(빈 줄이 생기지 않게). 표로 끝나면 쪽 나눔 문단을 따로
        const prev = body.lastElementChild;
        const br = doc.createElementNS(ns, 'w:r');
        const b = doc.createElementNS(ns, 'w:br'); b.setAttributeNS(ns, 'w:type', 'page'); br.appendChild(b);
        if (prev && prev.localName === 'p') prev.appendChild(br);
        else { const p = doc.createElementNS(ns, 'w:p'); p.appendChild(br); body.appendChild(p); }
      }
      clones.forEach(c => body.appendChild(c));
    });
    if (sectPr) body.appendChild(sectPr);
  }
  zip.file(path, ser(doc));
  // 머리말·꼬리말(워드)·다른 구역은 첫 줄 값으로
  for (const part of partsOf(kind, zip)) {
    if (part === path) continue;
    const d = parse(await zip.file(part).async('string'));
    if (replaceAll(d, kind, resolveFor(rows[0], 0))) zip.file(part, ser(d));
  }
  return finish(zip, kind);
}

/** 한 줄로 문서 하나 */
async function mergeOne(JSZip, bytes, kind, resolve) {
  const zip = await JSZip.loadAsync(bytes);
  for (const part of partsOf(kind, zip)) {
    const d = parse(await zip.file(part).async('string'));
    if (replaceAll(d, kind, resolve)) zip.file(part, ser(d));
  }
  return finish(zip, kind);
}

// 한글 꾸러미는 mimetype을 압축하지 않고 맨 앞에 둬야 한다
async function finish(zip, kind) {
  if (kind === 'hwpx' && zip.file('mimetype')) {
    const mt = await zip.file('mimetype').async('string');
    const rest = {};
    for (const [n, f] of Object.entries(zip.files)) if (n !== 'mimetype' && !f.dir) rest[n] = await f.async('uint8array');
    const z2 = new globalThis.JSZip();
    z2.file('mimetype', mt, { compression: 'STORE' });
    for (const [n, d] of Object.entries(rest)) z2.file(n, d);
    return z2.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

const safeName = s => String(s || '').replace(/[\\/:*?"<>|\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

/**
 * 메일머지
 * opts: { JSZip, bytes, kind, rows(고른 줄들: [{row, index}]), resolveFor(row,index)→(key→값|null), mode: 'combined'|'separate', nameFor(row,index)→파일 이름, base }
 * 반환: { bytes, name, type }
 */
export async function mergeDocument(opts) {
  const { JSZip, bytes, kind, rows, resolveFor, mode, nameFor, base = '문서', onProgress } = opts;
  const ext = kind === 'hwpx' ? 'hwpx' : 'docx';
  if (mode === 'combined') {
    const zip = await JSZip.loadAsync(bytes);
    const out = await mergeCombined(zip, kind, rows.map(r => r.row), (row, r) => resolveFor(rows[r].row, rows[r].index));
    return { bytes: out, name: `${base}_${rows.length}부.${ext}`, type: kind === 'hwpx' ? 'application/hwp+zip' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  }
  const outZip = new JSZip();
  const used = new Map();
  for (let i = 0; i < rows.length; i++) {
    const { row, index } = rows[i];
    const data = await mergeOne(JSZip, bytes, kind, resolveFor(row, index));
    let nm = safeName(nameFor(row, index)) || `${index + 1}`;
    const k = nm.toLowerCase();
    if (used.has(k)) { used.set(k, used.get(k) + 1); nm = `${nm} (${used.get(k)})`; } else used.set(k, 1);
    outZip.file(`${String(index + 1).padStart(String(rows.length).length, '0')}_${nm}.${ext}`, data);
    if (onProgress) onProgress(i + 1, rows.length);
  }
  return { bytes: await outZip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), name: `${base}_${rows.length}부.zip`, type: 'application/zip' };
}
