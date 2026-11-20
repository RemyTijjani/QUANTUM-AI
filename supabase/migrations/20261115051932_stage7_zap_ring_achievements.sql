-- Stage 7: persistent ZAP ring achievements.
-- One achievement level is unlocked for every 100 net ZAP.
-- Minting is optional and is recorded only after a future TON-chain verification flow.

create table if not exists app_private.player_zap_achievements (
  player_id uuid not null references public.players(id) on delete cascade,
  level bigint not null check (level > 0),
  required_net_zap numeric(30, 0) not null,
  is_unlocked boolean not null default false,
  unlocked_at timestamptz,
  minted_at timestamptz,
  mint_transaction_hash text,
  nft_collection_address text,
  nft_item_address text,
  nft_token_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (player_id, level),
  constraint player_zap_achievements_threshold_check
    check (required_net_zap = level * 100),
  constraint player_zap_achievements_mint_data_check
    check (
      minted_at is null
      or (
        mint_transaction_hash is not null
        and nft_collection_address is not null
        and nft_item_address is not null
      )
    )
);

create unique index if not exists player_zap_achievements_mint_tx_uidx
  on app_private.player_zap_achievements(mint_transaction_hash)
  where mint_transaction_hash is not null;

create index if not exists player_zap_achievements_player_unlocked_idx
  on app_private.player_zap_achievements(player_id, is_unlocked, level desc);

alter table app_private.player_zap_achievements enable row level security;
revoke all on table app_private.player_zap_achievements from public, anon, authenticated;
grant select, insert, update, delete on table app_private.player_zap_achievements to service_role;

create or replace function public.get_player_zap_achievements(p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $function$
declare
  v_score numeric(30, 0);
  v_level bigint;
begin
  if p_player_id is null or not exists (
    select 1 from public.players p where p.id = p_player_id
  ) then
    raise exception 'Player account was not found';
  end if;

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

  return jsonb_build_object(
    'netZap', v_score,
    'currentLevel', v_level,
    'nextLevelAt', (v_level + 1) * 100,
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

revoke all on function public.get_player_zap_achievements(uuid) from public, anon, authenticated;
grant execute on function public.get_player_zap_achievements(uuid) to service_role;
