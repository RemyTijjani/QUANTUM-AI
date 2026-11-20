-- Expedition management schema for QUANTUM-AI / ZORD.
-- Applied to the Supabase Preview project only.
-- Existing game_events and participation data are intentionally preserved.

create table public.expeditions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (length(btrim(slug)) between 2 and 100),
  title text not null check (length(btrim(title)) between 1 and 160),
  description text not null default '',
  cover_image_url text,
  category text not null check (category in ('open','progressive','seasonal','community','competitive','team','special_limited_time')),
  access_mode text not null default 'open' check (access_mode in ('open','progressive')),
  prerequisite_expedition_id uuid references public.expeditions(id) on delete restrict,
  participation_mode text not null default 'both' check (participation_mode in ('solo','team','both')),
  status text not null default 'draft' check (status in ('draft','scheduled','registration_open','active','paused','completed','closed','cancelled')),
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text not null default 'UTC',
  min_team_size integer not null default 2 check (min_team_size between 2 and 100),
  max_team_size integer not null default 5 check (max_team_size between 2 and 100),
  min_individual_contributions integer not null default 1 check (min_individual_contributions >= 0),
  require_shared_team_objectives boolean not null default true,
  cancellation_reason text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expeditions_valid_schedule check (starts_at is null or ends_at is null or ends_at > starts_at),
  constraint expeditions_valid_team_size check (max_team_size >= min_team_size),
  constraint expeditions_progressive_prerequisite check (
    (access_mode = 'open' and prerequisite_expedition_id is null)
    or access_mode = 'progressive'
  )
);

create table public.expedition_objectives (
  id uuid primary key default gen_random_uuid(),
  expedition_id uuid not null references public.expeditions(id) on delete cascade,
  objective_type text not null check (objective_type in ('briefing','quiz','game','community','external','milestone')),
  title text not null check (length(btrim(title)) between 1 and 160),
  description text not null default '',
  instructions text not null default '',
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  is_required boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (expedition_id, id),
  unique (expedition_id, sort_order)
);

