-- The legacy client snapshot is no longer used by the frontend.
-- Official ZP, ZAP, Fragment progress, referrals, and rentals live in
-- server-authoritative tables. Preserve historical snapshot rows, but prevent
-- clients from reading or mutating this non-authoritative JSON state.

ALTER TABLE public.player_game_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Player insert own game state" ON public.player_game_states;
DROP POLICY IF EXISTS "Player update own game state" ON public.player_game_states;
DROP POLICY IF EXISTS "Preview read own game state" ON public.player_game_states;

REVOKE ALL PRIVILEGES ON TABLE public.player_game_states
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.save_player_game_state(jsonb, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_player_game_state(jsonb, bigint)
  TO service_role;

COMMENT ON TABLE public.player_game_states IS
  'Legacy client game snapshots retained for historical compatibility; not authoritative and not accessible to client roles.';
