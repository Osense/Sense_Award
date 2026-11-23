// 쎈스 어워드 — 글자 맞춤 엔진
// 미리보기·PDF·HWPX가 모두 이 결과(줄별·글자별 좌표)를 그대로 쓴다.
// 단위: 길이 mm, 글자 크기 pt, 장평·자간·줄간격 %.

export const PT_TO_MM = 25.4 / 72;

/**
 * font: { upm, asc, desc, adv(cp) -> 글자 너비(em 비율), has(cp) -> bool }
 * fallback: 같은 모양의 대체 글꼴(없는 글자용) 또는 null
 */
function charAdvance(cp, font, fallback) {
  if (font.has(cp) || !fallback) return { em: font.adv(cp), fb: false };
  return { em: fallback.adv(cp), fb: true };
}

function measureWord(chars, sizeMm, scale, spacing) {
  // 글자마다: 너비 × 장평 + 자간(글자 크기의 %)
  let w = 0;
  for (const c of chars) w += c.em * sizeMm * scale / 100 + spacing * sizeMm / 100;
  return w;
}

function toChars(str, font, fallback) {
  const out = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    const a = charAdvance(cp, font, fallback);
    out.push({ ch, cp, em: a.em, fb: a.fb });
  }
  return out;
}

// 어절 단위 줄 나눔. 어절 하나가 한 줄보다 길면 그 어절만 글자 단위로 끊는다.
// 문단 맨 앞 공백은 들여쓰기로 살린다(첫 줄에만, 공백 하나 = 한 칸 = 한글 한 글자 너비, 늘리지 않는 고정 너비).
function wrapParagraph(par, width, sizeMm, scale, spacing, font, fallback, spaceEm) {
  const lead = (par.match(/^ +/) || [''])[0].length;
  const words = par.slice(lead).split(/ +/).filter((w, i, arr) => w.length || arr.length === 1);
  const spaceW = spaceEm * sizeMm * scale / 100 + spacing * sizeMm / 100;
  // 원고지처럼 공백 하나 = 한 칸(한글 한 글자 너비)
  const indentW = Math.min(lead * (sizeMm * scale / 100 + spacing * sizeMm / 100), width * 0.5);
  const lines = [];
  let cur = lead ? [{ indent: true, n: lead, w: indentW }] : [];
  let curW = lead ? indentW : 0;
  let broke = false;
  const hasWord = () => cur.some(it => !it.indent);
  const push = () => { lines.push(cur); cur = []; curW = 0; };
  for (const word of words) {
    const chars = toChars(word, font, fallback);
    const ww = measureWord(chars, sizeMm, scale, spacing);
    const need = hasWord() ? curW + spaceW + ww : curW + ww;
    if (need <= width + 1e-6) {
      if (hasWord()) cur.push({ space: true, w: spaceW });
      cur.push({ chars, w: ww });
      curW = need;
      continue;
    }
    if (hasWord()) push();
    if (curW + ww <= width + 1e-6) { cur.push({ chars, w: ww }); curW += ww; continue; }
    // 어절이 너무 길다 → 글자 단위로 끊기(맞춤 실패 신호로도 쓴다)
    broke = true;
    let piece = [];
    let pw = 0;
    for (const c of chars) {
      const cw = c.em * sizeMm * scale / 100 + spacing * sizeMm / 100;
      if (piece.length && curW + pw + cw > width + 1e-6) {
        cur.push({ chars: piece, w: pw }); push();
        piece = []; pw = 0;
      }
      piece.push(c); pw += cw;
    }
    if (piece.length) { cur.push({ chars: piece, w: pw }); curW += pw; }
  }
  if (cur.length || !lines.length) push();
  return { lines, broke };
}

function tryFit(text, box, st, sizePt, scale, spacing, font, fallback) {
  const sizeMm = sizePt * PT_TO_MM;
  const spaceEm = font.adv(32) || 0.3;
  const pars = String(text).split(/\r?\n/);
  let lines = [];
  let broke = false;
  for (const p of pars) {
    const r = wrapParagraph(p, box.w, sizeMm, scale, spacing, font, fallback, spaceEm);
    r.lines.forEach((l, i) => lines.push({ items: l, last: i === r.lines.length - 1 }));
    broke = broke || r.broke;
  }
  const pitch = sizeMm * st.lineHeight / 100;
  const contentH = (lines.length - 1) * pitch + sizeMm;
  const maxLines = st.maxLines > 0 ? st.maxLines : Infinity;
  const fits = !broke && lines.length <= maxLines && contentH <= box.h + 1e-6;
  return { fits, lines, sizeMm, sizePt, scale, spacing, pitch, contentH };
}

