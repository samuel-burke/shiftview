-- Team announcements: an org-wide message a manager posts to all staff (distinct
-- from the 1:1 encrypted DMs in /api/messages). Member-readable; the API
-- restricts writes to managers.
--
-- Org-scoped like every tenant table, with Realtime so the board updates live.
-- reset_demo_org() is intentionally left unchanged for the same reason as
-- positions (0019): avoids compounding the parallel-migration redefinition of
-- that function; any demo-created announcements are bounded and harmless.

begin;

create table if not exists public.announcements (
  id         bigint generated always as identity primary key,
  org_id     uuid   not null references public.organizations (id),
  title      text   not null,
  body       text   not null,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists announcements_org_created_idx
  on public.announcements (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security — member-readable/writable; the API enforces manager-only
-- writes on top of this tenant backstop.
-- ---------------------------------------------------------------------------
alter table public.announcements enable row level security;

drop policy if exists mt_select on public.announcements;
create policy mt_select on public.announcements
  for select using (public.is_org_member(org_id));

drop policy if exists mt_write on public.announcements;
create policy mt_write on public.announcements
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Realtime — the announcements board updates the moment a manager posts.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'announcements'
    ) then
      execute 'alter publication supabase_realtime add table public.announcements';
    end if;
  end if;
end $$;

commit;
