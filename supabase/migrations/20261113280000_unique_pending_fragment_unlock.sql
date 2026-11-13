-- Stage 5: enforce one pending unlock session per player and fragment.
-- begin_fragment_unlock already serializes on player_fragment_gameplay_state;
-- this partial unique index is a second line of defence at the database layer.
CREATE UNIQUE INDEX IF NOT EXISTS fragment_unlock_sessions_one_pending_per_fragment
  ON public.fragment_unlock_sessions (player_id, fragment_id)
  WHERE status = 'pending';
