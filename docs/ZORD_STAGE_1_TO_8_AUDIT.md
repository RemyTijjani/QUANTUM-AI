# QUANTUM-AI / ZORD — Stage 1–8 Audit & Repair Tracker

**Audit date:** 2026-11-17  
**Target environment:** Supabase Preview `lchkctclxzwwvfwosava` and GitHub Preview branch `security/trusted-gameplay-migration`  
**Current code baseline at this audit pass:** `109d95b3a0b82ac8a261dec85bcf2418f713e224`  
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
- The Preview migration ledger currently contains 113 versions, while the branch contains 117 SQL migration files. A comparison found 19 branch migration versions absent from the applied ledger and 15 applied versions without a matching filename in the branch. These are historical migration mismatches; no missing migration was blindly replayed. This is migration-history drift, not permission to replay files.
- The Stage 5 reconciliation plan now includes a dated 2026-11-17 update and explicitly supersedes the earlier no-ledger snapshot.
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
- `share-uplink` now has a Copy Referral Link action, but no verified completion/claim path. The 300 ZP reward remains locked; do not award it merely for copying a link.
- Remaining: test every visible button and state transition, including mobile layouts, loading/error states, empty states, admin actions, and refresh behavior.

### Stage 7 — ZAP Economy

- ZP-to-ZAP conversion and internal ZAP transfer backend paths exist.
- Approved rules: 1,000 ZP = 1 ZAP; minimum internal transfer 100 ZAP; working agents generate ZP, not ZAP; ZAP withdrawal is removed from the roadmap; rank/achievement progression is based on net ZAP.
- Raffle winner selection/credit functions exist in Preview; winner selection now supports both ZAP and TON/Gram, and TON prize amounts/reservations preserve nine decimal places. The Admin API UUID validators for raffle selection and credit were corrected; admin-api v95 is ACTIVE in Preview. The existing LUCKY BOY raffle is currently drawn and credited (one winner); this audit did not change that raffle or issue a prize.
- The ZAP transfer Edge Function now passes the validated whole-number amount into the trusted database RPC; the RPC independently enforces the 100 ZAP minimum. The ledger remains the source of truth for balances and net-rank calculations.
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

- Preview frontend checks on the raffle precision UI commits and the ZAP transfer fix completed successfully (runs 44125435371, 44125445424, and 44125754082). Dependency remediation workflow 44121436055 updated compatible packages, ran npm audit fix --force, then passed type-check, lint, and build.
- Earlier failed CI runs were caused by one unused import in `ZapWalletPanel.tsx`; that error is fixed.
- The dependency remediation workflow committed the refreshed lockfile (d867cc416ef56b6ee9f85d9e5068d851e01b213f). Its post-fix audit reported 0 vulnerabilities (0 low/moderate/high/critical).
- Security advisor also reports leaked-password protection disabled. This is an Auth configuration item to review and enable safely.
- The latest READY Vercel Preview observed is commit `67071773275a1413f58b1492a1a457e2a210b3fb` (deployment `dpl_AMsxhtuZB1fsKh2PrxpkeitQKzH9`). The active branch is ahead of the latest READY Preview; the exact commit distance is recorded in the deployment section below. The branch includes exact Gram amount handling, the new free Alpha Miner accrual, and the Telegram magic-link login migration; these latest changes are not yet in that READY Preview. Do not test Preview login until the frontend and backend are on matching versions.
- Production has not been changed.

## Repair order

1. Finish the migration-history reconciliation without replaying or repairing the ledger blindly.
2. Finish the Stage 5 security review and safe database advisor improvements.
3. Complete missing Missions actions, beginning with a verifiable Share Uplink flow; keep unverified rewards locked.
4. Audit every player/admin button against its backend action and visible success/failure state.
5. Resolve or formally mitigate the new dev-toolchain picomatch advisory when a safe upstream fix is available; keep production dependencies audited separately. Continue running type-check, lint, build, and tests after each code change.
6. Verify ZP/ZAP, streak, box, raffle, expedition, creator, wallet, and referral flows using safe Preview test accounts and rollback-safe tests.
7. Finish ad-provider and TON Connect integration checks; keep real mainnet transfers disabled until separately approved.
8. Deploy the latest branch to Vercel Preview when the remaining audit fixes are ready, then perform the full Preview acceptance test. Verify the deployment's commit SHA; do not assume a branch push is live.
9. Only after the Preview acceptance checklist passes, prepare a separate Production release plan for approval.

