// Supabase まわり: Googleログイン、プロフィール、部屋、リアルタイム同期、戦績。
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

let sb = null;

export async function initSupabase() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    const mod = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    sb = mod.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    return sb;
  } catch (e) {
    console.warn('Supabase を読み込めませんでした', e);
    return null;
  }
}

export const isOnlineReady = () => !!sb;

export async function currentUser() {
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session ? data.session.user : null;
}

export async function signInWithGoogle() {
  // ログイン後に同じページ(招待リンクの ?room= も含めて)へ戻ってくる
  const redirectTo = location.origin + location.pathname + location.search;
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
  if (error) throw error;
}

export async function signOut() {
  if (sb) await sb.auth.signOut();
}

export async function getProfile(uid) {
  const { data, error } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getProfiles(ids) {
  const { data, error } = await sb.from('profiles').select('*').in('id', ids);
  if (error) throw error;
  return Object.fromEntries(data.map((p) => [p.id, p]));
}

export async function saveProfile(uid, nickname, icon) {
  const { data, error } = await sb.from('profiles').upsert({ id: uid, nickname, icon }).select().single();
  if (error) throw error;
  return data;
}

function randomCode() {
  return String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
}

export async function createRoom(uid, settings) {
  for (let i = 0; i < 8; i += 1) {
    const code = randomCode();
    const { data, error } = await sb.from('rooms')
      .insert({ code, host_id: uid, settings, status: 'waiting' })
      .select().single();
    if (!error) return data;
    if (error.code !== '23505') throw error; // 23505 = コードがかぶった
  }
  throw new Error('部屋を作れませんでした。もう一度試してください');
}

export async function joinRoom(code) {
  const { data, error } = await sb.rpc('join_room', { p_code: code });
  if (error) throw new Error(error.message.includes('not found') ? 'その部屋は見つかりません' : error.message);
  return Array.isArray(data) ? data[0] : data;
}

export async function getRoom(id) {
  const { data, error } = await sb.from('rooms').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

// 自分が参加していて、まだ終わっていない部屋
export async function findActiveRoom(uid) {
  const { data, error } = await sb.from('rooms').select('*')
    .or(`host_id.eq.${uid},guest_id.eq.${uid}`)
    .in('status', ['waiting', 'playing'])
    .order('updated_at', { ascending: false })
    .limit(1);
  if (error) return null;
  return data[0] || null;
}

// 状態の書き込み。version が一致したときだけ書く(同時に書いても壊れないように)
export async function writeState(room, state, extra = {}) {
  const { data, error } = await sb.from('rooms')
    .update({ state, version: room.version + 1, updated_at: new Date().toISOString(), ...extra })
    .eq('id', room.id)
    .eq('version', room.version)
    .select();
  if (error) throw error;
  return data && data[0] ? data[0] : null; // null なら誰かが先に書いた
}

export async function closeRoom(room) {
  await sb.from('rooms').update({ status: 'closed' }).eq('id', room.id);
}

export function subscribeRoom(id, onChange) {
  const ch = sb.channel('room-' + id)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${id}` },
      (payload) => onChange(payload.new))
    .subscribe();
  return () => sb.removeChannel(ch);
}

export async function saveMatch(room, state, playerIds) {
  const row = {
    room_id: state.gameId || room.id, // 再戦しても対局ごとに1件ずつ残る
    player0: playerIds[0],
    player1: playerIds[1],
    names: state.names,
    months: state.settings.months,
    scores: state.scores,
    history: state.history,
  };
  const { error } = await sb.from('matches').insert(row);
  if (error && error.code !== '23505') throw error; // 二重保存は無視
}

export async function listMatches() {
  const { data, error } = await sb.from('matches').select('*').order('finished_at', { ascending: false }).limit(200);
  if (error) throw error;
  return data;
}
