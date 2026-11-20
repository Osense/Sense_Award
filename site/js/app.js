// 쎈스 어워드 — 화면과 상태
import { FONTS, FontStore, DEFAULT_FONT, FALLBACK_FONT, fontInfo, variantKey } from './fonts.js';
import { PAPERS, SIZES, SAMPLE, paperById, paperBackgroundSvg } from './papers.js';
import { tableFromPaste, usedKeys, fillTemplate, BUILTIN_VARS } from './data.js';
import { computeRecord, fontKeysFor, textLayerSvg } from './render.js';
import { buildPdf } from './export-pdf.js';
import { buildHwpx, TEMPLATE_FILES } from './export-hwpx.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clone = o => JSON.parse(JSON.stringify(o));
const STORE_KEY = 'sense-award:state:v2';

// ---------- 상태 ----------
function freshState() {
  const paper = PAPERS[0];
  return {
    step: 1,
    paperId: paper.id,
    size: paper.size,
    fields: clone(paper.fields),
    columns: [...SAMPLE.columns],
    rows: clone(SAMPLE.rows),
    current: 0,
    customBg: null, useCustom: false,
    bgOpacity: 100,
    overrides: [],
    offset: { x: 0, y: 0 },
    stamp: { enabled: false, src: null, png: null, imgW: 0, imgH: 0, white: true, red: false, ...paper.stamp },
    showBg: true, showBoxes: true, zoom: 'fit', range: 'all', bgInPdf: false,
    dataMode: 'paste', openField: 'body', selected: null, snap: true,
  };
}

let state = load() || freshState();

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return { ...freshState(), ...s, selected: null };
  } catch { return null; }
}
let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch {
      // 이미지가 커서 못 담으면 이미지만 빼고 저장
      try { localStorage.setItem(STORE_KEY, JSON.stringify({ ...state, customBg: null, stamp: { ...state.stamp, src: null, png: null, enabled: false } })); } catch {}
    }
  }, 300);
}

const paperSize = () => SIZES[state.size] || SIZES.A4P;
const docView = () => ({ fields: state.fields, columns: state.columns, rows: state.rows, stamp: state.stamp, overrides: state.overrides });
const bgHref = () => (state.useCustom && state.customBg) ? state.customBg : svgDataUrl(paperBackgroundSvg(paperById(state.paperId)));

// 직접 고친 내용은 명단 줄과 같은 순서로 따라다닌다
function syncOverrides() {
  if (!Array.isArray(state.overrides)) state.overrides = [];
  while (state.overrides.length < state.rows.length) state.overrides.push({});
  state.overrides.length = state.rows.length;
  state.overrides = state.overrides.map(o => (o && typeof o === 'object') ? o : {});
}
function editedCount(i) { return Object.keys(state.overrides[i] || {}).length; }
function recName(i) {
  const row = state.rows[i] || [];
  const ni = state.columns.indexOf('이름');
  return (ni >= 0 ? row[ni] : row.find(v => v)) || '';
}

