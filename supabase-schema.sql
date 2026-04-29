create table if not exists users (
  id text primary key,
  name text not null unique,
  role text not null check (role in ('Admin', 'Player')),
  type text not null check (type in ('Regular', 'Temp'))
);

create table if not exists sessions (
  id text primary key,
  slug text not null,
  date text not null,
  court_price integer not null,
  shuttle_price integer not null,
  shuttles_per_tube integer not null,
  match_duration integer not null,
  total_court_time integer not null,
  fee_per_person integer not null,
  status text not null check (status in ('Active', 'Closed')),
  created_at timestamptz not null,
  ended_at timestamptz
);

create table if not exists session_roster (
  session_id text not null references sessions(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  paid boolean not null default false,
  primary key (session_id, user_id)
);

create table if not exists matches (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  created_at timestamptz not null,
  player_a_id text not null references users(id),
  player_b_id text not null references users(id),
  score text,
  status text not null check (status in ('Valid'))
);

alter table users enable row level security;
alter table sessions enable row level security;
alter table session_roster enable row level security;
alter table matches enable row level security;

drop policy if exists "Public read users" on users;
drop policy if exists "Public insert users" on users;
drop policy if exists "Public update users" on users;
drop policy if exists "Public delete users" on users;
create policy "Public read users" on users for select using (true);
create policy "Public insert users" on users for insert with check (true);
create policy "Public update users" on users for update using (true) with check (true);
create policy "Public delete users" on users for delete using (true);

drop policy if exists "Public read sessions" on sessions;
drop policy if exists "Public insert sessions" on sessions;
drop policy if exists "Public update sessions" on sessions;
drop policy if exists "Public delete sessions" on sessions;
create policy "Public read sessions" on sessions for select using (true);
create policy "Public insert sessions" on sessions for insert with check (true);
create policy "Public update sessions" on sessions for update using (true) with check (true);
create policy "Public delete sessions" on sessions for delete using (true);

drop policy if exists "Public read session roster" on session_roster;
drop policy if exists "Public insert session roster" on session_roster;
drop policy if exists "Public update session roster" on session_roster;
drop policy if exists "Public delete session roster" on session_roster;
create policy "Public read session roster" on session_roster for select using (true);
create policy "Public insert session roster" on session_roster for insert with check (true);
create policy "Public update session roster" on session_roster for update using (true) with check (true);
create policy "Public delete session roster" on session_roster for delete using (true);

drop policy if exists "Public read matches" on matches;
drop policy if exists "Public insert matches" on matches;
drop policy if exists "Public update matches" on matches;
drop policy if exists "Public delete matches" on matches;
create policy "Public read matches" on matches for select using (true);
create policy "Public insert matches" on matches for insert with check (true);
create policy "Public update matches" on matches for update using (true) with check (true);
create policy "Public delete matches" on matches for delete using (true);

alter publication supabase_realtime add table users;
alter publication supabase_realtime add table sessions;
alter publication supabase_realtime add table session_roster;
alter publication supabase_realtime add table matches;
