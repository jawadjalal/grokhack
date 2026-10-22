-- Backer schema. Safe to re-run.
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text unique not null,
  date date,
  city text default 'London',
  topic text,
  audience_size int,
  organiser text,
  created_at timestamptz default now()
);

create table if not exists sponsors (
  id text primary key,                 -- slug, e.g. 'cursor'
  name text not null,
  domain text unique not null,
  kind text not null default 'sponsor' check (kind in ('sponsor', 'venue')),
  tags text[] not null default '{}',   -- what they care about
  audience text[] not null default '{}', -- developers, founders, students, designers, community
  hackathons boolean not null default true,
  size text not null default 'startup' check (size in ('giant', 'scaleup', 'startup')),
  description text,
  contact_name text,
  contact_url text,
  created_at timestamptz default now()
);

create table if not exists backings (
  event_id uuid not null references events(id) on delete cascade,
  sponsor_id text not null references sponsors(id) on delete cascade,
  role text not null,
  source_url text not null,
  primary key (event_id, sponsor_id)
);

-- What the app reads: one row per backing with the event's details.
create or replace view backings_view as
  select b.sponsor_id, e.name as event, coalesce(e.topic, e.name) as event_topic, b.role, b.source_url as url
  from backings b join events e on e.id = b.event_id;

-- Anyone can read, only the service role writes.
alter table events enable row level security;
alter table sponsors enable row level security;
alter table backings enable row level security;
drop policy if exists "read events" on events;
drop policy if exists "read sponsors" on sponsors;
drop policy if exists "read backings" on backings;
create policy "read events" on events for select using (true);
create policy "read sponsors" on sponsors for select using (true);
create policy "read backings" on backings for select using (true);
grant select on backings_view to anon, authenticated;
