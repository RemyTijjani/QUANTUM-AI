-- Stage 5: require exact platform host boundaries when extracting Creator Ops content IDs.
-- This is a corrective migration; it preserves all existing submissions and rewards.

CREATE OR REPLACE FUNCTION public.creator_ops_extract_content_id(
  p_platform text,
  p_link_url text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_platform text := lower(btrim(p_platform));
  v_url text := btrim(p_link_url);
  v_match text[];
BEGIN
  IF v_url = '' OR length(v_url) > 2048 OR v_url ~ '[[:space:]]' THEN
    RETURN NULL;
  END IF;

  IF v_platform = 'youtube' THEN
    -- Exact host boundary: the host must be followed by a path, query,
    -- fragment, or end-of-string; lookalike suffix domains are rejected.
    IF v_url ~* '^https?://(www[.])?youtube[.]com/watch([?#]|$)' THEN
      v_match := regexp_match(v_url, '[?&]v=([A-Za-z0-9_-]{11})([&#]|$)', 'i');
      IF v_match IS NOT NULL THEN RETURN v_match[1]; END IF;
      RETURN NULL;
    ELSIF v_url ~* '^https?://youtu[.]be/' THEN
      v_match := regexp_match(v_url, '^https?://youtu[.]be/([A-Za-z0-9_-]{11})([/?#]|$)', 'i');
      IF v_match IS NOT NULL THEN RETURN v_match[1]; END IF;
      RETURN NULL;
    ELSIF v_url ~* '^https?://(www[.])?youtube[.]com/(shorts|embed|live)/' THEN
      v_match := regexp_match(v_url, '^https?://(www[.])?youtube[.]com/(shorts|embed|live)/([A-Za-z0-9_-]{11})([/?#]|$)', 'i');
      IF v_match IS NOT NULL THEN RETURN v_match[3]; END IF;
      RETURN NULL;
    END IF;
    RETURN NULL;
  ELSIF v_platform = 'tiktok' THEN
    -- Short-link hosts require a trusted external redirect resolver and are
    -- deliberately rejected; only canonical video URLs have stable IDs here.
    IF v_url ~* '^https?://(www[.]|m[.])?tiktok[.]com/@[^/?#]+/video/[0-9]+([/?#]|$)' THEN
      v_match := regexp_match(v_url, '^https?://(www[.]|m[.])?tiktok[.]com/@[^/?#]+/video/([0-9]+)([/?#]|$)', 'i');
      IF v_match IS NOT NULL THEN RETURN v_match[2]; END IF;
    END IF;
    RETURN NULL;
  END IF;

  RETURN NULL;
END;
$function$;

-- The extractor is an internal helper invoked by SECURITY DEFINER functions.
REVOKE ALL ON FUNCTION public.creator_ops_extract_content_id(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
