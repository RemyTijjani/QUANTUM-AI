CREATE OR REPLACE FUNCTION public.admin_delete_expedition_draft(
  p_expedition_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_expedition public.expeditions%rowtype;
  v_activity_count bigint;
BEGIN
  IF p_expedition_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_expedition_id');
  END IF;

  SELECT * INTO v_expedition
  FROM public.expeditions
  WHERE id = p_expedition_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'expedition_not_found');
  END IF;

  IF v_expedition.status <> 'draft' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'only_drafts_can_be_deleted');
  END IF;

  SELECT
    (SELECT count(*) FROM public.expedition_participations WHERE expedition_id = p_expedition_id) +
    (SELECT count(*) FROM public.expedition_teams WHERE expedition_id = p_expedition_id) +
    (SELECT count(*) FROM public.expedition_objective_progress WHERE expedition_id = p_expedition_id) +
    (SELECT count(*) FROM public.expedition_team_objective_progress WHERE expedition_id = p_expedition_id) +
    (SELECT count(*) FROM public.expedition_reward_issuances WHERE expedition_id = p_expedition_id) +
    (SELECT count(*) FROM public.expedition_trusted_evidence WHERE expedition_id = p_expedition_id)
  INTO v_activity_count;

  IF v_activity_count > 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'expedition_has_player_activity');
  END IF;

  DELETE FROM public.expeditions
  WHERE id = p_expedition_id AND status = 'draft';

  RETURN jsonb_build_object(
    'success', true,
    'deletedId', p_expedition_id,
    'title', v_expedition.title
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_delete_expedition_draft(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_expedition_draft(uuid)
  TO service_role;

COMMENT ON FUNCTION public.admin_delete_expedition_draft(uuid) IS
  'Deletes only an unpublished Expedition draft with no participant, team, evidence, progress, or reward-issuance records. Audit rows are preserved by SET NULL.';
