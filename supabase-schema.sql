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

alter publication supabase_realtime add table users;
alter publication supabase_realtime add table sessions;
alter publication supabase_realtime add table session_roster;
alter publication supabase_realtime add table matches;