**Never treat this tracker as approval to change Production, initiate real payments, replay migrations, or delete player data.**


## Fresh audit update — 2026-11-17

This section supersedes older point-in-time statements in this tracker where they conflict. It records only work verified against the active Preview project and branch.

### Stage 1 — current security posture
- Fourteen Supabase Edge Functions are ACTIVE in Preview; all 14 deployed function sources were compared with the active branch and match (one file differs only by a trailing newline). The shared event-verification module used by event-participation also matches.
- Critical deployed function sources were compared with branch source; admin-api v98 is ACTIVE, zap-wallet v7 is ACTIVE, telegram-auth v10 is ACTIVE, gameplay-actions v8, mission-actions v6, mystery-box-actions v5, and ton-wallet v4 are ACTIVE.
- The nine functions with verify_jwt=false must be understood individually: authenticated functions perform their own bearer-token/admin verification; public-events is an intentional public GET-only read of published future events. Do not treat the setting alone as a vulnerability.
- Public raffle RPC wrappers for winner selection and ZAP/TON credit are executable by service_role only. Direct EXECUTE has been revoked from PUBLIC/anon/authenticated on the internal raffle helpers.
- Public application tables with RLS enabled but no policies were checked for direct anon/authenticated privileges; no exposed client table access was found for those no-policy tables. The 76 advisor notices are informational and include private-schema tables intentionally accessed through trusted functions.
- Telegram authentication was hardened: Preview telegram-auth v10 validates signed initData no older than 10 minutes, rejects initData over 8 KB, no longer derives or returns a reusable password, rotates legacy deterministic passwords once, and returns a one-time Supabase magic-link token hash. The frontend now verifies that token with verifyOtp. The Edge Function is verify_jwt=true and its deployed source matches the branch. This needs an end-to-end Telegram login test after the matching frontend Preview is deployed.
- The security advisor still reports one warning: leaked-password protection is disabled. This is an Auth configuration setting and remains to be enabled through Supabase Auth settings.
- Broad default privileges for objects created by postgres in public were restricted for future tables, sequences, and functions; existing grants were not changed. The equivalent defaults for supabase_admin remain broad because the current SQL execution role cannot alter that role's default privileges. This is a residual hardening item, not evidence that current public objects are exposed.

### Stage 5 — migration and backend repair
- Preview migration ledger is present and currently records 113 versions. The branch contains 117 migration files: 19 branch versions are not recorded remotely and 15 remote versions have no matching filename in the branch. Do not replay or repair these histories without the migration-by-migration reconciliation and data-effect review.
- Applied and tracked Preview hardening migrations:
  - 20261117160203_harden_internal_raffle_helper_execute_grants.sql
  - 20261117160739_restrict_postgres_public_default_client_privileges.sql
  - 20261117161031_correct_daily_streak_zap_reward_range.sql
  - 20261117161446_support_gram_raffle_winner_selection.sql
  - 20261117161650_support_gram_raffle_reservation_precision.sql
- Daily Streak Days 8–30 now award a uniformly selected whole-number amount from 10–20 ZAP (35% outcome). This is separate from the Premium Mystery Box's 10% 1–10 ZAP prize. The corrective database migration is applied and the function definition was read back to verify the new range.
- Raffle winner selection now supports both zap and ton; the currency is stored as ZAP or TON accordingly. Raffle pool, winner amount, and reservation amount columns now preserve nine decimal places for Gram/TON. The reservation helper now keeps nine-decimal balance precision.
- Raffle Admin API UUID validation was corrected for the selection and both credit actions. Supabase Preview admin-api version 95 is ACTIVE and its deployed source matches the branch.
- The existing LUCKY BOY sample raffle is now drawn with one ZAP winner marked credited by Admin. The audit did not select or credit that winner; no real player prize was issued by these audit changes.
- A rollback-only TON test fixture was attempted but blocked by the SQL tool's write-safety guard. Therefore TON winner selection/credit is statically and schema-verified but not yet end-to-end tested with a test raffle. Do not mark Gram raffle payout as fully accepted until a safe Preview test is completed.

