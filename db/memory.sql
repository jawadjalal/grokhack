-- Backer memory: every touch (push, send, reply, call...) on a lead. Additive, safe to re-run.
create table if not exists touches (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  event_name text not null,
  event_url text,
  sponsor_id text references sponsors(id),
  sponsor_name text,
  kind text check (kind in ('pushed','sent','opened','replied','call','signed','note')),
  to_email text,
  subject text,
  body text,
  note text
);
alter table touches enable row level security;
drop policy if exists "read touches" on touches;
drop policy if exists "insert touches" on touches;
create policy "read touches" on touches for select to anon using (true);
create policy "insert touches" on touches for insert to anon with check (true);
grant select, insert on touches to anon;
create index if not exists touches_created_idx on touches (created_at desc);
