-- Snapshot reward currency and amount for Telegram and Creator Ops mission claims.
-- Legacy rows remain ZP and preserve their existing reward_zp values.
alter table public.creator_ops_submissions
  add column if not exists reward_currency text not null default 'ZP',
  add column if not exists reward_amount numeric not null default 0;

update public.creator_ops_submissions
set reward_amount = coalesce(reward_zp, 0)
where reward_amount = 0 and coalesce(reward_zp, 0) <> 0;

alter table public.creator_ops_submissions
  add constraint creator_ops_submissions_reward_currency_check check (reward_currency in ('ZP','ZAP')),
  add constraint creator_ops_submissions_reward_amount_check check (reward_amount >= 0 and reward_amount = trunc(reward_amount));

alter table public.telegram_mission_claims
  add column if not exists reward_currency text not null default 'ZP',
  add column if not exists reward_amount numeric;

update public.telegram_mission_claims set reward_amount = reward_zp where reward_amount is null;

alter table public.telegram_mission_claims
  alter column reward_amount set not null,
  add constraint telegram_mission_claims_reward_currency_check check (reward_currency in ('ZP','ZAP')),
  add constraint telegram_mission_claims_reward_amount_check check (reward_amount > 0 and reward_amount = trunc(reward_amount));

create or replace function public.claim_verified_telegram_mission(
  p_player_id uuid, p_mission_id text, p_telegram_user_id bigint, p_telegram_chat_id text
) returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog','public','app_private','pg_temp'
as $function$
declare
  v_mission public.mission_tasks%rowtype;
  v_economy public.player_economy%rowtype;
  v_claim public.telegram_mission_claims%rowtype;
  v_balance numeric;
  v_ledger jsonb;
begin
  if p_player_id is null or p_telegram_user_id is null
     or nullif(trim(p_mission_id),'') is null or nullif(trim(p_telegram_chat_id),'') is null then
    raise exception 'A verified player and Telegram mission are required';
  end if;
  if not exists(select 1 from public.players p where p.id=p_player_id and p.telegram_id=p_telegram_user_id) then
    raise exception 'Telegram identity does not match this player';
  end if;
  select * into v_mission from public.mission_tasks mt
  where mt.id=p_mission_id and mt.kind='social' and mt.status='published'
    and mt.reward_currency in ('ZP','ZAP') and mt.unlock_cost_zp=0
    and mt.telegram_chat_id=p_telegram_chat_id for share;
  if not found or v_mission.reward is null or v_mission.reward<=0 then
    raise exception 'This Telegram mission is not currently claimable';
  end if;

  insert into public.telegram_mission_claims(
    player_id,mission_id,telegram_chat_id,telegram_user_id,reward_zp,reward_currency,reward_amount
  ) values (
    p_player_id,p_mission_id,p_telegram_chat_id,p_telegram_user_id,
    case when v_mission.reward_currency='ZP' then v_mission.reward else 0 end,
    v_mission.reward_currency,v_mission.reward
  ) on conflict(player_id,mission_id) do nothing returning * into v_claim;

  if not found then
    select * into v_claim from public.telegram_mission_claims
    where player_id=p_player_id and mission_id=p_mission_id;
    if v_claim.reward_currency='ZAP' then
      select w.balance into v_balance from app_private.player_zap_wallets w where w.player_id=p_player_id;
      return jsonb_build_object('success',true,'alreadyClaimed',true,'rewardZap',v_claim.reward_amount,
        'claimedAt',v_claim.claimed_at,'balanceAfter',coalesce(v_balance,0));
    end if;
    select coalesce(pe.zp_balance,0) into v_balance from public.player_economy pe where pe.player_id=p_player_id;
    return jsonb_build_object('success',true,'alreadyClaimed',true,'rewardZp',v_claim.reward_amount,
      'claimedAt',v_claim.claimed_at,'balanceAfter',coalesce(v_balance,0));
  end if;

  if v_mission.reward_currency='ZAP' then
    v_ledger:=public.apply_player_zap_ledger_entry(
      p_player_id,'credit',v_mission.reward,'telegram_mission_reward',
      'telegram-mission:'||p_mission_id,'telegram-mission:'||p_player_id::text||':'||p_mission_id,
      'Verified Telegram membership mission: '||v_mission.title
    );
    return jsonb_build_object('success',true,'alreadyClaimed',false,'rewardZap',v_mission.reward,
      'claimedAt',v_claim.claimed_at,'balanceAfter',v_ledger->'balanceAfter');
  end if;

  insert into public.player_economy(player_id,zp_balance,lifetime_zp,pending_kickback)
  values(p_player_id,0,0,0) on conflict(player_id) do nothing;
  select * into v_economy from public.player_economy where player_id=p_player_id for update;
  v_balance:=coalesce(v_economy.zp_balance,0)+v_mission.reward;
  update public.player_economy set zp_balance=v_balance,
    lifetime_zp=coalesce(lifetime_zp,0)+v_mission.reward,updated_at=now()
  where player_id=p_player_id;
  insert into public.economy_ledger(player_id,transaction_type,amount,balance_after,reference_id,description)
  values(p_player_id,'telegram_mission_reward',v_mission.reward,v_balance,
    'telegram-mission:'||p_mission_id,'Verified Telegram membership mission: '||v_mission.title);
  return jsonb_build_object('success',true,'alreadyClaimed',false,'rewardZp',v_mission.reward,
    'claimedAt',v_claim.claimed_at,'balanceAfter',v_balance);
