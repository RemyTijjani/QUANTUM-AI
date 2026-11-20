-- Stage 5 advisor remediation: index the referred-player foreign key.
-- The table is currently tiny; this supports FK checks and player-linked lookups
-- without changing any row data or access policy.
CREATE INDEX IF NOT EXISTS idx_share_uplink_mission_claims_referred_player_id
  ON public.share_uplink_mission_claims (referred_player_id);
