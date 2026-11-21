-- The legacy reward_zp column is retained for compatibility. For ZAP claims
-- it is zero; reward_currency and reward_amount carry the actual denomination.
alter table public.telegram_mission_claims
  drop constraint if exists telegram_mission_claims_reward_zp_check,
  add constraint telegram_mission_claims_reward_zp_check
    check (
      (reward_currency = 'ZP' and reward_zp > 0)
      or
      (reward_currency = 'ZAP' and reward_zp = 0)
    );
