-- Leftovers from the original demo, which kept its own schedules_demo table
-- and rebuilt it nightly with generate_demo_schedules().
--
-- That table and function are long gone (0036 dropped the function), but the
-- pg_cron job that called it, "refresh-demo-schedules" (03:00 UTC daily), was
-- still scheduled in production and had failed every night since June. Its
-- sequence, schedules_demo_id_seq, was also left behind. The demo
-- organization is now seeded on first visit and reset by reset_demo_org().
--
-- Safe to repeat, and a no-op where pg_cron isn't installed or the job and
-- sequence never existed (any database built from baseline.sql).

do $$
begin
  if to_regclass('cron.job') is not null then
    execute $q$select cron.unschedule(jobid) from cron.job where jobname = 'refresh-demo-schedules'$q$;
  end if;
end $$;

drop sequence if exists public.schedules_demo_id_seq;
