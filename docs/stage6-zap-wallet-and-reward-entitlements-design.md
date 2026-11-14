# Stage 6 Shared ZAP Wallet and Reward Entitlements — Architecture Design

Status: Design proposal only. No schema, migration, data, balance, deployment, or Production changes.
Target: Supabase Preview project `lchkctclxzwwvfwosava`; active branch `security/trusted-gameplay-migration`.

## 1. Goals

Build one authoritative backend foundation that can safely serve:
- Daily Streak rewards.
- Mystery Discovery rewards.
- Expeditions and other approved community activities.
- Future approved ZAP earning and spending flows.

The design must prevent duplicate credits, client-side balance manipulation, reward rerolls on retries, entitlement duplication, and confusion between earned rewards and paid agent rentals.

## 2. Verified current-state constraints

Read-only Preview inspection confirms:
- `player_economy` currently stores ZP fields only: `zp_balance`, `lifetime_zp`, and `pending_kickback`.
- `economy_ledger` stores generic numeric transactions with `player_id`, `transaction_type`, `amount`, `balance_after`, optional `reference_id`, and `description`; it is the existing ZP history path.
- `service_role` has SELECT on `player_economy` and `economy_ledger`; the inspected grants did not show client write grants.
- `player_agent_rentals` represents agent rentals and has a required `last_payment_intent_id`. It is not suitable for a free reward without weakening or misrepresenting the paid-rental model.
- `agent_rental_payment_intents` records payment intents and defaults to GRAM/mainnet. It must not be used for free reward grants.
- Existing event tables have a `reward_zap` field, but this does not establish that a player ZAP wallet or ZAP ledger exists.
- No dedicated ZAP wallet/ledger, boost inventory, or Mystery Box inventory was found in the previously inspected Preview public tables.

## 3. Proposed architecture

Use separate, purpose-built components:

1. **ZAP wallet** — one authoritative spendable balance per player.
2. **ZAP ledger** — immutable record of every ZAP credit, debit, reversal, and adjustment.
3. **Reward grant/entitlement ledger** — immutable record of non-currency rewards and their lifecycle.
4. **Reward catalog/configuration** — versioned server-side definitions for reward pools, amounts, expiry and activation rules.
5. **Trusted reward RPCs** — atomic database functions invoked only by authenticated Edge Functions or tightly controlled service-role workflows.
6. **Read APIs** — authenticated, player-scoped balance, ledger and entitlement views.

Daily Streak and Mystery Discovery must call shared grant primitives rather than each implementing their own wallet writes.

## 4. Proposed database objects

Names below are design names, not existing Preview objects. Exact names and constraints should be checked against the full migration history before implementation.

### 4.1 `player_zap_wallets`

One row per player:
- `player_id uuid primary key references players(id)`.
- `balance numeric not null default 0 check (balance >= 0)`.
- `lifetime_earned numeric not null default 0 check (lifetime_earned >= 0)`.
- `lifetime_spent numeric not null default 0 check (lifetime_spent >= 0)`.
- `created_at`, `updated_at`.

The wallet is a materialized current balance for fast reads. It is not the audit source of truth; the append-only ledger is.

### 4.2 `zap_ledger`

Append-only financial audit trail:
- `id uuid primary key`.
- `player_id uuid not null references players(id)`.
- `entry_type text not null`: constrained values such as `credit`, `debit`, `reversal`, `admin_adjustment`.
- `amount numeric not null check (amount > 0)`; direction is represented by entry_type, not a negative amount.
- `balance_after numeric not null check (balance_after >= 0)`.
- `source text not null`: e.g. `daily_streak`, `mystery_discovery`, `expedition`, `approved_transfer`.
- `source_reference uuid/text not null`: stable reference to the originating claim, expedition award or transfer.
- `idempotency_key text not null`.
- `description text`.
- `created_at timestamptz not null default now()`.
- Unique constraint on `(player_id, idempotency_key)`; unique source reference where the business rule requires one grant per source.
- No UPDATE/DELETE for application roles. Corrections use a new reversal/adjustment entry referencing the original.

Store ZAP as whole units only. The approved Daily Streak ZAP reward range is a random whole-number amount from 1 to 10 ZAP.

### 4.3 `player_reward_entitlements`

