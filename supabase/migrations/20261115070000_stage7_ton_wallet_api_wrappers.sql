-- Stage 7: service-role-only API wrappers for the private TON wallet tables.
-- The private schema remains unexposed to browser clients.
create or replace function public.ton_wallet_create_challenge(
  p_player_id uuid,
  p_payload_hash text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active_count integer;
begin
  if p_player_id is null
     or p_payload_hash !~ '^[a-f0-9]{64}$'
     or p_expires_at <= now()
     or p_expires_at > now() + interval '10 minutes' then
    raise exception 'Invalid TON wallet challenge';
  end if;

  select count(*) into v_active_count
  from app_private.ton_wallet_proof_challenges
  where player_id = p_player_id
    and consumed_at is null
    and expires_at > now();

  if v_active_count >= 3 then
    raise exception 'Too many active wallet verification attempts';
  end if;

  insert into app_private.ton_wallet_proof_challenges(player_id, payload_hash, expires_at)
  values (p_player_id, p_payload_hash, p_expires_at);

  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.ton_wallet_consume_challenge(
  p_player_id uuid,
  p_payload_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_consumed_id uuid;
begin
  update app_private.ton_wallet_proof_challenges
  set consumed_at = now()
  where player_id = p_player_id
    and payload_hash = p_payload_hash
    and consumed_at is null
    and expires_at > now()
  returning id into v_consumed_id;

  return v_consumed_id is not null;
end;
$$;

create or replace function public.ton_wallet_save_verified(
  p_player_id uuid,
  p_wallet_address text,
  p_public_key text,
  p_proof_timestamp timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wallet app_private.player_ton_wallets%rowtype;
begin
  if p_player_id is null
     or nullif(trim(p_wallet_address), '') is null
     or p_public_key is null
     or p_public_key !~ '^[a-f0-9]{64} - interval '10 minutes'
     or p_proof_timestamp > now() + interval '60 seconds' then
    raise exception 'Invalid verified TON wallet details';
  end if;

  insert into app_private.player_ton_wallets(
    player_id, wallet_address, network, verification_status,
    proof_public_key, proof_timestamp, verified_at, revoked_at
  )
  values (
    p_player_id, p_wallet_address, '-239', 'verified',
    p_public_key, p_proof_timestamp, now(), null
  )
  on conflict (player_id) do update
  set wallet_address = excluded.wallet_address,
      network = excluded.network,
      verification_status = 'verified',
      proof_public_key = excluded.proof_public_key,
      proof_timestamp = excluded.proof_timestamp,
      verified_at = now(),
      revoked_at = null
  returning * into v_wallet;

  return jsonb_build_object(
    'id', v_wallet.id,
    'wallet_address', v_wallet.wallet_address,
    'network', v_wallet.network,
    'verification_status', v_wallet.verification_status,
    'verified_at', v_wallet.verified_at
  );
end;
$$;

create or replace function public.ton_wallet_get_data(p_player_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'wallet', (
      select jsonb_build_object(
        'id', w.id,
        'wallet_address', w.wallet_address,
        'network', w.network,
        'verification_status', w.verification_status,
        'verified_at', w.verified_at
      )
      from app_private.player_ton_wallets w
      where w.player_id = p_player_id
    ),
    'balance', coalesce((
      select jsonb_build_object(
        'availableNano', b.available_nano::text,
        'reservedNano', b.reserved_nano::text,
        'updatedAt', b.updated_at
      )
      from app_private.player_ton_balances b
      where b.player_id = p_player_id
    ), jsonb_build_object('availableNano', '0', 'reservedNano', '0', 'updatedAt', null)),
    'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'entry_type', t.entry_type,
        'direction', t.direction,
        'amount_nano', t.amount_nano::text,
        'available_after_nano', t.available_after_nano::text,
        'reference_type', t.reference_type,
        'created_at', t.created_at
      ) order by t.created_at desc)
      from (
        select *
        from app_private.player_ton_ledger
        where player_id = p_player_id
        order by created_at desc
        limit 10
      ) t
    ), '[]'::jsonb),
    'withdrawals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'amount_nano', r.amount_nano::text,
        'status', r.status,
        'wallet_address', r.wallet_address,
        'transaction_hash', r.transaction_hash,
        'admin_note', r.admin_note,
        'created_at', r.created_at,
        'updated_at', r.updated_at,
        'paid_at', r.paid_at
      ) order by r.created_at desc)
      from (
        select *
        from app_private.ton_withdrawal_requests
        where player_id = p_player_id
        order by created_at desc
        limit 10
      ) r
    ), '[]'::jsonb)
  )
  where exists (select 1 from public.players p where p.id = p_player_id);
$$;

