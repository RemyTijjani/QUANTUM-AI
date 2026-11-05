/*
# Rename reward_iq column to reward_zp in creator_ops_submissions

## Purpose
The app's currency was renamed from "IQ" to "ZP". This renames the `reward_iq` column 
to `reward_zp` to match the new naming convention.

## Changes
- Renamed column `reward_iq` → `reward_zp` on `creator_ops_submissions` table.
- No data loss: values are preserved, only the column name changes.

## Security
- No policy or RLS changes. Existing policies remain valid.
*/

ALTER TABLE creator_ops_submissions RENAME COLUMN reward_iq TO reward_zp;
