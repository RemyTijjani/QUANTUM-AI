-- Enable ZAP and Gram (TON) raffle winner selection with correct currency precision.
ALTER TABLE public.raffles
  ALTER COLUMN prize_pool_amount TYPE numeric(20,9)
  USING round(prize_pool_amount, 9);
ALTER TABLE public.raffle_winners
  ALTER COLUMN prize_amount TYPE numeric(20,9)
  USING round(prize_amount, 9);

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
  v_precision integer;
  v_scale numeric;
  v_prize_currency text;
begin
  if p_raffle_id is null or nullif(btrim(p_admin), '') is null then raise exception 'A valid raffle and Admin identity are required'; end if;
  select * into v_raffle from public.raffles where id=p_raffle_id for update;
  if not found then raise exception 'Raffle not found'; end if;
  if v_raffle.status not in ('closed','drawn') then raise exception 'Winners can only be selected after the raffle closes'; end if;
  if v_raffle.status='drawn' or v_raffle.drawn_at is not null or exists(select 1 from public.raffle_winners where raffle_id=p_raffle_id) then raise exception 'Winners have already been selected for this raffle'; end if;
  if v_raffle.reward_type not in ('zap', 'ton') then raise exception 'This raffle prize currency is not supported'; end if;
  v_precision := case when v_raffle.reward_type = 'ton' then 9 else 8 end;
  v_scale := power(10::numeric, v_precision);
  v_prize_currency := case when v_raffle.reward_type = 'ton' then 'TON' else 'ZAP' end;

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
    if cardinality(p_prize_shares)<>v_raffle.winner_count
       or exists(
         select 1 from unnest(p_prize_shares) s
         where s<=0
            or s::text in ('NaN','Infinity','-Infinity')
            or s<>round(s,v_precision)
       ) then
      raise exception 'Provide a positive prize share for every winner using the currency precision';
    end if;
    select sum(s) into v_total from unnest(p_prize_shares) s;
    if round(v_total,v_precision)<>round(v_raffle.prize_pool_amount,v_precision) then
      raise exception 'Custom winner shares must add up to the full prize pool';
    end if;
  end if;

  v_share:=trunc((v_raffle.prize_pool_amount/v_raffle.winner_count)*v_scale)/v_scale;
  for v_index in 1..v_raffle.winner_count loop
    v_player:=v_selected[v_index];
    select e.id into v_entry_id from public.raffle_entries e where e.raffle_id=p_raffle_id and e.player_id=v_player order by e.created_at,e.id limit 1;
    if p_prize_shares is not null then v_share:=p_prize_shares[v_index];
    elsif v_index=v_raffle.winner_count then v_share:=v_raffle.prize_pool_amount-(v_share*(v_raffle.winner_count-1)); end if;
    insert into public.raffle_winners(raffle_id,player_id,entry_id,prize_amount,prize_currency,reward_code,selection_method,selected_by,delivery_status)
    values(p_raffle_id,v_player,v_entry_id,v_share,v_prize_currency,null,v_raffle.winner_method,p_admin,'pending');
  end loop;
  update public.raffles set status='drawn',drawn_at=now(),updated_at=now(),updated_by=p_admin where id=p_raffle_id;
  insert into public.raffle_audit_log(raffle_id,actor,action,details)
  values(p_raffle_id,p_admin,'raffle_winners_selected',jsonb_build_object('winnerIds',v_selected,'winnerCount',cardinality(v_selected),'selectionMethod',v_raffle.winner_method,'prizePool',v_raffle.prize_pool_amount));
  return jsonb_build_object('success',true,'raffleId',p_raffle_id,'winnerCount',cardinality(v_selected),'status','drawn');
end; $function$
;
