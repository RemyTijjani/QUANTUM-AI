-- Stage 7: optional permanent ZAP achievement claims paid with 0.1 Gram (native TON).
-- Unclaimed badges track current net ZAP and can relock. Claimed badges are permanent.

alter table app_private.player_zap_achievements
  drop constraint if exists player_zap_achievements_threshold_check;

alter table app_private.player_zap_achievements
  add column if not exists is_claimed boolean not null default false,
  add column if not exists claimed_at timestamptz,
  add column if not exists claim_transaction_hash text;

-- Preserve any previously minted achievement as permanently owned.
update app_private.player_zap_achievements
set is_claimed = true,
    claimed_at = coalesce(claimed_at, minted_at),
    claim_transaction_hash = coalesce(claim_transaction_hash, mint_transaction_hash)
where minted_at is not null;

update app_private.player_zap_achievements
set required_net_zap = level * 500,
    updated_at = now();

alter table app_private.player_zap_achievements
  add constraint player_zap_achievements_threshold_check
    check (required_net_zap = level * 500);

alter table app_private.player_zap_achievements
  add constraint player_zap_achievements_claim_data_check
    check (
      (not is_claimed and claimed_at is null and claim_transaction_hash is null)
      or
      (is_claimed and claimed_at is not null and claim_transaction_hash is not null)
    );

create unique index if not exists player_zap_achievements_claim_tx_uidx
  on app_private.player_zap_achievements(claim_transaction_hash)
  where claim_transaction_hash is not null;

create table if not exists app_private.zap_achievement_claim_payments (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  achievement_level bigint not null check (achievement_level > 0),
  amount_nano numeric(30,0) not null default 100000000 check (amount_nano = 100000000),
  sender_wallet text not null,
  destination_wallet text not null,
  payment_memo text not null unique,
  status text not null default 'pending' check (status in ('pending','confirmed','expired')),
  transaction_hash text unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  check (expires_at > created_at),
  check (
    (status = 'confirmed' and transaction_hash is not null and confirmed_at is not null)
    or
    (status <> 'confirmed' and transaction_hash is null and confirmed_at is null)
  )
);

create index if not exists zap_achievement_claim_payments_player_created_idx
  on app_private.zap_achievement_claim_payments(player_id, created_at desc);
create index if not exists zap_achievement_claim_payments_pending_idx
  on app_private.zap_achievement_claim_payments(player_id, achievement_level, expires_at)
  where status = 'pending';

alter table app_private.zap_achievement_claim_payments enable row level security;
revoke all on table app_private.zap_achievement_claim_payments from public, anon, authenticated;
grant select, insert, update, delete on table app_private.zap_achievement_claim_payments to service_role;

create or replace function public.get_player_zap_achievements(p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $function$
declare
  v_score numeric(30, 0);
  v_level bigint;
  v_core_rank bigint;
  v_current_threshold numeric(30, 0);
  v_next_threshold numeric(30, 0);
  v_rank_progress numeric(7, 3);
begin
  if p_player_id is null or not exists (
    select 1 from public.players p where p.id = p_player_id
  ) then
    raise exception 'Player account was not found';
  end if;

  select greatest(coalesce((public.get_zap_leaderboard(p_player_id, 1)->'me'->>'rankingEarned')::numeric, 0), 0)
    into v_score;

  v_level := floor(v_score / 500)::bigint;

  insert into app_private.player_zap_achievements (
    player_id, level, required_net_zap, is_unlocked, unlocked_at
  )
  select p_player_id, levels.level, levels.level * 500, true, now()
  from generate_series(1::bigint, v_level) as levels(level)
  on conflict (player_id, level) do update
    set required_net_zap = excluded.required_net_zap,
        is_unlocked = true,
        unlocked_at = case
          when not app_private.player_zap_achievements.is_unlocked
            then now()
          else app_private.player_zap_achievements.unlocked_at
        end,
        updated_at = now();

  update app_private.player_zap_achievements a
  set is_unlocked = false,
      updated_at = now()
  where a.player_id = p_player_id
    and a.required_net_zap > v_score
    and not a.is_claimed
    and a.minted_at is null
    and a.is_unlocked;

  v_core_rank := floor(v_score / 500)::bigint + 1;
  v_current_threshold := (v_core_rank - 1) * 500;
  v_next_threshold := v_core_rank * 500;
  v_rank_progress := least(100, greatest(0,
    ((v_score - v_current_threshold) / 500) * 100
  ));

  return jsonb_build_object(
    'netZap', v_score,
    'currentLevel', v_level,
    'nextLevelAt', (v_level + 1) * 500,
    'coreRank', jsonb_build_object(
      'rankNumber', v_core_rank,
      'currentThreshold', v_current_threshold,
      'nextThreshold', v_next_threshold,
      'progressPercent', v_rank_progress
    ),
    'achievements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'level', a.level,
        'requiredNetZap', a.required_net_zap,
        'isUnlocked', (a.is_unlocked or a.is_claimed or a.minted_at is not null),
        'isClaimed', (a.is_claimed or a.minted_at is not null),
        'isMinted', (a.minted_at is not null),
        'unlockedAt', a.unlocked_at,
        'claimedAt', coalesce(a.claimed_at, a.minted_at),
        'claimTransactionHash', coalesce(a.claim_transaction_hash, a.mint_transaction_hash),
        'mintedAt', a.minted_at,
        'nftCollectionAddress', a.nft_collection_address,
        'nftItemAddress', a.nft_item_address,
        'nftTokenId', a.nft_token_id
      ) order by a.level)
      from app_private.player_zap_achievements a
      where a.player_id = p_player_id
    ), '[]'::jsonb)
  );