create table public.expedition_teams (
  id uuid primary key default gen_random_uuid(),
  expedition_id uuid not null references public.expeditions(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  invite_code text not null unique,
  leader_player_id uuid not null references public.players(id) on delete restrict,
  status text not null default 'active' check (status in ('active','disbanded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (expedition_id, id)
);

create table public.expedition_team_members (
  id uuid primary key default gen_random_uuid(),
  expedition_id uuid not null,
  team_id uuid not null,
  player_id uuid not null references public.players(id) on delete restrict,
  role text not null default 'member' check (role in ('leader','member')),
  membership_status text not null default 'active' check (membership_status in ('active','left','removed')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  created_at timestamptz not null default now(),
  constraint expedition_team_members_team_fk
    foreign key (expedition_id, team_id)
    references public.expedition_teams(expedition_id, id) on delete cascade,
  unique (expedition_id, player_id),
  unique (team_id, player_id),
  check ((membership_status = 'active' and left_at is null) or membership_status <> 'active')
);

create table public.expedition_participations (
  id uuid primary key default gen_random_uuid(),
  expedition_id uuid not null references public.expeditions(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete restrict,
  team_id uuid,
  status text not null default 'registered' check (status in ('registered','in_progress','completed','eligible','ineligible','withdrawn')),
  individual_contribution_count integer not null default 0 check (individual_contribution_count >= 0),
  reward_eligible boolean not null default false,
  registered_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (expedition_id, team_id)
    references public.expedition_teams(expedition_id, id) on delete restrict,
  unique (expedition_id, player_id)
);

create table public.expedition_objective_progress (
  id uuid primary key default gen_random_uuid(),
  expedition_id uuid not null,
  objective_id uuid not null,
  player_id uuid not null references public.players(id) on delete restrict,
  team_id uuid,
  status text not null default 'not_started' check (status in ('not_started','in_progress','submitted','verified','rejected')),
  contribution_count integer not null default 0 check (contribution_count >= 0),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  verified_by text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (expedition_id, objective_id)
    references public.expedition_objectives(expedition_id, id) on delete cascade,
  foreign key (expedition_id, team_id)
    references public.expedition_teams(expedition_id, id) on delete restrict,
  unique (objective_id, player_id)
);

create table public.expedition_team_objective_progress (
  id uuid primary key default gen_random_uuid(),
  expedition_id uuid not null,
  objective_id uuid not null,
  team_id uuid not null,
  status text not null default 'not_started' check (status in ('not_started','in_progress','submitted','verified','rejected')),
  contribution_count integer not null default 0 check (contribution_count >= 0),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  verified_by text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (expedition_id, objective_id)
    references public.expedition_objectives(expedition_id, id) on delete cascade,
  foreign key (expedition_id, team_id)
    references public.expedition_teams(expedition_id, id) on delete cascade,
  unique (objective_id, team_id)
);

create table public.expedition_rewards (
  id uuid primary key default gen_random_uuid(),
  expedition_id uuid not null unique references public.expeditions(id) on delete cascade,
  reward_type text not null default 'none' check (reward_type in ('none','zp','zap')),
  amount numeric(20,6) not null default 0 check (amount >= 0),
  recipient_scope text not null default 'each_eligible_participant'
    check (recipient_scope in ('each_eligible_participant','each_eligible_team_member')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((reward_type = 'none' and amount = 0) or (reward_type <> 'none' and amount > 0))
);

create table public.expedition_reward_issuances (
  id uuid primary key default gen_random_uuid(),
  expedition_id uuid not null references public.expeditions(id) on delete restrict,
  reward_id uuid not null references public.expedition_rewards(id) on delete restrict,
  player_id uuid not null references public.players(id) on delete restrict,
  reward_type text not null check (reward_type in ('zp','zap')),
  amount numeric(20,6) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending','issued','failed','voided')),
  idempotency_key text not null unique,
  ledger_reference text,
  issued_at timestamptz,
  created_at timestamptz not null default now(),
  unique (reward_id, player_id)
);

create table public.expedition_audit_log (
  id uuid primary key default gen_random_uuid(),
  expedition_id uuid references public.expeditions(id) on delete set null,
  actor text not null,
  action text not null check (length(btrim(action)) between 1 and 100),
  reason text,
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index expedition_objectives_expedition_sort_idx on public.expedition_objectives(expedition_id, sort_order);
create index expedition_teams_expedition_status_idx on public.expedition_teams(expedition_id, status);
create index expedition_team_members_team_status_idx on public.expedition_team_members(team_id, membership_status);
create index expedition_participations_expedition_status_idx on public.expedition_participations(expedition_id, status);
create index expedition_participations_player_idx on public.expedition_participations(player_id, registered_at desc);
create index expedition_objective_progress_player_idx on public.expedition_objective_progress(player_id, updated_at desc);
create index expedition_audit_log_expedition_created_idx on public.expedition_audit_log(expedition_id, created_at desc);

create or replace function public.enforce_expedition_team_membership_lock()
returns trigger language plpgsql set search_path = ''
as $$
declare
  v_expedition_id uuid;
  v_status text;
begin
  v_expedition_id := coalesce(new.expedition_id, old.expedition_id);
  select e.status into v_status from public.expeditions e
  where e.id = v_expedition_id for key share;
  if v_status is null then raise exception 'Expedition not found'; end if;
  if v_status in ('active','paused','completed','closed','cancelled') then
    raise exception 'Team membership is locked after an expedition starts';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.set_expedition_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger expedition_team_membership_lock
before insert or update or delete on public.expedition_team_members
for each row execute function public.enforce_expedition_team_membership_lock();

create trigger expeditions_set_updated_at before update on public.expeditions
for each row execute function public.set_expedition_updated_at();
create trigger expedition_objectives_set_updated_at before update on public.expedition_objectives
for each row execute function public.set_expedition_updated_at();
create trigger expedition_teams_set_updated_at before update on public.expedition_teams
for each row execute function public.set_expedition_updated_at();
create trigger expedition_participations_set_updated_at before update on public.expedition_participations
for each row execute function public.set_expedition_updated_at();
create trigger expedition_objective_progress_set_updated_at before update on public.expedition_objective_progress
for each row execute function public.set_expedition_updated_at();
create trigger expedition_team_objective_progress_set_updated_at before update on public.expedition_team_objective_progress
for each row execute function public.set_expedition_updated_at();
create trigger expedition_rewards_set_updated_at before update on public.expedition_rewards
for each row execute function public.set_expedition_updated_at();

alter table public.expeditions enable row level security;
alter table public.expedition_objectives enable row level security;
alter table public.expedition_teams enable row level security;
alter table public.expedition_team_members enable row level security;
alter table public.expedition_participations enable row level security;
alter table public.expedition_objective_progress enable row level security;
alter table public.expedition_team_objective_progress enable row level security;
alter table public.expedition_rewards enable row level security;
alter table public.expedition_reward_issuances enable row level security;
alter table public.expedition_audit_log enable row level security;

revoke all on public.expeditions, public.expedition_objectives, public.expedition_teams,
  public.expedition_team_members, public.expedition_participations,
  public.expedition_objective_progress, public.expedition_team_objective_progress,
  public.expedition_rewards, public.expedition_reward_issuances,
  public.expedition_audit_log from anon, authenticated;
grant all on public.expeditions, public.expedition_objectives, public.expedition_teams,
  public.expedition_team_members, public.expedition_participations,
  public.expedition_objective_progress, public.expedition_team_objective_progress,
  public.expedition_rewards, public.expedition_reward_issuances,
  public.expedition_audit_log to service_role;

revoke execute on function public.enforce_expedition_team_membership_lock() from public, anon, authenticated;
revoke execute on function public.set_expedition_updated_at() from public, anon, authenticated;
