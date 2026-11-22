// Supabase まわり: Googleログイン、プロフィール、部屋、リアルタイム同期、戦績。
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=20261122-2024';

let sb = null;

export async function initSupabase() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    // 版を固定する(知らないうちに中身が変わらないように)
    const mod = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/+esm');
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

// 部屋はサーバーの関数で作る(コードもサーバーが決める)
export async function createRoom(uid, settings) {
  const { data, error } = await sb.rpc('create_room', { p_settings: settings });
  if (error) throw new Error(error.message);
  const room = Array.isArray(data) ? data[0] : data;
  if (!room) throw new Error('部屋を作れませんでした。もう一度試してください');
  return room;
}

// 見つからないときは空で返ってくる
function firstRoom(data) {
  const room = Array.isArray(data) ? data[0] : data;
  if (!room) throw new Error('その部屋は見つかりません');
  return room;
}

export async function joinRoom(code) {
  const { data, error } = await sb.rpc('join_room', { p_code: code });
  if (error) throw new Error(error.message);
  return firstRoom(data);
}

// 観戦として入る(見るだけ)
export async function watchRoom(code) {
  const { data, error } = await sb.rpc('watch_room', { p_code: code });
  if (error) {
    if (error.message.includes('watch_room')) throw new Error('観戦の準備がまだです(Supabaseで schema.sql をもう一度実行してください)');
    throw new Error(error.message);
  }
  return firstRoom(data);
}

export async function leaveWatch(roomId) {
  await sb.rpc('leave_watch', { p_room: roomId });
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

// 自分の盤面(自分の手札だけ見える)。対局が始まる前は null
export async function getMyView(roomId, uid) {
  const { data, error } = await sb.from('room_views').select('state')
    .eq('room_id', roomId).eq('player_id', uid).maybeSingle();
  if (error) throw error;
  return data ? data.state : null;
}

// 対局中の操作をサーバーに送る。サーバーがルールどおりか確かめて、新しい盤面を返す。
//   type … 'start' 'deal' 'play' 'draw' 'choose' 'decide' 'ready' 'quit' 'answerQuit' 'rematch' 'leave'
export async function gameAction(roomId, type, args = {}) {
  const { data } = await sb.auth.getSession();
  const token = data.session && data.session.access_token;
  if (!token) throw new Error('ログインし直してください');
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/game`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ room: roomId, type, args }),
    });
  } catch (e) {
    throw new Error('通信できませんでした');
  }
  let body = null;
  try { body = await res.json(); } catch (e) { /* 中身なし */ }
  if (res.status === 404 && !body) throw new Error('サーバーの準備がまだです(READMEの「サーバーの処理を更新する」を動かしてください)');
  if (!res.ok || !body || body.error) throw new Error((body && body.error) || `通信できませんでした(${res.status})`);
  return body; // { view, version }
}

// 相手待ちの部屋を閉じる
export async function closeRoom(room) {
  await sb.rpc('close_room', { p_room: room.id });
}

// 部屋の変更をリアルタイムで受け取る
//   onRoom … 部屋の情報(相手が入った、観戦の人数、観戦用の盤面)
//   onView … 自分の盤面(プレイヤーだけ。観戦者には届かない)
export function subscribeRoom(id, onRoom, onView) {
  let ch = sb.channel('room-' + id)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${id}` },
      (payload) => onRoom(payload.new));
  if (onView) {
    ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: 'room_views', filter: `room_id=eq.${id}` },
      (payload) => { if (payload.new && payload.new.state) onView(payload.new.state); });
  }
  ch.subscribe();
  return () => sb.removeChannel(ch);
}

export async function listMatches() {
  const { data, error } = await sb.from('matches').select('*').order('finished_at', { ascending: false }).limit(200);
  if (error) throw error;
  return data;
}
