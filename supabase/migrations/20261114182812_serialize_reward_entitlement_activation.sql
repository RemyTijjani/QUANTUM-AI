-- Serialize temporary reward activations per player.
-- Source-only until separately approved for Preview application.
-- Locking the owning player row prevents concurrent requests from activating
-- multiple rewards of the same type before either request sees the other's write.

create or replace function public.activate_player_reward(
  p_player_id uuid,
  p_entitlement_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $function$
declare
  v_reward app_private.player_reward_entitlements%rowtype;
  v_duration integer;
  v_active_exists boolean;
  v_now timestamptz := now();
begin
  if p_player_id is null or p_entitlement_id is null then
    raise exception 'Invalid reward activation request';
  end if;

  -- All activations for this player serialize on the same row.
  perform p.id
  from public.players p
  where p.id = p_player_id
  for update;

  if not found then
    raise exception 'Invalid reward activation request';
  end if;

  select * into v_reward
  from app_private.player_reward_entitlements
  where id = p_entitlement_id
    and player_id = p_player_id
    and reward_type in ('fragment_mining_boost', 'daily_streak_agent')
  for update;

  if not found then
    raise exception 'Reward entitlement not found';
  end if;

  if v_reward.status = 'active' and v_reward.expires_at > v_now then
    return jsonb_build_object(
      'success', true, 'alreadyActive', true,
      'entitlementId', v_reward.id, 'rewardType', v_reward.reward_type,
      'activatedAt', v_reward.activated_at, 'expiresAt', v_reward.expires_at,
      'metadata', v_reward.metadata
    );
  end if;

  if v_reward.status <> 'available' then
    raise exception 'This reward is no longer available to activate';
  end if;

  if v_reward.reward_type = 'fragment_mining_boost' then
    v_duration := 21600;
    if v_reward.reward_code <> 'fragment_mining_2x_6h'
       or coalesce((v_reward.metadata ->> 'multiplier')::integer, 0) <> 2
       or coalesce((v_reward.metadata ->> 'duration_seconds')::integer, 0) <> v_duration
    then
      raise exception 'Fragment Mining boost configuration is invalid';
    end if;

    update app_private.player_reward_entitlements
    set status = 'expired'
    where player_id = p_player_id
      and reward_type = 'fragment_mining_boost'
      and status = 'active'
      and expires_at <= v_now;

    select exists (
      select 1 from app_private.player_reward_entitlements
      where player_id = p_player_id
        and reward_type = 'fragment_mining_boost'
        and status = 'active'
        and expires_at > v_now
    ) into v_active_exists;

    if v_active_exists then
      raise exception 'A Fragment Mining boost is already active; boosts cannot stack or extend';
    end if;
  else
    v_duration := 86400;
    if v_reward.reward_code <> 'free_agent_1_24h'
       or v_reward.metadata ->> 'agent' <> 'agent_1'
       or coalesce((v_reward.metadata ->> 'duration_seconds')::integer, 0) <> v_duration
    then
      raise exception 'Free Agent 1 reward configuration is invalid';
    end if;

    update app_private.player_reward_entitlements
    set status = 'expired'
    where player_id = p_player_id
      and reward_type = 'daily_streak_agent'
      and status = 'active'
      and expires_at <= v_now;

    select exists (
      select 1 from app_private.player_reward_entitlements
      where player_id = p_player_id
        and reward_type = 'daily_streak_agent'
        and status = 'active'
        and expires_at > v_now
    ) into v_active_exists;

    if v_active_exists then
      raise exception 'Free Agent 1 is already active';
    end if;
  end if;

  update app_private.player_reward_entitlements
  set status = 'active',
      activated_at = v_now,
      expires_at = v_now + make_interval(secs => v_duration)
  where id = v_reward.id
  returning * into v_reward;

  return jsonb_build_object(
    'success', true, 'alreadyActive', false,
    'entitlementId', v_reward.id, 'rewardType', v_reward.reward_type,
    'activatedAt', v_reward.activated_at, 'expiresAt', v_reward.expires_at,
    'metadata', v_reward.metadata
  );
end;
$function$;

revoke all on function public.activate_player_reward(uuid, uuid) from public, anon, authenticated;
grant execute on function public.activate_player_reward(uuid, uuid) to service_role;