end;
$function$;

create or replace function public.zap_achievement_create_claim_intent(
  p_player_id uuid,
  p_level bigint,
  p_payment_memo text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_score numeric(30,0);
  v_wallet app_private.player_ton_wallets%rowtype;
  v_destination text;
  v_intent app_private.zap_achievement_claim_payments%rowtype;
begin
  if p_player_id is null or p_level is null or p_level < 1
     or p_payment_memo is null or p_payment_memo !~ '^ZORD-ACH-[A-F0-9]{32}$'
     or p_expires_at is null or p_expires_at <= now()
     or p_expires_at > now() + interval '20 minutes' then
    raise exception 'Invalid achievement claim request';
  end if;

  select greatest(coalesce((public.get_zap_leaderboard(p_player_id, 1)->'me'->>'rankingEarned')::numeric, 0), 0)
    into v_score;

  if v_score < p_level * 500 then
    raise exception 'Reach % net ZAP before claiming this achievement', p_level * 500;
  end if;

  select * into v_wallet
  from app_private.player_ton_wallets
  where player_id = p_player_id
    and network = '-239'
    and verification_status = 'verified'
  for update;
  if not found then raise exception 'Connect and verify your Gram wallet in Vault before claiming'; end if;

  select wallet_address into v_destination
  from app_private.raffle_ton_funding_config
  where id = 1;
  if nullif(trim(v_destination), '') is null then
    raise exception 'The achievement payment wallet is not configured';
  end if;

  select * into v_intent
  from app_private.zap_achievement_claim_payments
  where player_id = p_player_id
    and achievement_level = p_level
    and status = 'pending'
    and expires_at > now()
  order by created_at desc
  limit 1
  for update;

  if found then
    return jsonb_build_object(
      'success', true, 'intentId', v_intent.id, 'level', v_intent.achievement_level,
      'amountNano', v_intent.amount_nano::text, 'senderWallet', v_intent.sender_wallet,
      'destinationWallet', v_intent.destination_wallet, 'memo', v_intent.payment_memo,
      'expiresAt', v_intent.expires_at, 'reused', true
    );
  end if;

  insert into app_private.zap_achievement_claim_payments(
    player_id, achievement_level, sender_wallet, destination_wallet, payment_memo, expires_at
  ) values (
    p_player_id, p_level, v_wallet.wallet_address, v_destination, p_payment_memo, p_expires_at
  )
  returning * into v_intent;

  return jsonb_build_object(
    'success', true, 'intentId', v_intent.id, 'level', v_intent.achievement_level,
    'amountNano', v_intent.amount_nano::text, 'senderWallet', v_intent.sender_wallet,
    'destinationWallet', v_intent.destination_wallet, 'memo', v_intent.payment_memo,
    'expiresAt', v_intent.expires_at, 'reused', false
  );
end;
$function$;

create or replace function public.zap_achievement_get_claim_intent(
  p_player_id uuid,
  p_intent_id uuid
)
returns jsonb
language sql
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'intentId', i.id,
    'playerId', i.player_id,
    'level', i.achievement_level,
    'amountNano', i.amount_nano::text,
    'senderWallet', i.sender_wallet,
    'destinationWallet', i.destination_wallet,
    'memo', i.payment_memo,
    'status', i.status,
    'transactionHash', i.transaction_hash,
    'createdAt', i.created_at,
    'expiresAt', i.expires_at
  )
  from app_private.zap_achievement_claim_payments i
  where i.id = p_intent_id and i.player_id = p_player_id;
