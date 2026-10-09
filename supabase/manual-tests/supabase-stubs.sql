-- A minimal stand-in for what a new Supabase project already has before any
-- of our SQL runs: the auth schema (users table, auth.uid(), auth.role()),
-- the anon / authenticated / service_role roles with Supabase's default
-- grants on public, and the supabase_realtime publication. Used by
-- baseline.test.sql. Roles are cluster-wide, so they're only created once.
--
-- auth.uid() reads request.jwt.claim.sub, so a test acts as a signed-in user
-- with:  set role authenticated; set request.jwt.claim.sub = '<uuid>';

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  email_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  is_anonymous boolean not null default false,
  raw_user_meta_data jsonb,
  raw_app_meta_data jsonb
);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.role', true), '')::text $$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
alter role service_role bypassrls;

grant usage on schema public, auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- Without wal_level = logical Postgres warns that nothing will be published;
-- only the publication's membership matters here.
set client_min_messages = error;
create publication supabase_realtime;
reset client_min_messages;