Represents non-currency rewards that a player owns or can activate:
- `id uuid primary key`.
- `player_id uuid not null references players(id)`.
- `reward_type text not null`: `boost`, `mystery_box`, `temporary_mining_agent`, and future explicitly approved types.
- `reward_code text not null`: stable catalog identifier, not client-authored.
- `source text not null`: `daily_streak`, `mystery_discovery`, `expedition`, etc.
- `source_reference text not null`: claim/grant reference.
- `status text not null`: `available`, `reserved`, `active`, `consumed`, `expired`, `revoked`.
- `granted_at timestamptz not null`.
- `available_until timestamptz` for an unclaimed/unused entitlement when applicable.
- `activated_at timestamptz`, `expires_at timestamptz` for timed effects.
- `metadata jsonb not null default '{}'` for immutable server-generated details, e.g. box tier or approved boost code.
- Unique idempotency/source key to prevent duplicate grants.
- State transitions enforced in trusted RPCs; clients cannot directly modify status, metadata or expiry.

Do not make all rewards immediately expire. For example, a Mystery Box can remain available until opened, while a six-hour boost's timer should begin at activation if that is the approved behavior.

### 4.4 Reward catalog and configuration

Use versioned server-side configuration, not hardcoded UI values:
- Reward pool ID and version.
- Reward code/type.
- Integer weight/basis points.
- Amount bounds and duration.
- Enabled flag and effective dates.
- Box tier and its own versioned contents/odds.
- Agent type/eligibility and expiry behavior.

Published versions should be immutable. Changing odds creates a new version and preserves the version used for every past draw.

Never expose unpublished weights or privileged configuration mutation to player clients. The UI can display the published odds and reward descriptions.

### 4.5 Source claim records

Daily Streak claims should retain a unique `(player_id, claim_date_utc)` constraint and an immutable selected outcome. Mystery Discovery should use unique per-player/per-UTC-day slots for the free opening and ad-unlocked opening. Expeditions should reference a unique verified completion/award ID.

The originating claim record and its ZAP ledger or entitlement grant must be committed atomically.

## 5. Atomic ZAP grant and spend rules

### Credit
One trusted database function should:
1. Validate the trusted source and positive whole-ZAP amount against server-side rules.
2. Lock the player's wallet row (`SELECT ... FOR UPDATE`).
3. Check the idempotency key.
4. If already applied, return the original ledger result without another credit.
5. Increase wallet balance and lifetime earned.
6. Insert one immutable `zap_ledger` credit with the resulting balance.
7. Commit together.

### Debit
One trusted function should:
1. Lock the wallet row.
2. Check idempotency.
3. Reject if balance is insufficient.
4. Decrease balance and update lifetime spent.
5. Insert one immutable debit entry.
6. Commit atomically.

Never allow clients to set wallet balance or insert ledger rows. Avoid direct wallet UPDATE grants even to the Edge Function's service-role client; route mutations through narrowly scoped SECURITY DEFINER functions with pinned `search_path`, strict validation and execute grants limited to `service_role`.

### Reconciliation
Provide a read-only reconciliation query/job that compares each wallet balance with the sum of its ledger entries. Alert on any mismatch. Do not automatically overwrite balances during reconciliation.

## 6. Entitlement lifecycle

- **Grant:** created atomically with the originating reward claim.
- **Available:** visible in the player's inventory.
- **Activate/open:** performed through a trusted action that locks the entitlement and checks status/expiry.
- **Active:** timed effects have server-owned `activated_at` and `expires_at`.
- **Consumed/expired:** terminal states; a repeated request returns the existing result and never grants a second effect.
- **Revoked:** only through a privileged audited operation, with a reason.

### Boosts
A boost grant is an entitlement, not a currency credit. The approved effect is 2× Fragment Mining for six hours. Approved activation policy: start the six-hour timer when the player activates the boost. Boosts do not stack and do not extend an already active boost. The backend must apply the effect server-side and must not let the client alter mining rates.

### Mystery Boxes
A box is an entitlement to open a versioned reward pool. Opening it is a separate idempotent server operation that selects and grants exactly one outcome atomically. For a Daily Streak Mystery Box outcome, select Standard with 80% probability and Premium with 20% probability. Standard Boxes exclude ZAP; Premium Boxes have an approved 10% ZAP prize chance (1–10 whole ZAP). Both box tiers exclude temporary Agent 1 access. ZAP may be awarded through the approved Daily Streak outcome and the approved Premium Box prize; other ZAP sources still require separate approval. The free 24-hour Agent 1 reward remains exclusive to its Daily Streak outcome. Fragment rewards in either box tier may be used both to unlock new fragments and to repair damaged fragments. The exact fragment amount, selection rules, and individual prize odds remain unapproved and must not be invented.

