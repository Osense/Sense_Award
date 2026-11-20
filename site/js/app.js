// 쎈스 어워드 — 화면과 상태
import { FONTS, FontStore, DEFAULT_FONT, FALLBACK_FONT, fontInfo, variantKey } from './fonts.js';
import { PAPER, SAMPLE, FIELD_DEFS, defaultFields, BORDER_DEFAULT, BORDER_LIMITS, normBorder, borderSvg, contentRect } from './papers.js';
import { applyAutoLayout, layoutForRecord } from './autolayout.js';
import { tableFromPaste, usedKeys, fillTemplate, BUILTIN_VARS } from './data.js';
import { computeRecord, fontKeysFor, textLayerSvg } from './render.js';
import { buildPdf, buildTestPage } from './export-pdf.js';
import { subsetFont } from './subset.js';

const hbWasm = () => fetch('vendor/harfbuzz-subset.wasm').then(r => { if (!r.ok) throw new Error('subset wasm'); return r.arrayBuffer(); });
const subsetFn = (bytes, cps) => subsetFont(hbWasm, bytes, cps);
import { buildHwpx, TEMPLATE_FILES } from './export-hwpx.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clone = o => JSON.parse(JSON.stringify(o));
const STORE_KEY = 'sense-award:state:v3';
const LAYOUT_VERSION = 3;

// ---------- 상태 ----------
function freshState() {
  return {
    step: 1,
    border: { ...BORDER_DEFAULT },
    fields: defaultFields(),
    columns: [...SAMPLE.columns],
    rows: clone(SAMPLE.rows),
    current: 0,
    overrides: [],
    offset: { x: 0, y: 0 },
    measured: 100,
    stamp: { enabled: false, src: null, png: null, imgW: 0, imgH: 0, white: true, red: false, size: 20, dx: -5, dy: 0, manual: false },
    showBg: true, showBoxes: true, zoom: 'fit', range: 'all', bgInPdf: false,
    dataMode: 'paste', selected: null, sel: [], snap: true,
    layoutVersion: LAYOUT_VERSION,
  };
}

let state = load() || freshState();

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    // 남은 작업 내용은 살리되, 화면은 늘 첫 단계(용지)에서 시작한다
    const st = { ...freshState(), ...s, step: 1, current: 0, selected: null, sel: [], zoom: 'fit', dataMode: 'paste' };
    st.border = normBorder(st.border);
    // 배치 규칙이 바뀌었으면(참고 상장 비율 적용) 칸 기본 서식을 맞추고 자동 배치로 되돌린다
    if ((st.layoutVersion || 1) < LAYOUT_VERSION) {
      const defs = Object.fromEntries(FIELD_DEFS.map(d => [d.id, d]));
      st.fields = st.fields.map(f => {
        const d = defs[f.id] || {};
        return { ...f, manual: false, align: d.align ?? f.align, valign: d.valign ?? 'middle', spacing: d.spacing ?? 0, lineHeight: d.lineHeight ?? f.lineHeight };
      });
      st.stamp = { ...st.stamp, manual: false };
      st.layoutVersion = LAYOUT_VERSION;
    }
    return st;
  } catch { return null; }
}
let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch {
      // 이미지가 커서 못 담으면 이미지만 빼고 저장
      try { localStorage.setItem(STORE_KEY, JSON.stringify({ ...state, stamp: { ...state.stamp, src: null, png: null, enabled: false } })); } catch {}
    }
  }, 300);
  scheduleCommit();
}

const paperSize = () => PAPER;
const docView = () => {
  const d = { fields: state.fields, columns: state.columns, rows: state.rows, stamp: state.stamp, overrides: state.overrides };
  // 장마다 그 장의 글 길이로 자동 배치(짧은 본문은 커지고 긴 본문은 작아짐)
  d.layoutFor = i => layoutForRecord(d, store, state.border, i);
  return d;
};
const bgHref = () => svgDataUrl(borderSvg(state.border));

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

// ---------- 되돌리기·다시 하기 ----------
// 문서 내용(칸·명단·고친 글·테두리·도장 설정)만 기록한다. 화면 상태(단계·확대)는 기록하지 않는다.
const HIST_KEYS = ['fields', 'columns', 'rows', 'overrides', 'border', 'stamp', 'offset', 'measured'];
const HIST_MAX = 120;
let undoStack = [];
let redoStack = [];
let histCur = null;    // 지금 상태의 기록
let histCurStr = '';
let commitTimer = 0;
let restoring = false;

function snapshot() {
  const o = {};
  for (const k of HIST_KEYS) {
    // 도장 그림(용량이 큼)은 기록에서 빼고 참조만 남긴다
    o[k] = k === 'stamp' ? { ...state.stamp, src: undefined, png: undefined, _img: stampImages(state.stamp) } : clone(state[k]);
  }
  return o;
}
const stampImgs = new Map();
function stampImages(st) {
  if (!st.src) return null;
  const key = `${st.src.length}:${st.src.slice(-48)}:${st.png ? st.png.length : 0}`;
  stampImgs.set(key, { src: st.src, png: st.png });
  return key;
}
function snapStr(o) { return JSON.stringify(o); }

function resetHistory() {
  undoStack = []; redoStack = [];
  histCur = snapshot(); histCurStr = snapStr(histCur);
  updateHistButtons();
}

function scheduleCommit() {
  if (restoring) return;
  clearTimeout(commitTimer);
  commitTimer = setTimeout(commitNow, 350);
}

function commitNow() {
  clearTimeout(commitTimer);
  if (restoring || drag) return; // 끄는 중에는 놓을 때 한 번만 기록
  const snap = snapshot();
  const str = snapStr(snap);
  if (str === histCurStr) return;
  if (histCur) undoStack.push(histCur);
  if (undoStack.length > HIST_MAX) undoStack.shift();
  redoStack = [];
  histCur = snap; histCurStr = str;
  updateHistButtons();
}