### Stage 6 — mission and reward fixes
- Mission cards now use the server-derived task status for both daily and social tasks. X Follow status is included in the server summary, and submitting an X account triggers a refresh.
- Daily Streak status refreshes on app focus and every 60 seconds; Mystery Box inventory refreshes on app focus and every 60 seconds.
- Free Alpha Miner (the 24-hour Agent 1 reward) now accrues 0.1 verified ZP/second through a separate private accrual ledger. The trusted paid-rental accrual function and reward-inventory lookup both settle it; it does not create a paid rental row. The migration is applied in Preview, with zero existing free-agent accrual rows or active/available free-agent entitlements at audit time. No player balance was changed by applying the migration.
- Agent Uptime claim is disabled until the server confirms the required 12 continuous active rental hours.
- Broadcast Your Uplink now has a Copy Referral Link action. Its 300 ZP reward remains unclaimable until a verifiable qualifying-referral completion rule is implemented.
- Join Intel points to https://t.me/zordcommunity and uses @zordcommunity for membership verification. The ZORD Telegram bot still needs to be confirmed as an administrator of that channel before live membership checks can succeed.
- The 2× Fragment Mining boost already applies to the server-side fragment accrual calculation for six hours after activation. The temporary Agent 1 accrual path is now connected to verified ZP; end-to-end timing and credit still need a controlled test entitlement.

### CI and deployment
- The earlier dependency remediation workflow 44121436055 reported 0 vulnerabilities at that point in time. A new GitHub advisory was added on 2026-11-17 for picomatch through 4.0.7 (GHSA-fc5q-39xc-vjpf / CVE-2026-112366); the latest CI audit now reports 17 HIGH findings across the build/tooling dependency tree. The affected lockfile entries are marked dev-only. The advisory currently lists no fixed version, so do not force a major toolchain downgrade or pretend this is resolved; monitor the upstream fix. The production/runtime dependency tree should be audited separately.
- The latest READY Vercel Preview observed is commit `67071773275a1413f58b1492a1a457e2a210b3fb`; the active branch is 13 commits ahead at `d1bc5c94f652de43762a9d4fe05f9c9b6cee5302`. It does not yet include the Telegram magic-link frontend change or later raffle currency-label changes.
- Production, main, and the separate Zord-Agents-bot project remain untouched.

### Remaining blockers before Stage 1–8 sign-off
1. Run the final Supabase migration dry-run/list check after the filename reconciliation; the current Preview ledger and branch now match 114/114 exactly.
2. Enable leaked-password protection in Supabase Auth settings.
3. Resolve supabase_admin default-privilege hardening through an authorized owner-level change, without modifying managed-schema defaults.
4. Complete safe end-to-end tests for TON raffle selection/credit, ZAP transfer symmetry/idempotency, daily streak duplicate/concurrent claims, Mystery Box activation, expedition rewards, Creator Ops review isolation, and the new multi-source referral kickback claim flow.
5. Implement a verifiable Share Uplink completion path; keep its reward locked until then.
6. Confirm the bot is an admin in @zordcommunity and verify membership checks.
7. Run a controlled test for the 6-hour boost and 24-hour free Alpha Miner accrual; verify server timer, exact 0.1 ZP/s ledger credit, idempotency, and expiry.
8. Wait for Vercel's deployment limit to reset, deploy the current branch to Preview, and run the full mobile/desktop acceptance checklist.
9. Keep real mainnet payment initiation disabled until all wallet proof, funding, reconciliation, and failure-path tests pass.

Stage 1–8 remain **in progress**. This update does not authorize Production deployment, migration replay/repair, real payments, or any changes to player balances beyond the specifically listed schema/function hardening.


### Additional Stage 7 verification — 2026-11-17
- The ZAP wallet API has no withdrawal action; the player flow is conversion and internal transfer only.
- The transfer RPC rejects non-whole amounts, invalid/self recipients through the recipient lookup path, and now rejects every amount below 100 ZAP at the database boundary as well as the Edge Function boundary.
- The ZAP ledger is the rank source of truth: credit entries add and debit entries subtract. Core rank increments at each 500 net ZAP; the achievement level increments at each 100 net ZAP. Unminted achievements can relock when net ZAP falls; minted achievements remain unlocked.
- No real ZAP transfer, conversion, Gram payout, or player balance change was performed during this audit. These paths still need safe test-account end-to-end acceptance tests.


