// 쎈스 어워드 — 화면과 상태
import { FONTS, FontStore, DEFAULT_FONT, FALLBACK_FONT, fontInfo, variantKey } from './fonts.js';
import { PAPER, FIELD_BASE, SAMPLE, FIELD_DEFS, defaultFields, BORDER_DEFAULT, BORDER_LIMITS, ORNAMENT_TYPES, normBorder, borderSvg, borderShapes, contentRect } from './papers.js';
import { applyAutoLayout, layoutForRecord } from './autolayout.js';
import { tableFromPaste, usedKeys, fillTemplate, BUILTIN_VARS } from './data.js';
import { computeRecord, fontKeysFor, textLayerSvg } from './render.js';
import { buildPdf, buildTestPage } from './export-pdf.js';
import { subsetFont } from './subset.js';
import { Sheet } from './sheet.js';
import { TEMPLATES, tpl, fieldsFor, placeCustomFields } from './templates.js';
import { PAPER_PRESETS, BG_FITS, loadBackground, paperForBg, bgBox, resolvePaper, pdfBytes, bgPng } from './background.js';
import { loadDocument, inspectDocument, previewParagraphs, mergeDocument } from './docmerge.js';
import { MARK_SHAPES, newMark, markSvg, markPath, clampMark, bakeMark } from './marks.js';
import { removeBackground, hasTransparency } from './bgremove.js';

const hbWasm = () => fetch('vendor/harfbuzz-subset.wasm').then(r => { if (!r.ok) throw new Error('subset wasm'); return r.arrayBuffer(); });
const subsetFn = (bytes, cps) => subsetFont(hbWasm, bytes, cps);
import { buildHwpx, TEMPLATE_FILES } from './export-hwpx.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clone = o => JSON.parse(JSON.stringify(o));
const STORE_KEY = 'sense-award:state:v3'; // 프로젝트 기능 전의 저장 자리(한 번 옮겨 담는다)
const INDEX_KEY = 'sense-award:projects';
const PKEY = id => `sense-award:project:${id}`;
const LAYOUT_VERSION = 7;

// ---------- 상태 ----------
function freshState(templateId = 'kr') {
  const T = tpl(templateId);
  return {
    step: 1,
    template: T.id,
    border: { ...T.border },
    fields: fieldsFor(T.id),
    columns: [...T.sample.columns],
    rows: clone(T.sample.rows),
    marks: T.marks(T.border),
    // 그림·PDF 메일머지: 용지 크기와 배경 / 문서 메일머지: 올린 문서
    paper: T.id === 'custom' ? { key: 'A4P', w: 210, h: 297 } : null,
    bg: null, bgFit: 'contain',
    docFile: null, docMode: 'combined', docNameTpl: '{{이름}}',
    current: 0,
    overrides: [],
    offset: { x: 0, y: 0 },
    measured: 100,
    // 한국 상장은 도장 틀을 미리 넣어 둔다(수여자 끝 글자에 걸치는 자리, 눌러서 도장 그림 넣기)
    stamp: { enabled: !!T.stamp, src: null, png: null, imgW: 0, imgH: 0, white: true, bgStrength: 50, red: false, size: 20, dx: 0, dy: 0, manual: false, anchor: 'word-half' },
    showBg: true, showBoxes: true, zoom: 'fit', range: 'all', rangeText: '', bgInPdf: T.bgInPdf, colWidths: {},
    dataMode: 'paste', selected: null, sel: [], snap: true,
    layoutVersion: LAYOUT_VERSION,
  };
}

let state = freshState();
let projectId = null; // null이면 처음 화면(프로젝트 목록)

// 저장된 상태를 지금 판에 맞게 살린다
function hydrate(raw) {
  try {
    if (!raw) return null;
    const s = JSON.parse(raw);
    // 남은 작업 내용은 살리되, 화면은 늘 첫 단계(용지)에서 시작한다
    const st = { ...freshState(s.template || 'kr'), ...s, step: 1, current: 0, selected: null, sel: [], zoom: 'fit', dataMode: 'paste' };
    st.template = TEMPLATES[st.template] ? st.template : 'kr';
    if (st.template === 'custom' && !st.paper) st.paper = { key: 'A4P', w: 210, h: 297 };
    st.marks = Array.isArray(st.marks) ? st.marks : [];
    // 도장 자리 규칙이 '끝 글자 오른쪽'에서 '마지막 어절 절반'으로 바뀜 → 예전 기본 위치값은 0으로
    if (st.stamp && st.stamp.anchor !== 'word-half') {
      if (st.stamp.dx === -5 && !st.stamp.dy) st.stamp.dx = 0;
      st.stamp.anchor = 'word-half';
    }
    st.border = normBorder(st.border);
    // 배치 규칙이 바뀌었으면(참고 상장 비율 적용) 칸 기본 서식을 맞추고 자동 배치로 되돌린다
    if ((st.layoutVersion || 1) < LAYOUT_VERSION) {
      const defs = Object.fromEntries(tpl(st.template).defs.map(d => [d.id, d]));
      st.fields = st.fields.map(f => {
        const d = defs[f.id] || {};
        return { ...f, manual: false, align: d.align ?? f.align, valign: d.valign ?? 'middle', spacing: d.spacing ?? 0, lineHeight: d.lineHeight ?? f.lineHeight, maxLines: d.maxLines ?? f.maxLines, rule: d.rule, ruleColor: d.ruleColor };
      });
      st.stamp = { ...st.stamp, manual: false };
      st.layoutVersion = LAYOUT_VERSION;
    }
    return st;
  } catch { return null; }
}
// ---------- 프로젝트(이 기기 저장) ----------
function readIndex() { try { return JSON.parse(localStorage.getItem(INDEX_KEY)) || []; } catch { return []; } }
function writeIndex(list) { try { localStorage.setItem(INDEX_KEY, JSON.stringify(list)); } catch {} }
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
// 화면만 바뀌는 값은 빼고 내용만 비교한다(열어 보기만 해서는 수정 시각이 바뀌지 않게)
const contentKey = st => JSON.stringify({ ...st, step: 0, current: 0, selected: null, sel: [], zoom: 0, dataMode: '' });
let savedKey = '';

function projectMeta(st) {
  const row = st.rows[0] || [];
  const txt = id => { const f = st.fields.find(x => x.id === id); return f ? fillTemplate(f.text, st.columns, row, 0).text.replace(/\s+/g, ' ').trim() : ''; };
  return { count: st.rows.length, title: txt('title'), nameText: txt('name'), border: st.border, template: st.template || 'kr' };
}

function persist() {
  clearTimeout(saveTimer);
  if (!projectId) return;
  const key = contentKey(state);
  if (key === savedKey) return;
  try { localStorage.setItem(PKEY(projectId), JSON.stringify(state)); }
  catch {
    // 이미지가 커서 못 담으면 이미지만 빼고 저장
    try { localStorage.setItem(PKEY(projectId), JSON.stringify({ ...state, stamp: { ...state.stamp, src: null, png: null, enabled: false } })); } catch {
      try { localStorage.setItem(PKEY(projectId), JSON.stringify({ ...state, stamp: { ...state.stamp, src: null, png: null, enabled: false }, marks: state.marks.map(m => ({ ...m, src: null, orig: null })), bg: state.bg ? { ...state.bg, pdf: null } : null })); } catch {}
    }
    setStatus('저장 공간이 모자라 그림 일부를 빼고 저장했어요. 쓰지 않는 프로젝트를 지워 주세요.', 'warn');
  }
  savedKey = key;
  const list = readIndex();
  const p = list.find(x => x.id === projectId);
  if (p) { Object.assign(p, projectMeta(state), { updated: Date.now() }); writeIndex(list); }
}

let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 300);
  scheduleCommit();
}

// 프로젝트 기능 전에 쓰던 작업을 첫 프로젝트로 옮긴다
function migrateOld() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    if (!readIndex().length) {
      const id = newId(), st = hydrate(raw) || freshState();
      localStorage.setItem(PKEY(id), raw);
      writeIndex([{ id, name: '이전 작업', created: Date.now(), updated: Date.now(), ...projectMeta(st) }]);
    }
    localStorage.removeItem(STORE_KEY);
  } catch {}
}

function uniqueName(base) {
  const names = new Set(readIndex().map(p => p.name));
  if (!names.has(base)) return base;
  let k = 2;
  while (names.has(`${base} ${k}`)) k++;
  return `${base} ${k}`;
}

function openProject(id) {
  persist();
  const st = hydrate(localStorage.getItem(PKEY(id)));
  if (!st) { setStatus('프로젝트를 열지 못했어요'); return; }
  state = st;
  projectId = id;
  savedKey = contentKey(state);
  sheet = null;
  applyViewToggles();
  resetHistory();
  renderProjLabel();
  setStep(1);
}

function newProject(templateId = 'kr') {
  persist();
  const id = newId();
  const st = freshState(templateId);
  const list = readIndex();
  list.push({ id, name: uniqueName(templateId === 'us' ? '새 증서' : '새 프로젝트'), created: Date.now(), updated: Date.now(), ...projectMeta(st) });
  writeIndex(list);
  try { localStorage.setItem(PKEY(id), JSON.stringify(st)); } catch {}
  openProject(id);
}

function duplicateProject(id) {
  persist();
  const list = readIndex();
  const i = list.findIndex(p => p.id === id);
  const raw = localStorage.getItem(PKEY(id));
  if (i < 0 || !raw) return;
  const nid = newId();
  try { localStorage.setItem(PKEY(nid), raw); }
  catch { alert('저장 공간이 모자라 복제하지 못했어요. 쓰지 않는 프로젝트를 지워 주세요.'); return; }
  list.splice(i + 1, 0, { ...list[i], id: nid, name: uniqueName(`${list[i].name} 복사본`), created: Date.now(), updated: Date.now() });
  writeIndex(list);
  renderHome();
}

function deleteProject(id) {
  const list = readIndex();
  const p = list.find(x => x.id === id);
  if (!p || !confirm(`'${p.name}' 프로젝트를 지울까요? 되돌릴 수 없어요.`)) return;
  writeIndex(list.filter(x => x.id !== id));
  try { localStorage.removeItem(PKEY(id)); } catch {}
  if (projectId === id) { projectId = null; state = freshState(); savedKey = ''; }
  renderHome();
}

function renameProject(id, name) {
  name = String(name || '').trim();
  const list = readIndex();
  const p = list.find(x => x.id === id);
  if (!p) return;
  if (name) p.name = name;
  writeIndex(list);
  renderProjLabel();
}

function goHome() {
  persist();
  closeEditor();
  projectId = null;
  renderProjLabel();
  setStep(0);
}

function renderProjLabel() {
  const p = projectId && readIndex().find(x => x.id === projectId);
  $('#projLabel').textContent = p ? p.name : '';
  $('#projLabel').title = p ? `지금 프로젝트: ${p.name} — 누르면 프로젝트 목록` : '';
}

