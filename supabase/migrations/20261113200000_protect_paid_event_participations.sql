-- Stage 5: make an approved event payout and its completed participation record immutable.
-- The payout RPC sets these fields once; subsequent status/payout edits are rejected.
create or replace function public.guard_paid_event_participation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if old.zp_reward_approved_at is not null then
    if new.status is distinct from old.status then
      raise exception 'Participant status cannot change after the event reward is approved';
    end if;

    if new.zp_reward_approved_at is distinct from old.zp_reward_approved_at
       or new.zp_reward_approved_by is distinct from old.zp_reward_approved_by
       or new.zp_reward_amount is distinct from old.zp_reward_amount then
      raise exception 'An approved event reward record cannot be changed';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists game_event_participations_paid_immutable
  on public.game_event_participations;

create trigger game_event_participations_paid_immutable
before update on public.game_event_participations
for each row
execute function public.guard_paid_event_participation();

revoke all on function public.guard_paid_event_participation()
  from public, anon, authenticated;
