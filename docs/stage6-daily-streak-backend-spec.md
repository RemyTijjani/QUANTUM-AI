# Stage 6 Daily Streaks — Backend Implementation Specification

Status: Product rules approved; implementation not yet authorized or applied.
Target: Preview only, active branch `security/trusted-gameplay-migration`.
Scope: Daily Streak reward claim and progression. Mystery Discovery and Expeditions are separate follow-on services.

## 1. Approved player-facing rules

### Days 1–7
One successful claim per streak day, with guaranteed ZP:

| Streak day | Reward |
|---:|---:|
| 1 | 100 ZP |
| 2 | 200 ZP |
| 3 | 300 ZP |
| 4 | 400 ZP |
| 5 | 500 ZP |
| 6 | 600 ZP |
| 7 | 700 ZP |

### Days 8–30
Each eligible daily claim selects exactly one outcome from this distribution:

| Outcome | Probability | Reward detail |
|---|---:|---|
| ZAP | 35% | Random whole-number amount from 1 to 10 ZAP |
| Boost | 34% | Daily Streak boost entitlement: 2× Fragment Mining for 6 hours from activation; boosts do not stack or extend an active boost |
| Mystery Box | 30% | One box: 80% Standard / 20% Premium selection probability; Standard excludes ZAP and the 2× Fragment Mining boost; Premium has separate 10% chances of 1–10 whole ZAP and the 2× Fragment Mining boost; both exclude temporary Agent 1 access |
| Temporary mining agent | 1% | One free Agent 1 entitlement lasting 24 hours |

The 1% chance is the chance of the temporary mining-agent outcome on each Day 8–30 reward draw. Other reward outcomes do not have to include ZAP.

### Streak continuity
- A player may claim once per UTC calendar day.
- A missed UTC calendar day resets the next eligible claim to Day 1.
- Day 30 completes the cycle; the next eligible daily claim begins a new cycle at Day 1.
- The client never supplies the player ID, claim date, streak day, reward type, reward amount, odds, or expiry.

UTC is the proposed implementation timezone because the existing trusted Daily Uplink claim derives its claim date in UTC. If the product requires each player's local midnight instead, that is a separate product decision and needs a trusted timezone source.

## 2. Preview schema findings

Read-only inspection of Preview project `lchkctclxzwwvfwosava` found:
- Existing trusted ZP infrastructure: `player_economy`, `economy_ledger`, `daily_uplink_claims`, and `claim_daily_uplink(uuid)`.
- Existing authenticated gameplay entry point: `supabase/functions/gameplay-actions/index.ts`.
- Existing temporary/paid agent rental records: `player_agent_rentals` and `agent_rental_payment_intents`.
- Existing event participation has a `progress jsonb` field and event definitions include `reward_zap`.

No dedicated Daily Streak, ZAP wallet/ledger, boost inventory, or Mystery Box inventory table was found in the Preview public schema. The current `player_economy` only exposes ZP balance fields. A paid agent rental row is not, by itself, a safe representation of a free 24-hour reward.

## 3. Proposed trusted data model

Create a streak state table keyed by player:
- `player_id` primary key and FK to the authenticated player.
- `current_streak_day` constrained to 0–30.
- `best_streak_day` constrained to 0–30.
- `last_claim_date` UTC date, nullable before first claim.
- `cycle_completed_at` nullable timestamp.
- `updated_at`.

Create an immutable streak claim ledger:
- Server-generated claim UUID.
- `player_id`, UTC `claim_date`, and awarded `streak_day`.
- `reward_type`, `reward_amount` where applicable, and immutable reward metadata.
- `claimed_at`.
- Unique constraint on `(player_id, claim_date)` to prevent duplicate daily claims.
- Unique claim reference used by downstream reward/inventory writes.

Reward grants and claim records must commit atomically. For Days 1–7, credit ZP and insert the existing `economy_ledger` row in the same database transaction. For Days 8–30, store the server-selected outcome and create a corresponding reward entitlement. ZAP must not be credited until an authoritative ZAP wallet/ledger and trusted credit function exist. Boost, box, and free-agent outcomes need explicit entitlement records with expiry and redemption/activation state; do not fake these as ZP or as paid rental payments.

All new tables in the exposed `public` schema must have RLS enabled and direct client writes revoked. Do not expose service-role credentials. Keep privileged RPC execution restricted to `service_role`, called only after the Edge Function authenticates the bearer token and derives the player ID from the authenticated user's player profile.

