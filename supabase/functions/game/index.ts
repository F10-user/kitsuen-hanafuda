// 喫煙所花札のサーバー。対局中の操作はすべてここを通る。
//   1. ログインしている人か確かめる
//   2. その部屋のプレイヤーか確かめる
//   3. 本当の盤面(room_secrets)に操作を当てて、ルールに合うか確かめる
//   4. 本当の盤面・プレイヤーごとの盤面・観戦用の盤面をまとめて保存する
//
// lib/ の中身は js/ からコピーしたもの(GitHub Actions がデプロイ前にコピーする)。
import { createClient } from 'npm:@supabase/supabase-js@2.119.2';
import { applyAction, viewFor, effectsOf, isAction } from './lib/serverlogic.js';

const ALLOWED_ORIGINS = ['https://f10-user.github.io'];

function corsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';
  const ok = ALLOWED_ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

// サーバー用の鍵(ブラウザには絶対に出さない)。新しい鍵の形と古い形の両方に対応
function serverKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
    const k = keys.default || Object.values(keys)[0];
    if (k) return String(k);
  } catch (_e) { /* 古い形を使う */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
}

const admin = createClient(Deno.env.get('SUPABASE_URL')!, serverKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function handle(req: Request) {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) throw new HttpError(401, 'ログインしてください');
  const { data: auth, error: authError } = await admin.auth.getUser(jwt);
  if (authError || !auth?.user) throw new HttpError(401, 'ログインし直してください');
  const uid = auth.user.id;

  let body: { room?: string; type?: string; args?: Record<string, unknown> };
  try { body = await req.json(); } catch (_e) { throw new HttpError(400, '送られた内容が読めません'); }
  const roomId = String(body.room || '');
  const type = String(body.type || '');
  const args = body.args && typeof body.args === 'object' ? body.args : {};
  if (!UUID.test(roomId)) throw new HttpError(400, '部屋の指定が正しくありません');
  if (!isAction(type)) throw new HttpError(400, '知らない操作です');

  // ほかの操作と同時になったら、最新の盤面で数回やり直す
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: room, error: roomError } = await admin.from('rooms')
      .select('id, host_id, guest_id, settings, version, status').eq('id', roomId).maybeSingle();
    if (roomError) throw roomError;
    if (!room) throw new HttpError(404, 'その部屋は見つかりません');
    const p = uid === room.host_id ? 0 : uid === room.guest_id ? 1 : -1;
    if (p < 0) throw new HttpError(403, 'この部屋のプレイヤーではありません');

    const { data: secret, error: secretError } = await admin.from('room_secrets')
      .select('state').eq('room_id', roomId).maybeSingle();
    if (secretError) throw secretError;
    const full = secret ? secret.state : null;

    const ctx: Record<string, unknown> = {};
    if (type === 'start') {
      if (!room.guest_id) throw new HttpError(400, '相手がまだ入っていません');
      if (room.status !== 'waiting' && room.status !== 'playing') throw new HttpError(400, 'この部屋は閉じています');
      // 名前とアイコンはサーバーがプロフィールから取る(ブラウザから送られた名前は使わない)
      const { data: ps } = await admin.from('profiles').select('id, nickname, icon').in('id', [room.host_id, room.guest_id]);
      const byId = Object.fromEntries((ps || []).map((x) => [x.id, x]));
      ctx.settings = room.settings;
      ctx.names = [byId[room.host_id]?.nickname || 'ホスト', byId[room.guest_id]?.nickname || 'ゲスト'];
      ctx.icons = [byId[room.host_id]?.icon || 'tsuru', byId[room.guest_id]?.icon || 'ino'];
    }

    let next;
    try {
      next = applyAction(full, p, type, args, ctx);
    } catch (e) {
      // ルールに合わない操作(相手の番、手札にない札など)
      throw new HttpError(400, e instanceof Error ? e.message : String(e));
    }
    const fx = effectsOf(full, next);
    const { data: version, error: commitError } = await admin.rpc('game_commit', {
      p_room: roomId,
      p_version: room.version,
      p_full: next,
      p_view0: viewFor(next, 0),
      p_view1: viewFor(next, 1),
      p_public: viewFor(next, null),
      p_status: fx.status,
      p_match: fx.match,
    });
    if (commitError) throw commitError;
    if (version === null || version === undefined) continue; // 先に誰かが書いた
    return { view: viewFor(next, p), version };
  }
  throw new HttpError(409, '混み合っています。もう一度どうぞ');
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
  if (req.method !== 'POST') return reply(405, { error: 'POST だけ受け付けます' });
  try {
    return reply(200, await handle(req));
  } catch (e) {
    if (e instanceof HttpError) return reply(e.status, { error: e.message });
    console.error(e);
    return reply(500, { error: 'サーバーでエラーが起きました' });
  }
});
