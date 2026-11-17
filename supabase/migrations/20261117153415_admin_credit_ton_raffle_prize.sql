-- Expose the existing idempotent TON/Gram raffle credit through a service-role-only admin RPC.
-- The wrapper records an audit entry in the same transaction as the balance credit.

create or replace function public.admin_credit_ton_raffle_prize(
  p_winner_id uuid,
  p_admin text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $function$
declare
  v_winner public.raffle_winners%rowtype;
  v_result jsonb;
  v_already_applied boolean;
begin
  if p_winner_id is null or nullif(btrim(p_admin), '') is null then
    raise exception 'A valid raffle winner and admin actor are required';
  end if;

  select *
    into v_winner
    from public.raffle_winners
    where id = p_winner_id
    for update;

  if not found or v_winner.prize_currency <> 'TON' then
    raise exception 'Gram raffle winner not found';
  end if;

  v_result := app_private.credit_ton_raffle_prize(
    p_winner_id,
    'raffle-winner:' || p_winner_id::text
  );
  v_already_applied := coalesce((v_result->>'alreadyApplied')::boolean, false);

  if not v_already_applied then
    insert into public.raffle_audit_log (raffle_id, actor, action, details)
    values (
      v_winner.raffle_id,
      p_admin,
      'ton_prize_credited',
      jsonb_build_object(
        'winner_id', p_winner_id,
        'player_id', v_winner.player_id,
        'prize_amount', v_winner.prize_amount,
        'prize_currency', 'TON',
        'delivery_status', 'withdrawable'
      )
    );
  end if;

  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
    'success', true,
    'winnerId', p_winner_id,
    'alreadyCredited', v_already_applied,
    'deliveryStatus', 'withdrawable'
  );
end;
$function$;

revoke all on function public.admin_credit_ton_raffle_prize(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_credit_ton_raffle_prize(uuid, text) to service_role;
