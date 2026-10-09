-- ShiftView database baseline: the whole schema in one file, for a NEW
-- Supabase project.
--
-- The numbered migrations upgrade the original single-tenant schema, which
-- predates this repository and was never checked in, so they can't build a
-- database from nothing. This file can. It was generated from the production
-- database on 2026-10-09, when production had every migration through 0037
-- applied (plus the pre-repo tables and functions they build on), and it is
-- tested by applying it to an empty database and comparing the result with
-- production's catalog.
--
-- New project:  run this file, then the migrations numbered after 0037
--               (0038 onward), in filename order.
-- Existing database: don't run this; apply the numbered migrations as usual.
--
-- Afterwards, enable Authentication -> Sign In / Up -> "Allow anonymous
-- sign-ins" for the demo. The demo organization is seeded on first visit.
--
-- Production quirks kept on purpose, so new environments behave the same:
-- schedules.start_minutes must be > 0 (a shift can't start at exactly
-- midnight), some coverage tables still default org_id to the default
-- organization, and schedules.employee_id has two equivalent foreign keys.
-- 0041 removes all three, in production and here alike.
--
-- Known differences from production, neither of which changes behaviour:
-- the four *_shift_times checks are validated here (production added them
-- NOT VALID because older rows predate them), and production's leftover
-- schedules_demo_id_seq is left out (0040 drops it there).

begin;

set local check_function_bodies = false;
set local search_path = public;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

create table public.organizations (
  id uuid default gen_random_uuid() not null,
  name text not null,
  slug text not null,
  created_at timestamp with time zone default now() not null,
  is_demo boolean default false not null,
  constraint organizations_pkey PRIMARY KEY (id),
  constraint organizations_slug_key UNIQUE (slug)
);

create table public.announcements (
  id bigint generated always as identity,
  org_id uuid not null,
  title text not null,
  body text not null,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  constraint announcements_pkey PRIMARY KEY (id)
);

create table public.app_settings (
  key text not null,
  value text not null,
  org_id uuid not null,
  constraint app_settings_pkey PRIMARY KEY (org_id, key)
);

create table public.audit_logs (
  id bigint generated always as identity,
  action text not null,
  actor_id uuid,
  resource_type text,
  resource_id text,
  before jsonb,
  after jsonb,
  metadata jsonb,
  created_at timestamp with time zone default now() not null,
  org_id uuid not null,
  constraint audit_logs_pkey PRIMARY KEY (id)
);

create table public.availability (
  id bigint generated always as identity,
  employee_id bigint not null,
  day_of_week smallint not null,
  note text,
  start_minutes integer,
  end_minutes integer,
  org_id uuid not null,
  constraint availability_pkey PRIMARY KEY (id),
  constraint availability_employee_id_day_of_week_key UNIQUE (employee_id, day_of_week),
  constraint availability_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6)))
);

create table public.callouts (
  id bigint generated always as identity,
  org_id uuid not null,
  employee_id bigint not null,
  date date not null,
  reason text,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  constraint callouts_pkey PRIMARY KEY (id),
  constraint callouts_org_id_employee_id_date_key UNIQUE (org_id, employee_id, date)
);

create table public.coverage_date_overrides (
  date date not null,
  profile_id bigint not null,
  org_id uuid default '00000000-0000-0000-0000-000000000001'::uuid not null,
  constraint coverage_date_overrides_pkey PRIMARY KEY (org_id, date)
);

create table public.coverage_day_defaults (
  day_of_week integer not null,
  profile_id bigint not null,
  org_id uuid default '00000000-0000-0000-0000-000000000001'::uuid not null,
  constraint coverage_day_defaults_pkey PRIMARY KEY (org_id, day_of_week),
  constraint coverage_day_defaults_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6)))
);

create table public.coverage_profile_blocks (
  id bigint generated always as identity,
  profile_id bigint not null,
  start_minutes integer not null,
  end_minutes integer not null,
  headcount integer not null,
  org_id uuid default '00000000-0000-0000-0000-000000000001'::uuid not null,
  constraint coverage_profile_blocks_pkey PRIMARY KEY (id),
  constraint coverage_profile_blocks_check CHECK ((start_minutes < end_minutes)),
  constraint coverage_profile_blocks_end_minutes_check CHECK (((end_minutes > 0) AND (end_minutes <= 1440) AND ((end_minutes % 15) = 0))),
  constraint coverage_profile_blocks_headcount_check CHECK (((headcount >= 0) AND (headcount <= 99))),
  constraint coverage_profile_blocks_start_minutes_check CHECK (((start_minutes >= 0) AND (start_minutes < 1440) AND ((start_minutes % 15) = 0)))
);

create table public.coverage_profiles (
  id bigint generated always as identity,
  name text not null,
  created_at timestamp with time zone default now() not null,
  org_id uuid default '00000000-0000-0000-0000-000000000001'::uuid not null,
  constraint coverage_profiles_pkey PRIMARY KEY (id),
  constraint coverage_profiles_org_name_unique UNIQUE (org_id, name)
);

create table public.device_presence (
  endpoint text not null,
  user_id uuid not null,
  active_until timestamp with time zone default now() not null,
  constraint device_presence_pkey PRIMARY KEY (endpoint)
);

create table public.draft_schedules (
  id bigint generated always as identity,
  employee_id bigint not null,
  date date not null,
  start_minutes integer not null,
  end_minutes integer not null,
  created_at timestamp with time zone default now() not null,
  org_id uuid default '00000000-0000-0000-0000-000000000001'::uuid not null,
  generation_run_id bigint,
  constraint draft_schedules_pkey PRIMARY KEY (id),
  constraint draft_schedules_org_employee_date_unique UNIQUE (org_id, employee_id, date),
  constraint draft_schedules_shift_times CHECK (((start_minutes >= 0) AND (start_minutes < 1440) AND (end_minutes > start_minutes) AND ((end_minutes - start_minutes) <= 960)))
);

create table public.employee_preferences (
  org_id uuid not null,
  employee_id bigint not null,
  preferred_shift_types text[] default '{}'::text[] not null,
  preferred_days smallint[] default '{}'::smallint[] not null,
  avoid_days smallint[] default '{}'::smallint[] not null,
  desired_weekly_hours numeric(4,1),
  note text,
  updated_at timestamp with time zone default now() not null,
  constraint employee_preferences_pkey PRIMARY KEY (org_id, employee_id),
  constraint employee_preferences_days_check CHECK (((preferred_days <@ ARRAY[(0)::smallint, (1)::smallint, (2)::smallint, (3)::smallint, (4)::smallint, (5)::smallint, (6)::smallint]) AND (avoid_days <@ ARRAY[(0)::smallint, (1)::smallint, (2)::smallint, (3)::smallint, (4)::smallint, (5)::smallint, (6)::smallint]))),
  constraint employee_preferences_days_disjoint_check CHECK ((NOT (preferred_days && avoid_days))),
  constraint employee_preferences_desired_hours_check CHECK (((desired_weekly_hours IS NULL) OR ((desired_weekly_hours >= (0)::numeric) AND (desired_weekly_hours <= (80)::numeric)))),
  constraint employee_preferences_note_check CHECK (((note IS NULL) OR (length(note) <= 500))),
  constraint employee_preferences_shift_types_check CHECK ((preferred_shift_types <@ ARRAY['opener'::text, 'mid'::text, 'closer'::text]))
);

create table public.employees (
  id serial,
  name text not null,
  user_id uuid,
  email text,
  org_id uuid not null,
  pay_rate numeric(10,2),
  hire_date date,
  employment_type text,
  min_weekly_hours numeric(4,1),
  max_weekly_hours numeric(4,1),
  max_days_per_week smallint,
  constraint employees_pkey PRIMARY KEY (id),
  constraint employees_id_org_unique UNIQUE (id, org_id),
  constraint chk_name_not_empty CHECK ((length(TRIM(BOTH FROM name)) > 0)),
  constraint employees_employment_type_check CHECK (((employment_type IS NULL) OR (employment_type = ANY (ARRAY['full_time'::text, 'part_time'::text])))),
  constraint employees_max_days_per_week_check CHECK (((max_days_per_week IS NULL) OR ((max_days_per_week >= 1) AND (max_days_per_week <= 7)))),
  constraint employees_weekly_hours_check CHECK ((((min_weekly_hours IS NULL) OR ((min_weekly_hours >= (0)::numeric) AND (min_weekly_hours <= (80)::numeric))) AND ((max_weekly_hours IS NULL) OR ((max_weekly_hours >= (0)::numeric) AND (max_weekly_hours <= (80)::numeric))) AND ((min_weekly_hours IS NULL) OR (max_weekly_hours IS NULL) OR (min_weekly_hours <= max_weekly_hours))))
);

