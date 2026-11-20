create or replace function public.get_mystery_box_repeat_state(p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','app_private','pg_temp'
as $$
declare
  v_cooldown_until timestamptz;
  v_zp_balance numeric(20,0);
  v_last_free_claim_at timestamptz;
  v_next_free_claim_at timestamptz;
begin
  if p_player_id is null or not exists(select 1 from public.players p where p.id=p_player_id) then
    raise exception 'Player profile not found';
  end if;
  select s.cooldown_until into v_cooldown_until from app_private.player_repeat_mystery_box_state s where s.player_id=p_player_id;
  select coalesce(e.zp_balance,0) into v_zp_balance from public.player_economy e where e.player_id=p_player_id;
  select s.last_claim_at into v_last_free_claim_at from app_private.player_daily_mystery_box_state s where s.player_id=p_player_id;
  v_next_free_claim_at := case when v_last_free_claim_at is null then null else v_last_free_claim_at+interval '24 hours' end;
  return jsonb_build_object(
    'freeClaimAvailable',v_next_free_claim_at is null or v_next_free_claim_at<=now(),
    'lastFreeClaimAt',v_last_free_claim_at,'nextFreeClaimAt',v_next_free_claim_at,
    'cooldownUntil',v_cooldown_until,'zpBalance',coalesce(v_zp_balance,0),
    'costZp',500,'cooldownSeconds',7200,'standardChance',80,'premiumChance',20,
    'adsEnabled',true
  );
end;
$$;