function restore(snap) {
  restoring = true;
  for (const k of HIST_KEYS) {
    if (k === 'stamp') {
      const img = snap.stamp._img ? stampImgs.get(snap.stamp._img) : null;
      state.stamp = { ...clone({ ...snap.stamp, _img: undefined }), src: img ? img.src : null, png: img ? img.png : null };
    } else state[k] = clone(snap[k]);
  }
  histCur = snap; histCurStr = snapStr(snap);
  state.sel = (state.sel || []).filter(id => state.fields.some(f => f.id === id));
  if (!state.sel.includes(state.selected)) state.selected = state.sel[state.sel.length - 1] || null;
  closeEditor();
  // 지금 보고 있는 단계 화면을 다시 그린다
  if (state.step === 1) renderBorderPage(true);
  if (state.step === 2) renderData();
  if (state.step === 3) { renderRibbon(); renderStampCard(); }
  if (state.step === 4) { renderSummary(); renderOffset(); }
  refresh();
  updateHistButtons();
  restoring = false;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
}

function undo() {
  commitNow();
  if (!undoStack.length) return;
  redoStack.push(histCur);
  restore(undoStack.pop());
  setStatus('되돌렸어요');
}
function redo() {
  commitNow();
  if (!redoStack.length) return;
  undoStack.push(histCur);
  restore(redoStack.pop());
  setStatus('다시 했어요');
}
function updateHistButtons() {
  const u = $('#undoBtn'), r = $('#redoBtn');
  if (!u) return;
  u.disabled = !undoStack.length;
  r.disabled = !redoStack.length;
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
  $('#snapToggle').hidden = n !== 3;
  if (n === 1) renderBorderPage(true);
  if (n === 2) renderData();
  if (n === 3) renderRibbon();
  if (n === 4) { renderSummary(); renderOffset(); }
  $$('.page-scroll, .inspector').forEach(el => { el.scrollTop = 0; });
  refresh();
  requestAnimationFrame(applyZoom);
}

// ---------- 1. 용지 ----------
function svgDataUrl(svg) { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); }

// 1단계: 시판 용지 테두리 설정. 미리보기에는 지금 명단 첫 장을 자동 배치로 함께 보여 준다.
const BORDER_KEYS = ['inset', 'thick', 'gap', 'thin', 'notch', 'ornament', 'pad'];

function renderBorderPage(syncInputs) {
  const B = state.border;
  if (syncInputs) {
    for (const k of BORDER_KEYS) {
      const [lo, hi, step] = BORDER_LIMITS[k];
      $$(`[data-b="${k}"]`).forEach(el => { el.min = lo; el.max = hi; el.step = step; if (el !== document.activeElement) el.value = B[k]; });
    }
    $('#b-color').value = B.color;
  }
  const changed = BORDER_KEYS.filter(k => B[k] !== BORDER_DEFAULT[k]).length + (B.color !== BORDER_DEFAULT.color ? 1 : 0);
  $('#borderNote').textContent = changed ? `기본값에서 ${changed}가지를 바꿨어요` : '시판 기본값이에요';
  $$('.bctl').forEach(el => el.classList.toggle('changed', BORDER_KEYS.includes(el.dataset.bkey) && B[el.dataset.bkey] !== BORDER_DEFAULT[el.dataset.bkey]));
  drawBorderView();
}

async function drawBorderView() {
  const { w, h } = paperSize();
  const B = normBorder(state.border);
  let text = '';
  try {
    await ensureFonts();
    applyAutoLayout(docView(), store, state.border, undefined, Math.min(state.current, Math.max(0, state.rows.length - 1)));
    text = `<g opacity=".88">${textLayerSvg(computeRecord(docView(), Math.min(state.current, Math.max(0, state.rows.length - 1)), store))}</g>`;
  } catch {}
  // 치수 안내: 가장자리 → 굵은 선, 가는 선 → 글 영역
  const C = contentRect(B);
  const mx = w * 0.62;
  const dim = (x, y1, y2, label) => `<g class="dim"><line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}"/><line x1="${x - 1.6}" y1="${y1}" x2="${x + 1.6}" y2="${y1}"/><line x1="${x - 1.6}" y1="${y2}" x2="${x + 1.6}" y2="${y2}"/><text x="${x + 2.2}" y="${(y1 + y2) / 2 + 1.2}">${label}</text></g>`;
  const inner = B.inset + B.gap;
  const dims = dim(mx, 0, B.inset, `${B.inset}mm`) + dim(mx + 22, inner + B.thin / 2, C.y, `여백 ${B.pad}mm`);
  const svg = borderSvg(B, { guides: true }).replace('</svg>', `${text}${dims}</svg>`);
  $('#borderView').innerHTML = svg.replace('<svg ', `<svg style="aspect-ratio:${w}/${h}" `);
}

