-- Stage 6: Intelligence Briefings
-- Preview-first schema. Admin and player access is mediated by trusted Edge Functions.

create table if not exists public.briefings (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null check (char_length(btrim(title)) between 3 and 120),
  summary text not null default '' check (char_length(summary) <= 500),
  category text not null default 'general',
  content jsonb not null default '[]'::jsonb check (jsonb_typeof(content) = 'array'),
  status text not null default 'draft' check (status in ('draft','published','archived')),
  access_mode text not null default 'open' check (access_mode in ('open','progressive')),
  prerequisite_briefing_id uuid references public.briefings(id) on delete set null,
  sort_order integer not null default 0,
  passing_score integer not null default 70 check (passing_score between 1 and 100),
  reward_type text not null default 'none' check (reward_type in ('none','zp','zap')),
  reward_amount numeric(20,4) not null default 0 check (reward_amount >= 0),
  published_at timestamptz,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint briefings_reward_consistency check (
    (reward_type = 'none' and reward_amount = 0) or
    (reward_type in ('zp','zap') and reward_amount > 0)
  ),
  constraint briefings_not_own_prerequisite check (prerequisite_briefing_id is null or prerequisite_briefing_id <> id)
);

create index if not exists briefings_player_listing_idx
  on public.briefings(status, access_mode, sort_order, published_at);

create table if not exists public.briefing_questions (
  id uuid primary key default gen_random_uuid(),
  briefing_id uuid not null references public.briefings(id) on delete cascade,
  prompt text not null check (char_length(btrim(prompt)) between 3 and 1000),
  options jsonb not null check (
    jsonb_typeof(options) = 'array' and
    jsonb_array_length(options) between 2 and 6
  ),
  correct_option_index integer not null check (correct_option_index >= 0),
  explanation text not null default '' check (char_length(explanation) <= 1000),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint briefing_question_correct_option_in_range
    check (correct_option_index < jsonb_array_length(options))
);

create index if not exists briefing_questions_order_idx
  on public.briefing_questions(briefing_id, sort_order);

