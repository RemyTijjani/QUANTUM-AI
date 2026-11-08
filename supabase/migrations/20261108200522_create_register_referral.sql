/*
# Create register_referral function

## Plain-English summary
When a new player signs in through a referral link, the sign-in function calls
this function to record who referred them. Only the server can call it.

## Changes
- New function `register_referral(p_referrer_tg_id, p_referred_tg_id)` that adds one row
  to `referrals`. Repeat calls for the same player are ignored.
- Grants INSERT and SELECT on `referrals` to the server role.

## Security
- EXECUTE is revoked from PUBLIC, anon and authenticated.
*/

CREATE OR REPLACE FUNCTION register_referral(p_referrer_tg_id bigint, p_referred_tg_id bigint)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  INSERT INTO referrals (referrer_telegram_id, referred_telegram_id)
  VALUES (p_referrer_tg_id, p_referred_tg_id)
  ON CONFLICT (referred_telegram_id) DO NOTHING;
$$;

REVOKE EXECUTE ON FUNCTION register_referral(bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION register_referral(bigint, bigint) TO service_role;
GRANT SELECT, INSERT ON referrals TO service_role;
