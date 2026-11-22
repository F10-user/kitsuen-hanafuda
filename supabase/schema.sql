-- 喫煙所花札: Supabase の表と権限。
-- GitHub の Actions「サーバーの処理を更新する」を動かすと自動で実行される。
-- 手で入れるときは、Supabase の「SQL Editor」にこのファイルを全部貼り付けて「Run」を押す。何度実行しても大丈夫。
--
-- 守り方の考え方
--   ・ブラウザからは「読む」ことしかできない。盤面を変えるのはサーバー(Edge Function「game」)だけ。
--   ・本当の盤面(両者の手札と山札)は room_secrets に置き、誰にも見せない。
--   ・プレイヤーには room_views から「自分の手札だけ見える盤面」を渡す。
--   ・rooms.state は観戦用(両方の手札と山札が伏せてある)。
--   ・戦績もサーバーが対局の結果から書く。ブラウザからは書けない。

-- ---------------------------------------------------------------- プロフィール(ニックネームとアイコン)
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 10),
  icon text not null default 'tsuru' check (icon in ('ino', 'shika', 'cho', 'tsuru')),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated using (true);
drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own" on public.profiles for insert to authenticated with check (auth.uid() = id);
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
revoke all on public.profiles from anon;
revoke delete, truncate on public.profiles from authenticated;

