-- Add request idempotency and reserve funds for a withdrawal exactly once.
alter table app_private.ton_withdrawal_requests add column if not exists idempotency_key text;
create unique index if not exists ton_withdrawal_requests_idempotency_key_uidx on app_private.ton_withdrawal_requests(idempotency_key) where idempotency_key is not null;
create or replace function app_private.request_ton_withdrawal(p_player_id uuid,p_amount_nano numeric,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w app_private.player_ton_wallets%rowtype; b app_private.player_ton_balances%rowtype; r app_private.ton_withdrawal_requests%rowtype; rid uuid;
begin
 if p_player_id is null or p_amount_nano is null or p_amount_nano<=0 or p_amount_nano<>trunc(p_amount_nano) or p_idempotency_key is null or length(p_idempotency_key)<8 then raise exception 'Valid withdrawal details are required'; end if;
 select * into r from app_private.ton_withdrawal_requests where idempotency_key=p_idempotency_key;
 if found then
  if r.player_id<>p_player_id or r.amount_nano<>p_amount_nano then raise exception 'Idempotency key was already used for another withdrawal'; end if;
  return jsonb_build_object('success',true,'alreadyApplied',true,'requestId',r.id);
 end if;
 select * into w from app_private.player_ton_wallets where player_id=p_player_id and verification_status='verified' for update;
 if not found then raise exception 'Connect and verify a TON wallet before requesting a withdrawal'; end if;
 insert into app_private.player_ton_balances(player_id) values(p_player_id) on conflict do nothing;
 select * into b from app_private.player_ton_balances where player_id=p_player_id for update;
 if b.available_nano<p_amount_nano then raise exception 'Insufficient withdrawable TON balance'; end if;
 update app_private.player_ton_balances set available_nano=available_nano-p_amount_nano,reserved_nano=reserved_nano+p_amount_nano,updated_at=now() where player_id=p_player_id returning * into b;
 insert into app_private.ton_withdrawal_requests(player_id,wallet_id,wallet_address,amount_nano,idempotency_key) values(p_player_id,w.id,w.wallet_address,p_amount_nano,p_idempotency_key) returning id into rid;
 insert into app_private.player_ton_ledger(player_id,entry_type,direction,amount_nano,available_after_nano,reserved_after_nano,reference_type,reference_id,idempotency_key)
 values(p_player_id,'withdrawal_reserve','debit',p_amount_nano,b.available_nano,b.reserved_nano,'withdrawal_request',rid,p_idempotency_key||':reserve');
 return jsonb_build_object('success',true,'alreadyApplied',false,'requestId',rid);
end $$;
revoke all on function app_private.request_ton_withdrawal(uuid,numeric,text) from public,anon,authenticated;
grant execute on function app_private.request_ton_withdrawal(uuid,numeric,text) to service_role;
