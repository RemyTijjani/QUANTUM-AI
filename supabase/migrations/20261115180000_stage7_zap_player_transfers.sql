-- Stage 7: atomic player-to-player ZAP transfers.
-- Source-only until separately approved for Supabase Preview application.
-- A transfer row and both ledger entries are committed or rolled back together.

create table if not exists app_private.zap_transfers (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.players(id),
  recipient_id uuid not null references public.players(id),
  amount numeric(20,0) not null check (amount > 0 and amount = trunc(amount)),
  recipient_identifier text not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint zap_transfers_not_self check (sender_id <> recipient_id),
  constraint zap_transfers_sender_idempotency_key_key unique (sender_id, idempotency_key)
);

create index if not exists zap_transfers_sender_created_idx
  on app_private.zap_transfers (sender_id, created_at desc);

create index if not exists zap_transfers_recipient_created_idx
  on app_private.zap_transfers (recipient_id, created_at desc);

alter table app_private.zap_transfers enable row level security;
revoke all on table app_private.zap_transfers from public, anon, authenticated, service_role;

create or replace function public.lookup_zap_transfer_recipient(
  p_sender_id uuid,
  p_identifier text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $function$
declare
  v_identifier text;
  v_recipient public.players%rowtype;
  v_match_count integer;
begin
  if p_sender_id is null or not exists (
    select 1 from public.players p where p.id = p_sender_id
  ) then
    raise exception 'Your player account could not be verified';
  end if;

  v_identifier := nullif(trim(both '@' from trim(coalesce(p_identifier, ''))), '');
  if v_identifier is null or length(v_identifier) < 3 or length(v_identifier) > 80 then
    raise exception 'Enter a valid ZORD username or referral code';
  end if;

  -- Referral codes are unique and take precedence over usernames.
  select p.* into v_recipient
  from public.players p
  where p.referral_code is not null
    and lower(p.referral_code) = lower(v_identifier);

  if not found then
    select count(*) into v_match_count
    from public.players p
    where p.username is not null
      and lower(ltrim(p.username, '@')) = lower(v_identifier);

    if v_match_count = 0 then
      raise exception 'No player was found. Check the username or referral code';
    elsif v_match_count > 1 then
      raise exception 'That username matches more than one player. Use a referral code instead';
    end if;

    select p.* into v_recipient
    from public.players p
    where p.username is not null
      and lower(ltrim(p.username, '@')) = lower(v_identifier)
    limit 1;
  end if;

  if v_recipient.id = p_sender_id then
    raise exception 'You cannot send ZAP to yourself';
  end if;

  return jsonb_build_object(
    'playerId', v_recipient.id,
    'username', v_recipient.username,
    'firstName', v_recipient.first_name,
    'displayName', coalesce(nullif(trim(v_recipient.first_name), ''), nullif(trim(v_recipient.username), ''), 'ZORD player')
  );
end;
$function$;

create or replace function public.transfer_player_zap(
  p_sender_id uuid,
  p_recipient_identifier text,
  p_amount numeric,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $function$
declare
  v_identifier text;
  v_recipient jsonb;
  v_recipient_id uuid;
  v_sender_wallet app_private.player_zap_wallets%rowtype;
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

    return jsonb_build_object(
      'success', true,
      'alreadyApplied', true,
      'transferId', v_transfer.id,
      'amount', v_transfer.amount,
      'senderBalance', v_sender_wallet.balance,
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

    return jsonb_build_object(
      'success', true,
      'alreadyApplied', true,
      'transferId', v_transfer.id,
      'amount', v_transfer.amount,
      'senderBalance', v_sender_wallet.balance,
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
$function$;

revoke all on function public.lookup_zap_transfer_recipient(uuid, text) from public, anon, authenticated;
grant execute on function public.lookup_zap_transfer_recipient(uuid, text) to service_role;

revoke all on function public.transfer_player_zap(uuid, text, numeric, text) from public, anon, authenticated;
grant execute on function public.transfer_player_zap(uuid, text, numeric, text) to service_role;