create table if not exists public.briefing_progress (
  id uuid primary key default gen_random_uuid(),
  briefing_id uuid not null references public.briefings(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  status text not null default 'started' check (status in ('started','completed')),
  attempts integer not null default 0 check (attempts >= 0),
  best_score integer not null default 0 check (best_score between 0 and 100),
  started_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  completed_at timestamptz,
  unique (briefing_id, player_id),
  constraint briefing_progress_completion_consistency check (
    (status = 'started' and completed_at is null) or
    (status = 'completed' and completed_at is not null)
  )
);

create index if not exists briefing_progress_player_idx
  on public.briefing_progress(player_id, status, completed_at desc);

create table if not exists public.briefing_attempts (
  id uuid primary key default gen_random_uuid(),
  briefing_id uuid not null references public.briefings(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  score integer not null check (score between 0 and 100),
  passed boolean not null,
  answers jsonb not null check (jsonb_typeof(answers) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists briefing_attempts_player_idx
  on public.briefing_attempts(player_id, briefing_id, created_at desc);

alter table public.briefings enable row level security;
alter table public.briefing_questions enable row level security;
alter table public.briefing_progress enable row level security;
alter table public.briefing_attempts enable row level security;

revoke all on public.briefings, public.briefing_questions, public.briefing_progress, public.briefing_attempts from public, anon, authenticated;
grant select, insert, update, delete on public.briefings, public.briefing_questions, public.briefing_progress, public.briefing_attempts to service_role;

create or replace function public.submit_briefing_attempt(
  p_player_id uuid,
  p_briefing_id uuid,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_briefing public.briefings%rowtype;
  v_progress public.briefing_progress%rowtype;
  v_question_count integer;
  v_answer_count integer;
  v_correct_count integer;
  v_score integer;
  v_passed boolean;
  v_was_completed boolean;
  v_reward_balance numeric;
begin
  if p_player_id is null or p_briefing_id is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'Invalid briefing submission';
  end if;

  if not exists (select 1 from public.players where id = p_player_id) then
    raise exception 'Player profile not found';
  end if;

  select * into v_briefing
  from public.briefings
  where id = p_briefing_id and status = 'published'
  for share;

  if not found then
    raise exception 'Briefing is not available';
  end if;

  if v_briefing.prerequisite_briefing_id is not null and not exists (
    select 1 from public.briefing_progress
    where briefing_id = v_briefing.prerequisite_briefing_id
      and player_id = p_player_id and status = 'completed'
  ) then
    raise exception 'Complete the prerequisite briefing first';
  end if;

  select count(*) into v_question_count
  from public.briefing_questions where briefing_id = p_briefing_id;

  select count(*) into v_answer_count from jsonb_object_keys(p_answers);
  if v_question_count < 1 or v_answer_count <> v_question_count then
    raise exception 'Answer every question before submitting';
  end if;

  if exists (
    select 1
    from jsonb_each_text(p_answers) a
    left join public.briefing_questions q
      on q.id::text = a.key and q.briefing_id = p_briefing_id
    where q.id is null or a.value !~ '^[0-9]+$'
      or a.value::integer < 0
      or a.value::integer >= jsonb_array_length(q.options)
  ) then
    raise exception 'Submission contains an invalid answer';
  end if;

  insert into public.briefing_progress(briefing_id, player_id)
  values (p_briefing_id, p_player_id)
  on conflict (briefing_id, player_id) do nothing;

  select * into v_progress
  from public.briefing_progress
  where briefing_id = p_briefing_id and player_id = p_player_id
  for update;

  if v_progress.status = 'completed' then
    return jsonb_build_object(
      'success', true, 'alreadyCompleted', true,
      'score', v_progress.best_score, 'passed', true,
      'completedAt', v_progress.completed_at
    );
  end if;

  select count(*) filter (
    where q.correct_option_index = (p_answers ->> q.id::text)::integer
  ) into v_correct_count
  from public.briefing_questions q
  where q.briefing_id = p_briefing_id;

  v_score := floor((v_correct_count::numeric / v_question_count::numeric) * 100)::integer;
  v_passed := v_score >= v_briefing.passing_score;

  insert into public.briefing_attempts(briefing_id, player_id, score, passed, answers)
  values (p_briefing_id, p_player_id, v_score, v_passed, p_answers);

  update public.briefing_progress
  set attempts = attempts + 1,
      best_score = greatest(best_score, v_score),
      last_attempt_at = now(),
      status = case when v_passed then 'completed' else 'started' end,
      completed_at = case when v_passed then now() else null end
  where id = v_progress.id;

  if v_passed and v_briefing.reward_type = 'zp' and v_briefing.reward_amount > 0 then
    insert into public.player_economy(player_id) values (p_player_id)
    on conflict (player_id) do nothing;

    select zp_balance into v_reward_balance
    from public.player_economy where player_id = p_player_id for update;

    update public.player_economy
    set zp_balance = zp_balance + v_briefing.reward_amount,
        lifetime_zp = lifetime_zp + v_briefing.reward_amount,
        updated_at = now()
    where player_id = p_player_id
    returning zp_balance into v_reward_balance;

    insert into public.economy_ledger(
      player_id, transaction_type, amount, balance_after, reference_id, description
    ) values (
      p_player_id, 'briefing_reward', v_briefing.reward_amount,
      v_reward_balance, p_briefing_id::text, 'Intelligence briefing completion reward'
    );
  elsif v_passed and v_briefing.reward_type = 'zap' and v_briefing.reward_amount > 0 then
    insert into app_private.player_zap_wallets(player_id)
    values (p_player_id) on conflict (player_id) do nothing;

    select balance into v_reward_balance
    from app_private.player_zap_wallets where player_id = p_player_id for update;

    update app_private.player_zap_wallets
    set balance = balance + v_briefing.reward_amount,
        lifetime_earned = lifetime_earned + v_briefing.reward_amount,
        updated_at = now()
    where player_id = p_player_id
    returning balance into v_reward_balance;

    insert into app_private.zap_ledger(
      player_id, entry_type, amount, balance_after, source,
      source_reference, idempotency_key, description
    ) values (
      p_player_id, 'credit', v_briefing.reward_amount, v_reward_balance,
      'briefing_reward', p_briefing_id::text,
      'briefing:' || p_briefing_id::text || ':' || p_player_id::text,
      'Intelligence briefing completion reward'
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'alreadyCompleted', false,
    'score', v_score,
    'passed', v_passed,
    'completed', v_passed,
    'passingScore', v_briefing.passing_score,
    'rewardType', case when v_passed then v_briefing.reward_type else 'none' end,
    'rewardAmount', case when v_passed then v_briefing.reward_amount else 0 end
  );
end;
$$;

revoke all on function public.submit_briefing_attempt(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.submit_briefing_attempt(uuid, uuid, jsonb) to service_role;
