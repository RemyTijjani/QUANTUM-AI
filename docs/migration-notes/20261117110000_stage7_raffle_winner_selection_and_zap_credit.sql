-- Secure admin winner selection and idempotent ZAP prize credit for raffles.
-- Public wrappers are callable only by service_role; the Admin API verifies credentials.

CREATE OR REPLACE FUNCTION app_private.credit_zap_raffle_prize(p_winner_id uuid, p_admin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_winner public.raffle_winners%rowtype;
  v_credit jsonb;
begin
  if p_winner_id is null or nullif(btrim(p_admin),'') is null then
    raise exception 'A valid winner and Admin identity are required';
  end if;
  select * into v_winner from public.raffle_winners where id=p_winner_id for update;
  if not found or v_winner.prize_currency <> 'ZAP' then
    raise exception 'ZAP raffle winner not found';
  end if;
  if v_winner.delivery_status in ('credited','delivered') then
    return jsonb_build_object('success',true,'alreadyCredited',true,'winnerId',p_winner_id);
  end if;
  if v_winner.delivery_status <> 'pending' then
    raise exception 'This winner prize is not in a creditable state';
  end if;
  v_credit := public.apply_player_zap_ledger_entry(
    v_winner.player_id,'credit',v_winner.prize_amount,
    'raffle_prize',v_winner.raffle_id::text,
    'raffle-prize-credit:'||v_winner.id::text,
    'ZAP raffle prize'
  );
  if coalesce((v_credit->>'success')::boolean,false) is not true then
    raise exception 'ZAP prize credit failed';
  end if;
  update public.raffle_winners set delivery_status='credited' where id=p_winner_id;
  insert into public.raffle_audit_log(raffle_id,actor,action,details)
  values (v_winner.raffle_id,p_admin,'raffle_zap_prize_credited',
    jsonb_build_object('winnerId',p_winner_id,'playerId',v_winner.player_id,'amount',v_winner.prize_amount));
  return jsonb_build_object('success',true,'alreadyCredited',false,'winnerId',p_winner_id,'amount',v_winner.prize_amount,'deliveryStatus','credited');
end;
$function$


CREATE OR REPLACE FUNCTION app_private.select_raffle_winners(p_raffle_id uuid, p_admin text, p_player_ids uuid[] DEFAULT NULL::uuid[], p_prize_shares numeric[] DEFAULT NULL::numeric[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_raffle public.raffles%rowtype;
  v_selected uuid[] := array[]::uuid[];
  v_player uuid;
  v_entry_id uuid;
  v_share numeric;
  v_index integer;
  v_total numeric;
begin
  if p_raffle_id is null or nullif(btrim(p_admin), '') is null then raise exception 'A valid raffle and Admin identity are required'; end if;
  select * into v_raffle from public.raffles where id=p_raffle_id for update;
  if not found then raise exception 'Raffle not found'; end if;
  if v_raffle.status not in ('closed','drawn') then raise exception 'Winners can only be selected after the raffle closes'; end if;
  if v_raffle.status='drawn' or v_raffle.drawn_at is not null or exists(select 1 from public.raffle_winners where raffle_id=p_raffle_id) then raise exception 'Winners have already been selected for this raffle'; end if;
  if v_raffle.reward_type <> 'zap' then raise exception 'This winner-selection action currently supports ZAP prizes only'; end if;

  if v_raffle.winner_method='admin' then
    if p_player_ids is null or cardinality(p_player_ids)<>v_raffle.winner_count then raise exception 'Select exactly % different eligible winners',v_raffle.winner_count; end if;
    if (select count(distinct x) from unnest(p_player_ids) x)<>v_raffle.winner_count then raise exception 'A player cannot be selected more than once'; end if;
    if exists(select 1 from unnest(p_player_ids) x where not exists(select 1 from public.raffle_entries e where e.raffle_id=p_raffle_id and e.player_id=x)) then raise exception 'Every selected winner must have entered this raffle'; end if;
    v_selected:=p_player_ids;
  else
    if p_player_ids is not null then raise exception 'Random raffles do not accept manually selected winners'; end if;
    for v_player in
      select e.player_id from public.raffle_entries e where e.raffle_id=p_raffle_id
      group by e.player_id order by -ln(greatest(random(),1e-12))/sum(e.ticket_count)
      limit v_raffle.winner_count
    loop v_selected:=array_append(v_selected,v_player); end loop;
    if cardinality(v_selected)<>v_raffle.winner_count then raise exception 'Not enough unique eligible entrants for the configured winner count'; end if;
  end if;

  if p_prize_shares is not null then
    if cardinality(p_prize_shares)<>v_raffle.winner_count or exists(select 1 from unnest(p_prize_shares) s where s<=0 or s::text in ('NaN','Infinity','-Infinity')) then
      raise exception 'Provide a positive prize share for every winner';
    end if;
    select sum(s) into v_total from unnest(p_prize_shares) s;
    if round(v_total,8)<>round(v_raffle.prize_pool_amount,8) then raise exception 'Custom winner shares must add up to the full prize pool'; end if;
  end if;

  v_share:=trunc((v_raffle.prize_pool_amount/v_raffle.winner_count)*100000000)/100000000;
  for v_index in 1..v_raffle.winner_count loop
    v_player:=v_selected[v_index];
    select e.id into v_entry_id from public.raffle_entries e where e.raffle_id=p_raffle_id and e.player_id=v_player order by e.created_at,e.id limit 1;
    if p_prize_shares is not null then v_share:=p_prize_shares[v_index];
    elsif v_index=v_raffle.winner_count then v_share:=v_raffle.prize_pool_amount-(v_share*(v_raffle.winner_count-1)); end if;
    insert into public.raffle_winners(raffle_id,player_id,entry_id,prize_amount,prize_currency,reward_code,selection_method,selected_by,delivery_status)
    values(p_raffle_id,v_player,v_entry_id,v_share,'ZAP',null,v_raffle.winner_method,p_admin,'pending');
  end loop;
  update public.raffles set status='drawn',drawn_at=now(),updated_at=now(),updated_by=p_admin where id=p_raffle_id;
  insert into public.raffle_audit_log(raffle_id,actor,action,details)
  values(p_raffle_id,p_admin,'raffle_winners_selected',jsonb_build_object('winnerIds',v_selected,'winnerCount',cardinality(v_selected),'selectionMethod',v_raffle.winner_method,'prizePool',v_raffle.prize_pool_amount));
  return jsonb_build_object('success',true,'raffleId',p_raffle_id,'winnerCount',cardinality(v_selected),'status','drawn');
end; $function$


CREATE OR REPLACE FUNCTION public.admin_credit_zap_raffle_prize(p_winner_id uuid, p_admin text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'app_private'
AS $function$ select app_private.credit_zap_raffle_prize(p_winner_id,p_admin); $function$


CREATE OR REPLACE FUNCTION public.admin_select_raffle_winners(p_raffle_id uuid, p_admin text, p_player_ids uuid[] DEFAULT NULL::uuid[], p_prize_shares numeric[] DEFAULT NULL::numeric[])
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'app_private'
AS $function$ select app_private.select_raffle_winners(p_raffle_id,p_admin,p_player_ids,p_prize_shares); $function$


revoke all on function public.admin_select_raffle_winners(uuid,text,uuid[],numeric[]) from public, anon, authenticated;
grant execute on function public.admin_select_raffle_winners(uuid,text,uuid[],numeric[]) to service_role;
revoke all on function public.admin_credit_zap_raffle_prize(uuid,text) from public, anon, authenticated;
grant execute on function public.admin_credit_zap_raffle_prize(uuid,text) to service_role;