$function$;

create or replace function public.zap_achievement_complete_claim(
  p_player_id uuid,
  p_intent_id uuid,
  p_transaction_hash text,
  p_sender_wallet text,
  p_destination_wallet text,
  p_amount_nano numeric,
  p_payment_memo text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_intent app_private.zap_achievement_claim_payments%rowtype;
  v_wallet app_private.player_ton_wallets%rowtype;
  v_score numeric(30,0);
  v_achievement app_private.player_zap_achievements%rowtype;
begin
  if p_player_id is null or p_intent_id is null
     or nullif(trim(p_transaction_hash), '') is null
     or length(p_transaction_hash) > 200
     or p_amount_nano is distinct from 100000000 then
    raise exception 'Invalid verified Gram payment details';
  end if;

  select * into v_intent
  from app_private.zap_achievement_claim_payments
  where id = p_intent_id and player_id = p_player_id
  for update;
  if not found then raise exception 'Achievement claim payment was not found'; end if;

  if v_intent.status = 'confirmed' then
    if v_intent.transaction_hash <> p_transaction_hash then
      raise exception 'This claim was already completed with another transaction';
    end if;
    return jsonb_build_object('success', true, 'alreadyApplied', true, 'level', v_intent.achievement_level);
  end if;

  if v_intent.status <> 'pending' or v_intent.expires_at <= now() then
    update app_private.zap_achievement_claim_payments
    set status = 'expired'
    where id = v_intent.id and status = 'pending';
    raise exception 'This payment request has expired. Start the claim again.';
  end if;

  select * into v_wallet
  from app_private.player_ton_wallets
  where player_id = p_player_id and verification_status = 'verified' and network = '-239';
  if not found or v_wallet.wallet_address <> v_intent.sender_wallet
     or p_sender_wallet <> v_intent.sender_wallet then
    raise exception 'The payment must come from your currently verified Gram wallet';
  end if;

  if p_destination_wallet <> v_intent.destination_wallet
     or p_payment_memo <> v_intent.payment_memo then
    raise exception 'The on-chain payment destination or reference does not match';
  end if;

  select greatest(coalesce((public.get_zap_leaderboard(p_player_id, 1)->'me'->>'rankingEarned')::numeric, 0), 0)
    into v_score;
  if v_score < v_intent.achievement_level * 500 then
    raise exception 'Your net ZAP is now below this achievement threshold';
  end if;

  select * into v_achievement
  from app_private.player_zap_achievements
  where player_id = p_player_id and level = v_intent.achievement_level
  for update;
  if not found then raise exception 'The ZAP achievement is not available'; end if;
  if v_achievement.is_claimed or v_achievement.minted_at is not null then
    raise exception 'This achievement has already been permanently claimed';
  end if;

  update app_private.player_zap_achievements
  set is_unlocked = true,
      is_claimed = true,
      claimed_at = now(),
      claim_transaction_hash = p_transaction_hash,
      updated_at = now()
  where player_id = p_player_id and level = v_intent.achievement_level;

  update app_private.zap_achievement_claim_payments
  set status = 'confirmed',
      transaction_hash = p_transaction_hash,
      confirmed_at = now()
  where id = v_intent.id;

  return jsonb_build_object('success', true, 'alreadyApplied', false, 'level', v_intent.achievement_level);
end;
$function$;

revoke all on function public.zap_achievement_create_claim_intent(uuid, bigint, text, timestamptz) from public, anon, authenticated;
revoke all on function public.zap_achievement_get_claim_intent(uuid, uuid) from public, anon, authenticated;
revoke all on function public.zap_achievement_complete_claim(uuid, uuid, text, text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.zap_achievement_create_claim_intent(uuid, bigint, text, timestamptz) to service_role;
grant execute on function public.zap_achievement_get_claim_intent(uuid, uuid) to service_role;
grant execute on function public.zap_achievement_complete_claim(uuid, uuid, text, text, text, numeric, text) to service_role;
