-- Move player-owned RPC writes under RLS rather than using SECURITY DEFINER.
-- Each function remains callable by authenticated users but now runs with caller privileges.

create policy "Player read own profile"
  on public.players
  for select
  to authenticated
  using ((select auth.uid()) = id);

grant select (id, referral_code) on public.players to authenticated;

create policy "Player insert own game state"
  on public.player_game_states
  for insert
  to authenticated
  with check ((select auth.uid()) = player_id);

create policy "Player update own game state"
  on public.player_game_states
  for update
  to authenticated
  using ((select auth.uid()) = player_id)
  with check ((select auth.uid()) = player_id);

grant insert, update on public.player_game_states to authenticated;

create policy "creator_ops_submissions_insert_own"
  on public.creator_ops_submissions
  for insert
  to authenticated
  with check (player_id = (select auth.uid()));

grant insert on public.creator_ops_submissions to authenticated;

create policy "x_follow_submissions_insert_own"
  on public.x_follow_submissions
  for insert
  to authenticated
  with check (player_id = (select auth.uid()));

grant insert on public.x_follow_submissions to authenticated;

grant execute on function public.creator_ops_extract_content_id(text, text) to authenticated;

alter function public.save_player_game_state(jsonb, bigint) security invoker;
alter function public.submit_creator_ops_submission(text, text) security invoker;
alter function public.submit_x_follow_submission(text) security invoker;
