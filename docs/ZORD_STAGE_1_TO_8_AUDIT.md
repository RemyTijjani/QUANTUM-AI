# QUANTUM-AI / ZORD — Stage 1–8 Audit & Repair Tracker

**Audit date:** 2026-11-17  
**Target environment:** Supabase Preview `lchkctclxzwwvfwosava` and GitHub Preview branch `security/trusted-gameplay-migration`  
**Current branch baseline:** `117d654ccd68bf88ec39c97ede5b5cbfd3a427f8`  
**Production:** Out of scope. No merge to `main`, Production database change, or Production deployment is authorized by this audit.  
**Scope exclusion:** Stage 9 / ZORD platform expansion and the separate Zord-Agents-bot project are not part of this repository audit.

This is a living audit tracker. A feature is not marked complete merely because a component, function, or table exists. Completion requires a verified path through UI, authenticated backend, database transaction, and resulting player/admin state.

## Executive status

| Stage | Original scope | Audit status |
|---|---|---|
| 1 | System Audit | Previously marked complete; re-audit in progress |
| 2 | ZP Economy Foundation | Implemented; end-to-end verification still required |
| 3 | Legacy Progression Migration | Cloud-save path exists; isolation and recovery tests still required |
| 4 | Creator Ops Integration | Main flow exists; review and reward isolation tests still required |
| 5 | Trusted Gameplay Backend Migration | **In progress — migration-history drift must be reconciled** |
| 6 | Frontend Integration and Gameplay Expansion | **In progress — task status fixes made; remaining feature gaps identified** |
| 7 | ZAP Economy | Core wallet and transfer paths exist; end-to-end accounting tests still required |
| 8 | Real Integrations and Payments | **In progress — ads are placeholders and real payment initiation remains locked** |

## Verified work and current findings

### Stage 1 — System Audit

- Repository, Preview branch, Supabase Preview project, Edge Functions, database objects, RLS grants, scheduled jobs, and Vercel Preview history inspected.
- The Preview database has `supabase_migrations.schema_migrations`; an earlier Stage 5 plan saying the ledger was absent is now stale and must be corrected.
- RLS is enabled on the inspected application tables. Tables without row policies were checked for direct `anon`/`authenticated` table privileges; the inspected server-only tables do not grant those direct privileges.
- Three exposed `SECURITY DEFINER` functions were reviewed: `save_player_game_state`, `submit_creator_ops_submission`, and `submit_x_follow_submission`. Each derives the player identity from `auth.uid()` and scopes writes to that identity. Keep their elevated execution only where required; do not blindly revoke them.
- Five scheduled jobs are active: fragment reward release, referral kickback allocation, expedition lifecycle advancement, agent rental accrual, and expired raffle closure.
- Remaining: finish the complete feature-by-feature isolation, replay, authorization, and failure-path test matrix.

### Stage 2 — ZP Economy Foundation

- Server-side player economy reads settle agent rental accrual and fragment mining accrual before returning balances.
- Mature fragment rewards are released through the scheduled job; the product rule is six-hour maturity.
- Agent rental rates and ZP accrual are represented in the backend.
- Remaining: verify accrual boundaries, exact expiry, six-hour release, retries, duplicate jobs, and cross-player isolation using safe test accounts.

### Stage 3 — Legacy Progression Migration

- Cloud game-state save uses `save_player_game_state`, which writes under `auth.uid()` and applies an expected-version check.
- The app waits for the cloud save to load and displays a recovery error instead of silently creating a fresh game when loading fails.
- Remaining: verify concurrent-save conflicts, reconnect/retry behavior, and that local state cannot alter verified balances or server-owned progression.

### Stage 4 — Creator Ops Integration

- Creator Ops submission, per-player status display, admin review, bulk approval, and reward issuance paths exist.
- YouTube/TikTok content identity validation is enforced by the database submission function.
- X Follow has a separate manual-review queue and a server-side reward path.
- Remaining: test duplicate submissions, player isolation, approved/rejected/re-submit paths, atomic reward credit, and admin audit history.

### Stage 5 — Trusted Gameplay Backend Migration

- Trusted gameplay, mission claims, fragment unlock/fix, daily streak claims, reward entitlements, and player-owned identity checks are present.
- The Preview migration ledger currently contains 101 versions, while the branch contains 105 SQL migration files. A comparison found 19 branch migration versions absent from the applied ledger and 15 applied versions without a matching filename in the branch. This is migration-history drift, not permission to replay files.
- The existing `docs/stage5-preview-migration-history-reconciliation-plan.md` is outdated: it describes an earlier snapshot with no migration ledger. Update it only after the full migration comparison is complete.
- No bulk migration replay, migration repair, baseline replacement, or schema reset has been performed during this audit.
- Supabase advisors report missing foreign-key indexes and RLS init-plan opportunities. These need table-by-table review before adding indexes or changing policies.
- Remaining: reconcile every migration against live schema and data effects; verify all service-role-only RPC grants; test replay, idempotency, and unauthorized calls; review leaked-password protection setting.

