-- Secure ZORD referral kickback foundation.
-- New kickbacks are generated only from trusted Fragment mining credits after
-- this migration. Existing local/client-side estimates are never backfilled.
-- Monthly budget defaults to zero until an Admin explicitly configures it.

create table if not exists app_private.referral_kickback_config (
  singleton boolean primary key default true check (singleton),
  direct_rate numeric(8,6) not null default 0.05 check (direct_rate = 0.05),
  second_level_rate numeric(8,6) not null default 0.01 check (second_level_rate = 0.01),
  overclock_multiplier numeric(8,4) not null default 2 check (overclock_multiplier = 2),
  pending_hours integer not null default 24 check (pending_hours = 24),
  monthly_budget_zp numeric(24,6) not null default 0 check (monthly_budget_zp >= 0),
  updated_by text,
  updated_at timestamptz not null default now()
);

insert into app_private.referral_kickback_config (singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists app_private.referral_kickback_month_budgets (
  month_start date primary key,
  budget_zp numeric(24,6) not null check (budget_zp >= 0),
  allocated_zp numeric(24,6) not null default 0 check (allocated_zp >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (allocated_zp >= 0)
);

create table if not exists app_private.referral_kickback_account_controls (
  player_id uuid primary key references public.players(id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'held', 'suspended')),
  reason text,
  updated_by text,
  updated_at timestamptz not null default now()
);

create table if not exists app_private.referral_kickback_entries (
  id uuid primary key default gen_random_uuid(),
  recipient_player_id uuid not null references public.players(id) on delete restrict,
  source_player_id uuid not null references public.players(id) on delete restrict,
  source_mining_reward_id uuid not null references public.fragment_mining_rewards(id) on delete restrict,
  referral_level smallint not null check (referral_level in (1, 2)),
  base_rate numeric(8,6) not null check (base_rate in (0.05, 0.01)),
  overclock_multiplier numeric(8,4) not null check (overclock_multiplier in (1, 2)),
  amount numeric(24,6) not null check (amount > 0),
  eligible_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'held', 'reversed')),
  allocated_amount numeric(24,6) not null default 0,
  claimed_amount numeric(24,6) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_mining_reward_id, recipient_player_id, referral_level),
  check (allocated_amount >= 0 and allocated_amount <= amount),
  check (claimed_amount >= 0 and claimed_amount <= allocated_amount)
);

create index if not exists referral_kickback_entries_player_idx
  on app_private.referral_kickback_entries (recipient_player_id, eligible_at desc);
create index if not exists referral_kickback_entries_queue_idx
  on app_private.referral_kickback_entries (eligible_at, id)
  where status in ('pending', 'verified');

create table if not exists app_private.referral_kickback_claims (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete restrict,
  idempotency_key text not null,
  amount numeric(24,6) not null check (amount > 0 and amount = trunc(amount)),
  created_at timestamptz not null default now(),
  unique (player_id, idempotency_key)
);

