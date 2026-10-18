-- Kiosk mode: a shared store tablet that employees clock in and out on with a
-- PIN, without signing in.
--
--   * app_settings.kiosk_enabled ('true' turns it on; unset or anything else
--     is off, so nothing changes for a store until a manager opts in).
--   * kiosks: a store device a manager registered. The device holds a random
--     token (an HttpOnly cookie); only its SHA-256 is stored here, so a copy
--     of this table can't be used as a kiosk. A manager can revoke one, which
--     stops it at once. No client role can read or write the table: managers
--     use kiosk_create / kiosk_list / kiosk_revoke / kiosk_unlock.
--   * employee_pins: each employee's 4-6 digit PIN as a bcrypt hash (pgcrypto
--     crypt, cost 10). The salt is the store's own (kiosk_pin_salts), so the
--     hash is the same for the same PIN within a store: that is what lets a
--     kiosk find the employee with one bcrypt instead of one per employee, and
--     lets a unique key keep PINs unique within the store. A stolen copy of
--     the table still costs a bcrypt per guess per store. No client role can
--     read the table; set_employee_pin, generate_employee_pin,
--     clear_employee_pin and employee_pin_status are the only way in, for the
--     employee themselves or a manager. Archiving an employee deletes their
--     PIN.
--   * kiosk_identify(token_hash, pin), service role only: the kiosk API calls
--     it for every PIN entered. It serialises on the kiosk's row, so parallel
--     guesses can't slip past the limits:
--       - 5 wrong PINs within 5 minutes lock the kiosk until the oldest of
--         them is 5 minutes old;
--       - 20 wrong PINs within 24 hours lock it until a manager unlocks it
--         (kiosk_unlock), which caps a stolen kiosk token at 20 guesses.
--     An archived employee's PIN, another store's PIN and a malformed PIN are
--     all simply wrong. Attempts older than 30 days are purged.
--   * punch_records.source ('app' or 'kiosk') and punch_records.kiosk_id. A
--     kiosk punch can only be written by the service role (the kiosk API),
--     and only for an active kiosk of the punch's own store while kiosk mode
--     is on. It goes through the same live-punch rules as a signed-in
--     employee's punch: the database stamps the time under the employee's
--     punch lock and applies the 0051 session rules and break cap (written
--     out again in enforce_kiosk_punch below, because enforce_punch_integrity
--     lets the service role through). The archived-employee (0054) and shift
--     ownership (0043) triggers apply to every caller already, and the
--     history trigger (0053) treats a kiosk punch like any live punch: not
--     recorded on insert, every later edit recorded.
--   * Geofence: kiosk punches skip it. The kiosk is a fixed device a manager
--     set up in the store; its token is the proof of place, not GPS. They are
--     stored without coordinates. (enforce_punch_geofence already passes the
--     service role.)
--   * source and kiosk_id can't be set or changed by a signed-in user, so an
--     employee can't pass a phone punch off as a kiosk punch or the reverse.
--
-- Errors: KP001 (kiosk revoked, not this store's, or kiosk mode off), 23P01
-- (punch conflicts with the current shift, as 0051), 42501 (not allowed).
--
-- Needs 0054. Safe to repeat. Deploy the app with it or after it: the old app
-- never writes source/kiosk_id and is unaffected.

begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ── Kiosk devices ───────────────────────────────────────────────────────────

create table if not exists public.kiosks (
  id           bigint generated always as identity primary key,
  org_id       uuid not null references public.organizations (id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 60),
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by   uuid,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  -- Wrong PINs before this time don't count toward the 24-hour lockout.
  unlocked_at  timestamptz,
  revoked_at   timestamptz,
  revoked_by   uuid,
  constraint kiosks_id_org_unique unique (id, org_id)
);
create index if not exists kiosks_org_idx on public.kiosks (org_id);

alter table public.kiosks enable row level security;
revoke all on table public.kiosks from public, anon, authenticated;

-- ── PINs ────────────────────────────────────────────────────────────────────

create table if not exists public.kiosk_pin_salts (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  salt   text not null
);
alter table public.kiosk_pin_salts enable row level security;
revoke all on table public.kiosk_pin_salts from public, anon, authenticated;

create table if not exists public.employee_pins (
  org_id      uuid not null,
  employee_id bigint not null,
  pin_hash    text not null,
  set_by      uuid,
  updated_at  timestamptz not null default now(),
  primary key (org_id, employee_id),
  constraint employee_pins_org_pin_unique unique (org_id, pin_hash),
  constraint employee_pins_employee_org_fkey foreign key (employee_id, org_id)
    references public.employees (id, org_id) on delete cascade
);
alter table public.employee_pins enable row level security;
revoke all on table public.employee_pins from public, anon, authenticated;

-- An employee choosing a PIN that is taken learns that a coworker has it, so
-- an employee (not a manager) gets 5 such misses a day; generated PINs are
-- unlimited.
create table if not exists public.employee_pin_conflicts (
  id          bigint generated always as identity primary key,
  org_id      uuid not null,
  employee_id bigint not null,
  at          timestamptz not null default now(),
  constraint employee_pin_conflicts_employee_org_fkey foreign key (employee_id, org_id)
    references public.employees (id, org_id) on delete cascade
);
create index if not exists employee_pin_conflicts_idx
  on public.employee_pin_conflicts (org_id, employee_id, at);
alter table public.employee_pin_conflicts enable row level security;
revoke all on table public.employee_pin_conflicts from public, anon, authenticated;

create table if not exists public.kiosk_pin_attempts (
  id           bigint generated always as identity primary key,
  org_id       uuid not null,
  kiosk_id     bigint not null,
  employee_id  bigint,
  ok           boolean not null,
  attempted_at timestamptz not null default now(),
  constraint kiosk_pin_attempts_kiosk_org_fkey foreign key (kiosk_id, org_id)
    references public.kiosks (id, org_id) on delete cascade
);
create index if not exists kiosk_pin_attempts_failed_idx
  on public.kiosk_pin_attempts (kiosk_id, attempted_at) where not ok;
create index if not exists kiosk_pin_attempts_age_idx
  on public.kiosk_pin_attempts (kiosk_id, attempted_at);
alter table public.kiosk_pin_attempts enable row level security;
revoke all on table public.kiosk_pin_attempts from public, anon, authenticated;

-- ── Punch source ────────────────────────────────────────────────────────────

alter table public.punch_records add column if not exists source text not null default 'app';
alter table public.punch_records add column if not exists kiosk_id bigint;

alter table public.punch_records drop constraint if exists punch_records_source_check;
alter table public.punch_records add constraint punch_records_source_check check (
  source in ('app', 'kiosk') and ((source = 'kiosk') = (kiosk_id is not null))
);
alter table public.punch_records drop constraint if exists punch_records_kiosk_org_fkey;
alter table public.punch_records add constraint punch_records_kiosk_org_fkey
  foreign key (kiosk_id, org_id) references public.kiosks (id, org_id);
create index if not exists punch_records_kiosk_idx
  on public.punch_records (kiosk_id) where kiosk_id is not null;

-- ── Helpers ─────────────────────────────────────────────────────────────────

-- The store's bcrypt hash of a PIN, creating the store's salt on first use.
create or replace function public.kiosk_pin_hash(p_org uuid, p_pin text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_salt text;
begin
  select salt into v_salt from public.kiosk_pin_salts where org_id = p_org;
  if v_salt is null then
    insert into public.kiosk_pin_salts (org_id, salt)
      values (p_org, extensions.gen_salt('bf', 10))
      on conflict (org_id) do nothing;
    select salt into v_salt from public.kiosk_pin_salts where org_id = p_org;
  end if;
  return extensions.crypt(p_pin, v_salt);
end;
$$;

-- Format and strength of a PIN; raises 22023 with a readable message.
create or replace function public.kiosk_check_pin_format(p_pin text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_pin is null or p_pin !~ '^[0-9]{4,6}$' then
    raise exception 'A PIN must be 4 to 6 digits' using errcode = '22023';
  end if;
  if p_pin ~ '^(.)\1+$'
     or position(p_pin in '01234567890') > 0
     or position(p_pin in '09876543210') > 0 then
    raise exception 'That PIN is too easy to guess — choose another' using errcode = '22023';
  end if;
end;
$$;

-- The caller may manage this employee's PIN: a manager of the store, or the
-- employee themselves (active, not archived). Raises 42501 otherwise; an
-- employee of another store reads as not found.
create or replace function public.kiosk_pin_authorize(p_org uuid, p_employee bigint)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_is_manager boolean := public.is_org_manager(p_org);
begin
  if auth.uid() is null then
    raise exception 'Sign in to change a PIN' using errcode = '42501';
  end if;
  if not v_is_manager and not public.is_own_employee(p_org, p_employee) then
    raise exception 'You can only change your own PIN' using errcode = '42501';
  end if;
  if not exists (select 1 from public.employees
                  where id = p_employee and org_id = p_org and archived_at is null) then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;
  return v_is_manager;
end;
$$;

revoke all on function public.kiosk_pin_hash(uuid, text), public.kiosk_check_pin_format(text),
  public.kiosk_pin_authorize(uuid, bigint) from public, anon, authenticated;

-- ── PIN management (signed-in employee for themselves, or a manager) ───────

-- Returns 'ok', 'taken' (another employee of the store has it) or
-- 'too_many' (an employee hit 5 taken PINs today; generate one instead).
create or replace function public.set_employee_pin(p_org uuid, p_employee bigint, p_pin text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_manager boolean := public.kiosk_pin_authorize(p_org, p_employee);
  v_hash text;
begin
  perform public.kiosk_check_pin_format(p_pin);

  if not v_is_manager and (
    select count(*) from public.employee_pin_conflicts
     where org_id = p_org and employee_id = p_employee and at > now() - interval '24 hours'
  ) >= 5 then
    return 'too_many';
  end if;

  v_hash := public.kiosk_pin_hash(p_org, p_pin);
  if exists (select 1 from public.employee_pins
              where org_id = p_org and pin_hash = v_hash and employee_id <> p_employee) then
    if not v_is_manager then
      insert into public.employee_pin_conflicts (org_id, employee_id) values (p_org, p_employee);
    end if;
    return 'taken';
  end if;

  insert into public.employee_pins (org_id, employee_id, pin_hash, set_by, updated_at)
    values (p_org, p_employee, v_hash, auth.uid(), now())
    on conflict (org_id, employee_id)
    do update set pin_hash = excluded.pin_hash, set_by = excluded.set_by, updated_at = excluded.updated_at;
  return 'ok';
end;
$$;

-- Sets a random unused 6-digit PIN and returns it (shown once).
create or replace function public.generate_employee_pin(p_org uuid, p_employee bigint)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_pin text;
  v_hash text;
  i int;
begin
  perform public.kiosk_pin_authorize(p_org, p_employee);
  for i in 1..50 loop
    v_pin := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
    begin
      perform public.kiosk_check_pin_format(v_pin);
    exception when invalid_parameter_value then
      continue;
    end;
    v_hash := public.kiosk_pin_hash(p_org, v_pin);
    if not exists (select 1 from public.employee_pins
                    where org_id = p_org and pin_hash = v_hash and employee_id <> p_employee) then
      insert into public.employee_pins (org_id, employee_id, pin_hash, set_by, updated_at)
        values (p_org, p_employee, v_hash, auth.uid(), now())
        on conflict (org_id, employee_id)
        do update set pin_hash = excluded.pin_hash, set_by = excluded.set_by, updated_at = excluded.updated_at;
      return v_pin;
    end if;
  end loop;
  raise exception 'Could not find a free PIN — try again' using errcode = '40001';
end;
$$;

create or replace function public.clear_employee_pin(p_org uuid, p_employee bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.kiosk_pin_authorize(p_org, p_employee);
  delete from public.employee_pins where org_id = p_org and employee_id = p_employee;
end;
$$;

-- Whether the employee has a PIN, and when it was last set. Never the PIN.
create or replace function public.employee_pin_status(p_org uuid, p_employee bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_at timestamptz;
begin
  perform public.kiosk_pin_authorize(p_org, p_employee);
  select updated_at into v_at from public.employee_pins where org_id = p_org and employee_id = p_employee;
  return jsonb_build_object('hasPin', v_at is not null, 'updatedAt', v_at);
end;
$$;

revoke all on function public.set_employee_pin(uuid, bigint, text), public.generate_employee_pin(uuid, bigint),
  public.clear_employee_pin(uuid, bigint), public.employee_pin_status(uuid, bigint) from public, anon;
grant execute on function public.set_employee_pin(uuid, bigint, text), public.generate_employee_pin(uuid, bigint),
  public.clear_employee_pin(uuid, bigint), public.employee_pin_status(uuid, bigint) to authenticated;

-- Archiving an employee removes their PIN (restoring them needs a new one).
create or replace function public.clear_archived_employee_pin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.archived_at is not null and old.archived_at is null then
    delete from public.employee_pins where org_id = new.org_id and employee_id = new.id;
  end if;
  return null;
end;
$$;
revoke all on function public.clear_archived_employee_pin() from public, anon, authenticated;

drop trigger if exists employees_archive_clear_pin on public.employees;
create trigger employees_archive_clear_pin
  after update of archived_at on public.employees
  for each row execute function public.clear_archived_employee_pin();

-- ── Kiosk management (managers) ─────────────────────────────────────────────

create or replace function public.kiosk_create(p_org uuid, p_name text, p_token_hash text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if auth.uid() is null or not public.is_org_manager(p_org) then
    raise exception 'Manager access required' using errcode = '42501';
  end if;
  if (select count(*) from public.kiosks where org_id = p_org and revoked_at is null) >= 25 then
    raise exception 'A store can have at most 25 kiosks — revoke one first' using errcode = '54000';
  end if;
  insert into public.kiosks (org_id, name, token_hash, created_by)
    values (p_org, btrim(p_name), p_token_hash, auth.uid())
    returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.kiosk_list(p_org uuid)
returns table (id bigint, name text, created_at timestamptz, last_used_at timestamptz,
               revoked_at timestamptz, locked boolean, failed_today int)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_org_manager(p_org) then
    raise exception 'Manager access required' using errcode = '42501';
  end if;
  return query
    select k.id, k.name, k.created_at, k.last_used_at, k.revoked_at,
           coalesce(f.day >= 20 or f.recent >= 5, false),
           coalesce(f.day, 0)::int
      from public.kiosks k
      left join lateral (
        select count(*) as day,
               count(*) filter (where a.attempted_at > now() - interval '5 minutes') as recent
          from public.kiosk_pin_attempts a
         where a.kiosk_id = k.id and not a.ok
           and a.attempted_at > greatest(coalesce(k.unlocked_at, '-infinity'), now() - interval '24 hours')
      ) f on true
     where k.org_id = p_org
     order by k.revoked_at is not null, k.created_at desc;
end;
$$;

-- Not-found and another store's kiosk are the same (false).
create or replace function public.kiosk_revoke(p_org uuid, p_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_org_manager(p_org) then
    raise exception 'Manager access required' using errcode = '42501';
  end if;
  update public.kiosks set revoked_at = now(), revoked_by = auth.uid()
   where id = p_id and org_id = p_org and revoked_at is null;
  return found or exists (select 1 from public.kiosks where id = p_id and org_id = p_org);
end;
$$;

create or replace function public.kiosk_unlock(p_org uuid, p_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_org_manager(p_org) then
    raise exception 'Manager access required' using errcode = '42501';
  end if;
  update public.kiosks set unlocked_at = now()
   where id = p_id and org_id = p_org and revoked_at is null;
  return found;
end;
$$;

revoke all on function public.kiosk_create(uuid, text, text), public.kiosk_list(uuid),
  public.kiosk_revoke(uuid, bigint), public.kiosk_unlock(uuid, bigint) from public, anon;
grant execute on function public.kiosk_create(uuid, text, text), public.kiosk_list(uuid),
  public.kiosk_revoke(uuid, bigint), public.kiosk_unlock(uuid, bigint) to authenticated;

-- ── The kiosk itself (service role only) ───────────────────────────────────

-- The kiosk a token hash belongs to, if it is usable: {status: 'ok' |
-- 'no_kiosk' | 'disabled', ...}. No PIN, no attempt recorded.
create or replace function public.kiosk_status(p_token_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  k public.kiosks%rowtype;
begin
  select * into k from public.kiosks where token_hash = p_token_hash;
  if not found or k.revoked_at is not null then
    return jsonb_build_object('status', 'no_kiosk');
  end if;
  if (select value from public.app_settings where org_id = k.org_id and key = 'kiosk_enabled')
     is distinct from 'true' then
    return jsonb_build_object('status', 'disabled');
  end if;
  return jsonb_build_object(
    'status', 'ok', 'kiosk_id', k.id, 'kiosk_name', k.name, 'org_id', k.org_id,
    'org_name', (select name from public.organizations where id = k.org_id));
end;
$$;

-- Checks a PIN entered at a kiosk. {status: 'ok', org_id, kiosk_id,
-- employee_id, employee_name} | 'no_kiosk' | 'disabled' |
-- 'locked' (+ retry_after seconds, or needs_manager) | 'wrong' (+ attempts_left).
create or replace function public.kiosk_identify(p_token_hash text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.kiosks%rowtype;
  v_since timestamptz;
  v_day int;
  v_recent int;
  v_until timestamptz;
  v_salt text;
  v_hash text;
  v_emp_id bigint;
  v_emp_name text;
begin
  -- Serialise every attempt at this kiosk.
  select * into k from public.kiosks where token_hash = p_token_hash for update;
  if not found or k.revoked_at is not null then
    return jsonb_build_object('status', 'no_kiosk');
  end if;
  if (select value from public.app_settings where org_id = k.org_id and key = 'kiosk_enabled')
     is distinct from 'true' then
    return jsonb_build_object('status', 'disabled');
  end if;

  delete from public.kiosk_pin_attempts
   where kiosk_id = k.id and attempted_at < now() - interval '30 days';

  v_since := greatest(coalesce(k.unlocked_at, '-infinity'), now() - interval '24 hours');
  select count(*), count(*) filter (where attempted_at > now() - interval '5 minutes')
    into v_day, v_recent
    from public.kiosk_pin_attempts
   where kiosk_id = k.id and not ok and attempted_at > v_since;

  if v_day >= 20 then
    return jsonb_build_object('status', 'locked', 'needs_manager', true);
  end if;
  if v_recent >= 5 then
    select attempted_at + interval '5 minutes' into v_until
      from public.kiosk_pin_attempts
     where kiosk_id = k.id and not ok and attempted_at > now() - interval '5 minutes'
     order by attempted_at desc
     offset 4 limit 1;
    return jsonb_build_object('status', 'locked', 'needs_manager', false,
      'retry_after', greatest(1, ceil(extract(epoch from v_until - now())))::int);
  end if;

  if p_pin ~ '^[0-9]{4,6}$' then
    select salt into v_salt from public.kiosk_pin_salts where org_id = k.org_id;
    -- Hash even when the store has no PINs yet, so the reply takes as long.
    v_hash := extensions.crypt(p_pin, coalesce(v_salt, extensions.gen_salt('bf', 10)));
    select e.id, e.name into v_emp_id, v_emp_name
      from public.employee_pins p
      join public.employees e on e.id = p.employee_id and e.org_id = p.org_id
     where p.org_id = k.org_id and p.pin_hash = v_hash and e.archived_at is null;
  end if;

  if v_emp_id is null then
    insert into public.kiosk_pin_attempts (org_id, kiosk_id, ok) values (k.org_id, k.id, false);
    return jsonb_build_object('status', 'wrong',
      'attempts_left', greatest(0, least(5 - (v_recent + 1), 20 - (v_day + 1))));
  end if;

  insert into public.kiosk_pin_attempts (org_id, kiosk_id, employee_id, ok)
    values (k.org_id, k.id, v_emp_id, true);
  update public.kiosks set last_used_at = now() where id = k.id;
  return jsonb_build_object('status', 'ok', 'org_id', k.org_id, 'kiosk_id', k.id,
    'employee_id', v_emp_id, 'employee_name', v_emp_name);
end;
$$;

revoke all on function public.kiosk_status(text), public.kiosk_identify(text, text)
  from public, anon, authenticated;
grant execute on function public.kiosk_status(text), public.kiosk_identify(text, text) to service_role;

-- ── Kiosk punches ───────────────────────────────────────────────────────────

-- Runs after punch_records_integrity and punch_records_integrity_geofence
-- (which let the service role through) and before
-- punch_records_schedule_owner. punch_records_active_employee (0054) runs
-- first and refuses archived employees.
create or replace function public.enforce_kiosk_punch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last_type text;
  v_last_at timestamptz;
  v_in_at timestamptz;
  v_now timestamptz;
  v_tz text;
  v_continues boolean;
  v_valid boolean;
  v_max_breaks int;
  v_breaks int;
begin
  if tg_op = 'UPDATE' then
    if (new.source is distinct from old.source or new.kiosk_id is distinct from old.kiosk_id)
       and auth.uid() is not null then
      raise exception 'A punch''s source can''t be changed' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.source is distinct from 'kiosk' and new.kiosk_id is null then
    return new;
  end if;
  if auth.uid() is not null then
    raise exception 'Kiosk punches can only be recorded by a kiosk' using errcode = '42501';
  end if;
  if new.source is distinct from 'kiosk' or coalesce(new.is_manual, false) then
    raise exception 'A kiosk punch is a live punch with source kiosk' using errcode = '23514';
  end if;
  if not exists (select 1 from public.kiosks
                  where id = new.kiosk_id and org_id = new.org_id and revoked_at is null)
     or (select value from public.app_settings where org_id = new.org_id and key = 'kiosk_enabled')
        is distinct from 'true' then
    raise exception 'This kiosk is not active for this store' using errcode = 'KP001';
  end if;

  -- From here: the live-punch rules of enforce_punch_integrity (0051).
  perform pg_advisory_xact_lock(
    hashtextextended('punch:' || new.org_id::text || ':' || new.employee_id::text, 0)
  );
  v_tz := public.store_timezone(new.org_id);
  v_now := clock_timestamp();

  select punch_type, punched_at into v_last_type, v_last_at
    from public.punch_records
   where org_id = new.org_id and employee_id = new.employee_id
     and punched_at <= v_now
   order by punched_at desc, id desc
   limit 1;
  if v_last_type is not null and v_last_type <> 'clock_out' then
    select punched_at into v_in_at
      from public.punch_records
     where org_id = new.org_id and employee_id = new.employee_id
       and punch_type = 'clock_in' and punched_at <= v_last_at
     order by punched_at desc, id desc
     limit 1;
  end if;
  v_continues := v_in_at is not null
    and ((v_in_at at time zone v_tz)::date = (v_now at time zone v_tz)::date
         or v_in_at > v_now - interval '18 hours');

  v_valid := case new.punch_type
    when 'clock_in'    then v_last_type is null or v_last_type = 'clock_out'
                            or v_in_at is null
                            or (v_last_at < v_now - interval '1 minute'
                                and (v_in_at at time zone v_tz)::date < (v_now at time zone v_tz)::date
                                and ((v_now at time zone v_tz)::time >= time '04:00'
                                     or v_in_at < v_now - interval '16 hours'))
    when 'break_start' then v_continues and v_last_type in ('clock_in', 'break_end')
    when 'break_end'   then v_continues and v_last_type = 'break_start'
    when 'clock_out'   then v_continues and v_last_type in ('clock_in', 'break_end')
    else true
  end;
  if not v_valid then
    raise exception 'Punch conflicts with the latest punch (%)', coalesce(v_last_type, 'none')
      using errcode = '23P01';
  end if;

  if new.punch_type = 'break_start' then
    select case when value ~ '^\s*\d{1,3}\s*$' then btrim(value)::int else 0 end into v_max_breaks
      from public.app_settings
     where org_id = new.org_id and key = 'punch_max_breaks_per_shift';
    if coalesce(v_max_breaks, 0) > 0 then
      select count(*) into v_breaks
        from public.punch_records
       where org_id = new.org_id and employee_id = new.employee_id
         and punch_type = 'break_start' and punched_at >= v_in_at and punched_at <= v_now;
      if v_breaks >= v_max_breaks then
        raise exception 'Break limit reached (% per shift)', v_max_breaks using errcode = '23P01';
      end if;
    end if;
  end if;

  new.punched_at := v_now;
  new.lat := null;
  new.lng := null;
  return new;
end;
$$;

revoke all on function public.enforce_kiosk_punch() from public, anon, authenticated;

drop trigger if exists punch_records_kiosk on public.punch_records;
create trigger punch_records_kiosk
  before insert or update of source, kiosk_id on public.punch_records
  for each row execute function public.enforce_kiosk_punch();

commit;

notify pgrst, 'reload schema';