### Stage 6 — Frontend Integration and Gameplay Expansion

- Player navigation includes Core, Network, Missions, Vault, and Agents; the Missions hub contains Missions, Streaks, Boxes, Raffles, and Expeditions.
- Events have been replaced in the active player/admin navigation by Expeditions; Briefings are no longer in the active player hub, with Raffles taking that place.
- Daily Streak, Mystery Box, Raffles, Expeditions, Creator Ops, and leaderboard UI components exist.
- Mission counter repair:
  - Social cards now use server-derived mission statuses.
  - X Follow summary now includes the player's actual pending/approved review state.
  - X Follow submission lookup is explicitly scoped to the authenticated player.
  - The unused ZAP wallet icon import that failed lint was removed.
  - The Join mission now points to `https://t.me/zordcommunity` and uses `@zordcommunity` for membership verification.
- The ZORD Telegram bot must still be an administrator in `@zordcommunity` before Telegram membership verification can succeed.
- Remaining feature gap: `share-uplink` has no verified completion/claim path yet. Do not award its configured ZP merely for copying a link.
- Remaining: test every visible button and state transition, including mobile layouts, loading/error states, empty states, admin actions, and refresh behavior.

### Stage 7 — ZAP Economy

- ZP-to-ZAP conversion and internal ZAP transfer backend paths exist.
- Approved rules: 1,000 ZP = 1 ZAP; minimum internal transfer 100 ZAP; working agents generate ZP, not ZAP; ZAP withdrawal is removed from the roadmap; rank/achievement progression is based on net ZAP.
- Raffle ZAP prize selection/credit functions exist in Preview; the scheduled raffle close job is active.
- The ZAP wallet endpoint was aligned with the database-confirmed transfer amount, rather than echoing the submitted amount.
- Remaining: test conversion/transfer idempotency, sender/recipient ledger symmetry, insufficient balance, minimum transfer, self-transfer rejection, net-rank rollback on spend/send, and permanent minted-badge behavior.

### Stage 8 — Real Integrations and Payments

- TON Connect wallet proof and Gram-labelled withdrawal UI paths exist.
- The Preview TON wallet function's proof-domain setting was aligned with the canonical host in `public/tonconnect-manifest.json` (`zord-autonomous-agent.vercel.app`). TON Connect proofs bind the dApp domain from the manifest; the backend must compare against that exact expected domain.
- ZAP wallet, TON wallet, and Mission Actions Preview Edge Functions are active and their deployed source was checked against the current branch.
- Real agent-rental wallet transfers are deliberately disabled in the Preview UI (`paymentsEnabled = false`). Do not enable real mainnet payments as part of an unreviewed code repair.
- Fragment advertisement UI is still an explicit publisher-review placeholder. No ad view is counted and no fragment unlock session is created from the placeholder.
- The approved provider plan is Adsgram, Onclicka, RichAds, and Monetag, one provider per fragment. The real provider IDs/credentials and verified callback configuration are still required before this feature can be marked live.
- Remaining: complete provider adapters/callback verification, TON proof end-to-end testing, payment reconciliation, and safe Preview payment tests before any real payment activation.

## CI, deployments, and security snapshot

- Latest Preview frontend check at baseline `117d654ccd68bf88ec39c97ede5b5cbfd3a427f8` completed successfully: type-check, lint, and build.
- Earlier failed CI runs were caused by one unused import in `ZapWalletPanel.tsx`; that error is fixed.
- `npm ci` reported 14 dependency advisories (1 low, 4 moderate, 9 high). The exact vulnerable dependency paths still need an `npm audit` review before updating the lockfile.
- Security advisor also reports leaked-password protection disabled. This is an Auth configuration item to review and enable safely.
- The latest READY Vercel Preview is commit `cf2c36c2e96be7b230cb9878ba19643ab03735ad`, behind this branch baseline. Vercel previously rejected newer Preview deployment attempts because the daily deployment limit was reached. Do not retry deployment until the limit resets.
- Production has not been changed.

## Repair order

1. Finish the migration-history reconciliation without replaying or repairing the ledger blindly.
2. Finish the Stage 5 security review and safe database advisor improvements.
3. Complete missing Missions actions, beginning with a verifiable Share Uplink flow; keep unverified rewards locked.
4. Audit every player/admin button against its backend action and visible success/failure state.
5. Review and safely remediate the 14 npm advisories; rerun type-check, lint, build, and tests.
6. Verify ZP/ZAP, streak, box, raffle, expedition, creator, wallet, and referral flows using safe Preview test accounts and rollback-safe tests.
7. Finish ad-provider and TON Connect integration checks; keep real mainnet transfers disabled until separately approved.
8. Deploy the latest branch to Vercel Preview after the daily limit clears, then perform the full Preview acceptance test.
9. Only after the Preview acceptance checklist passes, prepare a separate Production release plan for approval.

**Never treat this tracker as approval to change Production, initiate real payments, replay migrations, or delete player data.**