function setBorder(key, value) {
  const v = key === 'color' ? value : parseFloat(value);
  if (key !== 'color' && !Number.isFinite(v)) return;
  state.border = normBorder({ ...state.border, [key]: v });
  renderBorderPage(false);
  $$(`[data-b="${key}"]`).forEach(el => { if (el !== document.activeElement) el.value = state.border[key]; });
  save();
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
  if (oldCols.join() !== t.columns.join()) renderRibbon();
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

// 여러 칸 고르기: state.sel 은 고른 칸 목록, state.selected 는 그중 대표(리본에 값을 보여 줄 칸)
const selIds = () => state.sel || [];
const isSel = id => selIds().includes(id);
function selFields() { return state.fields.filter(f => isSel(f.id)); }
function selField() { return isSel(state.selected) ? state.fields.find(x => x.id === state.selected) : (selFields()[0] || null); }
function setSelection(ids, primary) {
  state.sel = [...new Set(ids)].filter(id => state.fields.some(f => f.id === id));
  state.selected = primary && state.sel.includes(primary) ? primary : (state.sel[state.sel.length - 1] || null);
  renderRibbon();
  refresh();
}

// 상단 리본: 고른 칸의 서식을 보여 주고 바로 고친다 (칸을 안 고르면 글꼴은 모든 칸에)
function renderRibbon() {
  if (!$('#ribbon')) return;
  const f = selField();
  const many = selIds().length > 1;
  $('#rbField').innerHTML = (many ? `<option value="" selected>${selIds().length}개 칸</option>` : `<option value="">칸 고르기</option>`)
    + state.fields.map(x => `<option value="${x.id}" ${!many && f && f.id === x.id ? 'selected' : ''}>${esc(x.label)}</option>`).join('');
  const allSame = state.fields.every(x => x.font === state.fields[0].font);
  const fontSel = f ? f.font : (allSame ? state.fields[0].font : '');
  $('#rbFont').innerHTML = (f ? '' : `<option value="" ${fontSel ? '' : 'selected'} disabled>모든 칸 글꼴…</option>`)
    + FONTS.map(x => `<option value="${x.id}" ${x.id === fontSel ? 'selected' : ''}>${esc(x.name)}${f ? '' : ' (모든 칸)'}</option>`).join('');
  $('#rbFont').title = f ? `${f.label} 글꼴` : '모든 칸 글꼴 한 번에 바꾸기';
  const dis = !f;
  $$('#ribbon [data-need-field], #rbSize, #rbBold, #rbColor, #rbAlign button, #rbValign button, #rbLH, #rbMax, #ribbon [data-pop="fit"], #ribbon [data-pop="place"], #rbText, [data-size]')
    .forEach(el => { el.disabled = dis; });
  $('#ribbon').classList.toggle('nosel', dis);
  const manualCount = state.fields.filter(x => x.manual).length + (state.stamp.manual ? 1 : 0);
  $('#rbAutoAll').disabled = !manualCount;
  $('#rbAutoAll').title = manualCount ? `직접 바꾼 ${manualCount}곳을 자동 배치로 되돌려요` : '모든 칸이 자동 배치예요';
  const sf = selFields();
  const nManual = sf.filter(x => x.manual).length;
  $('#rbAuto').textContent = !f ? '' : nManual === 0 ? '자동 배치' : nManual === sf.length ? '직접 배치' : '일부 직접 배치';
  $('#rbAuto').className = 'auto-state' + (f ? (nManual ? ' manual' : ' auto') : '');
  $('#rbAutoField').hidden = !f || !nManual;
  $('#popPlaceTitle').textContent = many ? `고른 상자 ${sf.length}개끼리 맞추기` : '상자를 글 영역 기준으로 정렬';
  $$('#pop-place .multi-only').forEach(el => { el.hidden = !many; });
  $$('#pop-place [data-place^="dist"]').forEach(el => { el.disabled = sf.length < 3; });
  $('#posNote').textContent = many ? `숫자는 대표 칸(${f ? f.label : ''})에만 적용돼요.` : '';
  if (!f) { $('#rbInfo').textContent = ''; closePops(['fit', 'place']); return; }
  $('#rbSize').value = f.size;
  $('#rbBold').classList.toggle('on', !!f.bold);
  $('#rbColor').value = f.color || '#111111';
  $('.rb-color span').style.background = f.color || '#111111';
  $$('#rbAlign button').forEach(b => b.classList.toggle('on', b.dataset.align === f.align));
  $$('#rbValign button').forEach(b => b.classList.toggle('on', b.dataset.valign === f.valign));
  $('#rbLH').value = f.lineHeight;
  $('#rbMax').value = f.maxLines;
  $('#rbMinSize').value = f.minSize;
  $('#rbMinScale').value = f.minScale;
  $('#rbMinSpacing').value = f.minSpacing;
  for (const k of ['x', 'y', 'w', 'h']) { const el = $(`#rb${k.toUpperCase()}`); if (el !== document.activeElement) el.value = f[k]; }
  ribbonInfo();
}

function ribbonInfo() {
  const f = selField();
  const el = $('#rbInfo');
  if (!el) return;
  const r = f && lastRecord ? lastRecord.fields.find(x => x.field.id === f.id) : null;
  if (!r || r.pending) { el.textContent = ''; el.className = 'rb-info'; return; }
  const shrunk = r.sizePt < f.size || r.scale < 100 || r.spacing < 0;
  el.textContent = r.overflow ? '이 장에서 글이 넘쳐요' : shrunk ? `이 장: ${r.sizePt}pt · 장평 ${r.scale}% · 자간 ${r.spacing}%` : '';
  el.className = 'rb-info' + (r.overflow ? ' over' : shrunk ? ' fit' : '');
}

let openPop = null;
function togglePop(name) {
  const was = openPop;
  closePops();
  if (was === name) return;
  const pop = $(`#pop-${name}`);
  const btn = $(`#ribbon [data-pop="${name}"]`);
  if (!pop || !btn || btn.disabled) return;
  if (name === 'stamp') renderStampCard();
  pop.hidden = false;
  btn.classList.add('on');
  const rb = $('#ribbon').getBoundingClientRect();
  const br = btn.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(br.left - rb.left, rb.width - pop.offsetWidth - 8))}px`;
  openPop = name;
}
function closePops(only) {
  $$('#ribbon .pop').forEach(p => {
    const n = p.id.replace('pop-', '');
    if (only && !only.includes(n)) return;
    p.hidden = true;
    const b = $(`#ribbon [data-pop="${n}"]`); if (b) b.classList.remove('on');
    if (openPop === n) openPop = null;
  });
}

