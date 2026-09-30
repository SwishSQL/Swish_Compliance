-- =========================================================================
-- Split the single "degree of compliance" percent (migration 053) into
-- three sample-distribution percentages (user spec 2026-08-31).
--
-- An audit question is answered by SAMPLING several interactions, and a
-- meaningful share of them can be genuinely not applicable — a single
-- "how compliant" percent conflates "not compliant" with "not
-- applicable", which unfairly drags the auditee's score down. Recording
-- how the samples actually broke down (Yes / No / N-A) and computing
-- performance only over the samples that WERE applicable fixes that.
--
--   yes_percent + no_percent + na_percent = 100  (validated by the CHECK
--   below — either all three are set and sum to 100, or all three are
--   NULL for an unanswered question)
--
--   performance = yes_percent / (yes_percent + no_percent) * 100
--   (NULL — excluded from scoring — when the question was 100% N/A)
--
-- Backfill maps the old single percent onto an equivalent split so every
-- historical audit keeps its exact score, critical-failure count and
-- CAPA set:
--   'na'          -> yes 0,   no 0,        na 100   (fully inapplicable,
--                                                     same as before)
--   'pass'/'fail' -> yes = old percent, no = 100 - old percent, na 0
--                    (performance = yes/(yes+no)*100 = old percent again)
--
-- audit_responses.percent is left in place, unused from here on — kept
-- for anyone who needs to reconstruct the pre-split value, and dropping
-- a column is a change with no way back.
-- =========================================================================

ALTER TABLE audit_responses
  ADD COLUMN IF NOT EXISTS yes_percent SMALLINT,
  ADD COLUMN IF NOT EXISTS no_percent  SMALLINT,
  ADD COLUMN IF NOT EXISTS na_percent  SMALLINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_responses_percent_split_chk'
  ) THEN
    ALTER TABLE audit_responses
      ADD CONSTRAINT audit_responses_percent_split_chk CHECK (
        (yes_percent IS NULL AND no_percent IS NULL AND na_percent IS NULL)
        OR (
          yes_percent BETWEEN 0 AND 100 AND
          no_percent  BETWEEN 0 AND 100 AND
          na_percent  BETWEEN 0 AND 100 AND
          yes_percent + no_percent + na_percent = 100
        )
      );
  END IF;
END $$;

UPDATE audit_responses
SET yes_percent = CASE
                     WHEN response = 'na' THEN 0
                     ELSE COALESCE(percent, CASE WHEN response = 'pass' THEN 100 ELSE 0 END)
                   END,
    no_percent  = CASE
                     WHEN response = 'na' THEN 0
                     ELSE 100 - COALESCE(percent, CASE WHEN response = 'pass' THEN 100 ELSE 0 END)
                   END,
    na_percent  = CASE WHEN response = 'na' THEN 100 ELSE 0 END
WHERE response IN ('pass', 'fail', 'na')
  AND yes_percent IS NULL;