create table public.managers (
  user_id uuid not null,
  org_id uuid not null,
  is_owner boolean default false not null,
  constraint managers_pkey PRIMARY KEY (org_id, user_id)
);

create table public.messages (
  id bigint generated always as identity,
  conversation_id text not null,
  from_user_id uuid not null,
  to_user_id uuid not null,
  body text not null,
  read boolean default false not null,
  created_at timestamp with time zone default now() not null,
  org_id uuid not null,
  constraint messages_pkey PRIMARY KEY (id),
  constraint messages_body_check CHECK (((char_length(body) > 0) AND (char_length(body) <= 2000)))
);

create table public.notifications (
  id bigint generated always as identity,
  user_id uuid,
  type text not null,
  title text not null,
  body text not null,
  read boolean default false not null,
  data jsonb,
  created_at timestamp with time zone default now() not null,
  is_cleared boolean default false not null,
  org_id uuid not null,
  constraint notifications_pkey PRIMARY KEY (id)
);

create table public.open_shift_claims (
  id bigint generated always as identity,
  org_id uuid not null,
  open_shift_id bigint not null,
  employee_id bigint not null,
  status text default 'pending'::text not null,
  created_at timestamp with time zone default now() not null,
  constraint open_shift_claims_pkey PRIMARY KEY (id),
  constraint open_shift_claims_org_id_open_shift_id_employee_id_key UNIQUE (org_id, open_shift_id, employee_id),
  constraint open_shift_claims_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'denied'::text])))
);

create table public.open_shifts (
  id bigint generated always as identity,
  org_id uuid not null,
  date date not null,
  start_minutes integer not null,
  end_minutes integer not null,
  note text,
  status text default 'open'::text not null,
  filled_by bigint,
  filled_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  constraint open_shifts_pkey PRIMARY KEY (id),
  constraint open_shifts_shift_times CHECK (((start_minutes >= 0) AND (start_minutes < 1440) AND (end_minutes > start_minutes) AND ((end_minutes - start_minutes) <= 960))),
  constraint open_shifts_status_check CHECK ((status = ANY (ARRAY['open'::text, 'filled'::text, 'cancelled'::text]))),
  constraint open_shifts_time_order CHECK ((start_minutes < end_minutes))
);

create table public.positions (
  id bigint generated always as identity,
  org_id uuid not null,
  name text not null,
  color text,
  created_at timestamp with time zone default now() not null,
  constraint positions_pkey PRIMARY KEY (id),
  constraint positions_id_org_id_key UNIQUE (id, org_id),
  constraint positions_org_id_name_key UNIQUE (org_id, name)
);

create table public.punch_corrections (
  id bigint generated always as identity,
  org_id uuid not null,
  employee_id bigint not null,
  punch_type text not null,
  punched_at timestamp with time zone not null,
  note text not null,
  status text default 'pending'::text not null,
  requested_by uuid,
  created_at timestamp with time zone default now() not null,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  review_note text,
  punch_id bigint,
  constraint punch_corrections_pkey PRIMARY KEY (id),
  constraint punch_corrections_note_check CHECK ((length(btrim(note)) > 0)),
  constraint punch_corrections_punch_type_check CHECK ((punch_type = ANY (ARRAY['clock_in'::text, 'clock_out'::text, 'break_start'::text, 'break_end'::text]))),
  constraint punch_corrections_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'denied'::text])))
);

create table public.punch_records (
  id bigint generated always as identity,
  employee_id bigint not null,
  schedule_id bigint,
  punch_type text not null,
  punched_at timestamp with time zone default now() not null,
  lat double precision,
  lng double precision,
  is_manual boolean default false not null,
  note text,
  created_at timestamp with time zone default now() not null,
  org_id uuid not null,
  constraint punch_records_pkey PRIMARY KEY (id),
  constraint punch_records_punch_type_check CHECK ((punch_type = ANY (ARRAY['clock_in'::text, 'clock_out'::text, 'break_start'::text, 'break_end'::text])))
);

create table public.push_subscriptions (
  id bigint generated always as identity,
  user_id uuid not null,
  endpoint text not null,
  p256dh text not null,
  auth_key text not null,
  created_at timestamp with time zone default now() not null,
  constraint push_subscriptions_pkey PRIMARY KEY (id),
  constraint push_subscriptions_user_id_endpoint_key UNIQUE (user_id, endpoint)
);

create table public.schedule_generation_runs (
  id bigint generated always as identity,
  org_id uuid not null,
  week_start date not null,
  mode text not null,
  seed bigint not null,
  rules jsonb default '{}'::jsonb not null,
  adjustments jsonb default '[]'::jsonb not null,
  metrics jsonb default '{}'::jsonb not null,
  previous_drafts jsonb default '[]'::jsonb not null,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  undone_at timestamp with time zone,
  published_at timestamp with time zone,
  constraint schedule_generation_runs_pkey PRIMARY KEY (id),
  constraint schedule_generation_runs_mode_check CHECK ((mode = ANY (ARRAY['fill'::text, 'replace'::text])))
);

create table public.schedule_template_rows (
  id bigint generated always as identity,
  template_id bigint not null,
  employee_id bigint not null,
  day_of_week smallint not null,
  start_minutes integer not null,
  end_minutes integer not null,
  org_id uuid not null,
  constraint schedule_template_rows_pkey PRIMARY KEY (id),
  constraint schedule_template_rows_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6))),
  constraint schedule_template_rows_shift_times CHECK (((start_minutes >= 0) AND (start_minutes < 1440) AND (end_minutes > start_minutes) AND ((end_minutes - start_minutes) <= 960)))
);

create table public.schedule_templates (
  id bigint generated always as identity,
  name text not null,
  created_at timestamp with time zone default now(),
  org_id uuid not null,
  constraint schedule_templates_pkey PRIMARY KEY (id),
  constraint schedule_templates_id_org_unique UNIQUE (id, org_id)
);

create table public.schedules (
  id serial,
  employee_id integer not null,
  date date not null,
  start_minutes integer not null,
  end_minutes integer not null,
  org_id uuid not null,
  position_id bigint,
  constraint schedules_pkey PRIMARY KEY (id),
  constraint schedules_id_org_unique UNIQUE (id, org_id),
  constraint chk_max_shift_length CHECK (((end_minutes - start_minutes) <= 960)),
  constraint chk_min_shift_length CHECK (((end_minutes - start_minutes) >= 60)),
  constraint chk_start_before_end CHECK ((start_minutes < end_minutes)),
  constraint chk_start_in_day CHECK (((start_minutes >= 0) AND (start_minutes < 1440))),
  constraint end_minutes_positive CHECK ((end_minutes > 0)),
  constraint schedules_shift_times CHECK (((start_minutes >= 0) AND (start_minutes < 1440) AND (end_minutes > start_minutes) AND ((end_minutes - start_minutes) <= 960))),
  constraint start_minutes_positive CHECK ((start_minutes > 0))
);

create table public.shift_swaps (
  id bigint generated always as identity,
  requester_id bigint not null,
  target_id bigint not null,
  schedule_a_id bigint not null,
  schedule_b_id bigint not null,
  status text default 'pending'::text not null,
  created_at timestamp with time zone default now(),
  org_id uuid not null,
  constraint shift_swaps_pkey PRIMARY KEY (id),
  constraint shift_swaps_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'approved'::text, 'denied'::text])))
);

