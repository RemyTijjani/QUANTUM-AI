alter table public.mission_tasks
  add column if not exists telegram_chat_id text;

create table if not exists public.telegram_mission_claims (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  mission_id text not null references public.mission_tasks(id) on delete cascade,
  telegram_chat_id text not null,
  telegram_user_id bigint not null,
  reward_zp numeric not null check (reward_zp > 0),
  claimed_at timestamptz not null default now(),
  unique (player_id, mission_id)
);

alter table public.telegram_mission_claims enable row level security;
revoke all on table public.telegram_mission_claims from public, anon, authenticated;
grant select, insert on table public.telegram_mission_claims to service_role;

create or replace function public.claim_verified_telegram_mission(
  p_player_id uuid,
  p_mission_id text,
  p_telegram_user_id bigint,
  p_telegram_chat_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_mission public.mission_tasks%rowtype;
  v_economy public.player_economy%rowtype;
  v_claim public.telegram_mission_claims%rowtype;
  v_balance numeric;
begin
  if p_player_id is null or p_telegram_user_id is null
     or nullif(trim(p_mission_id), '') is null
     or nullif(trim(p_telegram_chat_id), '') is null then
    raise exception 'A verified player and Telegram mission are required';
  end if;

  if not exists (
    select 1 from public.players p
    where p.id = p_player_id and p.telegram_id = p_telegram_user_id
  ) then
    raise exception 'Telegram identity does not match this player';
  end if;

  select * into v_mission
  from public.mission_tasks mt
  where mt.id = p_mission_id
    and mt.kind = 'social'
    and mt.status = 'published'
    and mt.reward_currency = 'ZP'
    and mt.unlock_cost_zp = 0
    and mt.telegram_chat_id = p_telegram_chat_id
  for share;

  if not found or v_mission.reward is null or v_mission.reward <= 0 then
    raise exception 'This Telegram mission is not currently claimable';
  end if;

  insert into public.player_economy (player_id, zp_balance, lifetime_zp, pending_kickback)
  values (p_player_id, 0, 0, 0)
  on conflict (player_id) do nothing;

  select * into v_economy
  from public.player_economy
  where player_id = p_player_id
  for update;

  insert into public.telegram_mission_claims (
    player_id, mission_id, telegram_chat_id, telegram_user_id, reward_zp
  ) values (
    p_player_id, p_mission_id, p_telegram_chat_id, p_telegram_user_id, v_mission.reward
  )
  on conflict (player_id, mission_id) do nothing
  returning * into v_claim;

  if not found then
    select * into v_claim
    from public.telegram_mission_claims
    where player_id = p_player_id and mission_id = p_mission_id;

    return jsonb_build_object(
      'success', true,
      'alreadyClaimed', true,
      'rewardZp', v_claim.reward_zp,
      'claimedAt', v_claim.claimed_at,
      'balanceAfter', coalesce(v_economy.zp_balance, 0)
    );
  end if;

  v_balance := coalesce(v_economy.zp_balance, 0) + v_mission.reward;

  update public.player_economy
  set zp_balance = v_balance,
      lifetime_zp = coalesce(lifetime_zp, 0) + v_mission.reward,
      updated_at = now()
  where player_id = p_player_id;

  insert into public.economy_ledger (
    player_id, transaction_type, amount, balance_after, reference_id, description
  ) values (
    p_player_id,
    'telegram_mission_reward',
    v_mission.reward,
    v_balance,
    'telegram-mission:' || p_mission_id,
    'Verified Telegram membership mission: ' || v_mission.title
  );

  return jsonb_build_object(
    'success', true,
    'alreadyClaimed', false,
    'rewardZp', v_mission.reward,
    'claimedAt', v_claim.claimed_at,
    'balanceAfter', v_balance
  );
end;
$function$;

revoke all on function public.claim_verified_telegram_mission(uuid, text, bigint, text) from public, anon, authenticated;
grant execute on function public.claim_verified_telegram_mission(uuid, text, bigint, text) to service_role;