create table if not exists app_private.referral_kickback_ledger (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid references app_private.referral_kickback_entries(id) on delete restrict,
  player_id uuid not null references public.players(id) on delete restrict,
  event_type text not null check (event_type in ('accrued', 'held', 'verified', 'allocated', 'claimed', 'reversed')),
  amount numeric(24,6) not null,
  source_mining_reward_id uuid references public.fragment_mining_rewards(id) on delete restrict,
  claim_id uuid references app_private.referral_kickback_claims(id) on delete restrict,
  budget_month date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists referral_kickback_ledger_player_idx
  on app_private.referral_kickback_ledger (player_id, created_at desc);

create table if not exists app_private.referral_kickback_budget_history (
  id uuid primary key default gen_random_uuid(),
  month_start date not null,
  old_budget_zp numeric(24,6) not null,
  new_budget_zp numeric(24,6) not null,
  admin_username text not null,
  created_at timestamptz not null default now()
);

alter table app_private.referral_kickback_config enable row level security;
alter table app_private.referral_kickback_month_budgets enable row level security;
alter table app_private.referral_kickback_account_controls enable row level security;
alter table app_private.referral_kickback_entries enable row level security;
alter table app_private.referral_kickback_claims enable row level security;
alter table app_private.referral_kickback_ledger enable row level security;
alter table app_private.referral_kickback_budget_history enable row level security;

revoke all on app_private.referral_kickback_config,
  app_private.referral_kickback_month_budgets,
  app_private.referral_kickback_account_controls,
  app_private.referral_kickback_entries,
  app_private.referral_kickback_claims,
  app_private.referral_kickback_ledger,
  app_private.referral_kickback_budget_history
from public, anon, authenticated, service_role;

create or replace function app_private.ensure_referral_kickback_month()
returns date
language plpgsql
security definer
set search_path = pg_catalog, app_private, pg_temp
as $$
declare
  v_month date := date_trunc('month', timezone('utc', now()))::date;
  v_budget numeric(24,6);
begin
  select monthly_budget_zp into v_budget
  from app_private.referral_kickback_config
  where singleton = true;

  insert into app_private.referral_kickback_month_budgets (month_start, budget_zp)
  values (v_month, coalesce(v_budget, 0))
  on conflict (month_start) do nothing;

  return v_month;
end;
$$;

create or replace function app_private.record_referral_kickbacks_for_mining(
  p_reward_id uuid,
  p_credited_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $$
declare
  v_reward public.fragment_mining_rewards%rowtype;
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
begin
  select * into v_reward
  from public.fragment_mining_rewards
  where id = p_reward_id;

  if not found or p_credited_at is null then
    return;
  end if;

  select status into v_source_status
  from app_private.referral_kickback_account_controls
  where player_id = v_reward.player_id;
  if coalesce(v_source_status, 'active') <> 'active' then
    return;
  end if;

  -- Only referral relationships that existed when this mining reward was earned
  -- are eligible. This prevents retroactive sponsor changes or commissions.
  select referrer_id into v_direct_id
  from public.referral_sub_nodes
  where recruit_id = v_reward.player_id
    and created_at <= v_reward.earned_at
  order by created_at asc
  limit 1;

  if v_direct_id is null or v_direct_id = v_reward.player_id then
    return;
  end if;

  select referrer_id into v_second_id
  from public.referral_sub_nodes
  where recruit_id = v_direct_id
    and created_at <= v_reward.earned_at
  order by created_at asc
  limit 1;

  select * into v_config
  from app_private.referral_kickback_config
  where singleton = true;

  for v_recipient in
    select 1 as referral_level, v_direct_id as recipient_id, v_config.direct_rate as rate
    union all
    select 2, v_second_id, v_config.second_level_rate
    where v_second_id is not null and v_second_id <> v_direct_id
  loop
    if v_recipient.recipient_id is null
       or v_recipient.recipient_id = v_reward.player_id then
      continue;
    end if;

    select status into v_recipient_status
    from app_private.referral_kickback_account_controls
    where player_id = v_recipient.recipient_id;

    -- A suspended recipient earns no new kickbacks. A held account may
    -- accrue a reward, but it remains held until an Admin completes review.
    if coalesce(v_recipient_status, 'active') = 'suspended' then
      continue;
    end if;
    v_entry_status := case when coalesce(v_recipient_status, 'active') = 'active'
      then 'pending' else 'held' end;

    -- Overclock is checked against the recipient's verified rental at the
    -- mining event's earned_at timestamp, never against client state or claim time.
    v_multiplier := case when exists (
      select 1
      from public.player_agent_rentals r
      where r.player_id = v_recipient.recipient_id
        and r.agent_type = 'overclocked_core'
        and r.status = 'active'
        and r.starts_at <= v_reward.earned_at
        and r.expires_at > v_reward.earned_at
    ) then v_config.overclock_multiplier else 1 end;

    v_amount := round(v_reward.amount * v_recipient.rate * v_multiplier, 6);
    if v_amount <= 0 then
      continue;
    end if;

    insert into app_private.referral_kickback_entries (
      recipient_player_id, source_player_id, source_mining_reward_id,
      referral_level, base_rate, overclock_multiplier, amount,
      eligible_at, status
    ) values (
      v_recipient.recipient_id, v_reward.player_id, v_reward.id,
      v_recipient.referral_level, v_recipient.rate, v_multiplier, v_amount,
      p_credited_at + make_interval(hours => v_config.pending_hours),
      v_entry_status
    )
    on conflict (source_mining_reward_id, recipient_player_id, referral_level)
    do nothing
    returning id into v_entry_id;

    if v_entry_id is not null then
      insert into app_private.referral_kickback_ledger (
        entry_id, player_id, event_type, amount, source_mining_reward_id,
        metadata
      ) values (
        v_entry_id, v_recipient.recipient_id,
        case when v_entry_status = 'held' then 'held' else 'accrued' end,
        v_amount, v_reward.id,
        jsonb_build_object(
          'referralLevel', v_recipient.referral_level,
          'baseRate', v_recipient.rate,
          'overclockMultiplier', v_multiplier,
          'miningEarnedAt', v_reward.earned_at,
          'miningCreditedAt', p_credited_at,
          'eligibleAt', p_credited_at + make_interval(hours => v_config.pending_hours)
        )
      );
    end if;
    v_entry_id := null;
  end loop;
end;
$$;

create or replace function app_private.allocate_referral_kickbacks()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private, pg_temp
as $$
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
    entry_id, player_id, event_type, amount, source_mining_reward_id
  )
  select e.id, e.recipient_player_id, 'verified', e.amount, e.source_mining_reward_id
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
      entry_id, player_id, event_type, amount, source_mining_reward_id, budget_month
    ) values (
      v_entry.id, v_entry.recipient_player_id, 'allocated', v_to_allocate,
      v_entry.source_mining_reward_id, v_month
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
$$;

create or replace function app_private.get_player_referral_kickbacks(p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private, pg_temp
as $$
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
        'status', e.status
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
$$;

create or replace function app_private.claim_player_referral_kickbacks(
  p_player_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $$
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
      entry_id, player_id, event_type, amount, source_mining_reward_id, claim_id
    ) values (
      v_entry.id, p_player_id, 'claimed', v_take,
      v_entry.source_mining_reward_id, v_claim_id
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
$$;

create or replace function public.get_player_referral_kickbacks(p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $$
begin
  return app_private.get_player_referral_kickbacks(p_player_id);
end;
$$;

create or replace function public.claim_player_referral_kickbacks(
  p_player_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $$
begin
  return app_private.claim_player_referral_kickbacks(p_player_id, p_idempotency_key);
end;
$$;

create or replace function public.admin_get_referral_kickback_budget()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $$
declare
  v_month date;
  v_budget app_private.referral_kickback_month_budgets%rowtype;
  v_summary jsonb;
begin
  v_month := app_private.ensure_referral_kickback_month();
  perform app_private.allocate_referral_kickbacks();
  select * into v_budget
  from app_private.referral_kickback_month_budgets
  where month_start = v_month;

  select jsonb_build_object(
    'pendingZp', coalesce(sum(case when status = 'pending' then amount - allocated_amount else 0 end), 0),
    'verifiedUnfundedZp', coalesce(sum(case when status = 'verified' then amount - allocated_amount else 0 end), 0),
    'heldZp', coalesce(sum(case when status = 'held' then amount - allocated_amount else 0 end), 0),
    'claimableZp', coalesce(sum(allocated_amount - claimed_amount), 0),
    'claimedZp', coalesce((select sum(amount) from app_private.referral_kickback_claims), 0),
    'lifetimeGeneratedZp', coalesce(sum(case when status <> 'reversed' then amount else 0 end), 0)
  ) into v_summary
  from app_private.referral_kickback_entries;

  return jsonb_build_object(
    'monthStart', v_month,
    'monthlyBudgetZp', v_budget.budget_zp,
    'allocatedZp', v_budget.allocated_zp,
    'remainingBudgetZp', greatest(v_budget.budget_zp - v_budget.allocated_zp, 0),
    'summary', v_summary
  );
end;
$$;

create or replace function public.admin_set_referral_kickback_budget(
  p_budget_zp numeric,
  p_admin_username text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $$
declare
  v_month date;
  v_old numeric(24,6);
  v_allocated numeric(24,6);
begin
  if p_budget_zp is null
     or p_budget_zp < 0
     or p_budget_zp::text in ('NaN', 'Infinity', '-Infinity')
     or nullif(trim(p_admin_username), '') is null then
    raise exception 'A valid budget and Admin identity are required';
  end if;

  v_month := app_private.ensure_referral_kickback_month();
  select budget_zp, allocated_zp into v_old, v_allocated
  from app_private.referral_kickback_month_budgets
  where month_start = v_month
  for update;

  if p_budget_zp < v_allocated then
    raise exception 'The budget cannot be reduced below ZP already allocated to players';
  end if;

  update app_private.referral_kickback_config
  set monthly_budget_zp = p_budget_zp,
      updated_by = trim(p_admin_username),
      updated_at = now()
  where singleton = true;

  update app_private.referral_kickback_month_budgets
  set budget_zp = p_budget_zp, updated_at = now()
  where month_start = v_month;

  insert into app_private.referral_kickback_budget_history (
    month_start, old_budget_zp, new_budget_zp, admin_username
  ) values (
    v_month, v_old, p_budget_zp, trim(p_admin_username)
  );

  perform app_private.allocate_referral_kickbacks();

  return public.admin_get_referral_kickback_budget();
end;
$$;

create or replace function public.admin_set_referral_kickback_account_status(
  p_player_id uuid,
  p_status text,
  p_reason text,
  p_admin_username text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $$
begin
  if p_player_id is null
     or p_status not in ('active', 'held', 'suspended')
     or nullif(trim(p_admin_username), '') is null
     or length(coalesce(p_reason, '')) > 500 then
    raise exception 'Invalid referral account control request';
  end if;

  insert into app_private.referral_kickback_account_controls (
    player_id, status, reason, updated_by, updated_at
  ) values (
    p_player_id, p_status, nullif(trim(p_reason), ''),
    trim(p_admin_username), now()
  )
  on conflict (player_id) do update
    set status = excluded.status,
        reason = excluded.reason,
        updated_by = excluded.updated_by,
        updated_at = now();

  if p_status <> 'active' then
    update app_private.referral_kickback_entries
    set status = 'held', updated_at = now()
    where recipient_player_id = p_player_id
      and status in ('pending', 'verified');
  else
    update app_private.referral_kickback_entries
    set status = 'pending', updated_at = now()
    where recipient_player_id = p_player_id
      and status = 'held';
  end if;

  return jsonb_build_object('success', true, 'playerId', p_player_id, 'status', p_status);
end;
$$;

-- Extend the trusted mining-credit transaction. The player's mining reward is
-- credited in full; referral rewards are additional, separate ledger entries.
create or replace function public.release_matured_fragment_zp(p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $function$
declare
  v_reward public.fragment_mining_rewards%rowtype;
  v_balance numeric(18, 2);
  v_credit_at timestamptz;
  v_count integer := 0;
  v_total numeric(18, 2) := 0;
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
    select * from public.fragment_mining_rewards
    where player_id = p_player_id
      and credited_at is null
      and release_at <= now()
    order by release_at, id
    for update
  loop
    update public.player_economy
    set zp_balance = coalesce(zp_balance, 0) + v_reward.amount,
        lifetime_zp = coalesce(lifetime_zp, 0) + v_reward.amount,
        updated_at = now()
    where player_id = p_player_id
    returning zp_balance into v_balance;

    insert into public.economy_ledger (
      player_id, transaction_type, amount, balance_after, reference_id, description
    ) values (
      p_player_id, 'fragment_mining_reward', v_reward.amount, v_balance,
      v_reward.id::text,
      'Verified ZP from ' || upper(v_reward.fragment_id) || ' Fragment mining (six-hour hold completed)'
    );

    update public.fragment_mining_rewards
    set credited_at = now()
    where id = v_reward.id and credited_at is null
    returning credited_at into v_credit_at;

    if v_credit_at is not null then
      perform app_private.record_referral_kickbacks_for_mining(v_reward.id, v_credit_at);
    end if;

    v_count := v_count + 1;
    v_total := v_total + v_reward.amount;
  end loop;

  return jsonb_build_object('success', true, 'creditedCount', v_count, 'creditedAmount', v_total);
end;
$function$;

revoke all on function app_private.ensure_referral_kickback_month() from public, anon, authenticated, service_role;
revoke all on function app_private.record_referral_kickbacks_for_mining(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app_private.allocate_referral_kickbacks() from public, anon, authenticated, service_role;
revoke all on function app_private.get_player_referral_kickbacks(uuid) from public, anon, authenticated, service_role;
revoke all on function app_private.claim_player_referral_kickbacks(uuid, text) from public, anon, authenticated, service_role;

revoke all on function public.get_player_referral_kickbacks(uuid) from public, anon, authenticated;
revoke all on function public.claim_player_referral_kickbacks(uuid, text) from public, anon, authenticated;
revoke all on function public.admin_get_referral_kickback_budget() from public, anon, authenticated;
revoke all on function public.admin_set_referral_kickback_budget(numeric, text) from public, anon, authenticated;
revoke all on function public.admin_set_referral_kickback_account_status(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.get_player_referral_kickbacks(uuid) to service_role;
grant execute on function public.claim_player_referral_kickbacks(uuid, text) to service_role;
grant execute on function public.admin_get_referral_kickback_budget() to service_role;
grant execute on function public.admin_set_referral_kickback_budget(numeric, text) to service_role;
grant execute on function public.admin_set_referral_kickback_account_status(uuid, text, text, text) to service_role;
grant execute on function public.release_matured_fragment_zp(uuid) to service_role;

-- Allocate the current month's budget in FIFO order, including carried-forward
-- verified entries, so the oldest unpaid rewards receive funding first.
do $schedule$
begin
  if exists (select 1 from cron.job where jobname = 'allocate-referral-kickback-budget') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'allocate-referral-kickback-budget';
  end if;

  perform cron.schedule(
    'allocate-referral-kickback-budget',
    '* * * * *',
    'select app_private.allocate_referral_kickbacks();'
  );
end;
$schedule$;
