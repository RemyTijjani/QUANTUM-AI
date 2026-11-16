-- Stage 7: virtual ZAP leaderboard competitors.
-- Virtual competitors are generated at read time; they are not player accounts
-- and never receive wallets, ledger entries, rewards, or transfer eligibility.
-- Their simulated scores reshuffle hourly while remaining above zero.
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

  with real_activity as (
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
      'virtual-' || s.id::text as competitor_key,
      null::uuid as player_id,
      (array[
        'Nova', 'Orion', 'Vega', 'Atlas', 'Nyx', 'Echo',
        'Astra', 'Raven', 'Sol', 'Onyx', 'Lyra', 'Zenith'
      ])[1 + ((s.id - 1) % 12)] || '-' || lpad(s.id::text, 5, '0') as display_name,
      case
        when s.id = 1 then 50000::numeric
        else (
          1000 + mod(
            abs(hashtextextended(
              s.id::text || ':' || extract(epoch from date_trunc('hour', now()))::bigint::text,
              73021
            )::numeric),
            49000
          )
        )::numeric
      end as ranking_earned,
      true as is_simulated
    from generate_series(1, 10518) as s(id)
  ),
  all_competitors as (
    select * from real_activity
    union all
    select * from virtual_activity
  ),
  ranked as (
    select
      c.*,
      row_number() over (
        order by c.ranking_earned desc, c.is_simulated asc, c.competitor_key asc
      )::integer as rank
    from all_competitors c
  )
  select jsonb_build_object(
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'rank', r.rank,
        'name', r.display_name,
        'rankingEarned', r.ranking_earned,
        'isYou', r.player_id = p_player_id,
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
