-- Assign each ZORD player a stable, randomly generated public entity number.
-- Existing accounts are backfilled once; new accounts receive a number in the
-- database so it cannot be chosen or spoofed by the client.

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS entity_number integer;

DO $backfill$
DECLARE
  v_player record;
  v_number integer;
BEGIN
  PERFORM pg_advisory_xact_lock(741852963);

  FOR v_player IN
    SELECT id
    FROM public.players
    WHERE entity_number IS NULL
    ORDER BY id
  LOOP
    LOOP
      v_number := 10000000 + floor(random() * 90000000)::integer;
      EXIT WHEN NOT EXISTS (
        SELECT 1
        FROM public.players
        WHERE entity_number = v_number
      );
    END LOOP;

    UPDATE public.players
    SET entity_number = v_number
    WHERE id = v_player.id;
  END LOOP;
END;
$backfill$;

ALTER TABLE public.players
  ALTER COLUMN entity_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_players_entity_number
  ON public.players (entity_number);

CREATE OR REPLACE FUNCTION public.assign_player_entity_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_number integer;
BEGIN
  IF NEW.entity_number IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Serialize assignment to make the collision check reliable under
  -- simultaneous account registrations.
  PERFORM pg_advisory_xact_lock(741852963);

  LOOP
    v_number := 10000000 + floor(random() * 90000000)::integer;
    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.players
      WHERE entity_number = v_number
    );
  END LOOP;

  NEW.entity_number := v_number;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS players_assign_entity_number ON public.players;
CREATE TRIGGER players_assign_entity_number
  BEFORE INSERT ON public.players
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_player_entity_number();

REVOKE ALL ON FUNCTION public.assign_player_entity_number() FROM PUBLIC, anon, authenticated;