create or replace function public.ton_wallet_request_withdrawal(
  p_player_id uuid,
  p_amount_nano numeric,
  p_idempotency_key text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select app_private.request_ton_withdrawal(p_player_id, p_amount_nano, p_idempotency_key);
$$;

revoke all on function public.ton_wallet_create_challenge(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.ton_wallet_consume_challenge(uuid, text) from public, anon, authenticated;
revoke all on function public.ton_wallet_save_verified(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.ton_wallet_get_data(uuid) from public, anon, authenticated;
revoke all on function public.ton_wallet_request_withdrawal(uuid, numeric, text) from public, anon, authenticated;

grant execute on function public.ton_wallet_create_challenge(uuid, text, timestamptz) to service_role;
grant execute on function public.ton_wallet_consume_challenge(uuid, text) to service_role;
grant execute on function public.ton_wallet_save_verified(uuid, text, text, timestamptz) to service_role;
grant execute on function public.ton_wallet_get_data(uuid) to service_role;
grant execute on function public.ton_wallet_request_withdrawal(uuid, numeric, text) to service_role;

     or p_proof_timestamp is null
     or p_proof_timestamp < now() - interval '10 minutes'
     or p_proof_timestamp > now() + interval '60 seconds' then
    raise exception 'Invalid verified TON wallet details';
  end if;

  insert into app_private.player_ton_wallets(
    player_id, wallet_address, network, verification_status,
    proof_public_key, proof_timestamp, verified_at, revoked_at
  )
  values (
    p_player_id, p_wallet_address, '-239', 'verified',
    p_public_key, p_proof_timestamp, now(), null
  )
  on conflict (player_id) do update
  set wallet_address = excluded.wallet_address,
      network = excluded.network,
      verification_status = 'verified',
      proof_public_key = excluded.proof_public_key,
      proof_timestamp = excluded.proof_timestamp,
      verified_at = now(),
      revoked_at = null
  returning * into v_wallet;

  return jsonb_build_object(
    'id', v_wallet.id,
    'wallet_address', v_wallet.wallet_address,
    'network', v_wallet.network,
    'verification_status', v_wallet.verification_status,
    'verified_at', v_wallet.verified_at
  );
end;
$$;

create or replace function public.ton_wallet_get_data(p_player_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'wallet', (
      select jsonb_build_object(
        'id', w.id,
        'wallet_address', w.wallet_address,
        'network', w.network,
        'verification_status', w.verification_status,
        'verified_at', w.verified_at
      )
      from app_private.player_ton_wallets w
      where w.player_id = p_player_id
    ),
    'balance', coalesce((
      select jsonb_build_object(
        'availableNano', b.available_nano::text,
        'reservedNano', b.reserved_nano::text,
        'updatedAt', b.updated_at
      )
      from app_private.player_ton_balances b
      where b.player_id = p_player_id
    ), jsonb_build_object('availableNano', '0', 'reservedNano', '0', 'updatedAt', null)),
    'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'entry_type', t.entry_type,
        'direction', t.direction,
        'amount_nano', t.amount_nano::text,
        'available_after_nano', t.available_after_nano::text,
        'reference_type', t.reference_type,
        'created_at', t.created_at
      ) order by t.created_at desc)
      from (
        select *
        from app_private.player_ton_ledger
        where player_id = p_player_id
        order by created_at desc
        limit 10
      ) t
    ), '[]'::jsonb),
    'withdrawals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'amount_nano', r.amount_nano::text,
        'status', r.status,
        'wallet_address', r.wallet_address,
        'transaction_hash', r.transaction_hash,
        'admin_note', r.admin_note,
        'created_at', r.created_at,
        'updated_at', r.updated_at,
        'paid_at', r.paid_at
      ) order by r.created_at desc)
      from (
        select *
        from app_private.ton_withdrawal_requests
        where player_id = p_player_id
        order by created_at desc
        limit 10
      ) r
    ), '[]'::jsonb)
  )
  where exists (select 1 from public.players p where p.id = p_player_id);
$$;

create or replace function public.ton_wallet_request_withdrawal(
  p_player_id uuid,
  p_amount_nano numeric,
  p_idempotency_key text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select app_private.request_ton_withdrawal(p_player_id, p_amount_nano, p_idempotency_key);
$$;

revoke all on function public.ton_wallet_create_challenge(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.ton_wallet_consume_challenge(uuid, text) from public, anon, authenticated;
revoke all on function public.ton_wallet_save_verified(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.ton_wallet_get_data(uuid) from public, anon, authenticated;
revoke all on function public.ton_wallet_request_withdrawal(uuid, numeric, text) from public, anon, authenticated;

grant execute on function public.ton_wallet_create_challenge(uuid, text, timestamptz) to service_role;
grant execute on function public.ton_wallet_consume_challenge(uuid, text) to service_role;
grant execute on function public.ton_wallet_save_verified(uuid, text, text, timestamptz) to service_role;
grant execute on function public.ton_wallet_get_data(uuid) to service_role;
grant execute on function public.ton_wallet_request_withdrawal(uuid, numeric, text) to service_role;


create or replace function public.admin_list_ton_withdrawals()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'player_id', r.player_id,
        'wallet_address', r.wallet_address,
        'amount_nano', r.amount_nano::text,
        'status', r.status,
        'admin_note', r.admin_note,
        'reviewed_by', r.reviewed_by,
        'reviewed_at', r.reviewed_at,
        'transaction_hash', r.transaction_hash,
        'created_at', r.created_at,
        'updated_at', r.updated_at,
        'paid_at', r.paid_at,
        'telegram_id', p.telegram_id,
        'username', p.username,
        'first_name', p.first_name
      ) order by r.created_at asc)
      from app_private.ton_withdrawal_requests r
      join public.players p on p.id = r.player_id
      where r.status in ('pending', 'approved', 'processing')
    ), '[]'::jsonb)
  );
