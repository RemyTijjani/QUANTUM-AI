-- Generalize referral kickbacks to all trusted mining accrual sources.
ALTER TABLE app_private.referral_kickback_entries
  ALTER COLUMN source_mining_reward_id DROP NOT NULL;
ALTER TABLE app_private.referral_kickback_entries
  ADD COLUMN IF NOT EXISTS source_event_type text;
ALTER TABLE app_private.referral_kickback_entries
  ADD COLUMN IF NOT EXISTS source_event_id uuid;
UPDATE app_private.referral_kickback_entries
SET source_event_type = 'legacy_fragment',
    source_event_id = source_mining_reward_id
WHERE source_event_type IS NULL OR source_event_id IS NULL;
ALTER TABLE app_private.referral_kickback_entries
  ALTER COLUMN source_event_type SET DEFAULT 'legacy_fragment',
  ALTER COLUMN source_event_type SET NOT NULL,
  ALTER COLUMN source_event_id SET NOT NULL;
ALTER TABLE app_private.referral_kickback_entries
  ADD CONSTRAINT referral_kickback_entries_source_event_type_check
  CHECK (source_event_type IN ('legacy_fragment','fragment_accrual','agent_rental','temporary_agent'));
ALTER TABLE app_private.referral_kickback_entries
  ADD CONSTRAINT referral_kickback_entries_source_event_legacy_check
  CHECK ((source_event_type = 'legacy_fragment' AND source_mining_reward_id IS NOT NULL)
      OR (source_event_type <> 'legacy_fragment' AND source_mining_reward_id IS NULL));
ALTER TABLE app_private.referral_kickback_entries
  ADD CONSTRAINT referral_kickback_entries_source_event_recipient_key
  UNIQUE (source_event_type, source_event_id, recipient_player_id, referral_level);

ALTER TABLE app_private.referral_kickback_ledger
  ADD COLUMN IF NOT EXISTS source_event_type text,
  ADD COLUMN IF NOT EXISTS source_event_id uuid;
UPDATE app_private.referral_kickback_ledger l
SET source_event_type = e.source_event_type,
    source_event_id = e.source_event_id
FROM app_private.referral_kickback_entries e
WHERE l.entry_id = e.id
  AND (l.source_event_type IS NULL OR l.source_event_id IS NULL);
UPDATE app_private.referral_kickback_ledger
SET source_event_type = 'legacy_fragment',
    source_event_id = source_mining_reward_id
WHERE source_event_type IS NULL AND source_mining_reward_id IS NOT NULL;
ALTER TABLE app_private.referral_kickback_ledger
  ADD CONSTRAINT referral_kickback_ledger_source_event_type_check
  CHECK (source_event_type IS NULL OR source_event_type IN ('legacy_fragment','fragment_accrual','agent_rental','temporary_agent'));
CREATE INDEX IF NOT EXISTS referral_kickback_ledger_source_event_idx
  ON app_private.referral_kickback_ledger(source_event_type, source_event_id);

