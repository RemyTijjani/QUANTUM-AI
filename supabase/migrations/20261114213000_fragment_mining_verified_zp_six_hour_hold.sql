-- Release trusted Fragment mining into Verified ZP after a six-hour hold.
-- Only Fragment fixes recorded after this migration are eligible; no historical backfill.
-- Each fixed Fragment earns 0.02 ZP/second for the existing four-hour mining window.
-- 0.02 * 4 * 60 * 60 = 288 ZP, released six hours after the fix event.

create extension if not exists pg_cron with schema pg_catalog;

create table if not exists public.fragment_mining_rewards (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  action_event_id uuid not null unique references public.gameplay_action_events(id) on delete restrict,
  fragment_id text not null check (fragment_id in ('top', 'bottom', 'left', 'right')),
  amount numeric(18, 2) not null check (amount > 0),
  earned_at timestamptz not null,
  release_at timestamptz not null,
  credited_at timestamptz,
  created_at timestamptz not null default now(),
  check (release_at >= earned_at)
);

create index if not exists fragment_mining_rewards_due_idx
  on public.fragment_mining_rewards (release_at, player_id)
  where credited_at is null;

create index if not exists fragment_mining_rewards_player_pending_idx
  on public.fragment_mining_rewards (player_id, release_at)
  where credited_at is null;

alter table public.fragment_mining_rewards enable row level security;
revoke all on table public.fragment_mining_rewards from public, anon, authenticated;
grant select on table public.fragment_mining_rewards to service_role;

create or replace function public.enqueue_fragment_mining_reward()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.action_type = 'fragment_fixed' then
    insert into public.fragment_mining_rewards (
      player_id, action_event_id, fragment_id, amount, earned_at, release_at
    ) values (
      new.player_id,
      new.id,
      new.fragment_id,
      288.00,
      new.created_at,
      new.created_at + interval '6 hours'
    )
    on conflict (action_event_id) do nothing;
  end if;
  return new;
end;
$function$;

revoke all on function public.enqueue_fragment_mining_reward() from public, anon, authenticated;

drop trigger if exists enqueue_fragment_mining_reward_after_fix
  on public.gameplay_action_events;

create trigger enqueue_fragment_mining_reward_after_fix
after insert on public.gameplay_action_events
for each row
when (new.action_type = 'fragment_fixed')
execute function public.enqueue_fragment_mining_reward();

create or replace function public.release_matured_fragment_zp(p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_reward public.fragment_mining_rewards%rowtype;
  v_balance numeric(18, 2);
  v_count integer := 0;
  v_total numeric(18, 2) := 0;
begin
  if p_player_id is null then
    raise exception 'Player ID is required';
  end if;

  insert into public.player_economy (player_id, zp_balance, lifetime_zp, pending_kickback)
  values (p_player_id, 0, 0, 0)
  on conflict (player_id) do nothing;

  perform 1
  from public.player_economy
  where player_id = p_player_id
  for update;

  for v_reward in
    select *
    from public.fragment_mining_rewards
    where player_id = p_player_id
      and credited_at is null
      and release_at <= now()
    order by release_at, id
    for update
  loop
    update public.player_economy
    set zp_balance = coalesce(zp_balance, 0) + v_reward.amount,
        lifetime_zp = coalesce(lifetime_zp, 0) + v_reward.amount,
        updated_at = now()
    where player_id = p_player_id
    returning zp_balance into v_balance;

    insert into public.economy_ledger (
      player_id, transaction_type, amount, balance_after, reference_id, description
    ) values (
      p_player_id,
      'fragment_mining_reward',
      v_reward.amount,
      v_balance,
      v_reward.id::text,
      'Verified ZP from ' || upper(v_reward.fragment_id) || ' Fragment mining (six-hour hold completed)'
    );

    update public.fragment_mining_rewards
    set credited_at = now()
    where id = v_reward.id
      and credited_at is null;

    v_count := v_count + 1;
    v_total := v_total + v_reward.amount;
  end loop;

  return jsonb_build_object(
    'success', true,
    'creditedCount', v_count,
    'creditedAmount', v_total
  );
end;
$function$;

revoke all on function public.release_matured_fragment_zp(uuid) from public, anon, authenticated;
grant execute on function public.release_matured_fragment_zp(uuid) to service_role;

create or replace function public.release_all_matured_fragment_zp()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_player_id uuid;
  v_players_processed integer := 0;
begin
  for v_player_id in
    select distinct player_id
    from public.fragment_mining_rewards
    where credited_at is null
      and release_at <= now()
    order by player_id
  loop
    perform public.release_matured_fragment_zp(v_player_id);
    v_players_processed := v_players_processed + 1;
  end loop;
  return v_players_processed;
end;
$function$;

revoke all on function public.release_all_matured_fragment_zp() from public, anon, authenticated, service_role;

do $schedule$
begin
  if exists (select 1 from cron.job where jobname = 'release-matured-fragment-zp') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'release-matured-fragment-zp';
  end if;

  perform cron.schedule(
    'release-matured-fragment-zp',
    '* * * * *',
    'select public.release_all_matured_fragment_zp();'
  );
end;
$schedule$;