### Free 24-hour mining agent
Keep this distinct from paid `player_agent_rentals` and `agent_rental_payment_intents`. Grant a `temporary_mining_agent` entitlement, then activate through a trusted agent-entitlement service. The approved eligible agent is Agent 1. Recommended timer policy (not yet explicitly approved): start the 24-hour timer when the player activates the entitlement. It must not create a payment intent, fabricate a payment reference, or imply that the player paid.

## 7. Daily Streak integration

- Days 1–7: use the existing trusted ZP economy credit path and `economy_ledger`, with the streak claim and credit in one transaction.
- Days 8–30: select one reward using the published 35/34/30/1 pool (3500/3400/3000/100 basis points).
- ZAP outcome: call the shared atomic ZAP credit function for 1–10 whole ZAP.
- Boost, Mystery Box, and temporary mining agent outcomes: create one corresponding entitlement.
- Persist the selected pool version and outcome before returning success.
- A retry returns the same result; it never redraws.
- If a required wallet or entitlement service is unavailable, roll back the claim instead of recording an unfulfilled reward.

For the 1–10 ZAP amount, uniform selection across the ten whole-number values is the proposed draw rule. The 35% is the chance of the ZAP outcome, not an amount multiplier.

## 8. Access control and API boundaries

- Enable RLS on all player-facing tables.
- Authenticated users may read only their own wallet/ledger/entitlements through safe policies or scoped read RPCs.
- Revoke direct INSERT/UPDATE/DELETE from `anon` and `authenticated`.
- Service-role reads should be narrowly scoped; do not grant broad client access.
- Mutations only through SECURITY DEFINER functions with `SET search_path = pg_catalog, public, pg_temp` (or a stricter explicit path), qualified object names, and execute privileges revoked from `PUBLIC`, `anon`, and `authenticated`.
- Edge Functions validate bearer tokens with `auth.getUser()` and derive player identity server-side.
- Never accept player ID, balance, amount, reward type, odds, claim date, expiry, or ledger balance from the client.
- Keep secrets and service-role credentials server-side.
- Every privileged administrative adjustment needs actor identity, reason, and immutable audit history.

## 9. Migration and rollout sequence (not executed)

1. Recheck branch migration history and current Preview schema for name collisions.
2. Add wallet, ledger, entitlement and catalog structures with constraints/RLS/privileges.
3. Add narrowly scoped trusted ZAP credit/debit and entitlement grant/activation RPCs.
4. Add read-only authenticated wallet/ledger/inventory API.
5. Add reconciliation tests and database permission tests.
6. Integrate Daily Streak claims after its prerequisites are complete.
7. Integrate Mystery Discovery only after box pool/odds and ad verification are specified.
8. Integrate Expeditions only after eligibility/progress/completion rules are defined.
9. Run Preview-only tests with synthetic fixtures; do not create real player reward claims or balance changes.
10. Enable player-facing controls only after explicit approval and verified end-to-end tests.

Each migration application, database mutation, Edge Function source change/deployment and Production change requires the appropriate explicit approval. This document itself authorizes none of those operations.

## 10. Decisions required before implementation

1. **ZAP precision — approved:** whole ZAP only.
2. **Daily Streak ZAP amount — approved:** random whole-number amount from 1 to 10 ZAP. Uniform selection across the ten values is proposed.
3. **Boost — approved:** 2× Fragment Mining for six hours, timer starts on activation, no stacking and no extension of an active boost.
4. **Mystery Box tier selection — approved:** 80% Standard / 20% Premium when a Streak draw awards a box. The remaining non-ZAP Premium Box contents and odds, and all Standard Box contents and odds, remain open and must be approved separately.
5. **Temporary mining agent — partly approved:** Agent 1 is the eligible type. Starting its 24-hour timer on activation remains a recommended policy, but is not yet explicitly approved.
6. **Ad unlock — deferred:** an advertising reward area is planned; the user will provide the ad provider later. Require a server-verifiable completion callback when selected; a client-side button or assertion is not proof of a completed view.
7. **ZAP funding policy — approved:** working agents generate ZP only and never ZAP. Other ZAP credit sources must be explicitly approved.

## 11. Explicitly out of scope

- No changes to existing ZP balances or ledger rows.
- No ZAP issuance or conversion activation.
- No new ZAP transfer/payment behavior.
- No paid agent rental changes.
- No Mystery Discovery activation or ad integration.
- No Expedition ZAP awards until the rules and verification requirements are approved.
- No migration, deployment, real reward claim, or Production change.
