-- Behavioural tests for supabase/migrations/0040_remove_legacy_demo_job.sql.
--
-- Self-contained: applies the migration once without pg_cron (it must be a
-- no-op), then builds a stand-in for pg_cron's job table and unschedule()
-- with the production leftovers and applies it twice more. Run against a
-- throwaway Postgres database:
--
--   createdb cron_test
--   cd supabase/manual-tests && psql -q -d cron_test -f 0040_remove_legacy_demo_job.test.sql
--   dropdb cron_test
--
-- Any line containing FAIL is a regression.

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if ok then raise notice 'PASS  %', label; else raise notice 'FAIL  %', label; end if;
end $$;

-- A database without pg_cron or the leftovers, like one built from baseline.sql.
\ir ../migrations/0040_remove_legacy_demo_job.sql
select pg_temp.check('runs where pg_cron is not installed', true);

create schema cron;
create table cron.job (jobid bigserial primary key, jobname text, schedule text, command text);
create function cron.unschedule(job_id bigint) returns boolean language sql as
  $$ delete from cron.job where jobid = job_id returning true $$;
insert into cron.job (jobname, schedule, command) values
  ('refresh-demo-schedules', '0 3 * * *', 'SELECT generate_demo_schedules()'),
  ('someone-elses-job', '*/5 * * * *', 'select 1');
create sequence public.schedules_demo_id_seq;

\ir ../migrations/0040_remove_legacy_demo_job.sql
\ir ../migrations/0040_remove_legacy_demo_job.sql

select pg_temp.check('the failing demo job is unscheduled',
  not exists (select 1 from cron.job where jobname = 'refresh-demo-schedules'));
select pg_temp.check('other cron jobs are left alone',
  exists (select 1 from cron.job where jobname = 'someone-elses-job'));
select pg_temp.check('the leftover sequence is dropped',
  to_regclass('public.schedules_demo_id_seq') is null);
