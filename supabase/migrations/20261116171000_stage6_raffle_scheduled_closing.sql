create or replace function app_private.close_expired_raffles()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $$
declare v_closed integer := 0;
begin
  with closed_raffles as (
    update public.raffles
    set status = 'closed', closed_at = coalesce(closed_at, now()),
        updated_at = now(), updated_by = 'system:scheduled-close'
    where status = 'published' and ends_at is not null and ends_at <= now()
    returning id, ends_at, closed_at
  )
  insert into public.raffle_audit_log(raffle_id, actor, action, details)
  select id, 'system', 'raffle_closed_by_schedule',
         jsonb_build_object('scheduledEndsAt', ends_at, 'closedAt', closed_at)
  from closed_raffles;
  get diagnostics v_closed = row_count;
  return v_closed;
end;
$$;
revoke all on function app_private.close_expired_raffles() from public, anon, authenticated, service_role;
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'close-expired-raffles') then
    perform cron.schedule('close-expired-raffles', '* * * * *', 'select app_private.close_expired_raffles();');
  end if;
end;
$$;
