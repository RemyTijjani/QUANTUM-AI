# Stage 5 Preview Migration-History Reconciliation Plan

**Status:** Preparation only — not approved for database execution  
**Target:** Supabase Preview only  
**Branch:** `security/trusted-gameplay-migration`  
**Reference snapshot commit:** `c48250c06875588d758a49c345f7d1565c4c0861`  
**Reference snapshot workflow:** [Run 43568836739](https://github.com/RemyTijjani/QUANTUM-AI/actions/runs/43568836739)

## Safety boundary

This document is a review plan. It does not run SQL, create or modify the Supabase migration ledger, apply migrations, deploy functions, or change Production. Do not run `supabase db push`, `supabase migration up`, or `supabase migration repair` as part of this preparation.

## Evidence currently available

- The active branch contains 48 SQL migration files.
- The read-only Preview migration-status workflow previously reported zero recorded migrations.
- The prior audit reported that the `supabase_migrations` schema and ledger table were absent. The public-schema snapshot does not include that schema, so the ledger state must be checked again before any repair.
- The Preview public-schema snapshot contains 23 public tables, 20 public functions, 4 triggers, 5 RLS policies, and 1 view. RLS is enabled on all 23 public tables.
- The live Preview `public.register_referral(bigint,bigint)` is a SECURITY DEFINER PL/pgSQL function with a pinned search_path and writes to `referral_sub_nodes`. The checked-in migration `20261108200522_create_register_referral.sql` instead inserts into legacy `referrals`. These definitions are not interchangeable.
- The Preview snapshot includes later Stage 5 security objects and changes, including four-hour fragment maintenance, Creator Ops content identity validation, admin login throttling, append-only gameplay evidence permissions, event configuration/paid-participation guards, and Vault reserve integrity.
- The schema dump is a public-schema schema snapshot, not a complete portable database backup. It does not prove that a clean project has the required Supabase-managed schemas, roles, extensions, auth dependencies, secrets, Edge Functions, or data.

## Migration inventory

The branch currently contains these 48 files:

1. `20261104132750_create_creator_ops_submissions.sql`
2. `20261105045254_rename_reward_iq_to_reward_zp.sql`
3. `20261105054129_create_referral_sub_nodes.sql`
4. `20261106205629_20261106000001_telegram_auth_player_identity.sql`
5. `20261108112102_create_mission_tasks.sql`
6. `20261108114501_create_vault_reserves.sql`
7. `20261108141121_allow_public_read_mission_tasks.sql`
8. `20261108200452_create_creator_ops_submissions.sql`
9. `20261108200501_align_creator_ops_submissions.sql`
10. `20261108200505_create_referral_sub_nodes.sql`
11. `20261108200518_telegram_auth_player_identity.sql`
12. `20261108200522_create_register_referral.sql`
13. `20261108200532_create_mission_tasks.sql`
14. `20261108200535_create_vault_reserves.sql`
15. `20261108200540_allow_public_read_mission_tasks.sql`
16. `20261112090000_create_game_events.sql`
17. `20261112170000_change_event_participation_rules_to_text.sql`
18. `20261112180000_create_game_event_participations.sql`
19. `20261112190000_add_event_participation_audit.sql`
20. `20261112200000_add_configurable_event_activities_and_mission_options.sql`
21. `20261112223000_admin_configurable_missions_event_activities.sql`
22. `20261113100000_allow_creator_event_mission_link.sql`
23. `20261113120000_event_capacity_and_bulk_creator_approval.sql`
24. `20261113140000_trusted_fragment_gameplay.sql`
25. `20261113150000_admin_approved_event_zp_rewards.sql`
26. `20261113160000_admin_status_capacity_guard.sql`
27. `20261113170000_enforce_started_event_configuration_lock.sql`
28. `20261113180000_lock_started_event_metadata.sql`
29. `20261113190000_serialize_event_reward_approval.sql`
30. `20261113200000_protect_paid_event_participations.sql`
31. `20261113210000_fix_event_reward_lock_order_and_paid_delete.sql`
32. `20261113220000_enforce_verified_completion_in_status_rpc.sql`
33. `20261113230000_lock_creator_submission_inserts.sql`
34. `20261113231000_harden_creator_submission_access.sql`
35. `20261113235000_fragment_four_hour_maintenance.sql`
36. `20261113240000_secure_creator_submission_validation.sql`
37. `20261113250000_prevent_cancelling_paid_events.sql`
38. `20261113260000_harden_event_reward_search_path.sql`
39. `20261113270000_make_gameplay_evidence_append_only.sql`
40. `20261113280000_unique_pending_fragment_unlock.sql`
41. `20261113290000_harden_admin_participant_status_search_path.sql`
42. `20261113300000_create_agent_rental_payments.sql`
43. `20261114090000_harden_creator_review_decision.sql`
44. `20261114100000_restrict_service_role_economy_writes.sql`
45. `20261114110000_admin_api_login_rate_limit.sql`
46. `20261114120000_secure_creator_content_identity.sql`
47. `20261114140000_harden_creator_url_host_validation.sql`
48. `20261114160000_repair_vault_reserves_integrity.sql`

## Known reconciliation groups

| Group | Files / objects | Preliminary finding | Required handling |
|---|---|---|---|
| Creator Ops table and reward rename | 1, 2, 8, 9 | Earlier create/rename and later create/alignment overlap. Preview has the newer shape and retains legacy columns. | Compare every column, constraint, index, policy, and function dependency before classifying. Never replay old table creation. |
| Referral sub-nodes and identity | 3, 4, 10, 11, 12 | Two versions of setup overlap. The checked-in referral RPC conflicts with the live Preview implementation. | Preserve the live function exactly; separately compare Telegram identity logic and table constraints. |
| Mission tasks and Vault | 5–7, 13–15, 48 | Duplicate setup versions; newer mission shape is present; Vault has a later integrity repair. | Do not replay setup. Verify seeds, grants, policies, constraints, and reserve values. |
| Game events and participation | 16–32 | Layered schema and corrective migrations; Preview has normalized activities and protective triggers. | Verify exact final definitions and dependencies in order; do not assume a matching object name proves equivalent behavior. |
| Creator Ops hardening | 22, 33–36, 43, 46–47 | Multiple security and validation changes; Preview has content identity enforcement. | Compare final function bodies, grants, RLS, indexes, and historical data effects. |
| Gameplay and fragment protections | 24, 35, 37–42 | Later hardening and operational objects; Preview includes append-only evidence and pending-unlock uniqueness. | Verify function bodies, trigger definitions, indexes, and service-role permissions. |
| Economy and admin security | 44–45 | Latest access restriction and login-throttling work. | Verify table ACLs, function EXECUTE grants, HMAC key handling in Edge Function configuration, and actual workflow tests. |

## Required checks before designing any baseline

1. Re-run read-only `supabase migration list --linked` against the Preview project and capture the complete output.
2. Independently query the Preview catalog for the existence and structure of the migration ledger schema/table. Do not infer its state from the public schema dump.
3. Re-capture the public schema and compare it to the reviewed snapshot; check for intervening changes.
4. Compare all 48 migration files, in order, with the snapshot. Classify each as: present and equivalent; present but drifted; superseded; partially present; conflicts with live state; data/backfill effect not provable; or not present.
5. Review all external dependencies: Supabase-managed auth/storage/realtime schemas and roles, extensions, auth.users foreign keys, Edge Functions, secrets, and any scheduled jobs.
6. Review whether the public-schema dump can be transformed into a reproducible baseline safely. It must not blindly copy environment-specific ACLs/default privileges or assume roles/schemas exist. Preserve RLS, grants, policies, triggers, constraints, indexes, function owners/security settings, and view security behavior.
7. Verify seed/data requirements separately. A schema-only dump does not carry mission seed rows or other application data.
8. Build and validate the proposed baseline in an isolated disposable Supabase project or equivalent clean database, never against Production. If an isolated environment is unavailable, stop and request one rather than experimenting on Preview.
9. Produce a dry-run diff and a precise Preview-only execution plan for explicit approval.

## Execution gate

No migration ledger creation, baseline application, migration repair, or database DDL is authorized by this document. Those actions require a separate explicit approval after the full reconciliation matrix, isolated validation, backup/restore plan, and exact SQL are reviewed.

Production remains out of scope.


## Detailed migration-file review — first pass

All 48 migration files were fetched from the active branch and read. This is a source-to-snapshot reconciliation pass, not proof that each migration's full effect is present in Preview. The classifications below identify the safe treatment for planning:

| Version | File | Preliminary classification | Why it must not be blindly replayed |
|---|---|---|---|
| 20261104132750 | create_creator_ops_submissions | Superseded / unsafe legacy | Opens anon/authenticated CRUD and permissive policies. |
| 20261105045254 | rename_reward_iq_to_reward_zp | Superseded by later table alignment | Depends on the early Creator Ops table shape. |
| 20261105054129 | create_referral_sub_nodes | Superseded / unsafe legacy | Opens anon CRUD and broad policies, later replaced by authenticated identity scoping. |
| 20261106205629 | telegram_auth_player_identity | Superseded version | Earlier identity/RLS implementation; later 08200518 repeats and adjusts policy definitions. |
| 20261108112102 | create_mission_tasks | Superseded schema seed | Initial mission table and seed; later migration extends the shape and changes visibility. |
| 20261108114501 | create_vault_reserves | Baseline object; later repaired | Vault schema exists, but final precision/constraints/ACL are supplied by 14160000. |
| 20261108141121 | allow_public_read_mission_tasks | Superseded policy | Broad public read later replaced by published-only policy. |
| 20261108200452 | create_creator_ops_submissions | Duplicate legacy create | Same permissive legacy table setup as 04132750. |
| 20261108200501 | align_creator_ops_submissions | Superseded/partially represented | Adds required columns to the earlier shape; later content identity/security changes extend it. |
| 20261108200505 | create_referral_sub_nodes | Duplicate legacy create | Same permissive policies as 05054129. |
| 20261108200518 | telegram_auth_player_identity | Superseded/partially represented | Authenticated identity and own-row policies; later hardening changes Creator Ops insert path. |
| 20261108200522 | create_register_referral | **Conflicts with live Preview** | Defines SQL function writing legacy `referrals`; live function writes `referral_sub_nodes`. Preserve live Preview implementation. |
| 20261108200532 | create_mission_tasks | Duplicate schema/seed | Repeats mission table and seed setup; later 12223000 adds current status/objectives/requirements fields. |
| 20261108200535 | create_vault_reserves | Duplicate schema/seed | Repeats Vault creation and singleton seed. |
| 20261108200540 | allow_public_read_mission_tasks | Superseded policy | Public SELECT policy is later narrowed to published tasks. |
| 20261112090000 | create_game_events | Base object, later altered | Subsequent migrations change participation_rules type and add limits/guards. |
| 20261112170000 | change_event_participation_rules_to_text | Required schema transformation | Converts JSONB participation_rules to text; must be represented in final definition. |
| 20261112180000 | create_game_event_participations | Base object, later altered | Later adds reward fields and paid-record protections. |
| 20261112190000 | add_event_participation_audit | Base RPC, later replaced | Later RPC versions add capacity and verified-completion checks. |
| 20261112200000 | add_configurable_event_activities_and_mission_options | Superseded/overlapping | Adds a JSONB activities column to game_events and early mission fields; current snapshot has normalized game_event_activities and does not have game_events.activities. |
| 20261112223000 | admin_configurable_missions_event_activities | Current schema foundation, later hardened | Creates normalized activities and final mission fields; later trigger protections apply. |
| 20261113100000 | allow_creator_event_mission_link | Required constraint correction | Allows Creator Ops activity to reference mission_id. |
| 20261113120000 | event_capacity_and_bulk_creator_approval | Partially represented / later RPC changes | Adds capacity and registration/bulk approval functions; later versions replace status and reward RPCs. |
| 20261113140000 | trusted_fragment_gameplay | Base trusted gameplay objects | Later files modify cadence and pending-session uniqueness. |
| 20261113150000 | admin_approved_event_zp_rewards | Base reward RPC, later replaced | Later versions serialize locks, prevent paid-row mutation, and pin search_path. ZAP is not paid by this path. |
| 20261113160000 | admin_status_capacity_guard | Superseded RPC body | Later 13220000 adds verified-completion enforcement. |
| 20261113170000 | enforce_started_event_configuration_lock | Base trigger guards | Later versions protect metadata and paid-event cancellation. |
| 20261113180000 | lock_started_event_metadata | Superseded trigger function body | Later 13250000 adds protection against cancellation after payouts. |
| 20261113190000 | serialize_event_reward_approval | Superseded reward RPC body | Later 13210000 changes lock order and protects deletion. |
| 20261113200000 | protect_paid_event_participations | Superseded trigger body | Later 13210000 expands immutability to DELETE. |
| 20261113210000 | fix_event_reward_lock_order_and_paid_delete | Later canonical versions | Final reward lock order and paid participation update/delete guard. |
| 20261113220000 | enforce_verified_completion_in_status_rpc | Current security requirement | Ensures completion requires verified required activities. |
| 20261113230000 | lock_creator_submission_inserts | Superseded by broader hardening | Revokes direct INSERT; next migration removes all old policies and grants. |
| 20261113231000 | harden_creator_submission_access | Current access-control requirement | Removes all Creator Ops policies and limits client reads to own rows. |
| 20261113235000 | fragment_four_hour_maintenance | Current function body | Replaces fragment fix routine with four-hour maintenance interval. |
| 20261113240000 | secure_creator_submission_validation | Superseded function version | Adds platform and pending uniqueness; content identity is added in 14120000. |
| 20261113250000 | prevent_cancelling_paid_events | Current trigger function body | Prevents cancellation after any payout has been issued. |
| 20261113260000 | harden_event_reward_search_path | Current function setting | Pins reward function search_path. |
| 20261113270000 | make_gameplay_evidence_append_only | Current ACL requirement | Revokes service_role UPDATE/DELETE/TRUNCATE on gameplay evidence. |
| 20261113280000 | unique_pending_fragment_unlock | Current index requirement | Enforces one pending unlock session per player/fragment. |
| 20261113290000 | harden_admin_participant_status_search_path | Current function setting | Pins participant status RPC search_path. |
| 20261113300000 | create_agent_rental_payments | Current Stage 5/adjacent feature schema | Creates payment intent/rental tables and trusted RPCs; requires separate verifier/configuration review. |
| 20261114090000 | harden_creator_review_decision | Superseded function version | Later 14120000 replaces review logic with content-identity validation. |
| 20261114100000 | restrict_service_role_economy_writes | Current ACL requirement | Removes direct service_role writes to economy balance/ledger tables. |
| 20261114110000 | admin_api_login_rate_limit | Current security object | Creates throttling table and service_role-only SECURITY DEFINER RPCs. |
| 20261114120000 | secure_creator_content_identity | Current Creator Ops logic | Adds content IDs, backfill, uniqueness and approval-time identity validation. |
| 20261114140000 | harden_creator_url_host_validation | Current corrective function body | Tightens exact-host checks in content ID extraction. |
| 20261114160000 | repair_vault_reserves_integrity | Current Vault final state | Restores non-null/default/precision/check constraints and service_role ACL. |

### Important distinction: final-state schema versus historical data effects

The public schema snapshot can establish many final object definitions, but it cannot by itself prove historical backfill outcomes, seed contents, data transformations, or the exact effect of a migration that was applied and later partially changed. Those need separate read-only data/catalog checks. The 8 mission seed rows and the Vault singleton row must be checked as data, not assumed from DDL.

## Deployment-target safety finding

The following Preview-labelled function deployment workflows use the repository variable `vars.SUPABASE_PROJECT_REF`, rather than the dedicated Preview secret `secrets.SUPABASE_PREVIEW_PROJECT_REF`:

- `.github/workflows/deploy-gameplay-actions-preview.yml`
- `.github/workflows/deploy-player-economy-preview.yml`
- `.github/workflows/deploy-event-participation-preview.yml`
- `.github/workflows/deploy-public-events-preview.yml`
- `.github/workflows/deploy-admin-api-preview.yml`

The workflow source alone does not reveal the variable's configured value, so this is a **target ambiguity, not proof of a Production deployment**. The agent-rental and migration-status workflows explicitly use the Preview secret. Before any further function deployment, the repository variable must be verified against the Preview project reference or those workflows must be changed to require the dedicated Preview secret. No deployment was triggered during this review.

## Baseline decision — not ready to construct or apply

Do not create a baseline migration from the public-only dump yet. It is not a complete fresh-project bootstrap: it references Supabase-managed `auth` objects/roles and may omit extensions, external schemas, function configuration, data seeds, and Edge Function secrets. Also, the legacy 48 files currently sit at the top level of `supabase/migrations`; simply adding a newer baseline will not prevent the CLI from seeing older pending files.

A viable proposal must first:
- verify Preview's actual migration ledger using a fresh read-only status run and catalog query;
- inspect the complete dump and the Supabase CLI's supported baseline workflow;
- define how to retain all 48 historical files in Git while making only the canonical baseline visible to the CLI (for example, a reviewed archive layout, after checking every workflow and tooling reference);
- validate the resulting baseline in a disposable Supabase project with the same required extensions/managed services;
- compare a fresh database's schema and required seed data to Preview.

Until these checks pass, the safest action is **no migration repair and no baseline file**.


## Fresh Preview migration-ledger verification — 2026-11-14

Workflow run: [43571024432](https://github.com/RemyTijjani/QUANTUM-AI/actions/runs/43571024432)  
Commit inspected: `800fc1625f0eda6cb1058b713863f0c83690d3a1`  
Result: **success**. Supabase CLI was pinned to 3.1.0. The workflow linked the project using `SUPABASE_PREVIEW_PROJECT_REF` and executed only read-only commands.

The fresh `supabase migration list --remote` output showed all 48 local migration versions with blank Remote entries. A separate `supabase db query --remote --read-only` catalog query returned:

- `database_name = postgres`
- `database_role = supabase_read_only_user`
- `ledger_table = null`
- `ledger_columns = null`

This confirms that the Preview database does not currently expose `supabase_migrations.schema_migrations`; it is not merely an empty migration ledger. No migration history rows were created or changed. No SQL write, migration repair, migration execution, schema change, or function deployment occurred.

**Consequence:** do not use migration repair to mark the 48 files applied until a separately reviewed, tested migration-history strategy exists. Do not replay the files against the populated Preview database. The live schema must remain the source of truth while we prepare and validate a safe baseline strategy in an isolated disposable project.

## Current execution status

- Read-only Preview ledger verification: complete.
- Ledger catalog existence check: complete; table absent.
- Full migration-by-migration reconciliation: preliminary review complete; data/backfill and external dependency checks remain.
- Baseline creation/application: not authorized and not started.
- Database writes or deployments: none.
- Production: untouched.


## Preview data reconciliation check — 2026-11-14

Read-only workflow run: [43571556302](https://github.com/RemyTijjani/QUANTUM-AI/actions/runs/43571556302)  
Commit: `570a2bb371c7fc5727dbf1a0425a7045a75ed9be`  
Result: data query passed.

The query used the actual rental table names from migration `20261113300000` (`agent_rental_payment_intents` and `player_agent_rentals`). A previous attempt used the nonexistent name `agent_rental_payments`; that was an audit-query mistake, not a missing Preview table.

Observed Preview counts and seed state:

- `mission_tasks`: 8 rows; all 8 are `published` and use `ZP` rewards.
- `vault_reserves`: exactly 1 row with id `global`; `zp_reserve = 0`, `ton_reserve = 0`.
- Players with referral codes: 1.
- Legacy `referrals`: 0 rows.
- `referral_sub_nodes`: 0 rows.
- `creator_ops_submissions`: 1 row.
- `game_event_activities`: 1 row.
- `game_event_participations`: 2 rows.
- `gameplay_action_events`: 12 rows.
- `agent_rental_payment_intents`: 1 row.
- `player_agent_rentals`: 0 rows.

These counts are a point-in-time snapshot, not proof of every historical backfill or runtime flow. The empty referral tables need to be reconciled with the active referral registration path and the one player referral code; do not populate them manually. The single rental payment intent and absence of a rental record also need state/status review before treating the rental feature as verified.

## Preview deployment-target guard

A recent successful `deploy-admin-api-preview` run logged the target project reference from `vars.SUPABASE_PROJECT_REF`, while the read-only migration workflow links using the dedicated `secrets.SUPABASE_PREVIEW_PROJECT_REF`. GitHub's connected read interface does not expose repository Actions variables/secrets directly, and the previous logs do not independently prove that these two references are equal.

A new read-only assertion has therefore been added to the Stage 5 audit workflow. It compares the legacy repository variable with the dedicated Preview secret and emits only match/mismatch, never either value. Until that assertion passes, the five Preview-labelled workflows using `vars.SUPABASE_PROJECT_REF` remain a deployment-target blocker. No new function deployment was triggered as part of this check.


## Deployment-target guard result — 2026-11-14

Read-only workflow run: [43571624005](https://github.com/RemyTijjani/QUANTUM-AI/actions/runs/43571624005)  
Commit: `4d74bb2b673dd3f08d28a852ce0dabc2e1835409`  
Result: **success**.

The assertion compared `vars.SUPABASE_PROJECT_REF` with `secrets.SUPABASE_PREVIEW_PROJECT_REF` without printing either value. It confirmed they match. This resolves the target ambiguity for the five Preview-labelled workflows that use the repository variable. The CLI linked the same project identified as `ZORD-PREVIEW`.

The audit workflow completed all steps successfully: target comparison, migration list, ledger catalog inspection, and data reconciliation. It remained read-only and did not deploy any functions or modify the database.

## Stage 5 closure assessment

The following are now verified:
- Preview-only project selection, including the legacy deployment variable comparison.
- Current Preview migration history and absence of the migration ledger table.
- Current Preview schema snapshot (reference snapshot remains the earlier artifact; a fresh comparison is still needed before baseline work).
- Mission seed count and published ZP reward currency.
- Vault singleton row and reserve values.
- Point-in-time counts for referral, Creator Ops, events, gameplay evidence, and agent rental records.

Stage 5 is **not ready to be marked complete** yet. The remaining hard blockers are:
1. The 48 checked-in migrations are not represented in Preview's remote history, and the migration ledger table is absent. A safe baseline/history strategy has not been validated.
2. No disposable Supabase project/clean database has yet been used to prove a reproducible baseline and compare it against Preview.
3. The referral tables are empty despite one player referral code; the intended registration flow and its live function need a complete end-to-end verification.
4. One rental payment intent exists but no rental entitlement exists; its status and payment verification path still need read-only review.
5. A fresh schema snapshot comparison and external dependency inventory (managed schemas/roles, extensions, Edge Function configuration/secrets, scheduled jobs) remain outstanding.

No database writes, migration repair, migration application, function deployment, or Production changes were performed during this reconciliation. These remaining checks should be completed before any Stage 5 sign-off. Any migration ledger or schema mutation still requires a separate explicit approval after the exact plan is reviewed.


## Latest Preview dependency and seed audit — 2026-11-14

Read-only workflow run: [43572116029](https://github.com/RemyTijjani/QUANTUM-AI/actions/runs/43572116029)  
Commit: `24e5a7f63200a64cd13fcbc0929e1506f8513055`  
Result: **success**. All ten audit steps completed. The workflow linked only the dedicated Preview project and performed no writes, migrations, repairs, or deployments.

### Migration history and ledger

- All 48 local migration versions again appeared with blank Remote entries.
- The read-only catalog query again returned no `supabase_migrations.schema_migrations` table or columns.
- This confirms the earlier finding; do not replay or bulk-mark the 48 migrations.

### Referral, rental, and function security

- `register_referral`, `create_agent_rental_payment_intent`, and `confirm_agent_rental_payment` are SECURITY DEFINER functions with pinned `search_path = pg_catalog, public, pg_temp`.
- Their observed EXECUTE ACLs grant execution to `postgres` and `service_role`; no `anon` or `authenticated` execute grant was present.
- The one rental payment intent is still `pending`, for `alpha_miner`, and its payment window had elapsed at the time of this audit. There are zero player rental entitlement rows. Source review shows the Edge Function verifies a TON mainnet inbound transfer against the expected destination, exact amount, unique payment comment, and intent time window before calling the service-role-only confirmation RPC. If no matching transfer is found after the additional ten-minute indexing grace period, the Edge Function marks the intent expired on the next verification request. Therefore the stale pending row is consistent with lazy expiry; it is not evidence that a rental was paid or activated. It should be checked again during a later controlled Preview test.
- The referral tables remain empty while one player has a referral code. This is a data observation, not proof of a defect: no referred signup may have occurred. The live registration function remains the `referral_sub_nodes` implementation; do not replay the conflicting legacy referral migration.

### Platform dependencies

- Installed extensions observed: `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, and `uuid-ossp`.
- `cron.job` is absent; no `pg_cron` job catalog is available in this Preview database. The four-hour fragment cooldown is enforced in the trusted database function itself; do not infer that a cron job is required from the migration filename.
- The read-only role returned no rows for the managed-schema table-grant view (`auth`, `storage`, `realtime`). This does **not** establish that those schemas have no grants; the role's catalog visibility is insufficient to certify their permissions. A privileged, read-only review is still required.
- The agent rental Edge Function source requires `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TONCENTER_API_KEY`, and `ZORD_GRAM_TREASURY_ADDRESS`. GitHub's connected read interface cannot confirm the presence or values of deployed Edge Function secrets. Never print or expose those values. The Preview deployment workflow is present, but secret configuration and deployed-function version remain to be confirmed through an authorized Supabase configuration view.

### Seed and data snapshot

- Eight mission rows are present; all are published and reward in ZP.
- One global Vault reserve row is present, with both reserves at zero.
- Point-in-time counts: one player with a referral code; zero rows in `referrals` and `referral_sub_nodes`; one Creator Ops submission; one event activity; two event participations; twelve gameplay action events; one rental payment intent; zero rental entitlements.

### Corrections to the audit process

The first dependency-audit query assumed `cron.job` existed and failed because the relation is absent. The query was corrected to inspect catalog presence only; the subsequent full read-only audit succeeded. A separate transient CLI authentication failure also cleared on the next run; no credential or database setting was changed.

## Updated Stage 5 closure assessment

Verified:
- Preview-only project target and legacy deployment-target equality.
- Fresh migration list and absence of the migration ledger table.
- Function security metadata for referral and rental RPCs.
- Installed extension inventory and absence of the cron job catalog.
- Mission seed and Vault singleton data.
- Point-in-time counts for referrals, Creator Ops, events, gameplay evidence, and rental records.
- Source-level review of the agent rental Edge Function's authentication and TON mainnet verification path.

Still required before Stage 5 sign-off:
1. Capture a fresh Preview public-schema snapshot and compare it with the prior snapshot and the complete migration inventory.
2. Obtain a privileged read-only view of Supabase-managed schema grants and verify deployed Edge Function versions and required secrets are configured, without disclosing secret values.
3. Complete the migration-by-migration final-state and historical data-effect matrix.
4. Validate a canonical baseline in a disposable Supabase project or clean database. No disposable environment has been authorized or used yet. If one is not available, stop; do not experiment on Preview.
5. Produce the baseline dry-run diff, backup/restore plan, and exact Preview-only execution plan for separate approval.

Stage 5 remains **open**. Stage 6 frontend work remains paused. No database writes, migration repair/application, function deployment, or Production changes occurred in this audit.


## Fresh Preview schema snapshot comparison — 2026-11-14

Read-only workflow run: [43572247637](https://github.com/RemyTijjani/QUANTUM-AI/actions/runs/43572247637)  
Artifact: `preview-public-schema` (artifact ID `14104289196`)  
SHA-256: `f4cef38b775728149559b38f0ca7e17463bd8c59ad91494e8d903a13975146aa`  
Result: **success**.

The fresh public-schema dump is 91,925 bytes. I downloaded both the November 14 reference artifact and this fresh artifact and compared the extracted SQL byte-for-byte. They are identical: both have SHA-256 `f4cef38b775728149559b38f0ca7e17463bd8c59ad91494e8d903a13975146aa`. This is stronger than matching object counts: there is no public-schema DDL drift between the two captured snapshots. It does not prove that data or Supabase-managed schemas/roles/configuration are unchanged.

The artifact is a schema-only export and is retained by GitHub Actions until November 21, 2026. No database writes or deployment occurred.

## Edge Function and custom-secret audit enhancement

The status workflow now includes a read-only check of deployed Preview Edge Functions and the presence of the two custom secrets required by the rental verifier (`TONCENTER_API_KEY` and `ZORD_GRAM_TREASURY_ADDRESS`). It prints only function names and secret names/presence; it does not print secret values or digests. The required built-in Supabase Edge Function environment variables are not treated as user-managed custom secrets. The new audit run must finish before reporting those deployment/configuration checks as verified.

The current read-only database role still cannot certify grants on Supabase-managed schemas. No privileged DB connection has been attempted. A separately authorized privileged read-only inspection remains outstanding.
