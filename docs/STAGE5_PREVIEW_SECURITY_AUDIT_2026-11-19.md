# Stage 5 Preview Security Audit — 2026-11-19

**Repository:** `RemyTijjani/QUANTUM-AI`  
**Branch:** `security/trusted-gameplay-migration`  
**Preview project:** `lchkctclxzwwvfwosava` (`ZORD-PREVIEW`)  
**Audit branch commit:** `264a95263553669db5dfac84d7dedc9cd8345d5f`  
**Production:** Not accessed or modified.

This report supersedes older point-in-time Stage 5 migration counts in the Stage 1–8 tracker.

## Results

### Migration history

- Preview is `ACTIVE_HEALTHY`.
- Branch contains **131** SQL migration files.
- Preview migration ledger contains **131** applied versions.
- Exact version comparison: **0 branch files missing from the ledger; 0 ledger versions missing from the branch**.
- No migration replay, repair, reset, baseline replacement, or historical ledger rewrite was performed.
- Two corrective grant migrations are preserved in order:
  - `20261119063559_restrict_player_submission_rpc_execution.sql`
  - `20261119063636_restore_guarded_player_submission_rpc_access.sql`
- The first was superseded immediately after reviewing the live function bodies. Final permissions preserve the intended authenticated submission path; do not remove either migration from history.

### Identity and trusted gameplay

- Deployed Preview source matches the active branch for:
  - `gameplay-actions` v13
  - `mission-actions` v10
  - `mystery-box-actions` v8
  - `player-economy` v22
  - `event-participation` v44
  - `admin-api` v103
