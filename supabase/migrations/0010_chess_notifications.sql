-- Chess moves now insert a notification row so they ride the same Realtime
-- banner + bell pipeline as every other notification type (previously they
-- were push-only, so users without a push subscription missed moves unless
-- the conversation was open). To keep the feed from accumulating an entry
-- per move, each insert replaces the previous chess notification for the
-- same conversation — the bell holds at most one chess entry per game,
-- always showing the current state ("Your move!", "Checkmate!").

begin;

create or replace function public.notify_upsert_chess(
  p_org_id uuid, p_user_id uuid, p_title text, p_body text, p_data jsonb
)
returns void
language sql security definer set search_path = public
as $$
  delete from public.notifications
  where org_id = p_org_id
    and user_id = p_user_id
    and type = 'chess_move'
    and data->>'convId' = p_data->>'convId';

  insert into public.notifications (org_id, user_id, type, title, body, data)
  values (p_org_id, p_user_id, 'chess_move', p_title, p_body, p_data);
$$;

commit;