## 4. Atomic claim algorithm

Inside one transaction:
1. Derive the UTC claim date from the database clock.
2. Lock the player's streak-state row (create it if absent).
3. If a claim already exists for this player/date, return the recorded result without granting anything again.
4. Compute the next streak day:
   - No prior claim: Day 1.
   - Last claim date equals yesterday: increment the previous day.
   - Last claim date is earlier than yesterday: reset to Day 1.
   - If the prior claimed day was Day 30: start a new cycle at Day 1.
5. For Days 1–7, use the fixed ZP amount from the approved table.
6. For Days 8–30, use a cryptographically secure server-side draw with integer basis-point buckets: ZAP 3500, boost 3400, box 3000, temporary agent 100. Persist the draw result; never reroll on retry.
7. Apply the relevant verified balance or entitlement grant. If the required currency/entitlement subsystem is not ready, fail closed rather than recording a claim with an unfulfilled reward.
8. Insert the immutable claim row, update streak state and best streak, and commit all writes together.
9. Return the recorded day, reward, claim date, and next eligibility timestamp.

Concurrency must be safe: simultaneous requests for the same player/day must result in exactly one claim and one grant. Retries return the original recorded outcome.

## 5. Edge Function integration

Extend `gameplay-actions` with a minimal action such as `claim_daily_streak`.
- Require a valid Supabase bearer token.
- Derive `player_id` from the authenticated user, never from request JSON.
- Accept no client-provided reward, day, date, odds, or currency.
- Call one trusted database RPC for the entire atomic claim.
- Return the authoritative result and map already-claimed/conflict responses without rerolling.
- Keep GET/read state separate from claim mutation where practical.

## 6. Required tests before activation

- Days 1–7 credit exactly 100–700 ZP and produce one ledger entry each.
- Day 8–30 distribution uses the approved 35/34/30/1 basis-point buckets.
- Agent outcome creates exactly one 24-hour entitlement and is not silently converted into a paid rental.
- A missed UTC day resets to Day 1.
- Day 30 followed by the next eligible day starts a new Day 1 cycle.
- Same-day duplicate and concurrent claims grant once only and return the original outcome.
- Client-supplied player ID, date, streak day, amount, reward type, or odds are ignored/rejected.
- Failed currency or entitlement write rolls back the claim and streak-state update.
- Direct anon/authenticated writes and RPC execution are denied.
- Transaction history shows ZP credits; ZAP history is added only through the trusted ZAP ledger integration.

## 7. Decisions/prerequisites still open

These are not invented by this specification:
1. The exact draw method for the approved 1–10 whole-ZAP range; uniform selection is proposed.
2. Standard Box excludes ZAP. Premium Box has a 10% chance to award 1–10 whole ZAP. Free Agent 1 remains exclusive to the 1% Daily Streak outcome. A Fragment reward is available in Premium Boxes only, with a 10% prize chance. It is a 2× multiplier on the player's current Fragment Mining rate for six hours from activation. Standard Boxes do not contain this boost. It is not a fixed fragment amount; the extra mining output can contribute toward both unlocking new fragments and repairing damaged fragments. It follows the same no-stacking/no-extension rule as the approved boost. Both Standard and Premium Boxes may award one of ten ZP prizes: 100, 200, 300, 400, 500, 600, 700, 800, 900, or 1,000 ZP. Premium Box odds must favor higher ZP amounts compared with Standard Box odds. The exact probability assigned to each ZP amount in each tier remains unapproved and must not be invented. Premium retains separate 10% chances for its 1–10 whole-ZAP prize and its 2× Fragment Mining boost. Other box contents and odds still require approval. Tier selection remains 80% Standard / 20% Premium when a Daily Streak draw awards a box.
3. Boost rules are approved: 2× Fragment Mining for 6 hours from activation; no stacking and no extension of an active boost.
4. Agent 1 is the approved free mining-agent type. Starting the 24-hour clock on activation is recommended, pending confirmation.
5. A trusted ZAP wallet/ledger and credit RPC. Preview currently has no dedicated ZAP balance/ledger table.
6. The canonical boost, box, and temporary-agent entitlement model.
7. The ad provider will be supplied later; design an ad reward slot, but do not integrate a provider until selected.

No migration, database write, reward claim, Edge Function deployment, or Production change is authorized or performed by this specification commit.