// ---------- 글꼴 ----------
const store = new FontStore(window.fontkit, async p => {
  const r = await fetch(p);
  if (!r.ok) throw new Error(`${p} ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
});

async function ensureFonts(extraFallback = false) {
  const keys = fontKeysFor(docView());
  if (extraFallback) keys.push(variantKey(FALLBACK_FONT, false));
  const missing = keys.filter(k => !store.isLoaded(k));
  if (!missing.length) return;
  setStatus(`글꼴 불러오는 중… (${missing.map(k => fontInfo(k.split(':')[0]).name).join(', ')})`);
  await Promise.all(missing.map(k => store.load(k)));
  setStatus('');
}

// ---------- 단계 ----------
function setStep(n) {
  state.step = n;
  closeEditor();
  $$('#stepTabs button').forEach(b => b.classList.toggle('on', Number(b.dataset.step) === n));
  $$('.page').forEach(pg => { pg.hidden = Number(pg.dataset.step) !== n; });
  const slot = $(`.stage-slot[data-slot="${n}"]`);
  const stage = $('#stage');
  if (slot) { slot.appendChild(stage); stage.hidden = false; } else stage.hidden = true;
  document.body.dataset.step = n;
  $('#boxToggle').hidden = n === 4;
  if (n === 1) renderPapers();
  if (n === 2) renderData();
  if (n === 3) renderFields();
  if (n === 4) { renderSummary(); renderOffset(); }
  $$('.page-scroll, .inspector').forEach(el => { el.scrollTop = 0; });
  refresh();
  requestAnimationFrame(applyZoom);
}

// ---------- 1. 용지 ----------
function svgDataUrl(svg) { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); }

function mergedFields(paper) {
  // 위치·크기는 용지 것으로, 글꼴·문구는 사용자가 고른 대로
  return clone(paper.fields).map(f => {
    const old = state.fields.find(o => o.id === f.id);
    return old ? { ...f, font: old.font, bold: old.bold, text: old.text, color: old.color } : f;
  });
}

function sheetSvg(rec, size, href, opacity = 1, cls = '') {
  const { w, h } = size;
  let stamp = '';
  if (rec.stamp && state.stamp.png) {
    const st = rec.stamp;
    stamp = `<image href="${state.stamp.png}" x="${st.x}" y="${st.y}" width="${st.w}" height="${st.h}" preserveAspectRatio="none"/>`;
  }
  const bg = href ? `<image href="${href}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="${href.startsWith('data:image/svg') ? 'xMidYMid meet' : 'none'}" opacity="${opacity}"/>` : '';
  return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet"><rect width="${w}" height="${h}" fill="#fff"/>${bg}<g>${textLayerSvg(rec)}</g>${stamp}</svg>`;
}

let galleryToken = 0;
async function renderPapers() {
  const token = ++galleryToken;
  const cards = PAPERS.map(p => {
    const s = SIZES[p.size];
    const on = !state.useCustom && p.id === state.paperId;
    return `<button class="paper-card ${on ? 'on' : ''}" data-paper="${p.id}">
      <span class="paper-view" style="aspect-ratio:${s.w}/${s.h}" data-view="${p.id}"><img src="${svgDataUrl(paperBackgroundSvg(p))}" alt=""></span>
      <span class="paper-meta"><b>${esc(p.name)}</b><small>${s.label} · ${s.w}×${s.h}mm</small>${on ? '<em>선택됨</em>' : ''}</span></button>`;
  });
  const cs = paperSize();
  const customOn = state.useCustom && state.customBg;
  const custom = state.customBg
    ? `<div class="paper-card custom ${customOn ? 'on' : ''}">
        <button class="paper-view" style="aspect-ratio:${cs.w}/${cs.h}" data-custom="1" data-view="custom" aria-label="내 견본 고르기"><img src="${state.customBg}" alt=""></button>
        <span class="paper-meta"><b>내 상장 용지</b><small>올린 견본 · 상자는 3단계에서 맞춰요</small>${customOn ? '<em>선택됨</em>' : ''}</span>
        <div class="custom-opts">
          <label class="lbl">용지 크기<select id="sizeSel">${Object.entries(SIZES).map(([k, v]) => `<option value="${k}" ${k === state.size ? 'selected' : ''}>${v.label} (${v.w}×${v.h}mm)</option>`).join('')}</select></label>
          <label class="lbl">견본 진하기<input type="range" id="bgOpacity" min="20" max="100" step="5" value="${state.bgOpacity}"></label>
          <div class="row"><button class="small" data-upload="1">다시 올리기</button><button class="small ghost danger" id="bgClear">지우기</button></div>
        </div>
      </div>`
    : `<button class="paper-card upload" data-upload="1">
        <span class="paper-view dashed" style="aspect-ratio:210/297"><span class="plus">+</span><span>내 상장 용지 올리기</span><small>갖고 있는 용지를 스캔하거나 사진으로 찍어 올리면 그 위에서 글 상자를 맞출 수 있어요</small></span>
        <span class="paper-meta"><b>내 상장 용지</b><small>이미지 파일</small></span></button>`;
  $('#paperGrid').innerHTML = cards.join('') + custom;
  // 지금 명단의 첫 장으로 용지마다 실제 모습을 그린다
  try { await ensureFonts(); } catch { return; }
  if (token !== galleryToken) return;
  const idx = Math.min(state.current, Math.max(0, state.rows.length - 1));
  for (const p of PAPERS) {
    const doc = { ...docView(), fields: mergedFields(p), stamp: { ...state.stamp, size: p.stamp.size, dx: p.stamp.dx, dy: p.stamp.dy } };
    const rec = computeRecord(doc, idx, store);
    const el = $(`[data-view="${p.id}"]`);
    if (el) el.innerHTML = sheetSvg(rec, SIZES[p.size], svgDataUrl(paperBackgroundSvg(p)));
  }
  if (state.customBg) {
    const rec = computeRecord(docView(), idx, store);
    const el = $('[data-view="custom"]');
    if (el) el.innerHTML = sheetSvg(rec, paperSize(), state.customBg, state.bgOpacity / 100);
  }
}

function choosePaper(id) {
  const p = paperById(id);
  state.fields = mergedFields(p);
  state.paperId = p.id;
  state.size = p.size;
  state.useCustom = false;
  state.stamp = { ...state.stamp, size: p.stamp.size, dx: p.stamp.dx, dy: p.stamp.dy };
  renderPapers();
  refresh();
}

function renderOffset() {
  $('#offX').value = state.offset.x;
  $('#offY').value = state.offset.y;
}

// ---------- 2. 명단 ----------
function renderData() {
  $$('.seg [data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === state.dataMode));
  $$('.mode').forEach(m => { m.hidden = m.dataset.mode !== state.dataMode; });
  renderGrid();
  renderDirect();
  renderKeyChips();
}

function renderGrid() {
  const cols = state.columns;
  // 긴 글이 든 항목(내용 등)은 칸을 넓게
  const wideCols = new Set(cols.map((c, ci) => ci).filter(ci => state.rows.some(r => (r[ci] || '').length > 24)));
  const head = `<thead><tr><th class="idx">#</th>${cols.map((c, i) => `<th><div class="th"><input class="colname" data-col="${i}" value="${esc(c)}" aria-label="항목 이름"><button class="x" data-delcol="${i}" title="이 항목 빼기">×</button></div></th>`).join('')}<th></th></tr></thead>`;
  const body = state.rows.map((r, ri) => `<tr class="${ri === state.current ? 'cur' : ''}"><td class="idx"><button class="link" data-goto-rec="${ri}">${ri + 1}</button></td>${cols.map((_, ci) => `<td><input class="cell${wideCols.has(ci) ? ' wide' : ''}" data-r="${ri}" data-c="${ci}" value="${esc(r[ci] ?? '')}"></td>`).join('')}<td><button class="x" data-delrow="${ri}" title="이 줄 빼기">×</button></td></tr>`).join('');
  $('#grid').innerHTML = head + `<tbody>${body}</tbody>`;
  $('#rowCount').textContent = `${state.rows.length}명`;
}

function renderDirect() {
  const n = state.rows.length;
  $('#dPos').textContent = n ? `${state.current + 1} / ${n}` : '0 / 0';
  const row = state.rows[state.current] || [];
  $('#directForm').innerHTML = state.columns.map((c, ci) => {
    const long = (row[ci] || '').length > 30 || c === '내용';
    return `<label class="lbl block">${esc(c)}${long
      ? `<textarea class="dcell" data-c="${ci}" rows="4">${esc(row[ci] ?? '')}</textarea>`
      : `<input class="dcell" data-c="${ci}" value="${esc(row[ci] ?? '')}">`}</label>`;
  }).join('') || '<p class="hint">항목이 없어요. 표 붙여넣기에서 항목을 추가해 주세요.</p>';
}

function renderKeyChips() {
  const all = [...state.columns, ...BUILTIN_VARS];
  $('#keyChips').innerHTML = all.map(k => `<span class="chip">{{${esc(k)}}}</span>`).join('');
  renderMapping();
}

function unknownKeys() {
  const out = [];
  state.fields.forEach(f => usedKeys(f.text).forEach(k => {
    if (!state.columns.includes(k) && !BUILTIN_VARS.includes(k) && !out.includes(k)) out.push(k);
  }));
  return out;
}

// 비슷한 이름이면 미리 골라 둔다(번호→상장번호, 반→소속 등)
function guessColumn(key) {
  const alias = { 상장번호: ['번호', '상장 번호', 'No', '연번'], 소속: ['반', '학년반', '학년 반', '학급', '부서'], 이름: ['성명', '학생', '학생명'], 상장명: ['상', '상명', '수상명', '종류'], 내용: ['공적', '공적내용', '사유', '문구'], 날짜: ['일자', '수여일', '날자'], 수여자: ['수여', '학교장', '발행자'] };
  const cands = [key, ...(alias[key] || [])];
  return state.columns.find(c => cands.includes(c)) || state.columns.find(c => c.includes(key) || key.includes(c)) || '';
}

function renderMapping() {
  const keys = unknownKeys();
  $('#mapCard').hidden = !keys.length;
  $('#mapRows').innerHTML = keys.map(k => {
    const g = guessColumn(k);
    return `<div class="lbl map"><span>{{${esc(k)}}} →</span><select data-map="${esc(k)}"><option value="">(고르기)</option>${state.columns.map(c => `<option value="${esc(c)}" ${c === g ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select><button class="small primary" data-apply-map="${esc(k)}">바꾸기</button></div>`;
  }).join('') + (keys.length > 1 ? '<button class="small" id="mapAll">모두 바꾸기</button>' : '');
}

function applyMapping(key, col) {
  if (!col) return;
  const re = new RegExp(`\\{\\{\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(:\\s*\\d+)?\\s*\\}\\}`, 'g');
  state.fields.forEach(f => { f.text = f.text.replace(re, (m, pad) => `{{${col}${pad ? pad.replace(/\s/g, '') : ''}}}`); });
}

function applyPaste(text) {
  const t = tableFromPaste(text, $('#headerRow').checked);
  if (!t || !t.rows.length) { setStatus('붙여 넣은 내용에서 표를 찾지 못했어요.'); return; }
  const oldCols = state.columns;
  state.columns = t.columns;
  state.rows = t.rows;
  state.overrides = [];
  state.current = 0;
  renderData();
  refresh();
  const unknown = new Set();
  state.fields.forEach(f => usedKeys(f.text).forEach(k => { if (!t.columns.includes(k) && !BUILTIN_VARS.includes(k)) unknown.add(k); }));
  setStatus(`${t.rows.length}명을 불러왔어요.` + (unknown.size ? ` 문구에 쓴 변수 중 명단에 없는 항목: ${[...unknown].join(', ')} — 3단계에서 바꿔 주세요.` : ''));
  if (oldCols.join() !== t.columns.join()) renderFields();
}

function renameColumn(i, name) {
  const old = state.columns[i];
  name = name.replace(/[{}]/g, '').trim() || old;
  if (name === old) return;
  state.columns[i] = name;
  const re = new RegExp(`\\{\\{\\s*${old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(:\\s*\\d+)?\\s*\\}\\}`, 'g');
  state.fields.forEach(f => { f.text = f.text.replace(re, (m, pad) => `{{${name}${pad ? pad.replace(/\s/g, '') : ''}}}`); });
  renderKeyChips();
  refresh();
}

// ---------- 3. 문구·서식 ----------
const ALIGNS = [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽'], ['justify', '양쪽'], ['distribute', '균등']];
const VALIGNS = [['top', '위'], ['middle', '가운데'], ['bottom', '아래']];

function fontOptions(sel) {
  return FONTS.map(f => `<option value="${f.id}" ${f.id === sel ? 'selected' : ''}>${esc(f.name)} (${f.kind})</option>`).join('');
}

function renderFields() {
  const allSame = state.fields.every(f => f.font === state.fields[0].font);
  $('#allFont').innerHTML = (allSame ? '' : '<option value="">칸마다 다름</option>') + fontOptions(allSame ? state.fields[0].font : '');
  const fi = fontInfo(state.fields[0].font);
  $('#fontNote').textContent = `${fi.name}: ${fi.license}`;
  $('#fieldList').innerHTML = state.fields.map(f => fieldCard(f)).join('');
  renderStampCard();
}

function fieldCard(f) {
  const open = state.openField === f.id;
  const keys = [...state.columns, ...BUILTIN_VARS];
  const seg = (name, list, val) => `<div class="seg mini">${list.map(([v, l]) => `<button data-prop="${name}" data-val="${v}" class="${val === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const num = (prop, label, step = 1, extra = '') => `<label class="lbl">${label}<input type="number" data-prop="${prop}" value="${f[prop]}" step="${step}" ${extra}></label>`;
  return `<div class="field ${open ? 'open' : ''} ${state.selected === f.id ? 'sel' : ''}" data-field="${f.id}">
    <button class="field-head" data-toggle="${f.id}">
      <b>${esc(f.label)}</b><span class="sum">${esc(f.text)}</span><span class="badge" data-badge="${f.id}"></span><span class="chev">${open ? '−' : '+'}</span>
    </button>
    <div class="field-body" ${open ? '' : 'hidden'}>
      <label class="lbl block">문구<textarea data-prop="text" rows="${f.id === 'body' ? 4 : 2}">${esc(f.text)}</textarea></label>
      <div class="chips small">${keys.map(k => `<button class="chip" data-insert="{{${esc(k)}}}">{{${esc(k)}}}</button>`).join('')}</div>
      <div class="row two">
        <label class="lbl">글꼴<select data-prop="font">${fontOptions(f.font)}</select></label>
        <div class="row tight"><label class="check"><input type="checkbox" data-prop="bold" ${f.bold ? 'checked' : ''}> 굵게</label>
        <label class="lbl color">색<input type="color" data-prop="color" value="${f.color}"></label></div>
      </div>
      <div class="row two">${num('size', '글자 크기(pt)', 0.5, 'min="4"')}${num('minSize', '최소 크기(pt)', 0.5, 'min="4"')}</div>
      <div class="lbl">가로 정렬</div>${seg('align', ALIGNS, f.align)}
      <div class="lbl">세로 정렬</div>${seg('valign', VALIGNS, f.valign)}
      <div class="row two">${num('maxLines', '최대 줄 수 (0=제한 없음)', 1, 'min="0"')}${num('lineHeight', '줄 간격(%)', 5, 'min="100"')}</div>
      <div class="row two">${num('minScale', '최소 장평(%)', 1, 'min="50" max="100"')}${num('minSpacing', '최소 자간(%)', 1, 'min="-30" max="0"')}</div>
      <details class="pos"><summary>위치와 크기 (mm) — 미리보기에서 끌어서 옮겨도 돼요</summary>
        <div class="row four">${num('x', '가로', 0.5)}${num('y', '세로', 0.5)}${num('w', '너비', 0.5, 'min="5"')}${num('h', '높이', 0.5, 'min="3"')}</div>
      </details>
    </div>
  </div>`;
}

function renderStampCard() {
  const s = state.stamp;
  $('#stampClear').hidden = !s.src;
  $('#stampPreview').hidden = !s.png;
  $('#stampPreview').innerHTML = s.png ? `<img src="${s.png}" alt="도장 미리보기">` : '';
  $('#stampWhite').checked = !!s.white;
  $('#stampRed').checked = !!s.red;
  $('#stampSize').value = s.size;
  $('#stampDx').value = s.dx;
  $('#stampDy').value = s.dy;
}

function updateField(id, prop, value) {
  const f = state.fields.find(x => x.id === id);
  if (!f) return;
  const numeric = ['size', 'minSize', 'maxLines', 'lineHeight', 'minScale', 'minSpacing', 'x', 'y', 'w', 'h'];
  if (numeric.includes(prop)) {
    const v = parseFloat(value);
    if (!Number.isFinite(v)) return;
    f[prop] = v;
    if (prop === 'size' && f.minSize > v) f.minSize = v;
    if (prop === 'minSize' && v > f.size) f.size = v;
  } else f[prop] = value;
  if (prop === 'text') { const sum = $(`.field[data-field="${id}"] .sum`); if (sum) sum.textContent = value; }
  refresh();
}

// ---------- 도장 처리 ----------
function loadImage(src) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
}

async function processStamp() {
  const s = state.stamp;
  if (!s.src) { s.png = null; s.enabled = false; return; }
  const im = await loadImage(s.src);
  const maxSide = 800;
  const k = Math.min(1, maxSide / Math.max(im.naturalWidth, im.naturalHeight));
  const w = Math.round(im.naturalWidth * k), h = Math.round(im.naturalHeight * k);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d');
  cx.drawImage(im, 0, 0, w, h);
  const data = cx.getImageData(0, 0, w, h);
  const p = data.data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i], g = p[i + 1], b = p[i + 2];
    let a = p[i + 3];
    if (s.white) {
      // 밝을수록 투명하게(가장자리는 부드럽게)
      const light = Math.min(r, g, b);
      const t = Math.max(0, Math.min(1, (235 - light) / 60));
      a = Math.round(a * t);
    }
    if (s.red && a > 0) {
      const dark = 1 - (r + g + b) / 765;
      p[i] = 200; p[i + 1] = 28; p[i + 2] = 36;
      if (!s.white) a = Math.round(a * Math.min(1, dark * 1.6));
    }
    p[i + 3] = a;
    if (a > 16) {
      const x = (i / 4) % w, y = Math.floor(i / 4 / w);
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  cx.putImageData(data, 0, 0);
  if (maxX < 0) { minX = 0; minY = 0; maxX = w - 1; maxY = h - 1; }
  const tw = maxX - minX + 1, th = maxY - minY + 1;
  const out = document.createElement('canvas'); out.width = tw; out.height = th;
  out.getContext('2d').drawImage(cv, minX, minY, tw, th, 0, 0, tw, th);
  s.png = out.toDataURL('image/png');
  s.imgW = tw; s.imgH = th;
  s.enabled = true;
}

function dataUrlBytes(url) {
  const b64 = url.split(',')[1];
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- 미리보기 ----------
let renderSeq = 0;
let lastRecord = null;

async function renderPreview() {
  const seq = ++renderSeq;
  const n = state.rows.length;
  if (state.current >= n) state.current = Math.max(0, n - 1);
  $('#recPos').textContent = n ? `${state.current + 1} / ${n}` : '명단 없음';
  $('#recWho').textContent = n ? recName(state.current) : '';
  syncOverrides();
  try { await ensureFonts(); } catch (e) { setStatus('글꼴을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.'); return; }
  if (seq !== renderSeq) return;
  let rec = computeRecord(docView(), state.current, store);
  if (rec.needFallback) {
    await store.load(variantKey(FALLBACK_FONT, false));
    if (seq !== renderSeq) return;
    rec = computeRecord(docView(), state.current, store);
  }
  lastRecord = rec;
  const { w, h } = paperSize();
  let bg = '';
  if (state.showBg) {
    const custom = state.useCustom && state.customBg;
    const href = bgHref();
    const fit = custom ? 'none' : 'xMidYMid meet';
    bg = `<image href="${href}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="${fit}" opacity="${state.bgOpacity / 100}"/>`;
  }
  let stamp = '';
  if (rec.stamp && state.stamp.png) {
    const s = rec.stamp;
    stamp = `<image href="${state.stamp.png}" x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" preserveAspectRatio="none"/>`;
  }
  let boxes = '';
  if (state.step === 4) {
    // 확인 단계: 상자는 숨기고, 글자를 누르면 그 상장만 고친다
    boxes = rec.fields.map(r => {
      const f = r.field;
      const cls = ['hit', r.edited ? 'edited' : '', r.overflow ? 'over' : '', editing && editing.field === f.id ? 'sel' : ''].join(' ');
      return `<g class="${cls}" data-box="${f.id}"><rect class="area" x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="0.8"/>${r.edited ? `<text class="tag" x="${f.x + f.w}" y="${f.y - 0.9}" text-anchor="end">직접 고침</text>` : ''}${r.overflow ? `<text class="tag" x="${f.x + 0.6}" y="${f.y - 0.9}">넘침</text>` : ''}</g>`;
    }).join('');
  } else if (state.showBoxes) {
    boxes = rec.fields.map(r => {
      const f = r.field;
      const cls = ['box', r.overflow ? 'over' : '', state.selected === f.id ? 'sel' : '', state.step === 3 ? 'drag' : ''].join(' ');
      return `<g class="${cls}" data-box="${f.id}">
        <rect class="area" x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}"/>
        <text class="tag" x="${f.x + 0.6}" y="${f.y - 0.9}">${esc(f.label)}${r.overflow ? ' · 넘침' : ''}${r.edited ? ' · 직접 고침' : ''}</text>
        <rect class="handle" data-handle="${f.id}" x="${f.x + f.w - 2.2}" y="${f.y + f.h - 2.2}" width="4.4" height="4.4" rx="0.8"/>
      </g>`;
    }).join('');
    if (state.stamp.enabled && rec.stamp && !state.stamp.png) {
      const s = rec.stamp;
      boxes += `<circle class="stamp-ph" cx="${s.x + s.w / 2}" cy="${s.y + s.h / 2}" r="${s.w / 2}"/>`;
    }
  }
  $('#sheet').innerHTML = `<svg id="page" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="aspect-ratio:${w}/${h}">
    <rect width="${w}" height="${h}" fill="#fff"/>${bg}<g class="text-layer">${textLayerSvg(rec)}</g>${stamp}<g class="box-layer">${boxes}</g><g class="guide-layer">${guideSvg()}</g></svg>`;
  renderAlignBar();
  applyZoom();
  positionEditor();
  updateBadges(rec);
  if (state.step === 4) scheduleList();
  const msgs = [];
  if (rec.missing.length) msgs.push(`명단에 없는 변수: ${rec.missing.map(k => `{{${k}}}`).join(', ')}`);
  const over = rec.fields.filter(r => r.overflow).map(r => r.field.label);
  if (over.length) msgs.push(`최소 크기로도 다 들어가지 않는 칸: ${over.join(', ')} — 상자를 키우거나 최소 크기를 낮춰 주세요`);
  setStatus(msgs.join(' · '), msgs.length ? 'warn' : '');
}

function updateBadges(rec) {
  for (const r of rec.fields) {
    const b = $(`[data-badge="${r.field.id}"]`);
    if (!b) continue;
    if (r.pending) { b.textContent = ''; continue; }
    const shrunk = r.sizePt < r.field.size || r.scale < 100 || r.spacing < 0;
    b.textContent = r.overflow ? '넘침' : shrunk ? `${r.sizePt}pt · 장평 ${r.scale}% · 자간 ${r.spacing}%` : `${r.sizePt}pt`;
    b.className = 'badge' + (r.overflow ? ' over' : shrunk ? ' fit' : '');
  }
}

function applyZoom() {
  const svg = $('#page');
  if (!svg) return;
  const { w, h } = paperSize();
  const canvas = $('#canvas');
  let scale;
  if (state.zoom === 'fit') {
    const pad = 48;
    const sw = (canvas.clientWidth - pad) / w;
    const sh = (canvas.clientHeight - pad) / h;
    scale = Math.max(0.5, Math.min(sw, sh));
  } else scale = Number(state.zoom) * 96 / 25.4;
  svg.style.width = `${w * scale}px`;
  svg.style.height = `${h * scale}px`;
}

let refreshQueued = false;
function refresh() {
  save();
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => { refreshQueued = false; renderPreview(); });
}

function setStatus(msg, kind = '') {
  const el = $('#status');
  el.textContent = msg || '';
  el.className = 'status' + (kind ? ` ${kind}` : '');
}

// ---------- 끌어서 옮기기 ----------
function svgPoint(svg, ev) {
  const pt = svg.createSVGPoint();
  pt.x = ev.clientX; pt.y = ev.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

// ---------- 가이드·맞춤 ----------
let guides = { x: [], y: [] };

function contentArea() {
  const { w, h } = paperSize();
  const inset = state.useCustom ? 20 : (paperById(state.paperId).inset || 20);
  return { x: inset, y: inset, w: w - 2 * inset, h: h - 2 * inset };
}

// 끌고 있는 상자의 가장자리·가운데를 용지 가운데, 안쪽 여백, 다른 상자에 붙인다
function snapBox(f, d, dx, dy, enabled, svg) {
  const r2 = v => Math.round(v * 2) / 2;
  const o = d.orig;
  let box = d.mode === 'move'
    ? { x: o.x + dx, y: o.y + dy, w: o.w, h: o.h }
    : { x: o.x, y: o.y, w: Math.max(5, o.w + dx), h: Math.max(3, o.h + dy) };
  const out = { x: [], y: [] };
  if (!enabled) return { box: { x: r2(box.x), y: r2(box.y), w: r2(box.w), h: r2(box.h) }, guides: out };
  const { w: W, h: H } = paperSize();
  const ca = contentArea();
  // 화면에서 6px 안이면 붙는다
  const ctm = svg.getScreenCTM();
  const tol = 6 / (ctm ? ctm.a : 3);
  const tx = [W / 2, ca.x, ca.x + ca.w];
  const ty = [H / 2, ca.y, ca.y + ca.h];
  for (const g of state.fields) {
    if (g.id === f.id) continue;
    tx.push(g.x, g.x + g.w / 2, g.x + g.w);
    ty.push(g.y, g.y + g.h / 2, g.y + g.h);
  }
  const best = (cands, targets) => {
    let b = null;
    for (const [off, val] of cands) for (const t of targets) {
      const dd = t - val;
      if (Math.abs(dd) <= tol && (!b || Math.abs(dd) < Math.abs(b.d))) b = { d: dd, t, off };
    }
    return b;
  };
  if (d.mode === 'move') {
    const bx = best([[0, box.x], [0.5, box.x + box.w / 2], [1, box.x + box.w]], tx);
    if (bx) box.x += bx.d; else box.x = r2(box.x);
    const by = best([[0, box.y], [0.5, box.y + box.h / 2], [1, box.y + box.h]], ty);
    if (by) box.y += by.d; else box.y = r2(box.y);
    // 붙은 모든 선을 보여 준다
    for (const t of new Set(tx)) if ([box.x, box.x + box.w / 2, box.x + box.w].some(v => Math.abs(v - t) < 0.01)) out.x.push(t);
    for (const t of new Set(ty)) if ([box.y, box.y + box.h / 2, box.y + box.h].some(v => Math.abs(v - t) < 0.01)) out.y.push(t);
  } else {
    const bx = best([[1, box.x + box.w]], tx);
    if (bx) box.w += bx.d; else box.w = r2(box.w);
    const by = best([[1, box.y + box.h]], ty);
    if (by) box.h += by.d; else box.h = r2(box.h);
    if (bx) out.x.push(bx.t);
    if (by) out.y.push(by.t);
  }
  const round = v => Math.round(v * 100) / 100;
  return { box: { x: round(box.x), y: round(box.y), w: round(box.w), h: round(box.h) }, guides: out };
}

function guideSvg() {
  const { w, h } = paperSize();
  let s = '';
  for (const x of guides.x) s += `<line class="guide${Math.abs(x - w / 2) < 0.01 ? ' mid' : ''}" x1="${x}" y1="0" x2="${x}" y2="${h}"/>`;
  for (const y of guides.y) s += `<line class="guide${Math.abs(y - h / 2) < 0.01 ? ' mid' : ''}" x1="0" y1="${y}" x2="${w}" y2="${y}"/>`;
  if (s && drag) {
    const ca = contentArea();
    s = `<rect class="content-area" x="${ca.x}" y="${ca.y}" width="${ca.w}" height="${ca.h}"/>` + s;
  }
  return s;
}

function placeSelected(how) {
  const f = state.fields.find(x => x.id === state.selected);
  if (!f) return;
  const { w: W, h: H } = paperSize();
  const ca = contentArea();
  if (how === 'left') f.x = ca.x;
  if (how === 'hcenter') f.x = Math.round((W - f.w) / 2 * 100) / 100;
  if (how === 'right') f.x = Math.round((ca.x + ca.w - f.w) * 100) / 100;
  if (how === 'top') f.y = ca.y;
  if (how === 'vcenter') f.y = Math.round((H - f.h) / 2 * 100) / 100;
  if (how === 'bottom') f.y = Math.round((ca.y + ca.h - f.h) * 100) / 100;
  if (how === 'fullw') { f.x = ca.x; f.w = ca.w; }
  // 정렬한 기준선을 잠깐 보여 준다
  guides = { x: [], y: [] };
  if (how === 'hcenter') guides.x.push(W / 2);
  if (how === 'vcenter') guides.y.push(H / 2);
  if (how === 'left' || how === 'fullw') guides.x.push(ca.x);
  if (how === 'right' || how === 'fullw') guides.x.push(ca.x + ca.w);
  if (how === 'top') guides.y.push(ca.y);
  if (how === 'bottom') guides.y.push(ca.y + ca.h);
  clearTimeout(placeSelected.t);
  placeSelected.t = setTimeout(() => { guides = { x: [], y: [] }; refresh(); }, 900);
  syncFieldInputs(f);
  refresh();
}

function syncFieldInputs(f) {
  const card = $(`.field[data-field="${f.id}"]`);
  if (!card) return;
  for (const k of ['x', 'y', 'w', 'h']) { const el = $(`input[data-prop="${k}"]`, card); if (el) el.value = f[k]; }
  $$('[data-prop="align"]', card).forEach(b => b.classList.toggle('on', b.dataset.val === f.align));
}

function renderAlignBar() {
  const f = state.step === 3 ? state.fields.find(x => x.id === state.selected) : null;
  $('#alignBar').hidden = !f;
  if (!f) return;
  $('#abName').textContent = f.label;
  $$('#alignBar [data-talign]').forEach(b => b.classList.toggle('on', b.dataset.talign === f.align));
  $('#snapOn').checked = state.snap;
}

let drag = null;
$('#sheet').addEventListener('pointerdown', ev => {
  const svg = $('#page');
  if (!svg) return;
  const box = ev.target.closest('[data-box]');
  if (state.step === 4) {
    if (box) { openEditor(box.dataset.box); ev.preventDefault(); } else closeEditor();
    return;
  }
  if (state.step !== 3) return;
  const handle = ev.target.closest('[data-handle]');
  if (!box) { if (state.selected) { state.selected = null; refresh(); markSelected(); } return; }
  const id = box.dataset.box;
  const f = state.fields.find(x => x.id === id);
  const p = svgPoint(svg, ev);
  drag = { id, mode: handle ? 'resize' : 'move', start: p, orig: { x: f.x, y: f.y, w: f.w, h: f.h }, moved: false };
  state.selected = id;
  ev.preventDefault();
  $('#sheet').setPointerCapture(ev.pointerId);
});
$('#sheet').addEventListener('pointermove', ev => {
  if (!drag) return;
  const svg = $('#page');
  const p = svgPoint(svg, ev);
  const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
  if (Math.abs(dx) + Math.abs(dy) > 0.3) drag.moved = true;
  const f = state.fields.find(x => x.id === drag.id);
  const r = snapBox(f, drag, dx, dy, state.snap && !ev.altKey, svg);
  Object.assign(f, r.box);
  guides = r.guides;
  refresh();
});
$('#sheet').addEventListener('pointerup', () => {
  if (!drag) return;
  const id = drag.id;
  drag = null;
  guides = { x: [], y: [] };
  state.openField = id;
  renderFields();
  refresh();
  const card = $(`.field[data-field="${id}"]`);
  if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
});

// ---------- 이 상장만 직접 고치기 ----------
let editing = null; // { field, index }
function currentText(index, fieldId) {
  const ov = state.overrides[index] && state.overrides[index][fieldId];
  if (typeof ov === 'string') return ov;
  const f = state.fields.find(x => x.id === fieldId);
  return fillTemplate(f.text, state.columns, state.rows[index] || [], index).text;
}
function openEditor(fieldId) {
  if (!state.rows.length) return;
  syncOverrides();
  const f = state.fields.find(x => x.id === fieldId);
  editing = { field: fieldId, index: state.current };
  $('#edTitle').textContent = `${state.current + 1}번 ${recName(state.current)} · ${f.label}`;
  const ta = $('#edText');
  ta.value = currentText(state.current, fieldId);
  ta.rows = fieldId === 'body' ? 5 : 2;
  $('#edReset').disabled = typeof state.overrides[state.current][fieldId] !== 'string';
  $('#editor').hidden = false;
  refresh();
  requestAnimationFrame(() => { positionEditor(); ta.focus(); ta.select(); });
}
function closeEditor() {
  if (!editing) return;
  editing = null;
  $('#editor').hidden = true;
  refresh();
  if (state.step === 4) scheduleList();
}
function positionEditor() {
  if (!editing) return;
  if (editing.index !== state.current) { closeEditor(); return; }
  const area = $(`[data-box="${editing.field}"] .area`);
  const canvas = $('#canvas');
  const ed = $('#editor');
  if (!area) return;
  const r = area.getBoundingClientRect();
  const c = canvas.getBoundingClientRect();
  const width = Math.min(Math.max(r.width, 340), c.width - 24);
  let left = r.left - c.left + canvas.scrollLeft + r.width / 2 - width / 2;
  left = Math.max(canvas.scrollLeft + 12, Math.min(left, canvas.scrollLeft + c.width - width - 12));
  let top = r.bottom - c.top + canvas.scrollTop + 8;
  const edH = ed.offsetHeight || 160;
  if (r.bottom + edH + 16 > c.bottom) top = r.top - c.top + canvas.scrollTop - edH - 8;
  ed.style.width = `${width}px`;
  ed.style.left = `${left}px`;
  ed.style.top = `${Math.max(canvas.scrollTop + 8, top)}px`;
}

function markSelected() { $$('.field').forEach(el => el.classList.toggle('sel', el.dataset.field === state.selected)); }

// ---------- 내보내기 ----------
function allIndices() { return state.range === 'current' ? [state.current] : state.rows.map((_, i) => i); }

async function renderSummary() {
  await ensureFonts(true).catch(() => {});
  syncOverrides();
  const n = state.rows.length;
  let overCount = 0;
  const missing = new Set();
  const items = [];
  for (let i = 0; i < n; i++) {
    const r = computeRecord(docView(), i, store);
    r.missing.forEach(m => missing.add(m));
    const over = r.fields.filter(x => x.overflow).map(x => x.field.label);
    overCount += over.length ? 1 : 0;
    const ed = editedCount(i);
    items.push(`<li class="${i === state.current ? 'cur' : ''}"><button data-rec="${i}"><span class="no">${i + 1}</span><span class="nm">${esc(recName(i)) || '(이름 없음)'}</span>${ed ? `<span class="tagc ed">고침 ${ed}</span>` : ''}${over.length ? `<span class="tagc ov">넘침</span>` : ''}</button></li>`);
  }
  $('#recList').innerHTML = items.join('');
  const editedTotal = state.overrides.filter((o, i) => i < n && Object.keys(o).length).length;
  $('#listSum').textContent = `${n}장${editedTotal ? ` · 직접 고친 상장 ${editedTotal}` : ''}${overCount ? ` · 넘침 ${overCount}` : ''}`;
  const cur = $('#recList li.cur');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
  const usedFonts = [...new Set(state.fields.map(f => f.font))].map(id => fontInfo(id));
  const warn = $('#warnBox');
  const msgs = [];
  if (missing.size) msgs.push(`명단에 없는 변수가 있어 빈칸으로 나가요: ${[...missing].map(k => `{{${esc(k)}}}`).join(', ')}`);
  if (overCount) msgs.push(`글이 다 들어가지 않는 상장이 ${overCount}장 있어요. 목록에서 골라 글을 줄이거나, 3단계에서 상자를 키워 주세요.`);
  warn.hidden = !msgs.length;
  warn.innerHTML = msgs.map(t => `<p>${t}</p>`).join('');
  $('#fontLinks').innerHTML = usedFonts.map(f => `<li><b>${esc(f.name)}</b> <a href="${f.url}" target="_blank" rel="noopener">내려받는 곳</a> <span class="hint">${esc(f.license)}</span></li>`).join('');
}

let listTimer = 0;
function scheduleList() {
  clearTimeout(listTimer);
  listTimer = setTimeout(() => { if (state.step === 4) renderSummary(); }, 350);
}

function download(bytes, name, type) {
  const blob = new Blob([bytes], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

function stamp8() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function progress(done, total, label) {
  const el = $('#progress');
  el.hidden = done >= total && !label;
  $('i', el).style.width = `${total ? (done / total) * 100 : 0}%`;
  $('span', el).textContent = label || `${done} / ${total}`;
}

async function rasterBg() {
  const { w, h } = paperSize();
  const href = bgHref();
  const im = await loadImage(href);
  const px = 150 / 25.4;
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * px); cv.height = Math.round(h * px);
  const cx = cv.getContext('2d');
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
  cx.globalAlpha = state.bgOpacity / 100;
  cx.drawImage(im, 0, 0, cv.width, cv.height);
  return dataUrlBytes(cv.toDataURL('image/png'));
}

let busy = false;
async function exportPdf() {
  if (busy || !state.rows.length) return;
  busy = true;
  try {
    await ensureFonts(true);
    const indices = allIndices();
    progress(0, indices.length, '준비 중…');
    const res = await buildPdf({
      PDFLib: window.PDFLib, fontkit: window.fontkit, doc: docView(), store, indices,
      paper: paperSize(), offset: state.offset,
      stampPng: state.stamp.png ? dataUrlBytes(state.stamp.png) : null,
      bgPng: state.bgInPdf ? await rasterBg() : null,
      onProgress: async (d, t) => { progress(d, t, d === t ? '파일로 묶는 중…' : ''); await new Promise(r => setTimeout(r)); },
    });
    download(res.bytes, `상장_${stamp8()}${indices.length === 1 ? `_${indices[0] + 1}` : ''}.pdf`, 'application/pdf');
    progress(1, 1, `PDF ${indices.length}장을 만들었어요.`);
  } catch (e) {
    console.error(e);
    progress(0, 1, `PDF를 만들지 못했어요: ${e.message}`);
  } finally { busy = false; }
}

let templateCache = null;
async function loadTemplate() {
  if (templateCache) return templateCache;
  const t = {};
  await Promise.all(TEMPLATE_FILES.map(async f => {
    const r = await fetch(`hwpx-template/${f}`);
    if (!r.ok) throw new Error(`${f} ${r.status}`);
    t[f] = f.endsWith('.png') ? new Uint8Array(await r.arrayBuffer()) : await r.text();
  }));
  templateCache = t;
  return t;
}

async function exportHwpx() {
  if (busy || !state.rows.length) return;
  busy = true;
  try {
    await ensureFonts(true);
    const indices = allIndices();
    progress(0, 1, '한글 파일 만드는 중…');
    const res = await buildHwpx({
      JSZip: window.JSZip, template: await loadTemplate(), doc: docView(), store, indices,
      paper: paperSize(), offset: state.offset,
      stampPng: state.stamp.png ? dataUrlBytes(state.stamp.png) : null,
      stampPx: { w: state.stamp.imgW, h: state.stamp.imgH },
    });
    download(res.bytes, `상장_${stamp8()}${indices.length === 1 ? `_${indices[0] + 1}` : ''}.hwpx`, 'application/hwp+zip');
    progress(1, 1, `한글 파일(${indices.length}쪽)을 만들었어요.`);
  } catch (e) {
    console.error(e);
    progress(0, 1, `한글 파일을 만들지 못했어요: ${e.message}`);
  } finally { busy = false; }
}

// ---------- 이벤트 ----------
function bind() {
  $('#stepTabs').addEventListener('click', e => { const b = e.target.closest('[data-step]'); if (b) setStep(Number(b.dataset.step)); });
  $$('[data-goto]').forEach(b => b.addEventListener('click', () => setStep(Number(b.dataset.goto))));
  $('#themeBtn').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme !== 'dark';
    document.documentElement.dataset.theme = dark ? 'dark' : '';
    $('#themeBtn').textContent = dark ? '밝게' : '어둡게';
    try { localStorage.setItem('sense-award:theme', dark ? 'dark' : 'light'); } catch {}
  });
  $('#themeBtn').textContent = document.documentElement.dataset.theme === 'dark' ? '밝게' : '어둡게';
  $('#resetBtn').addEventListener('click', () => {
    if (!confirm('명단·문구·배치를 처음 상태로 되돌릴까요?')) return;
    state = freshState();
    renderPapers(); setStep(1); refresh();
  });

  // 1단계 (용지 카드는 다시 그려지므로 위임으로 받는다)
  $('#paperGrid').addEventListener('click', e => {
    if (e.target.closest('[data-upload]')) { $('#bgFile').click(); return; }
    if (e.target.closest('#bgClear')) {
      state.customBg = null; state.useCustom = false;
      state.size = paperById(state.paperId).size;
      renderPapers(); refresh(); return;
    }
    if (e.target.closest('[data-custom]')) { state.useCustom = true; renderPapers(); refresh(); return; }
    const b = e.target.closest('[data-paper]');
    if (b) choosePaper(b.dataset.paper);
  });
  $('#paperGrid').addEventListener('change', e => {
    if (e.target.id === 'sizeSel') { state.size = e.target.value; renderPapers(); refresh(); }
  });
  $('#paperGrid').addEventListener('input', e => {
    if (e.target.id === 'bgOpacity') {
      state.bgOpacity = Number(e.target.value);
      const img = $('[data-view="custom"] svg image');
      if (img) img.setAttribute('opacity', state.bgOpacity / 100);
      refresh();
    }
  });
  $('#offX').addEventListener('input', e => { state.offset.x = parseFloat(e.target.value) || 0; save(); });
  $('#offY').addEventListener('input', e => { state.offset.y = parseFloat(e.target.value) || 0; save(); });
  $('#bgFile').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const url = await fileToDataUrl(file);
    const im = await loadImage(url);
    state.customBg = await downscale(im, 2000);
    state.useCustom = true;
    // 가로로 긴 견본이면 가로 용지로
    state.size = im.naturalWidth > im.naturalHeight ? 'A4L' : (SIZES[state.size].w > SIZES[state.size].h ? 'A4P' : state.size);
    e.target.value = '';
    renderPapers(); refresh();
  });

  // 상자 정렬 막대
  $('#alignBar').addEventListener('click', e => {
    const pl = e.target.closest('[data-place]');
    if (pl) { placeSelected(pl.dataset.place); return; }
    const ta = e.target.closest('[data-talign]');
    if (ta) {
      const f = state.fields.find(x => x.id === state.selected);
      if (f) { f.align = ta.dataset.talign; syncFieldInputs(f); refresh(); }
    }
  });
  $('#snapOn').addEventListener('change', e => { state.snap = e.target.checked; save(); });

  // 직접 고치기
  $('#edText').addEventListener('input', e => {
    if (!editing) return;
    syncOverrides();
    state.overrides[editing.index][editing.field] = e.target.value;
    $('#edReset').disabled = false;
    refresh();
  });
  $('#edReset').addEventListener('click', () => {
    if (!editing) return;
    delete state.overrides[editing.index][editing.field];
    $('#edText').value = currentText(editing.index, editing.field);
    $('#edReset').disabled = true;
    refresh();
  });
  $('#edDone').addEventListener('click', closeEditor);
  $('#edText').addEventListener('keydown', e => { if (e.key === 'Escape') closeEditor(); });
  $('#recList').addEventListener('click', e => {
    const b = e.target.closest('[data-rec]');
    if (!b) return;
    closeEditor();
    state.current = Number(b.dataset.rec);
    $$('#recList li').forEach((li, i) => li.classList.toggle('cur', i === state.current));
    refresh();
  });
  $('#canvas').addEventListener('scroll', positionEditor);

  // 2단계
  $$('.seg [data-mode]').forEach(b => b.addEventListener('click', () => { state.dataMode = b.dataset.mode; renderData(); save(); }));
  $('#pasteBox').addEventListener('paste', e => {
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    applyPaste(text);
  });
  $('#pasteBox').addEventListener('change', e => { if (e.target.value.trim()) { applyPaste(e.target.value); e.target.value = ''; } });
  $('#grid').addEventListener('input', e => {
    const c = e.target.closest('.cell');
    if (c) { state.rows[c.dataset.r][c.dataset.c] = c.value; refresh(); }
  });
  $('#grid').addEventListener('change', e => { const c = e.target.closest('.colname'); if (c) renameColumn(Number(c.dataset.col), c.value); });
  $('#grid').addEventListener('focusin', e => {
    const c = e.target.closest('.cell');
    if (c && Number(c.dataset.r) !== state.current) {
      state.current = Number(c.dataset.r);
      $$('#grid tbody tr').forEach((tr, i) => tr.classList.toggle('cur', i === state.current));
      refresh();
    }
  });
  $('#grid').addEventListener('click', e => {
    const dr = e.target.closest('[data-delrow]');
    const dc = e.target.closest('[data-delcol]');
    const go = e.target.closest('[data-goto-rec]');
    if (dr) { syncOverrides(); const i = Number(dr.dataset.delrow); state.rows.splice(i, 1); state.overrides.splice(i, 1); renderData(); refresh(); }
    if (dc) {
      const i = Number(dc.dataset.delcol);
      if (!confirm(`'${state.columns[i]}' 항목을 뺄까요?`)) return;
      state.columns.splice(i, 1); state.rows.forEach(r => r.splice(i, 1)); renderData(); refresh();
    }
    if (go) { state.current = Number(go.dataset.gotoRec); renderGrid(); refresh(); }
  });
  // 표 칸에 여러 칸짜리를 붙여 넣으면 그 자리부터 채운다
  $('#grid').addEventListener('paste', e => {
    const c = e.target.closest('.cell');
    const text = e.clipboardData.getData('text/plain');
    if (!c || !/[\t\n]/.test(text.trim())) return;
    e.preventDefault();
    const t = tableFromPaste(text, false);
    const r0 = Number(c.dataset.r), c0 = Number(c.dataset.c);
    t.rows.forEach((row, ri) => {
      const r = r0 + ri;
      while (state.rows.length <= r) state.rows.push(state.columns.map(() => ''));
      row.forEach((v, ci) => { if (c0 + ci < state.columns.length) state.rows[r][c0 + ci] = v; });
    });
    renderGrid(); refresh();
  });
  $('#mapCard').addEventListener('click', e => {
    const one = e.target.closest('[data-apply-map]');
    if (one) {
      applyMapping(one.dataset.applyMap, $(`select[data-map="${CSS.escape(one.dataset.applyMap)}"]`).value);
    } else if (e.target.closest('#mapAll')) {
      $$('#mapRows select').forEach(s => applyMapping(s.dataset.map, s.value));
    } else return;
    e.preventDefault();
    renderMapping(); refresh();
  });
  $('#addRow').addEventListener('click', () => { state.rows.push(state.columns.map(() => '')); state.current = state.rows.length - 1; renderData(); refresh(); });
  $('#addCol').addEventListener('click', () => {
    let name = '새항목'; let k = 1;
    while (state.columns.includes(name)) name = `새항목${++k}`;
    state.columns.push(name); state.rows.forEach(r => r.push('')); renderData(); refresh();
  });
  $('#dPrev').addEventListener('click', () => { if (state.current > 0) { state.current--; renderDirect(); refresh(); } });
  $('#dNext').addEventListener('click', () => { if (state.current < state.rows.length - 1) { state.current++; renderDirect(); refresh(); } });
  $('#dAdd').addEventListener('click', () => {
    const prev = state.rows[state.current];
    // 날짜·수여자처럼 보통 같은 값은 이어받는다
    const keep = ['상장명', '날짜', '수여자'];
    state.rows.push(state.columns.map((c, i) => keep.includes(c) && prev ? prev[i] : ''));
    state.current = state.rows.length - 1; renderDirect(); refresh();
  });
  $('#dDel').addEventListener('click', () => {
    if (!state.rows.length || !confirm('이 상장을 지울까요?')) return;
    syncOverrides(); state.overrides.splice(state.current, 1); state.rows.splice(state.current, 1); state.current = Math.max(0, state.current - 1); renderDirect(); refresh();
  });
  $('#directForm').addEventListener('input', e => {
    const c = e.target.closest('.dcell');
    if (!c) return;
    if (!state.rows.length) { state.rows.push(state.columns.map(() => '')); state.current = 0; }
    state.rows[state.current][c.dataset.c] = c.value; refresh();
  });

  // 3단계
  $('#allFont').addEventListener('change', e => {
    if (!e.target.value) return;
    state.fields.forEach(f => { f.font = e.target.value; });
    renderFields(); refresh();
  });
  $('#fieldList').addEventListener('click', e => {
    const t = e.target.closest('[data-toggle]');
    if (t) {
      state.openField = state.openField === t.dataset.toggle ? null : t.dataset.toggle;
      state.selected = state.openField;
      renderFields(); refresh(); return;
    }
    const ins = e.target.closest('[data-insert]');
    if (ins) {
      const card = ins.closest('.field');
      const ta = $('textarea[data-prop="text"]', card);
      const s = ta.selectionStart ?? ta.value.length, en = ta.selectionEnd ?? s;
      ta.value = ta.value.slice(0, s) + ins.dataset.insert + ta.value.slice(en);
      ta.focus(); ta.selectionStart = ta.selectionEnd = s + ins.dataset.insert.length;
      updateField(card.dataset.field, 'text', ta.value); return;
    }
    const segBtn = e.target.closest('.seg [data-prop]');
    if (segBtn) {
      const card = segBtn.closest('.field');
      $$(`[data-prop="${segBtn.dataset.prop}"]`, card).forEach(b => b.classList.toggle('on', b === segBtn));
      updateField(card.dataset.field, segBtn.dataset.prop, segBtn.dataset.val);
    }
  });
  $('#fieldList').addEventListener('input', e => {
    const el = e.target.closest('[data-prop]');
    if (!el || el.tagName === 'BUTTON') return;
    const card = el.closest('.field');
    const v = el.type === 'checkbox' ? el.checked : el.value;
    updateField(card.dataset.field, el.dataset.prop, v);
    if (el.dataset.prop === 'font' || el.dataset.prop === 'bold') renderFieldsFontNote();
  });

  // 도장
  $('#stampFile').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const url = await fileToDataUrl(file);
    state.stamp.src = await downscale(await loadImage(url), 1000);
    e.target.value = '';
    await processStamp(); renderStampCard(); refresh();
  });
  $('#stampClear').addEventListener('click', async () => { state.stamp.src = null; await processStamp(); renderStampCard(); refresh(); });
  $('#stampWhite').addEventListener('change', async e => { state.stamp.white = e.target.checked; await processStamp(); renderStampCard(); refresh(); });
  $('#stampRed').addEventListener('change', async e => { state.stamp.red = e.target.checked; await processStamp(); renderStampCard(); refresh(); });
  for (const [id, prop] of [['stampSize', 'size'], ['stampDx', 'dx'], ['stampDy', 'dy']]) {
    $(`#${id}`).addEventListener('input', e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { state.stamp[prop] = v; refresh(); } });
  }

  // 4단계
  $('#rangeSeg').addEventListener('click', e => {
    const b = e.target.closest('[data-range]');
    if (!b) return;
    state.range = b.dataset.range;
    $$('#rangeSeg button').forEach(x => x.classList.toggle('on', x === b)); save();
  });
  $('#bgInPdf').addEventListener('change', e => { state.bgInPdf = e.target.checked; save(); });
  $('#pdfBtn').addEventListener('click', exportPdf);
  $('#hwpxBtn').addEventListener('click', exportHwpx);

  // 미리보기 도구
  $('#prevRec').addEventListener('click', () => go(-1));
  $('#nextRec').addEventListener('click', () => go(1));
  $('#showBg').addEventListener('change', e => { state.showBg = e.target.checked; refresh(); });
  $('#showBoxes').addEventListener('change', e => { state.showBoxes = e.target.checked; refresh(); });
  $('#zoomSel').addEventListener('change', e => { state.zoom = e.target.value; applyZoom(); save(); });
  window.addEventListener('resize', applyZoom);
  document.addEventListener('keydown', e => {
    if (e.target.closest('input, textarea, select')) return;
    // 3단계에서 고른 상자는 방향키로 0.5mm(Shift: 5mm)씩 옮긴다
    if (state.step === 3 && state.selected && e.key.startsWith('Arrow')) {
      const f = state.fields.find(x => x.id === state.selected);
      const st = e.shiftKey ? 5 : 0.5;
      if (e.key === 'ArrowLeft') f.x -= st; if (e.key === 'ArrowRight') f.x += st;
      if (e.key === 'ArrowUp') f.y -= st; if (e.key === 'ArrowDown') f.y += st;
      f.x = Math.round(f.x * 100) / 100; f.y = Math.round(f.y * 100) / 100;
      e.preventDefault(); syncFieldInputs(f); refresh(); return;
    }
    if (e.key === 'Escape' && state.selected) { state.selected = null; markSelected(); refresh(); return; }
    if (e.key === 'ArrowRight' || e.key === 'PageDown') go(1);
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1);
  });
}

function renderFieldsFontNote() {
  const fi = fontInfo(state.fields[0].font);
  $('#fontNote').textContent = `${fi.name}: ${fi.license}`;
}

function go(d) {
  const n = state.rows.length;
  if (!n) return;
  closeEditor();
  state.current = (state.current + d + n) % n;
  if (state.step === 2) { renderGrid(); renderDirect(); }
  if (state.step === 4) $$('#recList li').forEach((li, i) => li.classList.toggle('cur', i === state.current));
  refresh();
}

function fileToDataUrl(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}

async function downscale(im, maxSide) {
  const k = Math.min(1, maxSide / Math.max(im.naturalWidth, im.naturalHeight));
  const cv = document.createElement('canvas');
  cv.width = Math.round(im.naturalWidth * k); cv.height = Math.round(im.naturalHeight * k);
  cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
  return cv.toDataURL(im.src.startsWith('data:image/png') ? 'image/png' : 'image/jpeg', 0.9);
}

// ---------- 시작 ----------
bind();
new ResizeObserver(() => { applyZoom(); positionEditor(); }).observe($('#canvas'));
$('#showBg').checked = state.showBg;
$('#showBoxes').checked = state.showBoxes;
$('#zoomSel').value = state.zoom;
$('#bgInPdf').checked = state.bgInPdf;
$$('#rangeSeg button').forEach(x => x.classList.toggle('on', x.dataset.range === state.range));
setStep(state.step || 1);
refresh();
