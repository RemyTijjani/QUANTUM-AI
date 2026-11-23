create table if not exists app_private.mystery_box_onclicka_sessions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  request_id uuid not null,
  telegram_user_id bigint not null check (telegram_user_id > 0),
  status text not null default 'pending' check (status in ('pending','completed','expired')),
  started_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '10 minutes'),
  onclicka_confirmed_at timestamptz,
  sdk_completed_at timestamptz,
  completed_at timestamptz,
  result jsonb,
  unique (player_id, request_id)
);

create index if not exists mystery_box_onclicka_sessions_player_status_idx
  on app_private.mystery_box_onclicka_sessions(player_id, status, started_at desc);
create unique index if not exists mystery_box_onclicka_one_pending_per_player_idx
  on app_private.mystery_box_onclicka_sessions(player_id) where status='pending';

create or replace function app_private.grant_mystery_box_after_onclicka(p_player_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public','app_private','extensions','pg_temp'
as $function$
declare
  v_state app_private.player_repeat_mystery_box_state%rowtype;
  v_existing app_private.repeat_mystery_box_requests%rowtype;
  v_entitlement_id uuid := gen_random_uuid();
  v_bytes bytea; v_uint bigint; v_roll integer; v_tier text;
  v_cooldown_until timestamptz; v_result jsonb;
begin
  select * into v_existing from app_private.repeat_mystery_box_requests
    where player_id=p_player_id and request_id=p_request_id;
  if found then return v_existing.result; end if;

  insert into app_private.player_repeat_mystery_box_state(player_id)
    values(p_player_id) on conflict(player_id) do nothing;
  select * into v_state from app_private.player_repeat_mystery_box_state
    where player_id=p_player_id for update;
  if v_state.cooldown_until is not null and v_state.cooldown_until>now() then
    return jsonb_build_object('success',false,'code','cooldown_active',
      'cooldownUntil',v_state.cooldown_until,
      'message','A Mystery Box was opened recently. Please wait for the shared 2-hour cooldown.');
  end if;

  loop
    v_bytes:=extensions.gen_random_bytes(4);
    v_uint:=get_byte(v_bytes,0)::bigint*16777216+get_byte(v_bytes,1)::bigint*65536
      +get_byte(v_bytes,2)::bigint*256+get_byte(v_bytes,3)::bigint;
    exit when v_uint<4294967200;
  end loop;
  v_roll:=(v_uint%100)::integer;
  v_tier:=case when v_roll<80 then 'standard' else 'premium' end;

  insert into app_private.player_reward_entitlements(
    id,player_id,reward_type,reward_code,source,source_reference,idempotency_key,metadata
  ) values(v_entitlement_id,p_player_id,'mystery_box',v_tier||'_mystery_box',
    'repeat_purchase',p_request_id::text,'repeat-box:'||p_request_id::text,
    jsonb_build_object('box_tier',v_tier,'pool_version',1,'paid_with','onclicka'));

  v_result:=public.open_mystery_box(p_player_id,v_entitlement_id);
  v_cooldown_until:=now()+interval '2 hours';
  v_result:=v_result||jsonb_build_object('repeatPurchase',true,'costZp',0,'paidWith','onclicka',
    'cooldownUntil',v_cooldown_until,'tierChance',jsonb_build_object('standard',80,'premium',20));
  update app_private.player_repeat_mystery_box_state
    set cooldown_until=v_cooldown_until,updated_at=now() where player_id=p_player_id;
  insert into app_private.repeat_mystery_box_requests(player_id,request_id,method,result)
    values(p_player_id,p_request_id,'ad',v_result);
  return v_result;
end;
$function$;

create or replace function public.begin_mystery_box_onclicka_session(p_player_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public','app_private','pg_temp'
as $function$
declare
  v_telegram_id bigint; v_state app_private.player_repeat_mystery_box_state%rowtype;
  v_session app_private.mystery_box_onclicka_sessions%rowtype;
begin
  if p_player_id is null or p_request_id is null then raise exception 'Invalid Mystery Box OnClicka session request'; end if;
  select telegram_id into v_telegram_id from public.players where id=p_player_id;
  if not found or v_telegram_id is null or v_telegram_id<=0 then raise exception 'Player Telegram identity is unavailable'; end if;

  insert into app_private.player_repeat_mystery_box_state(player_id)
    values(p_player_id) on conflict(player_id) do nothing;
  select * into v_state from app_private.player_repeat_mystery_box_state
    where player_id=p_player_id for update;
  if v_state.cooldown_until is not null and v_state.cooldown_until>now() then
    return jsonb_build_object('success',false,'code','cooldown_active',
      'cooldownUntil',v_state.cooldown_until,'message','Your shared 2-hour Mystery Box cooldown is active.');
  end if;

  update app_private.mystery_box_onclicka_sessions set status='expired'
    where player_id=p_player_id and status='pending' and expires_at<=clock_timestamp();
  select * into v_session from app_private.mystery_box_onclicka_sessions
    where player_id=p_player_id and request_id=p_request_id;
  if found then
    if v_session.status='pending' and v_session.expires_at>clock_timestamp() then
      return jsonb_build_object('success',true,'sessionId',v_session.id,'provider','onclicka','spotId',6155605,'expiresAt',v_session.expires_at);
    end if;
    return jsonb_build_object('success',false,'code','session_already_used','message','This OnClicka request has already been used. Start a new ad request.');
  end if;

  select * into v_session from app_private.mystery_box_onclicka_sessions
    where player_id=p_player_id and status='pending' and expires_at>clock_timestamp()
    order by started_at desc limit 1 for update;
  if found then return jsonb_build_object('success',true,'sessionId',v_session.id,'provider','onclicka','spotId',6155605,'expiresAt',v_session.expires_at); end if;

  insert into app_private.mystery_box_onclicka_sessions(player_id,request_id,telegram_user_id)
    values(p_player_id,p_request_id,v_telegram_id) returning * into v_session;
  return jsonb_build_object('success',true,'sessionId',v_session.id,'provider','onclicka','spotId',6155605,'expiresAt',v_session.expires_at);
end;
$function$;

create or replace function public.try_complete_mystery_box_onclicka(p_session_id uuid)
returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public','app_private','extensions','pg_temp'
as $function$
declare v_session app_private.mystery_box_onclicka_sessions%rowtype; v_result jsonb;
begin
  select * into v_session from app_private.mystery_box_onclicka_sessions where id=p_session_id for update;
  if not found then return jsonb_build_object('success',false,'reason','session_not_found'); end if;
  if v_session.status='completed' then
    return coalesce(v_session.result,jsonb_build_object('success',true,'completed',true))||jsonb_build_object('completed',true,'alreadyCompleted',true);
  end if;
  if v_session.status<>'pending' or v_session.expires_at<=clock_timestamp() then
    update app_private.mystery_box_onclicka_sessions set status='expired' where id=p_session_id and status='pending';
    return jsonb_build_object('success',false,'reason','session_expired');
  end if;
  if v_session.onclicka_confirmed_at is null or v_session.sdk_completed_at is null then
    return jsonb_build_object('success',true,'completed',false,'pendingVerification',true);
  end if;
  v_result:=app_private.grant_mystery_box_after_onclicka(v_session.player_id,v_session.request_id);
  if v_result->>'success' is distinct from 'true' then return v_result; end if;
  update app_private.mystery_box_onclicka_sessions set status='completed',completed_at=clock_timestamp(),result=v_result
    where id=p_session_id and status='pending';
  return v_result||jsonb_build_object('completed',true);
end;
$function$;

create or replace function public.confirm_mystery_box_onclicka_sdk(p_player_id uuid,p_session_id uuid)
returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public','app_private','pg_temp'
as $function$
declare v_session app_private.mystery_box_onclicka_sessions%rowtype;
begin
  select * into v_session from app_private.mystery_box_onclicka_sessions
    where id=p_session_id and player_id=p_player_id for update;
  if not found then return jsonb_build_object('success',false,'reason','session_not_found'); end if;
  if v_session.status='completed' then
    return coalesce(v_session.result,jsonb_build_object('success',true,'completed',true))||jsonb_build_object('completed',true,'alreadyCompleted',true);
  end if;
  if v_session.status<>'pending' or v_session.expires_at<=clock_timestamp() then return jsonb_build_object('success',false,'reason','session_expired'); end if;
  update app_private.mystery_box_onclicka_sessions set sdk_completed_at=coalesce(sdk_completed_at,clock_timestamp())
    where id=p_session_id and player_id=p_player_id and status='pending';
  return public.try_complete_mystery_box_onclicka(p_session_id);
end;
$function$;

create or replace function public.record_onclicka_mystery_box_view(p_telegram_id bigint)
returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public','app_private','pg_temp'
as $function$
declare v_player_id uuid; v_session app_private.mystery_box_onclicka_sessions%rowtype;
begin
  if p_telegram_id is null or p_telegram_id<=0 then return jsonb_build_object('success',false,'reason','invalid_telegram_user'); end if;
  select id into v_player_id from public.players where telegram_id=p_telegram_id;
  if v_player_id is null then return jsonb_build_object('success',false,'reason','player_not_found'); end if;
  select * into v_session from app_private.mystery_box_onclicka_sessions
    where player_id=v_player_id and telegram_user_id=p_telegram_id and status='pending' and expires_at>clock_timestamp()
    order by started_at desc limit 1 for update;
  if not found then
    select * into v_session from app_private.mystery_box_onclicka_sessions
      where player_id=v_player_id and telegram_user_id=p_telegram_id and status='completed' and onclicka_confirmed_at is not null
      order by completed_at desc limit 1;
    if found then return coalesce(v_session.result,jsonb_build_object('success',true,'completed',true))||jsonb_build_object('completed',true,'alreadyCompleted',true); end if;
    return jsonb_build_object('success',false,'reason','no_eligible_session');
  end if;
  update app_private.mystery_box_onclicka_sessions
    set onclicka_confirmed_at=coalesce(onclicka_confirmed_at,clock_timestamp()) where id=v_session.id;
  return public.try_complete_mystery_box_onclicka(v_session.id);
end;
$function$;

revoke all on function app_private.grant_mystery_box_after_onclicka(uuid,uuid) from public,anon,authenticated;
revoke all on function public.begin_mystery_box_onclicka_session(uuid,uuid) from public,anon,authenticated;
revoke all on function public.try_complete_mystery_box_onclicka(uuid) from public,anon,authenticated;
revoke all on function public.confirm_mystery_box_onclicka_sdk(uuid,uuid) from public,anon,authenticated;
revoke all on function public.record_onclicka_mystery_box_view(bigint) from public,anon,authenticated;
grant execute on function public.begin_mystery_box_onclicka_session(uuid,uuid) to service_role;
grant execute on function public.try_complete_mystery_box_onclicka(uuid) to service_role;
grant execute on function public.confirm_mystery_box_onclicka_sdk(uuid,uuid) to service_role;
grant execute on function public.record_onclicka_mystery_box_view(bigint) to service_role;
