-- Stage 5: manual X Follow submissions and Admin review.
-- Players submit only their X username or profile URL. Admin review is separate
-- from Creator Ops and awards the existing 250 ZP exactly once on approval.

create table if not exists public.x_follow_submissions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  x_username text not null
    check (x_username ~ '^[a-z0-9_]{1,15}$'),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  reward_zp integer not null default 250
    check (reward_zp = 250),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  rejection_reason text,
  constraint x_follow_review_state_consistent check (
    (status = 'pending' and reviewed_at is null and reviewed_by is null)
    or
    (status in ('approved', 'rejected') and reviewed_at is not null and reviewed_by is not null)
  )
);

create index if not exists x_follow_submissions_player_created_idx
  on public.x_follow_submissions (player_id, created_at desc);

create unique index if not exists x_follow_one_pending_per_player
  on public.x_follow_submissions (player_id)
  where status = 'pending';

create unique index if not exists x_follow_one_approved_per_player
  on public.x_follow_submissions (player_id)
  where status = 'approved';

alter table public.x_follow_submissions enable row level security;

revoke all on public.x_follow_submissions from public, anon, authenticated;
grant select on public.x_follow_submissions to authenticated;
grant select, insert, update, delete on public.x_follow_submissions to service_role;

create policy x_follow_submissions_select_own
  on public.x_follow_submissions
  for select
  to authenticated
  using (player_id = (select auth.uid()));

comment on table public.x_follow_submissions is
  'Manual X Follow mission submissions. Players can read their own status; inserts and review decisions use dedicated RPCs.';

create or replace function public.submit_x_follow_submission(p_x_account text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_player_id uuid := auth.uid();
  v_account text := lower(btrim(coalesce(p_x_account, '')));
  v_submission public.x_follow_submissions%rowtype;
begin
  if v_player_id is null then
    raise exception 'Authentication required';
  end if;

  if v_account ~* '^https?://' then
    if v_account !~* '^https?://(www\.)?(x\.com|twitter\.com)/' then
      raise exception 'Enter an X username or an X profile link';
    end if;
    v_account := regexp_replace(
      v_account,
      '^https?://(www\.)?(x\.com|twitter\.com)/',
      '',
      'i'
    );
    v_account := regexp_replace(v_account, '[/#?].*$', '');
  end if;

  v_account := regexp_replace(v_account, '^@', '');
  v_account := lower(v_account);

  if v_account !~ '^[a-z0-9_]{1,15}$' then
    raise exception 'Enter a valid X username (letters, numbers, or underscores; up to 15 characters)';
  end if;

  if not exists (
    select 1
    from public.players p
    where p.id = v_player_id
  ) then
    raise exception 'Player profile not found';
  end if;

  if not exists (
    select 1
    from public.mission_tasks mt
    where mt.id = 'follow-signal'
      and mt.kind = 'social'
      and mt.status = 'published'
      and mt.reward = 250
      and mt.reward_currency = 'ZP'
      and mt.action_url = 'https://x.com/zord_agent'
  ) then
    raise exception 'X Follow mission is not available';
  end if;

  if exists (
    select 1 from public.x_follow_submissions s
    where s.player_id = v_player_id
      and s.status = 'approved'
  ) then
    raise exception 'X Follow reward has already been claimed';
  end if;

  insert into public.x_follow_submissions (player_id, x_username)
  values (v_player_id, v_account)
  on conflict (player_id) where status = 'pending'
  do nothing
  returning * into v_submission;

  if not found then
    raise exception 'You already have a pending X Follow submission';
  end if;

  return jsonb_build_object(
    'success', true,
    'submissionId', v_submission.id,
    'xUsername', v_submission.x_username,
    'status', v_submission.status,
    'createdAt', v_submission.created_at
  );
end;
$function$;

revoke all on function public.submit_x_follow_submission(text)
  from public, anon;
grant execute on function public.submit_x_follow_submission(text)
  to authenticated, service_role;

create or replace function public.admin_review_x_follow_submission(
  p_submission_id uuid,
  p_decision text,
  p_admin_username text,
  p_rejection_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_submission public.x_follow_submissions%rowtype;
  v_economy public.player_economy%rowtype;
  v_reward integer := 250;
  v_new_zp numeric;
  v_new_lifetime numeric;
  v_reference text;
begin
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'Invalid review decision';
  end if;

  if p_admin_username is null
     or btrim(p_admin_username) = ''
     or length(btrim(p_admin_username)) > 100 then
    raise exception 'Admin identity is required for review';
  end if;

  select *
    into v_submission
    from public.x_follow_submissions
    where id = p_submission_id
    for update;

  if not found then
    raise exception 'X Follow submission not found';
  end if;

  if v_submission.status is distinct from 'pending' then
    raise exception 'X Follow submission has already been reviewed';
  end if;

  if p_decision = 'rejected' then
    update public.x_follow_submissions
      set status = 'rejected',
          reviewed_at = now(),
          reviewed_by = btrim(p_admin_username),
          rejection_reason = nullif(left(btrim(coalesce(p_rejection_reason, '')), 500), '')
      where id = p_submission_id;

    return jsonb_build_object(
      'success', true,
      'decision', 'rejected',
      'submissionId', p_submission_id,
      'rewardZp', 0
    );
  end if;

  if exists (
    select 1
    from public.x_follow_submissions s
    where s.player_id = v_submission.player_id
      and s.status = 'approved'
      and s.id <> v_submission.id
  ) then
    raise exception 'This player has already received the X Follow reward';
  end if;

  if not exists (
    select 1
    from public.mission_tasks mt
    where mt.id = 'follow-signal'
      and mt.kind = 'social'
      and mt.status = 'published'
      and mt.reward = v_reward
      and mt.reward_currency = 'ZP'
      and mt.action_url = 'https://x.com/zord_agent'
  ) then
    raise exception 'X Follow mission reward configuration has changed';
  end if;

  select *
    into v_economy
    from public.player_economy
    where player_id = v_submission.player_id
    for update;

  if not found then
    raise exception 'Player economy record not found';
  end if;

  v_reference := 'x_follow:' || p_submission_id::text;

  if exists (
    select 1 from public.economy_ledger l
    where l.reference_id = v_reference
  ) then
    raise exception 'X Follow reward ledger entry already exists';
  end if;

  v_new_zp := coalesce(v_economy.zp_balance, 0) + v_reward;
  v_new_lifetime := coalesce(v_economy.lifetime_zp, 0) + v_reward;

  update public.player_economy
    set zp_balance = v_new_zp,
        lifetime_zp = v_new_lifetime,
        updated_at = now()
    where player_id = v_submission.player_id;

  insert into public.economy_ledger (
    player_id, transaction_type, amount,
    balance_after, reference_id, description
  ) values (
    v_submission.player_id,
    'x_follow_reward',
    v_reward,
    v_new_zp,
    v_reference,
    'Approved manual X Follow mission: @' || v_submission.x_username
  );

  update public.x_follow_submissions
    set status = 'approved',
        reviewed_at = now(),
        reviewed_by = btrim(p_admin_username),
        rejection_reason = null
    where id = p_submission_id;

  return jsonb_build_object(
    'success', true,
    'decision', 'approved',
    'submissionId', p_submission_id,
    'playerId', v_submission.player_id,
    'xUsername', v_submission.x_username,
    'rewardZp', v_reward,
    'balanceAfter', v_new_zp,
    'reviewedAt', now(),
    'reviewedBy', btrim(p_admin_username)
  );
end;
$function$;

revoke all on function public.admin_review_x_follow_submission(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_review_x_follow_submission(uuid, text, text, text)
  to service_role;
