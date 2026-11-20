// 글꼴 서브셋: HarfBuzz(hb-subset) WASM으로 쓴 글자만 남긴 작은 TTF를 만든다.
// pdf-lib 자체 서브셋은 일부 한글 글꼴(고운바탕·나눔고딕 등)에서 글자가 빠지는 문제가 있어 대신 쓴다.

let hbPromise = null;
const tag = s => ((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) >>> 0;

/** wasmLoader: () => Promise<ArrayBuffer|Uint8Array> */
export function initSubsetter(wasmLoader) {
  if (!hbPromise) {
    hbPromise = wasmLoader().then(bytes => WebAssembly.instantiate(bytes)).then(r => r.instance.exports);
    hbPromise.catch(() => { hbPromise = null; });
  }
  return hbPromise;
}

/** fontBytes(TTF/OTF)에서 codepoints만 남긴 글꼴 바이트를 돌려준다 */
export async function subsetFont(wasmLoader, fontBytes, codepoints) {
  const hb = await initSubsetter(wasmLoader);
  const fontPtr = hb.malloc(fontBytes.byteLength);
  new Uint8Array(hb.memory.buffer).set(fontBytes, fontPtr);
  const blob = hb.hb_blob_create(fontPtr, fontBytes.byteLength, 2 /* WRITABLE */, 0, 0);
  const face = hb.hb_face_create(blob, 0);
  hb.hb_blob_destroy(blob);
  const input = hb.hb_subset_input_create_or_fail();
  const set = hb.hb_subset_input_unicode_set(input);
  for (const cp of codepoints) hb.hb_set_add(set, cp);
  // 글자 배치는 쎈스 어워드가 직접 하므로 모양 바꿈(GSUB·GPOS 등) 표는 뺀다.
  // 이 표가 남아 있으면 pdf-lib이 글자를 넣을 때 표를 잘못 읽어 실패한다.
  const drop = hb.hb_subset_input_set(input, 3 /* HB_SUBSET_SETS_DROP_TABLE_TAG */);
  for (const t of ['GSUB', 'GPOS', 'GDEF', 'kern', 'morx', 'BASE', 'JSTF', 'DSIG']) hb.hb_set_add(drop, tag(t));
  // 빈 글자(공백 등)는 넣지 않는다: fontkit이 표 끝의 빈 글자를 읽다 실패한다. 공백은 좌표로만 띄운다.
  const sub = hb.hb_subset_or_fail(face, input);
  hb.hb_subset_input_destroy(input);
  if (!sub) { hb.hb_face_destroy(face); hb.free(fontPtr); throw new Error('글꼴 서브셋 실패'); }
  const outBlob = hb.hb_face_reference_blob(sub);
  const ptr = hb.hb_blob_get_data(outBlob, 0);
  const len = hb.hb_blob_get_length(outBlob);
  // 메모리가 늘어났을 수 있으니 버퍼를 다시 잡아 복사
  const out = new Uint8Array(hb.memory.buffer, ptr, len).slice();
  hb.hb_blob_destroy(outBlob);
  hb.hb_face_destroy(sub);
  hb.hb_face_destroy(face);
  hb.free(fontPtr);
  return out;
}