create table public.store_hours (
  day_of_week smallint not null,
  open_minutes integer not null,
  close_minutes integer not null,
  org_id uuid not null,
  constraint store_hours_pkey PRIMARY KEY (org_id, day_of_week),
  constraint store_hours_check CHECK ((open_minutes < close_minutes)),
  constraint store_hours_check1 CHECK (((close_minutes - open_minutes) >= 60)),
  constraint store_hours_close_minutes_check CHECK (((close_minutes > 0) AND (close_minutes <= 1440))),
  constraint store_hours_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6))),
  constraint store_hours_open_minutes_check CHECK (((open_minutes >= 0) AND (open_minutes < 1440)))
);

create table public.time_off_requests (
  id bigint generated always as identity,
  employee_id bigint not null,
  date date not null,
  status text default 'pending'::text not null,
  note text,
  created_at timestamp with time zone default now(),
  org_id uuid not null,
  constraint time_off_requests_pkey PRIMARY KEY (id),
  constraint time_off_requests_employee_id_date_key UNIQUE (employee_id, date),
  constraint time_off_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'denied'::text])))
);

create table public.user_notification_preferences (
  user_id uuid not null,
  late_punch_alerts boolean default true not null,
  message_alerts boolean default true not null,
  pto_alerts boolean default true not null,
  new_shift_alerts boolean default true not null,
  shift_change_alerts boolean default true not null,
  swap_alerts boolean default true not null,
  shift_reminder_alerts boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  chess_alerts boolean default true not null,
  constraint user_notification_preferences_pkey PRIMARY KEY (user_id)
);

-- ---------------------------------------------------------------------------
-- 2. Foreign keys
-- ---------------------------------------------------------------------------

