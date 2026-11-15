-- Expose tightly permissioned public-schema RPC wrappers for the private
-- raffle funding operations. Only the trusted service role may execute them.

create or replace function public.confirm_external_raffle_zap_funding(
  p_amount numeric,
  p_transaction_reference text,
  p_confirmed_by text
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, app_private
as $function$
  select app_private.confirm_external_raffle_zap_funding(
    p_amount, p_transaction_reference, p_confirmed_by
  );
$function$;

create or replace function public.get_external_raffle_zap_funding()
returns jsonb
language sql
security definer
set search_path = pg_catalog, app_private
as $function$
  select jsonb_build_object(
    'availableReserve', coalesce(
      (select available_balance from app_private.raffle_zap_reserve where id = 1), 0
    ),
    'updatedAt', (select updated_at from app_private.raffle_zap_reserve where id = 1),
    'funding', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', id,
          'amount', amount,
          'transaction_reference', transaction_reference,
          'verification_method', verification_method,
          'confirmed_by', confirmed_by,
          'confirmed_at', confirmed_at
        ) order by confirmed_at desc
      )
      from (
        select id, amount, transaction_reference, verification_method, confirmed_by, confirmed_at
        from app_private.raffle_external_zap_funding
        order by confirmed_at desc
        limit 100
      ) recent
    ), '[]'::jsonb)
  );
$function$;

revoke all on function public.confirm_external_raffle_zap_funding(numeric, text, text)
  from public, anon, authenticated;
revoke all on function public.get_external_raffle_zap_funding()
  from public, anon, authenticated;
grant execute on function public.confirm_external_raffle_zap_funding(numeric, text, text)
  to service_role;
grant execute on function public.get_external_raffle_zap_funding()
  to service_role;
