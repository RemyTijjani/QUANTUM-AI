-- Reassign every existing ZORD entity number using the shortest available
-- numeric length, and apply the same allocation rule to future registrations.
-- Two-digit IDs are allocated first (10-99), then three-digit (100-999),
-- then four-digit, continuing as needed. IDs are randomly selected and unique.

ALTER TABLE public.players
  ALTER COLUMN entity_number DROP NOT NULL,
  ALTER COLUMN entity_number TYPE bigint USING entity_number::bigint;

CREATE OR REPLACE FUNCTION public.next_player_entity_number()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_digits integer := 2;
  v_min numeric := 10;
  v_max numeric := 99;
  v_capacity numeric;
  v_used numeric;
  v_candidate bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(741852963);

  LOOP
    v_capacity := v_max - v_min + 1;

    SELECT count(*)::numeric
      INTO v_used
    FROM public.players
    WHERE entity_number BETWEEN v_min AND v_max;

    IF v_used >= v_capacity THEN
      v_digits := v_digits + 1;
      v_min := power(10::numeric, v_digits - 1);
      v_max := least(
        power(10::numeric, v_digits) - 1,
        9223372036854775807::numeric
      );

      IF v_min > 9223372036854775807::numeric THEN
        RAISE EXCEPTION 'No available ZORD entity numbers remain';
      END IF;

      CONTINUE;
    END IF;

    LOOP
      v_candidate := (v_min + floor(random() * v_capacity))::bigint;
      EXIT WHEN NOT EXISTS (
        SELECT 1
        FROM public.players
        WHERE entity_number = v_candidate
      );
    END LOOP;

    RETURN v_candidate;
  END LOOP;
END;
$function$;

-- Reassign all existing accounts, not just future registrations.
UPDATE public.players
SET entity_number = NULL;

DO $reassign$
DECLARE
  v_player_id uuid;
BEGIN
  FOR v_player_id IN
    SELECT id
    FROM public.players
    ORDER BY random()
  LOOP
    UPDATE public.players
    SET entity_number = public.next_player_entity_number()
    WHERE id = v_player_id;
  END LOOP;
END;
$reassign$;

ALTER TABLE public.players
  ALTER COLUMN entity_number SET NOT NULL;

CREATE OR REPLACE FUNCTION public.assign_player_entity_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.entity_number IS NULL THEN
    NEW.entity_number := public.next_player_entity_number();
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS players_assign_entity_number ON public.players;
CREATE TRIGGER players_assign_entity_number
  BEFORE INSERT ON public.players
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_player_entity_number();

REVOKE ALL ON FUNCTION public.next_player_entity_number() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assign_player_entity_number() FROM PUBLIC, anon, authenticated;
