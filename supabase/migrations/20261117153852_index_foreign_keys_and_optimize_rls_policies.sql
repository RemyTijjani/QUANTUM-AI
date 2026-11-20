-- Add covering indexes for foreign keys flagged by the Preview performance advisor.
-- Also cache auth.uid() once per statement in player-owned read policies.

create index if not exists idx_mystery_box_openings_boost_entitlement
  on app_private.mystery_box_openings (boost_entitlement_id);
create index if not exists idx_player_daily_mystery_box_entitlement
  on app_private.player_daily_mystery_box_state (entitlement_id);
create index if not exists idx_referral_kickback_entries_source_player
  on app_private.referral_kickback_entries (source_player_id);
create index if not exists idx_referral_kickback_ledger_claim
  on app_private.referral_kickback_ledger (claim_id);
create index if not exists idx_referral_kickback_ledger_entry
  on app_private.referral_kickback_ledger (entry_id);
create index if not exists idx_referral_kickback_ledger_mining_reward
  on app_private.referral_kickback_ledger (source_mining_reward_id);
create index if not exists idx_ton_withdrawal_requests_wallet
  on app_private.ton_withdrawal_requests (wallet_id);
create index if not exists idx_agent_uptime_claims_rental
  on public.agent_uptime_mission_claims (rental_id);
create index if not exists idx_briefing_attempts_briefing
  on public.briefing_attempts (briefing_id);
create index if not exists idx_briefing_reward_issuances_player
  on public.briefing_reward_issuances (player_id);
create index if not exists idx_briefings_prerequisite
  on public.briefings (prerequisite_briefing_id);
create index if not exists idx_expedition_objective_progress_expedition_objective
  on public.expedition_objective_progress (expedition_id, objective_id);
create index if not exists idx_expedition_objective_progress_expedition_team
  on public.expedition_objective_progress (expedition_id, team_id);
create index if not exists idx_expedition_participations_expedition_team
  on public.expedition_participations (expedition_id, team_id);
create index if not exists idx_expedition_reward_issuances_expedition
  on public.expedition_reward_issuances (expedition_id);
create index if not exists idx_expedition_reward_issuances_player
  on public.expedition_reward_issuances (player_id);
create index if not exists idx_expedition_team_members_player
  on public.expedition_team_members (player_id);
create index if not exists idx_expedition_team_members_expedition_team
  on public.expedition_team_members (expedition_id, team_id);
create index if not exists idx_expedition_team_objective_progress_expedition_objective
  on public.expedition_team_objective_progress (expedition_id, objective_id);
create index if not exists idx_expedition_team_objective_progress_expedition_team
  on public.expedition_team_objective_progress (expedition_id, team_id);
create index if not exists idx_expedition_teams_leader_player
  on public.expedition_teams (leader_player_id);
create index if not exists idx_expedition_trusted_evidence_player
  on public.expedition_trusted_evidence (player_id);
create index if not exists idx_expeditions_prerequisite
  on public.expeditions (prerequisite_expedition_id);
create index if not exists idx_game_event_participation_audit_player
  on public.game_event_participation_audit (player_id);
create index if not exists idx_raffle_audit_log_raffle
  on public.raffle_audit_log (raffle_id);
create index if not exists idx_raffle_winners_entry
  on public.raffle_winners (entry_id);
create index if not exists idx_raffle_winners_player
  on public.raffle_winners (player_id);
create index if not exists idx_telegram_mission_claims_mission
  on public.telegram_mission_claims (mission_id);

alter policy "Preview read own game state"
  on public.player_game_states
  using ((select auth.uid()) = player_id);
alter policy "Preview read own referrals"
  on public.referral_sub_nodes
  using ((select auth.uid()) = referrer_id);
alter policy "creator_ops_submissions_select_own"
  on public.creator_ops_submissions
  using (player_id = (select auth.uid()));
