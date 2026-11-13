-- ZORD agent rentals: server-owned payment intents and 30-day entitlements.
-- Prices are fixed in native GRAM (TON mainnet nanotons).
create table if not exists public.agent_rental_payment_intents (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  agent_type text not null check (agent_type in ('alpha_miner', 'overclocked_core')),
  amount_nano bigint not null check (amount_nano in (1500000000, 4500000000)),
  currency text not null default 'GRAM' check (currency = 'GRAM'),
  network text not null default 'mainnet' check (network = 'mainnet'),
  recipient_address text not null,
  payment_reference text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'expired', 'rejected')),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  transaction_hash text unique,
  sender_address text,
  chain_transaction_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_rental_amount_matches_type check (
    (agent_type = 'alpha_miner' and amount_nano = 1500000000)
    or (agent_type = 'overclocked_core' and amount_nano = 4500000000)
  )
);

create index if not exists agent_rental_intents_player_status_idx
  on public.agent_rental_payment_intents (player_id, status, created_at desc);

create table if not exists public.player_agent_rentals (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  agent_type text not null check (agent_type in ('alpha_miner', 'overclocked_core')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'expired')),
  last_payment_intent_id uuid not null unique
    references public.agent_rental_payment_intents(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (player_id, agent_type)
);

create index if not exists player_agent_rentals_active_idx
  on public.player_agent_rentals (player_id, expires_at desc)
  where status = 'active';

alter table public.agent_rental_payment_intents enable row level security;
alter table public.player_agent_rentals enable row level security;
revoke all on public.agent_rental_payment_intents from public, anon, authenticated;
revoke all on public.player_agent_rentals from public, anon, authenticated;
grant select, insert, update on public.agent_rental_payment_intents to service_role;
grant select, insert, update on public.player_agent_rentals to service_role;

create or replace function public.create_agent_rental_payment_intent(
  p_player_id uuid,
  p_agent_type text,
  p_payment_reference text,
  p_recipient_address text
)
returns public.agent_rental_payment_intents
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_amount bigint;
  v_intent public.agent_rental_payment_intents%rowtype;
begin
  if p_player_id is null
     or p_agent_type not in ('alpha_miner', 'overclocked_core')
     or p_payment_reference is null
     or length(p_payment_reference) < 16
     or p_recipient_address is null
     or length(p_recipient_address) < 20 then
    raise exception 'Invalid agent rental request';
  end if;

  v_amount := case p_agent_type
    when 'alpha_miner' then 1500000000
    when 'overclocked_core' then 4500000000
  end;

  insert into public.agent_rental_payment_intents (
    player_id, agent_type, amount_nano, recipient_address, payment_reference
  ) values (
    p_player_id, p_agent_type, v_amount, p_recipient_address, p_payment_reference
  )
  returning * into v_intent;

  return v_intent;
end;
$$;

create or replace function public.confirm_agent_rental_payment(
  p_intent_id uuid,
  p_transaction_hash text,
  p_sender_address text,
  p_chain_transaction_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_intent public.agent_rental_payment_intents%rowtype;
  v_rental public.player_agent_rentals%rowtype;
  v_start timestamptz;
  v_expiry timestamptz;
begin
  if p_intent_id is null
     or p_transaction_hash is null
     or length(p_transaction_hash) < 32
     or p_sender_address is null
     or p_chain_transaction_at is null then
    raise exception 'Invalid verified payment details';
  end if;

  select * into v_intent
  from public.agent_rental_payment_intents
  where id = p_intent_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'reason', 'intent_not_found');
  end if;

  if v_intent.status = 'paid' then
    if v_intent.transaction_hash = p_transaction_hash then
      select * into v_rental
      from public.player_agent_rentals
      where player_id = v_intent.player_id and agent_type = v_intent.agent_type;
      return jsonb_build_object(
        'success', true, 'duplicate', true,
        'agentType', v_intent.agent_type, 'expiresAt', v_rental.expires_at
      );
    end if;
    return jsonb_build_object('success', false, 'reason', 'intent_already_paid');
  end if;

  if v_intent.status <> 'pending' then
    return jsonb_build_object('success', false, 'reason', 'intent_not_pending');
  end if;

  if p_chain_transaction_at < v_intent.created_at
     or p_chain_transaction_at > v_intent.expires_at
     or p_chain_transaction_at > now() + interval '2 minutes' then
    update public.agent_rental_payment_intents
      set status = 'expired', updated_at = now()
      where id = v_intent.id;
    return jsonb_build_object('success', false, 'reason', 'payment_outside_intent_window');
  end if;

  -- Serialize renewals for the same player and agent, including first-time rentals.
  perform pg_advisory_xact_lock(hashtextextended(v_intent.player_id::text || ':' || v_intent.agent_type, 0));

  select * into v_rental
  from public.player_agent_rentals
  where player_id = v_intent.player_id and agent_type = v_intent.agent_type
  for update;

  if found then
    v_start := v_rental.starts_at;
    v_expiry := greatest(now(), v_rental.expires_at) + interval '30 days';
  else
    v_start := now();
    v_expiry := now() + interval '30 days';
  end if;

  update public.agent_rental_payment_intents
  set status = 'paid',
      transaction_hash = p_transaction_hash,
      sender_address = p_sender_address,
      chain_transaction_at = p_chain_transaction_at,
      updated_at = now()
  where id = v_intent.id;

  insert into public.player_agent_rentals (
    player_id, agent_type, starts_at, expires_at, status, last_payment_intent_id, updated_at
  ) values (
    v_intent.player_id, v_intent.agent_type, v_start, v_expiry, 'active', v_intent.id, now()
  )
  on conflict (player_id, agent_type) do update
    set expires_at = excluded.expires_at,
        status = 'active',
        last_payment_intent_id = excluded.last_payment_intent_id,
        updated_at = now();

  return jsonb_build_object(
    'success', true, 'duplicate', false,
    'agentType', v_intent.agent_type, 'expiresAt', v_expiry
  );
end;
$$;

revoke all on function public.create_agent_rental_payment_intent(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.confirm_agent_rental_payment(uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.create_agent_rental_payment_intent(uuid, text, text, text)
  to service_role;
grant execute on function public.confirm_agent_rental_payment(uuid, text, text, timestamptz)
  to service_role;
