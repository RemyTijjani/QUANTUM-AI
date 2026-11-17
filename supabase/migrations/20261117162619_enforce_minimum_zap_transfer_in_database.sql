-- Enforce the approved 100 ZAP minimum at the trusted database boundary.
CREATE OR REPLACE FUNCTION public.transfer_player_zap(p_sender_id uuid, p_recipient_identifier text, p_amount numeric, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private', 'pg_temp'
AS $function$
declare
  v_identifier text;
  v_recipient jsonb;
  v_recipient_id uuid;
  v_sender_wallet app_private.player_zap_wallets%rowtype;
  v_recipient_profile public.players%rowtype;
  v_transfer app_private.zap_transfers%rowtype;
  v_debit jsonb;
  v_credit jsonb;
  v_reference text;
begin
  if p_sender_id is null or not exists (
    select 1 from public.players p where p.id = p_sender_id
  ) then
    raise exception 'Your player account could not be verified';
  end if;

  if p_amount is null
     or p_amount <= 0
     or p_amount::text in ('NaN', 'Infinity', '-Infinity')
     or p_amount <> trunc(p_amount)
     or p_amount > 99999999999999999999 then
    raise exception 'Enter a positive whole-number ZAP amount';
  end if;

  if p_amount < 100 then
    raise exception 'The minimum ZAP transfer is 100 ZAP';
  end if;

  if nullif(trim(p_idempotency_key), '') is null
     or length(p_idempotency_key) < 8
     or length(p_idempotency_key) > 128 then
    raise exception 'A valid transfer request key is required';
  end if;

  v_identifier := lower(nullif(trim(both '@' from trim(coalesce(p_recipient_identifier, ''))), ''));
  if v_identifier is null or length(v_identifier) < 3 or length(v_identifier) > 80 then
    raise exception 'Enter a valid ZORD username or referral code';
  end if;

  -- A retry with the same key and same details returns the original transfer.
  select * into v_transfer
  from app_private.zap_transfers t
  where t.sender_id = p_sender_id
    and t.idempotency_key = trim(p_idempotency_key)
  for update;

  if found then
    if v_transfer.amount <> p_amount
       or v_transfer.recipient_identifier <> v_identifier then
      raise exception 'This transfer request key was already used for different details';
    end if;

    select * into v_sender_wallet
    from app_private.player_zap_wallets w
    where w.player_id = p_sender_id;

    select * into v_recipient_profile
    from public.players p
    where p.id = v_transfer.recipient_id;

    return jsonb_build_object(
      'success', true,
      'alreadyApplied', true,
      'transferId', v_transfer.id,
      'amount', v_transfer.amount,
      'senderBalance', v_sender_wallet.balance,
      'recipient', jsonb_build_object(
        'username', v_recipient_profile.username,
        'firstName', v_recipient_profile.first_name,
        'displayName', coalesce(nullif(trim(v_recipient_profile.first_name), ''), nullif(trim(v_recipient_profile.username), ''), 'ZORD player')
      ),
      'createdAt', v_transfer.created_at
    );
  end if;

  v_recipient := public.lookup_zap_transfer_recipient(p_sender_id, p_recipient_identifier);
  v_recipient_id := (v_recipient->>'playerId')::uuid;

  -- Ensure both wallet rows exist, then lock them in UUID order. This prevents
  -- deadlocks when two players transfer to each other at the same time.
  insert into app_private.player_zap_wallets (player_id, balance, lifetime_earned, lifetime_spent)
  select p.id, 0, 0, 0
  from public.players p
  where p.id in (p_sender_id, v_recipient_id)
  order by p.id
  on conflict (player_id) do nothing;

  perform w.player_id
  from app_private.player_zap_wallets w
  where w.player_id in (p_sender_id, v_recipient_id)
  order by w.player_id
  for update;

  -- Recheck after acquiring the sender wallet lock in case a concurrent retry
  -- inserted the same idempotency key while this request was waiting.
  select * into v_transfer
  from app_private.zap_transfers t
  where t.sender_id = p_sender_id
    and t.idempotency_key = trim(p_idempotency_key)
  for update;

  if found then
    if v_transfer.amount <> p_amount
       or v_transfer.recipient_identifier <> v_identifier then
      raise exception 'This transfer request key was already used for different details';
    end if;

    select * into v_sender_wallet
    from app_private.player_zap_wallets w
    where w.player_id = p_sender_id;

    select * into v_recipient_profile
    from public.players p
    where p.id = v_transfer.recipient_id;

    return jsonb_build_object(
      'success', true,
      'alreadyApplied', true,
      'transferId', v_transfer.id,
      'amount', v_transfer.amount,
      'senderBalance', v_sender_wallet.balance,
      'recipient', jsonb_build_object(
        'username', v_recipient_profile.username,
        'firstName', v_recipient_profile.first_name,
        'displayName', coalesce(nullif(trim(v_recipient_profile.first_name), ''), nullif(trim(v_recipient_profile.username), ''), 'ZORD player')
      ),
      'createdAt', v_transfer.created_at
    );
  end if;

  insert into app_private.zap_transfers (
    sender_id, recipient_id, amount, recipient_identifier, idempotency_key
  ) values (
    p_sender_id, v_recipient_id, p_amount, v_identifier, trim(p_idempotency_key)
  )
  returning * into v_transfer;

  v_reference := 'zap-transfer:' || v_transfer.id::text;

  -- Both ledger writes and the transfer record share this database transaction.
  -- Any failure rolls back the sender debit, recipient credit and transfer row.
  v_debit := public.apply_player_zap_ledger_entry(
    p_sender_id,
    'debit',
    p_amount,
    'player_transfer_sent',
    v_reference,
    v_reference || ':sender',
    'ZAP transfer sent'
  );

  v_credit := public.apply_player_zap_ledger_entry(
    v_recipient_id,
    'credit',
    p_amount,
    'player_transfer_received',
    v_reference,
    v_reference || ':recipient',
    'ZAP transfer received'
  );

  return jsonb_build_object(
    'success', true,
    'alreadyApplied', false,
    'transferId', v_transfer.id,
    'amount', p_amount,
    'senderBalance', (v_debit->>'balanceAfter')::numeric,
    'recipient', jsonb_build_object(
      'username', v_recipient->>'username',
      'firstName', v_recipient->>'firstName',
      'displayName', v_recipient->>'displayName'
    ),
    'createdAt', v_transfer.created_at
  );
end;
$function$
;
