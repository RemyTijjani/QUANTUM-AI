create table if not exists app_private.mystery_box_monetag_sessions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  request_id uuid not null,
  monetag_ymid text not null unique,
  status text not null default 'pending' check (status in ('pending','completed','expired')),
  started_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '15 minutes'),
  monetag_valued_at timestamptz,
  sdk_completed_at timestamptz,
  completed_at timestamptz,
  result jsonb,
  unique(player_id, request_id)
);
create index if not exists mystery_box_monetag_sessions_pending_idx
  on app_private.mystery_box_monetag_sessions (expires_at)
  where status = 'pending';
alter table app_private.mystery_box_monetag_sessions enable row level security;
revoke all on table app_private.mystery_box_monetag_sessions from public, anon, authenticated;
grant all on table app_private.mystery_box_monetag_sessions to service_role;

create or replace function app_private.grant_mystery_box_after_monetag(p_player_id uuid,p_request_id uuid)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, app_private, extensions, pg_temp
as $$
declare
  v_state app_private.player_repeat_mystery_box_state%rowtype;
  v_existing app_private.repeat_mystery_box_requests%rowtype;
  v_entitlement_id uuid := gen_random_uuid();
  v_bytes bytea;
  v_uint bigint;
  v_roll integer;
  v_tier text;
  v_cooldown_until timestamptz;
  v_result jsonb;
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
    v_bytes := extensions.gen_random_bytes(4);
    v_uint := get_byte(v_bytes,0)::bigint*16777216
      + get_byte(v_bytes,1)::bigint*65536
      + get_byte(v_bytes,2)::bigint*256+get_byte(v_bytes,3)::bigint;
    exit when v_uint<4294967200;
  end loop;
  v_roll := (v_uint%100)::integer;
  v_tier := case when v_roll<80 then 'standard' else 'premium' end;

  insert into app_private.player_reward_entitlements(
    id,player_id,reward_type,reward_code,source,source_reference,idempotency_key,metadata
  ) values (
    v_entitlement_id,p_player_id,'mystery_box',v_tier||'_mystery_box',
    'repeat_purchase',p_request_id::text,'repeat-box:'||p_request_id::text,
    jsonb_build_object('box_tier',v_tier,'pool_version',1,'paid_with','monetag')
  );

  v_result := public.open_mystery_box(p_player_id,v_entitlement_id);
  v_cooldown_until := now()+interval '2 hours';
  v_result := v_result || jsonb_build_object(
    'repeatPurchase',true,'costZp',0,'paidWith','monetag',
    'cooldownUntil',v_cooldown_until,
    'tierChance',jsonb_build_object('standard',80,'premium',20)
  );
  update app_private.player_repeat_mystery_box_state
    set cooldown_until=v_cooldown_until,updated_at=now() where player_id=p_player_id;
  insert into app_private.repeat_mystery_box_requests(player_id,request_id,method,result)
    values(p_player_id,p_request_id,'ad',v_result);
  return v_result;
end;
$$;

create or replace function public.try_complete_mystery_box_monetag(p_session_id uuid)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $$
declare
  v_session app_private.mystery_box_monetag_sessions%rowtype;
  v_result jsonb;
begin
  select * into v_session from app_private.mystery_box_monetag_sessions
    where id=p_session_id for update;
  if not found then return jsonb_build_object('success',false,'reason','session_not_found'); end if;
  if v_session.status='completed' then
    return coalesce(v_session.result,jsonb_build_object('success',true,'completed',true,'alreadyCompleted',true));
  end if;
  if v_session.status<>'pending' or v_session.expires_at<=clock_timestamp() then
    update app_private.mystery_box_monetag_sessions set status='expired'
      where id=p_session_id and status='pending';
    return jsonb_build_object('success',false,'reason','session_expired');
  end if;
  if v_session.monetag_valued_at is null or v_session.sdk_completed_at is null then
    return jsonb_build_object('success',true,'completed',false,'pendingVerification',true);
  end if;
  v_result := app_private.grant_mystery_box_after_monetag(v_session.player_id,v_session.request_id);
  if v_result->>'success' is distinct from 'true' then return v_result; end if;
  update app_private.mystery_box_monetag_sessions
    set status='completed',completed_at=clock_timestamp(),result=v_result
    where id=p_session_id and status='pending';
  return v_result || jsonb_build_object('completed',true);
