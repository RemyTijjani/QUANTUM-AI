-- Remove Agent as a supported raffle prize type.
-- Preview currently contains no Agent raffles; historical data is not deleted.
alter table public.raffles
  drop constraint if exists raffles_check,
  drop constraint if exists raffles_reward_type_check,
  drop constraint if exists raffles_prize_currency_check,
  drop constraint if exists raffles_funding_source_check;

alter table public.raffles
  add constraint raffles_check check (
    (reward_type = 'ton' and prize_currency = 'TON' and reward_code is null)
    or
    (reward_type = 'zap' and prize_currency = 'ZAP' and reward_code is null)
  ),
  add constraint raffles_reward_type_check check (reward_type = any (array['ton'::text, 'zap'::text])),
  add constraint raffles_prize_currency_check check (prize_currency = any (array['TON'::text, 'ZAP'::text])),
  add constraint raffles_funding_source_check check (funding_source = any (array['treasury'::text, 'external'::text]));
