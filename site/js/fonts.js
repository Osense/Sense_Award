// 인쇄용 글꼴 목록과 불러오기
// 모든 글꼴은 웹 탑재·PDF 임베드가 허용된 무료 글꼴이다(라이선스는 fonts/print 참고).

export const FONTS = [
  {
    id: 'chosun-gs', name: '조선궁서체', hwpFace: '조선궁서체', kind: '궁서',
    regular: 'fonts/print/ChosunGs.woff', bold: null,
    license: '조선일보 전용서체 — 개인·기업 무료, 임베딩 허용',
    url: 'https://www.sandollcloud.com/font/FREE/6221.html',
  },
  {
    id: 'nanum-myeongjo', name: '나눔명조', hwpFace: '나눔명조', kind: '명조',
    regular: 'fonts/print/NanumMyeongjo-Regular.ttf', bold: 'fonts/print/NanumMyeongjo-Bold.ttf',
    license: 'SIL OFL 1.1', url: 'https://hangeul.naver.com/font',
  },
  {
    id: 'gowun-batang', name: '고운바탕', hwpFace: 'Gowun Batang', kind: '바탕',
    regular: 'fonts/print/GowunBatang-Regular.ttf', bold: 'fonts/print/GowunBatang-Bold.ttf',
    license: 'SIL OFL 1.1', url: 'https://fonts.google.com/specimen/Gowun+Batang',
  },
  {
    id: 'nanum-gothic', name: '나눔고딕', hwpFace: '나눔고딕', kind: '고딕',
    regular: 'fonts/print/NanumGothic-Regular.ttf', bold: 'fonts/print/NanumGothic-Bold.ttf',
    license: 'SIL OFL 1.1', url: 'https://hangeul.naver.com/font',
  },
  {
    id: 'gowun-dodum', name: '고운돋움', hwpFace: 'Gowun Dodum', kind: '돋움',
    regular: 'fonts/print/GowunDodum-Regular.ttf', bold: null,
    license: 'SIL OFL 1.1', url: 'https://fonts.google.com/specimen/Gowun+Dodum',
  },
];

export const DEFAULT_FONT = 'chosun-gs';
export const FALLBACK_FONT = 'nanum-myeongjo';

export function fontInfo(id) {
  return FONTS.find(f => f.id === id) || FONTS[0];
}

/** 굵게를 고른 글꼴에 굵은 파일이 없으면 가짜 굵게(외곽선 덧그리기)로 처리한다 */
export function variantKey(id, bold) {
  const info = fontInfo(id);
  return bold && info.bold ? `${info.id}:bold` : `${info.id}:regular`;
}

export function needsFauxBold(id, bold) {
  return !!bold && !fontInfo(id).bold;
}

export class FontStore {
  constructor(fontkit, fetchBytes) {
    this.fontkit = fontkit;
    this.fetchBytes = fetchBytes; // (path) => Promise<Uint8Array>
    this.cache = new Map();   // key → handle
    this.loading = new Map(); // key → Promise
  }

  isLoaded(key) { return this.cache.has(key); }
  get(key) { return this.cache.get(key) || null; }

  load(key) {
    if (this.cache.has(key)) return Promise.resolve(this.cache.get(key));
    if (this.loading.has(key)) return this.loading.get(key);
    const [id, weight] = key.split(':');
    const info = fontInfo(id);
    const path = weight === 'bold' && info.bold ? info.bold : info.regular;
    const p = this.fetchBytes(path).then(woffToSfnt).then(bytes => {
      const fk = this.fontkit.create(bytes);
      const handle = makeHandle(key, info, fk, bytes);
      this.cache.set(key, handle);
      this.loading.delete(key);
      return handle;
    }).catch(err => { this.loading.delete(key); throw err; });
    this.loading.set(key, p);
    return p;
  }
}

// WOFF는 글자를 꺼낼 때마다 표를 다시 풀어 매우 느리므로, 불러올 때 한 번 TTF로 푼다.
async function inflate(bytes) {
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function woffToSfnt(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0) !== 0x774F4646) return bytes; // 'wOFF'가 아니면 그대로
  const flavor = dv.getUint32(4);
  const numTables = dv.getUint16(12);
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const o = 44 + i * 20;
    tables.push({
      tag: dv.getUint32(o), offset: dv.getUint32(o + 4), compLength: dv.getUint32(o + 8),
      origLength: dv.getUint32(o + 12), checksum: dv.getUint32(o + 16),
    });
  }
  const datas = await Promise.all(tables.map(t => {
    const raw = bytes.subarray(t.offset, t.offset + t.compLength);
    return t.compLength < t.origLength ? inflate(raw) : Promise.resolve(raw);
  }));
  let size = 12 + numTables * 16;
  const offsets = datas.map(d => { const o = size; size += (d.length + 3) & ~3; return o; });
  const out = new Uint8Array(size);
  const ov = new DataView(out.buffer);
  let es = 0; while ((1 << (es + 1)) <= numTables) es++;
  const sr = (1 << es) * 16;
  ov.setUint32(0, flavor); ov.setUint16(4, numTables); ov.setUint16(6, sr); ov.setUint16(8, es); ov.setUint16(10, numTables * 16 - sr);
  tables.forEach((t, i) => {
    const o = 12 + i * 16;
    ov.setUint32(o, t.tag); ov.setUint32(o + 4, t.checksum); ov.setUint32(o + 8, offsets[i]); ov.setUint32(o + 12, datas[i].length);
    out.set(datas[i], offsets[i]);
  });
  return out;
}

function makeHandle(key, info, fk, bytes) {
  const upm = fk.unitsPerEm;
  const advCache = new Map();
  const pathCache = new Map();
  return {
    key, info, fk, bytes, upm,
    asc: fk.ascent / upm,
    desc: Math.abs(fk.descent) / upm,
    has(cp) { return cp === 32 || fk.hasGlyphForCodePoint(cp); },
    adv(cp) {
      let v = advCache.get(cp);
      if (v === undefined) {
        const g = fk.glyphForCodePoint(cp);
        v = (g && g.advanceWidth ? g.advanceWidth : upm * 0.5) / upm;
        advCache.set(cp, v);
      }
      return v;
    },
    path(cp) {
      let d = pathCache.get(cp);
      if (d === undefined) {
        const g = fk.glyphForCodePoint(cp);
        d = g ? g.path.toSVG() : '';
        pathCache.set(cp, d);
      }
      return d;
    },
  };
}
