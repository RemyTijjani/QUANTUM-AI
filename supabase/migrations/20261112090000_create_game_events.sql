-- Stage 6: persistent event registry for the protected Super Admin dashboard.
-- Events are managed through the service-role-backed admin API only.
create table if not exists public.game_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 120),
  description text not null default '',
  category text not null check (category in ('daily', 'weekly', 'monthly', 'special')),
  status text not null default 'draft' check (status in ('draft', 'published', 'cancelled')),
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text not null default 'UTC',
  reward_zp bigint not null default 0 check (reward_zp >= 0),
  reward_zap bigint not null default 0 check (reward_zap >= 0),
  objectives jsonb not null default '[]'::jsonb check (jsonb_typeof(objectives) = 'array'),
  requirements jsonb not null default '[]'::jsonb check (jsonb_typeof(requirements) = 'array'),
  participation_rules jsonb not null default '{}'::jsonb check (jsonb_typeof(participation_rules) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  cancelled_at timestamptz,
  constraint game_events_valid_schedule check (
    starts_at is null or ends_at is null or starts_at < ends_at
  )
);

alter table public.game_events add column if not exists reward_zap bigint not null default 0 check (reward_zap >= 0);

create index if not exists game_events_status_schedule_idx
  on public.game_events (status, starts_at, ends_at);

alter table public.game_events enable row level security;

revoke all on public.game_events from anon, authenticated;
grant select, insert, update, delete on public.game_events to service_role;
