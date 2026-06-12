-- Allow one email to hold employee records in multiple organizations.
--
-- The base (pre-multi-tenancy) schema enforced a global unique on
-- employees.email. That blocks a member of one organization from founding
-- another: org_signup_create inserts the founder's employee row and hits a
-- unique violation, so sign-up fails for anyone who already belongs to an
-- org. Global unique constraints are a documented multi-tenancy pitfall
-- (docs/MULTI_TENANCY.md §6) — 0002 re-keyed app_settings, store_hours and
-- managers but employees.email was missed.
--
-- Defensive lookup by definition rather than name, since the base schema
-- predates this repo's migration history and the constraint name may vary.

begin;

do $$
declare
  r record;
begin
  -- Unique constraints on exactly (email).
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.employees'::regclass
      and contype = 'u'
      and conkey = (
        select array_agg(attnum)
        from pg_attribute
        where attrelid = 'public.employees'::regclass and attname = 'email'
      )
  loop
    execute format('alter table public.employees drop constraint %I', r.conname);
  end loop;

  -- Standalone unique indexes on exactly (email) (not constraint-backed).
  for r in
    select i.indexrelid::regclass::text as idxname
    from pg_index i
    where i.indrelid = 'public.employees'::regclass
      and i.indisunique
      and i.indnatts = 1
      and not exists (select 1 from pg_constraint where conindid = i.indexrelid)
      and (
        select attname from pg_attribute
        where attrelid = i.indrelid and attnum = i.indkey[0]
      ) = 'email'
  loop
    execute format('drop index if exists %s', r.idxname);
  end loop;
end $$;

commit;
