// 쎈스 어워드 — 엑셀처럼 쓰는 명단 표
//
// 칸 고르기(누르기·끌기·Shift), 방향키·Tab·Enter 이동, 바로 타자 입력(한글 입력 포함),
// F2·두 번 눌러 고치기, Alt+Enter 칸 안 줄바꿈, Ctrl+C/X/V(여러 칸, 엑셀과 주고받기),
// Delete 지우기, 채우기 핸들(끌어 복사, 끝 번호는 1씩 늘림), 오른쪽 클릭 메뉴, 항목 너비 조절.
//
// 줄 번호 r: -1 은 항목 이름 줄(머리글), 0.. 은 명단, rows.length 는 맨 아래 빈 줄(입력하면 줄이 늘어남).
// 키 입력은 늘 숨은 입력창(textarea)이 받는다. 그래야 한글 조합이 첫 글자부터 깨지지 않는다.
import { parseTSV } from './data.js';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const letter = c => { let s = ''; c += 1; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };
const tsvCell = v => (/[\t\n"]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));

/** 채우기: 끝에 숫자가 있으면 k만큼 늘린다(자리 수 유지) */
function bump(v, k) {
  const m = /^(.*?)(\d+)(\D*)$/.exec(String(v ?? ''));
  if (!m) return v;
  const n = Number(m[2]) + k;
  if (n < 0) return v;
  return m[1] + String(n).padStart(m[2].length, '0') + m[3];
}
function seriesStep(vals) {
  // 두 칸 이상: 끝 숫자가 일정하게 늘면 그 간격, 아니면 null
  const parts = vals.map(v => /^(.*?)(\d+)(\D*)$/.exec(String(v ?? '')));
  if (parts.some(p => !p)) return null;
  if (parts.some(p => p[1] !== parts[0][1] || p[3] !== parts[0][3])) return null;
  const nums = parts.map(p => Number(p[2]));
  const d = nums[1] - nums[0];
  for (let i = 2; i < nums.length; i++) if (nums[i] - nums[i - 1] !== d) return null;
  return d;
}

export class Sheet {
  /**
   * host: {
   *   model(): { columns, rows }  — 직접 고쳐 쓰는 배열
   *   widths(): { [항목 이름]: px }
   *   rowsInserted(at, n), rowsDeleted(at, n), renamed(oldName, newName), replacedAll()
   *   changed(), activeRow(r), undo(), redo(), status(msg)
   * }
   */
  constructor(root, host) {
    this.root = root;
    this.host = host;
    this.a = { r: 0, c: 0 };   // 기준 칸(활성 칸)
    this.f = { r: 0, c: 0 };   // 범위의 반대쪽 끝
    this.editing = null;       // { r, c, mode: 'enter' | 'edit', orig }
    this.dragSel = null;
    this.fillDrag = null;
    root.innerHTML = `<div class="xl" tabindex="-1">
      <div class="xl-scroll"><table class="xl-table"></table>
        <div class="xl-selbox"></div><div class="xl-fillprev" hidden></div><div class="xl-fill" title="끌어서 채우기 (Ctrl: 숫자 늘리지 않고 복사)"></div>
        <textarea class="xl-input cell-editor" spellcheck="false" aria-label="칸 입력"></textarea>
      </div>
      <div class="xl-menu" hidden></div>
    </div>`;
    this.el = root.querySelector('.xl');
    this.scroll = root.querySelector('.xl-scroll');
    this.table = root.querySelector('.xl-table');
    this.selbox = root.querySelector('.xl-selbox');
    this.fill = root.querySelector('.xl-fill');
    this.fillPrev = root.querySelector('.xl-fillprev');
    this.input = root.querySelector('.xl-input');
    this.menu = root.querySelector('.xl-menu');
    this.bind();
  }

  get cols() { return this.host.model().columns; }
  get rows() { return this.host.model().rows; }

  // ---------- 그리기
  render() {
    const cols = this.cols, rows = this.rows;
    const widths = this.host.widths();
    const w = (name, ci) => widths[name] || this.autoWidth(ci);
    const disp = v => esc(String(v ?? '').replace(/\r?\n/g, ' ↵ '));
    let h = `<colgroup><col style="width:46px">${cols.map((n, ci) => `<col data-col="${ci}" style="width:${w(n, ci)}px">`).join('')}</colgroup>`;
    h += `<thead><tr class="xl-letters"><th class="xl-corner" data-all title="모두 고르기"></th>${cols.map((_, ci) => `<th class="xl-col" data-col="${ci}">${letter(ci)}<span class="xl-rs" data-resize="${ci}" title="끌어서 너비 조절"></span></th>`).join('')}</tr>`;
    h += `<tr class="xl-names"><th class="xl-rowh xl-nameh" title="항목 이름(상장 문구에서 변수로 써요)">항목</th>${cols.map((n, ci) => `<td class="xl-cell xl-name" data-r="-1" data-c="${ci}">${disp(n)}</td>`).join('')}</tr></thead><tbody>`;
    h += rows.map((row, ri) => `<tr><th class="xl-rowh" data-row="${ri}">${ri + 1}</th>${cols.map((_, ci) => `<td class="xl-cell" data-r="${ri}" data-c="${ci}">${disp(row[ci])}</td>`).join('')}</tr>`).join('');
    h += `<tr class="xl-ghost"><th class="xl-rowh" data-row="${rows.length}" title="여기에 입력하거나 붙여 넣으면 줄이 늘어나요">+</th>${cols.map((_, ci) => `<td class="xl-cell" data-r="${rows.length}" data-c="${ci}"></td>`).join('')}</tr></tbody>`;
    this.table.innerHTML = h;
    this.fitTableWidth();
    this.clampSel();
    this.paintSel(false);
  }

  // table-layout: fixed 는 표 너비가 정해져 있어야 먹는다(auto면 글 길이보다 좁아지지 않음) → 열 너비 합으로 고정
  fitTableWidth() {
    const total = [...this.table.querySelectorAll('col')].reduce((a, c) => a + (parseFloat(c.style.width) || 0), 0);
    this.table.style.width = `${total}px`;
  }

  autoWidth(ci) {
    let len = String(this.cols[ci] ?? '').length;
    for (const r of this.rows.slice(0, 60)) len = Math.max(len, String(r[ci] ?? '').length);
    return Math.max(90, Math.min(420, len * 13 + 28));
  }

  td(r, c) { return this.table.querySelector(`td[data-r="${r}"][data-c="${c}"]`); }

  range() {
    return { r1: Math.min(this.a.r, this.f.r), r2: Math.max(this.a.r, this.f.r), c1: Math.min(this.a.c, this.f.c), c2: Math.max(this.a.c, this.f.c) };
  }

  clampSel() {
    const maxR = this.rows.length, maxC = Math.max(0, this.cols.length - 1);
    for (const p of [this.a, this.f]) { p.r = Math.max(-1, Math.min(maxR, p.r)); p.c = Math.max(0, Math.min(maxC, p.c)); }
  }

  boxOf(r1, c1, r2, c2) {
    const t1 = this.td(r1, c1), t2 = this.td(r2, c2);
    if (!t1 || !t2) return null;
    const sr = this.scroll.getBoundingClientRect();
    const a = t1.getBoundingClientRect(), b = t2.getBoundingClientRect();
    return { x: a.left - sr.left + this.scroll.scrollLeft, y: a.top - sr.top + this.scroll.scrollTop, w: b.right - a.left, h: b.bottom - a.top };
  }

  paintSel(scrollIntoView = true) {
    this.clampSel();
    const { r1, r2, c1, c2 } = this.range();
    this.table.querySelectorAll('.in-sel, .is-active, .hd-sel').forEach(el => el.classList.remove('in-sel', 'is-active', 'hd-sel'));
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) { const t = this.td(r, c); if (t) t.classList.add('in-sel'); }
    const act = this.td(this.a.r, this.a.c);
    if (act) act.classList.add('is-active');
    for (let c = c1; c <= c2; c++) { const h = this.table.querySelector(`th.xl-col[data-col="${c}"]`); if (h) h.classList.add('hd-sel'); }
    for (let r = r1; r <= r2; r++) { const h = this.table.querySelector(`th.xl-rowh[data-row="${r}"]`); if (h) h.classList.add('hd-sel'); }
    if (r1 === -1) { const h = this.table.querySelector('th.xl-nameh'); if (h) h.classList.add('hd-sel'); }
    const b = this.boxOf(r1, c1, r2, c2);
    if (b) {
      Object.assign(this.selbox.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px`, display: 'block' });
      Object.assign(this.fill.style, { left: `${b.x + b.w - 4}px`, top: `${b.y + b.h - 4}px`, display: r2 >= 0 ? 'block' : 'none' });
    } else { this.selbox.style.display = 'none'; this.fill.style.display = 'none'; }
    if (!this.editing) this.placeInput();
    if (scrollIntoView) this.reveal(this.f.r, this.f.c);
    if (this.a.r >= 0 && this.a.r < this.rows.length) this.host.activeRow(this.a.r);
  }

  reveal(r, c) {
    const t = this.td(r, c);
    if (!t) return;
    const sr = this.scroll.getBoundingClientRect(), tr = t.getBoundingClientRect();
    const head = 64, left = 46;
    if (tr.top < sr.top + head) this.scroll.scrollTop -= sr.top + head - tr.top;
    else if (tr.bottom > sr.bottom) this.scroll.scrollTop += tr.bottom - sr.bottom + 2;
    if (tr.left < sr.left + left) this.scroll.scrollLeft -= sr.left + left - tr.left;
    else if (tr.right > sr.right) this.scroll.scrollLeft += tr.right - sr.right + 2;
  }

  // 숨은 입력창을 활성 칸 위에 둔다(한글 조합 창 위치, 바로 입력)
  placeInput() {
    const b = this.boxOf(this.a.r, this.a.c, this.a.r, this.a.c);
    if (!b) return;
    Object.assign(this.input.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${Math.max(b.w, 60)}px`, height: `${b.h}px` });
  }

  focus() { this.input.focus({ preventScroll: true }); }

  setSel(a, f = a, scroll = true) {
    if (this.editing) this.commit();
    this.a = { ...a }; this.f = { ...f };
    this.paintSel(scroll);
  }

  // ---------- 값 읽기·쓰기
  get(r, c) {
    if (r === -1) return this.cols[c] ?? '';
    return (this.rows[r] || [])[c] ?? '';
  }

  ensureRows(n) {
    const add = n - this.rows.length;
    if (add > 0) {
      const at = this.rows.length;
      for (let i = 0; i < add; i++) this.rows.push(this.cols.map(() => ''));
      this.host.rowsInserted(at, add);
    }
  }

  ensureCols(n) {
    while (this.cols.length < n) {
      let k = this.cols.length + 1;
      let name = `항목${k}`;
      while (this.cols.includes(name)) name = `항목${++k}`;
      this.cols.push(name);
      this.rows.forEach(r => r.push(''));
    }
  }

  set(r, c, v) {
    v = String(v ?? '');
    if (r === -1) {
      const old = this.cols[c];
      let name = v.replace(/[{}\t\n]/g, '').trim() || old;
      if (name === old) return;
      // 같은 이름이 있으면 번호를 붙인다
      let k = 2;
      const base = name;
      while (this.cols.some((x, i) => i !== c && x === name)) name = `${base}${k++}`;
      this.cols[c] = name;
      this.host.renamed(old, name);
      return;
    }
    this.ensureRows(r + 1);
    this.rows[r][c] = v;
  }

  // ---------- 고치기
  startEdit(mode, initial) {
    const { r, c } = this.a;
    this.f = { ...this.a };
    this.paintSel();
    this.editing = { r, c, mode, orig: this.get(r, c) };
    this.input.classList.add('editing');
    if (initial !== undefined) this.input.value = initial;
    this.placeInput();
    this.growInput();
    if (mode === 'edit') { const L = this.input.value.length; this.input.setSelectionRange(L, L); }
    this.focus();
  }

  growInput() {
    const b = this.boxOf(this.a.r, this.a.c, this.a.r, this.a.c);
    if (!b) return;
    this.input.style.height = 'auto';
    this.input.style.width = `${Math.max(b.w, Math.min(520, 12 + this.input.value.split('\n').reduce((m, l) => Math.max(m, l.length), 0) * 14))}px`;
    this.input.style.height = `${Math.max(b.h, this.input.scrollHeight)}px`;
  }

  commit() {
    const e = this.editing;
    if (!e) return;
    this.editing = null;
    const v = this.input.value;
    this.input.classList.remove('editing');
    this.input.value = '';
    if (v !== e.orig) {
      this.set(e.r, e.c, v);
      this.render();
      this.host.changed();
    } else this.paintSel(false);
  }

  cancel() {
    if (!this.editing) return;
    this.editing = null;
    this.input.classList.remove('editing');
    this.input.value = '';
    this.paintSel(false);
  }

  move(dr, dc, extend) {
    const from = extend ? this.f : this.a;
    const to = { r: from.r + dr, c: from.c + dc };
    if (extend) this.setSel(this.a, to); else this.setSel(to);
  }

  jump(dr, dc, extend) {
    // Ctrl+방향키: 끝까지
    const from = extend ? this.f : this.a;
    const to = { r: dr ? (dr < 0 ? -1 : Math.max(0, this.rows.length - 1)) : from.r, c: dc ? (dc < 0 ? 0 : this.cols.length - 1) : from.c };
    if (extend) this.setSel(this.a, to); else this.setSel(to);
  }

  clearRange() {
    const { r1, r2, c1, c2 } = this.range();
    let changed = false;
    for (let r = Math.max(0, r1); r <= Math.min(r2, this.rows.length - 1); r++) {
      for (let c = c1; c <= c2; c++) if (this.rows[r][c]) { this.rows[r][c] = ''; changed = true; }
    }
    if (changed) { this.render(); this.host.changed(); }
  }

  rangeTSV() {
    const { r1, r2, c1, c2 } = this.range();
    const out = [];
    for (let r = r1; r <= Math.min(r2, this.rows.length - 1); r++) {
      const line = [];
      for (let c = c1; c <= c2; c++) line.push(tsvCell(this.get(r, c)));
      out.push(line.join('\t'));
    }
    return out.join('\r\n');
  }

  // ---------- 붙여넣기
  paste(text) {
    const grid = parseTSV(text);
    if (!grid.length) return;
    const width = Math.max(...grid.map(r => r.length));
    const { r1, r2, c1, c2 } = this.range();
    const r0 = r1, c0 = c1;

    // 한 칸 값을 여러 칸 범위에 붙이면 범위를 모두 채운다
    if (grid.length === 1 && width === 1 && (r2 > r1 || c2 > c1)) {
      for (let r = Math.max(0, r1); r <= r2; r++) for (let c = c1; c <= c2; c++) this.set(r, c, grid[0][0]);
      this.render(); this.host.changed();
      return;
    }

    if (r0 === -1 && c0 === 0) {
      // 항목 이름 줄 첫 칸에 붙이면: 표 전체를 바꾼다(첫 줄 = 항목 이름)
      const names = grid[0].map((h, i) => (h || '').replace(/[{}]/g, '').trim() || `항목${i + 1}`);
      const seen = new Map();
      const cols = names.map(n => { const k = seen.get(n) || 0; seen.set(n, k + 1); return k ? `${n}${k + 1}` : n; });
      const m = this.host.model();
      m.columns.splice(0, m.columns.length, ...cols);
      const body = grid.slice(1).map(r => cols.map((_, i) => r[i] ?? ''));
      m.rows.splice(0, m.rows.length, ...body);
      this.host.replacedAll();
      this.a = { r: -1, c: 0 }; this.f = { r: Math.max(-1, body.length - 1), c: cols.length - 1 };
      this.render(); this.host.changed();
      this.host.status(`항목 ${cols.length}개, ${body.length}명을 붙여 넣었어요.`);
      return;
    }

    let start = 0;
    if (r0 >= 0) {
      // 제목 줄까지 복사해 명단 칸에 붙였다면 제목 줄은 건너뛴다
      const head = grid[0];
      const same = head.filter((v, i) => v && this.cols[c0 + i] === v.trim()).length;
      if (grid.length > 1 && same >= Math.max(1, Math.ceil(head.filter(Boolean).length * 0.6))) start = 1;
    }
    this.ensureCols(c0 + width);
    for (let i = start; i < grid.length; i++) {
      const r = r0 + (i - start);
      for (let j = 0; j < grid[i].length; j++) this.set(r, c0 + j, grid[i][j]);
    }
    const lastR = r0 + (grid.length - start) - 1;
    this.a = { r: r0, c: c0 }; this.f = { r: Math.max(r0, lastR), c: c0 + width - 1 };
    this.render(); this.host.changed();
    const n = grid.length - start;
    this.host.status(start ? `제목 줄은 건너뛰고 ${n}줄을 붙여 넣었어요.` : `${n}줄 × ${width}칸을 붙여 넣었어요.`);
  }

  // ---------- 채우기 핸들
  doFill(src, dst, copyOnly) {
    // src: 고른 범위, dst: 넓힌 범위(같은 방향으로만)
    const vertical = dst.r1 !== src.r1 || dst.r2 !== src.r2;
    if (vertical) {
      this.ensureRows(dst.r2 + 1);
      for (let c = src.c1; c <= src.c2; c++) {
        const vals = []; for (let r = src.r1; r <= src.r2; r++) vals.push(this.get(r, c));
        const n = vals.length;
        const step = n > 1 ? seriesStep(vals) : 1;
        for (let r = dst.r1; r <= dst.r2; r++) {
          if (r >= src.r1 && r <= src.r2) continue;
          let v;
          if (copyOnly || step === null) v = vals[((r - src.r1) % n + n) % n];
          else if (r > src.r2) v = bump(vals[n - 1], step * (r - src.r2));
          else v = bump(vals[0], -step * (src.r1 - r));
          this.set(r, c, v);
        }
      }
    } else {
      for (let r = Math.max(0, src.r1); r <= src.r2; r++) {
        const vals = []; for (let c = src.c1; c <= src.c2; c++) vals.push(this.get(r, c));
        const n = vals.length;
        const step = n > 1 ? seriesStep(vals) : 1;
        for (let c = dst.c1; c <= dst.c2; c++) {
          if (c >= src.c1 && c <= src.c2) continue;
          let v;
          if (copyOnly || step === null) v = vals[((c - src.c1) % n + n) % n];
          else if (c > src.c2) v = bump(vals[n - 1], step * (c - src.c2));
          else v = bump(vals[0], -step * (src.c1 - c));
          this.set(r, c, v);
        }
      }
    }
    this.a = { r: dst.r1, c: dst.c1 }; this.f = { r: dst.r2, c: dst.c2 };
    this.render(); this.host.changed();
  }

  // ---------- 줄·항목 넣기·빼기
  insertRows(at, n) {
    const m = this.host.model();
    m.rows.splice(at, 0, ...Array.from({ length: n }, () => this.cols.map(() => '')));
    this.host.rowsInserted(at, n);
    this.render(); this.host.changed();
  }
  deleteRows(r1, r2) {
    r1 = Math.max(0, r1); r2 = Math.min(r2, this.rows.length - 1);
    if (r2 < r1) return;
    this.host.model().rows.splice(r1, r2 - r1 + 1);
    this.host.rowsDeleted(r1, r2 - r1 + 1);
    this.a = { r: Math.min(r1, this.rows.length), c: this.a.c }; this.f = { ...this.a };
    this.render(); this.host.changed();
  }
  insertCols(at, n) {
    const m = this.host.model();
    for (let i = 0; i < n; i++) {
      let k = m.columns.length + 1, name = `항목${k}`;
      while (m.columns.includes(name)) name = `항목${++k}`;
      m.columns.splice(at + i, 0, name);
      m.rows.forEach(r => r.splice(at + i, 0, ''));
    }
    this.render(); this.host.changed();
  }
  deleteCols(c1, c2) {
    const m = this.host.model();
    if (m.columns.length - (c2 - c1 + 1) < 1) { this.host.status('항목은 하나 이상 남아 있어야 해요.'); return; }
    const names = m.columns.slice(c1, c2 + 1);
    if (!confirm(`'${names.join("', '")}' 항목을 뺄까요?`)) return;
    m.columns.splice(c1, c2 - c1 + 1);
    m.rows.forEach(r => r.splice(c1, c2 - c1 + 1));
    this.a = { r: this.a.r, c: Math.min(c1, m.columns.length - 1) }; this.f = { ...this.a };
    this.render(); this.host.changed();
  }

  // ---------- 오른쪽 클릭 메뉴
  openMenu(x, y) {
    const { r1, r2, c1, c2 } = this.range();
    const nr = Math.max(0, Math.min(r2, this.rows.length - 1) - Math.max(0, r1) + 1);
    const nc = c2 - c1 + 1;
    const items = [
      ['cut', '잘라내기', 'Ctrl+X'], ['copy', '복사', 'Ctrl+C'], ['paste', '붙여넣기', 'Ctrl+V'], '-',
      ['rowAbove', '위에 줄 넣기'], ['rowBelow', '아래에 줄 넣기'], ['rowDel', nr > 1 ? `줄 ${nr}개 삭제` : '줄 삭제', '', r2 < 0 || r1 >= this.rows.length], '-',
      ['colLeft', '왼쪽에 항목 넣기'], ['colRight', '오른쪽에 항목 넣기'], ['colDel', nc > 1 ? `항목 ${nc}개 삭제` : '항목 삭제'], '-',
      ['clear', '내용 지우기', 'Delete'],
    ];
    this.menu.innerHTML = items.map(it => it === '-' ? '<hr>' : `<button data-act="${it[0]}" ${it[3] ? 'disabled' : ''}><span>${it[1]}</span><kbd>${it[2] || ''}</kbd></button>`).join('');
    this.menu.hidden = false;
    const er = this.el.getBoundingClientRect();
    const mw = 220, mh = this.menu.offsetHeight || 320;
    this.menu.style.left = `${Math.min(x - er.left, er.width - mw - 6)}px`;
    this.menu.style.top = `${Math.max(4, Math.min(y - er.top, window.innerHeight - er.top - mh - 8))}px`;
  }
  closeMenu() { this.menu.hidden = true; }

  async menuAct(act) {
    this.closeMenu();
    const { r1, r2, c1, c2 } = this.range();
    if (act === 'copy' || act === 'cut') {
      try { await navigator.clipboard.writeText(this.rangeTSV()); } catch { this.host.status('복사 권한이 없어요. Ctrl+C를 눌러 주세요.'); return; }
      if (act === 'cut') this.clearRange();
    }
    if (act === 'paste') {
      try { this.paste(await navigator.clipboard.readText()); } catch { this.host.status('브라우저가 붙여넣기를 막았어요. 칸을 고르고 Ctrl+V를 눌러 주세요.'); }
    }
    if (act === 'rowAbove') this.insertRows(Math.max(0, r1), Math.max(1, r2 - Math.max(0, r1) + 1));
    if (act === 'rowBelow') this.insertRows(Math.min(this.rows.length, r2 + 1), Math.max(1, r2 - Math.max(0, r1) + 1));
    if (act === 'rowDel') this.deleteRows(r1, r2);
    if (act === 'colLeft') this.insertCols(c1, c2 - c1 + 1);
    if (act === 'colRight') this.insertCols(c2 + 1, c2 - c1 + 1);
    if (act === 'colDel') this.deleteCols(c1, c2);
    if (act === 'clear') this.clearRange();
    this.focus();
  }

  // ---------- 이벤트
  cellAt(ev) {
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    const t = el && el.closest('td.xl-cell');
    return t && this.table.contains(t) ? { r: Number(t.dataset.r), c: Number(t.dataset.c) } : null;
  }

  bind() {
    const input = this.input;
    // 마우스: 칸·줄 번호·항목 글자 누르기와 끌기
    this.table.addEventListener('mousedown', ev => {
      if (ev.button === 2) return; // 오른쪽 클릭은 contextmenu 에서
      this.closeMenu();
      const rs = ev.target.closest('[data-resize]');
      if (rs) { this.startResize(ev, Number(rs.dataset.resize)); return; }
      const td = ev.target.closest('td.xl-cell');
      const rh = ev.target.closest('th.xl-rowh[data-row]');
      const ch = ev.target.closest('th.xl-col');
      const all = ev.target.closest('[data-all]');
      if (!td && !rh && !ch && !all) return;
      ev.preventDefault();
      if (this.editing) this.commit();
      const last = this.cols.length - 1;
      if (all) { this.setSel({ r: -1, c: 0 }, { r: Math.max(0, this.rows.length - 1), c: last }); this.focus(); return; }
      if (td) {
        const p = { r: Number(td.dataset.r), c: Number(td.dataset.c) };
        if (ev.shiftKey) this.setSel(this.a, p); else this.setSel(p);
        this.dragSel = { kind: 'cell' };
      } else if (rh) {
        const r = Number(rh.dataset.row);
        if (ev.shiftKey) this.setSel({ r: this.a.r, c: 0 }, { r, c: last }); else this.setSel({ r, c: 0 }, { r, c: last });
        this.dragSel = { kind: 'row' };
      } else if (ch) {
        const c = Number(ch.dataset.col);
        const rEnd = Math.max(0, this.rows.length - 1);
        if (ev.shiftKey) this.setSel({ r: -1, c: this.a.c }, { r: rEnd, c }); else this.setSel({ r: -1, c }, { r: rEnd, c });
        this.dragSel = { kind: 'col' };
      }
      this.focus();
    });
    window.addEventListener('mousemove', ev => {
      if (this.fillDrag) { this.moveFill(ev); return; }
      if (!this.dragSel) return;
      const p = this.cellAt(ev);
      if (!p) return;
      const last = this.cols.length - 1;
      if (this.dragSel.kind === 'cell') { if (p.r !== this.f.r || p.c !== this.f.c) { this.f = p; this.paintSel(); } }
      else if (this.dragSel.kind === 'row') { this.f = { r: p.r, c: last }; this.paintSel(); }
      else if (this.dragSel.kind === 'col') { this.f = { r: this.f.r, c: p.c }; this.paintSel(); }
    });
    window.addEventListener('mouseup', ev => {
      if (this.fillDrag) { this.endFill(ev); return; }
      this.dragSel = null;
    });
    this.table.addEventListener('dblclick', ev => {
      // 열 경계 두 번 누르기: 내용에 맞춰 너비 되돌리기(엑셀처럼)
      const rz = ev.target.closest('[data-resize]');
      if (rz) { delete this.host.widths()[this.cols[Number(rz.dataset.resize)]]; this.render(); this.host.changed('widths'); return; }
      const td = ev.target.closest('td.xl-cell');
      if (!td) return;
      this.a = { r: Number(td.dataset.r), c: Number(td.dataset.c) }; this.f = { ...this.a };
      this.startEdit('edit', this.get(this.a.r, this.a.c));
    });
    this.fill.addEventListener('mousedown', ev => {
      ev.preventDefault(); ev.stopPropagation();
      if (this.editing) this.commit();
      this.fillDrag = { src: this.range(), dst: null };
    });
    this.table.addEventListener('contextmenu', ev => {
      const td = ev.target.closest('td.xl-cell, th.xl-rowh[data-row], th.xl-col');
      if (!td) return;
      ev.preventDefault();
      if (this.editing) this.commit();
      const { r1, r2, c1, c2 } = this.range();
      if (td.matches('td')) {
        const p = { r: Number(td.dataset.r), c: Number(td.dataset.c) };
        if (p.r < r1 || p.r > r2 || p.c < c1 || p.c > c2) this.setSel(p);
      } else if (td.matches('th.xl-rowh')) {
        const r = Number(td.dataset.row);
        if (r < r1 || r > r2) this.setSel({ r, c: 0 }, { r, c: this.cols.length - 1 });
      } else {
        const c = Number(td.dataset.col);
        if (c < c1 || c > c2) this.setSel({ r: -1, c }, { r: Math.max(0, this.rows.length - 1), c });
      }
      this.openMenu(ev.clientX, ev.clientY);
      this.focus();
    });
    this.menu.addEventListener('mousedown', ev => ev.preventDefault());
    this.menu.addEventListener('click', ev => { const b = ev.target.closest('[data-act]'); if (b && !b.disabled) this.menuAct(b.dataset.act); });
    document.addEventListener('mousedown', ev => { if (!this.menu.hidden && !this.menu.contains(ev.target)) this.closeMenu(); });

    // 글자 입력: 숨은 입력창에 글자가 들어오면 바로 고치기 시작(엑셀처럼 기존 값을 바꿈)
    input.addEventListener('compositionstart', () => { if (!this.editing) this.startEdit('enter'); });
    input.addEventListener('input', () => {
      if (!this.editing) this.startEdit('enter');
      this.growInput();
    });
    input.addEventListener('blur', () => { if (this.editing) this.commit(); });

    input.addEventListener('keydown', ev => {
      if (ev.isComposing || ev.keyCode === 229) return; // 한글 조합 중
      const mod = ev.ctrlKey || ev.metaKey;
      const key = ev.key;
      if (this.editing) {
        if (key === 'Enter' && ev.altKey) { ev.preventDefault(); input.setRangeText('\n', input.selectionStart, input.selectionEnd, 'end'); this.growInput(); return; }
        if (key === 'Enter' && mod) {
          // Ctrl+Enter: 고른 범위를 모두 같은 값으로
          ev.preventDefault();
          const v = input.value; const rg = this.range();
          this.editing = null; input.classList.remove('editing'); input.value = '';
          for (let r = Math.max(0, rg.r1); r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) this.set(r, c, v);
          this.render(); this.host.changed();
          return;
        }
        if (key === 'Enter') { ev.preventDefault(); this.commit(); this.move(ev.shiftKey ? -1 : 1, 0); return; }
        if (key === 'Tab') { ev.preventDefault(); this.commit(); this.move(0, ev.shiftKey ? -1 : 1); return; }
        if (key === 'Escape') { ev.preventDefault(); this.cancel(); return; }
        if (this.editing.mode === 'enter' && key.startsWith('Arrow')) {
          ev.preventDefault(); this.commit();
          this.move(key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0, key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0);
          return;
        }
        return;
      }
      // 칸 고르기 상태
      if (mod && (key === 'z' || key === 'Z')) { ev.preventDefault(); if (ev.shiftKey) this.host.redo(); else this.host.undo(); return; }
      if (mod && (key === 'y' || key === 'Y')) { ev.preventDefault(); this.host.redo(); return; }
      if (mod && (key === 'a' || key === 'A')) { ev.preventDefault(); this.setSel({ r: -1, c: 0 }, { r: Math.max(0, this.rows.length - 1), c: this.cols.length - 1 }); return; }
      if (mod && (key === 'c' || key === 'x' || key === 'v' || key === 'C' || key === 'X' || key === 'V')) return; // copy/cut/paste 이벤트로
      const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      if (arrows[key]) {
        ev.preventDefault();
        const [dr, dc] = arrows[key];
        if (mod) this.jump(dr, dc, ev.shiftKey); else this.move(dr, dc, ev.shiftKey);
        return;
      }
      if (key === 'Tab') { ev.preventDefault(); this.move(0, ev.shiftKey ? -1 : 1); return; }
      if (key === 'Enter') { ev.preventDefault(); this.move(ev.shiftKey ? -1 : 1, 0); return; }
      if (key === 'F2') { ev.preventDefault(); this.startEdit('edit', this.get(this.a.r, this.a.c)); return; }
      if (key === 'Delete' || key === 'Backspace') { ev.preventDefault(); this.clearRange(); return; }
      if (key === 'Home') { ev.preventDefault(); this.setSel({ r: mod ? 0 : this.a.r, c: 0 }); return; }
      if (key === 'End') { ev.preventDefault(); this.setSel({ r: mod ? Math.max(0, this.rows.length - 1) : this.a.r, c: this.cols.length - 1 }); return; }
      if (key === 'PageDown') { ev.preventDefault(); this.move(10, 0, ev.shiftKey); return; }
      if (key === 'PageUp') { ev.preventDefault(); this.move(-10, 0, ev.shiftKey); return; }
      if (key === 'Escape') { this.closeMenu(); return; }
    });

    input.addEventListener('copy', ev => {
      if (this.editing) return;
      ev.preventDefault();
      ev.clipboardData.setData('text/plain', this.rangeTSV());
      this.flash();
    });
    input.addEventListener('cut', ev => {
      if (this.editing) return;
      ev.preventDefault();
      ev.clipboardData.setData('text/plain', this.rangeTSV());
      this.clearRange();
    });
    input.addEventListener('paste', ev => {
      const text = ev.clipboardData.getData('text/plain');
      if (!text) return;
      // 고치는 중에 한 칸짜리 글을 붙이면 그냥 글자로
      if (this.editing && !/[\t\n]/.test(text.replace(/\r?\n$/, ''))) return;
      ev.preventDefault();
      if (this.editing) this.cancel();
      this.paste(text);
    });
    this.scroll.addEventListener('scroll', () => { if (this.editing) this.placeInput(); });
  }

  flash() {
    this.selbox.classList.remove('copied');
    void this.selbox.offsetWidth;
    this.selbox.classList.add('copied');
  }

  moveFill(ev) {
    const p = this.cellAt(ev);
    if (!p || p.r < 0) return;
    const s = this.fillDrag.src;
    let dst;
    const below = p.r > s.r2 ? p.r - s.r2 : p.r < s.r1 ? s.r1 - p.r : 0;
    const side = p.c > s.c2 ? p.c - s.c2 : p.c < s.c1 ? s.c1 - p.c : 0;
    if (!below && !side) dst = null;
    else if (below >= side) dst = { r1: Math.min(s.r1, p.r), r2: Math.max(s.r2, p.r), c1: s.c1, c2: s.c2 };
    else dst = { r1: s.r1, r2: s.r2, c1: Math.min(s.c1, p.c), c2: Math.max(s.c2, p.c) };
    this.fillDrag.dst = dst;
    if (!dst) { this.fillPrev.hidden = true; return; }
    const b = this.boxOf(dst.r1, dst.c1, dst.r2, dst.c2);
    if (b) { Object.assign(this.fillPrev.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` }); this.fillPrev.hidden = false; }
  }

  endFill(ev) {
    const { src, dst } = this.fillDrag;
    this.fillDrag = null;
    this.fillPrev.hidden = true;
    if (dst) this.doFill({ ...src, r1: Math.max(0, src.r1) }, dst, ev.ctrlKey || ev.metaKey);
    this.focus();
  }

  startResize(ev, c) {
    ev.preventDefault(); ev.stopPropagation();
    const col = this.table.querySelector(`col[data-col="${c}"]`);
    const w0 = col.getBoundingClientRect().width || parseFloat(col.style.width);
    const x0 = ev.clientX;
    const name = this.cols[c];
    const mv = e => { col.style.width = `${Math.max(36, Math.round(w0 + e.clientX - x0))}px`; this.fitTableWidth(); this.paintSel(false); };
    const up = () => {
      window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up);
      this.host.widths()[name] = parseFloat(col.style.width);
      this.host.changed('widths');
    };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  }
}