// 줄이는 순서: 장평 → 자간 → (줄 나눔은 줄 수 한도 안에서 늘 허용) → 글자 크기
function* compressionSteps(st) {
  const s0 = st.scale ?? 100;
  const sMin = Math.min(s0, st.minScale ?? s0);
  const p0 = st.spacing ?? 0;
  const pMin = Math.min(p0, st.minSpacing ?? p0);
  for (let s = s0; s >= sMin - 1e-9; s -= 2) yield [Math.max(s, sMin), p0];
  if ((s0 - sMin) % 2 !== 0) yield [sMin, p0];
  for (let p = p0 - 1; p >= pMin - 1e-9; p -= 1) yield [sMin, Math.max(p, pMin)];
}

export function fitText(text, box, st, font, fallback) {
  const maxSize = st.size;
  const minSize = Math.min(st.minSize ?? maxSize, maxSize);
  let best = null;
  for (let size = maxSize; size >= minSize - 1e-9; size = Math.round((size - 0.5) * 10) / 10) {
    for (const [scale, spacing] of compressionSteps(st)) {
      const r = tryFit(text, box, st, size, scale, spacing, font, fallback);
      if (r.fits) return { ...r, overflow: false };
      best = r;
    }
  }
  return { ...best, overflow: true };
}

/** 줄 배치 결과 → 글자별 좌표 */
export function placeLines(fit, box, st, font) {
  const { sizeMm, scale, spacing, pitch, contentH } = fit;
  const k = sizeMm;
  const total = font.asc + font.desc;
  const ascShare = total > 0 ? font.asc / total : 0.8;
  let top = box.y;
  if (st.valign === 'middle') top = box.y + (box.h - contentH) / 2;
  else if (st.valign === 'bottom') top = box.y + box.h - contentH;
  const out = [];
  fit.lines.forEach((line, li) => {
    const baseline = top + li * pitch + k * ascShare;
    // 줄에 있는 글자를 펼친다
    const glyphs = [];
    let spaces = 0;
    const ind = line.items[0] && line.items[0].indent ? line.items[0].w : 0;
    for (const it of line.items) {
      if (it.indent) continue;
      if (it.space) { glyphs.push({ space: true, w: it.w }); spaces++; continue; }
      for (const c of it.chars) glyphs.push({ ...c, w: c.em * k * scale / 100 + spacing * k / 100 });
    }
    // 마지막 글자 뒤 자간은 빼고 줄 너비를 잰다
    let lineW = glyphs.reduce((a, g) => a + g.w, 0);
    const lastReal = [...glyphs].reverse().find(g => !g.space);
    if (lastReal) lineW -= spacing * k / 100;
    const extra = box.w - ind - lineW;
    let x = box.x + ind;
    let perSpace = 0;
    let perGap = 0;
    const align = st.align || 'left';
    const realCount = glyphs.filter(g => !g.space).length;
    if (align === 'center') x += extra / 2;
    else if (align === 'right') x += extra;
    else if (align === 'justify') {
      if (!line.last && spaces > 0 && extra > 0) perSpace = extra / spaces;
    } else if (align === 'distribute') {
      const gaps = glyphs.length - 1;
      if (realCount <= 1) x += extra / 2;
      else if (extra > 0 && gaps > 0) perGap = extra / gaps;
      else if (extra < 0) x += extra / 2;
    }
    const chars = [];
    glyphs.forEach((g, gi) => {
      if (g.space) { x += g.w + perSpace + perGap; return; }
      chars.push({ ch: g.ch, cp: g.cp, fb: g.fb, x, w: g.em * k * scale / 100 });
      x += g.w + (gi < glyphs.length - 1 ? perGap : 0);
    });
    const text = line.items.map(it => it.indent ? ' '.repeat(it.n) : it.space ? ' ' : it.chars.map(c => c.ch).join('')).join('');
    out.push({ text, baseline, top: top + li * pitch, chars, last: line.last });
  });
  return out;
}

export function layoutField(text, box, st, font, fallback) {
  const fit = fitText(text, box, st, font, fallback);
  const lines = placeLines(fit, box, st, font);
  return {
    sizePt: fit.sizePt, sizeMm: fit.sizeMm, scale: fit.scale, spacing: fit.spacing,
    overflow: fit.overflow, lines, contentH: fit.contentH,
  };
}
