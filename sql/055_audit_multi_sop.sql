-- =========================================================================
-- An audit can now cover SEVERAL SOPs at once (user spec 2026-09-03).
--
-- Until now an audit picked exactly one Policy / SOP, so covering a
-- department's whole compliance surface meant creating one audit per SOP.
-- audit_sops becomes the source of truth for "which SOPs does this audit
-- cover" — audits.policy_id is kept in sync with the FIRST selected SOP
-- (same pattern as sop_departments/departments.department_id in migration
-- 052), so the existing display, filters and CAPA/roadmap joins that read
-- it keep working unchanged.
--
-- Picking more than one SOP always resolves as a Full SOP Audit for each
-- of them (unioned) — Framework/Domain scoping still narrows to exactly
-- one SOP, same as before.
-- =========================================================================

CREATE TABLE IF NOT EXISTS audit_sops (
  audit_id   INTEGER NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  sop_id     INTEGER NOT NULL REFERENCES sops(id)   ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (audit_id, sop_id)
);

CREATE INDEX IF NOT EXISTS idx_audit_sops_sop ON audit_sops(sop_id);

-- Backfill: every existing audit already names exactly one SOP.
INSERT INTO audit_sops (audit_id, sop_id)
SELECT id, policy_id
FROM audits
WHERE policy_id IS NOT NULL
ON CONFLICT DO NOTHING;
