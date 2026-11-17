-- Core Rank is derived from current net ZAP (credits minus debits).
-- Rank 1 starts at 0; each additional 500 net ZAP advances one rank.
-- This migration enriches the existing server-authoritative achievements RPC;
-- it does not alter player balances, ledger entries, or reward ownership.

create or replace function public.get_player_zap_achievements(p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $function$
declare
  v_score numeric(30, 0);
  v_level bigint;
  v_core_rank bigint;
  v_current_threshold numeric(30, 0);
  v_next_threshold numeric(30, 0);
  v_rank_progress numeric(7, 3);
begin
  if p_player_id is null or not exists (
    select 1 from public.players p where p.id = p_player_id
  ) then
    raise exception 'Player account was not found';
  end if;

  -- get_zap_leaderboard calculates net ZAP from the trusted credit/debit ledger.
  select greatest(coalesce((public.get_zap_leaderboard(p_player_id, 1)->'me'->>'rankingEarned')::numeric, 0), 0)
    into v_score;

  v_level := floor(v_score / 100)::bigint;

  insert into app_private.player_zap_achievements (
    player_id, level, required_net_zap, is_unlocked, unlocked_at
  )
  select p_player_id, levels.level, levels.level * 100, true, now()
  from generate_series(1::bigint, v_level) as levels(level)
  on conflict (player_id, level) do update
    set is_unlocked = true,
        unlocked_at = case
          when not app_private.player_zap_achievements.is_unlocked
            then now()
          else app_private.player_zap_achievements.unlocked_at
        end,
        updated_at = now();

  update app_private.player_zap_achievements a
  set is_unlocked = false,
      updated_at = now()
  where a.player_id = p_player_id
    and a.required_net_zap > v_score
    and a.minted_at is null
    and a.is_unlocked;

  v_core_rank := floor(v_score / 500)::bigint + 1;
  v_current_threshold := (v_core_rank - 1) * 500;
  v_next_threshold := v_core_rank * 500;
  v_rank_progress := least(100, greatest(0,
    ((v_score - v_current_threshold) / 500) * 100
  ));

  return jsonb_build_object(
    'netZap', v_score,
    'currentLevel', v_level,
    'nextLevelAt', (v_level + 1) * 100,
    'coreRank', jsonb_build_object(
      'rankNumber', v_core_rank,
      'currentThreshold', v_current_threshold,
      'nextThreshold', v_next_threshold,
      'progressPercent', v_rank_progress
    ),
    'achievements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'level', a.level,
        'requiredNetZap', a.required_net_zap,
        'isUnlocked', (a.is_unlocked or a.minted_at is not null),
        'isMinted', (a.minted_at is not null),
        'unlockedAt', a.unlocked_at,
        'mintedAt', a.minted_at,
        'nftCollectionAddress', a.nft_collection_address,
        'nftItemAddress', a.nft_item_address,
        'nftTokenId', a.nft_token_id
      ) order by a.level)
      from app_private.player_zap_achievements a
      where a.player_id = p_player_id
    ), '[]'::jsonb)
  );
end;
$function$;
