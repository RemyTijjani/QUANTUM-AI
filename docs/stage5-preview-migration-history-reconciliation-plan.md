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