### Stage 8 focused review — TON Connect and Gram withdrawal
- `public/tonconnect-manifest.json` is valid JSON and declares the canonical dApp URL `https://zord-autonomous-agent.vercel.app`.
- The `ton-wallet` Edge Function is ACTIVE as version 4 in Supabase Preview, has `verify_jwt=true`, and its deployed source exactly matches the active branch.
- The backend verifies mainnet network ID `-239`, the expected TON Connect domain, proof timestamp, one-time challenge payload, StateInit-derived wallet address, public key, and signature before saving a wallet.
- Challenge creation, challenge consumption, wallet save, and withdrawal request RPCs are executable only by `service_role`; direct execution is denied to `anon` and `authenticated`.
- Gram withdrawal requests reserve the amount atomically, use idempotency keys, and require admin transitions through pending → approved → processing → paid. Rejection releases the reserved amount. Marking paid requires a transaction hash/reference.
- Agent rental mainnet intent creation is now hard-disabled in Preview at the Edge Function boundary. Supabase Preview agent-rental-payments v4 is ACTIVE and its source matches the branch. The verify-payment action remains available only to reconcile already-created intents so an on-chain payment already sent is not silently lost. Both intent-creation and payment-confirmation RPCs are service_role-only.
- Preview currently has two pending agent-rental payment intents: one is already past its payment window and one is near expiry; neither has a transaction hash recorded. They were not cancelled or marked paid during this audit. New payment intents are blocked. Reconcile these existing records before clearing them.
- This is source/schema/permission verification, not a live wallet-signature or payout test. No TON wallet was connected, no withdrawal was requested, and no mainnet transfer was made during this audit.

## Stage 1–8 release roadmap and acceptance gates

| Stage | Work to finish | Acceptance gate before sign-off |
|---|---|---|
| 1 — System Audit | Complete feature inventory, security grants, RLS, function auth, scheduled-job review, Telegram login hardening, and error-path matrix | Every exposed action has an identified owner, auth boundary, and safe test; no unexplained client-accessible privileged function; Telegram sign-in uses a fresh signed initData and one-time Auth token |
| 2 — ZP Economy | Verify rental accrual, fragment accrual, six-hour maturity, pending/verified balances, expiry and retry behavior | Two-player isolation, exact accrual boundary, duplicate-job idempotency, and no direct client balance writes |
| 3 — Legacy Progression | Test cloud-save version conflicts, reconnect, recovery, and local-state tampering | Stale writes rejected; retries recover; local data cannot overwrite verified economy/progression |
| 4 — Creator Ops | Test YouTube/TikTok identity, X review, admin queue, duplicate submission, approval/rejection and reward issue | Player-only records, admin-only review, atomic once-only reward, audit history and retry-safe state transitions |
| 5 — Trusted Backend | Reconcile 19 branch-only and 15 remote-only migration versions; review remaining security advisor items and RPC grants | No blind replay; clean migration baseline; leaked-password protection enabled; no unintended grants; all critical RPCs tested as anon/authenticated/service_role |
| 6 — Gameplay UI | Finish Share Uplink completion rule, Telegram membership check, streak/box/expedition/raffle buttons, status counters, responsive and empty/error states | Every visible button has a real backend action or is clearly disabled/hidden; counters match server state; reward paths are idempotent |
| 7 — ZAP Economy | Test conversion, transfer, sender/recipient ledger, rank rollback, rings, badge permanence, ZAP and TON/Gram raffle prize credits | 1,000 ZP = 1 ZAP; 100 ZAP minimum; exact symmetric ledger; no duplicate credits; net-rank recalculates correctly; safe TON payout test |
| 8 — Integrations & Payments | Finish ad provider adapters and verified callbacks, TON proof test, rental payment reconciliation, withdrawal and failure paths | No reward from ad click alone; callbacks signed/idempotent; wallet ownership proven; payment receipts reconcile; real payments remain off until separately approved |

The roadmap is sequential: do not mark a later stage complete because its UI exists. A stage passes only after its acceptance gate is evidenced in Preview. Stage 1–8 remain **in progress**; Production is a separate release decision and is not authorized by this roadmap.