function selectField(id) { setSelection(id ? [id] : [], id); }

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
    if (['size', 'minSize', 'x', 'y', 'w', 'h'].includes(prop)) f.manual = true;
    if (prop === 'size' && f.minSize > v) f.minSize = v;
    if (prop === 'minSize' && v > f.size) f.size = v;
  } else f[prop] = value;
  if (prop !== 'text') renderRibbon();
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
  applyAutoLayout(docView(), store, state.border, undefined, Math.min(state.current, Math.max(0, state.rows.length - 1)));
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
    bg = `<image href="${bgHref()}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none"/>`;
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
      const cls = ['box', r.overflow ? 'over' : '', isSel(f.id) ? 'sel' : '', isSel(f.id) && f.id === state.selected && selIds().length > 1 ? 'primary' : '', state.step === 3 ? 'drag' : ''].join(' ');
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
    <rect width="${w}" height="${h}" fill="#fff"/>${bg}<g class="text-layer">${textLayerSvg(rec)}</g>${stamp}<g class="box-layer">${boxes}</g><g class="guide-layer">${guideSvg()}${marqueeSvg()}</g></svg>`;
  ribbonInfo();
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

const PX_PER_MM = 96 / 25.4;
function fitScale() {
  const { w, h } = paperSize();
  const canvas = $('#canvas');
  const pad = 56;
  return Math.max(0.3, Math.min((canvas.clientWidth - pad) / w, (canvas.clientHeight - pad) / h));
}
function currentScale() { return state.zoom === 'fit' ? fitScale() : Number(state.zoom) * PX_PER_MM; }

function applyZoom() {
  const svg = $('#page');
  const { w, h } = paperSize();
  const scale = currentScale();
  if (svg) { svg.style.width = `${w * scale}px`; svg.style.height = `${h * scale}px`; }
  $('#zoomVal').textContent = `${Math.round(scale / PX_PER_MM * 100)}%`;
  $('#zoomFit').classList.toggle('on', state.zoom === 'fit');
  positionEditor();
}

function zoomBy(k, cx, cy) {
  const canvas = $('#canvas');
  const svg = $('#page');
  if (!svg) return;
  const old = currentScale();
  const next = Math.min(6 * PX_PER_MM, Math.max(0.25 * PX_PER_MM, old * k));
  // 마우스(없으면 화면 가운데) 아래 지점이 그대로 있도록 스크롤을 맞춘다
  const cr = canvas.getBoundingClientRect();
  const px = cx ?? cr.left + cr.width / 2, py = cy ?? cr.top + cr.height / 2;
  const sr = svg.getBoundingClientRect();
  const mx = (px - sr.left) / old, my = (py - sr.top) / old;
  state.zoom = next / PX_PER_MM;
  applyZoom();
  const nr = svg.getBoundingClientRect();
  canvas.scrollLeft += (nr.left + mx * next) - px;
  canvas.scrollTop += (nr.top + my * next) - py;
  save();
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

function contentArea() { return contentRect(state.border); }

// 끌고 있는 상자(여러 개면 묶음 전체)의 가장자리·가운데를 용지 가운데, 글 영역, 다른 상자에 붙인다
// lock: 'x' 면 가로로만, 'y' 면 세로로만 움직인다(Shift)
function snapBox(o, mode, dx, dy, enabled, svg, exclude, lock) {
  const r2 = v => Math.round(v * 2) / 2;
  let box = mode === 'move'
    ? { x: o.x + dx, y: o.y + dy, w: o.w, h: o.h }
    : { x: o.x, y: o.y, w: Math.max(5, o.w + dx), h: Math.max(3, o.h + dy) };
  const out = { x: [], y: [] };
  const round = v => Math.round(v * 100) / 100;
  const done = () => ({ box: { x: round(box.x), y: round(box.y), w: round(box.w), h: round(box.h) }, guides: out });
  if (!enabled) {
    if (lock !== 'y') box.x = r2(box.x);
    if (lock !== 'x') box.y = r2(box.y);
    if (mode !== 'move') { box.w = r2(box.w); box.h = r2(box.h); }
    return done();
  }
  const { w: W, h: H } = paperSize();
  const ca = contentArea();
  // 화면에서 6px 안이면 붙는다
  const ctm = svg.getScreenCTM();
  const tol = 6 / (ctm ? ctm.a : 3);
  const tx = [W / 2, ca.x, ca.x + ca.w];
  const ty = [H / 2, ca.y, ca.y + ca.h];
  for (const g of state.fields) {
    if (exclude.has(g.id)) continue;
    tx.push(g.x, g.x + g.w / 2, g.x + g.w);
    ty.push(g.y, g.y + g.h / 2, g.y + g.h);
  }
  const best = (cands, targets) => {
    let b = null;
    for (const val of cands) for (const t of targets) {
      const dd = t - val;
      if (Math.abs(dd) <= tol && (!b || Math.abs(dd) < Math.abs(b.d))) b = { d: dd, t };
    }
    return b;
  };
  if (mode === 'move') {
    if (lock !== 'y') {
      const bx = best([box.x, box.x + box.w / 2, box.x + box.w], tx);
      if (bx) box.x += bx.d; else box.x = r2(box.x);
      for (const t of new Set(tx)) if ([box.x, box.x + box.w / 2, box.x + box.w].some(v => Math.abs(v - t) < 0.01)) out.x.push(t);
    }
    if (lock !== 'x') {
      const by = best([box.y, box.y + box.h / 2, box.y + box.h], ty);
      if (by) box.y += by.d; else box.y = r2(box.y);
      for (const t of new Set(ty)) if ([box.y, box.y + box.h / 2, box.y + box.h].some(v => Math.abs(v - t) < 0.01)) out.y.push(t);
    }
    // Shift로 묶은 축은 처음 자리의 가운데 선을 보여 준다
    if (lock === 'x') out.y.push(o.y + o.h / 2);
    if (lock === 'y') out.x.push(o.x + o.w / 2);
  } else {
    const bx = best([box.x + box.w], tx);
    if (bx) box.w += bx.d; else box.w = r2(box.w);
    const by = best([box.y + box.h], ty);
    if (by) box.h += by.d; else box.h = r2(box.h);
    if (bx) out.x.push(bx.t);
    if (by) out.y.push(by.t);
  }
  return done();
}

function boundsOf(list) {
  const x1 = Math.min(...list.map(f => f.x)), y1 = Math.min(...list.map(f => f.y));
  const x2 = Math.max(...list.map(f => f.x + f.w)), y2 = Math.max(...list.map(f => f.y + f.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function guideSvg() {
  const { w, h } = paperSize();
  let s = '';
  for (const x of guides.x) s += `<line class="guide${Math.abs(x - w / 2) < 0.01 ? ' mid' : ''}" x1="${x}" y1="0" x2="${x}" y2="${h}"/>`;
  for (const y of guides.y) s += `<line class="guide${Math.abs(y - h / 2) < 0.01 ? ' mid' : ''}" x1="0" y1="${y}" x2="${w}" y2="${y}"/>`;
  if (s && drag && drag.mode !== 'marquee') {
    const ca = contentArea();
    s = `<rect class="content-area" x="${ca.x}" y="${ca.y}" width="${ca.w}" height="${ca.h}"/>` + s;
  }
  return s;
}

const f0 = id => state.fields.find(x => x.id === id);

function placeSelected(how) {
  const list = selFields();
  if (!list.length) return;
  const { w: W, h: H } = paperSize();
  const ca = contentArea();
  const rd = v => Math.round(v * 100) / 100;
  list.forEach(f => { f.manual = true; });
  guides = { x: [], y: [] };
  if (list.length === 1) {
    const f = list[0];
    // 하나면 글 영역(용지) 기준
    if (how === 'left') f.x = ca.x;
    if (how === 'hcenter') f.x = rd((W - f.w) / 2);
    if (how === 'right') f.x = rd(ca.x + ca.w - f.w);
    if (how === 'top') f.y = ca.y;
    if (how === 'vcenter') f.y = rd((H - f.h) / 2);
    if (how === 'bottom') f.y = rd(ca.y + ca.h - f.h);
    if (how === 'fullw') { f.x = ca.x; f.w = ca.w; }
    if (how === 'hcenter') guides.x.push(W / 2);
    if (how === 'vcenter') guides.y.push(H / 2);
    if (how === 'left' || how === 'fullw') guides.x.push(ca.x);
    if (how === 'right' || how === 'fullw') guides.x.push(ca.x + ca.w);
    if (how === 'top') guides.y.push(ca.y);
    if (how === 'bottom') guides.y.push(ca.y + ca.h);
  } else {
    // 여럿이면 고른 상자끼리(묶음의 바깥 테두리 기준)
    const b = boundsOf(list);
    if (how === 'left') { list.forEach(f => { f.x = rd(b.x); }); guides.x.push(b.x); }
    if (how === 'right') { list.forEach(f => { f.x = rd(b.x + b.w - f.w); }); guides.x.push(b.x + b.w); }
    if (how === 'hcenter') { const c = b.x + b.w / 2; list.forEach(f => { f.x = rd(c - f.w / 2); }); guides.x.push(c); }
    if (how === 'top') { list.forEach(f => { f.y = rd(b.y); }); guides.y.push(b.y); }
    if (how === 'bottom') { list.forEach(f => { f.y = rd(b.y + b.h - f.h); }); guides.y.push(b.y + b.h); }
    if (how === 'vcenter') { const c = b.y + b.h / 2; list.forEach(f => { f.y = rd(c - f.h / 2); }); guides.y.push(c); }
    if (how === 'fullw') { list.forEach(f => { f.x = ca.x; f.w = ca.w; }); guides.x.push(ca.x, ca.x + ca.w); }
    if (how === 'groupHcenter') { const d = W / 2 - (b.x + b.w / 2); list.forEach(f => { f.x = rd(f.x + d); }); guides.x.push(W / 2); }
    if (how === 'distV' && list.length >= 3) {
      // 위에서 아래로: 첫 칸과 끝 칸은 그대로, 사이 간격을 똑같이
      const s = [...list].sort((a, c) => a.y - c.y);
      const gap = (b.h - s.reduce((a, f) => a + f.h, 0)) / (s.length - 1);
      let y = s[0].y;
      s.forEach(f => { f.y = rd(y); y += f.h + gap; });
    }
    if (how === 'distH' && list.length >= 3) {
      const s = [...list].sort((a, c) => a.x - c.x);
      const gap = (b.w - s.reduce((a, f) => a + f.w, 0)) / (s.length - 1);
      let x = s[0].x;
      s.forEach(f => { f.x = rd(x); x += f.w + gap; });
    }
  }
  clearTimeout(placeSelected.t);
  placeSelected.t = setTimeout(() => { guides = { x: [], y: [] }; refresh(); }, 900);
  renderRibbon();
  refresh();
}

function syncFieldInputs() { renderRibbon(); }

let drag = null;
let lastDownBox = null;

function marqueeSvg() {
  if (!drag || drag.mode !== 'marquee' || !drag.moved) return '';
  const r = drag.rect;
  return `<rect class="marquee" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>`;
}

$('#sheet').addEventListener('pointerdown', ev => {
  const svg = $('#page');
  if (!svg) return;
  const box = ev.target.closest('[data-box]');
  if (state.step === 4) {
    if (box) { openEditor(box.dataset.box); ev.preventDefault(); } else closeEditor();
    return;
  }
  if (state.step !== 3) return;
  lastDownBox = box ? box.dataset.box : null;
  const p = svgPoint(svg, ev);
  const additive = ev.shiftKey || ev.ctrlKey || ev.metaKey;
  ev.preventDefault();
  $('#sheet').setPointerCapture(ev.pointerId);
  if (!box) {
    // 빈 곳을 끌면 상자 여러 개를 한 번에 고른다(Shift·Ctrl을 누르면 더하기)
    closeEditor();
    drag = { mode: 'marquee', start: p, rect: { x: p.x, y: p.y, w: 0, h: 0 }, base: additive ? [...selIds()] : [], additive, moved: false };
    return;
  }
  const id = box.dataset.box;
  if (ev.target.closest('[data-handle]')) {
    // 크기 조절은 잡은 상자 하나만
    if (!(selIds().length === 1 && isSel(id))) setSelection([id], id);
    const f = f0(id);
    drag = { mode: 'resize', id, start: p, orig: { x: f.x, y: f.y, w: f.w, h: f.h }, moved: false };
    return;
  }
  let pendingToggle = null, pendingSingle = null;
  if (additive) {
    if (isSel(id)) pendingToggle = id;               // 끌지 않고 놓으면 빼기
    else { state.sel = [...selIds(), id]; state.selected = id; renderRibbon(); }
  } else if (!isSel(id)) {
    state.sel = [id]; state.selected = id; renderRibbon();
  } else {
    state.selected = id; pendingSingle = id;         // 끌지 않고 놓으면 이 상자만
    renderRibbon();
  }
  const origs = new Map(selFields().map(f => [f.id, { x: f.x, y: f.y, w: f.w, h: f.h }]));
  drag = { mode: 'move', id, start: p, origs, orig: boundsOf([...origs.values()]), moved: false, pendingToggle, pendingSingle };
  refresh();
});

$('#sheet').addEventListener('pointermove', ev => {
  if (!drag) return;
  const svg = $('#page');
  const p = svgPoint(svg, ev);
  let dx = p.x - drag.start.x, dy = p.y - drag.start.y;
  if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 0.6) drag.moved = true;
  if (!drag.moved) return;
  if (drag.mode === 'marquee') {
    const r = { x: Math.min(p.x, drag.start.x), y: Math.min(p.y, drag.start.y), w: Math.abs(dx), h: Math.abs(dy) };
    drag.rect = r;
    const hits = state.fields.filter(f => f.x < r.x + r.w && f.x + f.w > r.x && f.y < r.y + r.h && f.y + f.h > r.y).map(f => f.id);
    state.sel = [...new Set([...drag.base, ...hits])];
    state.selected = state.sel.includes(state.selected) ? state.selected : (state.sel[state.sel.length - 1] || null);
    refresh();
    return;
  }
  if (drag.mode === 'resize') {
    const f = f0(drag.id);
    f.manual = true;
    const r = snapBox(drag.orig, 'resize', dx, dy, state.snap && !ev.altKey, svg, new Set([drag.id]), null);
    Object.assign(f, r.box);
    guides = r.guides;
    refresh();
    return;
  }
  // 옮기기: Shift를 누르면 많이 움직인 쪽(가로/세로)으로만
  let lock = null;
  if (ev.shiftKey) { lock = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y'; if (lock === 'x') dy = 0; else dx = 0; }
  drag.pendingToggle = null; drag.pendingSingle = null;
  const r = snapBox(drag.orig, 'move', dx, dy, state.snap && !ev.altKey, svg, new Set(drag.origs.keys()), lock);
  const ddx = r.box.x - drag.orig.x, ddy = r.box.y - drag.orig.y;
  for (const [id, o] of drag.origs) {
    const f = f0(id);
    f.manual = true;
    f.x = Math.round((o.x + ddx) * 100) / 100;
    f.y = Math.round((o.y + ddy) * 100) / 100;
  }
  guides = r.guides;
  refresh();
});

$('#sheet').addEventListener('pointerup', () => {
  if (!drag) return;
  const d = drag;
  drag = null;
  guides = { x: [], y: [] };
  if (d.mode === 'marquee') {
    if (!d.moved && !d.additive) { setSelection([], null); return; }
    renderRibbon(); refresh();
    return;
  }
  if (!d.moved) {
    if (d.pendingToggle) { setSelection(selIds().filter(x => x !== d.pendingToggle)); return; }
    if (d.pendingSingle && selIds().length > 1) { setSelection([d.pendingSingle], d.pendingSingle); return; }
  }
  commitNow();
  renderRibbon();
  refresh();
});

// ---------- 이 상장만 직접 고치기 ----------
let editing = null; // { mode: 'override' | 'template', field, index }
function currentText(index, fieldId) {
  const ov = state.overrides[index] && state.overrides[index][fieldId];
  if (typeof ov === 'string') return ov;
  const f = state.fields.find(x => x.id === fieldId);
  return fillTemplate(f.text, state.columns, state.rows[index] || [], index).text;
}
function openEditor(fieldId, mode = 'override') {
  if (mode === 'override' && !state.rows.length) return;
  syncOverrides();
  const f = state.fields.find(x => x.id === fieldId);
  editing = { mode, field: fieldId, index: state.current };
  const ta = $('#edText');
  if (mode === 'template') {
    $('#edTitle').textContent = `${f.label} 칸 문구`;
    $('#edHint').textContent = '모든 상장에 적용 · 변수를 눌러 넣어요';
    ta.value = f.text;
    $('#edReset').textContent = '기본 문구로';
    const def = FIELD_DEFS.find(d => d.id === fieldId);
    $('#edReset').disabled = !def || def.text === f.text;
    $('#edChips').hidden = false;
    $('#edChips').innerHTML = [...state.columns, ...BUILTIN_VARS].map(k => `<button class="chip" data-insert="{{${esc(k)}}}">{{${esc(k)}}}</button>`).join('');
  } else {
    $('#edTitle').textContent = `${state.current + 1}번 ${recName(state.current)} · ${f.label}`;
    $('#edHint').textContent = '이 상장에만 적용돼요';
    ta.value = currentText(state.current, fieldId);
    $('#edReset').textContent = '원래 문구로';
    $('#edReset').disabled = typeof state.overrides[state.current][fieldId] !== 'string';
    $('#edChips').hidden = true;
  }
  ta.rows = fieldId === 'body' ? 5 : 2;
  $('#editor').hidden = false;
  refresh();
  requestAnimationFrame(() => { positionEditor(); ta.focus(); if (mode === 'override') ta.select(); });
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
  if (editing.mode === 'override' && editing.index !== state.current) { closeEditor(); return; }
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

// 시험 인쇄에서 잰 100mm 선 길이로 배율을 보정한다(97mm로 나왔다면 100/97배 키움)
function printScale() {
  const m = Number(state.measured);
  return Number.isFinite(m) && m >= 80 && m <= 120 ? 100 / m : 1;
}

function renderPrintNote() {
  // 프린터가 못 찍는 가장자리(보통 3~5mm)에 글이 걸리는지 확인
  const { w: W, h: H } = paperSize();
  let minEdge = Infinity;
  for (const f of state.fields) minEdge = Math.min(minEdge, f.x, f.y, W - f.x - f.w, H - f.y - f.h);
  const safe = $('#printSafe');
  if (safe) {
    const v = Math.max(0, Math.floor(minEdge * 10) / 10);
    safe.textContent = minEdge >= 5
      ? `글 상자는 용지 가장자리에서 가장 가까운 곳도 ${v}mm 떨어져 있어 프린터 여백에 잘리지 않아요.`
      : `글 상자 하나가 용지 가장자리에서 ${v}mm밖에 떨어져 있지 않아요. 프린터에 따라 잘릴 수 있으니 3단계에서 안쪽으로 옮겨 주세요.`;
    safe.classList.toggle('bad', minEdge < 5);
  }
  const k = printScale();
  const parts = [];
  if (Math.abs(k - 1) > 1e-6) parts.push(`배율 ${(k * 100).toFixed(1)}%로 보정해서 내보내요`);
  if (state.offset.x || state.offset.y) parts.push(`위치를 가로 ${state.offset.x}mm, 세로 ${state.offset.y}mm 옮겨서 내보내요`);
  $('#printNote').textContent = parts.length ? parts.join(' · ') : '보정 없이 그대로 내보내요.';
}

function renderOffset() {
  $('#offX').value = state.offset.x;
  $('#offY').value = state.offset.y;
  $('#measured').value = state.measured;
  renderPrintNote();
}

async function exportTestPage() {
  try {
    const font = await store.load('nanum-gothic:regular');
    const bytes = await buildTestPage({
      PDFLib: window.PDFLib, fontkit: window.fontkit, fontHandle: font, subset: subsetFn,
      paper: paperSize(), border: state.border, content: contentRect(state.border),
      offset: state.offset, scale: printScale(),
    });
    download(bytes, '쎈스어워드_맞춤확인_인쇄.pdf', 'application/pdf');
  } catch (e) { console.error(e); setStatus(`시험 인쇄 PDF를 만들지 못했어요: ${e.message}`, 'warn'); }
}

let busy = false;
async function exportPdf() {
  if (busy || !state.rows.length) return;
  busy = true;
  try {
    await ensureFonts(true);
    applyAutoLayout(docView(), store, state.border, undefined, Math.min(state.current, Math.max(0, state.rows.length - 1)));
    const indices = allIndices();
    progress(0, indices.length, '준비 중…');
    const res = await buildPdf({
      PDFLib: window.PDFLib, fontkit: window.fontkit, doc: docView(), store, indices,
      paper: paperSize(), offset: state.offset, scale: printScale(),
      stampPng: state.stamp.png ? dataUrlBytes(state.stamp.png) : null,
      border: state.bgInPdf ? state.border : null,
      subset: subsetFn,
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
    applyAutoLayout(docView(), store, state.border, undefined, Math.min(state.current, Math.max(0, state.rows.length - 1)));
    const indices = allIndices();
    progress(0, 1, '한글 파일 만드는 중…');
    const res = await buildHwpx({
      JSZip: window.JSZip, template: await loadTemplate(), doc: docView(), store, indices,
      paper: paperSize(), offset: state.offset, scale: printScale(),
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
    resetHistory(); setStep(1); refresh();
  });

  // 1단계: 테두리 수치
  $('.paper-side').addEventListener('input', e => {
    const el = e.target.closest('[data-b]');
    if (el) setBorder(el.dataset.b, el.value);
  });
  $('#borderReset').addEventListener('click', () => { state.border = { ...BORDER_DEFAULT }; renderBorderPage(true); save(); });
  $('#offX').addEventListener('input', e => { state.offset.x = parseFloat(e.target.value) || 0; renderPrintNote(); save(); });
  $('#offY').addEventListener('input', e => { state.offset.y = parseFloat(e.target.value) || 0; renderPrintNote(); save(); });
  $('#measured').addEventListener('input', e => { const v = parseFloat(e.target.value); state.measured = Number.isFinite(v) ? v : 100; renderPrintNote(); save(); });
  $('#testPageBtn').addEventListener('click', exportTestPage);

  // 되돌리기
  $('#undoBtn').addEventListener('click', undo);
  $('#redoBtn').addEventListener('click', redo);

  $('#snapOn').addEventListener('change', e => { state.snap = e.target.checked; save(); });

  // 직접 고치기
  $('#edText').addEventListener('input', e => {
    if (!editing) return;
    if (editing.mode === 'template') {
      state.fields.find(x => x.id === editing.field).text = e.target.value;
      $('#edReset').disabled = false;
      refresh(); return;
    }
    syncOverrides();
    state.overrides[editing.index][editing.field] = e.target.value;
    $('#edReset').disabled = false;
    refresh();
  });
  $('#edReset').addEventListener('click', () => {
    if (!editing) return;
    if (editing.mode === 'template') {
      const def = FIELD_DEFS.find(d => d.id === editing.field);
      if (def) { state.fields.find(x => x.id === editing.field).text = def.text; $('#edText').value = def.text; }
      $('#edReset').disabled = true; refresh(); return;
    }
    delete state.overrides[editing.index][editing.field];
    $('#edText').value = currentText(editing.index, editing.field);
    $('#edReset').disabled = true;
    refresh();
  });
  $('#edDone').addEventListener('click', closeEditor);
  $('#edChips').addEventListener('click', e => {
    const ins = e.target.closest('[data-insert]');
    if (!ins || !editing) return;
    const ta = $('#edText');
    const a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? a;
    ta.value = ta.value.slice(0, a) + ins.dataset.insert + ta.value.slice(b);
    ta.focus(); ta.selectionStart = ta.selectionEnd = a + ins.dataset.insert.length;
    ta.dispatchEvent(new Event('input'));
  });
  $('#sheet').addEventListener('dblclick', e => {
    if (state.step !== 3) return;
    const id = lastDownBox || (e.target.closest('[data-box]') || {}).dataset?.box;
    if (id) { selectField(id); openEditor(id, 'template'); }
  });
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

  // 3단계: 상단 리본
  // 여러 칸을 골랐으면 모두에 적용(위치·크기 숫자는 대표 칸만)
  const upd = (prop, v) => {
    const targets = ['x', 'y', 'w', 'h'].includes(prop) ? [selField()].filter(Boolean) : selFields();
    targets.forEach(f => updateField(f.id, prop, v));
  };
  $('#rbField').addEventListener('change', e => selectField(e.target.value));
  $('#rbFont').addEventListener('change', e => {
    const f = selField();
    if (f) upd('font', e.target.value);
    else if (e.target.value) { state.fields.forEach(x => { x.font = e.target.value; }); renderRibbon(); refresh(); }
  });
  $('#rbSize').addEventListener('input', e => upd('size', e.target.value));
  $$('[data-size]').forEach(b => b.addEventListener('click', () => {
    selFields().forEach(f => updateField(f.id, 'size', Math.max(4, f.size + Number(b.dataset.size))));
  }));
  $('#rbBold').addEventListener('click', () => { const f = selField(); if (f) upd('bold', !f.bold); });
  $('#rbColor').addEventListener('input', e => upd('color', e.target.value));
  $('#rbAlign').addEventListener('click', e => { const b = e.target.closest('[data-align]'); if (b) upd('align', b.dataset.align); });
  $('#rbValign').addEventListener('click', e => { const b = e.target.closest('[data-valign]'); if (b) upd('valign', b.dataset.valign); });
  $('#rbLH').addEventListener('input', e => upd('lineHeight', e.target.value));
  $('#rbMax').addEventListener('input', e => upd('maxLines', e.target.value));
  $('#rbMinSize').addEventListener('input', e => upd('minSize', e.target.value));
  $('#rbMinScale').addEventListener('input', e => upd('minScale', e.target.value));
  $('#rbMinSpacing').addEventListener('input', e => upd('minSpacing', e.target.value));
  for (const k of ['x', 'y', 'w', 'h']) $(`#rb${k.toUpperCase()}`).addEventListener('input', e => upd(k, e.target.value));
  $('#rbText').addEventListener('click', () => { const f = selField(); if (f) openEditor(f.id, 'template'); });
  $('#rbAutoField').addEventListener('click', () => { selFields().forEach(f => { f.manual = false; }); renderRibbon(); refresh(); });
  $('#rbAutoAll').addEventListener('click', () => {
    state.fields.forEach(f => { f.manual = false; });
    state.stamp.manual = false;
    renderRibbon(); refresh();
  });
  $('#ribbon').addEventListener('click', e => {
    const pb = e.target.closest('[data-pop]');
    if (pb) { togglePop(pb.dataset.pop); return; }
    const pl = e.target.closest('[data-place]');
    if (pl) placeSelected(pl.dataset.place);
  });
  document.addEventListener('pointerdown', e => {
    if (openPop && !e.target.closest('.pop') && !e.target.closest('[data-pop]')) closePops();
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
    $(`#${id}`).addEventListener('input', e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { state.stamp[prop] = v; if (prop === 'size') state.stamp.manual = true; refresh(); } });
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
  $('#zoomIn').addEventListener('click', () => zoomBy(1.2));
  $('#zoomOut').addEventListener('click', () => zoomBy(1 / 1.2));
  $('#zoomFit').addEventListener('click', () => { state.zoom = 'fit'; applyZoom(); save(); });
  $('#zoomVal').addEventListener('click', () => { state.zoom = 1; applyZoom(); save(); });
  // Ctrl(⌘)+휠, 트랙패드 핀치: 마우스 자리를 기준으로 확대·축소
  $('#canvas').addEventListener('wheel', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const k = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0022));
    zoomBy(k, e.clientX, e.clientY);
  }, { passive: false });
  window.addEventListener('resize', applyZoom);
  document.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    // 글을 쓰는 칸 안에서는 브라우저 자체 되돌리기를 쓴다
    const typing = e.target.closest('input[type="text"], input:not([type]), textarea, [contenteditable]');
    if (mod && !typing && !e.altKey && (key === 'z' || key === 'y')) {
      e.preventDefault();
      if (key === 'y' || (key === 'z' && e.shiftKey)) redo(); else undo();
      return;
    }
    if (e.target.closest('input, textarea, select')) return;
    // 3단계에서 고른 상자는 방향키로 0.5mm(Shift: 5mm)씩 옮긴다
    if (state.step === 3 && selIds().length && e.key.startsWith('Arrow')) {
      const st = e.shiftKey ? 5 : 0.5;
      for (const f of selFields()) {
        f.manual = true;
        if (e.key === 'ArrowLeft') f.x -= st; if (e.key === 'ArrowRight') f.x += st;
        if (e.key === 'ArrowUp') f.y -= st; if (e.key === 'ArrowDown') f.y += st;
        f.x = Math.round(f.x * 100) / 100; f.y = Math.round(f.y * 100) / 100;
      }
      e.preventDefault(); renderRibbon(); refresh(); return;
    }
    if (state.step === 3 && mod && key === 'a') { e.preventDefault(); setSelection(state.fields.map(f => f.id), state.selected); return; }
    if (e.key === 'Escape') { if (openPop) { closePops(); return; } if (selIds().length) { selectField(null); return; } }
    if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomBy(1.2); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); zoomBy(1 / 1.2); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); state.zoom = 'fit'; applyZoom(); return; }
    if (e.key === 'ArrowRight' || e.key === 'PageDown') go(1);
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1);
  });
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
$('#bgInPdf').checked = state.bgInPdf;
$$('#rangeSeg button').forEach(x => x.classList.toggle('on', x.dataset.range === state.range));
resetHistory();
setStep(1);
refresh();
