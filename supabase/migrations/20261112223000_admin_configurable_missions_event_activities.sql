-- Stage 6: admin-configurable missions and event activities.
-- Preview-only deployment is enforced by the repository workflow.
-- Existing mission IDs, descriptions, rewards and public availability are preserved.

-- Extend the existing mission registry without replacing legacy records.
alter table public.mission_tasks
  add column if not exists reward_currency text not null default 'ZP',
  add column if not exists unlock_cost_zp bigint not null default 0,
  add column if not exists status text not null default 'published',
  add column if not exists objectives jsonb not null default '[]'::jsonb,
  add column if not exists requirements jsonb not null default '[]'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.mission_tasks'::regclass
      and conname = 'mission_tasks_reward_currency_check'
  ) then
    alter table public.mission_tasks
      add constraint mission_tasks_reward_currency_check
      check (reward_currency in ('ZP', 'ZAP'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.mission_tasks'::regclass
      and conname = 'mission_tasks_unlock_cost_zp_check'
  ) then
    alter table public.mission_tasks
      add constraint mission_tasks_unlock_cost_zp_check
      check (unlock_cost_zp >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.mission_tasks'::regclass
      and conname = 'mission_tasks_status_check'
  ) then
    alter table public.mission_tasks
      add constraint mission_tasks_status_check
      check (status in ('draft', 'published', 'paused', 'archived'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.mission_tasks'::regclass
      and conname = 'mission_tasks_objectives_array_check'
  ) then
    alter table public.mission_tasks
      add constraint mission_tasks_objectives_array_check
      check (jsonb_typeof(objectives) = 'array');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.mission_tasks'::regclass
      and conname = 'mission_tasks_requirements_array_check'
  ) then
    alter table public.mission_tasks
      add constraint mission_tasks_requirements_array_check
      check (jsonb_typeof(requirements) = 'array');
  end if;
end
$$;

-- Existing rows retain their IDs and reward amounts; legacy reward is ZP.
update public.mission_tasks
set reward_currency = 'ZP'
where reward_currency is null;

-- Replace the broad public-read policy with published-only visibility.
drop policy if exists "Preview public read mission tasks" on public.mission_tasks;
drop policy if exists "Public can read published mission tasks" on public.mission_tasks;
create policy "Public can read published mission tasks"
  on public.mission_tasks
  for select
  to anon, authenticated
  using (status = 'published');

revoke insert, update, delete on public.mission_tasks from anon, authenticated;
grant select on public.mission_tasks to anon, authenticated;
grant select, insert, update, delete on public.mission_tasks to service_role;

create index if not exists mission_tasks_status_kind_idx
  on public.mission_tasks (status, kind, created_at desc);

-- Admin-configured activities belonging to an event. An activity may reference
-- a mission, or define a separately verifiable event activity.
create table if not exists public.game_event_activities (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.game_events(id) on delete cascade,
  mission_id text references public.mission_tasks(id) on delete restrict,
  activity_type text not null default 'mission'
    check (activity_type in (
      'mission',
      'creator_submission_approved',
      'referral_registration',
      'telegram_membership',
      'gameplay_verification',
      'admin_review'
    )),
  title text not null check (length(btrim(title)) between 1 and 120),
  description text not null default '',
  instructions text not null default '',
  config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(config) = 'object'),
  is_required boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint game_event_activities_mission_type_check
    check (
      (activity_type = 'mission' and mission_id is not null)
      or
      (activity_type <> 'mission' and mission_id is null)
    )
);

create index if not exists game_event_activities_event_order_idx
  on public.game_event_activities (event_id, sort_order, created_at);

create index if not exists game_event_activities_mission_idx
  on public.game_event_activities (mission_id)
  where mission_id is not null;

alter table public.game_event_activities enable row level security;
revoke all on public.game_event_activities from anon, authenticated;
grant select, insert, update, delete on public.game_event_activities to service_role;

comment on column public.mission_tasks.reward_currency is
  'Configured reward currency. ZAP payouts remain disabled until Stage 7 wallet accounting is implemented.';
comment on column public.mission_tasks.unlock_cost_zp is
  'ZP required to unlock a mission. A positive value must be charged atomically by a trusted backend function.';
comment on table public.game_event_activities is
  'Admin-configured event activities. Completion and rewards require trusted server-side verification.';