- The first five functions explicitly validate the bearer token with Supabase `auth.getUser()` before deriving the player record and performing player-scoped operations. This remains important for functions configured with `verify_jwt=false`.
- `admin-api` source also matches the branch; it uses its separate admin-credential authentication flow.
- Core economy tables `player_economy` and `economy_ledger` have RLS enabled. `anon` and `authenticated` have no direct table access, and `service_role` has no direct INSERT/UPDATE/DELETE privilege on those tables. Trusted database routines remain the intended write path.
- `gameplay_action_events` and `player_fragment_gameplay_state` likewise have RLS enabled and no direct `anon` or `authenticated` table access.
- A catalog check across RLS-enabled tables without policies returned no direct `anon` or `authenticated` table grants.
- The Stage 5 no-direct-gameplay-ZP GitHub Actions workflow passed on commit `380b0f8d64bb5b11c98c534bd3d755e10720e967` (run [44472716723](https://github.com/RemyTijjani/QUANTUM-AI/actions/runs/44472716723)).

### Guarded player-submission RPCs

- `submit_creator_ops_submission` and `submit_x_follow_submission` are intentionally `SECURITY DEFINER`: they derive the player from `auth.uid()`, reject null identities, validate the mission/submission, and pin `search_path` to `pg_catalog, public, pg_temp`.
- Their final EXECUTE grants are:
  - `authenticated`: allowed (required by the existing player submission flow)
  - `service_role`: allowed
  - `anon` and `PUBLIC`: revoked
- The Supabase advisor still flags these two functions because authenticated users can execute SECURITY DEFINER routines. This is an intentional, reviewed exception; revoking authenticated execution breaks the player submission path. Keep the identity checks and pinned search path intact.

### Performance repair

- Supabase identified the missing index on `share_uplink_mission_claims.referred_player_id`.
- Added `idx_share_uplink_mission_claims_referred_player_id` in Preview and committed the matching migration `20261119063746_index_share_uplink_referred_player_fk.sql`.
- Catalog verification confirmed the index exists. The subsequent performance advisor no longer reports an unindexed foreign key; the remaining unused-index notices are informational and should not trigger automatic index deletion.

## Remaining Stage 5 gates

1. **Leaked-password protection remains disabled** in Supabase Auth. This is an Auth project setting, not a database migration. Enable it in the Preview Dashboard under Authentication → Security and Protection → Password Protection, then rerun the security advisor.
2. Complete controlled two-account Preview tests for cross-player reads/writes, duplicate/replayed gameplay requests, daily claims, fragment fixes, Creator Ops/X Follow submission isolation, and unauthorized reward attempts. Do not use real player balances as test fixtures.
3. Re-run the unauthenticated economy/admin/gameplay workflow checks against the current branch and matching deployed Preview functions. The latest no-direct-ZP workflow is green, but it is not a substitute for the complete acceptance matrix.
4. The advisor's two SECURITY DEFINER warnings remain documented intentional exceptions as described above. Do not “fix” them by removing authenticated EXECUTE without first redesigning the client submission contract.
5. Owner-level `supabase_admin` default-privilege hardening remains outside the current SQL execution role's authority; no managed-role defaults were changed.

## Safety and scope

- No player balances, reward ledgers, payment intents, or payment transfers were changed by this Stage 5 work.
- No production database, deployment, or main branch was touched.
- No AdsGram placements were added or changed. AdsGram remains exclusive to the optional Mystery Box placement per product requirements.
- Stage 5 remains **in progress** until the remaining Auth setting and end-to-end Preview acceptance tests pass.


## Follow-up remediation — 2026-11-19 06:50 UTC

The Stage 5 follow-up moved Creator Ops and X Follow submission writes behind the authenticated `mission-actions` Edge Function.

- Added migration `20261119064818_route_player_submission_rpcs_through_mission_actions.sql`.
- The Edge Function verifies the caller with `auth.getUser()`, resolves the player ID from that verified session, then calls the service-role-only submission RPCs.
- Updated `MissionsTab.tsx` to call `mission-actions`; direct client RPC calls were removed.
- Deployed Preview `mission-actions` version **11**, with `verify_jwt=true`.
- Verified both submission RPCs now have `authenticated_execute=false`, `anon_execute=false`, and `service_role_execute=true`.
- Re-ran Supabase security advisors: the two authenticated SECURITY DEFINER warnings are gone. Remaining security findings are 79 informational RLS-enabled/no-policy notices (the affected tables have no anon/authenticated grants) and one Auth warning for leaked-password protection.
- Preview migration reconciliation now reports **132/132** SQL migration files matched to the applied ledger, with no missing versions in either direction.
- Rollback-isolated SQL regression tests passed for fragment action idempotency (same request returns duplicate; same request ID reused for a different fragment is rejected) and Mystery Box repeat opening idempotency (same request is charged once). The AdsGram method remains fail-closed with `adsgram_not_configured`. All test fixture writes were rolled back.
- The Stage 5 no-direct-gameplay-ZP workflow passed after adding checks that the local referral milestone reducer cannot mint ZP and AdsGram appears only in the Mystery Box UI. A further check now verifies Creator Ops/X Follow use the authenticated Edge Function.
- Frontend typecheck, lint, and build passed after the Creator Ops/X Follow submission UI migration on commit `4c180ee9f5e6c03c11289df3c3c3e3a4875290d9`. A matching Vercel Preview deployment for commit `6502d3e3f717c35358aa7f75ce87681416364389` is READY.

### Remaining external acceptance gates

1. Enable **Leaked Password Protection** in Supabase Preview Auth settings. The connected Supabase tools can inspect database settings and advisors but do not expose the Auth password-protection toggle.
2. Run the two-account end-to-end acceptance test with two valid Preview user sessions. No test credentials or account-creation/session tool is available in this integration, so this cannot honestly be marked passed yet.
3. Owner-level managed-role default privileges remain outside the available database execution role's authority. The latest Stage 5 migration-status workflow completed successfully, including the remote migration-list and read-only schema/dependency checks.

Production remains untouched. No player balances, payout ledgers, or payment transfers were changed by the rollback-isolated tests.