const fmtTime = t => { const d = new Date(t); const z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}. ${z(d.getHours())}:${z(d.getMinutes())}`; };

function renderHome() {
  const list = readIndex().sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const cards = list.map(p => {
    const thumb = svgDataUrl(borderSvg(normBorder(p.border || BORDER_DEFAULT)));
    const T = tpl(p.template);
    return `<article class="proj-card" data-id="${esc(p.id)}">
      <button class="proj-thumb tpl-${T.id}" data-act="open" title="열기" style="background-image:url(&quot;${thumb}&quot;)">
        <span class="t">${esc(p.title || '')}</span><span class="n">${esc(p.nameText || '')}</span>
      </button>
      <input class="proj-name" value="${esc(p.name)}" aria-label="프로젝트 이름" title="눌러서 이름 바꾸기">
      <div class="proj-meta">${esc(T.name)} · 명단 ${p.count ?? 0}명 · ${fmtTime(p.updated || p.created || Date.now())}</div>
      <div class="proj-acts">
        <button class="small primary" data-act="open">열기</button>
        <button class="small" data-act="dup">복제</button>
        <button class="small danger" data-act="del">삭제</button>
      </div>
    </article>`;
  }).join('');
  // 새로 만들기: 양식마다 카드 하나(견본 명단·용지·마크 프레임까지 들어간 상태로 시작)
  const CUSTOM_THUMB = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 297"><rect width="210" height="297" fill="#f3f0ff"/><rect x="18" y="18" width="174" height="261" rx="10" fill="#fff" stroke="#c9bdf8" stroke-width="2"/><circle cx="72" cy="88" r="20" fill="#ffd86b"/><path d="M30 190 L82 130 L118 170 L142 145 L180 190 Z" fill="#b9a7f5"/><rect x="45" y="212" width="120" height="16" rx="4" fill="none" stroke="#7c5cf0" stroke-width="2" stroke-dasharray="6 5"/><text x="105" y="224.5" font-size="11" text-anchor="middle" fill="#7c5cf0" font-family="sans-serif">{{이름}}</text></svg>`;
  const DOC_THUMB = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 297"><rect width="210" height="297" fill="#eef5ff"/><rect x="28" y="22" width="154" height="253" rx="6" fill="#fff" stroke="#b9cff3" stroke-width="2"/>${[60, 76, 92, 140, 156, 172, 188].map((y, i) => `<rect x="48" y="${y}" width="${i % 3 === 2 ? 70 : 114}" height="6" rx="3" fill="#d7e2f5"/>`).join('')}<rect x="48" y="108" width="62" height="14" rx="4" fill="none" stroke="#2f7fe0" stroke-width="2" stroke-dasharray="5 4"/><text x="79" y="119" font-size="10" text-anchor="middle" fill="#2f7fe0" font-family="sans-serif">{{이름}}</text><text x="105" y="250" font-size="16" text-anchor="middle" fill="#2f7fe0" font-family="sans-serif" font-weight="700">HWPX · DOCX</text></svg>`;
  const news = Object.values(TEMPLATES).map(T => {
    const thumb = T.id === 'custom' ? svgDataUrl(CUSTOM_THUMB) : T.id === 'doc' ? svgDataUrl(DOC_THUMB) : svgDataUrl(borderSvg(normBorder(T.border)));
    const row = T.sample.rows[0] || [];
    const val = col => row[T.sample.columns.indexOf(col)] || '';
    const title = T.id === 'us' ? val('증서명') : T.free ? '' : val('상장명');
    return `<button class="proj-new tpl-card" data-new="${T.id}"${T.id === 'kr' ? ' id="homeNew"' : ''}>
      <span class="proj-thumb tpl-${T.id}" style="background-image:url(&quot;${thumb}&quot;)"><span class="t">${esc(title)}</span><span class="n">${T.free ? '' : esc(val('이름'))}</span><span class="plus">+</span></span>
      <b>새 ${esc(T.name)}</b><span class="hint">${esc(T.desc)}</span></button>`;
  }).join('');
  $('#projGrid').innerHTML = news + cards;
  $('#projEmpty').hidden = list.length > 0;
}

const paperSize = () => (state.template === 'custom' && state.paper ? state.paper : PAPER);
// 글 영역: 상장은 테두리 안쪽, 그림 배경은 가장자리 6% 안쪽
function areaRect() {
  if (state.template === 'custom') { const { w, h } = paperSize(); return { x: w * 0.06, y: h * 0.06, w: w * 0.88, h: h * 0.88 }; }
  return contentRect(state.border, paperSize());
}
const isDoc = () => state.template === 'doc';
const isCustom = () => state.template === 'custom';
const tplBorder = () => tpl(state.template).border;
const docView = () => {
  const d = { template: state.template, fields: state.fields, columns: state.columns, rows: state.rows, stamp: state.stamp, overrides: state.overrides };
  // 장마다 그 장의 글 길이로 자동 배치(짧은 본문은 커지고 긴 본문은 작아짐)
  d.layoutFor = i => layoutForRecord(d, store, state.border, i);
  return d;
};
const bgHref = () => svgDataUrl(borderSvg(state.border));
// 미리보기 바탕: 상장은 테두리, 그림 메일머지는 올린 배경(없으면 안내)
function paperBgSvg() {
  const { w, h } = paperSize();
  if (isCustom()) {
    if (!state.bg) return `<g class="bg-empty"><rect x="0" y="0" width="${w}" height="${h}" fill="#f6f6fa"/><text x="${w / 2}" y="${h / 2 - 3}" text-anchor="middle" font-size="${Math.max(4, w / 32)}">1단계에서 배경 그림이나 PDF를 올려 주세요</text><text x="${w / 2}" y="${h / 2 + 5}" text-anchor="middle" font-size="${Math.max(3, w / 48)}">글 상자만으로도 내보낼 수 있어요</text></g>`;
    const b = bgBox(state.bg, paperSize(), state.bgFit);
    return `<image href="${state.bg.src}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" preserveAspectRatio="none"/>`;
  }
  return `<image href="${bgHref()}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none"/>`;
}

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
const HIST_KEYS = ['fields', 'columns', 'rows', 'overrides', 'border', 'stamp', 'offset', 'measured', 'marks', 'paper', 'bgFit'];
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
    o[k] = k === 'stamp' ? { ...state.stamp, src: undefined, png: undefined, _img: stampImages(state.stamp) }
      : k === 'marks' ? state.marks.map(m => ({ ...m, src: undefined, orig: undefined, _img: imgRef(m.src), _orig: imgRef(m.orig) }))
      : clone(state[k]);
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
// 마크 그림도 기록에서는 참조만
function imgRef(src) {
  if (!src) return null;
  const key = `m:${src.length}:${src.slice(-48)}`;
  stampImgs.set(key, { src });
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
    } else if (k === 'marks') {
      state.marks = (snap.marks || []).map(m => {
        const im = m._img ? stampImgs.get(m._img) : null, og = m._orig ? stampImgs.get(m._orig) : null;
        return { ...clone({ ...m, _img: undefined, _orig: undefined }), src: im ? im.src : null, orig: og ? og.src : null };
      });
      if (markSel && !state.marks.some(m => m.id === markSel)) { markSel = null; cropId = null; }
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
  persist();
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
  const stage = $('#stage'), dstage = $('#docStage');
  // 문서 메일머지는 상장 화면 대신 글 미리보기
  const view = isDoc() ? dstage : stage;
  const other = isDoc() ? stage : dstage;
  other.hidden = true;
  if (slot) { slot.appendChild(view); view.hidden = false; } else view.hidden = true;
  applyTemplateUI();
  document.body.dataset.step = n;
  $('#boxToggle').hidden = n === 4;
  $('#snapToggle').hidden = n !== 3;
  if (n === 1) renderBorderPage(true);
  if (n === 2) renderData();
  if (n === 3) renderRibbon();
  if (n === 4) { renderSummary(); renderOffset(); }
  if (n === 0) renderHome();
  $$('.page-scroll, .inspector').forEach(el => { el.scrollTop = 0; });
  refresh();
  requestAnimationFrame(applyZoom);
}

// ---------- 1. 용지 ----------
function svgDataUrl(svg) { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); }

// 1단계: 시판 용지 테두리 설정. 미리보기에는 지금 명단 첫 장을 자동 배치로 함께 보여 준다.
const BORDER_KEYS = ['inset', 'thick', 'gap', 'thin', 'notch', 'ornament', 'pad'];
const ALL_BORDER_KEYS = [...BORDER_KEYS, 'color', 'ornOn', 'ornType'];

function renderBorderPage(syncInputs) {
  const B = normBorder(state.border);
  if (syncInputs) {
    for (const k of BORDER_KEYS) {
      const [lo, hi, step] = BORDER_LIMITS[k];
      $$(`[data-b="${k}"]`).forEach(el => { el.min = lo; el.max = hi; el.step = step; if (el !== document.activeElement) el.value = B[k]; });
    }
    $('#b-color').value = B.color;
  }
  $('#b-ornOn').checked = B.ornOn;
  $('#ornOnLabel').textContent = B.ornOn ? '켜짐' : '꺼짐';
  $('#ornBody').hidden = !B.ornOn;
  $('#ornTypes').innerHTML = ORNAMENT_TYPES.map(t => `<button data-orn="${t.id}" class="${B.ornType === t.id ? 'on' : ''}">${t.name}</button>`).join('');
  if (!isCustom() && !isDoc()) $('#paperLead').textContent = state.template === 'us'
    ? '미국식 증서 양식이에요(A4 세로). 가는 금색 이중 테두리는 빈 종이에 함께 인쇄하도록 켜 두었어요(4단계 "테두리도 함께 인쇄"에서 끌 수 있어요). 아래 수치로 테두리를 조정하세요.'
    : '이 용지는 시판되는 보통 상장 용지 규격(A4, 210×297mm)을 따릅니다. 금색 테두리는 화면에서만 보이는 안내선이라 인쇄에는 들어가지 않아요.';
  const isChanged = k => B[k] !== tplBorder()[k];
  const changed = ALL_BORDER_KEYS.filter(isChanged).length;
  $('#borderNote').textContent = changed ? `견본에서 ${changed}가지를 바꿨어요` : '견본 디자인 그대로예요';
  $('#borderReset').disabled = !changed;
  $$('.bctl[data-bkey]').forEach(el => {
    const ch = isChanged(el.dataset.bkey);
    el.classList.toggle('changed', ch);
    const rb = $('.reset-one', el);
    if (rb) rb.hidden = !ch;
  });
  drawBorderView();
}