alter table public.announcements add constraint announcements_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
alter table public.app_settings add constraint app_settings_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
alter table public.audit_logs add constraint audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.audit_logs add constraint audit_logs_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
alter table public.availability add constraint availability_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
alter table public.availability add constraint availability_employee_org_fkey FOREIGN KEY (employee_id, org_id) REFERENCES employees(id, org_id);
alter table public.availability add constraint availability_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
alter table public.callouts add constraint callouts_employee_org_fkey FOREIGN KEY (employee_id, org_id) REFERENCES employees(id, org_id);
alter table public.callouts add constraint callouts_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
alter table public.coverage_date_overrides add constraint coverage_date_overrides_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
alter table public.coverage_date_overrides add constraint coverage_date_overrides_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES coverage_profiles(id) ON DELETE CASCADE;
alter table public.coverage_day_defaults add constraint coverage_day_defaults_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
alter table public.coverage_day_defaults add constraint coverage_day_defaults_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES coverage_profiles(id) ON DELETE CASCADE;
alter table public.coverage_profile_blocks add constraint coverage_profile_blocks_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
alter table public.coverage_profile_blocks add constraint coverage_profile_blocks_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES coverage_profiles(id) ON DELETE CASCADE;
alter table public.coverage_profiles add constraint coverage_profiles_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
alter table public.device_presence add constraint device_presence_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.draft_schedules add constraint draft_schedules_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
alter table public.draft_schedules add constraint draft_schedules_employee_org_fkey FOREIGN KEY (employee_id, org_id) REFERENCES employees(id, org_id);
alter table public.draft_schedules add constraint draft_schedules_generation_run_fkey FOREIGN KEY (generation_run_id) REFERENCES schedule_generation_runs(id) ON DELETE SET NULL;
alter table public.draft_schedules add constraint draft_schedules_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
alter table public.employee_preferences add constraint employee_preferences_employee_org_fkey FOREIGN KEY (employee_id, org_id) REFERENCES employees(id, org_id) ON DELETE CASCADE;
alter table public.employee_preferences add constraint employee_preferences_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
alter table public.employees add constraint employees_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
alter table public.employees add constraint employees_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.managers add constraint managers_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
alter table public.managers add constraint managers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.messages add constraint messages_from_user_id_fkey FOREIGN KEY (from_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.messages add constraint messages_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
alter table public.messages add constraint messages_to_user_id_fkey FOREIGN KEY (to_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.notifications add constraint notifications_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
alter table public.notifications add constraint notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.open_shift_claims add constraint open_shift_claims_employee_org_fkey FOREIGN KEY (employee_id, org_id) REFERENCES employees(id, org_id);
alter table public.open_shift_claims add constraint open_shift_claims_open_shift_id_fkey FOREIGN KEY (open_shift_id) REFERENCES open_shifts(id) ON DELETE CASCADE;
alter table public.open_shift_claims add constraint open_shift_claims_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
alter table public.open_shifts add constraint open_shifts_filled_by_org_fkey FOREIGN KEY (filled_by, org_id) REFERENCES employees(id, org_id);
alter table public.open_shifts add constraint open_shifts_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
alter table public.positions add constraint positions_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
alter table public.punch_corrections add constraint punch_corrections_employee_org_fkey FOREIGN KEY (employee_id, org_id) REFERENCES employees(id, org_id) ON DELETE CASCADE;
alter table public.punch_corrections add constraint punch_corrections_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
alter table public.punch_records add constraint punch_records_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
alter table public.punch_records add constraint punch_records_employee_org_fkey FOREIGN KEY (employee_id, org_id) REFERENCES employees(id, org_id);
alter table public.punch_records add constraint punch_records_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
alter table public.punch_records add constraint punch_records_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE SET NULL;
alter table public.punch_records add constraint punch_records_schedule_org_fkey FOREIGN KEY (schedule_id, org_id) REFERENCES schedules(id, org_id);
alter table public.push_subscriptions add constraint push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.schedule_generation_runs add constraint schedule_generation_runs_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
alter table public.schedule_template_rows add constraint schedule_template_rows_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
alter table public.schedule_template_rows add constraint schedule_template_rows_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
alter table public.schedule_template_rows add constraint schedule_template_rows_template_id_fkey FOREIGN KEY (template_id) REFERENCES schedule_templates(id) ON DELETE CASCADE;
alter table public.schedule_template_rows add constraint template_rows_employee_org_fkey FOREIGN KEY (employee_id, org_id) REFERENCES employees(id, org_id);
alter table public.schedule_template_rows add constraint template_rows_template_org_fkey FOREIGN KEY (template_id, org_id) REFERENCES schedule_templates(id, org_id);
alter table public.schedule_templates add constraint schedule_templates_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
alter table public.schedules add constraint fk_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT;
alter table public.schedules add constraint schedules_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id);
alter table public.schedules add constraint schedules_employee_org_fkey FOREIGN KEY (employee_id, org_id) REFERENCES employees(id, org_id);
alter table public.schedules add constraint schedules_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
alter table public.schedules add constraint schedules_position_org_fkey FOREIGN KEY (position_id, org_id) REFERENCES positions(id, org_id) ON DELETE SET NULL;
alter table public.shift_swaps add constraint shift_swaps_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
alter table public.shift_swaps add constraint shift_swaps_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES employees(id) ON DELETE CASCADE;
alter table public.shift_swaps add constraint shift_swaps_requester_org_fkey FOREIGN KEY (requester_id, org_id) REFERENCES employees(id, org_id);
alter table public.shift_swaps add constraint shift_swaps_schedule_a_id_fkey FOREIGN KEY (schedule_a_id) REFERENCES schedules(id) ON DELETE CASCADE;
alter table public.shift_swaps add constraint shift_swaps_schedule_a_org_fkey FOREIGN KEY (schedule_a_id, org_id) REFERENCES schedules(id, org_id);
alter table public.shift_swaps add constraint shift_swaps_schedule_b_id_fkey FOREIGN KEY (schedule_b_id) REFERENCES schedules(id) ON DELETE CASCADE;
alter table public.shift_swaps add constraint shift_swaps_schedule_b_org_fkey FOREIGN KEY (schedule_b_id, org_id) REFERENCES schedules(id, org_id);
alter table public.shift_swaps add constraint shift_swaps_target_id_fkey FOREIGN KEY (target_id) REFERENCES employees(id) ON DELETE CASCADE;
alter table public.shift_swaps add constraint shift_swaps_target_org_fkey FOREIGN KEY (target_id, org_id) REFERENCES employees(id, org_id);
alter table public.store_hours add constraint store_hours_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
alter table public.time_off_requests add constraint time_off_employee_org_fkey FOREIGN KEY (employee_id, org_id) REFERENCES employees(id, org_id);
alter table public.time_off_requests add constraint time_off_requests_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
alter table public.time_off_requests add constraint time_off_requests_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
alter table public.user_notification_preferences add constraint user_notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- 3. Indexes (beyond those backing primary keys and unique constraints)
-- ---------------------------------------------------------------------------

CREATE INDEX announcements_org_created_idx ON public.announcements USING btree (org_id, created_at DESC);
CREATE INDEX audit_logs_action_idx ON public.audit_logs USING btree (action);
CREATE INDEX audit_logs_actor_id_idx ON public.audit_logs USING btree (actor_id);
CREATE INDEX audit_logs_created_at_idx ON public.audit_logs USING btree (created_at DESC);
CREATE INDEX audit_logs_org_created_idx ON public.audit_logs USING btree (org_id, created_at);
CREATE INDEX audit_logs_resource_idx ON public.audit_logs USING btree (resource_type, resource_id);
CREATE INDEX availability_org_employee_idx ON public.availability USING btree (org_id, employee_id);
CREATE INDEX callouts_org_date_idx ON public.callouts USING btree (org_id, date);
CREATE INDEX callouts_org_employee_idx ON public.callouts USING btree (org_id, employee_id);
CREATE INDEX coverage_date_overrides_org_idx ON public.coverage_date_overrides USING btree (org_id);
CREATE INDEX coverage_day_defaults_org_idx ON public.coverage_day_defaults USING btree (org_id);
CREATE INDEX coverage_profile_blocks_org_idx ON public.coverage_profile_blocks USING btree (org_id, profile_id);
CREATE INDEX coverage_profiles_org_idx ON public.coverage_profiles USING btree (org_id);
CREATE INDEX device_presence_user_idx ON public.device_presence USING btree (user_id);
CREATE INDEX draft_schedules_generation_run_idx ON public.draft_schedules USING btree (generation_run_id);
CREATE INDEX draft_schedules_org_date_idx ON public.draft_schedules USING btree (org_id, date);
CREATE INDEX employees_org_idx ON public.employees USING btree (org_id);
CREATE INDEX employees_org_user_idx ON public.employees USING btree (org_id, user_id);
CREATE UNIQUE INDEX employees_org_user_unique ON public.employees USING btree (org_id, user_id) WHERE (user_id IS NOT NULL);
CREATE INDEX employees_user_id_idx ON public.employees USING btree (user_id);
CREATE UNIQUE INDEX managers_org_owner_uniq ON public.managers USING btree (org_id) WHERE is_owner;
CREATE INDEX managers_org_user_idx ON public.managers USING btree (org_id, user_id);
CREATE INDEX messages_conversation_idx ON public.messages USING btree (conversation_id, created_at);
CREATE INDEX messages_org_conversation_idx ON public.messages USING btree (org_id, conversation_id);
CREATE INDEX notifications_org_user_idx ON public.notifications USING btree (org_id, user_id);
CREATE INDEX open_shift_claims_org_employee_idx ON public.open_shift_claims USING btree (org_id, employee_id);
CREATE INDEX open_shift_claims_org_shift_idx ON public.open_shift_claims USING btree (org_id, open_shift_id);
CREATE INDEX open_shifts_org_date_idx ON public.open_shifts USING btree (org_id, date);
CREATE INDEX open_shifts_org_status_idx ON public.open_shifts USING btree (org_id, status);
CREATE INDEX positions_org_idx ON public.positions USING btree (org_id);
CREATE INDEX punch_corrections_org_employee_idx ON public.punch_corrections USING btree (org_id, employee_id, created_at DESC);
CREATE INDEX punch_corrections_org_status_idx ON public.punch_corrections USING btree (org_id, status, created_at DESC);
CREATE INDEX punch_records_org_punched_idx ON public.punch_records USING btree (org_id, punched_at);
CREATE INDEX schedule_generation_runs_org_week_idx ON public.schedule_generation_runs USING btree (org_id, week_start, id DESC);
CREATE INDEX schedules_date_idx ON public.schedules USING btree (date);
CREATE INDEX schedules_org_date_idx ON public.schedules USING btree (org_id, date);
CREATE INDEX schedules_org_employee_idx ON public.schedules USING btree (org_id, employee_id);
CREATE INDEX shift_swaps_org_idx ON public.shift_swaps USING btree (org_id);
CREATE INDEX template_rows_org_template_idx ON public.schedule_template_rows USING btree (org_id, template_id);
CREATE INDEX time_off_org_date_idx ON public.time_off_requests USING btree (org_id, date);

-- ---------------------------------------------------------------------------
-- 4. Functions
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_generated_drafts(p_org uuid, p_week_start date, p_mode text, p_replace_run_id bigint, p_expected jsonb, p_rows jsonb, p_seed bigint, p_rules jsonb, p_adjustments jsonb, p_metrics jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_week_end date;
  v_current  jsonb;
  v_previous jsonb := '[]'::jsonb;
  -- record, not %rowtype: a %rowtype declaration needs the table to exist
  -- when the function is created, so applying the statements out of order
  -- or in pieces would fail. A record only needs it when the function runs.
  v_replaced record;
  v_run_id   bigint;
  v_removed  int := 0;
  v_inserted int := 0;
begin
  if not public.is_org_manager(p_org) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if p_week_start is null or p_mode is null or p_mode not in ('fill', 'replace')
     or jsonb_typeof(p_rows) is distinct from 'array' then
    return jsonb_build_object('status', 'invalid');
  end if;
  v_week_end := p_week_start + 6;

  if exists (
    select 1 from jsonb_to_recordset(p_rows) as r(date date)
    where r.date is null or r.date not between p_week_start and v_week_end
  ) then
    return jsonb_build_object('status', 'invalid');
  end if;

  -- One generation per org-week at a time.
  perform pg_advisory_xact_lock(
    hashtextextended('schedule_generation:' || p_org::text || ':' || p_week_start::text, 0)
  );

  -- The generator planned around the week's drafts as it read them; if they
  -- have changed since, its plan may no longer fit.
  perform 1 from public.draft_schedules
   where org_id = p_org and date between p_week_start and v_week_end
   for update;
  select coalesce(
           jsonb_agg(jsonb_build_array(id, employee_id, date, start_minutes, end_minutes) order by id),
           '[]'::jsonb)
    into v_current
    from public.draft_schedules
   where org_id = p_org and date between p_week_start and v_week_end;
  if v_current is distinct from coalesce(p_expected, '[]'::jsonb) then
    return jsonb_build_object('status', 'conflict');
  end if;

  if p_replace_run_id is not null then
    select * into v_replaced
      from public.schedule_generation_runs
     where id = p_replace_run_id and org_id = p_org and week_start = p_week_start
       for update;
    if not found then
      return jsonb_build_object('status', 'stale');
    end if;
    if v_replaced.undone_at is not null
       or v_replaced.published_at is not null
       or exists (
         select 1 from public.schedule_generation_runs r
          where r.org_id = p_org and r.week_start = p_week_start
            and r.id > p_replace_run_id and r.undone_at is null
       ) then
      return jsonb_build_object('status', 'stale');
    end if;
    v_previous := v_replaced.previous_drafts;
  elsif p_mode = 'replace' then
    select coalesce(
             jsonb_agg(jsonb_build_object(
               'employee_id', employee_id,
               'date', date,
               'start_minutes', start_minutes,
               'end_minutes', end_minutes,
               'generation_run_id', generation_run_id) order by id),
             '[]'::jsonb)
      into v_previous
      from public.draft_schedules
     where org_id = p_org and date between p_week_start and v_week_end;
  end if;

  -- The writes. Any constraint failure rolls back everything in this block.
  begin
    if p_replace_run_id is not null then
      delete from public.draft_schedules
       where org_id = p_org and generation_run_id = p_replace_run_id;
      get diagnostics v_removed = row_count;
      update public.schedule_generation_runs set undone_at = now() where id = p_replace_run_id;
    elsif p_mode = 'replace' then
      delete from public.draft_schedules
       where org_id = p_org and date between p_week_start and v_week_end;
      get diagnostics v_removed = row_count;
    end if;

    insert into public.schedule_generation_runs
      (org_id, week_start, mode, seed, rules, adjustments, metrics, previous_drafts, created_by)
    values
      (p_org, p_week_start, p_mode, p_seed,
       coalesce(p_rules, '{}'::jsonb), coalesce(p_adjustments, '[]'::jsonb),
       coalesce(p_metrics, '{}'::jsonb), v_previous, auth.uid())
    returning id into v_run_id;

    insert into public.draft_schedules
      (org_id, employee_id, date, start_minutes, end_minutes, generation_run_id)
    select p_org, r.employee_id, r.date, r.start_minutes, r.end_minutes, v_run_id
      from jsonb_to_recordset(p_rows)
        as r(employee_id bigint, date date, start_minutes int, end_minutes int);
    get diagnostics v_inserted = row_count;
  exception
    when unique_violation then
      return jsonb_build_object('status', 'conflict');
    when foreign_key_violation or check_violation or not_null_violation then
      return jsonb_build_object('status', 'invalid');
  end;

  return jsonb_build_object(
    'status', 'ok', 'run_id', v_run_id, 'inserted', v_inserted, 'removed', v_removed
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.approve_shift_swap(p_org uuid, p_swap_id bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_swap   public.shift_swaps%rowtype;
  v_emp_a  bigint;
  v_emp_b  bigint;
begin
  -- Only a manager of this org may approve, however the RPC is reached.
  if not public.is_org_manager(p_org) then
    return 'forbidden';
  end if;

  -- Lock the swap so two approvals can't both apply.
  select * into v_swap
  from public.shift_swaps
  where id = p_swap_id and org_id = p_org
  for update;

  if not found then
    return 'not_found';
  end if;

  -- The consent gate: a swap can only be approved once the target accepted it.
  -- Any other state (pending / approved / denied / declined) is returned as-is
  -- so the caller can distinguish "still awaiting acceptance" from "resolved".
  if v_swap.status <> 'accepted' then
    return v_swap.status;
  end if;

  -- Lock both schedules and read their current owners.
  select employee_id into v_emp_a
  from public.schedules
  where id = v_swap.schedule_a_id and org_id = p_org
  for update;
  if not found then
    return 'schedule_missing';
  end if;

  select employee_id into v_emp_b
  from public.schedules
  where id = v_swap.schedule_b_id and org_id = p_org
  for update;
  if not found then
    return 'schedule_missing';
  end if;

  -- Exchange owners and resolve the swap — all or nothing.
  update public.schedules set employee_id = v_emp_b
    where id = v_swap.schedule_a_id and org_id = p_org;
  update public.schedules set employee_id = v_emp_a
    where id = v_swap.schedule_b_id and org_id = p_org;
  update public.shift_swaps set status = 'approved'
    where id = p_swap_id and org_id = p_org;

  return 'approved';
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_callout_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tz text;
  v_today date;
begin
  if auth.uid() is null or public.is_org_manager(new.org_id) then
    return new;
  end if;

  if not exists (
    select 1 from public.employees
    where id = new.employee_id and org_id = new.org_id and user_id = auth.uid()
  ) then
    raise exception 'You can only call out for yourself' using errcode = '42501';
  end if;

  select value into v_tz from public.app_settings
    where org_id = new.org_id and key = 'timezone';
  begin
    v_today := (now() at time zone coalesce(v_tz, 'America/New_York'))::date;
  exception when others then
    v_today := (now() at time zone 'America/New_York')::date; -- unrecognised zone
    v_tz := 'America/New_York';
  end;
  v_tz := coalesce(v_tz, 'America/New_York');

  if new.date not in (v_today, v_today + 1) then
    raise exception 'You can only call out for today''s or tomorrow''s shift' using errcode = '22007';
  end if;

  if not exists (
    select 1 from public.schedules
    where org_id = new.org_id and employee_id = new.employee_id and date = new.date
  ) then
    raise exception 'You don''t have a shift scheduled that day' using errcode = '22007';
  end if;

  -- The store's local day [midnight, next midnight) as instants; converting a
  -- local timestamp with "at time zone" handles 23/25-hour DST days.
  if new.date = v_today and exists (
    select 1 from public.punch_records
    where org_id = new.org_id and employee_id = new.employee_id
      and punch_type = 'clock_in'
      and punched_at >= (v_today::timestamp at time zone v_tz)
      and punched_at <  ((v_today + 1)::timestamp at time zone v_tz)
  ) then
    raise exception 'You''ve already clocked in for today''s shift' using errcode = '22007';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_punch_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_is_manager boolean;
  v_last_type text;
  v_last_at timestamptz;
  v_valid boolean;
begin
  if v_uid is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    if not public.is_org_manager(old.org_id) then
      raise exception 'Only managers can delete punches' using errcode = '42501';
    end if;
    return old;
  end if;

  v_is_manager := public.is_org_manager(new.org_id);

  if tg_op = 'UPDATE' then
    if not v_is_manager then
      raise exception 'Only managers can edit punches' using errcode = '42501';
    end if;
    if new.punched_at is distinct from old.punched_at then
      if new.punched_at > now() then
        raise exception 'punched_at cannot be in the future' using errcode = '22007';
      end if;
      new.is_manual := true;
    end if;
    return new;
  end if;

  -- INSERT
  if not v_is_manager then
    if not public.is_own_employee(new.org_id, new.employee_id) then
      raise exception 'You can only record punches for yourself' using errcode = '42501';
    end if;
    if coalesce(new.is_manual, false) then
      raise exception 'Punch corrections need manager approval' using errcode = '42501';
    end if;
  end if;

  if not coalesce(new.is_manual, false) then
    -- New in 0035: serialize and re-check.
    perform pg_advisory_xact_lock(
      hashtextextended('punch:' || new.org_id::text || ':' || new.employee_id::text, 0)
    );
    -- clock_timestamp(), not now(): a punch committed while this one waited
    -- for the lock may carry a later transaction start than ours.
    select punch_type, punched_at into v_last_type, v_last_at
      from public.punch_records
     where org_id = new.org_id and employee_id = new.employee_id
       and punched_at <= clock_timestamp()
     order by punched_at desc, id desc
     limit 1;
    v_valid := case new.punch_type
      when 'clock_in'    then v_last_type is null or v_last_type = 'clock_out'
                              or v_last_at < clock_timestamp() - interval '1 minute'
      when 'break_start' then coalesce(v_last_type in ('clock_in', 'break_end'), false)
      when 'break_end'   then coalesce(v_last_type = 'break_start', false)
      when 'clock_out'   then coalesce(v_last_type in ('clock_in', 'break_end'), false)
      else true
    end;
    if not v_valid then
      raise exception 'Punch conflicts with the latest punch (%)', coalesce(v_last_type, 'none')
        using errcode = '23P01';
    end if;

    -- Live punch: the server clock is the only source of truth. Stamped
    -- after the lock so punches are in the order they were accepted.
    new.punched_at := clock_timestamp();
    return new;
  end if;

  if new.punched_at is null then
    raise exception 'Manual punches require punched_at' using errcode = '23502';
  end if;
  if new.punched_at > now() then
    raise exception 'punched_at cannot be in the future' using errcode = '22007';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_swap_response()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null or public.is_org_manager(old.org_id) then
    return new;
  end if;
  -- RLS lets only the target employee get this far.
  if old.status is distinct from 'pending'
     or new.status not in ('accepted', 'declined')
     or (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'You can only accept or decline a pending swap' using errcode = '42501';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.is_org_manager(p_org uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.managers where user_id = auth.uid() and org_id = p_org
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_org_member(p_org uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.managers  where user_id = auth.uid() and org_id = p_org
    union all
    select 1 from public.employees where user_id = auth.uid() and org_id = p_org
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_own_employee(p_org uuid, p_employee bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.employees
    where id = p_employee and org_id = p_org and user_id = auth.uid()
  );
$function$;

CREATE OR REPLACE FUNCTION public.link_employee_on_signup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  BEGIN
    UPDATE public.employees
    SET user_id = NEW.id
    WHERE email = NEW.email
      AND user_id IS NULL;
    RETURN NEW;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'link_employee_on_signup failed: %', SQLERRM;
    RETURN NEW;
  END;
  $function$;

CREATE OR REPLACE FUNCTION public.manager_demote(p_org_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_org_manager(p_org_id) then
    raise exception 'not authorized to manage roles for this organization';
  end if;

  -- The managers_protect_owner trigger rejects removing the org owner.
  delete from public.managers
  where org_id = p_org_id and user_id = p_user_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.manager_promote(p_org_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_org_manager(p_org_id) then
    raise exception 'not authorized to manage roles for this organization';
  end if;

  insert into public.managers (org_id, user_id)
  values (p_org_id, p_user_id)
  on conflict (org_id, user_id) do nothing;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_delete_subs(p_user_id uuid, p_endpoints text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM push_subscriptions
  WHERE user_id = p_user_id
    AND endpoint = ANY(p_endpoints);
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_get_active_endpoints(p_user_id uuid)
 RETURNS TABLE(endpoint text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select endpoint from public.device_presence
  where user_id = p_user_id and active_until > now();
$function$;

CREATE OR REPLACE FUNCTION public.notify_get_manager_ids(p_org_id uuid)
 RETURNS TABLE(user_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select user_id from public.managers where org_id = p_org_id;
$function$;

CREATE OR REPLACE FUNCTION public.notify_get_push_prefs(p_user_id uuid)
 RETURNS TABLE(late_punch_alerts boolean, message_alerts boolean, pto_alerts boolean, new_shift_alerts boolean, shift_change_alerts boolean, swap_alerts boolean, shift_reminder_alerts boolean, chess_alerts boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- The user's row, or all-on defaults when they never saved preferences.
  select
    coalesce(late_punch_alerts, true),
    coalesce(message_alerts, true),
    coalesce(pto_alerts, true),
    coalesce(new_shift_alerts, true),
    coalesce(shift_change_alerts, true),
    coalesce(swap_alerts, true),
    coalesce(shift_reminder_alerts, true),
    coalesce(chess_alerts, true)
  from public.user_notification_preferences
  where user_id = p_user_id
  union all
  select true, true, true, true, true, true, true, true
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.notify_get_push_subs(p_user_id uuid)
 RETURNS TABLE(endpoint text, p256dh text, auth_key text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
    SELECT ps.endpoint, ps.p256dh, ps.auth_key
    FROM push_subscriptions ps
    WHERE ps.user_id = p_user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_insert(p_org_id uuid, p_user_id uuid, p_type text, p_title text, p_body text, p_data jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into public.notifications (org_id, user_id, type, title, body, data)
  values (p_org_id, p_user_id, p_type, p_title, p_body, p_data);
$function$;

CREATE OR REPLACE FUNCTION public.notify_upsert_chess(p_org_id uuid, p_user_id uuid, p_title text, p_body text, p_data jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  delete from public.notifications
  where org_id = p_org_id
    and user_id = p_user_id
    and type = 'chess_move'
    and data->>'convId' = p_data->>'convId';

  insert into public.notifications (org_id, user_id, type, title, body, data)
  values (p_org_id, p_user_id, 'chess_move', p_title, p_body, p_data);
$function$;

CREATE OR REPLACE FUNCTION public.org_delete(p_org uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- The seeded default and demo organizations must never be deletable.
  if p_org in ('00000000-0000-0000-0000-000000000001',
               '00000000-0000-0000-0000-000000000002') then
    raise exception 'org_delete: organization % cannot be deleted', p_org;
  end if;
  if not exists (select 1 from organizations where id = p_org) then
    raise exception 'org_delete: organization % does not exist', p_org;
  end if;

  perform set_config('app.allow_owner_removal', 'on', true);

  delete from open_shift_claims        where org_id = p_org;
  delete from open_shifts              where org_id = p_org;
  delete from punch_corrections        where org_id = p_org;
  delete from punch_records            where org_id = p_org;
  delete from shift_swaps              where org_id = p_org;
  delete from draft_schedules          where org_id = p_org;
  delete from schedule_generation_runs where org_id = p_org;
  delete from schedule_template_rows   where org_id = p_org;
  delete from schedule_templates       where org_id = p_org;
  delete from schedules                where org_id = p_org;
  delete from positions                where org_id = p_org;
  delete from availability             where org_id = p_org;
  delete from employee_preferences     where org_id = p_org;
  delete from time_off_requests        where org_id = p_org;
  delete from callouts                 where org_id = p_org;
  delete from messages                 where org_id = p_org;
  delete from notifications            where org_id = p_org;
  delete from announcements            where org_id = p_org;
  delete from audit_logs               where org_id = p_org;
  delete from coverage_profile_blocks  where org_id = p_org;
  delete from coverage_date_overrides  where org_id = p_org;
  delete from coverage_day_defaults    where org_id = p_org;
  delete from coverage_profiles        where org_id = p_org;
  delete from store_hours              where org_id = p_org;
  delete from app_settings             where org_id = p_org;
  delete from employees                where org_id = p_org;
  delete from managers                 where org_id = p_org;
  delete from organizations            where id = p_org;
end;
$function$;

CREATE OR REPLACE FUNCTION public.org_signup_create(p_name text, p_slug text, p_user_id uuid, p_owner_name text, p_owner_email text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid;
begin
  insert into organizations (name, slug)
  values (p_name, p_slug)
  returning id into v_org;

  insert into managers (org_id, user_id, is_owner)
  values (v_org, p_user_id, true);

  -- Linked employee row so My Schedule and the clock page work for the owner.
  insert into employees (org_id, user_id, name, email)
  values (v_org, p_user_id, p_owner_name, p_owner_email);

  return v_org;
end;
$function$;

CREATE OR REPLACE FUNCTION public.presence_set(p_endpoint text, p_active boolean)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into public.device_presence (endpoint, user_id, active_until)
  values (
    p_endpoint,
    auth.uid(),
    case when p_active then now() + interval '60 seconds' else now() end
  )
  on conflict (endpoint) do update
    set active_until = excluded.active_until,
        user_id      = excluded.user_id;
$function$;

CREATE OR REPLACE FUNCTION public.protect_employee_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return new;
  end if;
  if (tg_op = 'INSERT' or new.user_id is distinct from old.user_id)
     and new.user_id is not null and new.user_id <> v_uid then
    raise exception 'You can only link an employee record to your own account' using errcode = '42501';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.protect_org_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Set (transaction-locally) only by org_delete while it tears down an
  -- entire organization; the owner row must go with it.
  if current_setting('app.allow_owner_removal', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.is_owner then
      raise exception 'the organization owner cannot be removed';
    end if;
    return old;
  end if;
  if old.is_owner and not new.is_owner then
    raise exception 'the organization owner cannot be demoted';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.punch_corrections_stamp()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.created_at := now();
  if new.punched_at > now() then
    raise exception 'punched_at cannot be in the future' using errcode = '22007';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reset_demo_org(p_org uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from organizations where id = p_org and is_demo) then
    raise exception 'reset_demo_org: % is not a demo organization', p_org;
  end if;

  delete from open_shift_claims        where org_id = p_org;
  delete from open_shifts              where org_id = p_org;
  delete from punch_records            where org_id = p_org;
  delete from shift_swaps              where org_id = p_org;
  delete from draft_schedules          where org_id = p_org;
  delete from schedule_generation_runs where org_id = p_org;
  delete from schedule_template_rows   where org_id = p_org;
  delete from schedule_templates       where org_id = p_org;
  delete from schedules                where org_id = p_org;
  delete from availability             where org_id = p_org;
  delete from employee_preferences     where org_id = p_org;
  delete from time_off_requests        where org_id = p_org;
  delete from callouts                 where org_id = p_org;
  delete from messages                 where org_id = p_org;
  delete from notifications            where org_id = p_org;
  delete from audit_logs               where org_id = p_org;
  delete from coverage_profile_blocks  where org_id = p_org;
  delete from coverage_date_overrides  where org_id = p_org;
  delete from coverage_day_defaults    where org_id = p_org;
  delete from coverage_profiles        where org_id = p_org;
  delete from store_hours              where org_id = p_org;
  delete from app_settings             where org_id = p_org;
  delete from employees                where org_id = p_org;
  delete from managers                 where org_id = p_org;
end;
$function$;

CREATE OR REPLACE FUNCTION public.undo_generation_run(p_org uuid, p_run_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_run      record; -- not %rowtype: see apply_generated_drafts
  v_removed  int := 0;
  v_restored int := 0;
begin
  if not public.is_org_manager(p_org) then
    return jsonb_build_object('status', 'forbidden');
  end if;

  select * into v_run
    from public.schedule_generation_runs
   where id = p_run_id and org_id = p_org;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('schedule_generation:' || p_org::text || ':' || v_run.week_start::text, 0)
  );
  select * into v_run
    from public.schedule_generation_runs
   where id = p_run_id and org_id = p_org
     for update;

  if v_run.undone_at is not null then
    return jsonb_build_object('status', 'already_undone');
  end if;
  if v_run.published_at is not null then
    return jsonb_build_object('status', 'published');
  end if;
  if exists (
    select 1 from public.schedule_generation_runs r
     where r.org_id = p_org and r.week_start = v_run.week_start
       and r.id > v_run.id and r.undone_at is null
  ) then
    return jsonb_build_object('status', 'not_latest');
  end if;

  delete from public.draft_schedules
   where org_id = p_org and generation_run_id = p_run_id;
  get diagnostics v_removed = row_count;

  insert into public.draft_schedules
    (org_id, employee_id, date, start_minutes, end_minutes, generation_run_id)
  select p_org, d.employee_id, d.date, d.start_minutes, d.end_minutes, d.generation_run_id
    from jsonb_to_recordset(v_run.previous_drafts)
      as d(employee_id bigint, date date, start_minutes int, end_minutes int, generation_run_id bigint)
   where exists (
     select 1 from public.employees e where e.id = d.employee_id and e.org_id = p_org
   )
  on conflict (org_id, employee_id, date) do nothing;
  get diagnostics v_restored = row_count;

  update public.schedule_generation_runs set undone_at = now() where id = p_run_id;

  return jsonb_build_object(
    'status', 'ok', 'week_start', v_run.week_start, 'removed', v_removed, 'restored', v_restored
  );
end;
$function$;

-- Function privileges. Supabase grants every new function to anon and
-- authenticated; these are the ones production restricts.
revoke all on function public.apply_generated_drafts(uuid, date, text, bigint, jsonb, jsonb, bigint, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.apply_generated_drafts(uuid, date, text, bigint, jsonb, jsonb, bigint, jsonb, jsonb, jsonb) to authenticated;
revoke all on function public.approve_shift_swap(uuid, bigint) from public, anon;
grant execute on function public.approve_shift_swap(uuid, bigint) to authenticated;
revoke all on function public.undo_generation_run(uuid, bigint) from public, anon;
grant execute on function public.undo_generation_run(uuid, bigint) to authenticated;
revoke all on function public.org_delete(uuid) from public, anon, authenticated;
revoke all on function public.org_signup_create(text, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.reset_demo_org(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Triggers
-- ---------------------------------------------------------------------------

CREATE TRIGGER callouts_rules BEFORE INSERT OR UPDATE ON public.callouts FOR EACH ROW EXECUTE FUNCTION enforce_callout_rules();
CREATE TRIGGER employees_protect_link BEFORE INSERT OR UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION protect_employee_link();
CREATE TRIGGER managers_protect_owner BEFORE DELETE OR UPDATE ON public.managers FOR EACH ROW EXECUTE FUNCTION protect_org_owner();
CREATE TRIGGER punch_corrections_stamp BEFORE INSERT ON public.punch_corrections FOR EACH ROW EXECUTE FUNCTION punch_corrections_stamp();
CREATE TRIGGER punch_records_integrity BEFORE INSERT OR DELETE OR UPDATE ON public.punch_records FOR EACH ROW EXECUTE FUNCTION enforce_punch_integrity();
CREATE TRIGGER shift_swaps_response BEFORE UPDATE ON public.shift_swaps FOR EACH ROW EXECUTE FUNCTION enforce_swap_response();
-- Links an invited employee row to its account when the account is created.
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION link_employee_on_signup();

-- ---------------------------------------------------------------------------
-- 6. Row level security
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'announcements', 'app_settings', 'audit_logs', 'availability', 'callouts',
    'coverage_date_overrides', 'coverage_day_defaults', 'coverage_profile_blocks',
    'coverage_profiles', 'device_presence', 'draft_schedules', 'employee_preferences',
    'employees', 'managers', 'messages', 'notifications', 'open_shift_claims',
    'open_shifts', 'organizations', 'positions', 'punch_corrections', 'punch_records',
    'push_subscriptions', 'schedule_generation_runs', 'schedule_template_rows',
    'schedule_templates', 'schedules', 'shift_swaps', 'store_hours',
    'time_off_requests', 'user_notification_preferences'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create policy mt_delete on public.announcements for delete
  using (is_org_manager(org_id));
create policy mt_insert on public.announcements for insert
  with check (is_org_manager(org_id));
create policy mt_select on public.announcements for select
  using (is_org_member(org_id));
create policy mt_update on public.announcements for update
  using (is_org_manager(org_id))
  with check (is_org_manager(org_id));
create policy mt_delete on public.app_settings for delete
  using (is_org_manager(org_id));
create policy mt_insert on public.app_settings for insert
  with check (is_org_manager(org_id));
create policy mt_select on public.app_settings for select
  using (is_org_member(org_id));
create policy mt_update on public.app_settings for update
  using (is_org_manager(org_id))
  with check (is_org_manager(org_id));
create policy mt_select on public.availability for select
  using (is_org_member(org_id));
create policy mt_write on public.availability for all
  using ((is_org_manager(org_id) OR is_own_employee(org_id, employee_id)))
  with check ((is_org_manager(org_id) OR is_own_employee(org_id, employee_id)));
create policy mt_select on public.callouts for select
  using (is_org_member(org_id));
create policy mt_write on public.callouts for all
  using ((is_org_manager(org_id) OR is_own_employee(org_id, employee_id)))
  with check ((is_org_manager(org_id) OR is_own_employee(org_id, employee_id)));
create policy mt_delete on public.coverage_date_overrides for delete
  using (is_org_manager(org_id));
create policy mt_insert on public.coverage_date_overrides for insert
  with check (is_org_manager(org_id));
create policy mt_select on public.coverage_date_overrides for select
  using (is_org_member(org_id));
create policy mt_update on public.coverage_date_overrides for update
  using (is_org_manager(org_id))
  with check (is_org_manager(org_id));
create policy mt_delete on public.coverage_day_defaults for delete
  using (is_org_manager(org_id));
create policy mt_insert on public.coverage_day_defaults for insert
  with check (is_org_manager(org_id));
create policy mt_select on public.coverage_day_defaults for select
  using (is_org_member(org_id));
create policy mt_update on public.coverage_day_defaults for update
  using (is_org_manager(org_id))
  with check (is_org_manager(org_id));
create policy mt_delete on public.coverage_profile_blocks for delete
  using (is_org_manager(org_id));
create policy mt_insert on public.coverage_profile_blocks for insert
  with check (is_org_manager(org_id));
create policy mt_select on public.coverage_profile_blocks for select
  using (is_org_member(org_id));
create policy mt_update on public.coverage_profile_blocks for update
  using (is_org_manager(org_id))
  with check (is_org_manager(org_id));
create policy mt_delete on public.coverage_profiles for delete
  using (is_org_manager(org_id));
create policy mt_insert on public.coverage_profiles for insert
  with check (is_org_manager(org_id));
create policy mt_select on public.coverage_profiles for select
  using (is_org_member(org_id));
create policy mt_update on public.coverage_profiles for update
  using (is_org_manager(org_id))
  with check (is_org_manager(org_id));
create policy dp_select on public.device_presence for select
  using ((user_id = auth.uid()));
create policy dp_write on public.device_presence for all
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));
create policy mt_delete on public.draft_schedules for delete
  using (is_org_manager(org_id));
create policy mt_insert on public.draft_schedules for insert
  with check (is_org_manager(org_id));
create policy mt_select on public.draft_schedules for select
  using (is_org_manager(org_id));
create policy mt_update on public.draft_schedules for update
  using (is_org_manager(org_id))
  with check (is_org_manager(org_id));
create policy mt_select on public.employee_preferences for select
  using ((is_org_manager(org_id) OR is_own_employee(org_id, employee_id)));
create policy mt_write on public.employee_preferences for all
  using ((is_org_manager(org_id) OR is_own_employee(org_id, employee_id)))
  with check ((is_org_manager(org_id) OR is_own_employee(org_id, employee_id)));
create policy mt_delete on public.employees for delete
  using (is_org_manager(org_id));
create policy mt_insert on public.employees for insert
  with check (is_org_manager(org_id));
create policy mt_select on public.employees for select
  using (is_org_member(org_id));
create policy mt_update on public.employees for update
  using (is_org_manager(org_id))
  with check (is_org_manager(org_id));
create policy mt_select on public.managers for select
  using (is_org_member(org_id));
create policy mt_insert on public.messages for insert
  with check ((is_org_member(org_id) AND (from_user_id = auth.uid())));
create policy mt_select on public.messages for select
  using ((is_org_member(org_id) AND ((from_user_id = auth.uid()) OR (to_user_id = auth.uid()))));
create policy mt_update on public.messages for update
  using ((is_org_member(org_id) AND ((from_user_id = auth.uid()) OR (to_user_id = auth.uid()))));
create policy mt_select on public.notifications for select
  using ((is_org_member(org_id) AND ((user_id = auth.uid()) OR ((user_id IS NULL) AND is_org_manager(org_id)))));
create policy mt_update on public.notifications for update
  using ((is_org_member(org_id) AND ((user_id = auth.uid()) OR ((user_id IS NULL) AND is_org_manager(org_id)))));
create policy mt_select on public.open_shift_claims for select
  using (is_org_member(org_id));
create policy mt_write on public.open_shift_claims for all
  using ((is_org_manager(org_id) OR is_own_employee(org_id, employee_id)))
  with check ((is_org_manager(org_id) OR (is_own_employee(org_id, employee_id) AND (status = 'pending'::text))));
create policy mt_delete on public.open_shifts for delete
  using (is_org_manager(org_id));
create policy mt_insert on public.open_shifts for insert
  with check (is_org_manager(org_id));
create policy mt_select on public.open_shifts for select
  using (is_org_member(org_id));
create policy mt_update on public.open_shifts for update
  using (is_org_manager(org_id))
  with check (is_org_manager(org_id));
create policy mt_select on public.organizations for select
  using (is_org_member(id));
create policy mt_delete on public.positions for delete
  using (is_org_manager(org_id));
create policy mt_insert on public.positions for insert
  with check (is_org_manager(org_id));
create policy mt_select on public.positions for select
  using (is_org_member(org_id));
create policy mt_update on public.positions for update
  using (is_org_manager(org_id))
  with check (is_org_manager(org_id));
create policy mt_delete on public.punch_corrections for delete
  using (is_org_manager(org_id));
create policy mt_insert on public.punch_corrections for insert
  with check ((is_own_employee(org_id, employee_id) AND (status = 'pending'::text) AND (reviewed_by IS NULL) AND (reviewed_at IS NULL) AND (punch_id IS NULL)));
create policy mt_select on public.punch_corrections for select
  using ((is_org_manager(org_id) OR is_own_employee(org_id, employee_id)));
create policy mt_update on public.punch_corrections for update
  using (is_org_manager(org_id))
  with check (is_org_manager(org_id));
create policy mt_delete on public.punch_records for delete
  using (is_org_manager(org_id));
create policy mt_insert on public.punch_records for insert
  with check ((is_org_manager(org_id) OR is_own_employee(org_id, employee_id)));
create policy mt_select on public.punch_records for select
  using ((is_org_manager(org_id) OR is_own_employee(org_id, employee_id)));
create policy mt_update on public.punch_records for update
  using (is_org_manager(org_id))
  with check (is_org_manager(org_id));
create policy push_subscriptions_own on public.push_subscriptions for all
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));
create policy mt_select on public.schedule_generation_runs for select
  using (is_org_manager(org_id));
create policy mt_update on public.schedule_generation_runs for update
  using (is_org_manager(org_id))
  with check (is_org_manager(org_id));
create policy mt_delete on public.schedule_template_rows for delete
  using (is_org_manager(org_id));
create policy mt_insert on public.schedule_template_rows for insert
  with check (is_org_manager(org_id));
create policy mt_select on public.schedule_template_rows for select
  using (is_org_member(org_id));
create policy mt_update on public.schedule_template_rows for update
  using (is_org_manager(org_id))
  with check (is_org_manager(org_id));
create policy mt_delete on public.schedule_templates for delete
  using (is_org_manager(org_id));
create policy mt_insert on public.schedule_templates for insert
  with check (is_org_manager(org_id));
create policy mt_select on public.schedule_templates for select
  using (is_org_member(org_id));
create policy mt_update on public.schedule_templates for update
  using (is_org_manager(org_id))
  with check (is_org_manager(org_id));
create policy mt_delete on public.schedules for delete
  using (is_org_manager(org_id));
create policy mt_insert on public.schedules for insert
  with check (is_org_manager(org_id));
create policy mt_select on public.schedules for select
  using (is_org_member(org_id));
create policy mt_update on public.schedules for update
  using (is_org_manager(org_id))
  with check (is_org_manager(org_id));
create policy mt_delete on public.shift_swaps for delete
  using (is_org_manager(org_id));
create policy mt_insert on public.shift_swaps for insert
  with check ((is_org_manager(org_id) OR (is_own_employee(org_id, requester_id) AND (COALESCE(status, 'pending'::text) = 'pending'::text))));
create policy mt_select on public.shift_swaps for select
  using (is_org_member(org_id));
create policy mt_update on public.shift_swaps for update
  using ((is_org_manager(org_id) OR is_own_employee(org_id, target_id)))
  with check ((is_org_manager(org_id) OR is_own_employee(org_id, target_id)));
create policy mt_delete on public.store_hours for delete
  using (is_org_manager(org_id));
create policy mt_insert on public.store_hours for insert
  with check (is_org_manager(org_id));
create policy mt_select on public.store_hours for select
  using (is_org_member(org_id));
create policy mt_update on public.store_hours for update
  using (is_org_manager(org_id))
  with check (is_org_manager(org_id));
create policy mt_delete on public.time_off_requests for delete
  using (is_org_manager(org_id));
create policy mt_insert on public.time_off_requests for insert
  with check ((is_org_manager(org_id) OR (is_own_employee(org_id, employee_id) AND (COALESCE(status, 'pending'::text) = 'pending'::text))));
create policy mt_select on public.time_off_requests for select
  using (is_org_member(org_id));
create policy mt_update on public.time_off_requests for update
  using (is_org_manager(org_id))
  with check (is_org_manager(org_id));
create policy users_own_notification_prefs on public.user_notification_preferences for all
  using ((auth.uid() = user_id));

-- ---------------------------------------------------------------------------
-- 7. Realtime
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return; -- not a Supabase database
  end if;
  foreach t in array array[
    'announcements', 'app_settings', 'audit_logs', 'callouts', 'employees', 'managers',
    'messages', 'notifications', 'open_shift_claims', 'open_shifts', 'punch_corrections',
    'punch_records', 'schedules', 'shift_swaps', 'store_hours', 'time_off_requests'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Fixed rows: the default and demo organizations (lib/org-context.ts
--    DEFAULT_ORG_ID, lib/demo-org.ts DEMO_ORG_ID).
-- ---------------------------------------------------------------------------

insert into public.organizations (id, name, slug, is_demo) values
  ('00000000-0000-0000-0000-000000000001', 'Default Organization', 'default', false),
  ('00000000-0000-0000-0000-000000000002', 'Demo Organization', 'demo', true);

commit;

notify pgrst, 'reload schema';