### Additional Stage 6 and Stage 7 findings — 2026-11-17
- The free Agent 1 entitlement previously activated a timer but was not included in verified ZP accrual. The new Preview migration 20261117194303_accrue_free_alpha_miner_reward_zp.sql creates a private idempotent accrual ledger and settles the configured Alpha Miner rate of 0.1 ZP/second through player_economy and economy_ledger. It is integrated into the existing scheduled/GET accrual entry point and reward inventory refresh.
- The new accrual table has RLS enabled and no direct grants to client roles; the accrual RPC is service_role-only. Preview currently has zero rows in the new accrual table and zero available/active Agent 1 entitlements, so no real player balance changed during this repair.
- Referral kickbacks now support legacy Fragment rewards, current Fragment accruals, paid-agent accruals, and free Agent 1 accruals. The new private source-event ledger preserves direct 5%, second-level 1%, Overclock 2×, 24-hour hold, and monthly-budget allocation. Preview had zero referral relationships and zero kickback entries/ledger rows when applied, so no historical or player credit was created. A controlled referral-chain test remains pending.
- Raffle prize-pool amounts and custom winner shares now remain decimal strings from the Admin UI through admin-api; Gram external funding amounts are also passed as strings and validated to at most nine decimals. Supabase Preview admin-api v98 is ACTIVE and matches the branch. Its verify_jwt=false setting is intentional: this admin endpoint performs its own rate-limited admin-credential check before processing any action.
- Preview CI caught and corrected two frontend typing regressions during the decimal-string and magic-link work. The last fully successful check was run 44161862936 at commit 0f4a65b; the latest check for Telegram auth commit d1bc5c94 is still running.
- The latest read-only migration-status workflow reports the Join Intel task's telegram_chat_id as @zordcommunity (not null) and its action link as the correct channel URL. Whether the bot is an administrator of that channel has not yet been confirmed.


### Additional Stage 1 authentication repair — 2026-11-17
- The prior Telegram login design derived a permanent Supabase password from BOT_TOKEN and returned it to the browser. It also accepted signed initData for 24 hours.
- Preview telegram-auth v10 now limits initData age to 600 seconds and size to 8192 bytes, rotates legacy deterministic passwords once to random undisclosed passwords, and returns only a one-time magic-link token hash generated by Supabase Auth. The frontend calls verifyOtp with type magiclink.
- The version marker is stored in protected app_metadata (not user_metadata), so a client cannot skip password rotation by editing its own profile metadata.
- The Supabase function is ACTIVE, verify_jwt=true, and its source matches the active branch. The frontend change has not yet reached the latest READY Vercel Preview, so the Preview login flow must not be tested until the matching frontend deployment is READY.
- No production Auth user, password, or session was changed. Existing Preview users are rotated only when they next complete Telegram authentication through the new function.


### Additional Stage 8 payment safety repair — 2026-11-17
- The rental checkout UI was disabled in Preview, but the backend Edge Function still allowed authenticated users to create new mainnet Gram payment intents directly. This was a backend bypass of the UI lock.
- Preview agent-rental-payments v4 now hard-blocks create_intent until explicit live-launch approval. verify_payment remains available only for already-created intents so a transfer already sent can still be reconciled. The underlying RPCs are service_role-only.
- Two pending payment intents remain in Preview (one expired, one near its expiry at audit time), both without a transaction hash in the database. No new intent was created by this repair, no payment was verified, and no rental was activated. Do not cancel or mark these records paid until their on-chain state is reconciled.
- Vercel's deployment API rejected the current Preview build with HTTP 402 (api-deployments-free-per-day; retry after 24 hours). The latest READY Preview remains commit 67071773275a1413f58b1492a1a457e2a210b3fb. The current branch is 16 commits ahead. The frontend auth migration is therefore not yet on the READY Preview; do not test Telegram login on the old Preview frontend against the new telegram-auth backend until Vercel quota is resolved and the matching build is READY.


### Additional Stage 7 referral accounting repair — 2026-11-17
- Preview migration 20261117200445_generalize_referral_kickbacks_for_all_mining_sources.sql adds source-event identity to the private referral entries and ledger tables.
- A single private SECURITY DEFINER recorder now accepts validated source records from legacy Fragment rewards, current Fragment mining accruals, paid-agent rental accruals, and the free Alpha Miner entitlement. Fragment release, paid-agent accrual, and free-agent accrual call it only after the ZP credit is committed in the same database transaction.
- The old Fragment referral recorder now delegates to the generic source recorder. Allocation, player history, and claim ledger entries preserve the source-event type and ID.
- The new recorder has no EXECUTE grants for PUBLIC, anon, authenticated, or service_role; it is invoked only by trusted SECURITY DEFINER functions. The new private tables/columns remain inaccessible to client roles.
- Preview had zero referral relationships, zero kickback entries, and zero kickback ledger rows at migration time. A no-referrer dry call returned without creating rows. No existing mining accruals were backdated and no player balances changed.


