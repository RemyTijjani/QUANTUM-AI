create or replace function public.admin_get_zap_circulation(
  p_search text default '',
  p_player_offset integer default 0,
  p_player_limit integer default 50,
  p_ledger_offset integer default 0,
  p_ledger_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_search text := left(trim(coalesce(p_search, '')), 64);
  v_player_offset integer := greatest(0, least(coalesce(p_player_offset, 0), 100000));
  v_player_limit integer := greatest(1, least(coalesce(p_player_limit, 50), 100));
  v_ledger_offset integer := greatest(0, least(coalesce(p_ledger_offset, 0), 1000000));
  v_ledger_limit integer := greatest(1, least(coalesce(p_ledger_limit, 100), 100));
  v_result jsonb;
begin
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'totalHeld', coalesce((select sum(w.balance) from app_private.player_zap_wallets w), 0)::text,
      'lifetimeEarned', coalesce((select sum(w.lifetime_earned) from app_private.player_zap_wallets w), 0)::text,
      'lifetimeSpent', coalesce((select sum(w.lifetime_spent) from app_private.player_zap_wallets w), 0)::text,
      'playersHolding', (select count(*) from app_private.player_zap_wallets w where w.balance > 0),
      'totalPlayers', (select count(*) from public.players),
      'transferCount', (select count(*) from app_private.zap_transfers),
      'transferredAmount', coalesce((select sum(t.amount) from app_private.zap_transfers t), 0)::text
    ),
    'playerCount', (
      select count(*)
      from public.players p
      left join app_private.player_zap_wallets w on w.player_id = p.id
      where v_search = ''
         or coalesce(p.username, '') ilike '%' || v_search || '%'
         or coalesce(p.first_name, '') ilike '%' || v_search || '%'
         or coalesce(p.referral_code, '') ilike '%' || v_search || '%'
         or (v_search ~ '^[0-9]+$' and p.telegram_id::text = v_search)
    ),
    'players', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.balance::numeric desc, x.player_id)
      from (
        select
          p.id as player_id,
          p.username,
          p.first_name,
          p.referral_code,
          coalesce(w.balance, 0)::text as balance,
          coalesce(w.lifetime_earned, 0)::text as lifetime_earned,
          coalesce(w.lifetime_spent, 0)::text as lifetime_spent,
          (select max(l.created_at) from app_private.zap_ledger l where l.player_id = p.id) as last_activity
        from public.players p
        left join app_private.player_zap_wallets w on w.player_id = p.id
        where v_search = ''
           or coalesce(p.username, '') ilike '%' || v_search || '%'
           or coalesce(p.first_name, '') ilike '%' || v_search || '%'
           or coalesce(p.referral_code, '') ilike '%' || v_search || '%'
           or (v_search ~ '^[0-9]+$' and p.telegram_id::text = v_search)
        order by coalesce(w.balance, 0) desc, p.id
        offset v_player_offset limit v_player_limit
      ) x
    ), '[]'::jsonb),
    'ledgerCount', (select count(*) from app_private.zap_ledger),
    'ledger', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id desc)
      from (
        select
          l.id,
          l.player_id,
          coalesce(nullif(p.username, ''), nullif(p.first_name, ''), 'ZORD player') as player_name,
          l.entry_type,
          l.amount::text as amount,
          l.balance_after::text as balance_after,
          l.source,
          l.source_reference,
          l.description,
          l.created_at
        from app_private.zap_ledger l
        join public.players p on p.id = l.player_id
        order by l.created_at desc, l.id desc
        offset v_ledger_offset limit v_ledger_limit
      ) x
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.admin_get_zap_circulation(text, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.admin_get_zap_circulation(text, integer, integer, integer, integer) to service_role;
