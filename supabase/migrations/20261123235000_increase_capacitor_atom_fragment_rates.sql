-- Increase Capacitor (bottom) and Atom (right) fragment mining to 0.05 ZP/sec.
-- Other fragments remain at 0.02 ZP/sec. Reward verification and six-hour
-- pending hold are unchanged.
CREATE OR REPLACE FUNCTION public.accrue_fragment_mining_pending_zp(p_player_id uuid DEFAULT NULL::uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'app_private', 'pg_temp'
AS $function$
declare
  v_state public.player_fragment_gameplay_state%rowtype;
  v_end timestamptz;
  v_start timestamptz;
  v_agent_ranges tstzmultirange;
  v_boost_ranges tstzmultirange;
  v_fragment_ranges tstzmultirange;
  v_boosted_ranges tstzmultirange;
  v_active_seconds numeric;
  v_boosted_seconds numeric;
  v_amount numeric(18,2);
  v_rows integer := 0;
  v_enabled boolean := true;
  v_rate_multiplier numeric := 1.00;
  v_base_rate numeric;
begin
  select fragment_mining_enabled, fragment_mining_rate_multiplier
    into v_enabled, v_rate_multiplier
  from public.global_gameplay_settings
  where id = 'global';

  if not coalesce(v_enabled, true) then
    return 0;
  end if;

  for v_state in
    select *
    from public.player_fragment_gameplay_state
    where status = 'fixed'
      and mining_started_at is not null
      and mining_accrued_until is not null
      and core_mining_until > mining_accrued_until
      and (p_player_id is null or player_id = p_player_id)
    order by player_id, fragment_id
    for update
  loop
    v_start := v_state.mining_accrued_until;
    v_end := least(clock_timestamp(), v_state.core_mining_until);
    if v_end <= v_start then continue; end if;

    select coalesce(
      range_agg(tstzrange(greatest(starts_at, v_start), least(expires_at, v_end), '[)')),
      '{}'::tstzmultirange
    )
    into v_agent_ranges
    from public.player_agent_rentals
    where player_id = v_state.player_id
      and status = 'active'
      and starts_at < v_end
      and expires_at > v_start;

    v_fragment_ranges := tstzmultirange(tstzrange(v_start, v_end, '[)')) - v_agent_ranges;

    select coalesce(
      range_agg(tstzrange(greatest(activated_at, v_start), least(expires_at, v_end), '[)')),
      '{}'::tstzmultirange
    )
    into v_boost_ranges
    from app_private.player_reward_entitlements
    where player_id = v_state.player_id
      and reward_type = 'fragment_mining_boost'
      and reward_code = 'fragment_mining_2x_6h'
      and status = 'active'
      and activated_at is not null
      and expires_at > v_start
      and activated_at < v_end;

    v_boosted_ranges := v_fragment_ranges * v_boost_ranges;

    select coalesce(sum(extract(epoch from upper(r) - lower(r))), 0)
      into v_active_seconds from unnest(v_fragment_ranges) as r;
    select coalesce(sum(extract(epoch from upper(r) - lower(r))), 0)
      into v_boosted_seconds from unnest(v_boosted_ranges) as r;

    v_base_rate := case
      when v_state.fragment_id in ('bottom', 'right') then 0.05
      else 0.02
    end;

    v_amount := round(
      (v_active_seconds + v_boosted_seconds)
      * v_base_rate
      * coalesce(v_rate_multiplier, 1.00),
      2
    );

    if v_amount > 0 then
      insert into public.fragment_mining_accruals (
        player_id, fragment_id, mining_started_at, earned_at, amount, release_at
      ) values (
        v_state.player_id, v_state.fragment_id, v_state.mining_started_at,
        v_end, v_amount, v_end + interval '6 hours'
      )
      on conflict (player_id, fragment_id, mining_started_at, earned_at) do nothing;
      v_rows := v_rows + 1;
    end if;

    update public.player_fragment_gameplay_state
    set mining_accrued_until = v_end, updated_at = clock_timestamp()
    where player_id = v_state.player_id and fragment_id = v_state.fragment_id;
  end loop;
  return v_rows;
end;
$function$;
