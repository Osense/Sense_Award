// 배경 지우기: 휴대폰으로 찍거나 스캔한 JPG 도장·인장·로고에서 종이(배경)를 투명하게 만든다.
//
// 1) 종이색 지도: 그림을 칸(약 24×24)으로 나눠 칸마다 밝은 쪽 92% 값(=종이)을 잡고 부드럽게 이어 붙인다.
//    → 그림자·조명 얼룩·누런 종이를 고르게 펴서(나눗셈) 종이는 하얗게, 잉크는 그대로.
// 2) 잉크 농도 = 1 − (펴진 색에서 가장 어두운 채널). 빨간 인주는 초록·파랑이 어두워 진하게 잡힌다.
// 3) 투명도 = 농도를 문턱값~(문턱값+폭)에서 부드럽게(가장자리 계단 없이). strength(0~100)가 문턱값을 정한다.
// 4) 잉크 색 되살리기: 펴진 색 c = 1 − α(1 − ink) 에서 ink를 구해 반투명 가장자리가 분홍빛으로 뜨지 않게.
// 5) 작은 점(압축 얼룩) 지우기 → 잉크가 있는 곳만 남게 잘라 내기(trim)

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function loadImg(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

/** 종이색 지도(채널별, 0~255). 칸마다 밝은 쪽 백분위 → 3×3 흐림 → 쌍선형 보간 */
function paperMap(p, w, h) {
  const cell = Math.max(8, Math.round(Math.max(w, h) / 24));
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
  const grid = new Float32Array(gw * gh * 3);
  const lum = [];
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      lum.length = 0;
      for (let y = gy * cell; y < Math.min(h, (gy + 1) * cell); y += 2) {
        for (let x = gx * cell; x < Math.min(w, (gx + 1) * cell); x += 2) {
          const i = (y * w + x) * 4;
          lum.push([p[i] + p[i + 1] + p[i + 2], i]);
        }
      }
      lum.sort((a, b) => a[0] - b[0]);
      // 밝은 쪽 92%~98% 평균 = 그 칸의 종이색
      const a = Math.floor(lum.length * 0.92), b = Math.max(a + 1, Math.floor(lum.length * 0.98));
      let r = 0, g = 0, bl = 0, n = 0;
      for (let k = a; k < b && k < lum.length; k++) { const i = lum[k][1]; r += p[i]; g += p[i + 1]; bl += p[i + 2]; n++; }
      const o = (gy * gw + gx) * 3;
      grid[o] = n ? r / n : 255; grid[o + 1] = n ? g / n : 255; grid[o + 2] = n ? bl / n : 255;
    }
  }
  // 잉크가 칸을 거의 다 덮은 곳(큰 도장 안쪽)은 종이색이 어둡게 잡힌다 → 주변 칸의 밝은 값으로 메운다(3×3 최댓값 후 평균)
  const mx = new Float32Array(grid.length);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) for (let c = 0; c < 3; c++) {
    let m = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = clamp(gx + dx, 0, gw - 1), y = clamp(gy + dy, 0, gh - 1);
      m = Math.max(m, grid[(y * gw + x) * 3 + c]);
    }
    mx[(gy * gw + gx) * 3 + c] = m;
  }
  const sm = new Float32Array(grid.length);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) for (let c = 0; c < 3; c++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = clamp(gx + dx, 0, gw - 1), y = clamp(gy + dy, 0, gh - 1);
      s += mx[(y * gw + x) * 3 + c]; n++;
    }
    sm[(gy * gw + gx) * 3 + c] = Math.max(60, s / n);
  }
  return (x, y, c) => {
    const fx = clamp(x / cell - 0.5, 0, gw - 1), fy = clamp(y / cell - 0.5, 0, gh - 1);
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(gw - 1, x0 + 1), y1 = Math.min(gh - 1, y0 + 1);
    const tx = fx - x0, ty = fy - y0;
    const v = (xx, yy) => sm[(yy * gw + xx) * 3 + c];
    return (v(x0, y0) * (1 - tx) + v(x1, y0) * tx) * (1 - ty) + (v(x0, y1) * (1 - tx) + v(x1, y1) * tx) * ty;
  };
}

/**
 * 배경 지우기
 * @param {string} src  그림(data URL)
 * @param {object} o    { strength: 0~100(기본 50, 클수록 더 많이 지움), recolor: null | [r,g,b], trim: true, maxSide: 900, keepAll: 지우지 않기 }
 * @returns {Promise<{png: string, w: number, h: number}>}
 */
