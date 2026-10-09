-- Behavioural tests for supabase/migrations/0039_link_existing_accounts.sql.
--
-- Self-contained: builds a minimal auth.users / employees stand-in, applies
-- the migration, then checks each case, printing PASS/FAIL notices. Run
-- against a throwaway Postgres database:
--
--   createdb link_test
--   cd supabase/manual-tests && psql -q -d link_test -f 0039_link_existing_accounts.test.sql
--   dropdb link_test
--
-- Any line containing FAIL is a regression.

create schema if not exists auth;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

create table auth.users (
  id uuid primary key, email text, email_confirmed_at timestamptz, created_at timestamptz not null default now()
);
create table public.employees (
  id bigint primary key, org_id uuid not null, user_id uuid, name text, email text
);
create unique index employees_org_user_unique on public.employees (org_id, user_id) where user_id is not null;

\ir ../migrations/0039_link_existing_accounts.sql

\set store '''00000000-0000-0000-0000-00000000000a'''
\set other '''00000000-0000-0000-0000-00000000000b'''

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'Alice@Example.com', now()),     -- works at another store
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com', null),       -- invited earlier, never accepted
  ('33333333-3333-3333-3333-333333333333', null, null),                    -- anonymous demo visitor
  ('44444444-4444-4444-4444-444444444444', 'dana@example.com', now());     -- already on this store's team
insert into employees values
  (1, :other, '11111111-1111-1111-1111-111111111111', 'Alice', 'Alice@Example.com'),
  (2, :store, null, 'Alice', 'alice@example.com'),
  (3, :store, null, 'Bob', 'bob@example.com'),
  (4, :store, null, 'Cara', 'cara@example.com'),
  (5, :store, '44444444-4444-4444-4444-444444444444', 'Dana', 'dana@example.com'),
  (6, :store, null, 'Dana again', 'dana@example.com');

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if ok then raise notice 'PASS  %', label; else raise notice 'FAIL  %', label; end if;
end $$;

select pg_temp.check('an existing confirmed account is linked, matching email case-insensitively',
  (select user_id = '11111111-1111-1111-1111-111111111111' and confirmed from link_employee_account(:store, 2)));
select pg_temp.check('…and the employee row now points at it',
  (select user_id = '11111111-1111-1111-1111-111111111111' from employees where id = 2));
select pg_temp.check('an unconfirmed account is linked and reported unconfirmed (the route re-sends the invite)',
  (select not confirmed from link_employee_account(:store, 3)));
select pg_temp.check('no account: nothing returned, nothing linked',
  (select count(*) = 0 from link_employee_account(:store, 4))
  and (select user_id is null from employees where id = 4));
select pg_temp.check('an account already on this team isn''t linked twice',
  (select count(*) = 0 from link_employee_account(:store, 6))
  and (select user_id is null from employees where id = 6));
select pg_temp.check('the wrong org can''t link another org''s row',
  (select count(*) = 0 from link_employee_account(:other, 4)));
select pg_temp.check('only the service role can call it',
  not has_function_privilege('authenticated', 'public.link_employee_account(uuid, bigint)', 'execute')
  and not has_function_privilege('anon', 'public.link_employee_account(uuid, bigint)', 'execute')
  and has_function_privilege('service_role', 'public.link_employee_account(uuid, bigint)', 'execute'));
