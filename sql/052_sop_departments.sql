-- =========================================================================
-- A SOP can apply to SEVERAL departments (user spec 2026-08-30).
--
-- Until now the model had exactly two shapes:
--   sops.department_id        — one owning department
--   sops.is_all_departments   — applies to every department (migration 020)
-- Neither covers the common middle case: a SOP that genuinely belongs to
-- three named departments and nothing else.
--
-- sop_departments becomes the source of truth for "which departments does
-- this SOP apply to". sops.department_id is kept in sync with the FIRST
-- selected department so the many existing joins, reports and scope walks
-- that read it keep working unchanged rather than all having to move at
-- once. When is_all_departments is set, the junction is left empty — the
-- flag already means "everything", including departments added later.
-- =========================================================================

CREATE TABLE IF NOT EXISTS sop_departments (
  sop_id        INTEGER NOT NULL REFERENCES sops(id)        ON DELETE CASCADE,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (sop_id, department_id)
);

-- Reverse lookup: "every SOP that applies to this department" is the hot
-- path for access scoping and the acknowledgement queue.
CREATE INDEX IF NOT EXISTS idx_sop_departments_dept ON sop_departments(department_id);

-- Backfill so the junction is authoritative from the moment it exists:
-- every SOP that already names a department gets exactly that one row.
INSERT INTO sop_departments (sop_id, department_id)
SELECT id, department_id
FROM sops
WHERE department_id IS NOT NULL
ON CONFLICT DO NOTHING;
