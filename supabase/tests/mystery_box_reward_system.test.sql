-- Post-migration verification for the Stage 6 Mystery Box reward system.
-- Run only after 20261114160000_mystery_box_reward_system.sql is applied.
-- Read-only assertions: this file creates no data and performs no reward claims.

do $$
declare
  v_standard_total integer;
  v_premium_total integer;
begin
  select coalesce(sum(weight_bps), 0)
    into v_standard_total
    from app_private.mystery_box_reward_catalog
    where pool_version = 1 and box_tier = 'standard';

  select coalesce(sum(weight_bps), 0)
    into v_premium_total
    from app_private.mystery_box_reward_catalog
    where pool_version = 1 and box_tier = 'premium';

  if v_standard_total <> 10000 or v_premium_total <> 10000 then
    raise exception 'Each Mystery Box pool must total 10000 basis points';
  end if;

  if exists (
    select 1
    from app_private.mystery_box_reward_catalog
    where pool_version = 1
      and box_tier = 'standard'
      and reward_type <> 'zp'
  ) then
    raise exception 'Standard Box must contain ZP prizes only';
  end if;

  if (select count(*) from app_private.mystery_box_reward_catalog
      where pool_version = 1 and box_tier = 'standard') <> 10 then
    raise exception 'Standard Box must contain exactly ten ZP prize outcomes';
  end if;

  if (select count(*) from app_private.mystery_box_reward_catalog
      where pool_version = 1 and box_tier = 'premium') <> 12 then
    raise exception 'Premium Box must contain ten ZP outcomes and two special outcomes';
  end if;

  if exists (
    select 1
    from (values
      ('standard', 'zp_100', 2000),
      ('standard', 'zp_200', 1800),
      ('standard', 'zp_300', 1500),
      ('standard', 'zp_400', 1200),
      ('standard', 'zp_500', 1000),
      ('standard', 'zp_600',  800),
      ('standard', 'zp_700',  600),
      ('standard', 'zp_800',  500),
      ('standard', 'zp_900',  300),
      ('standard', 'zp_1000', 300),
      ('premium', 'zp_100',  200),
      ('premium', 'zp_200',  300),
      ('premium', 'zp_300',  400),
      ('premium', 'zp_400',  500),
      ('premium', 'zp_500',  600),
      ('premium', 'zp_600',  800),
      ('premium', 'zp_700', 1000),
      ('premium', 'zp_800', 1200),
      ('premium', 'zp_900', 1400),
      ('premium', 'zp_1000',1600),
      ('premium', 'zap_1_10',1000),
      ('premium', 'fragment_mining_2x_6h',1000)
    ) as expected(box_tier, reward_code, weight_bps)
    left join app_private.mystery_box_reward_catalog actual
      on actual.pool_version = 1
     and actual.box_tier = expected.box_tier
     and actual.reward_code = expected.reward_code
    where actual.weight_bps is distinct from expected.weight_bps
  ) then
    raise exception 'Mystery Box reward odds do not match the approved distributions';
  end if;

  if (select sum(weight_bps) from app_private.mystery_box_reward_catalog
      where pool_version = 1 and box_tier = 'standard'
        and amount between 800 and 1000) <> 1100 then
    raise exception 'Standard Box 800-1000 ZP chance must equal 11%%';
  end if;

  if (select sum(weight_bps) from app_private.mystery_box_reward_catalog
      where pool_version = 1 and box_tier = 'premium'
        and amount between 800 and 1000) <> 4200 then
    raise exception 'Premium Box 800-1000 ZP chance must equal 42%%';
  end if;

  if (select weight_bps from app_private.mystery_box_reward_catalog
      where pool_version = 1 and box_tier = 'premium'
        and reward_code = 'zap_1_10') <> 1000 then
    raise exception 'Premium Box ZAP chance must equal 10%%';
  end if;

  if (select weight_bps from app_private.mystery_box_reward_catalog
      where pool_version = 1 and box_tier = 'premium'
        and reward_code = 'fragment_mining_2x_6h') <> 1000 then
    raise exception 'Premium Box Fragment Mining boost chance must equal 10%%';
  end if;

  if has_function_privilege('anon', 'public.grant_mystery_box(uuid,text,text,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.grant_mystery_box(uuid,text,text,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.open_mystery_box(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.open_mystery_box(uuid,uuid)', 'EXECUTE') then
    raise exception 'Mystery Box mutation RPCs must not be executable by client roles';
  end if;

  if not has_function_privilege('service_role', 'public.grant_mystery_box(uuid,text,text,text,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.open_mystery_box(uuid,uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.get_mystery_box_inventory(uuid)', 'EXECUTE') then
    raise exception 'Mystery Box RPCs must be executable by service_role';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app_private'
      and c.relkind = 'r'
      and not c.relrowsecurity
  ) then
    raise exception 'All app_private reward tables must have RLS enabled';
  end if;

  if has_table_privilege('anon', 'app_private.player_reward_entitlements', 'SELECT')
     or has_table_privilege('authenticated', 'app_private.player_reward_entitlements', 'SELECT')
     or has_table_privilege('service_role', 'app_private.player_reward_entitlements', 'SELECT') then
    raise exception 'Reward entitlement table must not be directly readable by API roles';
  end if;
end;
$$;
