-- Shift positions / roles (e.g. Cashier, Cook, Floor). An org-defined label that
-- can be attached to a scheduled shift, so coverage can be reasoned about by role
-- rather than just headcount.
--
-- Org-scoped like every other tenant table; member-readable, with the API
-- restricting writes to managers (RLS is the tenant-isolation backstop).
--
-- Note: positions reference only organizations (not employees), and the demo
-- seed does not create positions, so reset_demo_org() is intentionally left
-- unchanged — nothing accumulates across demo resets.

begin;

create table if not exists public.positions (
  id         bigint generated always as identity primary key,
  org_id     uuid   not null references public.organizations (id),
  name       text   not null,
  color      text,
  created_at timestamptz not null default now(),
  -- One position name per org (case-insensitive).
  unique (org_id, name),
  -- Needed so schedules can reference (position_id, org_id) and have the
  -- position's org match the shift's org.
  unique (id, org_id)
);

create index if not exists positions_org_idx on public.positions (org_id);

-- A scheduled shift may optionally be assigned a position. The composite FK
-- keeps the position in the same org as the shift; ON DELETE SET NULL lets a
-- manager remove a position without deleting the shifts that used it.
alter table public.schedules
  add column if not exists position_id bigint;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'schedules_position_org_fkey'
  ) then
    alter table public.schedules
      add constraint schedules_position_org_fkey
      foreign key (position_id, org_id) references public.positions (id, org_id)
      on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security — member-readable/writable; the API enforces manager-only
-- writes on top of this tenant backstop.
-- ---------------------------------------------------------------------------
alter table public.positions enable row level security;

drop policy if exists mt_select on public.positions;
create policy mt_select on public.positions
  for select using (public.is_org_member(org_id));

drop policy if exists mt_write on public.positions;
create policy mt_write on public.positions
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

commit;