end;
$$;

create or replace function public.begin_mystery_box_monetag_session(p_player_id uuid,p_request_id uuid)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $$
declare
  v_state app_private.player_repeat_mystery_box_state%rowtype;
  v_session app_private.mystery_box_monetag_sessions%rowtype;
  v_id uuid:=gen_random_uuid();
  v_ymid text:=gen_random_uuid()::text;
begin
  if p_player_id is null or p_request_id is null
     or not exists(select 1 from public.players where id=p_player_id) then
    raise exception 'Invalid Mystery Box ad session';
  end if;
  insert into app_private.player_repeat_mystery_box_state(player_id)
    values(p_player_id) on conflict(player_id) do nothing;
  select * into v_state from app_private.player_repeat_mystery_box_state
    where player_id=p_player_id for update;
  if v_state.cooldown_until is not null and v_state.cooldown_until>now() then
    return jsonb_build_object('success',false,'code','cooldown_active','cooldownUntil',v_state.cooldown_until);
  end if;
  select * into v_session from app_private.mystery_box_monetag_sessions
    where player_id=p_player_id and request_id=p_request_id;
  if found and v_session.status='pending' and v_session.expires_at>now() then
    return jsonb_build_object('success',true,'sessionId',v_session.id,'ymid',v_session.monetag_ymid,'provider','monetag');
  end if;
  if found and v_session.status='completed' then
    return jsonb_build_object('success',false,'code','already_completed','message','This ad session was already used.');
  end if;
  insert into app_private.mystery_box_monetag_sessions(id,player_id,request_id,monetag_ymid)
    values(v_id,p_player_id,p_request_id,v_ymid);
  return jsonb_build_object('success',true,'sessionId',v_id,'ymid',v_ymid,'provider','monetag');
end;
$$;

create or replace function public.confirm_mystery_box_monetag_sdk(p_player_id uuid,p_session_id uuid)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $$
declare v_session app_private.mystery_box_monetag_sessions%rowtype;
begin
  update app_private.mystery_box_monetag_sessions
    set sdk_completed_at=coalesce(sdk_completed_at,clock_timestamp())
    where id=p_session_id and player_id=p_player_id and status='pending'
      and expires_at>clock_timestamp();
  select * into v_session from app_private.mystery_box_monetag_sessions
    where id=p_session_id and player_id=p_player_id;
  if not found then return jsonb_build_object('success',false,'reason','session_not_found'); end if;
  return public.try_complete_mystery_box_monetag(p_session_id);
end;
$$;

create or replace function public.record_monetag_mystery_box_valued_postback(p_ymid text)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $$
declare v_session app_private.mystery_box_monetag_sessions%rowtype;
begin
  select * into v_session from app_private.mystery_box_monetag_sessions
    where monetag_ymid=p_ymid for update;
  if not found then return jsonb_build_object('success',false,'reason','session_not_found'); end if;
  if v_session.status='completed' then
    return coalesce(v_session.result,jsonb_build_object('success',true,'completed',true,'alreadyCompleted',true));
  end if;
  if v_session.status<>'pending' or v_session.expires_at<=clock_timestamp() then
    return jsonb_build_object('success',false,'reason','session_not_pending');
  end if;
  update app_private.mystery_box_monetag_sessions
    set monetag_valued_at=coalesce(monetag_valued_at,clock_timestamp())
    where id=v_session.id;
  return public.try_complete_mystery_box_monetag(v_session.id);
end;
$$;

revoke all on function public.begin_mystery_box_monetag_session(uuid,uuid) from public,anon,authenticated;
revoke all on function public.confirm_mystery_box_monetag_sdk(uuid,uuid) from public,anon,authenticated;
revoke all on function public.record_monetag_mystery_box_valued_postback(text) from public,anon,authenticated;
revoke all on function public.try_complete_mystery_box_monetag(uuid) from public,anon,authenticated;
revoke all on function app_private.grant_mystery_box_after_monetag(uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_mystery_box_monetag_session(uuid,uuid) to service_role;
grant execute on function public.confirm_mystery_box_monetag_sdk(uuid,uuid) to service_role;
grant execute on function public.record_monetag_mystery_box_valued_postback(text) to service_role;
grant execute on function public.try_complete_mystery_box_monetag(uuid) to service_role;
