-- Admin-only read model for the Referral Management dashboard.
-- All private referral data is returned through one privileged RPC; no private
-- schema tables are exposed through the browser-facing Data API.

create or replace function public.admin_get_referral_management()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'app_private', 'pg_temp'
as $function$
declare
  v_budget jsonb;
  v_config app_private.referral_kickback_config%rowtype;
  v_players jsonb;
  v_entries jsonb;
  v_history jsonb;
  v_referral_count bigint;
begin
  v_budget := public.admin_get_referral_kickback_budget();

  select * into v_config
  from app_private.referral_kickback_config
  where singleton = true;

  select coalesce(jsonb_agg(x.player order by x.created_at desc), '[]'::jsonb)
  into v_players
  from (
    select
      p.created_at,
      jsonb_build_object(
        'id', p.id,
        'username', p.username,
        'first_name', p.first_name,
        'referral_code', p.referral_code,
        'created_at', p.created_at,
        'status', coalesce(c.status, 'active'),
        'reason', c.reason,
        'referralCount', coalesce(r.referral_count, 0),
        'levelOneCount', coalesce(r.referral_count, 0)
      ) as player
    from public.players p
    left join app_private.referral_kickback_account_controls c
      on c.player_id = p.id
    left join (
      select referrer_id, count(*)::integer as referral_count
      from public.referral_sub_nodes
      where referrer_id is not null
      group by referrer_id
    ) r on r.referrer_id = p.id
    order by p.created_at desc
    limit 200
  ) x;

  select coalesce(jsonb_agg(x.entry order by x.created_at desc), '[]'::jsonb)
  into v_entries
  from (
    select
      e.created_at,
      jsonb_build_object(
        'id', e.id,
        'recipient_player_id', e.recipient_player_id,
        'source_player_id', e.source_player_id,
        'referral_level', e.referral_level,
        'amount', e.amount,
        'allocated_amount', e.allocated_amount,
        'claimed_amount', e.claimed_amount,
        'status', e.status,
        'eligible_at', e.eligible_at,
        'created_at', e.created_at,
        'recipientLabel', coalesce(
          case when p.username is not null then '@' || p.username end,
          p.first_name,
          p.referral_code,
          e.recipient_player_id::text
        )
      ) as entry
    from app_private.referral_kickback_entries e
    left join public.players p on p.id = e.recipient_player_id
    order by e.created_at desc
    limit 100
  ) x;

  select coalesce(jsonb_agg(to_jsonb(h) order by h.created_at desc), '[]'::jsonb)
  into v_history
  from (
    select id, month_start, old_budget_zp, new_budget_zp, admin_username, created_at
    from app_private.referral_kickback_budget_history
    order by created_at desc
    limit 50
  ) h;

  select count(*) into v_referral_count
  from public.referral_sub_nodes;

  return jsonb_build_object(
    'budget', v_budget,
    'rates', jsonb_build_object(
      'directRate', v_config.direct_rate,
      'secondLevelRate', v_config.second_level_rate,
      'overclockMultiplier', v_config.overclock_multiplier,
      'pendingHours', v_config.pending_hours
    ),
    'referralStats', jsonb_build_object(
      'total', v_referral_count,
      'directRelationships', v_referral_count
    ),
    'players', v_players,
    'entries', v_entries,
    'history', v_history
  );
end;
$function$;

revoke all on function public.admin_get_referral_management()
  from public, anon, authenticated;
grant execute on function public.admin_get_referral_management()
  to service_role;
