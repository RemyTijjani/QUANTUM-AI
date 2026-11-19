-- Prevent concurrent duplicate payment intents for the same player's achievement.
create unique index if not exists zap_achievement_claim_one_pending_per_level_uidx
  on app_private.zap_achievement_claim_payments(player_id, achievement_level)
  where status = 'pending';

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

  update app_private.zap_achievement_claim_payments
  set status = 'expired'
  where player_id = p_player_id
    and achievement_level = p_level
    and status = 'pending'
    and expires_at <= now();

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