$$;

create or replace function public.admin_transition_ton_withdrawal(
  p_request_id uuid,
  p_action text,
  p_admin_username text,
  p_admin_note text default null,
  p_transaction_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request app_private.ton_withdrawal_requests%rowtype;
  v_balance app_private.player_ton_balances%rowtype;
  v_next_status text;
  v_note text := nullif(trim(coalesce(p_admin_note, '')), '');
  v_hash text := nullif(trim(coalesce(p_transaction_hash, '')), '');
begin
  if p_request_id is null
     or p_action not in ('approve', 'reject', 'processing', 'paid')
     or nullif(trim(coalesce(p_admin_username, '')), '') is null then
    raise exception 'Valid withdrawal review details are required';
  end if;
  if v_note is not null and length(v_note) > 1000 then
    raise exception 'Admin note must be 1,000 characters or fewer';
  end if;

  select * into v_request
  from app_private.ton_withdrawal_requests
  where id = p_request_id
  for update;
  if not found then raise exception 'Withdrawal request was not found'; end if;

  select * into v_balance
  from app_private.player_ton_balances
  where player_id = v_request.player_id
  for update;
  if not found then raise exception 'Player TON balance was not found'; end if;

  if p_action = 'approve' then
    if v_request.status <> 'pending' then raise exception 'Only pending requests can be approved'; end if;
    v_next_status := 'approved';
  elsif p_action = 'reject' then
    if v_request.status not in ('pending', 'approved') then
      raise exception 'Only pending or approved requests can be rejected';
    end if;
    if v_balance.reserved_nano < v_request.amount_nano then
      raise exception 'Reserved TON balance is inconsistent; contact support';
    end if;
    update app_private.player_ton_balances
    set available_nano = available_nano + v_request.amount_nano,
        reserved_nano = reserved_nano - v_request.amount_nano,
        updated_at = now()
    where player_id = v_request.player_id
    returning * into v_balance;

    insert into app_private.player_ton_ledger(
      player_id, entry_type, direction, amount_nano,
      available_after_nano, reserved_after_nano,
      reference_type, reference_id, idempotency_key
    ) values (
      v_request.player_id, 'withdrawal_release', 'credit', v_request.amount_nano,
      v_balance.available_nano, v_balance.reserved_nano,
      'withdrawal_request', v_request.id, 'withdrawal:' || v_request.id::text || ':release'
    );
    v_next_status := 'rejected';
  elsif p_action = 'processing' then
    if v_request.status <> 'approved' then raise exception 'Only approved requests can move to processing'; end if;
    v_next_status := 'processing';
  else
    if v_request.status <> 'processing' then raise exception 'Only processing requests can be marked paid'; end if;
    if v_hash is null or length(v_hash) < 32 or length(v_hash) > 200 or v_hash ~ '\s' then
      raise exception 'Enter a valid TON transaction hash or reference';
    end if;
    if v_balance.reserved_nano < v_request.amount_nano then
      raise exception 'Reserved TON balance is inconsistent; contact support';
    end if;
    update app_private.player_ton_balances
    set reserved_nano = reserved_nano - v_request.amount_nano,
        updated_at = now()
    where player_id = v_request.player_id
    returning * into v_balance;

    insert into app_private.player_ton_ledger(
      player_id, entry_type, direction, amount_nano,
      available_after_nano, reserved_after_nano,
      reference_type, reference_id, idempotency_key
    ) values (
      v_request.player_id, 'withdrawal_paid', 'debit', v_request.amount_nano,
      v_balance.available_nano, v_balance.reserved_nano,
      'withdrawal_request', v_request.id, 'withdrawal:' || v_request.id::text || ':paid'
    );
    v_next_status := 'paid';
  end if;

  update app_private.ton_withdrawal_requests
  set status = v_next_status,
      admin_note = coalesce(v_note, admin_note),
      reviewed_by = p_admin_username,
      reviewed_at = now(),
      transaction_hash = case when p_action = 'paid' then v_hash else transaction_hash end,
      paid_at = case when p_action = 'paid' then now() else paid_at end,
      updated_at = now()
  where id = v_request.id
  returning * into v_request;

  return jsonb_build_object(
    'success', true,
    'id', v_request.id,
    'status', v_request.status,
    'amountNano', v_request.amount_nano::text,
    'transactionHash', v_request.transaction_hash
  );
end;
$$;

revoke all on function public.admin_list_ton_withdrawals() from public, anon, authenticated;
revoke all on function public.admin_transition_ton_withdrawal(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_list_ton_withdrawals() to service_role;
grant execute on function public.admin_transition_ton_withdrawal(uuid, text, text, text, text) to service_role;
