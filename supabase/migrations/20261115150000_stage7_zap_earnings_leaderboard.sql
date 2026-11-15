-- Stage 7: verified ZAP earnings leaderboard.
-- Ranking excludes ZAP credited by ZP-to-ZAP conversion, so converting points
-- cannot inflate a player's competitive earnings score.

create or replace function public.get_zap_leaderboard(
  p_player_id uuid,
  p_limit integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $function$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 50));
  v_result jsonb;
  v_me jsonb;
begin
  if p_player_id is null or not exists (
    select 1 from public.players p where p.id = p_player_id
  ) then
    raise exception 'Player account was not found';
  end if;

  with earned as (
    select
      p.id as player_id,
      coalesce(nullif(trim(p.username), ''), nullif(trim(p.first_name), ''), 'ZORD Operative') as display_name,
      coalesce(sum(l.amount) filter (
        where l.entry_type = 'credit'
          and l.source is distinct from 'zp_conversion'
      ), 0)::numeric as ranking_earned
    from public.players p
    left join app_private.zap_ledger l on l.player_id = p.id
    group by p.id, p.username, p.first_name
  ),
  ranked as (
    select
      e.*,
      row_number() over (order by e.ranking_earned desc, e.player_id asc)::integer as rank
    from earned e
  )
  select jsonb_build_object(
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'rank', r.rank,
        'name', r.display_name,
        'rankingEarned', r.ranking_earned,
        'isYou', r.player_id = p_player_id
      ) order by r.rank)
      from ranked r
      where r.rank <= v_limit
    ), '[]'::jsonb),
    'me', (
      select jsonb_build_object(
        'rank', r.rank,
        'name', r.display_name,
        'rankingEarned', r.ranking_earned,
        'isYou', true
      )
      from ranked r
      where r.player_id = p_player_id
    ),
    'limit', v_limit
  )
  into v_result;

  return v_result;
end;
$function$;

revoke all on function public.get_zap_leaderboard(uuid, integer) from public, anon, authenticated;
grant execute on function public.get_zap_leaderboard(uuid, integer) to service_role;
