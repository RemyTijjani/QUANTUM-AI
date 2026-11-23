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
    return coalesce(v_session.result,jsonb_build_object('success',true,'completed',true))
      || jsonb_build_object('completed',true,'alreadyCompleted',true);
  end if;
  if v_session.status<>'pending' or v_session.expires_at<=clock_timestamp() then
    return jsonb_build_object('success',false,'reason','session_expired');
  end if;
  update app_private.mystery_box_onclicka_sessions
    set sdk_completed_at=coalesce(sdk_completed_at,clock_timestamp())
    where id=p_session_id and player_id=p_player_id and status='pending';
  return public.try_complete_mystery_box_onclicka(p_session_id);
end;
$function$;
revoke all on function public.confirm_mystery_box_onclicka_sdk(uuid,uuid) from public,anon,authenticated;
grant execute on function public.confirm_mystery_box_onclicka_sdk(uuid,uuid) to service_role;
