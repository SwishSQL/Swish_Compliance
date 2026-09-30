-- =========================================================================
-- Graded audit answers (user spec 2026-08-30).
--
-- An answer used to be all-or-nothing: 'pass' earned the question's full
-- weight, 'fail' earned zero. Real findings are rarely that binary — a
-- control can be followed on 7 of 10 sampled interactions.
--
-- audit_responses.percent records that degree, and is now what the score
-- is built from: earned weight = weight * percent / 100. The Yes/No/N-A
-- choice stays as the auditor's verdict.
--
-- Backfill maps the old answers onto the same numbers they already scored
-- (pass = 100, fail = 0), so every historical audit keeps its exact score,
-- critical-failure count and set of findings. N/A stays NULL: it is
-- excluded from scoring entirely rather than counted as zero.
-- =========================================================================

ALTER TABLE audit_responses
  ADD COLUMN IF NOT EXISTS percent SMALLINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_responses_percent_range'
  ) THEN
    ALTER TABLE audit_responses
      ADD CONSTRAINT audit_responses_percent_range
      CHECK (percent IS NULL OR (percent >= 0 AND percent <= 100));
  END IF;
END $$;

UPDATE audit_responses
SET percent = CASE response WHEN 'pass' THEN 100 WHEN 'fail' THEN 0 END
WHERE percent IS NULL
  AND response IN ('pass', 'fail');
