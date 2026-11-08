/*
# Align creator_ops_submissions with the Missions tab

## Plain-English summary
The database already had a `creator_ops_submissions` table with a different shape,
so the original create step left it unchanged. This migration adds the columns the
app writes to when a player submits a TikTok or YouTube link.

## Modified tables
- `creator_ops_submissions`
  - ADD mission_id (text, required) - the mission the link is for
  - ADD link_url (text, required) - the submitted link
  - ADD platform (text, defaults to 'youtube')
  - ADD reward_zp (integer, defaults to 0) - ZP credited on approval
  - ADD reviewed_at (timestamptz, nullable) - set when an admin reviews it

## Security
- No policy or grant changes.

## Important notes
1. Every statement uses IF NOT EXISTS, so re-running is safe.
2. No existing columns are removed or changed. The legacy `service` column is left in place.
*/

ALTER TABLE creator_ops_submissions
  ADD COLUMN IF NOT EXISTS mission_id text NOT NULL,
  ADD COLUMN IF NOT EXISTS link_url text NOT NULL,
  ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'youtube',
  ADD COLUMN IF NOT EXISTS reward_zp integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
