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
