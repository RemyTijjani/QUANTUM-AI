-- Stage 5: keep trusted gameplay evidence append-only.
-- The verifier only reads gameplay_action_events and gameplay-actions only inserts
-- rows. Prevent accidental service-role mutation or deletion of recorded evidence.
REVOKE UPDATE, DELETE, TRUNCATE
  ON TABLE public.gameplay_action_events
  FROM service_role;
