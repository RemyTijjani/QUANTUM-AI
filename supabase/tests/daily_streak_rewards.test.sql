-- Read-only checks for the trusted Daily Streak reward system.
-- Does not create player state, claim rewards, or change balances.

do $$
begin
  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app_private'
      and c.relname = 'player_daily_streak_state'
      and c.relrowsecurity
  ) then
    raise exception 'Daily Streak state must have RLS enabled';
  end if;

  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app_private'
      and c.relname = 'daily_streak_claims'
      and c.relrowsecurity
  ) then
    raise exception 'Daily Streak claims must have RLS enabled';
  end if;

  if has_table_privilege('anon', 'app_private.player_daily_streak_state', 'SELECT')
     or has_table_privilege('authenticated', 'app_private.player_daily_streak_state', 'SELECT')
     or has_table_privilege('service_role', 'app_private.player_daily_streak_state', 'SELECT')
     or has_table_privilege('anon', 'app_private.daily_streak_claims', 'SELECT')
     or has_table_privilege('authenticated', 'app_private.daily_streak_claims', 'SELECT')
     or has_table_privilege('service_role', 'app_private.daily_streak_claims', 'SELECT') then
    raise exception 'Daily Streak private tables must not be directly readable by API roles';
  end if;

  if has_function_privilege('anon', 'public.claim_daily_streak(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.claim_daily_streak(uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.claim_daily_streak(uuid)', 'EXECUTE') then
    raise exception 'Daily Streak claim RPC must be service_role-only';
  end if;

  if has_function_privilege('anon', 'public.get_daily_streak_state(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.get_daily_streak_state(uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.get_daily_streak_state(uuid)', 'EXECUTE') then
    raise exception 'Daily Streak state RPC must be service_role-only';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'app_private.daily_streak_claims'::regclass
      and conname = 'daily_streak_claims_player_id_claim_date_key'
  ) then
    raise exception 'Daily Streak must enforce one claim per player per UTC date';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'app_private.player_reward_entitlements'::regclass
      and conname = 'player_reward_entitlements_reward_type_check'
      and pg_get_constraintdef(oid) like '%daily_streak_agent%'
  ) then
    raise exception 'Daily Streak Agent 1 entitlement type is not enabled';
  end if;

  if position('3500' in pg_get_functiondef('public.claim_daily_streak(uuid)'::regprocedure)) = 0
     or position('3400' in pg_get_functiondef('public.claim_daily_streak(uuid)'::regprocedure)) = 0
     or position('3000' in pg_get_functiondef('public.claim_daily_streak(uuid)'::regprocedure)) = 0
     or position('9900' in pg_get_functiondef('public.claim_daily_streak(uuid)'::regprocedure)) = 0 then
    raise exception 'Daily Streak reward draw buckets do not match approved 35/34/30/1 odds';
  end if;
end;
$$;
