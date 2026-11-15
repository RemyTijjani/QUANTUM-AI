
create table if not exists app_private.platform_treasury_zap (
  id smallint primary key default 1 check (id = 1),
  balance numeric(20,8) not null default 0 check (balance >= 0),
  lifetime_received numeric(20,8) not null default 0 check (lifetime_received >= 0),
  updated_at timestamptz not null default now()
);
insert into app_private.platform_treasury_zap (id) values (1) on conflict (id) do nothing;

create table if not exists app_private.platform_treasury_zap_ledger (
  id uuid primary key default gen_random_uuid(),
  entry_type text not null check (entry_type in ('credit','debit')),
  amount numeric(20,8) not null check (amount > 0),
  balance_after numeric(20,8) not null check (balance_after >= 0),
  source text not null,
  source_reference text not null,
  idempotency_key text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.raffles (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 3 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  reward_type text not null check (reward_type in ('ton','zap','agent')),
  reward_code text,
  prize_pool_amount numeric(20,8) not null check (prize_pool_amount > 0),
  prize_currency text not null check (prize_currency in ('TON','ZAP','AGENT')),
  funding_source text not null check (funding_source in ('treasury','external')),
  min_bet_zap numeric(20,8) not null check (min_bet_zap > 0),
  entry_mode text not null check (entry_mode in ('one_bet_one_entry','proportional')),
  winner_count integer not null check (winner_count between 1 and 100),
  winner_method text not null check (winner_method in ('random','admin')),
  custom_winner_shares jsonb not null default '[]'::jsonb check (jsonb_typeof(custom_winner_shares) = 'array'),
  status text not null default 'draft' check (status in ('draft','published','closed','drawn','settled','cancelled')),
  starts_at timestamptz,
  ends_at timestamptz,
  published_at timestamptz,
  closed_at timestamptz,
  drawn_at timestamptz,
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (reward_type = 'ton' and prize_currency = 'TON' and reward_code is null)
    or (reward_type = 'zap' and prize_currency = 'ZAP' and reward_code is null)
    or (reward_type = 'agent' and prize_currency = 'AGENT' and reward_code in ('alpha','overclock') and prize_pool_amount = trunc(prize_pool_amount))
  ),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create index if not exists raffles_status_window_idx on public.raffles(status, starts_at, ends_at);

create table if not exists public.raffle_entries (
  id uuid primary key default gen_random_uuid(),
  raffle_id uuid not null references public.raffles(id) on delete restrict,
  player_id uuid not null references public.players(id) on delete restrict,
  stake_zap numeric(20,8) not null check (stake_zap > 0),
  ticket_count integer not null check (ticket_count > 0),
  idempotency_key text not null,
  zap_ledger_entry_id uuid,
  created_at timestamptz not null default now(),
  unique (player_id, idempotency_key)
);
create index if not exists raffle_entries_raffle_idx on public.raffle_entries(raffle_id, created_at);
create index if not exists raffle_entries_player_idx on public.raffle_entries(player_id, created_at desc);

create table if not exists public.raffle_winners (
  id uuid primary key default gen_random_uuid(),
  raffle_id uuid not null references public.raffles(id) on delete restrict,
  player_id uuid not null references public.players(id) on delete restrict,
  entry_id uuid references public.raffle_entries(id) on delete restrict,
  prize_amount numeric(20,8) not null check (prize_amount > 0),
  prize_currency text not null check (prize_currency in ('TON','ZAP','AGENT')),
  reward_code text,
  selection_method text not null check (selection_method in ('random','admin')),
  selected_by text not null,
  selected_at timestamptz not null default now(),
  delivery_status text not null default 'pending' check (delivery_status in ('pending','credited','withdrawable','delivered','failed')),
  unique (raffle_id, player_id),
  check ((prize_currency = 'AGENT' and reward_code in ('alpha','overclock')) or (prize_currency <> 'AGENT' and reward_code is null))
);

create table if not exists app_private.raffle_prize_reservations (
  id uuid primary key default gen_random_uuid(),
  raffle_id uuid not null unique references public.raffles(id) on delete restrict,
  reward_type text not null check (reward_type in ('ton','zap','agent')),
  funding_source text not null check (funding_source in ('treasury','external','agent_inventory')),
  amount numeric(20,8) not null check (amount > 0),
  reward_code text,
  status text not null default 'reserved' check (status in ('reserved','released','consumed')),
  created_by text not null,
  created_at timestamptz not null default now(),
  released_at timestamptz
);

create table if not exists public.raffle_audit_log (
  id uuid primary key default gen_random_uuid(),
  raffle_id uuid references public.raffles(id) on delete restrict,
  actor text not null,
  action text not null check (char_length(btrim(action)) between 1 and 100),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

alter table public.raffles enable row level security;
alter table public.raffle_entries enable row level security;
alter table public.raffle_winners enable row level security;
alter table public.raffle_audit_log enable row level security;
alter table app_private.platform_treasury_zap enable row level security;
alter table app_private.platform_treasury_zap_ledger enable row level security;
alter table app_private.raffle_prize_reservations enable row level security;

revoke all on public.raffles, public.raffle_entries, public.raffle_winners, public.raffle_audit_log from public, anon, authenticated;
revoke all on app_private.platform_treasury_zap, app_private.platform_treasury_zap_ledger, app_private.raffle_prize_reservations from public, anon, authenticated;
grant all on public.raffles, public.raffle_entries, public.raffle_winners, public.raffle_audit_log to service_role;
grant all on app_private.platform_treasury_zap, app_private.platform_treasury_zap_ledger, app_private.raffle_prize_reservations to service_role;

create or replace function app_private.enter_raffle(p_player_id uuid,p_raffle_id uuid,p_stake_zap numeric,p_idempotency_key text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, app_private, pg_temp as $$
declare
  v_raffle public.raffles%rowtype;
  v_existing public.raffle_entries%rowtype;
  v_tickets integer;
  v_treasury_balance numeric(20,8);
  v_debit jsonb;
  v_entry public.raffle_entries%rowtype;
  v_key text;
begin
  if p_player_id is null or p_raffle_id is null then raise exception 'Player and raffle are required'; end if;
  if p_stake_zap is null or p_stake_zap <= 0 or p_stake_zap::text in ('NaN','Infinity','-Infinity') then raise exception 'Stake must be a positive finite ZAP amount'; end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 or length(p_idempotency_key) > 128 then raise exception 'A valid entry request key is required'; end if;
  if not exists (select 1 from public.players where id = p_player_id) then raise exception 'Player profile was not found'; end if;
  select * into v_existing from public.raffle_entries where player_id = p_player_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.raffle_id <> p_raffle_id or v_existing.stake_zap <> p_stake_zap then raise exception 'Entry request key was already used for a different entry'; end if;
    return jsonb_build_object('success',true,'alreadyApplied',true,'entryId',v_existing.id,'ticketCount',v_existing.ticket_count,'stakeZap',v_existing.stake_zap);
  end if;
  select * into v_raffle from public.raffles where id = p_raffle_id for update;
  if not found or v_raffle.status <> 'published' then raise exception 'This raffle is not open for entries'; end if;
  if v_raffle.starts_at is not null and now() < v_raffle.starts_at then raise exception 'This raffle has not started yet'; end if;
  if v_raffle.ends_at is not null and now() >= v_raffle.ends_at then raise exception 'This raffle has ended'; end if;
  if p_stake_zap < v_raffle.min_bet_zap then raise exception 'Stake is below the minimum bet'; end if;
  if v_raffle.entry_mode = 'one_bet_one_entry' then v_tickets := 1; else v_tickets := floor(p_stake_zap / v_raffle.min_bet_zap)::integer; end if;
  if v_tickets < 1 or v_tickets > 1000000 then raise exception 'Calculated entry count is outside the allowed range'; end if;
  v_key := 'raffle-entry:' || p_idempotency_key;
  v_debit := public.apply_player_zap_ledger_entry(p_player_id,'debit',p_stake_zap,'raffle_entry',p_raffle_id::text,v_key,'ZAP stake for raffle entry');
  if coalesce((v_debit->>'success')::boolean,false) is not true then raise exception 'Could not debit the ZAP stake'; end if;
  update app_private.platform_treasury_zap set balance = balance + p_stake_zap,lifetime_received = lifetime_received + p_stake_zap,updated_at = now()
  where id = 1 returning balance into v_treasury_balance;
  insert into app_private.platform_treasury_zap_ledger(entry_type,amount,balance_after,source,source_reference,idempotency_key,description)
  values ('credit',p_stake_zap,v_treasury_balance,'raffle_entry',p_raffle_id::text,'treasury:' || v_key,'Raffle entry stake transferred to platform treasury');
  insert into public.raffle_entries(raffle_id,player_id,stake_zap,ticket_count,idempotency_key,zap_ledger_entry_id)
  values (p_raffle_id,p_player_id,p_stake_zap,v_tickets,p_idempotency_key,(v_debit->>'entryId')::uuid) returning * into v_entry;
  insert into public.raffle_audit_log(raffle_id,actor,action,details)
  values (p_raffle_id,p_player_id::text,'player_entry',jsonb_build_object('entryId',v_entry.id,'stakeZap',p_stake_zap,'ticketCount',v_tickets));
  return jsonb_build_object('success',true,'alreadyApplied',false,'entryId',v_entry.id,'ticketCount',v_tickets,'stakeZap',p_stake_zap,'treasuryBalance',v_treasury_balance);
end; $$;
revoke all on function app_private.enter_raffle(uuid,uuid,numeric,text) from public,anon,authenticated;
grant execute on function app_private.enter_raffle(uuid,uuid,numeric,text) to service_role;

create or replace function public.enter_raffle(p_player_id uuid,p_raffle_id uuid,p_stake_zap numeric,p_idempotency_key text)
returns jsonb language sql security definer
set search_path = pg_catalog, public, app_private, pg_temp as $$
  select app_private.enter_raffle(p_player_id,p_raffle_id,p_stake_zap,p_idempotency_key);
$$;
revoke all on function public.enter_raffle(uuid,uuid,numeric,text) from public,anon,authenticated;
grant execute on function public.enter_raffle(uuid,uuid,numeric,text) to service_role;
