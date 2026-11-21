// 마크 프레임(캔바의 프레임처럼): 원형·사각·둥근 사각 틀 안에 그림을 채워 넣는다.
// 그림은 틀을 늘 덮도록(cover) 놓고, 확대(zoom ≥ 1)와 이동(panX/panY, mm)으로 틀 안에서 고른다.
// 인쇄·PDF·한글에는 틀 모양으로 잘라 낸 고해상도 PNG를 구워 넣는다(틀 밖은 투명).

export const MARK_SHAPES = [
  { id: 'circle', name: '원형' },
  { id: 'square', name: '사각' },
  { id: 'rounded', name: '둥근 사각' },
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const n3 = v => Math.round(v * 1000) / 1000;

export function newMark(over = {}) {
  return { id: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: '마크', shape: 'circle', x: 90, y: 120, w: 30, h: 30, src: null, imgW: 0, imgH: 0, zoom: 1, panX: 0, panY: 0, ...over };
}

/** 틀 안 그림 자리(mm). 그림이 없으면 null */
export function markImageBox(m) {
  if (!m.src || !m.imgW || !m.imgH) return null;
  const s = Math.max(m.w / m.imgW, m.h / m.imgH) * Math.max(1, m.zoom || 1);
  const w = m.imgW * s, h = m.imgH * s;
  const mx = (w - m.w) / 2, my = (h - m.h) / 2;
  const px = clamp(m.panX || 0, -mx, mx), py = clamp(m.panY || 0, -my, my);
  return { x: m.x + (m.w - w) / 2 + px, y: m.y + (m.h - h) / 2 + py, w, h };
}

/** 확대·이동 값을 틀을 덮는 범위 안으로 */
export function clampMark(m) {
  m.zoom = clamp(Number(m.zoom) || 1, 1, 6);
  if (m.shape === 'circle') { const d = Math.min(m.w, m.h); m.w = d; m.h = d; }
  m.w = clamp(m.w, 6, 200); m.h = clamp(m.h, 6, 280);
  if (m.src && m.imgW) {
    const s = Math.max(m.w / m.imgW, m.h / m.imgH) * m.zoom;
    const mx = (m.imgW * s - m.w) / 2, my = (m.imgH * s - m.h) / 2;
    m.panX = clamp(m.panX || 0, -mx, mx);
    m.panY = clamp(m.panY || 0, -my, my);
  } else { m.panX = 0; m.panY = 0; }
  return m;
}

/** 틀 모양 경로(mm, 종이 좌표) */
export function markPath(m, ox = 0, oy = 0) {
  const x = m.x - ox, y = m.y - oy, w = m.w, h = m.h;
  if (m.shape === 'circle') {
    const rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry;
    return `M${n3(cx - rx)} ${n3(cy)} A${n3(rx)} ${n3(ry)} 0 1 0 ${n3(cx + rx)} ${n3(cy)} A${n3(rx)} ${n3(ry)} 0 1 0 ${n3(cx - rx)} ${n3(cy)} Z`;
  }
  const r = m.shape === 'rounded' ? Math.min(w, h) * 0.14 : 0;
  if (!r) return `M${n3(x)} ${n3(y)} H${n3(x + w)} V${n3(y + h)} H${n3(x)} Z`;
  return `M${n3(x + r)} ${n3(y)} H${n3(x + w - r)} A${n3(r)} ${n3(r)} 0 0 1 ${n3(x + w)} ${n3(y + r)} V${n3(y + h - r)} A${n3(r)} ${n3(r)} 0 0 1 ${n3(x + w - r)} ${n3(y + h)} H${n3(x + r)} A${n3(r)} ${n3(r)} 0 0 1 ${n3(x)} ${n3(y + h - r)} V${n3(y + r)} A${n3(r)} ${n3(r)} 0 0 1 ${n3(x + r)} ${n3(y)} Z`;
}

/**
 * 화면용 SVG. opts.placeholder: 빈 틀 표시(점선 + 기호), opts.crop: 틀 밖 그림을 흐리게 보여 준다(자르기 중)
 */
export function markSvg(m, opts = {}) {
  const id = `mk-${m.id}`;
  const box = markImageBox(m);
  if (!box) {
    if (!opts.placeholder) return '';
    const cx = m.x + m.w / 2, cy = m.y + m.h / 2, s = Math.min(m.w, m.h);
    return `<g class="mark-ph"><path d="${markPath(m)}"/><path class="plus" d="M${n3(cx - s * 0.12)} ${n3(cy - s * 0.06)} H${n3(cx + s * 0.12)} M${n3(cx)} ${n3(cy - s * 0.18)} V${n3(cy + s * 0.06)}"/>`
      + `<text x="${n3(cx)}" y="${n3(cy + s * 0.22)}" font-size="${n3(Math.max(2.4, s * 0.11))}" text-anchor="middle">${m.name || '마크'}</text></g>`;
  }
  const img = `href="${m.src}" x="${n3(box.x)}" y="${n3(box.y)}" width="${n3(box.w)}" height="${n3(box.h)}" preserveAspectRatio="none"`;
  return `<defs><clipPath id="${id}"><path d="${markPath(m)}"/></clipPath></defs>`
    + (opts.crop ? `<image ${img} opacity=".35"/>` : '')
    + `<image ${img} clip-path="url(#${id})"/>`;
}

/** 틀 모양으로 잘라 낸 PNG(data URL)를 굽는다. dpi 300, 긴 변 최대 1600px */
export async function bakeMark(m, dpi = 300) {
  const box = markImageBox(m);
  if (!box) return null;
  const pxPerMm = Math.min(dpi / 25.4, 1600 / Math.max(m.w, m.h));
  const W = Math.max(1, Math.round(m.w * pxPerMm)), H = Math.max(1, Math.round(m.h * pxPerMm));
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = m.src; });
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.scale(pxPerMm, pxPerMm);
  g.clip(new Path2D(markPath(m, m.x, m.y)));
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, box.x - m.x, box.y - m.y, box.w, box.h);
  return { png: cv.toDataURL('image/png'), pxW: W, pxH: H };
}
