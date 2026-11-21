-- Credit Creator Ops approvals in the currency snapshotted at submission time.
create or replace function public.admin_review_creator_submission(p_submission_id uuid,p_decision text)
returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public','app_private','pg_temp'
as $function$
declare
  v_submission public.creator_ops_submissions%rowtype;
  v_mission_platform text;
  v_expected_content_id text;
  v_reward numeric;
  v_currency text;
  v_new_zp numeric;
  v_new_lifetime numeric;
  v_ledger jsonb;
begin
  if p_decision is null or p_decision not in ('approved','rejected') then raise exception 'Invalid decision'; end if;
  select * into v_submission from public.creator_ops_submissions where id=p_submission_id for update;
  if not found then raise exception 'Submission not found'; end if;
  if v_submission.status is distinct from 'pending' then raise exception 'Submission has already been reviewed'; end if;
  v_reward:=v_submission.reward_amount;
  v_currency:=v_submission.reward_currency;
  if v_reward is null or v_reward<0 or v_currency not in ('ZP','ZAP') then raise exception 'Invalid submission reward'; end if;
  if p_decision='rejected' then
    update public.creator_ops_submissions set status='rejected',reviewed_at=now() where id=p_submission_id;
    return jsonb_build_object('success',true,'decision','rejected','rewardAmount',v_reward,'rewardCurrency',v_currency,
      'playerId',v_submission.player_id,'playerReferralCode',v_submission.player_referral_code);
  end if;
  if v_submission.player_id is null then raise exception 'Submission has no player ID'; end if;
  select coalesce(nullif(lower(btrim(mt.platform)),''),'youtube') into v_mission_platform
  from public.mission_tasks mt where mt.id=v_submission.mission_id and mt.kind='creator';
  if not found or v_mission_platform not in ('youtube','tiktok') or v_submission.platform is distinct from v_mission_platform then
    raise exception 'Submission platform does not match its Creator mission';
  end if;
  v_expected_content_id:=public.creator_ops_extract_content_id(v_submission.platform,v_submission.link_url);
  if v_expected_content_id is null or v_submission.content_id is distinct from v_expected_content_id then
    raise exception 'Submission does not contain a valid, verified video identity';
  end if;
  if exists(select 1 from public.creator_ops_submissions s where s.player_id=v_submission.player_id
    and s.mission_id=v_submission.mission_id and s.platform=v_submission.platform
    and s.content_id=v_submission.content_id and s.id<>v_submission.id) then
    raise exception 'This video has already been submitted for this mission';
  end if;
  if v_currency='ZAP' then
    v_ledger:=public.apply_player_zap_ledger_entry(v_submission.player_id,'credit',v_reward,'creator_ops_reward',
      'creator_ops:'||p_submission_id::text,'creator_ops:'||p_submission_id::text,
      'Approved Creator Ops mission: '||v_submission.mission_id);
    update public.creator_ops_submissions set status='approved',reviewed_at=now() where id=p_submission_id;
    return jsonb_build_object('success',true,'decision','approved','rewardZap',v_reward,'rewardCurrency','ZAP',
      'balanceAfter',v_ledger->'balanceAfter','playerId',v_submission.player_id,'playerReferralCode',v_submission.player_referral_code);
  end if;
  select coalesce(zp_balance,0),coalesce(lifetime_zp,0) into v_new_zp,v_new_lifetime
  from public.player_economy where player_id=v_submission.player_id for update;
  if not found then raise exception 'Player economy record not found'; end if;
  v_new_zp:=v_new_zp+v_reward;
  v_new_lifetime:=v_new_lifetime+v_reward;
  update public.player_economy set zp_balance=v_new_zp,lifetime_zp=v_new_lifetime,updated_at=now()
  where player_id=v_submission.player_id;
  if v_reward>0 then
    insert into public.economy_ledger(player_id,transaction_type,amount,balance_after,reference_id,description)
    values(v_submission.player_id,'creator_ops_reward',v_reward,v_new_zp,'creator_ops:'||p_submission_id::text,
      'Approved Creator Ops mission: '||v_submission.mission_id);
  end if;
  update public.creator_ops_submissions set status='approved',reviewed_at=now() where id=p_submission_id;
  return jsonb_build_object('success',true,'decision','approved','rewardZp',v_reward,'rewardCurrency','ZP',
    'balanceAfter',v_new_zp,'playerId',v_submission.player_id,'playerReferralCode',v_submission.player_referral_code);
end;
$function$;

create or replace function public.admin_bulk_approve_creator_submissions(p_submission_ids uuid[])
returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public','pg_temp'
as $function$
declare
  v_id uuid;
  v_result jsonb;
  v_results jsonb:='[]'::jsonb;
  v_approved integer:=0;
  v_failed integer:=0;
begin
  if p_submission_ids is null or cardinality(p_submission_ids)<1 or cardinality(p_submission_ids)>100 then
    raise exception 'Select between 1 and 100 submissions';
  end if;
  for v_id in select distinct submission_id from unnest(p_submission_ids) as selected_ids(submission_id) loop
    begin
      v_result:=public.admin_review_creator_submission(v_id,'approved');
      if coalesce((v_result->>'success')::boolean,false) then
        v_approved:=v_approved+1;
        v_results:=v_results||jsonb_build_array(jsonb_build_object(
          'submissionId',v_id,'success',true,'rewardCurrency',v_result->>'rewardCurrency',
          'rewardAmount',coalesce(v_result->'rewardZap',v_result->'rewardZp')));
      else
        v_failed:=v_failed+1;
        v_results:=v_results||jsonb_build_array(jsonb_build_object('submissionId',v_id,'success',false,'reason','not_pending_or_review_failed'));
      end if;
    exception when others then
      v_failed:=v_failed+1;
      v_results:=v_results||jsonb_build_array(jsonb_build_object('submissionId',v_id,'success',false,'reason','review_failed'));
    end;
  end loop;
  return jsonb_build_object('success',true,'approvedCount',v_approved,'failedCount',v_failed,'results',v_results);
end;
$function$;

revoke all on function public.admin_review_creator_submission(uuid,text) from public,anon,authenticated;
grant execute on function public.admin_review_creator_submission(uuid,text) to service_role;
revoke all on function public.admin_bulk_approve_creator_submissions(uuid[]) from public,anon,authenticated;
grant execute on function public.admin_bulk_approve_creator_submissions(uuid[]) to service_role;
