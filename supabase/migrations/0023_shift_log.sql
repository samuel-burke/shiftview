-- Shift handoff log: short operational notes staff leave for the next shift
-- ("Freezer running warm", "Out of receipt paper"). Staff-authored and scoped to
-- a day — distinct from manager announcements (org-wide) and per-shift notes
-- (manager scheduling context).
--
-- Mirrors the callouts multitenancy shape (0013): org_id column, composite FK so
-- a row's org_id matches its employee's org, member-read/write RLS, Realtime so
-- the log updates live. reset_demo_org() left unchanged (consistent with the
-- other parallel feature migrations).

begin;

create table if not exists public.shift_log_entries (
  id          bigint generated always as identity primary key,
  org_id      uuid   not null references public.organizations (id),
  employee_id bigint not null,
  date        date   not null,
  body        text   not null,
  created_at  timestamptz not null default now(),
  constraint shift_log_employee_org_fkey
    foreign key (employee_id, org_id) references public.employees (id, org_id)
);

create index if not exists shift_log_org_date_idx on public.shift_log_entries (org_id, date);

-- ---------------------------------------------------------------------------
-- Row Level Security — member-readable/writable (any staff posts); the API
-- restricts deletion to the author or a manager.
-- ---------------------------------------------------------------------------
alter table public.shift_log_entries enable row level security;

drop policy if exists mt_select on public.shift_log_entries;
create policy mt_select on public.shift_log_entries
  for select using (public.is_org_member(org_id));

drop policy if exists mt_write on public.shift_log_entries;
create policy mt_write on public.shift_log_entries
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Realtime — the handoff log updates live as staff post.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shift_log_entries'
    ) then
      execute 'alter publication supabase_realtime add table public.shift_log_entries';
    end if;
  end if;
end $$;

commit;
