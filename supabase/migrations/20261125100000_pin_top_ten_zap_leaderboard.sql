-- Pin the requested ten simulated accounts at the top of the ZAP leaderboard.
-- Keep 10,518 simulated competitors in total so a zero-ZAP new account starts
-- at rank 10,519. Remaining simulated scores stay below the pinned top ten.
create or replace function public.get_zap_leaderboard(
  p_player_id uuid,
  p_limit integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $function$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 10));
  v_result jsonb;
begin
  if p_player_id is null or not exists (
    select 1 from public.players p where p.id = p_player_id
  ) then
    raise exception 'Player account was not found';
  end if;

  with pinned_activity as (
    select
      'virtual-top-' || s.rank::text as competitor_key,
      null::uuid as player_id,
      s.display_name,
      s.ranking_earned::numeric as ranking_earned,
      true as is_simulated,
      s.rank::integer as fixed_rank
    from (values
      (1, 'Arman25', 45344),
      (2, 'Crypto_goon', 43175),
      (3, 'Wangam', 42765),
      (4, 'Am_young90', 42564),
      (5, 'Justcrypto', 40894),
      (6, 'Naryaum', 40679),
      (7, 'Wajun075', 40022),
      (8, 'Wagami_043', 38775),
      (9, 'Sharmannya', 38432),
      (10, 'Og_cryp', 38122)
    ) as s(rank, display_name, ranking_earned)
  ),
  real_activity as (
    select
      p.id::text as competitor_key,
      p.id as player_id,
      coalesce(nullif(trim(p.username), ''), nullif(trim(p.first_name), ''), 'ZORD Operative') as display_name,
      greatest(coalesce(sum(
        case
          when l.entry_type = 'credit' then l.amount
          when l.entry_type = 'debit' then -l.amount
          else 0
        end
      ), 0), 0)::numeric as ranking_earned,
      false as is_simulated
    from public.players p
    left join app_private.zap_ledger l on l.player_id = p.id
    group by p.id, p.username, p.first_name
  ),
  virtual_activity as (
    select
      'virtual-' || (s.id + 10)::text as competitor_key,
      null::uuid as player_id,
      (array[
        'neon','cosmic','shadow','cyber','nova','pixel','quantum','astro',
        'silent','frost','rapid','lunar','storm','ghost','crystal','zen'
      ])[1 + mod(abs(hashtextextended(
        s.id::text || ':' || extract(epoch from date_trunc('hour', now()))::bigint::text || ':name-a',
        41017
      )::numeric), 16)::integer] ||
      (array[
        'rider','wolf','pilot','spark','hunter','matrix','drift','viper',
        'orbit','ninja','raven','blaze','runner','cipher','comet','wave'
      ])[1 + mod(abs(hashtextextended(
        s.id::text || ':' || extract(epoch from date_trunc('hour', now()))::bigint::text || ':name-b',
        82031
      )::numeric), 16)::integer] ||
      mod(abs(hashtextextended(
        s.id::text || ':' || extract(epoch from date_trunc('hour', now()))::bigint::text || ':name-c',
        93017
      )::numeric), 9000)::integer::text as display_name,
      (
        1000 + mod(abs(hashtextextended(
          s.id::text || ':' || extract(epoch from date_trunc('hour', now()))::bigint::text || ':score',
          73021
        )::numeric), 37001)
      )::numeric as ranking_earned,
      true as is_simulated
    from generate_series(1, 10508) as s(id)
  ),
  dynamic_competitors as (
    select competitor_key, player_id, display_name, ranking_earned, is_simulated
    from real_activity
    union all
    select competitor_key, player_id, display_name, ranking_earned, is_simulated
    from virtual_activity
  ),
  dynamic_ranked as (
    select
      c.*,
      (row_number() over (
        order by c.ranking_earned desc, c.is_simulated asc, c.competitor_key asc
      ) + 10)::integer as rank
    from dynamic_competitors c
  ),
  ranked as (
    select
      p.competitor_key,
      p.player_id,
      p.display_name,
      p.ranking_earned,
      p.is_simulated,
      p.fixed_rank as rank
    from pinned_activity p
    union all
    select
      d.competitor_key,
      d.player_id,
      d.display_name,
      d.ranking_earned,
      d.is_simulated,
      d.rank
    from dynamic_ranked d
  )
  select jsonb_build_object(
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'rank', r.rank,
        'name', r.display_name,
        'rankingEarned', r.ranking_earned,
        'isYou', coalesce(r.player_id = p_player_id, false),
        'isSimulated', r.is_simulated
      ) order by r.rank)
      from ranked r
      where r.rank <= v_limit
    ), '[]'::jsonb),
    'me', (
      select jsonb_build_object(
        'rank', r.rank,
        'name', r.display_name,
        'rankingEarned', r.ranking_earned,
        'isYou', true,
        'isSimulated', false
      )
      from ranked r
      where r.player_id = p_player_id
    ),
    'limit', v_limit,
    'simulatedCount', 10518
  )
  into v_result;

  return v_result;
end;
$function$;

revoke all on function public.get_zap_leaderboard(uuid, integer) from public, anon, authenticated;
grant execute on function public.get_zap_leaderboard(uuid, integer) to service_role;
