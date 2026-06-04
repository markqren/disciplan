-- BUG-32: daily-insight cron must authenticate to the Supabase Edge gateway.
--
-- Symptom: pg_cron kept succeeding, but pg_net responses were 401
-- UNAUTHORIZED_NO_AUTH_HEADER because the cron request only sent X-Cron-Secret.
-- The Edge Function's own CRON_SECRET check never ran because Supabase rejected
-- the request at the gateway first.
--
-- Keep the existing CRON_SECRET out of source control by extracting it from the
-- currently-installed cron command, then rebuild the command with the public anon
-- JWT required by the Supabase gateway. The anon key is already public in
-- js/config.js; X-Cron-Secret remains the app-level authorization gate.

DO $$
DECLARE
  existing_command text;
  cron_secret text;
  anon_key constant text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qdWFubmVwZm9kc3Ric3h3ZXVjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzODcwMzksImV4cCI6MjA4Njk2MzAzOX0.6TqLUAhvWMjDunpird0_9FMnDiT4qRuYaH6XbXmKOnA';
BEGIN
  SELECT command
    INTO existing_command
  FROM cron.job
  WHERE jobname = 'daily-insight'
     OR command LIKE '%/functions/v1/daily-insight%'
  ORDER BY jobid
  LIMIT 1;

  IF existing_command IS NULL THEN
    RAISE EXCEPTION 'daily-insight cron job not found';
  END IF;

  cron_secret := (regexp_match(existing_command, '''X-Cron-Secret'',\s*''([^'']+)'''))[1];

  IF cron_secret IS NULL OR cron_secret = '' THEN
    RAISE EXCEPTION 'daily-insight cron command does not contain X-Cron-Secret';
  END IF;

  PERFORM cron.alter_job(
    job_id := (
      SELECT jobid
      FROM cron.job
      WHERE jobname = 'daily-insight'
         OR command LIKE '%/functions/v1/daily-insight%'
      ORDER BY jobid
      LIMIT 1
    ),
    command := format(
      'select net.http_post(url := %L, headers := jsonb_build_object(%L, %L, %L, %L, %L, %L, %L, %L), body := %L::jsonb, timeout_milliseconds := 60000);',
      'https://mjuannepfodstbsxweuc.supabase.co/functions/v1/daily-insight',
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || anon_key,
      'apikey', anon_key,
      'X-Cron-Secret', cron_secret,
      '{}'
    )
  );
END $$;