async function drawBorderView() {
  if (isDoc()) { drawDocView(); return; }
  if (isCustom()) { drawCustomView(); return; }
  const { w, h } = paperSize();
  const B = normBorder(state.border);
  let text = '';
  try {
    await ensureFonts();
    applyAutoLayout(docView(), store, state.border, undefined, Math.min(state.current, Math.max(0, state.rows.length - 1)));
    const rec = computeRecord(docView(), Math.min(state.current, Math.max(0, state.rows.length - 1)), store);
    // 마크·도장 틀도 같이 보여 준다(빈 틀은 점선)
    let mk = state.marks.map(m => markSvg(m, { placeholder: true })).join('');
    if (rec.stamp && state.stamp.png) mk += `<image href="${state.stamp.png}" x="${rec.stamp.x}" y="${rec.stamp.y}" width="${rec.stamp.w}" height="${rec.stamp.h}" preserveAspectRatio="none"/>`;
    else if (state.stamp.enabled && rec.stamp) mk += markSvg({ id: 'stamp-ph', name: '도장', shape: 'square', ...rec.stamp }, { placeholder: true });
    text = `<g opacity=".88">${mk}${textLayerSvg(rec)}</g>`;
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

// 글 영역이 바뀌면, 자동 배치가 아닌(직접 옮긴) 상자도 같은 비율로 따라 옮긴다
function remapManualBoxes(oldC, newC) {
  if (oldC.x === newC.x && oldC.y === newC.y && oldC.w === newC.w && oldC.h === newC.h) return;
  const sx = newC.w / oldC.w, sy = newC.h / oldC.h;
  const rd = v => Math.round(v * 100) / 100;
  for (const f of state.fields) {
    if (!f.manual) continue;
    f.x = rd(newC.x + (f.x - oldC.x) * sx);
    f.y = rd(newC.y + (f.y - oldC.y) * sy);
    f.w = rd(Math.max(5, f.w * sx));
    f.h = rd(Math.max(3, f.h * sy));
  }
}

function setBorder(key, value) {
  const v = (key === 'color' || key === 'ornType') ? value : key === 'ornOn' ? !!value : parseFloat(value);
  if (typeof v === 'number' && !Number.isFinite(v)) return;
  const oldC = areaRect();
  state.border = normBorder({ ...state.border, [key]: v });
  remapManualBoxes(oldC, areaRect());
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
  // 표가 보이면 첫 칸을 골라 두어 바로 Ctrl+V 할 수 있게
  if (state.dataMode === 'paste' && state.step === 2) requestAnimationFrame(() => { const sh = getSheet(); sh.paintSel(false); sh.focus(); });
}

// 엑셀처럼 쓰는 명단 표
let sheet = null;
function renderTemplatesForRename(oldName, newName) {
  const re = new RegExp(`\\{\\{\\s*${oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(:\\s*\\d+)?\\s*\\}\\}`, 'g');
  state.fields.forEach(f => { f.text = f.text.replace(re, (m, pad) => `{{${newName}${pad ? pad.replace(/\s/g, '') : ''}}}`); });
}
function getSheet() {
  if (sheet) return sheet;
  sheet = new Sheet($('#sheetBox'), {
    model: () => state,
    widths: () => (state.colWidths || (state.colWidths = {})),
    rowsInserted(at, n) { syncOverrides(); state.overrides.splice(at, 0, ...Array.from({ length: n }, () => ({}))); state.overrides.length = state.rows.length; },
    rowsDeleted(at, n) { syncOverrides(); state.overrides.splice(at, n); },
    renamed(oldName, newName) {
      renderTemplatesForRename(oldName, newName);
      if (state.colWidths && state.colWidths[oldName]) { state.colWidths[newName] = state.colWidths[oldName]; delete state.colWidths[oldName]; }
    },
    replacedAll() { state.overrides = []; state.current = 0; syncOverrides(); },
    changed(kind) {
      if (kind === 'widths') { save(); return; }
      syncOverrides();
      if (state.current >= state.rows.length) state.current = Math.max(0, state.rows.length - 1);
      $('#rowCount').textContent = `${state.rows.length}명`;
      renderKeyChips();
      renderRibbon();
      refresh();
    },
    activeRow(r) { if (r !== state.current) { state.current = r; refresh(); } },
    undo, redo,
    status: msg => setStatus(msg),
  });
  return sheet;
}

function renderGrid() {
  getSheet().render();
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
  const allSame = state.fields.length && state.fields.every(x => x.font === state.fields[0].font);
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
  if (name === 'mark') renderMarkPop();
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
  $('#stampBgRow').hidden = !s.white || !s.src;
  $('#stampBgStr').value = s.bgStrength ?? 50;
  $('#stampBgStrV').textContent = s.bgStrength ?? 50;
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
  const red = s.red ? [200, 28, 36] : null;
  let out;
  if (s.white && !(await hasTransparency(s.src))) {
    // JPG·사진: 종이 얼룩까지 펴서 배경을 지우고 잉크만 남긴다
    out = await removeBackground(s.src, { strength: s.bgStrength ?? 50, recolor: red, maxSide: 800 });
  } else {
    // 이미 투명한 PNG거나 지우기를 끈 경우: 그대로(붉은색 맞추기만)
    out = await removeBackground(s.src, { strength: 0, recolor: red, maxSide: 800, keepAll: true });
  }
  s.png = out.png;
  s.imgW = out.w; s.imgH = out.h;
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
  if (isDoc()) { renderDocPreview(); return; }
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
  if (state.showBg) bg = paperBgSvg();
  let stamp = '';
  if (rec.stamp && state.stamp.png) {
    const s = rec.stamp;
    stamp = `<image href="${state.stamp.png}" x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" preserveAspectRatio="none"/>`;
  }
  // 마크 프레임: 그림이 있으면 틀 모양으로 잘라 보여 주고, 빈 틀은 편집할 때만 점선으로
  // 빈 틀(마크·도장)은 화면에서만 점선으로 늘 보인다(인쇄·PDF·한글에는 안 들어감)
  const showPh = true;
  let marks = `<g class="mark-layer">${state.marks.map(m => markSvg(m, { placeholder: showPh, crop: state.step === 3 && cropId === m.id })).join('')}`;
  const stampPh = state.stamp.enabled && rec.stamp && !state.stamp.png ? rec.stamp : null;
  if (stampPh) marks += markSvg({ id: 'stamp-ph', name: '도장', shape: 'square', x: stampPh.x, y: stampPh.y, w: stampPh.w, h: stampPh.h }, { placeholder: true });
  marks += '</g>';
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
    // 마크 프레임: 끌어 옮기기, 모서리로 크기, 두 번 누르면 틀 안 그림 자르기(이동·휠 확대)
    if (state.step === 3) {
      for (const m of state.marks) {
        const sel = markSel === m.id, crop = cropId === m.id;
        const shape = (MARK_SHAPES.find(x => x.id === m.shape) || MARK_SHAPES[0]).name;
        boxes += `<g class="box mark-box drag ${sel ? 'sel' : ''} ${crop ? 'crop' : ''}" data-box="__mark:${m.id}">
          <rect class="area" x="${m.x}" y="${m.y}" width="${m.w}" height="${m.h}"/>
          ${sel ? `<path class="mark-outline" d="${markPath(m)}"/>` : ''}
          <text class="tag" x="${m.x + 0.6}" y="${m.y - 0.9}">${esc(m.name || '마크')} · ${shape}${crop ? ' · 자르기: 끌어 옮기고 휠로 확대' : m.src ? '' : ' · 눌러서 그림 넣기'}</text>
          ${crop ? '' : `<rect class="handle" data-handle="__mark:${m.id}" x="${m.x + m.w - 2.2}" y="${m.y + m.h - 2.2}" width="4.4" height="4.4" rx="0.8"/>`}
        </g>`;
      }
    }
    // 빈 도장 틀: 누르면 도장 그림 고르기
    if (state.step === 3 && stampPh) {
      boxes += `<g class="box mark-box drag" data-box="__stampPh"><rect class="area" x="${stampPh.x}" y="${stampPh.y}" width="${stampPh.w}" height="${stampPh.h}"/><text class="tag" x="${stampPh.x + 0.6}" y="${stampPh.y - 0.9}">도장 · 눌러서 도장 그림 넣기</text></g>`;
    }
    // 도장: 3단계에서 끌어 옮기고 모서리로 크기 조절(수여자 끝 글자 기준 상대 위치로 기억)
    if (state.step === 3 && rec.stamp && state.stamp.png) {
      const s = rec.stamp;
      boxes += `<g class="box stamp-box drag ${stampSelected ? 'sel' : ''}" data-box="__stamp">
        <rect class="area" x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="1"/>
        <text class="tag" x="${s.x + 0.6}" y="${s.y - 0.9}">도장</text>
        <rect class="handle" data-handle="__stamp" x="${s.x + s.w - 2.2}" y="${s.y + s.h - 2.2}" width="4.4" height="4.4" rx="0.8"/>
      </g>`;
    }
  }
  $('#sheet').innerHTML = `<svg id="page" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="aspect-ratio:${w}/${h}">
    <rect width="${w}" height="${h}" fill="#fff"/>${bg}${marks}${stamp}<g class="text-layer">${textLayerSvg(rec)}</g><g class="box-layer">${boxes}</g><g class="guide-layer">${guideSvg()}${marqueeSvg()}</g></svg>`;
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

function contentArea() { return areaRect(); }

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
let stampSelected = false;
let markSel = null;   // 고른 마크 프레임 id
let cropId = null;    // 틀 안 그림을 고르는(자르기) 중인 마크 id
let markUploadId = null;
const markById = id => state.marks.find(m => m.id === id);
function selectMark(id) {
  markSel = id;
  if (cropId && cropId !== id) cropId = null;
  if (id) {
    stampSelected = false;
    if (selIds().length) { state.sel = []; state.selected = null; }
    renderRibbon();
    if (openPop !== 'mark') togglePop('mark');
  }
  renderMarkPop();
}
function renderMarkPop() {
  if (!$('#pop-mark')) return;
  const m = markSel ? markById(markSel) : null;
  $('#markBody').hidden = !m;
  $('#markEmpty').hidden = !!m;
  if (!m) return;
  if ($('#markName') !== document.activeElement) $('#markName').value = m.name || '';
  $('#markShape').innerHTML = MARK_SHAPES.map(x => `<button data-shape="${x.id}" class="${m.shape === x.id ? 'on' : ''}">${x.name}</button>`).join('');
  $('#markPick').textContent = m.src ? '그림 바꾸기' : '그림 넣기';
  for (const id of ['markCrop', 'markFit', 'markClearImg', 'markZoom']) $(`#${id}`).disabled = !m.src;
  $('#markCrop').classList.toggle('on', cropId === m.id);
  $('#markCrop').textContent = cropId === m.id ? '자르기 끝내기' : '틀 안에서 자르기';
  $('#markZoom').value = Math.round((m.zoom || 1) * 100);
  $('#markZoomV').textContent = `${Math.round((m.zoom || 1) * 100)}%`;
  for (const k of ['x', 'y', 'w', 'h']) { const el = $(`#mark${k.toUpperCase()}`); if (el !== document.activeElement) el.value = Math.round(m[k] * 10) / 10; }
  $('#markH').disabled = m.shape === 'circle';
  $('#markBg').disabled = !m.src;
  $('#markBg').checked = !!m.bgOn;
  $('#markBgRow').hidden = !m.bgOn;
  $('#markBgStr').value = m.bgStrength ?? 50;
  $('#markBgStrV').textContent = m.bgStrength ?? 50;
}
function addMark(shape, at) {
  const C = areaRect();
  const size = shape === 'circle' ? 30 : 36;
  const hh = shape === 'circle' ? size : 24;
  const cx = at ? at.x : C.x + C.w / 2, cy = at ? at.y : C.y + C.h / 2;
  const m = clampMark(newMark({ shape, name: `마크 ${state.marks.length + 1}`, x: cx - size / 2, y: cy - hh / 2, w: size, h: hh }));
  state.marks.push(m);
  selectMark(m.id);
  commitNow(); refresh();
}
function removeMark(id) {
  state.marks = state.marks.filter(m => m.id !== id);
  if (markSel === id) markSel = null;
  if (cropId === id) cropId = null;
  renderMarkPop(); commitNow(); refresh();
}
async function setMarkImage(id, file) {
  const m = markById(id);
  if (!m || !file) return;
  const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  const im = await loadImage(url);
  // 투명 배경(PNG 로고·인장)은 PNG로, 사진은 JPEG로 줄여 저장(긴 변 1600px)
  m.src = await downscale(im, 1600);
  const im2 = await loadImage(m.src);
  m.imgW = im2.naturalWidth; m.imgH = im2.naturalHeight;
  m.zoom = 1; m.panX = 0; m.panY = 0;
  m.orig = null; m.bgOn = false;
  clampMark(m);
  selectMark(id);
  commitNow(); refresh();
}
// 마크 그림 배경 지우기(원본은 m.orig에 두고 다시 계산)
async function applyMarkBg(m) {
  if (!m.src && !m.orig) return;
  if (m.bgOn) {
    if (!m.orig) m.orig = m.src;
    const r = await removeBackground(m.orig, { strength: m.bgStrength ?? 50, trim: false, maxSide: 1600 });
    m.src = r.png; m.imgW = r.w; m.imgH = r.h;
  } else if (m.orig) {
    m.src = m.orig; m.orig = null;
  }
  clampMark(m); renderMarkPop(); commitNow(); refresh();
}
function pickMarkImage(id) {
  markUploadId = id;
  const inp = $('#markFile');
  inp.value = '';
  inp.click();
}

function marqueeSvg() {
  if (!drag || drag.mode !== 'marquee' || !drag.moved) return '';
  const r = drag.rect;
  return `<rect class="marquee" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>`;
}

$('#sheet').addEventListener('pointerdown', ev => {
  const svg = $('#page');
  if (!svg) return;
  if (ev.button !== 0) return;   // 오른쪽 버튼은 메뉴만(끌기·파일 고르기 안 함)
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
    stampSelected = false;
    if (markSel || cropId) { markSel = null; cropId = null; renderMarkPop(); }
    drag = { mode: 'marquee', start: p, rect: { x: p.x, y: p.y, w: 0, h: 0 }, base: additive ? [...selIds()] : [], additive, moved: false };
    return;
  }
  const id = box.dataset.box;
  if (id === '__stampPh') { $('#stampFile').value = ''; $('#stampFile').click(); return; }
  if (id.startsWith('__mark:')) {
    const mid = id.slice(7), m = markById(mid);
    if (!m) return;
    selectMark(mid);
    if (ev.target.closest('[data-handle]')) drag = { mode: 'markSize', mid, start: p, orig: { ...m }, moved: false };
    else if (cropId === mid && m.src) drag = { mode: 'markPan', mid, start: p, orig: { panX: m.panX || 0, panY: m.panY || 0 }, moved: false };
    else drag = { mode: 'markMove', mid, start: p, orig: { x: m.x, y: m.y }, moved: false };
    refresh();
    return;
  }
  if (markSel) { markSel = null; cropId = null; renderMarkPop(); }
  if (id === '__stamp') {
    const st = state.stamp;
    stampSelected = true;
    if (selIds().length) { state.sel = []; state.selected = null; renderRibbon(); }
    drag = { mode: ev.target.closest('[data-handle]') ? 'stampSize' : 'stamp', start: p, orig: { dx: st.dx || 0, dy: st.dy || 0, size: st.size }, moved: false };
    refresh();
    return;
  }
  stampSelected = false;
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
  if (drag.mode.startsWith('mark')) {
    const m = markById(drag.mid);
    if (!m) return;
    const r2 = v => Math.round(v * 10) / 10;
    if (ev.shiftKey && drag.mode !== 'markSize') { if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0; }
    if (drag.mode === 'markMove') { m.x = r2(drag.orig.x + dx); m.y = r2(drag.orig.y + dy); }
    else if (drag.mode === 'markPan') { m.panX = drag.orig.panX + dx; m.panY = drag.orig.panY + dy; }
    else {
      // 크기: 원형은 늘 정원, 사각은 자유(Shift를 누르면 비율 유지)
      const o = drag.orig;
      if (m.shape === 'circle' || ev.shiftKey) { const k = Math.max((o.w + dx) / o.w, (o.h + dy) / o.h); m.w = r2(o.w * k); m.h = r2(o.h * k); }
      else { m.w = r2(o.w + dx); m.h = r2(o.h + dy); }
    }
    clampMark(m);
    refresh(); renderMarkPop();
    return;
  }
  if (drag.mode === 'stamp' || drag.mode === 'stampSize') {
    const st = state.stamp;
    const r2 = v => Math.round(v * 2) / 2;
    if (drag.mode === 'stamp') {
      if (ev.shiftKey) { if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0; }
      st.dx = r2(drag.orig.dx + dx);
      st.dy = r2(drag.orig.dy + dy);
    } else {
      // 크기: 오른쪽 아래 모서리를 끈 만큼(가로세로 중 큰 쪽)
      st.size = Math.max(6, Math.min(60, r2(drag.orig.size + Math.max(dx, dy))));
      st.manual = true;
    }
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
  if (d.mode && d.mode.startsWith('mark')) {
    // 빈 틀을 눌렀다 떼면(끌지 않고) 바로 그림 고르기
    if (!d.moved && d.mode === 'markMove') { const m = markById(d.mid); if (m && !m.src) { pickMarkImage(m.id); return; } }
    commitNow(); refresh();
    return;
  }
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
    const def = tpl(state.template).defs.find(d => d.id === fieldId);
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
// 그림 메일머지·추가한 글 상자는 문구의 첫 변수로 이름을 붙인다
function boxLabel(f) {
  const m = String(f.text || '').match(/\{\{\s*([^{}:]+?)\s*(?::\s*\d+)?\s*\}\}/);
  return m ? m[1] : (String(f.text || '').trim().slice(0, 10) || '글 상자');
}
function relabelBoxes() {
  for (const f of state.fields) if (isCustom() || f.added) f.label = boxLabel(f);
}
function closeEditor() {
  if (!editing) return;
  editing = null;
  relabelBoxes();
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
/**
 * 장 범위 해석: "1, 3", "1-2", "3~4", "5-"(5번부터 끝까지), "-3"(처음부터 3번까지)
 * 쉼표·띄어쓰기·세미콜론으로 나눈다. 번호는 1부터, 겹치면 한 번만, 번호 순서대로.
 * 반환: { indices: [0부터], bad: [알아듣지 못한 조각], out: [명단 밖 번호] }
 */
function parseRange(text, n) {
  const set = new Set(), bad = [], out = [];
  for (const raw of String(text || '').split(/[,;\s]+/)) {
    const t = raw.trim();
    if (!t) continue;
    const m = t.match(/^(\d*)\s*[-~–—]\s*(\d*)$/);
    let a, b;
    if (/^\d+$/.test(t)) { a = b = Number(t); }
    else if (m && (m[1] || m[2])) { a = m[1] ? Number(m[1]) : 1; b = m[2] ? Number(m[2]) : n; }
    else { bad.push(t); continue; }
    if (a > b) [a, b] = [b, a];
    if (a < 1 || b > n) out.push(t);
    for (let k = Math.max(1, a); k <= Math.min(n, b); k++) set.add(k - 1);
  }
  return { indices: [...set].sort((x, y) => x - y), bad, out };
}

// 번호 목록을 묶어서 글로(1-3, 5)
function rangeText(indices) {
  const nums = indices.map(i => i + 1), parts = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    parts.push(j > i ? `${nums[i]}-${nums[j]}` : `${nums[i]}`);
    i = j;
  }
  return parts;
}

function allIndices() {
  if (state.range === 'current') return [state.current];
  if (state.range === 'pick') return parseRange(state.rangeText, state.rows.length).indices;
  return state.rows.map((_, i) => i);
}

// 범위 입력 아래 안내: 몇 장이 나가는지, 알아듣지 못한 조각
function renderRangeInfo() {
  if (!$('#rangeRow')) return;
  $('#rangeRow').hidden = state.range !== 'pick';
  if ($('#rangeText') !== document.activeElement) $('#rangeText').value = state.rangeText || '';
  const n = state.rows.length;
  let info = '', bad = false;
  if (state.range === 'all') info = `${n}장 모두`;
  else if (state.range === 'current') info = `${state.current + 1}번 한 장`;
  else {
    const r = parseRange(state.rangeText, n);
    info = r.indices.length ? `${r.indices.length}장: ${rangeText(r.indices).join(', ')}번` : '내보낼 장이 없어요. 번호를 넣어 주세요.';
    if (r.bad.length) { info += ` · 알아듣지 못한 부분: ${r.bad.join(' ')}`; bad = true; }
    if (r.out.length) { info += ` · 명단은 ${n}번까지예요`; bad = true; }
    if (!r.indices.length) bad = true;
  }
  $('#rangeInfo').textContent = info;
  $('#rangeInfo').classList.toggle('warn', bad);
  // 목록에서 내보내지 않는 장은 흐리게
  const set = new Set(allIndices());
  $$('#recList li').forEach((li, i) => li.classList.toggle('out', !set.has(i)));
}

// 내보낼 장이 없으면 멈추고 알려 준다
function checkIndices(indices) {
  if (indices.length) return true;
  progress(0, 1, '내보낼 장이 없어요. "일부만"에 1, 3, 5-7처럼 번호를 넣어 주세요.');
  if ($('#rangeText')) $('#rangeText').focus();
  return false;
}

// 파일 이름 꼬리: 일부면 _1-2_5, 한 장이면 _3
function rangeSuffix(indices) {
  if (state.range === 'all' || indices.length === state.rows.length) return '';
  const t = rangeText(indices).join('_');
  return `_${t.length > 40 ? `${indices.length}장` : t}`;
}

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
  renderRangeInfo();
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
  $('#fontLinks').innerHTML = usedFonts.map(f => {
    // 파일 이름으로 굵기를 알려 준다(Regular·Bold)
    const files = (f.ttf || []).map(p => {
      const name = p.split('/').pop();
      const weight = /Bold/i.test(name) ? '굵게' : '보통';
      return `<a class="ttf-dl" href="${p}" download="${f.ttf.length > 1 ? `${f.name}-${weight}` : f.name}.ttf">TTF 내려받기${f.ttf.length > 1 ? ` (${weight})` : ''}</a>`;
    }).join('');
    return `<li><b>${esc(f.name)}</b> ${files} <a class="src" href="${f.url}" target="_blank" rel="noopener">공식 안내</a><span class="hint">${esc(f.license)}</span></li>`;
  }).join('');
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
      paper: paperSize(), border: state.border, content: areaRect(),
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
    if (!checkIndices(indices)) return;
    progress(0, indices.length, '준비 중…');
    const res = await buildPdf({
      PDFLib: window.PDFLib, fontkit: window.fontkit, doc: docView(), store, indices,
      paper: paperSize(), offset: state.offset, scale: printScale(),
      stampPng: state.stamp.png ? dataUrlBytes(state.stamp.png) : null,
      marks: await bakedMarks(),
      border: state.bgInPdf && !isCustom() ? state.border : null,
      background: await pdfBackground(),
      subset: subsetFn,
      onProgress: async (d, t) => { progress(d, t, d === t ? '파일로 묶는 중…' : ''); await new Promise(r => setTimeout(r)); },
    });
    download(res.bytes, `상장_${stamp8()}${rangeSuffix(indices)}.pdf`, 'application/pdf');
    progress(1, 1, `PDF ${indices.length}장을 만들었어요.`);
  } catch (e) {
    console.error(e);
    progress(0, 1, `PDF를 만들지 못했어요: ${e.message}`);
  } finally { busy = false; }
}

// ---------- 바로 인쇄 ----------
// 미리보기와 같은 글자 윤곽(SVG 경로)을 A4 실제 크기 페이지로 펼쳐 브라우저 인쇄로 보낸다.
// 배율 보정은 용지 가운데 기준, 위치 보정은 그 안에서 옮긴다(PDF와 같은 순서).
function printTransform() {
  const { w, h } = paperSize();
  const k = printScale();
  return `translate(${w / 2} ${h / 2}) scale(${k}) translate(${-w / 2} ${-h / 2}) translate(${state.offset.x || 0} ${state.offset.y || 0})`;
}

function printPageSvg(inner) {
  const { w, h } = paperSize();
  return `<div class="print-page"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}mm" height="${h}mm"><g transform="${printTransform()}">${inner}</g></svg></div>`;
}

async function sendToPrinter(pagesHtml, label) {
  let area = $('#printArea');
  if (!area) { area = document.createElement('div'); area.id = 'printArea'; document.body.appendChild(area); }
  area.innerHTML = pagesHtml;
  // 용지 크기를 인쇄 창에 알려 준다(그림 메일머지는 A4가 아닐 수 있음)
  const { w, h } = paperSize();
  let ps = $('#printPageSize');
  if (!ps) { ps = document.createElement('style'); ps.id = 'printPageSize'; document.head.appendChild(ps); }
  ps.textContent = `@media print { @page { size: ${w}mm ${h}mm; margin: 0; } .print-page, .print-page svg { width: ${w}mm !important; height: ${h}mm !important; } }`;
  // 도장 이미지가 다 그려진 뒤에 인쇄 창을 연다
  await Promise.all([...area.querySelectorAll('image')].map(im => new Promise(res => { const i = new Image(); i.onload = i.onerror = res; i.src = im.getAttribute('href'); })));
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const done = () => { area.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  progress(1, 1, label);
  window.print();
}

// 마크 프레임을 틀 모양 PNG로 굽는다(그림이 든 틀만)
async function bakedMarks() {
  const out = [];
  for (const m of state.marks) {
    if (!m.src) continue;
    try {
      const b = await bakeMark(m);
      if (b) out.push({ x: m.x, y: m.y, w: m.w, h: m.h, png: dataUrlBytes(b.png), url: b.png, pxW: b.pxW, pxH: b.pxH });
    } catch (e) { console.error(e); }
  }
  return out;
}

async function printNow() {
  if (busy || !state.rows.length) return;
  busy = true;
  try {
    await ensureFonts(true);
    applyAutoLayout(docView(), store, state.border, undefined, Math.min(state.current, Math.max(0, state.rows.length - 1)));
    const indices = allIndices();
    if (!checkIndices(indices)) return;
    const { w, h } = paperSize();
    // 테두리: PDF와 같은 단색 경로(그라데이션은 인쇄에서 빠지는 브라우저가 있음)
    const bg = isCustom() ? (state.bgInPdf && state.bg ? (() => { const b = bgBox(state.bg, paperSize(), state.bgFit); return `<image href="${state.bg.src}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" preserveAspectRatio="none"/>`; })() : '') : state.bgInPdf ? borderShapes(normBorder(state.border)).map(sh => sh.fill
      ? `<path d="${sh.d}" fill="${sh.fill}"/>`
      : `<path d="${sh.d}" fill="none" stroke="${sh.stroke}" stroke-width="${sh.width}"${sh.cap ? ' stroke-linecap="round"' : ''}/>`).join('') : '';
    const mk = (await bakedMarks()).map(m => `<image href="${m.url}" x="${m.x}" y="${m.y}" width="${m.w}" height="${m.h}" preserveAspectRatio="none"/>`).join('');
    let html = '';
    for (const i of indices) {
      const rec = computeRecord(docView(), i, store);
      let stamp = '';
      if (rec.stamp && state.stamp.png) {
        const st = rec.stamp;
        stamp = `<image href="${state.stamp.png}" x="${st.x}" y="${st.y}" width="${st.w}" height="${st.h}" preserveAspectRatio="none"/>`;
      }
      html += printPageSvg(bg + mk + stamp + textLayerSvg(rec));
    }
    await sendToPrinter(html, `${indices.length}장을 인쇄 창으로 보냈어요. 배율은 기본값(100%), 여백은 없음으로 인쇄하세요.`);
  } catch (e) {
    console.error(e);
    progress(0, 1, `인쇄하지 못했어요: ${e.message}`);
  } finally { busy = false; }
}

// 시험 인쇄(바로): 100mm 자 가로·세로, 글 영역 모서리 십자, 테두리 윤곽
async function testPrintNow() {
  const { w, h } = paperSize();
  const B = normBorder(state.border), C = contentRect(B);
  const line = (x1, y1, x2, y2, sw = 0.25, c = '#000') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${sw}"/>`;
  const txt = (x, y, t, size = 3.2, anchor = 'start') => `<text x="${x}" y="${y}" font-size="${size}" font-family="sans-serif" text-anchor="${anchor}" fill="#000">${esc(t)}</text>`;
  let g = '';
  // 테두리 윤곽(회색)
  g += borderShapes(B).filter(s => !s.fill).map(s => `<path d="${s.d}" fill="none" stroke="#999" stroke-width="0.2"/>`).join('');
  // 가로 100mm 자
  const x0 = (w - 100) / 2, yR = h * 0.42;
  g += line(x0, yR, x0 + 100, yR, 0.3);
  for (let i = 0; i <= 100; i++) g += line(x0 + i, yR, x0 + i, yR - (i % 10 === 0 ? 4 : i % 5 === 0 ? 2.5 : 1.5), 0.15);
  g += txt(w / 2, yR + 6, '가로 100mm — 자로 재어 "100mm 선 실측"에 넣으세요', 3.4, 'middle');
  // 세로 100mm 자
  const xV = w * 0.3, y0 = h * 0.5;
  g += line(xV, y0, xV, y0 + 100, 0.3);
  for (let i = 0; i <= 100; i++) g += line(xV, y0 + i, xV + (i % 10 === 0 ? 4 : i % 5 === 0 ? 2.5 : 1.5), y0 + i, 0.15);
  g += txt(xV + 6, y0 + 50, '세로 100mm', 3.4);
  // 글 영역 모서리 십자
  for (const [cx, cy] of [[C.x, C.y], [C.x + C.w, C.y], [C.x, C.y + C.h], [C.x + C.w, C.y + C.h]]) g += line(cx - 4, cy, cx + 4, cy, 0.25) + line(cx, cy - 4, cx, cy + 4, 0.25);
  g += txt(w / 2, h * 0.3, '쎈스 어워드 맞춤 확인(바로 인쇄)', 5, 'middle');
  g += txt(w / 2, h * 0.3 + 7, '빈 종이에 인쇄해 상장 용지와 겹쳐 보세요. 십자는 글 영역의 네 모서리예요.', 3.2, 'middle');
  await sendToPrinter(printPageSvg(g), '시험 인쇄를 인쇄 창으로 보냈어요. 배율 기본값(100%), 여백 없음으로 인쇄하세요.');
}


// ---------- 양식별 화면(상장 · 그림 메일머지 · 문서 메일머지) ----------
function applyTemplateUI() {
  const T = tpl(state.template);
  document.body.dataset.tpl = state.template;
  if ($('#s4Title')) {
    $('#s4Title').textContent = isDoc() ? '명단만큼 문서를 만들어요' : '한 장씩 확인하고 내보내요';
    $('#s4Lead').innerHTML = isDoc() ? '한 파일로 합치면 명단 줄마다 쪽이 나뉘어 이어지고, 따로 만들면 한 부씩 ZIP으로 묶여요.'
      : `미리보기에서 글자를 누르면 <b>그 ${isCustom() ? '장' : '상장'}만</b> 내용을 직접 고칠 수 있어요.`;
    $('#listTitle').textContent = isDoc() ? '문서 목록' : isCustom() ? '만들 장 목록' : '상장 목록';
  }
  if ($('#s3Hint')) $('#s3Hint').textContent = isDoc() ? '화살표로 한 부씩 넘겨 보며 명단이 문서에 어떻게 들어가는지 확인하세요 · 고칠 곳은 명단에서 바꾸면 돼요' : '상자를 눌러 고르고 두 번 누르면 문구 편집 · Shift·Ctrl+누르기나 빈 곳 끌기로 여러 개 · 끌 때 Shift는 수평·수직 고정 · Ctrl+휠 확대';
  $$('.tpl-pane').forEach(p => { p.hidden = !p.dataset.for.split(' ').includes(state.template); });
  const steps = T.steps || ['용지', '명단', '문구·배치', '확인·내보내기'];
  $$('#stepTabs button[data-step]').forEach(b => { const i = Number(b.dataset.step) - 1; b.innerHTML = `<span class="n">${i + 1}</span>${steps[i]}`; });
  $('#s1Title').textContent = isDoc() ? '메일머지할 문서' : isCustom() ? '배경 그림 · 용지' : state.template === 'us' ? '증서 용지' : '상장 용지';
  $('#paperLead2').hidden = isDoc() || isCustom();
  if (isCustom()) $('#paperLead').textContent = '초대장·이름표·수료증·카드처럼 이미 디자인된 그림이나 PDF를 배경으로 깔고, 그 위에 {{이름}} 같은 글 상자를 얹어 명단 줄마다 한 장씩 만들어요.';
  else if (isDoc()) $('#paperLead').textContent = '한글·워드로 만든 안내문·가정통신문·위촉장 같은 문서에 {{이름}}처럼 바꿀 자리를 써 두고 올리면, 명단 줄마다 채운 문서를 한 파일로 합치거나 한 부씩 따로 만들어요.';
  $('#bgInPdfLabel').textContent = isCustom() ? '배경 그림도 함께 인쇄 (빈 종이에 인쇄할 때)' : '테두리도 함께 인쇄 (빈 종이에 인쇄할 때)';
  $('#rbAddBox').hidden = isDoc();
  if (isCustom()) renderBgPanel();
  if (isDoc()) renderDocPanel();
}

// ---- 그림·PDF 배경
function renderBgPanel() {
  const bg = state.bg;
  $('#bgInfo').innerHTML = bg
    ? `<b>${esc(bg.name || '배경')}</b> · ${bg.kind === 'pdf' ? `PDF ${bg.mmW}×${bg.mmH}mm${bg.pages > 1 ? ` (${bg.pages}쪽 중 첫 쪽)` : ''}${bg.pdf ? '' : ' · 파일이 커서 PDF로 내보낼 때는 그림으로 들어가요'}` : `그림 ${bg.pxW}×${bg.pxH}px`}`
    : '';
  $('#bgActs').hidden = !bg;
  $('#bgDrop').hidden = !!bg;
  const sel = $('#paperKey');
  if (!sel.options.length) sel.innerHTML = PAPER_PRESETS.map(p => `<option value="${p.key}">${p.label}</option>`).join('');
  const P = state.paper || { key: 'A4P', w: 210, h: 297 };
  sel.value = P.key;
  $('#paperCustom').hidden = P.key !== 'custom';
  if ($('#paperW') !== document.activeElement) $('#paperW').value = Math.round(P.w * 10) / 10;
  if ($('#paperH') !== document.activeElement) $('#paperH').value = Math.round(P.h * 10) / 10;
  $('#bgFitSeg').innerHTML = BG_FITS.map(f => `<button data-fit="${f.id}" class="${state.bgFit === f.id ? 'on' : ''}">${f.name}</button>`).join('');
}

// 용지가 바뀌면 글 상자·마크도 같은 비율로 옮긴다
function setPaper(next) {
  const old = paperSize();
  const P = { ...next };
  if (Math.abs(old.w - P.w) < 0.05 && Math.abs(old.h - P.h) < 0.05) { state.paper = P; return; }
  // 처음 견본 글 상자를 아직 손대지 않았으면 새 용지에 맞춰 다시 앉힌다(작은 이름표에서도 글자가 읽히게)
  if (isCustom() && state.fields.length === 3) {
    const fresh = placeCustomFields(state.fields.map(f => ({ ...f })), old);
    const same = state.fields.every((f, i) => ['x', 'y', 'w', 'h'].every(k => Math.abs(f[k] - fresh[i][k]) < 0.3));
    if (same) { placeCustomFields(state.fields, P); for (const m of state.marks) clampMark(m); state.paper = P; return; }
  }
  const kx = P.w / old.w, ky = P.h / old.h, ks = Math.min(kx, ky);
  for (const f of state.fields) {
    f.x = Math.round(f.x * kx * 10) / 10; f.y = Math.round(f.y * ky * 10) / 10;
    f.w = Math.round(f.w * kx * 10) / 10; f.h = Math.round(f.h * ky * 10) / 10;
    f.size = Math.max(4, Math.round(f.size * ks * 2) / 2); f.minSize = Math.max(4, Math.round((f.minSize || f.size * 0.6) * ks * 2) / 2);
  }
  for (const m of state.marks) { m.x *= kx; m.y *= ky; m.w *= ks; m.h *= ks; clampMark(m); }
  state.paper = P;
}

async function setBackground(file) {
  if (!file) return;
  progressMsg('배경을 읽는 중…');
  try {
    const bg = await loadBackground(file);
    state.bg = bg;
    // 처음 올리면 용지를 배경 크기로
    const key = state.paper && state.paper.key !== 'A4P' ? state.paper.key : 'bg';
    setPaper(resolvePaper(key, bg, state.paper));
    progressMsg('');
    commitNow(); renderBgPanel(); refresh(); drawBorderView();
  } catch (e) {
    console.error(e);
    progressMsg(`배경을 읽지 못했어요: ${e.message}`);
  }
}
function progressMsg(t) { setStatus(t); }

async function drawCustomView() {
  const { w, h } = paperSize();
  let text = '';
  try {
    await ensureFonts();
    const rec = computeRecord(docView(), Math.min(state.current, Math.max(0, state.rows.length - 1)), store);
    const mk = state.marks.map(m => markSvg(m, { placeholder: true })).join('');
    text = `${mk}${textLayerSvg(rec)}`;
  } catch {}
  $('#borderView').innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" style="aspect-ratio:${w}/${h}"><rect width="${w}" height="${h}" fill="#fff"/>${paperBgSvg()}${text}</svg>`;
}

// PDF 내보내기 배경
async function pdfBackground() {
  if (!isCustom() || !state.bg || !state.bgInPdf) return null;
  const box = bgBox(state.bg, paperSize(), state.bgFit);
  const pdf = state.bg.kind === 'pdf' ? pdfBytes(state.bg) : null;
  return { pdf, img: dataUrlBytes(state.bg.src), png: /^data:image\/png/.test(state.bg.src), box };
}
// 한글 내보내기 배경: 용지 크기 그림 한 장(맨 뒤)
async function hwpxBackground() {
  if (!isCustom() || !state.bg || !state.bgInPdf) return [];
  const { w, h } = paperSize();
  const r = await bgPng(state.bg, paperSize(), state.bgFit);
  return [{ x: 0, y: 0, w, h, png: r.png, url: r.url, pxW: r.pxW, pxH: r.pxH }];
}

// ---- 글 상자 추가 · 지우기
function addTextBox(at) {
  const { w: W, h: H } = paperSize();
  const used = new Set(state.fields.flatMap(f => usedKeys(f.text)));
  const key = state.columns.find(c => !used.has(c)) || state.columns[0] || '이름';
  const ref = state.fields[state.fields.length - 1];
  const size = Math.round(Math.max(9, Math.min(W, H) / 210 * 16) * 2) / 2;
  const bw = Math.max(30, W * 0.42), bh = size * 0.3528 * 1.8;
  const cx = at ? at.x : W / 2, cy = at ? at.y : H / 2;
  const f = {
    ...FIELD_BASE, id: `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, label: key, text: `{{${key}}}`,
    font: ref ? ref.font : 'nanum-gothic', bold: false, color: ref ? ref.color : '#111111', align: 'center', valign: 'middle',
    x: Math.round((cx - bw / 2) * 10) / 10, y: Math.round((cy - bh / 2) * 10) / 10, w: Math.round(bw * 10) / 10, h: Math.round(bh * 10) / 10,
    size, minSize: Math.max(5, Math.round(size * 0.6)), maxLines: 0, manual: true, added: true,
  };
  state.fields.push(f);
  setSelection([f.id], f.id);
  commitNow(); renderRibbon(); refresh();
  requestAnimationFrame(() => openEditor(f.id, 'template'));
}
const canDeleteBox = f => f && (isCustom() || f.added);
function deleteTextBox(id) {
  const f = state.fields.find(x => x.id === id);
  if (!canDeleteBox(f)) return;
  state.fields = state.fields.filter(x => x.id !== id);
  for (const o of state.overrides) if (o) delete o[id];
  setSelection([], null);
  commitNow(); renderRibbon(); refresh();
}

// ---- 문서 메일머지
function docInfo() { return state.docFile; }
function renderDocPanel() {
  const d = docInfo();
  $('#docDrop').hidden = false;
  $('#docDrop b').textContent = d ? '다른 문서로 바꾸기' : '한글(.hwpx) · 워드(.docx) 문서를 끌어 놓거나 눌러서 고르세요';
  $('#docInfo').innerHTML = d ? `<b>${esc(d.name)}</b> · ${d.kind === 'hwpx' ? '한글 HWPX' : '워드 DOCX'} · ${(d.size / 1024).toFixed(0)}KB${d.sections > 1 ? ` · 구역 ${d.sections}개(한 부씩 따로만 가능)` : ''}` : '';
  const vars = d ? d.vars : [];
  $('#docVars').innerHTML = vars.length
    ? vars.map(k => { const ok = state.columns.includes(k) || BUILTIN_VARS.includes(k); return `<span class="dv ${ok ? 'ok' : 'miss'}" title="${ok ? '명단에 있어요' : '명단에 이 항목이 없어요'}">{{${esc(k)}}}<em>${ok ? '있음' : '없음'}</em></span>`; }).join('')
    : `<span class="hint">${d ? '문서에서 {{…}} 자리를 찾지 못했어요. 바꿀 자리에 {{이름}}처럼 써 두세요.' : '문서를 올리면 여기에 보여요.'}</span>`;
  const miss = vars.filter(k => !state.columns.includes(k) && !BUILTIN_VARS.includes(k));
  $('#docVarsHint').textContent = miss.length ? `명단에 없는 변수는 빈칸으로 나가요: ${miss.join(', ')} — 2단계 표의 항목 이름을 맞춰 주세요.` : vars.length ? '모든 변수가 명단에 있어요. {{순번}}·{{오늘}}도 쓸 수 있어요.' : '';
  const ms = $('#docModeSeg');
  if (ms) $$('#docModeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === state.docMode));
  if ($('#docNameRow')) $('#docNameRow').hidden = state.docMode !== 'separate';
  if ($('#docNameTpl') && $('#docNameTpl') !== document.activeElement) $('#docNameTpl').value = state.docNameTpl || '';
}

async function setDocument(file) {
  if (!file) return;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const info = await inspectDocument(bytes, file.name, window.JSZip);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    state.docFile = { ...info, b64: btoa(bin) };
    // 명단이 아직 견본이면 문서의 변수로 표 항목을 맞춘다
    const T = tpl('doc');
    const isSample = JSON.stringify(state.columns) === JSON.stringify(T.sample.columns) && JSON.stringify(state.rows) === JSON.stringify(T.sample.rows);
    const cols = info.vars.filter(k => !BUILTIN_VARS.includes(k));
    if (isSample && cols.length) {
      const sampleVal = (c, i) => { const j = T.sample.columns.indexOf(c); return j >= 0 ? T.sample.rows[i][j] : `${c} 예시${i + 1}`; };
      state.columns = cols;
      state.rows = [0, 1].map(i => cols.map(c => sampleVal(c, i)));
      state.overrides = [];
      sheet = null;
    }
    commitNow(); renderDocPanel(); drawDocView(); refresh();
    setStatus(`문서를 읽었어요. 변수 ${info.vars.length}개를 찾았어요.`);
  } catch (e) {
    console.error(e);
    setStatus(e.message || '문서를 읽지 못했어요.');
  }
}

function docResolve(row, index) {
  return key => {
    if (BUILTIN_VARS.includes(key) || state.columns.includes(key)) return fillTemplate(`{{${key}}}`, state.columns, row, index).text;
    return null;
  };
}

function docHtml(index) {
  const d = docInfo();
  if (!d) return '<div class="doc-empty">1단계에서 한글(.hwpx)·워드(.docx) 문서를 올려 주세요.</div>';
  const row = state.rows[index] || [];
  const paras = previewParagraphs(d, docResolve(row, index));
  return paras.map(segs => `<p>${segs.map(x => x.v ? `<mark class="${x.missing ? 'miss' : ''}" title="{{${esc(x.key)}}}">${esc(x.t) || '&nbsp;'}</mark>` : esc(x.t)).join('') || '&nbsp;'}</p>`).join('');
}
function drawDocView() {
  $('#borderView').innerHTML = `<div class="doc-page">${docHtml(Math.min(state.current, Math.max(0, state.rows.length - 1)))}</div>`;
}
function renderDocPreview() {
  const n = state.rows.length;
  if (state.current >= n) state.current = Math.max(0, n - 1);
  $('#docNavLabel').textContent = n ? `${state.current + 1} / ${n} · ${recName(state.current) || ''}` : '명단 없음';
  $('#docPaper').innerHTML = docHtml(state.current);
  if (state.step === 1) drawDocView();
  if (state.step === 4) renderRangeInfo();
}

async function exportDoc() {
  const d = docInfo();
  if (!d) { setStatus('1단계에서 문서를 먼저 올려 주세요.'); return; }
  const indices = allIndices();
  if (!checkIndices(indices)) return;
  const mode = state.docMode === 'combined' && d.sections > 1 ? 'separate' : state.docMode;
  progress(0, indices.length, '문서 만드는 중…');
  try {
    const bin = atob(d.b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const res = await mergeDocument({
      JSZip: window.JSZip, bytes, kind: d.kind, mode,
      rows: indices.map(i => ({ row: state.rows[i], index: i })),
      resolveFor: (row, i) => docResolve(row, i),
      nameFor: (row, i) => fillTemplate(state.docNameTpl || '{{이름}}', state.columns, row, i).text,
      base: (d.name || '문서').replace(/\.(hwpx|docx)$/i, ''),
      onProgress: (k, n) => progress(k, n, `${k} / ${n}부`),
    });
    download(res.bytes, res.name, res.type);
    progress(1, 1, `${indices.length}부를 ${mode === 'combined' ? '한 파일로' : 'ZIP으로'} 만들었어요.${mode !== state.docMode ? ' (구역이 여러 개라 한 부씩 따로 만들었어요)' : ''}`);
  } catch (e) {
    console.error(e);
    progress(0, 1, `만들지 못했어요: ${e.message}`);
  }
}

// ---- 그림(PNG) 묶음: 장마다 PNG(200dpi)로 그려 ZIP
async function exportPng() {
  if (busy || !state.rows.length) return;
  const indices = allIndices();
  if (!checkIndices(indices)) return;
  busy = true;
  try {
    await ensureFonts(true);
    const { w, h } = paperSize();
    const dpi = 200, k = Math.min(dpi / 25.4, 4200 / Math.max(w, h));
    const W = Math.round(w * k), H = Math.round(h * k);
    const marks = (await bakedMarks()).map(m => `<image href="${m.url}" x="${m.x}" y="${m.y}" width="${m.w}" height="${m.h}" preserveAspectRatio="none"/>`).join('');
    const bg = isCustom() ? (state.bg && state.bgInPdf ? paperBgSvg() : '') : (state.bgInPdf ? `<image href="${svgDataUrl(borderSvg(state.border, { bg: false }))}" x="0" y="0" width="${w}" height="${h}"/>` : '');
    const zip = new window.JSZip();
    for (let n = 0; n < indices.length; n++) {
      const i = indices[n];
      applyAutoLayout(docView(), store, state.border, paperSize(), i);
      const rec = computeRecord(docView(), i, store);
      const stamp = rec.stamp && state.stamp.png ? `<image href="${state.stamp.png}" x="${rec.stamp.x}" y="${rec.stamp.y}" width="${rec.stamp.w}" height="${rec.stamp.h}" preserveAspectRatio="none"/>` : '';
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#fff"/>${bg}${marks}${stamp}${textLayerSvg(rec)}</svg>`;
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      const im = await loadImage(url);
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      cv.getContext('2d').drawImage(im, 0, 0, W, H);
      URL.revokeObjectURL(url);
      const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
      const nm = (recName(i) || '').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
      zip.file(`${String(i + 1).padStart(String(state.rows.length).length, '0')}${nm ? `_${nm}` : ''}.png`, blob);
      progress(n + 1, indices.length, `${n + 1} / ${indices.length}장 그리는 중…`);
    }
    const out = await zip.generateAsync({ type: 'uint8array' });
    download(out, `${isCustom() ? '메일머지' : '상장'}_${stamp8()}${rangeSuffix(indices)}_PNG.zip`, 'application/zip');
    progress(1, 1, `${indices.length}장을 PNG 묶음으로 만들었어요.`);
  } catch (e) {
    console.error(e);
    progress(0, 1, `그림으로 만들지 못했어요: ${e.message}`);
  } finally { busy = false; }
}

// ---------- 오른쪽 클릭 메뉴(3단계 편집 · 4단계 확인) ----------
// 누른 대상(글 칸 · 여러 칸 · 마크 틀 · 도장 · 빈 곳)에 맞는 일만 보여 준다.
let fmtClip = null;     // 글자 서식 복사
const FMT_KEYS = ['font', 'bold', 'color', 'align', 'valign', 'spacing', 'scale', 'lineHeight'];
const CTX_ALIGNS = [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽'], ['justify', '양쪽'], ['distribute', '균등 분배']];

function ctxEl() {
  let el = $('#ctxMenu');
  if (!el) { el = document.createElement('div'); el.id = 'ctxMenu'; el.className = 'ctx'; el.hidden = true; el.setAttribute('role', 'menu'); document.body.appendChild(el); }
  return el;
}
function hideCtx() { const el = $('#ctxMenu'); if (el) { el.hidden = true; el.innerHTML = ''; } }

function renderCtx(items) {
  return items.map((it, i) => {
    if (it === '-') return '<div class="ctx-sep"></div>';
    const cls = ['ctx-item', it.disabled ? 'disabled' : '', it.sub ? 'has-sub' : '', it.danger ? 'danger' : ''].join(' ');
    return `<div class="${cls}" data-i="${i}" role="menuitem" aria-disabled="${it.disabled ? 'true' : 'false'}">
      <span class="ctx-check">${it.checked ? '✓' : ''}</span><span class="ctx-label">${esc(it.label)}</span><span class="ctx-key">${it.sub ? '›' : esc(it.key || '')}</span>
      ${it.sub ? `<div class="ctx ctx-sub">${renderCtx(it.sub)}</div>` : ''}
    </div>`;
  }).join('');
}

function showCtx(items, x, y) {
  const el = ctxEl();
  el.innerHTML = renderCtx(items);
  el.hidden = false;
  el._items = items;
  const r = el.getBoundingClientRect();
  el.style.left = `${Math.max(6, Math.min(x, innerWidth - r.width - 6))}px`;
  el.style.top = `${Math.max(6, Math.min(y, innerHeight - r.height - 6))}px`;
  // 화면 오른쪽 끝이면 하위 메뉴를 왼쪽으로
  el.classList.toggle('flip', x + r.width * 2 > innerWidth);
}

function ctxPick(target) {
  const el = ctxEl();
  // data-i 경로를 따라가 항목을 찾는다(하위 메뉴 포함)
  const path = [];
  for (let n = target.closest('.ctx-item'); n && el.contains(n); n = n.parentElement.closest('.ctx-item')) path.unshift(Number(n.dataset.i));
  let list = el._items, it = null;
  for (const i of path) { it = list[i]; list = it && it.sub; }
  return it;
}

function fieldCtx(id) {
  const f = state.fields.find(x => x.id === id);
  if (!f) return [];
  const ov = state.overrides[state.current] && typeof state.overrides[state.current][id] === 'string';
  const vars = [...state.columns, ...BUILTIN_VARS].map(k => ({
    label: `{{${k}}}`,
    act: () => { openEditor(id, 'template'); requestAnimationFrame(() => { const b = $(`#edChips [data-insert="{{${CSS.escape(k)}}}"]`); if (b) b.click(); }); },
  }));
  return [
    { label: '문구 고치기 (모든 상장)', key: '두 번 누르기', act: () => openEditor(id, 'template') },
    { label: '변수 넣기', sub: vars },
    { label: `이 상장만 고치기 (${state.current + 1}번 ${recName(state.current)})`, disabled: !state.rows.length, act: () => openEditor(id, 'override') },
    { label: '이 상장 고친 것 되돌리기', disabled: !ov, act: () => { delete state.overrides[state.current][id]; commitNow(); refresh(); } },
    '-',
    { label: '글자 정렬', sub: CTX_ALIGNS.map(([v, n]) => ({ label: n, checked: f.align === v, act: () => { const b = $(`#rbAlign [data-align="${v}"]`); if (b) b.click(); } })) },
    { label: '상자 위치', sub: [
      { label: '용지 가로 가운데로', act: () => placeSelected('hcenter') },
      { label: '글 영역 왼쪽 끝으로', act: () => placeSelected('left') },
      { label: '글 영역 오른쪽 끝으로', act: () => placeSelected('right') },
      { label: '글 영역 너비에 맞추기', act: () => placeSelected('fullw') },
    ] },
    { label: '자동 배치로 되돌리기', disabled: !f.manual, act: () => $('#rbAutoField').click() },
    '-',
    { label: '글 상자 지우기', key: 'Delete', danger: true, disabled: !canDeleteBox(f), act: () => deleteTextBox(id) },
    { label: '글자 서식 복사', act: () => { fmtClip = Object.fromEntries(FMT_KEYS.map(k => [k, f[k]])); setStatus(`'${f.label}' 칸 서식을 복사했어요. 다른 칸에서 오른쪽 클릭 → 서식 붙여넣기`); } },
    { label: '서식 붙여넣기', disabled: !fmtClip, act: () => pasteFmt() },
  ];
}

function pasteFmt() {
  if (!fmtClip) return;
  for (const f of selFields()) Object.assign(f, fmtClip);
  commitNow(); renderRibbon(); refresh();
}

function multiCtx() {
  const n = selFields().length;
  return [
    { label: `${n}개 칸 맞추기`, sub: [
      { label: '왼쪽 맞춤', act: () => placeSelected('left') },
      { label: '가로 가운데 맞춤', act: () => placeSelected('hcenter') },
      { label: '오른쪽 맞춤', act: () => placeSelected('right') },
      '-',
      { label: '위 맞춤', act: () => placeSelected('top') },
      { label: '세로 가운데 맞춤', act: () => placeSelected('vcenter') },
      { label: '아래 맞춤', act: () => placeSelected('bottom') },
    ] },
    { label: '묶음째 용지 가로 가운데로', act: () => placeSelected('groupHcenter') },
    { label: '세로 간격 같게', disabled: n < 3, act: () => placeSelected('distV') },
    { label: '가로 간격 같게', disabled: n < 3, act: () => placeSelected('distH') },
    '-',
    { label: '글자 정렬', sub: CTX_ALIGNS.map(([v, nm]) => ({ label: nm, act: () => { const b = $(`#rbAlign [data-align="${v}"]`); if (b) b.click(); } })) },
    { label: '서식 붙여넣기', disabled: !fmtClip, act: () => pasteFmt() },
    { label: '자동 배치로 되돌리기', disabled: !selFields().some(f => f.manual), act: () => $('#rbAutoField').click() },
    '-',
    { label: '선택 풀기', key: 'Esc', act: () => { setSelection([], null); refresh(); } },
  ];
}

function markCtx(m) {
  return [
    { label: m.src ? '그림 바꾸기' : '그림 넣기', act: () => pickMarkImage(m.id) },
    { label: cropId === m.id ? '자르기 끝내기' : '틀 안에서 자르기', key: '두 번 누르기', disabled: !m.src, act: () => { cropId = cropId === m.id ? null : m.id; renderMarkPop(); refresh(); } },
    { label: '맞춤 처음대로', disabled: !m.src || ((m.zoom || 1) === 1 && !m.panX && !m.panY), act: () => { m.zoom = 1; m.panX = 0; m.panY = 0; renderMarkPop(); commitNow(); refresh(); } },
    { label: '배경 지우기', checked: !!m.bgOn, disabled: !m.src, act: () => { m.bgOn = !m.bgOn; applyMarkBg(m); } },
    { label: '모양', sub: MARK_SHAPES.map(x => ({ label: x.name, checked: m.shape === x.id, act: () => { m.shape = x.id; clampMark(m); renderMarkPop(); commitNow(); refresh(); } })) },
    '-',
    { label: '복제', act: () => { const c = clampMark({ ...clone({ ...m, src: null, orig: null }), src: m.src, orig: m.orig, id: newMark().id, name: `${m.name || '마크'} 복사본`, x: m.x + 6, y: m.y + 6 }); state.marks.push(c); selectMark(c.id); commitNow(); refresh(); } },
    { label: '맨 앞으로', disabled: state.marks[state.marks.length - 1] === m, act: () => { state.marks = state.marks.filter(x => x !== m).concat(m); commitNow(); refresh(); } },
    { label: '맨 뒤로', disabled: state.marks[0] === m, act: () => { state.marks = [m, ...state.marks.filter(x => x !== m)]; commitNow(); refresh(); } },
    { label: '설정 열기', act: () => { if (openPop !== 'mark') togglePop('mark'); } },
    '-',
    { label: '그림 빼기', disabled: !m.src, act: () => { m.src = null; m.orig = null; m.bgOn = false; m.imgW = 0; m.imgH = 0; cropId = null; clampMark(m); renderMarkPop(); commitNow(); refresh(); } },
    { label: '틀 지우기', key: 'Delete', danger: true, act: () => removeMark(m.id) },
  ];
}

function stampCtx(placed) {
  const s = state.stamp;
  const re = async () => { await processStamp(); renderStampCard(); commitNow(); refresh(); };
  if (!placed) return [
    { label: '도장 그림 넣기', act: () => { $('#stampFile').value = ''; $('#stampFile').click(); } },
    { label: '도장 설정 열기', act: () => { if (openPop !== 'stamp') togglePop('stamp'); } },
    '-',
    { label: '도장 쓰지 않기', danger: true, act: () => { s.enabled = false; commitNow(); refresh(); } },
  ];
  return [
    { label: '도장 바꾸기', act: () => { $('#stampFile').value = ''; $('#stampFile').click(); } },
    { label: '배경 지우기', checked: !!s.white, act: () => { s.white = !s.white; re(); } },
    { label: '붉은색으로 맞추기', checked: !!s.red, act: () => { s.red = !s.red; re(); } },
    { label: '자리 처음대로 (끝 글자 절반)', disabled: !s.dx && !s.dy && !s.manual, act: () => { s.dx = 0; s.dy = 0; s.manual = false; renderStampCard(); commitNow(); refresh(); } },
    { label: '도장 설정 열기', act: () => { if (openPop !== 'stamp') togglePop('stamp'); } },
    '-',
    { label: '도장 빼기', danger: true, act: () => $('#stampClear').click() },
  ];
}

function emptyCtx(at) {
  return [
    { label: '여기에 글 상자 넣기', act: () => addTextBox(at) },
    { label: '여기에 틀 넣기', sub: MARK_SHAPES.map(x => ({ label: x.name, act: () => addMark(x.id, at) })) },
    { label: '도장 틀 넣기', disabled: state.stamp.enabled, act: () => { state.stamp.enabled = true; commitNow(); refresh(); } },
    '-',
    { label: '모든 칸 고르기', key: 'Ctrl+A', act: () => { setSelection(state.fields.map(f => f.id), state.fields[0] && state.fields[0].id); refresh(); } },
    { label: '서식 붙여넣기 (고른 칸)', disabled: !fmtClip || !selFields().length, act: () => pasteFmt() },
    { label: '전체 자동 배치', disabled: !state.fields.some(f => f.manual), act: () => $('#rbAutoAll').click() },
    '-',
    { label: '칸 테두리 보이기', checked: state.showBoxes, act: () => { $('#showBoxes').click(); } },
    { label: '가이드 맞춤(스냅)', checked: $('#snapOn').checked, act: () => { $('#snapOn').click(); } },
    { label: '화면에 맞추기', key: 'Ctrl+0', act: () => { state.zoom = 'fit'; applyZoom(); save(); } },
  ];
}

function overrideCtx(id) {
  const f = state.fields.find(x => x.id === id);
  if (!f) return [];
  const ov = state.overrides[state.current] && typeof state.overrides[state.current][id] === 'string';
  return [
    { label: `이 상장만 고치기 (${state.current + 1}번 ${recName(state.current)})`, act: () => openEditor(id, 'override') },
    { label: '이 상장 고친 것 되돌리기', disabled: !ov, act: () => { delete state.overrides[state.current][id]; commitNow(); refresh(); } },
    { label: `'${f.label}' 칸 문구 고치기 (모든 상장)`, act: () => openEditor(id, 'template') },
  ];
}

function onCanvasContext(e) {
  if (state.step !== 3 && state.step !== 4) return;
  e.preventDefault();
  closeEditor();
  const svg = $('#page');
  const box = e.target.closest('[data-box]');
  const id = box ? box.dataset.box : null;
  const undoItems = ['-', { label: '되돌리기', key: 'Ctrl+Z', disabled: !undoStack.length, act: undo }, { label: '다시 하기', key: 'Ctrl+Y', disabled: !redoStack.length, act: redo }];
  let items;
  if (state.step === 4) {
    if (!id || id.startsWith('__')) return hideCtx();
    items = overrideCtx(id);
  } else if (id && id.startsWith('__mark:')) {
    const m = markById(id.slice(7));
    if (!m) return;
    selectMark(m.id); refresh();
    items = markCtx(m);
  } else if (id === '__stampPh' || id === '__stamp') {
    if (markSel) { markSel = null; cropId = null; renderMarkPop(); }
    stampSelected = id === '__stamp'; refresh();
    items = stampCtx(id === '__stamp');
  } else if (id) {
    if (markSel) { markSel = null; cropId = null; renderMarkPop(); }
    if (!isSel(id)) { setSelection([id], id); refresh(); }
    items = selFields().length > 1 ? multiCtx() : fieldCtx(id);
  } else {
    const p = svg ? svgPoint(svg, e) : null;
    items = emptyCtx(p ? { x: p.x, y: p.y } : null);
  }
  showCtx([...items, ...undoItems], e.clientX, e.clientY);
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
    if (!checkIndices(indices)) return;
    progress(0, 1, '한글 파일 만드는 중…');
    const res = await buildHwpx({
      JSZip: window.JSZip, template: await loadTemplate(), doc: docView(), store, indices,
      paper: paperSize(), offset: state.offset, scale: printScale(),
      stampPng: state.stamp.png ? dataUrlBytes(state.stamp.png) : null,
      marks: [...(await hwpxBackground()), ...(await bakedMarks())],
      stampPx: { w: state.stamp.imgW, h: state.stamp.imgH },
    });
    download(res.bytes, `상장_${stamp8()}${rangeSuffix(indices)}.hwpx`, 'application/hwp+zip');
    progress(1, 1, `한글 파일(${indices.length}쪽)을 만들었어요.`);
  } catch (e) {
    console.error(e);
    progress(0, 1, `한글 파일을 만들지 못했어요: ${e.message}`);
  } finally { busy = false; }
}

// ---------- 이벤트 ----------
function bind() {
  $('#stepTabs').addEventListener('click', e => { const b = e.target.closest('[data-step]'); if (b && projectId) setStep(Number(b.dataset.step)); });
  $('#homeBtn').addEventListener('click', goHome);
  $('#projLabel').addEventListener('click', goHome);
  $('#projGrid').addEventListener('click', e => {
    const nb = e.target.closest('[data-new]');
    if (nb) { newProject(nb.dataset.new); return; }
    const card = e.target.closest('.proj-card'), b = e.target.closest('[data-act]');
    if (!card || !b) return;
    const id = card.dataset.id;
    if (b.dataset.act === 'open') openProject(id);
    if (b.dataset.act === 'dup') duplicateProject(id);
    if (b.dataset.act === 'del') deleteProject(id);
  });
  $('#projGrid').addEventListener('change', e => { const inp = e.target.closest('.proj-name'); if (inp) renameProject(inp.closest('.proj-card').dataset.id, inp.value); });
  $('#projGrid').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.closest('.proj-name')) e.target.blur(); });
  window.addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
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
    state = freshState(state.template);
    sheet = null;
    resetHistory(); applyViewToggles(); setStep(1); refresh();
  });

  // 1단계: 테두리 수치
  $('.paper-side').addEventListener('input', e => {
    const el = e.target.closest('[data-b]');
    if (el) setBorder(el.dataset.b, el.value);
  });
  $('#borderReset').addEventListener('click', () => {
    const oldC = areaRect();
    state.border = { ...tplBorder() };
    remapManualBoxes(oldC, areaRect());
    renderBorderPage(true); save();
  });
  $('.paper-side').addEventListener('click', e => {
    const r = e.target.closest('[data-reset]');
    if (r) { setBorder(r.dataset.reset, tplBorder()[r.dataset.reset]); renderBorderPage(true); return; }
    const o = e.target.closest('[data-orn]');
    if (o) { setBorder('ornType', o.dataset.orn); }
  });
  $('#b-ornOn').addEventListener('change', e => setBorder('ornOn', e.target.checked));
  $('#offX').addEventListener('input', e => { state.offset.x = parseFloat(e.target.value) || 0; renderPrintNote(); save(); });
  $('#offY').addEventListener('input', e => { state.offset.y = parseFloat(e.target.value) || 0; renderPrintNote(); save(); });
  $('#measured').addEventListener('input', e => { const v = parseFloat(e.target.value); state.measured = Number.isFinite(v) ? v : 100; renderPrintNote(); save(); });
  $('#testPageBtn').addEventListener('click', exportTestPage);
  $('#testPrintBtn').addEventListener('click', testPrintNow);
  $('#printBtn').addEventListener('click', printNow);
  $('#tabHome').addEventListener('click', goHome);
  // 그림·PDF 배경
  const bgPick = () => { $('#bgFile').value = ''; $('#bgFile').click(); };
  $('#bgDrop').addEventListener('click', bgPick);
  $('#bgChange').addEventListener('click', bgPick);
  $('#bgFile').addEventListener('change', e => setBackground(e.target.files[0]));
  $('#bgRemove').addEventListener('click', () => { state.bg = null; commitNow(); renderBgPanel(); refresh(); drawBorderView(); });
  $('#paperKey').addEventListener('change', e => { setPaper(resolvePaper(e.target.value, state.bg, state.paper)); commitNow(); renderBgPanel(); refresh(); drawBorderView(); });
  for (const id of ['paperW', 'paperH']) $(`#${id}`).addEventListener('change', () => { setPaper(resolvePaper('custom', state.bg, { w: $('#paperW').value, h: $('#paperH').value })); commitNow(); renderBgPanel(); refresh(); drawBorderView(); });
  $('#bgFitSeg').addEventListener('click', e => { const b = e.target.closest('[data-fit]'); if (!b) return; state.bgFit = b.dataset.fit; commitNow(); renderBgPanel(); refresh(); drawBorderView(); });
  for (const [dz, fn] of [['#bgDrop', setBackground], ['#docDrop', setDocument]]) {
    $(dz).addEventListener('dragover', e => { e.preventDefault(); $(dz).classList.add('over'); });
    $(dz).addEventListener('dragleave', () => $(dz).classList.remove('over'));
    $(dz).addEventListener('drop', e => { e.preventDefault(); $(dz).classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) fn(f); });
  }
  // 글 상자 추가
  $('#rbAddBox').addEventListener('click', () => addTextBox());
  // 문서 메일머지
  $('#docDrop').addEventListener('click', () => { $('#docFile').value = ''; $('#docFile').click(); });
  $('#docFile').addEventListener('change', e => setDocument(e.target.files[0]));
  $('#docPrev').addEventListener('click', () => { if (state.current > 0) { state.current--; refresh(); } });
  $('#docNext').addEventListener('click', () => { if (state.current < state.rows.length - 1) { state.current++; refresh(); } });
  $('#docModeSeg').addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (!b) return; state.docMode = b.dataset.mode; renderDocPanel(); save(); });
  $('#docNameTpl').addEventListener('input', e => { state.docNameTpl = e.target.value; save(); });
  $('#docMergeBtn').addEventListener('click', exportDoc);
  $('#pngBtn').addEventListener('click', exportPng);
  // 오른쪽 클릭 메뉴
  $('#canvas').addEventListener('contextmenu', onCanvasContext);
  document.addEventListener('pointerdown', e => { if (!e.target.closest('#ctxMenu')) hideCtx(); }, true);
  document.addEventListener('click', e => {
    const item = e.target.closest('#ctxMenu .ctx-item');
    if (!item) return;
    const it = ctxPick(e.target);
    if (!it || it.disabled || it.sub) return;
    hideCtx();
    it.act && it.act();
  });
  window.addEventListener('blur', hideCtx);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#ctxMenu') && !$('#ctxMenu').hidden) { hideCtx(); e.stopPropagation(); } }, true);
  window.addEventListener('resize', hideCtx);
  $('#canvas').addEventListener('scroll', hideCtx, true);
  // 마크 프레임
  $('#pop-mark').addEventListener('click', e => {
    const a = e.target.closest('[data-addmark]');
    if (a) { addMark(a.dataset.addmark); return; }
    const m = markSel ? markById(markSel) : null;
    if (!m) return;
    const sh = e.target.closest('[data-shape]');
    if (sh) { m.shape = sh.dataset.shape; clampMark(m); renderMarkPop(); commitNow(); refresh(); return; }
    if (e.target.closest('#markPick')) { pickMarkImage(m.id); return; }
    if (e.target.closest('#markCrop')) { cropId = cropId === m.id ? null : m.id; renderMarkPop(); refresh(); return; }
    if (e.target.closest('#markFit')) { m.zoom = 1; m.panX = 0; m.panY = 0; renderMarkPop(); commitNow(); refresh(); return; }
    if (e.target.closest('#markClearImg')) { m.src = null; m.orig = null; m.bgOn = false; m.imgW = 0; m.imgH = 0; cropId = null; clampMark(m); renderMarkPop(); commitNow(); refresh(); return; }
    if (e.target.closest('#markDel')) { removeMark(m.id); }
  });
  $('#pop-mark').addEventListener('input', e => {
    const m = markSel ? markById(markSel) : null;
    if (!m) return;
    if (e.target.id === 'markZoom') { m.zoom = Number(e.target.value) / 100; clampMark(m); $('#markZoomV').textContent = `${Math.round(m.zoom * 100)}%`; refresh(); save(); return; }
    if (e.target.id === 'markName') { m.name = e.target.value; refresh(); save(); return; }
    const k = { markX: 'x', markY: 'y', markW: 'w', markH: 'h' }[e.target.id];
    if (k) {
      const v = parseFloat(e.target.value);
      if (!Number.isFinite(v)) return;
      m[k] = v;
      if (m.shape === 'circle' && k === 'w') m.h = v;
      clampMark(m); refresh(); save();
    }
  });
  $('#markBg').addEventListener('change', e => { const m = markSel ? markById(markSel) : null; if (!m) return; m.bgOn = e.target.checked; applyMarkBg(m); });
  let markBgTimer = 0;
  $('#markBgStr').addEventListener('input', e => {
    const m = markSel ? markById(markSel) : null; if (!m) return;
    m.bgStrength = Number(e.target.value); $('#markBgStrV').textContent = e.target.value;
    clearTimeout(markBgTimer); markBgTimer = setTimeout(() => applyMarkBg(m), 120);
  });
  $('#markFile').addEventListener('change', e => { const f = e.target.files[0]; if (f && markUploadId) setMarkImage(markUploadId, f); });

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
      const def = tpl(state.template).defs.find(d => d.id === editing.field);
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
    if (id && id.startsWith('__mark:')) {
      const m = markById(id.slice(7));
      if (!m) return;
      if (!m.src) { pickMarkImage(m.id); return; }
      cropId = cropId === m.id ? null : m.id;
      renderMarkPop(); refresh();
      return;
    }
    if (id === '__stamp' || id === '__stampPh') return;
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
  // 2단계에서 표 밖(입력란이 아닌 곳)을 보고 있을 때 Ctrl+V 하면 표의 고른 칸에 붙인다
  document.addEventListener('paste', e => {
    if (state.step !== 2 || state.dataMode !== 'paste') return;
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    getSheet().paste(text);
    getSheet().focus();
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
  $('#addRow').addEventListener('click', () => { const sh = getSheet(); sh.insertRows(state.rows.length, 1); sh.setSel({ r: state.rows.length - 1, c: 0 }); sh.focus(); });
  $('#addCol').addEventListener('click', () => { const sh = getSheet(); sh.insertCols(state.columns.length, 1); sh.setSel({ r: -1, c: state.columns.length - 1 }); sh.focus(); });
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
    if (openPop && !e.target.closest('.pop') && !e.target.closest('[data-pop]') && !(openPop === 'mark' && e.target.closest('.mark-box'))) closePops();
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
  let bgTimer = 0;
  $('#stampBgStr').addEventListener('input', e => {
    state.stamp.bgStrength = Number(e.target.value);
    $('#stampBgStrV').textContent = e.target.value;
    clearTimeout(bgTimer);
    bgTimer = setTimeout(async () => { await processStamp(); renderStampCard(); refresh(); }, 120);
  });
  for (const [id, prop] of [['stampSize', 'size'], ['stampDx', 'dx'], ['stampDy', 'dy']]) {
    $(`#${id}`).addEventListener('input', e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { state.stamp[prop] = v; if (prop === 'size') state.stamp.manual = true; refresh(); } });
  }

  // 4단계
  $('#rangeSeg').addEventListener('click', e => {
    const b = e.target.closest('[data-range]');
    if (!b) return;
    state.range = b.dataset.range;
    $$('#rangeSeg button').forEach(x => x.classList.toggle('on', x === b)); save();
    renderRangeInfo();
    if (state.range === 'pick') $('#rangeText').focus();
  });
  $('#rangeText').addEventListener('input', e => { state.rangeText = e.target.value; renderRangeInfo(); save(); });
  $('#rangeText').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#pdfBtn').click(); } });
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
    // 자르기 중에는 휠로 틀 안 그림을 확대·축소
    if (cropId && state.step === 3 && !(e.ctrlKey || e.metaKey)) {
      const m = markById(cropId);
      if (m) {
        e.preventDefault();
        m.zoom = (m.zoom || 1) * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018));
        clampMark(m); renderMarkPop(); refresh(); save();
        return;
      }
    }
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
    // 고른 마크: 방향키로 옮기기, Delete로 지우기, Esc로 자르기 끝내기
    if (state.step === 3 && markSel) {
      const m = markById(markSel);
      if (m && e.key.startsWith('Arrow')) {
        const st = e.shiftKey ? 5 : 0.5;
        if (e.key === 'ArrowLeft') m.x -= st; if (e.key === 'ArrowRight') m.x += st;
        if (e.key === 'ArrowUp') m.y -= st; if (e.key === 'ArrowDown') m.y += st;
        e.preventDefault(); renderMarkPop(); refresh(); return;
      }
      if (m && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); removeMark(m.id); return; }
      if (e.key === 'Escape') { if (cropId) { cropId = null; } else { markSel = null; closePops(); } renderMarkPop(); refresh(); return; }
    }
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
function applyViewToggles() {
  $('#showBg').checked = state.showBg;
  $('#showBoxes').checked = state.showBoxes;
  $('#bgInPdf').checked = state.bgInPdf;
  $$('#rangeSeg button').forEach(x => x.classList.toggle('on', x.dataset.range === state.range));
  renderRangeInfo();
}

bind();
new ResizeObserver(() => { applyZoom(); positionEditor(); }).observe($('#canvas'));
migrateOld();
applyViewToggles();
resetHistory();
window.__sa = { state: () => state, project: () => projectId };
// 늘 처음 화면(프로젝트 목록)에서 시작한다
setStep(0);