-- ---------------------------------------------------------------- 部屋
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[0-9]{6}$'),
  host_id uuid not null references auth.users on delete cascade,
  guest_id uuid references auth.users on delete set null,
  settings jsonb not null,
  state jsonb, -- 観戦用の盤面(手札と山札は伏せてある)
  version int not null default 0,
  status text not null default 'waiting' check (status in ('waiting', 'playing', 'finished', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists rooms_open_code on public.rooms (code) where status in ('waiting', 'playing');
alter table public.rooms add column if not exists spectators uuid[] not null default '{}';
alter table public.rooms enable row level security;
drop policy if exists "rooms read" on public.rooms;
create policy "rooms read" on public.rooms for select to authenticated
  using (auth.uid() in (host_id, guest_id) or auth.uid() = any(spectators));
-- 作るのも書き換えるのも関数とサーバーだけ
drop policy if exists "rooms create" on public.rooms;
drop policy if exists "rooms update" on public.rooms;
revoke all on public.rooms from anon;
revoke insert, update, delete, truncate on public.rooms from authenticated;

-- 本当の盤面。誰も読めない(サーバーだけが使う)
create table if not exists public.room_secrets (
  room_id uuid primary key references public.rooms on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.room_secrets enable row level security;
revoke all on public.room_secrets from anon, authenticated;

-- プレイヤーごとの盤面(自分の手札だけ見える)。自分の行しか読めない
create table if not exists public.room_views (
  room_id uuid not null references public.rooms on delete cascade,
  player_id uuid not null references auth.users on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (room_id, player_id)
);
alter table public.room_views enable row level security;
drop policy if exists "views read own" on public.room_views;
create policy "views read own" on public.room_views for select to authenticated using (auth.uid() = player_id);
revoke all on public.room_views from anon;
revoke insert, update, delete, truncate on public.room_views from authenticated;

-- 前のしくみで作られた部屋(手札がそのまま入っている)は閉じて、中身を消す
update public.rooms
  set state = null, status = case when status in ('waiting', 'playing') then 'closed' else status end
  where state is not null and id not in (select room_id from public.room_secrets);

-- ---------------------------------------------------------------- 部屋コードの総当たり対策
-- 見つからないコードを10分に10回入れたら、しばらく入れなくする
create table if not exists public.code_attempts (
  user_id uuid not null references auth.users on delete cascade,
  at timestamptz not null default now()
);
create index if not exists code_attempts_user_at on public.code_attempts (user_id, at);
alter table public.code_attempts enable row level security;
revoke all on public.code_attempts from anon, authenticated;

create or replace function public.check_code_attempts()
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'ログインしてください'; end if;
  delete from public.code_attempts where at < now() - interval '1 hour';
  if (select count(*) from public.code_attempts
      where user_id = auth.uid() and at > now() - interval '10 minutes') >= 10 then
    raise exception '部屋コードの間違いが多すぎます。10分ほど待ってからもう一度どうぞ';
  end if;
end $$;
revoke all on function public.check_code_attempts() from public, anon, authenticated;

-- ---------------------------------------------------------------- 部屋を作る
-- コードはサーバーで作る。前に作った「相手待ち」の部屋は閉じる(1人1部屋)
create or replace function public.create_room(p_settings jsonb)
returns setof public.rooms
language plpgsql security definer set search_path = public as $$
declare
  r public.rooms;
  v_months int;
  v_settings jsonb;
  v_code text;
begin
  if auth.uid() is null then raise exception 'ログインしてください'; end if;
  begin
    v_months := coalesce((p_settings->>'months')::int, 12);
  exception when others then
    raise exception '対局の長さが正しくありません';
  end;
  if v_months not in (1, 3, 6, 12) then raise exception '対局の長さが正しくありません'; end if;
  v_settings := jsonb_build_object(
    'months', v_months,
    'sakeRule', p_settings->'sakeRule' is distinct from 'false'::jsonb,
    'guide', p_settings->'guide' is distinct from 'false'::jsonb
  );
  update public.rooms set status = 'closed' where host_id = auth.uid() and status = 'waiting';
  for i in 1..30 loop
    -- gen_random_uuid は予測できない乱数でできているので、そこから6桁を取る
    v_code := lpad(((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint) % 1000000)::text, 6, '0');
    begin
      insert into public.rooms (code, host_id, settings, status)
        values (v_code, auth.uid(), v_settings, 'waiting') returning * into r;
      return next r;
      return;
    exception when unique_violation then
      null; -- コードがかぶったら作り直す
    end;
  end loop;
  raise exception '部屋を作れませんでした。もう一度試してください';
end $$;
revoke all on function public.create_room(jsonb) from public, anon;
grant execute on function public.create_room(jsonb) to authenticated;

-- 相手待ちの部屋を閉じる(部屋を作った人だけ)
create or replace function public.close_room(p_room uuid)
returns void
language sql security definer set search_path = public as $$
  update public.rooms set status = 'closed'
    where id = p_room and host_id = auth.uid() and status = 'waiting';
$$;
revoke all on function public.close_room(uuid) from public, anon;
grant execute on function public.close_room(uuid) to authenticated;

-- ---------------------------------------------------------------- 部屋コードで入る
-- 見つからないときはエラーにせず空で返す(間違えた回数を記録するため)
create or replace function public.join_room(p_code text)
returns setof public.rooms
language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  perform public.check_code_attempts();
  select * into r from public.rooms
    where code = p_code and status in ('waiting', 'playing') limit 1 for update;
  if not found then
    insert into public.code_attempts (user_id) values (auth.uid());
    return;
  end if;
  if r.host_id = auth.uid() or r.guest_id = auth.uid() then
    return next r; return; -- 入り直し
  end if;
  if r.guest_id is not null then raise exception 'この部屋はもう満員です'; end if;
  update public.rooms set guest_id = auth.uid(), version = version + 1, updated_at = now()
    where id = r.id returning * into r;
  return next r;
end $$;
revoke all on function public.join_room(text) from public, anon;
grant execute on function public.join_room(text) to authenticated;

-- 観戦: 部屋コードで見るだけの人として入る(見えるのは伏せた盤面だけ)
create or replace function public.watch_room(p_code text)
returns setof public.rooms
language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  perform public.check_code_attempts();
  select * into r from public.rooms
    where code = p_code and status in ('waiting', 'playing') limit 1 for update;
  if not found then
    insert into public.code_attempts (user_id) values (auth.uid());
    return;
  end if;
  if r.host_id = auth.uid() or r.guest_id = auth.uid() then
    raise exception '自分の部屋は観戦できません';
  end if;
  if not (auth.uid() = any(r.spectators)) then
    if cardinality(r.spectators) >= 20 then raise exception '観戦の人数がいっぱいです'; end if;
    -- version は上げない(対局中の書き込みとぶつからないように)
    update public.rooms set spectators = array_append(spectators, auth.uid())
      where id = r.id returning * into r;
  end if;
  return next r;
end $$;
revoke all on function public.watch_room(text) from public, anon;
grant execute on function public.watch_room(text) to authenticated;

-- 観戦をやめる
create or replace function public.leave_watch(p_room uuid)
returns void
language sql security definer set search_path = public as $$
  update public.rooms set spectators = array_remove(spectators, auth.uid()) where id = p_room;
$$;
revoke all on function public.leave_watch(uuid) from public, anon;
grant execute on function public.leave_watch(uuid) to authenticated;

-- ---------------------------------------------------------------- 戦績(人との対戦だけ)
create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  room_id uuid unique,
  player0 uuid not null references auth.users on delete cascade,
  player1 uuid not null references auth.users on delete cascade,
  names jsonb not null,
  months int not null,
  scores int[] not null,
  history jsonb not null,
  finished_at timestamptz not null default now()
);
alter table public.matches enable row level security;
drop policy if exists "matches read" on public.matches;
create policy "matches read" on public.matches for select to authenticated using (auth.uid() in (player0, player1));
-- ブラウザからは書けない。サーバーが対局の結果から書く
drop policy if exists "matches insert" on public.matches;
revoke all on public.matches from anon;
revoke insert, update, delete, truncate on public.matches from authenticated;

-- ---------------------------------------------------------------- サーバー(Edge Function)専用
-- 盤面の更新をまとめて書く。version が合わなければ何もせず null を返す(同時に動いたとき用)
create or replace function public.game_commit(
  p_room uuid, p_version int,
  p_full jsonb, p_view0 jsonb, p_view1 jsonb, p_public jsonb,
  p_status text, p_match jsonb
)
returns int
language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  update public.rooms set state = p_public, version = version + 1, updated_at = now()
    where id = p_room and version = p_version returning * into r;
  if not found then return null; end if;
  insert into public.room_secrets (room_id, state, updated_at) values (p_room, p_full, now())
    on conflict (room_id) do update set state = excluded.state, updated_at = now();
  insert into public.room_views (room_id, player_id, state, updated_at) values (p_room, r.host_id, p_view0, now())
    on conflict (room_id, player_id) do update set state = excluded.state, updated_at = now();
  insert into public.room_views (room_id, player_id, state, updated_at) values (p_room, r.guest_id, p_view1, now())
    on conflict (room_id, player_id) do update set state = excluded.state, updated_at = now();
  if p_status is not null and p_status <> r.status then
    begin
      update public.rooms set status = p_status where id = p_room;
    exception when unique_violation then
      null; -- 再戦のとき、同じコードの別の部屋が開いていたら状態はそのまま
    end;
  end if;
  if p_match is not null then
    insert into public.matches (room_id, player0, player1, names, months, scores, history)
      values (
        (p_match->>'room_id')::uuid, r.host_id, r.guest_id, p_match->'names',
        (p_match->>'months')::int,
        array(select (jsonb_array_elements_text(p_match->'scores'))::int),
        p_match->'history'
      )
      on conflict (room_id) do nothing;
  end if;
  return r.version;
end $$;
revoke all on function public.game_commit(uuid, int, jsonb, jsonb, jsonb, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.game_commit(uuid, int, jsonb, jsonb, jsonb, jsonb, text, jsonb) to service_role;

-- ---------------------------------------------------------------- リアルタイム
-- rooms(観戦用の盤面・相手が入ったか)と room_views(自分の盤面)の変更を受け取る
do $$ begin
  alter publication supabase_realtime add table public.rooms;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.room_views;
exception when duplicate_object then null; end $$;
