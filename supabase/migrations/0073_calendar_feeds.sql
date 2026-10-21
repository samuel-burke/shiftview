-- Subscribable calendar feeds: one secret feed token per employee, stored as
-- a SHA-256 hash. Only the service role reads or writes it (RLS on, no
-- policies): the API checks who is asking, and the public feed URL is looked
-- up by hash.
--
-- Safe to repeat.

begin;

create table if not exists public.calendar_feeds (
  org_id      uuid not null,
  employee_id bigint not null,
  token_hash  text not null,
  created_at  timestamptz not null default now(),
  constraint calendar_feeds_pkey primary key (org_id, employee_id),
  constraint calendar_feeds_token_hash_key unique (token_hash),
  constraint calendar_feeds_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint calendar_feeds_employee_fkey foreign key (employee_id, org_id)
    references public.employees (id, org_id) on delete cascade
);

alter table public.calendar_feeds enable row level security;
revoke all on public.calendar_feeds from anon, authenticated;

commit;
