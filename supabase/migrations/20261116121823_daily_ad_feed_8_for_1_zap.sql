-- Daily Ad Feed replaces the legacy 3 ads / 150 ZP mission.
-- Keep it paused until genuine provider callbacks and server-side verification are connected.
update public.mission_tasks
set title = 'Daily Ad Feed',
    description = 'Complete 8 advertisements verified by an approved provider to earn 1 ZAP.',
    reward = 1,
    reward_currency = 'ZAP',
    unlock_cost_zp = 0,
    status = 'paused',
    requirements = jsonb_build_array(jsonb_build_object(
      'type', 'verified_ad_views',
      'target', 8,
      'period', 'utc_day',
      'providers', jsonb_build_array('AdsGram', 'Onclicka', 'RichAds', 'Monetag')
    )),
    objectives = jsonb_build_array(jsonb_build_object(
      'type', 'provider_verified_ad_views',
      'target', 8,
      'reward_currency', 'ZAP',
      'reward_amount', 1
    )),
    updated_at = now()
where id = 'ad-quota'
  and kind = 'daily';