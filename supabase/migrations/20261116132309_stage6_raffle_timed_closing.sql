create or replace function public.admin_close_raffle(p_raffle_id uuid, p_admin text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $$
declare
  v_raffle public.raffles%rowtype;
  v_now timestamptz := now();
  v_early boolean;
begin
  if p_raffle_id is null then raise exception 'A raffle ID is required'; end if;
  if p_admin is null or length(btrim(p_admin)) = 0 or length(p_admin) > 120 then raise exception 'A valid Admin identity is required'; end if;
  select * into v_raffle from public.raffles where id = p_raffle_id for update;
  if not found then raise exception 'Raffle not found'; end if;
  if v_raffle.status = 'closed' then
    return jsonb_build_object('success', true, 'status', 'closed', 'alreadyClosed', true, 'closedAt', v_raffle.closed_at);
  end if;
  if v_raffle.status <> 'published' then raise exception 'Only a published raffle can be closed'; end if;
  if v_raffle.starts_at is not null and v_now < v_raffle.starts_at then raise exception 'This raffle has not started yet'; end if;
  v_early := v_raffle.ends_at is null or v_now < v_raffle.ends_at;
  update public.raffles set status = 'closed', closed_at = v_now, updated_at = v_now, updated_by = p_admin where id = p_raffle_id;
  insert into public.raffle_audit_log(raffle_id, actor, action, details)
  values (p_raffle_id, p_admin, case when v_early then 'raffle_closed_early' else 'raffle_closed_after_deadline' end,
    jsonb_build_object('closedAt', v_now, 'scheduledEndsAt', v_raffle.ends_at, 'earlyClose', v_early));
  return jsonb_build_object('success', true, 'status', 'closed', 'alreadyClosed', false, 'closedAt', v_now, 'earlyClose', v_early);
end;
$$;
revoke all on function public.admin_close_raffle(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_close_raffle(uuid, text) to service_role;
