-- Stage 5: serialize event reward approval with event cancellation/configuration updates.
-- Lock the parent event row while checking its status and end time, so a concurrent
-- cancellation cannot race the administrator-approved ZP payout.

create or replace function public.admin_approve_event_participant_reward(
  p_participation_id uuid,
  p_admin_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_participation public.game_event_participations%rowtype;
  v_event public.game_events%rowtype;
  v_economy public.player_economy%rowtype;
  v_required_activity record;
  v_required_count integer := 0;
  v_amount bigint;
  v_balance bigint;
begin
  if p_admin_actor is null or length(trim(p_admin_actor)) = 0 then
    raise exception 'Administrator identity is required';
  end if;

  select *
    into v_participation
    from public.game_event_participations
    where id = p_participation_id
    for update;

  if not found then
    return jsonb_build_object('success', false, 'reason', 'participation_not_found');
  end if;

  if v_participation.zp_reward_approved_at is not null then
    return jsonb_build_object(
      'success', true,
      'alreadyApproved', true,
      'rewardZp', coalesce(v_participation.zp_reward_amount, 0),
      'approvedAt', v_participation.zp_reward_approved_at
    );
  end if;

  select *
    into v_event
    from public.game_events
    where id = v_participation.event_id
    for update;

  if not found or v_event.status <> 'published' then
    raise exception 'Only published events can have rewards approved';
  end if;

  if v_event.ends_at is null or v_event.ends_at > now() then
    raise exception 'Event rewards can only be approved after the event ends';
  end if;

  if v_participation.status <> 'completed' then
    raise exception 'Participant has not completed the event';
  end if;

  v_amount := coalesce(v_event.reward_zp, 0);
  if v_amount <= 0 then
    raise exception 'This event has no ZP reward configured';
  end if;

  -- Never trust the editable participation status alone. Re-check every
  -- required activity's server-written verification flag before paying.
  for v_required_activity in
    select id
      from public.game_event_activities
      where event_id = v_event.id
        and is_required = true
  loop
    v_required_count := v_required_count + 1;
    if coalesce(
      v_participation.progress #> array['activities', v_required_activity.id::text, 'verified'],
      'false'::jsonb
    ) <> 'true'::jsonb then
      raise exception 'A required event activity is not verified';
    end if;
  end loop;

  if v_required_count = 0 then
    raise exception 'Event has no required verified activities';
  end if;

  -- Lock/create the economy row and update its ZP balance atomically.
  insert into public.player_economy (player_id, zp_balance, lifetime_zp, pending_kickback)
  values (v_participation.player_id, 0, 0, 0)
  on conflict (player_id) do nothing;

  select *
    into v_economy
    from public.player_economy
    where player_id = v_participation.player_id
    for update;

  if not found then
    raise exception 'Player economy record could not be created';
  end if;

  v_balance := coalesce(v_economy.zp_balance, 0) + v_amount;

  update public.player_economy
    set zp_balance = v_balance,
        lifetime_zp = coalesce(lifetime_zp, 0) + v_amount,
        updated_at = now()
    where player_id = v_participation.player_id;

  insert into public.economy_ledger (
    player_id, transaction_type, amount, balance_after, reference_id, description
  ) values (
    v_participation.player_id,
    'event_reward',
    v_amount,
    v_balance,
    v_participation.id,
    'Administrator-approved ZP reward for event: ' || v_event.title
  );

  update public.game_event_participations
    set zp_reward_approved_at = now(),
        zp_reward_approved_by = trim(p_admin_actor),
        zp_reward_amount = v_amount,
        updated_at = now()
    where id = v_participation.id
    returning * into v_participation;

  return jsonb_build_object(
    'success', true,
    'alreadyApproved', false,
    'participationId', v_participation.id,
    'playerId', v_participation.player_id,
    'eventId', v_event.id,
    'rewardZp', v_amount,
    'balanceAfter', v_balance,
    'approvedAt', v_participation.zp_reward_approved_at,
    'approvedBy', v_participation.zp_reward_approved_by,
    'zapRewardIssued', false,
    'zapRewardDeferred', coalesce(v_event.reward_zap, 0) > 0
  );
end;
$$;

revoke all on function public.admin_approve_event_participant_reward(uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_approve_event_participant_reward(uuid, text)
  to service_role;