end;
$function$;

create or replace function public.submit_creator_ops_submission(p_player_id uuid,p_mission_id text,p_link_url text)
returns setof public.creator_ops_submissions
language plpgsql security definer
set search_path to 'pg_catalog','public','pg_temp'
as $function$
declare
  v_referral_code text;
  v_reward integer;
  v_reward_currency text;
  v_unlock_cost_zp bigint;
  v_platform text;
  v_mission_status text;
  v_link_url text;
  v_content_id text;
begin
  if p_player_id is null then raise exception 'Player identity is required'; end if;
  v_link_url:=btrim(p_link_url);
  if v_link_url is null or v_link_url='' or length(v_link_url)>2048
    or v_link_url ~ '[[:space:]]' or v_link_url !~* '^https?://' then raise exception 'Invalid submission link'; end if;
  select p.referral_code into v_referral_code from public.players p where p.id=p_player_id;
  if not found or v_referral_code is null then raise exception 'Player profile not found'; end if;
  select mt.reward,mt.reward_currency,mt.unlock_cost_zp,
    coalesce(nullif(lower(btrim(mt.platform)),''),'youtube'),lower(btrim(mt.status))
  into v_reward,v_reward_currency,v_unlock_cost_zp,v_platform,v_mission_status
  from public.mission_tasks mt where mt.id=p_mission_id and mt.kind='creator' for share;
  if not found then raise exception 'Creator mission not found'; end if;
  if v_mission_status is distinct from 'published' then raise exception 'Creator mission is not currently published'; end if;
  if v_reward_currency not in ('ZP','ZAP') then raise exception 'Creator mission reward currency is invalid'; end if;
  if v_unlock_cost_zp is distinct from 0 then raise exception 'Creator Ops missions must not require ZP to unlock'; end if;
  if v_reward is null or v_reward<=0 then raise exception 'Invalid mission reward'; end if;
  if v_platform not in ('youtube','tiktok') then raise exception 'Unsupported creator platform'; end if;
  v_content_id:=public.creator_ops_extract_content_id(v_platform,v_link_url);
  if v_content_id is null then
    if v_platform='youtube' then raise exception 'Submit a valid YouTube video, Shorts, or live-video URL';
    else raise exception 'Submit a full TikTok video URL; shortened TikTok links are not accepted'; end if;
  end if;
  if exists(select 1 from public.creator_ops_submissions s where s.player_id=p_player_id
    and s.mission_id=p_mission_id and s.platform=v_platform and s.content_id=v_content_id) then
    raise exception 'This video has already been submitted for this mission';
  end if;
  begin
    return query insert into public.creator_ops_submissions(
      mission_id,player_referral_code,link_url,platform,content_id,reward_zp,reward_currency,reward_amount,status,player_id
    ) values (
      p_mission_id,v_referral_code,v_link_url,v_platform,v_content_id,
      case when v_reward_currency='ZP' then v_reward else 0 end,v_reward_currency,v_reward,'pending',p_player_id
    ) on conflict(player_id,mission_id) where status='pending' and player_id is not null
      do nothing returning *;
  exception when unique_violation then raise exception 'This video has already been submitted for this mission'; end;
  if not found then raise exception 'A pending submission already exists for this mission'; end if;
end;
$function$;

revoke all on function public.claim_verified_telegram_mission(uuid,text,bigint,text) from public,anon,authenticated;
grant execute on function public.claim_verified_telegram_mission(uuid,text,bigint,text) to service_role;
revoke all on function public.submit_creator_ops_submission(uuid,text,text) from public,anon,authenticated;
grant execute on function public.submit_creator_ops_submission(uuid,text,text) to service_role;
