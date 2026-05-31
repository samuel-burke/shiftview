-- Soft-delete flag: cleared notifications are hidden from the inbox but not removed from the DB
alter table notifications
  add column if not exists is_cleared boolean not null default false;