export async function removeBackground(src, o = {}) {
  const strength = clamp(o.strength ?? 50, 0, 100);
  const im = await loadImg(src);
  const maxSide = o.maxSide || 900;
  const k = Math.min(1, maxSide / Math.max(im.naturalWidth, im.naturalHeight));
  const w = Math.max(1, Math.round(im.naturalWidth * k)), h = Math.max(1, Math.round(im.naturalHeight * k));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(im, 0, 0, w, h);
  const data = g.getImageData(0, 0, w, h);
  const p = data.data;
  const bg = paperMap(p, w, h);

  // 문턱값: 강도 0 → 0.04(옅은 잉크도 남김), 50 → 0.14, 100 → 0.34(진한 잉크만)
  const t0 = 0.04 + Math.pow(strength / 100, 1.4) * 0.30;
  const t1 = t0 + 0.16;
  const alpha = new Float32Array(w * h);
  const ink = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, j = y * w + x;
      // 종이로 나눠 펴기(0~1, 1 = 종이)
      const r = clamp(p[i] / bg(x, y, 0), 0, 1), gg = clamp(p[i + 1] / bg(x, y, 1), 0, 1), b = clamp(p[i + 2] / bg(x, y, 2), 0, 1);
      const dens = 1 - Math.min(r, gg, b);
      let a = smooth(t0, t1, dens) * (p[i + 3] / 255);
      if (o.keepAll) {
        // 지우지 않기: 원래 투명도 그대로(붉은색 맞추기면 어두운 만큼만 남김)
        a = p[i + 3] / 255;
        if (o.recolor) a *= Math.min(1, (1 - (p[i] + p[i + 1] + p[i + 2]) / 765) * 1.6);
        alpha[j] = a;
        ink[j * 3] = p[i] / 255; ink[j * 3 + 1] = p[i + 1] / 255; ink[j * 3 + 2] = p[i + 2] / 255;
        continue;
      }
      alpha[j] = a;
      // 잉크 색 되살리기: c = 1 − a(1 − ink) → ink = 1 − (1 − c)/a
      const aa = Math.max(a, 0.35);
      ink[j * 3] = clamp(1 - (1 - r) / aa, 0, 1);
      ink[j * 3 + 1] = clamp(1 - (1 - gg) / aa, 0, 1);
      ink[j * 3 + 2] = clamp(1 - (1 - b) / aa, 0, 1);
    }
  }
  // 작은 점 지우기: 주변 8칸 중 잉크가 2칸 이하인 외톨이 점은 지운다
  const keep = new Float32Array(alpha);
  for (let y = 1; y < (o.keepAll ? 0 : h - 1); y++) {
    for (let x = 1; x < w - 1; x++) {
      const j = y * w + x;
      if (alpha[j] <= 0.05) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && alpha[j + dy * w + dx] > 0.2) n++;
      if (n <= 2) keep[j] = 0;
    }
  }
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const j = y * w + x, i = j * 4;
      const a = keep[j];
      if (o.recolor) {
        p[i] = o.recolor[0]; p[i + 1] = o.recolor[1]; p[i + 2] = o.recolor[2];
      } else {
        p[i] = Math.round(ink[j * 3] * 255); p[i + 1] = Math.round(ink[j * 3 + 1] * 255); p[i + 2] = Math.round(ink[j * 3 + 2] * 255);
      }
      p[i + 3] = Math.round(a * 255);
      if (a > 0.08) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
  }
  g.putImageData(data, 0, 0);
  if (o.trim === false || maxX < 0) { minX = 0; minY = 0; maxX = w - 1; maxY = h - 1; }
  else {
    const pad = Math.round(Math.max(w, h) * 0.01);
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad); maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
  }
  const tw = maxX - minX + 1, th = maxY - minY + 1;
  const out = document.createElement('canvas'); out.width = tw; out.height = th;
  out.getContext('2d').drawImage(cv, minX, minY, tw, th, 0, 0, tw, th);
  return { png: out.toDataURL('image/png'), w: tw, h: th };
}

/** 이미 투명한 PNG인지(가장자리 픽셀 대부분이 투명) */
export async function hasTransparency(src) {
  const im = await loadImg(src);
  const w = Math.min(200, im.naturalWidth), h = Math.max(1, Math.round(im.naturalHeight * w / im.naturalWidth));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(im, 0, 0, w, h);
  const p = g.getImageData(0, 0, w, h).data;
  let n = 0, t = 0;
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) { n++; if (p[(y * w + x) * 4 + 3] < 128) t++; }
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) { n++; if (p[(y * w + x) * 4 + 3] < 128) t++; }
  return t / n > 0.6;
}
