-- Stage 7 TON wallet and withdrawal foundation. Preview only; no chain transfers.
create table if not exists app_private.player_ton_wallets (
 id uuid primary key default gen_random_uuid(),
 player_id uuid not null unique references public.players(id) on delete cascade,
 wallet_address text not null unique,
 network text not null default '-239' check(network='-239'),
 verification_status text not null default 'pending' check(verification_status in ('pending','verified','revoked')),
 proof_public_key text, proof_timestamp timestamptz,
 created_at timestamptz not null default now(), verified_at timestamptz, revoked_at timestamptz
);
create table if not exists app_private.player_ton_balances (
 player_id uuid primary key references public.players(id) on delete cascade,
 available_nano numeric(30,0) not null default 0 check(available_nano>=0),
 reserved_nano numeric(30,0) not null default 0 check(reserved_nano>=0),
 updated_at timestamptz not null default now()
);
create table if not exists app_private.player_ton_ledger (
 id uuid primary key default gen_random_uuid(),
 player_id uuid not null references public.players(id) on delete restrict,
 entry_type text not null check(entry_type in ('raffle_prize_credit','withdrawal_reserve','withdrawal_release','withdrawal_paid','admin_adjustment')),
 direction text not null check(direction in ('credit','debit')),
 amount_nano numeric(30,0) not null check(amount_nano>0),
 available_after_nano numeric(30,0) not null check(available_after_nano>=0),
 reserved_after_nano numeric(30,0) not null check(reserved_after_nano>=0),
 reference_type text not null, reference_id uuid not null,
 idempotency_key text not null unique, created_at timestamptz not null default now()
);
create table if not exists app_private.ton_withdrawal_requests (
 id uuid primary key default gen_random_uuid(),
 player_id uuid not null references public.players(id) on delete restrict,
 wallet_id uuid not null references app_private.player_ton_wallets(id) on delete restrict,
 wallet_address text not null, amount_nano numeric(30,0) not null check(amount_nano>0),
 status text not null default 'pending' check(status in ('pending','approved','processing','paid','rejected','cancelled')),
 admin_note text, reviewed_by text, reviewed_at timestamptz, transaction_hash text, paid_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(status<>'paid' or (transaction_hash is not null and paid_at is not null))
);
create index if not exists ton_withdrawal_requests_status_created_idx on app_private.ton_withdrawal_requests(status,created_at);
create index if not exists ton_withdrawal_requests_player_created_idx on app_private.ton_withdrawal_requests(player_id,created_at desc);
create index if not exists player_ton_ledger_player_created_idx on app_private.player_ton_ledger(player_id,created_at desc);
alter table app_private.player_ton_wallets enable row level security;
alter table app_private.player_ton_balances enable row level security;
alter table app_private.player_ton_ledger enable row level security;
alter table app_private.ton_withdrawal_requests enable row level security;
revoke all on app_private.player_ton_wallets,app_private.player_ton_balances,app_private.player_ton_ledger,app_private.ton_withdrawal_requests from public,anon,authenticated;
grant all on app_private.player_ton_wallets,app_private.player_ton_balances,app_private.player_ton_ledger,app_private.ton_withdrawal_requests to service_role;

create or replace function app_private.credit_ton_raffle_prize(p_winner_id uuid,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w public.raffle_winners%rowtype; b app_private.player_ton_balances%rowtype; e app_private.player_ton_ledger%rowtype; n numeric(30,0);
begin
 if p_winner_id is null or p_idempotency_key is null or length(p_idempotency_key)<8 then raise exception 'Valid winner and idempotency key are required'; end if;
 select * into w from public.raffle_winners where id=p_winner_id for update;
 if not found or w.prize_currency<>'TON' then raise exception 'TON raffle winner not found'; end if;
 n:=round(w.prize_amount*1000000000);
 if n<=0 or w.prize_amount*1000000000<>n then raise exception 'TON prize precision is invalid'; end if;
 select * into e from app_private.player_ton_ledger where idempotency_key=p_idempotency_key;
 if found then
  if e.player_id<>w.player_id or e.reference_id<>p_winner_id or e.amount_nano<>n then raise exception 'Idempotency key was already used for another credit'; end if;
  return jsonb_build_object('success',true,'alreadyApplied',true);
 end if;
 if exists(select 1 from app_private.player_ton_ledger where reference_type='raffle_winner' and reference_id=p_winner_id and entry_type='raffle_prize_credit') then raise exception 'Raffle prize was already credited'; end if;
 insert into app_private.player_ton_balances(player_id) values(w.player_id) on conflict do nothing;
 update app_private.player_ton_balances set available_nano=available_nano+n,updated_at=now() where player_id=w.player_id returning * into b;
 insert into app_private.player_ton_ledger(player_id,entry_type,direction,amount_nano,available_after_nano,reserved_after_nano,reference_type,reference_id,idempotency_key)
 values(w.player_id,'raffle_prize_credit','credit',n,b.available_nano,b.reserved_nano,'raffle_winner',p_winner_id,p_idempotency_key);
 update public.raffle_winners set delivery_status='withdrawable' where id=p_winner_id;
 return jsonb_build_object('success',true,'alreadyApplied',false,'availableNano',b.available_nano::text);
end $$;
revoke all on function app_private.credit_ton_raffle_prize(uuid,text) from public,anon,authenticated;
grant execute on function app_private.credit_ton_raffle_prize(uuid,text) to service_role;
