// WSNS 계정 로그인(Supabase Auth)과 이용 등급
// - 계정은 wsns.studio와 같은 WSNS 계정(이메일 + 비밀번호). 가입·비밀번호 찾기는 wsns.studio에서 한다(약관 동의를 한 곳에서 받음).
// - 브라우저에는 공개 키(publishable)만 둔다. 데이터 보호는 DB의 RLS가 맡는다.
// - 등급: 비로그인(guest) / 로그인(member, 무료). 기능 잠금은 화면 편의용이며 서버 결제 기능이 아니다.

const SB_URL = 'https://cqqhvxrgugomyekbpwqp.supabase.co';
const SB_KEY = 'sb_publishable_mzKE-7e3MvLXinAVZl5dLg_Wg7nAipP';
const TOKEN_KEY = 'sb-cqqhvxrgugomyekbpwqp-auth-token';

export const WSNS_LINKS = {
  signup: 'https://wsns.studio/signup/',
  forgot: 'https://wsns.studio/forgot-password/',
  account: 'https://wsns.studio/account/',
};

// 비로그인 한도
export const GUEST_LIMITS = { sheets: 30, projects: 3 };

// 로그인해야 열리는 기능(무료). key → 잠겼을 때 안내 문구
export const MEMBER_FEATURES = {
  'tpl:us': '미국식 증서 양식',
  'tpl:custom': '그림·PDF 메일머지',
  'tpl:doc': '한글·워드 문서 메일머지',
  hwpx: '한글(HWPX) 내려받기',
  png: '그림(PNG) 묶음 내려받기',
  bgremove: '도장·마크 배경 지우기',
  sheets: `한 번에 ${GUEST_LIMITS.sheets}장 넘게 내보내기`,
  projects: `프로젝트 ${GUEST_LIMITS.projects}개 넘게 만들기`,
};

// 플랜 비교표(로그인 창·처음 화면에서 함께 쓴다)
export const PLAN_ROWS = [
  ['한국 상장 양식 · 견본 배치 · 도장 넣기', true, true],
  ['엑셀 붙여넣기 명단 · 글자 자동 맞춤', true, true],
  ['PDF 내려받기 · 바로 인쇄 · 일부만 내보내기', true, true],
  ['한 번에 내보내는 장수', `${GUEST_LIMITS.sheets}장까지`, '제한 없음'],
  ['프로젝트(이 기기에 저장)', `${GUEST_LIMITS.projects}개까지`, '제한 없음'],
  ['미국식 증서 양식', false, true],
  ['그림·PDF 메일머지(초대장·이름표·카드)', false, true],
  ['한글·워드 문서 메일머지', false, true],
  ['한글(HWPX) · 그림(PNG) 묶음 내려받기', false, true],
  ['도장·마크 배경 지우기(JPG 도장도 깔끔하게)', false, true],
];

let sb = null;
let user = provisionalUser();
let profileName = '';
const listeners = new Set();

// 저장된 세션이 있으면 라이브러리를 읽기 전에도 로그인 상태로 그린다(잠금 표시가 깜박이지 않게)
function provisionalUser() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw);
    return t && t.user ? t.user : null;
  } catch { return null; }
}

function emit() { for (const fn of listeners) { try { fn(currentUser()); } catch (e) { console.error(e); } } }

export function onAuthChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function currentUser() {
  if (!user) return null;
  const meta = user.user_metadata || {};
  const name = profileName || meta.name || meta.full_name || (user.email || '').split('@')[0];
  return { id: user.id, email: user.email || '', name };
}

export const isMember = () => !!user;
export function can(feature) { return isMember() || !(feature in MEMBER_FEATURES); }

async function client() {
  if (sb) return sb;
  const { createClient } = await import('../vendor/supabase.mjs');
  sb = createClient(SB_URL, SB_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: TOKEN_KEY },
  });
  sb.auth.onAuthStateChange((_ev, session) => {
    const next = session ? session.user : null;
    const changed = (next && next.id) !== (user && user.id);
    user = next;
    if (!user) profileName = '';
    if (changed) { emit(); if (user) loadProfile(); }
  });
  return sb;
}

async function loadProfile() {
  if (!user || !sb) return;
  try {
    const { data } = await sb.from('profiles').select('name').eq('id', user.id).maybeSingle();
    if (data && data.name && data.name !== profileName) { profileName = data.name; emit(); }
  } catch { /* 회원 정보가 없어도 로그인은 그대로 */ }
}

// 앱 시작: 저장된 세션이 있을 때만 라이브러리를 읽어 확인(없으면 아무것도 내려받지 않음)
export async function initAuth() {
  if (!provisionalUser()) return null;
  try {
    const c = await client();
    const { data } = await c.auth.getSession();
    const had = !!user;
    user = data.session ? data.session.user : null;
    if (had !== !!user) emit();
    if (user) loadProfile();
  } catch (e) {
    console.warn('로그인 상태 확인 실패', e);
  }
  return currentUser();
}

export function authErrorText(err) {
  const m = String((err && err.message) || err || '');
  if (/invalid login credentials/i.test(m)) return '이메일이나 비밀번호가 맞지 않아요.';
  if (/email not confirmed/i.test(m)) return '가입 인증 메일의 링크를 먼저 눌러 주세요. 메일이 안 보이면 스팸함도 확인해 주세요.';
  if (/rate limit|too many/i.test(m)) return '잠시 뒤에 다시 시도해 주세요.';
  if (/failed to fetch|network/i.test(m)) return '인터넷 연결을 확인해 주세요.';
  return `로그인하지 못했어요. (${m})`;
}

export async function signIn(email, password) {
  const c = await client();
  const { data, error } = await c.auth.signInWithPassword({ email: String(email).trim(), password });
  if (error) throw error;
  user = data.user;
  emit();
  loadProfile();
  return currentUser();
}

export async function signOut() {
  try { const c = await client(); await c.auth.signOut(); } catch { /* 이미 끊긴 세션 */ }
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
  user = null; profileName = '';
  emit();
}
