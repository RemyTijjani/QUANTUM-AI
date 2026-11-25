DO $migration$
DECLARE existing_job record;
BEGIN
  FOR existing_job IN SELECT jobid FROM cron.job WHERE jobname='auto-prune-r2-history'
  LOOP
    PERFORM cron.unschedule(existing_job.jobid);
  END LOOP;
  PERFORM cron.schedule(
    'auto-prune-r2-history',
    '*/15 * * * *',
    $job$
      SELECT net.http_post(
        url := 'https://lchkctclxzwwvfwosava.supabase.co/functions/v1/history-archive-prune-scheduled',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'x-zord-archive-token',
          (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='zord_history_archive_cron_token')
        ),
        body := '{"action":"run"}'::jsonb,
        timeout_milliseconds := 30000
      );
    $job$
  );
END;
$migration$;