### Stage 5 migration history reconciliation completed — 2026-11-17
- Preview migration ledger: 114 versions.
- Branch deployable migration files: 114.
- Missing local versions: 0.
- Remote-only versions: 0.
- Duplicate version prefixes: 0.
- Fifteen timestamp prefixes were aligned to the exact already-applied remote versions. Their SQL content was preserved byte-for-byte; no migration was re-executed.
- Three superseded or draft-only migrations were moved to docs/migration-notes so Supabase CLI will not treat them as pending deployable migrations. The earlier ZAP source-only preparation file was also archived after its safe parts were applied through a new tracked migration.
- The migration-status workflow is expected to verify the clean 114/114 state. A final clean database dry-run remains a sign-off check, but the prior 19/15 drift is resolved.


### Stage 8 focused repair — 2026-11-19
- Re-reviewed the current Preview rental-payment implementation against the Stage 8 acceptance gate.
- Found a regression: the UI and backend correctly blocked creation of new mainnet rental intents, but the backend also blocked `verify_payment`. That contradicted the existing-intent reconciliation requirement and could strand a player who had already sent a payment.
- Restored authenticated, player-scoped verification for existing intent IDs only. New `create_intent` requests remain hard-blocked by `MAINNET_RENTAL_INTENTS_ENABLED = false`; no real mainnet payment initiation was enabled.
- Committed to `security/trusted-gameplay-migration` as `285bcd918cef9823ee9d26deab2b51276e0488a5`; deployed Supabase Preview `agent-rental-payments` v11 (ACTIVE). Vercel Preview for the same commit is READY.
- Static verification confirms the create-intent guard remains present and the verify-payment launch guard is absent. Existing intents are still authenticated, scoped to the signed-in player, checked against the exact recipient/amount/reference/time window, and credited only through the idempotent service-role confirmation RPC.
- The two old Preview intents remain pending and have not been marked paid, expired, cancelled, or credited by this repair. They must be reconciled against TON mainnet before any status change.
- Ad status remains blocked on provider-issued placement IDs, credentials, and verified callback configuration. Fragment ad UI is still a publisher-review placeholder; AdsGram must remain optional and confined to Mystery Box, never Fragments or Missions. The Mystery Box AdsGram button is still disabled pending the verified integration.
- TON Connect proof logic is present and the allowed Preview host pattern is configured, but a live wallet proof and actual withdrawal/payout test have not been performed.
- The ZORD bot's administrator status in `@zordcommunity` is not confirmed. Telegram membership verification cannot be signed off until this is checked with the configured bot.
- No real mainnet transfer, wallet payout, ad reward, player balance change, or Production change was performed.


### Stage 8 follow-up — payment recovery UI — 2026-11-19
- Added authenticated `list_pending_intents` to `agent-rental-payments`. It returns at most five pending intents belonging only to the signed-in player; no other player's intent IDs or payment details are exposed.
- The Agents tab now restores pending rental checkouts after reload and renders each request separately so multiple pending payments can be reconciled independently.
- Removed the Preview-only UI block from the existing-intent verification action while keeping payment initiation disabled. The Preview UI no longer exposes a transfer action for these old intents; each card offers only a TON mainnet reconciliation check.
- Verification refresh failures no longer overwrite a confirmed-payment success with a misleading payment-failed message. The pending list is refreshed independently after confirmation.
- Supabase Preview `agent-rental-payments` v12 is ACTIVE. The frontend commits through `cb0186bc6435ae79c7379c17a3417ca902095ad4` reached READY Preview; the follow-up cleanup commit `ac9494de585b23e06e2a51d1ea673ed6f9381fd7` was building at the time of this note.
- Preview still contains two pending intents for the same player and neither has a transaction hash. Both are now individually recoverable in that player's Agents tab. They remain unchanged until the player checks each one against the TON mainnet ledger.
- New mainnet rental intent creation and all new payment transfers remain disabled. No player balance, rental, intent status, or Production resource was changed.
- Stage 8 remains in progress: provider-issued ad IDs/callback credentials, verified ad callback integration, live TON wallet proof, pending-intent mainnet reconciliation, and safe withdrawal/payout acceptance tests are still outstanding.
