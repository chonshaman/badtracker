create table if not exists users (
  id text primary key,
  name text not null unique,
  role text not null check (role in ('Admin', 'Player')),
  type text not null check (type in ('Regular', 'Temp'))
);

create table if not exists sessions (
  id text primary key,
  slug text not null,
  host_user_id uuid default auth.uid() references auth.users(id) on delete set null,
  name text,
  pin_code text,
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

alter table sessions add column if not exists host_user_id uuid default auth.uid() references auth.users(id) on delete set null;
alter table sessions add column if not exists name text;
alter table sessions add column if not exists pin_code text;

create table if not exists session_roster (
  session_id text not null references sessions(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  paid boolean not null default false,
  is_present boolean not null default true,
  is_host boolean not null default false,
  primary key (session_id, user_id)
);

alter table session_roster add column if not exists is_present boolean not null default true;
alter table session_roster add column if not exists is_host boolean not null default false;

create table if not exists session_participants (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('host', 'player')),
  is_present boolean not null default true,
  joined_at timestamptz not null default now(),
  unique (session_id, user_id)
);

alter table session_participants add column if not exists is_present boolean not null default true;

create table if not exists matches (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  created_at timestamptz not null,
  player_a_id text not null references users(id),
  player_b_id text not null references users(id),
  is_stake boolean not null default false,
  winner_id text references users(id),
  score text,
  status text not null check (status in ('Valid')),
  constraint stake_winner_required check ((not is_stake) or winner_id is not null),
  constraint stake_winner_must_be_player check (
    winner_id is null or winner_id = player_a_id or winner_id = player_b_id
  )
);

alter table matches add column if not exists is_stake boolean not null default false;
alter table matches add column if not exists winner_id text references users(id);

alter table users enable row level security;
alter table sessions enable row level security;
alter table session_roster enable row level security;
alter table session_participants enable row level security;
alter table matches enable row level security;

drop policy if exists "Public read users" on users;
drop policy if exists "Public insert users" on users;
drop policy if exists "Public update users" on users;
drop policy if exists "Public delete users" on users;
drop policy if exists "Authenticated can update users" on users;
drop policy if exists "Authenticated can delete users" on users;
create policy "Public read users" on users for select using (true);
create policy "Public insert users" on users for insert with check (true);

drop policy if exists "Public read sessions" on sessions;
drop policy if exists "Public insert sessions" on sessions;
drop policy if exists "Public update sessions" on sessions;
drop policy if exists "Public delete sessions" on sessions;
drop policy if exists "Users can view sessions they are part of" on sessions;
drop policy if exists "Authenticated users can create sessions" on sessions;
drop policy if exists "Hosts can update their sessions" on sessions;
drop policy if exists "Hosts can delete their sessions" on sessions;
create policy "Users can view sessions they are part of" on sessions for select using (
  host_user_id = auth.uid()
  or exists (
    select 1
    from session_participants
    where session_participants.session_id = sessions.id
      and session_participants.user_id = auth.uid()
  )
);
create policy "Authenticated users can create sessions" on sessions for insert with check (host_user_id = auth.uid());
create policy "Hosts can update their sessions" on sessions for update using (
  host_user_id = auth.uid()
  or exists (
    select 1
    from session_participants
    where session_participants.session_id = sessions.id
      and session_participants.user_id = auth.uid()
      and session_participants.role = 'host'
  )
) with check (
  host_user_id = auth.uid()
  or exists (
    select 1
    from session_participants
    where session_participants.session_id = sessions.id
      and session_participants.user_id = auth.uid()
      and session_participants.role = 'host'
  )
);
create policy "Hosts can delete their sessions" on sessions for delete using (
  host_user_id = auth.uid()
  or exists (
    select 1
    from session_participants
    where session_participants.session_id = sessions.id
      and session_participants.user_id = auth.uid()
      and session_participants.role = 'host'
  )
);

drop policy if exists "Users can view their own participation" on session_participants;
drop policy if exists "Users can join sessions as themselves" on session_participants;
drop policy if exists "Hosts can register their own participation" on session_participants;
drop policy if exists "Users can update their own participation" on session_participants;
drop policy if exists "Users can leave their own participation" on session_participants;
create policy "Users can view their own participation" on session_participants for select using (user_id = auth.uid());
create policy "Hosts can register their own participation" on session_participants for insert with check (
  user_id = auth.uid()
  and role = 'host'
  and exists (
    select 1
    from sessions
    where sessions.id = session_participants.session_id
      and sessions.host_user_id = auth.uid()
  )
);
create policy "Users can update their own participation" on session_participants for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users can leave their own participation" on session_participants for delete using (user_id = auth.uid());

create or replace function verify_session_pin(p_session_id text, p_input_pin text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    return false;
  end if;

  if not exists (
    select 1
    from sessions
    where id = p_session_id
      and status = 'Active'
      and pin_code = p_input_pin
  ) then
    return false;
  end if;

  insert into session_participants (session_id, user_id, role)
  values (p_session_id, current_user_id, 'player')
  on conflict (session_id, user_id) do nothing;

  return true;
end;
$$;

grant execute on function verify_session_pin(text, text) to anon, authenticated;

create or replace function session_link_status(p_session_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from sessions
    where id = p_session_id
      and status = 'Active'
  ) then
    return 'active';
  end if;

  if exists (
    select 1
    from sessions
    where id = p_session_id
  ) then
    return 'closed';
  end if;

  return 'missing';
end;
$$;

grant execute on function session_link_status(text) to anon, authenticated;

drop policy if exists "Public read session roster" on session_roster;
drop policy if exists "Public insert session roster" on session_roster;
drop policy if exists "Public update session roster" on session_roster;
drop policy if exists "Public delete session roster" on session_roster;
drop policy if exists "Participants can read session roster" on session_roster;
drop policy if exists "Participants can insert session roster" on session_roster;
drop policy if exists "Participants can update session roster" on session_roster;
drop policy if exists "Participants can delete session roster" on session_roster;
drop policy if exists "Hosts can update session roster" on session_roster;
drop policy if exists "Hosts can delete session roster" on session_roster;
create policy "Participants can read session roster" on session_roster for select using (
  exists (
    select 1
    from session_participants
    where session_participants.session_id = session_roster.session_id
      and session_participants.user_id = auth.uid()
  )
);
create policy "Participants can insert session roster" on session_roster for insert with check (
  exists (
    select 1
    from session_participants
    where session_participants.session_id = session_roster.session_id
      and session_participants.user_id = auth.uid()
  )
);
create policy "Hosts can update session roster" on session_roster for update using (
  exists (
    select 1
    from session_participants
    where session_participants.session_id = session_roster.session_id
      and session_participants.user_id = auth.uid()
      and session_participants.role = 'host'
  )
) with check (
  exists (
    select 1
    from session_participants
    where session_participants.session_id = session_roster.session_id
      and session_participants.user_id = auth.uid()
      and session_participants.role = 'host'
  )
);
create policy "Hosts can delete session roster" on session_roster for delete using (
  exists (
    select 1
    from session_participants
    where session_participants.session_id = session_roster.session_id
      and session_participants.user_id = auth.uid()
      and session_participants.role = 'host'
  )
);

drop policy if exists "Public read matches" on matches;
drop policy if exists "Public insert matches" on matches;
drop policy if exists "Public update matches" on matches;
drop policy if exists "Public delete matches" on matches;
drop policy if exists "Participants can read matches" on matches;
drop policy if exists "Participants can insert matches" on matches;
drop policy if exists "Participants can update matches" on matches;
drop policy if exists "Participants can delete matches" on matches;
create policy "Participants can read matches" on matches for select using (
  exists (
    select 1
    from session_participants
    where session_participants.session_id = matches.session_id
      and session_participants.user_id = auth.uid()
  )
);
create policy "Participants can insert matches" on matches for insert with check (
  exists (
    select 1
    from session_participants
    where session_participants.session_id = matches.session_id
      and session_participants.user_id = auth.uid()
  )
);
create policy "Participants can update matches" on matches for update using (
  exists (
    select 1
    from session_participants
    where session_participants.session_id = matches.session_id
      and session_participants.user_id = auth.uid()
  )
) with check (
  exists (
    select 1
    from session_participants
    where session_participants.session_id = matches.session_id
      and session_participants.user_id = auth.uid()
  )
);
create policy "Participants can delete matches" on matches for delete using (
  exists (
    select 1
    from session_participants
    where session_participants.session_id = matches.session_id
      and session_participants.user_id = auth.uid()
  )
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'users'
  ) then
    alter publication supabase_realtime add table users;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sessions'
  ) then
    alter publication supabase_realtime add table sessions;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'session_roster'
  ) then
    alter publication supabase_realtime add table session_roster;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'session_participants'
  ) then
    alter publication supabase_realtime add table session_participants;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'matches'
  ) then
    alter publication supabase_realtime add table matches;
  end if;
end $$;
