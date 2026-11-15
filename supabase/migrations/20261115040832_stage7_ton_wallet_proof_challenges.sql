-- Stage 7 TON wallet proof challenges. Service-role only; no wallet or balance changes.
create table if not exists app_private.ton_wallet_proof_challenges (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  payload_hash text not null unique check (payload_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);
create index if not exists ton_wallet_proof_challenges_player_created_idx
  on app_private.ton_wallet_proof_challenges(player_id, created_at desc);
create index if not exists ton_wallet_proof_challenges_expiry_idx
  on app_private.ton_wallet_proof_challenges(expires_at)
  where consumed_at is null;
alter table app_private.ton_wallet_proof_challenges enable row level security;
revoke all on app_private.ton_wallet_proof_challenges from public, anon, authenticated;
grant all on app_private.ton_wallet_proof_challenges to service_role;
