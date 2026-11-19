-- 喫煙所花札: Supabase の表と権限。
-- Supabase の「SQL Editor」にこのファイルを全部貼り付けて「Run」を押す。何度実行しても大丈夫。

-- プロフィール(ニックネームとアイコン)
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
create policy "profiles update own" on public.profiles for update to authenticated using (auth.uid() = id);

-- 部屋(対局中の状態をまるごと state に持つ)
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[0-9]{6}$'),
  host_id uuid not null references auth.users on delete cascade,
  guest_id uuid references auth.users on delete set null,
  settings jsonb not null,
  state jsonb,
  version int not null default 0,
  status text not null default 'waiting' check (status in ('waiting', 'playing', 'finished', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists rooms_open_code on public.rooms (code) where status in ('waiting', 'playing');
alter table public.rooms enable row level security;
alter table public.rooms add column if not exists spectators uuid[] not null default '{}';
drop policy if exists "rooms read" on public.rooms;
create policy "rooms read" on public.rooms for select to authenticated
  using (auth.uid() in (host_id, guest_id) or auth.uid() = any(spectators));
drop policy if exists "rooms create" on public.rooms;
create policy "rooms create" on public.rooms for insert to authenticated with check (auth.uid() = host_id);
drop policy if exists "rooms update" on public.rooms;
create policy "rooms update" on public.rooms for update to authenticated using (auth.uid() in (host_id, guest_id));

-- 部屋コードで入る(コードを知っている人だけが入れるように関数経由にする)
create or replace function public.join_room(p_code text)
returns setof public.rooms
language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  select * into r from public.rooms where code = p_code and status in ('waiting', 'playing') limit 1;
  if not found then raise exception 'room not found'; end if;
  if r.host_id = auth.uid() or r.guest_id = auth.uid() then
    return next r; return; -- 入り直し
  end if;
  if r.guest_id is not null then raise exception 'この部屋はもう満員です'; end if;
  update public.rooms set guest_id = auth.uid(), version = version + 1, updated_at = now()
    where id = r.id returning * into r;
  return next r;
end $$;
grant execute on function public.join_room(text) to authenticated;

-- 観戦: 部屋コードで見るだけの人として入る(書き込みはできない)
create or replace function public.watch_room(p_code text)
returns setof public.rooms
language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  select * into r from public.rooms where code = p_code and status in ('waiting', 'playing') limit 1;
  if not found then raise exception 'room not found'; end if;
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
grant execute on function public.watch_room(text) to authenticated;

-- 観戦をやめる
create or replace function public.leave_watch(p_room uuid)
returns void
language sql security definer set search_path = public as $$
  update public.rooms set spectators = array_remove(spectators, auth.uid()) where id = p_room;
$$;
grant execute on function public.leave_watch(uuid) to authenticated;

-- 戦績(人との対戦だけ)
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
drop policy if exists "matches insert" on public.matches;
create policy "matches insert" on public.matches for insert to authenticated with check (auth.uid() in (player0, player1));

-- 部屋の変更をリアルタイムで受け取る
do $$ begin
  alter publication supabase_realtime add table public.rooms;
exception when duplicate_object then null; end $$;