CREATE OR REPLACE FUNCTION app_private.record_referral_kickbacks_for_source(
  p_source_event_type text,
  p_source_event_id uuid,
  p_credited_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'app_private', 'pg_temp'
AS $function$
declare
  v_source_player_id uuid;
  v_source_amount numeric(30,9);
  v_earned_at timestamptz;
  v_direct_id uuid;
  v_second_id uuid;
  v_source_status text;
  v_config app_private.referral_kickback_config%rowtype;
  v_recipient record;
  v_recipient_status text;
  v_multiplier numeric(8,4);
  v_amount numeric(24,6);
  v_entry_id uuid;
  v_entry_status text;
  v_source_mining_reward_id uuid;
  v_credited_at timestamptz;
begin
  if p_source_event_id is null or p_credited_at is null then
    return;
  end if;

  case p_source_event_type
    when 'legacy_fragment' then
      select player_id, amount, earned_at
      into v_source_player_id, v_source_amount, v_earned_at
      from public.fragment_mining_rewards
      where id = p_source_event_id and credited_at is not null;
      v_source_mining_reward_id := p_source_event_id;
    when 'fragment_accrual' then
      select player_id, amount, earned_at
      into v_source_player_id, v_source_amount, v_earned_at
      from public.fragment_mining_accruals
      where id = p_source_event_id and credited_at is not null;
    when 'agent_rental' then
      select player_id, amount, period_end
      into v_source_player_id, v_source_amount, v_earned_at
      from public.agent_rental_zp_accruals
      where id = p_source_event_id;
    when 'temporary_agent' then
      select player_id, amount, period_end
      into v_source_player_id, v_source_amount, v_earned_at
      from app_private.player_reward_agent_zp_accruals
      where id = p_source_event_id;
    else
      raise exception 'Unsupported referral mining source';
  end case;

  if not found or v_source_player_id is null or v_source_amount <= 0 or v_earned_at is null then
    return;
  end if;

  v_credited_at := greatest(p_credited_at, v_earned_at);

  select status into v_source_status
  from app_private.referral_kickback_account_controls
  where player_id = v_source_player_id;
  if coalesce(v_source_status, 'active') <> 'active' then
    return;
  end if;

  -- Only referral relationships that existed when this mining period ended are eligible.
  select referrer_id into v_direct_id
  from public.referral_sub_nodes
  where recruit_id = v_source_player_id
    and created_at <= v_earned_at
  order by created_at asc
  limit 1;

  if v_direct_id is null or v_direct_id = v_source_player_id then
    return;
  end if;

  select referrer_id into v_second_id
  from public.referral_sub_nodes
  where recruit_id = v_direct_id
    and created_at <= v_earned_at
  order by created_at asc
  limit 1;

  select * into v_config
  from app_private.referral_kickback_config
  where singleton = true;

  if not found then
    return;
  end if;

  for v_recipient in
    select 1 as referral_level, v_direct_id as recipient_id, v_config.direct_rate as rate
    union all
    select 2, v_second_id, v_config.second_level_rate
    where v_second_id is not null and v_second_id <> v_direct_id
  loop
    if v_recipient.recipient_id is null
       or v_recipient.recipient_id = v_source_player_id then
      continue;
    end if;

    select status into v_recipient_status
    from app_private.referral_kickback_account_controls
    where player_id = v_recipient.recipient_id;

    if coalesce(v_recipient_status, 'active') = 'suspended' then
      continue;
    end if;
    v_entry_status := case when coalesce(v_recipient_status, 'active') = 'active'
      then 'pending' else 'held' end;

    v_multiplier := case when exists (
      select 1
      from public.player_agent_rentals r
      where r.player_id = v_recipient.recipient_id
        and r.agent_type = 'overclocked_core'
        and r.status = 'active'
        and r.starts_at <= v_earned_at
        and r.expires_at > v_earned_at
    ) then v_config.overclock_multiplier else 1 end;

    v_amount := round(v_source_amount * v_recipient.rate * v_multiplier, 6);
    if v_amount <= 0 then
      continue;
    end if;

    insert into app_private.referral_kickback_entries (
      recipient_player_id, source_player_id, source_mining_reward_id,
      source_event_type, source_event_id,
      referral_level, base_rate, overclock_multiplier, amount,
      eligible_at, status
    ) values (
      v_recipient.recipient_id, v_source_player_id, v_source_mining_reward_id,
      p_source_event_type, p_source_event_id,
      v_recipient.referral_level, v_recipient.rate, v_multiplier, v_amount,
      v_credited_at + make_interval(hours => v_config.pending_hours),
      v_entry_status
    )
    on conflict (source_event_type, source_event_id, recipient_player_id, referral_level)
    do nothing
    returning id into v_entry_id;

    if v_entry_id is not null then
      insert into app_private.referral_kickback_ledger (
        entry_id, player_id, event_type, amount, source_mining_reward_id,
        source_event_type, source_event_id, metadata
      ) values (
        v_entry_id, v_recipient.recipient_id,
        case when v_entry_status = 'held' then 'held' else 'accrued' end,
        v_amount, v_source_mining_reward_id,
        p_source_event_type, p_source_event_id,
        jsonb_build_object(
          'sourceEventType', p_source_event_type,
          'sourceEventId', p_source_event_id,
          'referralLevel', v_recipient.referral_level,
          'baseRate', v_recipient.rate,
          'overclockMultiplier', v_multiplier,
          'miningEarnedAt', v_earned_at,
          'miningCreditedAt', v_credited_at,
          'eligibleAt', v_credited_at + make_interval(hours => v_config.pending_hours)
        )
      );
    end if;
    v_entry_id := null;
  end loop;
end;
$function$;

REVOKE ALL ON FUNCTION app_private.record_referral_kickbacks_for_source(text,uuid,timestamptz) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.record_referral_kickbacks_for_mining(p_reward_id uuid, p_credited_at timestamptz)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private', 'pg_temp'
AS $function$
begin
  perform app_private.record_referral_kickbacks_for_source('legacy_fragment', p_reward_id, p_credited_at);
end;
$function$;
CREATE OR REPLACE FUNCTION app_private.allocate_referral_kickbacks()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'app_private', 'pg_temp'
AS $function$
declare
  v_month date;
  v_budget app_private.referral_kickback_month_budgets%rowtype;
  v_entry app_private.referral_kickback_entries%rowtype;
  v_remaining numeric(24,6);
  v_to_allocate numeric(24,6);
  v_control_status text;
  v_allocated_total numeric(24,6) := 0;
begin
  v_month := app_private.ensure_referral_kickback_month();

  -- Release holds only after an Admin changes the account back to active.
  update app_private.referral_kickback_entries e
  set status = 'pending', updated_at = now()
  where e.status = 'held'
    and coalesce((
      select c.status from app_private.referral_kickback_account_controls c
      where c.player_id = e.recipient_player_id
    ), 'active') = 'active';

  -- Mature the 24-hour hold. The timer was set from the actual mining-credit time.
  update app_private.referral_kickback_entries e
  set status = 'verified', updated_at = now()
  where e.status = 'pending'
    and e.eligible_at <= now()
    and coalesce((
      select c.status from app_private.referral_kickback_account_controls c
      where c.player_id = e.recipient_player_id
    ), 'active') = 'active';

  insert into app_private.referral_kickback_ledger (
    entry_id, player_id, event_type, amount, source_mining_reward_id, source_event_type, source_event_id
  )
  select e.id, e.recipient_player_id, 'verified', e.amount, e.source_mining_reward_id, e.source_event_type, e.source_event_id
  from app_private.referral_kickback_entries e
  where e.status = 'verified'
    and e.eligible_at <= now()
    and not exists (
      select 1 from app_private.referral_kickback_ledger l
      where l.entry_id = e.id and l.event_type = 'verified'
    );

  select * into v_budget
  from app_private.referral_kickback_month_budgets
  where month_start = v_month
  for update;

  v_remaining := greatest(v_budget.budget_zp - v_budget.allocated_zp, 0);

  for v_entry in
    select *
    from app_private.referral_kickback_entries
    where status = 'verified'
      and allocated_amount < amount
      and eligible_at <= now()
    order by eligible_at asc, created_at asc, id asc
    for update
  loop
    exit when v_remaining <= 0;

    v_to_allocate := least(v_entry.amount - v_entry.allocated_amount, v_remaining);
    if v_to_allocate <= 0 then
      continue;
    end if;

    update app_private.referral_kickback_entries
    set allocated_amount = allocated_amount + v_to_allocate,
        updated_at = now()
    where id = v_entry.id;

    insert into app_private.referral_kickback_ledger (
      entry_id, player_id, event_type, amount, source_mining_reward_id,
      source_event_type, source_event_id, budget_month
    ) values (
      v_entry.id, v_entry.recipient_player_id, 'allocated', v_to_allocate,
      v_entry.source_mining_reward_id, v_entry.source_event_type, v_entry.source_event_id, v_month
    );

    v_remaining := v_remaining - v_to_allocate;
    v_allocated_total := v_allocated_total + v_to_allocate;
  end loop;

  update app_private.referral_kickback_month_budgets
  set allocated_zp = allocated_zp + v_allocated_total,
      updated_at = now()
  where month_start = v_month;

  return jsonb_build_object(
    'monthStart', v_month,
    'budgetZp', v_budget.budget_zp,
    'allocatedThisRun', v_allocated_total,
    'remainingBudgetZp', greatest(v_budget.budget_zp - v_budget.allocated_zp - v_allocated_total, 0)
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION app_private.get_player_referral_kickbacks(p_player_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'app_private', 'pg_temp'
AS $function$
declare
  v_claimable numeric(24,6);
  v_pending numeric(24,6);
  v_lifetime numeric(24,6);
  v_claimed numeric(24,6);
  v_recent jsonb;
begin
  if p_player_id is null then raise exception 'Player ID is required'; end if;
  perform app_private.allocate_referral_kickbacks();

  select
    coalesce(sum(greatest(allocated_amount - claimed_amount, 0)), 0),
    coalesce(sum(case when status in ('pending', 'verified', 'held')
      then greatest(amount - allocated_amount, 0) else 0 end), 0),
    coalesce(sum(case when status <> 'reversed' then amount else 0 end), 0)
  into v_claimable, v_pending, v_lifetime
  from app_private.referral_kickback_entries
  where recipient_player_id = p_player_id;

  select coalesce(sum(amount), 0) into v_claimed
  from app_private.referral_kickback_claims
  where player_id = p_player_id;

  select coalesce(jsonb_agg(x.item order by x.created_at desc), '[]'::jsonb)
  into v_recent
  from (
    select
      l.created_at,
      jsonb_build_object(
        'id', l.id,
        'eventType', l.event_type,
        'amount', l.amount,
        'createdAt', l.created_at,
        'referralLevel', e.referral_level,
        'status', e.status,
        'sourceEventType', e.source_event_type,
        'sourceEventId', e.source_event_id
      ) as item
    from app_private.referral_kickback_ledger l
    left join app_private.referral_kickback_entries e on e.id = l.entry_id
    where l.player_id = p_player_id
    order by l.created_at desc
    limit 20
  ) x;

  return jsonb_build_object(
    'pendingZp', v_pending,
    'claimableZp', v_claimable,
    'claimableWholeZp', floor(v_claimable),
    'lifetimeEarnedZp', v_lifetime,
    'lifetimeClaimedZp', v_claimed,
    'recentActivity', v_recent
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION app_private.claim_player_referral_kickbacks(p_player_id uuid, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private', 'pg_temp'
AS $function$
declare
  v_existing app_private.referral_kickback_claims%rowtype;
  v_claim_id uuid;
  v_claim_amount numeric(24,6);
  v_remaining numeric(24,6);
  v_take numeric(24,6);
  v_entry app_private.referral_kickback_entries%rowtype;
  v_balance numeric(18,2);
begin
  if p_player_id is null
     or nullif(trim(p_idempotency_key), '') is null
     or length(p_idempotency_key) > 128 then
    raise exception 'A valid claim request is required';
  end if;

  perform app_private.allocate_referral_kickbacks();

  insert into public.player_economy (player_id, zp_balance, lifetime_zp, pending_kickback)
  values (p_player_id, 0, 0, 0)
  on conflict (player_id) do nothing;

  perform 1 from public.player_economy where player_id = p_player_id for update;

  select * into v_existing
  from app_private.referral_kickback_claims
  where player_id = p_player_id and idempotency_key = trim(p_idempotency_key);

  if found then
    select zp_balance into v_balance
    from public.player_economy where player_id = p_player_id;
    return jsonb_build_object(
      'success', true, 'alreadyClaimed', true,
      'claimId', v_existing.id, 'claimedZp', v_existing.amount,
      'zpBalance', v_balance
    );
  end if;

  select floor(coalesce(sum(allocated_amount - claimed_amount), 0))
  into v_claim_amount
  from app_private.referral_kickback_entries
  where recipient_player_id = p_player_id
    and status <> 'reversed'
    and allocated_amount > claimed_amount;

  if v_claim_amount < 1 then
    return jsonb_build_object('success', false, 'reason', 'no_whole_zp_available');
  end if;

  insert into app_private.referral_kickback_claims (player_id, idempotency_key, amount)
  values (p_player_id, trim(p_idempotency_key), v_claim_amount)
  returning id into v_claim_id;

  v_remaining := v_claim_amount;
  for v_entry in
    select *
    from app_private.referral_kickback_entries
    where recipient_player_id = p_player_id
      and status <> 'reversed'
      and allocated_amount > claimed_amount
    order by eligible_at asc, created_at asc, id asc
    for update
  loop
    exit when v_remaining <= 0;
    v_take := least(v_entry.allocated_amount - v_entry.claimed_amount, v_remaining);
    if v_take <= 0 then continue; end if;

    update app_private.referral_kickback_entries
    set claimed_amount = claimed_amount + v_take,
        updated_at = now()
    where id = v_entry.id;

    insert into app_private.referral_kickback_ledger (
      entry_id, player_id, event_type, amount, source_mining_reward_id,
      source_event_type, source_event_id, claim_id
    ) values (
      v_entry.id, p_player_id, 'claimed', v_take,
      v_entry.source_mining_reward_id, v_entry.source_event_type, v_entry.source_event_id, v_claim_id
    );

    v_remaining := v_remaining - v_take;
  end loop;

  update public.player_economy
  set zp_balance = zp_balance + v_claim_amount,
      lifetime_zp = lifetime_zp + v_claim_amount,
      updated_at = now()
  where player_id = p_player_id
  returning zp_balance into v_balance;

  insert into public.economy_ledger (
    player_id, transaction_type, amount, balance_after, reference_id, description
  ) values (
    p_player_id, 'referral_kickback_claim', v_claim_amount, v_balance,
    v_claim_id::text, 'Manually claimed verified referral kickbacks'
  );

  return jsonb_build_object(
    'success', true, 'alreadyClaimed', false,
    'claimId', v_claim_id, 'claimedZp', v_claim_amount,
    'zpBalance', v_balance
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.release_fragment_mining_accruals(p_player_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_reward public.fragment_mining_accruals%rowtype;
  v_balance numeric(18,2);
  v_count integer := 0;
  v_total numeric(18,2) := 0;
  v_credited_at timestamptz;
begin
  if p_player_id is null then
    raise exception 'Player ID is required';
  end if;

  insert into public.player_economy (player_id, zp_balance, lifetime_zp, pending_kickback)
  values (p_player_id, 0, 0, 0)
  on conflict (player_id) do nothing;

  perform 1 from public.player_economy
  where player_id = p_player_id
  for update;

  for v_reward in
    select *
    from public.fragment_mining_accruals
    where player_id = p_player_id
      and credited_at is null
      and release_at <= clock_timestamp()
    order by release_at, id
    for update
  loop
    update public.player_economy
    set zp_balance = coalesce(zp_balance, 0) + v_reward.amount,
        lifetime_zp = coalesce(lifetime_zp, 0) + v_reward.amount,
        updated_at = clock_timestamp()
    where player_id = p_player_id
    returning zp_balance into v_balance;

    insert into public.economy_ledger (
      player_id, transaction_type, amount, balance_after, reference_id, description
    ) values (
      p_player_id, 'fragment_mining_reward', v_reward.amount, v_balance,
      v_reward.id::text,
      'Verified ZP from ' || upper(v_reward.fragment_id) || ' Fragment mining (six-hour hold completed)'
    );

    update public.fragment_mining_accruals
    set credited_at = clock_timestamp()
    where id = v_reward.id and credited_at is null
    returning credited_at into v_credited_at;

    if v_credited_at is not null then
      perform app_private.record_referral_kickbacks_for_source('fragment_accrual', v_reward.id, v_credited_at);
    end if;

    v_count := v_count + 1;
    v_total := v_total + v_reward.amount;
  end loop;

  return jsonb_build_object('success', true, 'creditedCount', v_count, 'creditedAmount', v_total);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.accrue_agent_rental_zp(p_player_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_rental public.player_agent_rentals%rowtype;
  v_start timestamptz;
  v_end timestamptz;
  v_now timestamptz := clock_timestamp();
  v_rate numeric(8, 3);
  v_amount numeric(30, 9);
  v_accrual_id uuid;
  v_balance numeric;
  v_credited_count integer := 0;
  v_expired_count integer := 0;
  v_total numeric(30, 9) := 0;
  v_temporary_result jsonb;
begin
  if p_player_id is not null
     and not exists (select 1 from public.players p where p.id = p_player_id) then
    raise exception 'Player was not found';
  end if;

  for v_rental in
    select r.*
    from public.player_agent_rentals r
    where r.status = 'active'
      and (p_player_id is null or r.player_id = p_player_id)
      and (
        r.accrued_through < least(v_now, r.expires_at)
        or r.expires_at <= v_now
      )
    order by r.player_id, r.agent_type, r.id
    for update skip locked
  loop
    v_start := v_rental.accrued_through;
    v_end := least(v_now, v_rental.expires_at);
    v_rate := case v_rental.agent_type
      when 'alpha_miner' then 0.100
      when 'overclocked_core' then 0.300
    end;

    if v_end > v_start then
      v_amount := round(extract(epoch from (v_end - v_start))::numeric * v_rate, 9);

      if v_amount > 0 then
        insert into public.agent_rental_zp_accruals (
          rental_id, player_id, period_start, period_end, rate_per_second, amount
        ) values (
          v_rental.id, v_rental.player_id, v_start, v_end, v_rate, v_amount
        )
        on conflict (rental_id, period_start, period_end) do nothing
        returning id into v_accrual_id;

        if v_accrual_id is not null then
          insert into public.player_economy (player_id, zp_balance, lifetime_zp, pending_kickback)
          values (v_rental.player_id, 0, 0, 0)
          on conflict (player_id) do nothing;

          perform 1
          from public.player_economy
          where player_id = v_rental.player_id
          for update;

          update public.player_economy
          set zp_balance = coalesce(zp_balance, 0) + v_amount,
              lifetime_zp = coalesce(lifetime_zp, 0) + v_amount,
              updated_at = v_now
          where player_id = v_rental.player_id
          returning zp_balance into v_balance;

          insert into public.economy_ledger (
            player_id, transaction_type, amount, balance_after, reference_id, description
          ) values (
            v_rental.player_id,
            'agent_rental_mining_reward',
            v_amount,
            v_balance,
            'agent_rental_accrual:' || v_accrual_id::text,
            case v_rental.agent_type
              when 'alpha_miner' then 'Verified Alpha Miner rental accrual (0.1 ZP/second)'
              else 'Verified Overclocked Core rental accrual (0.3 ZP/second)'
            end
          );

          perform app_private.record_referral_kickbacks_for_source('agent_rental', v_accrual_id, v_now);

          v_credited_count := v_credited_count + 1;
          v_total := v_total + v_amount;
        end if;
      end if;
    end if;

    update public.player_agent_rentals
    set accrued_through = greatest(accrued_through, v_end),
        status = case when expires_at <= v_now then 'expired' else 'active' end,
        updated_at = v_now
    where id = v_rental.id;

    if v_rental.expires_at <= v_now then
      v_expired_count := v_expired_count + 1;
    end if;

    v_accrual_id := null;
  end loop;

  v_temporary_result := public.accrue_temporary_agent_zp(p_player_id);

  return jsonb_build_object(
    'success', true,
    'creditedCount', v_credited_count,
    'creditedAmount', v_total,
    'expiredCount', v_expired_count,
    'temporaryAgent', v_temporary_result
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.accrue_temporary_agent_zp(p_player_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private', 'pg_temp'
AS $function$
declare
  v_entitlement app_private.player_reward_entitlements%rowtype;
  v_start timestamptz;
  v_end timestamptz;
  v_now timestamptz := clock_timestamp();
  v_rate numeric(8,3) := 0.100;
  v_amount numeric(30,9);
  v_accrual_id uuid;
  v_balance numeric;
  v_credited_count integer := 0;
  v_expired_count integer := 0;
  v_total numeric(30,9) := 0;
begin
  if p_player_id is not null
     and not exists (select 1 from public.players p where p.id = p_player_id) then
    raise exception 'Player was not found';
  end if;

  for v_entitlement in
    select e.*
    from app_private.player_reward_entitlements e
    where e.reward_type = 'daily_streak_agent'
      and e.reward_code = 'free_agent_1_24h'
      and e.status in ('active', 'expired')
      and e.activated_at is not null
      and e.expires_at is not null
      and e.expires_at > e.activated_at
      and (p_player_id is null or e.player_id = p_player_id)
      and least(v_now, e.expires_at) > coalesce(
        (select max(a.period_end)
         from app_private.player_reward_agent_zp_accruals a
         where a.entitlement_id = e.id),
        e.activated_at
      )
    order by e.player_id, e.activated_at, e.id
    for update of e skip locked
  loop
    select coalesce(max(a.period_end), v_entitlement.activated_at)
      into v_start
    from app_private.player_reward_agent_zp_accruals a
    where a.entitlement_id = v_entitlement.id;

    v_end := least(v_now, v_entitlement.expires_at);
    if v_end > v_start then
      v_amount := round(extract(epoch from (v_end - v_start))::numeric * v_rate, 9);

      if v_amount > 0 then
        insert into app_private.player_reward_agent_zp_accruals (
          entitlement_id, player_id, period_start, period_end, rate_per_second, amount
        ) values (
          v_entitlement.id, v_entitlement.player_id, v_start, v_end, v_rate, v_amount
        )
        on conflict (entitlement_id, period_start, period_end) do nothing
        returning id into v_accrual_id;

        if v_accrual_id is not null then
          insert into public.player_economy (player_id, zp_balance, lifetime_zp, pending_kickback)
          values (v_entitlement.player_id, 0, 0, 0)
          on conflict (player_id) do nothing;

          perform 1
          from public.player_economy
          where player_id = v_entitlement.player_id
          for update;

          update public.player_economy
          set zp_balance = coalesce(zp_balance, 0) + v_amount,
              lifetime_zp = coalesce(lifetime_zp, 0) + v_amount,
              updated_at = v_now
          where player_id = v_entitlement.player_id
          returning zp_balance into v_balance;

          insert into public.economy_ledger (
            player_id, transaction_type, amount, balance_after, reference_id, description
          ) values (
            v_entitlement.player_id,
            'daily_streak_agent_mining_reward',
            v_amount,
            v_balance,
            'daily_streak_agent_accrual:' || v_accrual_id::text,
            'Free Alpha Miner reward accrual (0.1 ZP/second for up to 24 hours)'
          );

          perform app_private.record_referral_kickbacks_for_source('temporary_agent', v_accrual_id, v_now);

          v_credited_count := v_credited_count + 1;
          v_total := v_total + v_amount;
        end if;
      end if;
    end if;

    if v_entitlement.expires_at <= v_now and v_entitlement.status = 'active' then
      update app_private.player_reward_entitlements
      set status = 'expired'
      where id = v_entitlement.id and status = 'active';
      v_expired_count := v_expired_count + 1;
    end if;

    v_accrual_id := null;
  end loop;

  return jsonb_build_object(
    'success', true,
    'creditedCount', v_credited_count,
    'creditedAmount', v_total,
    'expiredCount', v_expired_count
  );
end;
$function$
;
