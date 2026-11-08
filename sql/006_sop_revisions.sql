/*
 * SOP revisions: editing an approved SOP creates a new draft version that
 * goes through approval again; the approved one stays live until the new
 * version is approved, then it is archived.
 *
 *  - sops.revision_of_id: the approved SOP this draft revises (plain INT,
 *    no FK, so deleting either SOP keeps working with trg_sops_on_delete).
 *  - SOP codes are unique per version now (code + version), so v1.0 and
 *    its revision v1.1 can share a code.
 *  - sop_feedback keeps reviewer ids without FKs, so deleting a user
 *    (trg_users_on_delete) is not blocked by their review comments.
 *
 * Safe to run more than once.
 */
IF COL_LENGTH(N'dbo.sops', N'revision_of_id') IS NULL
  ALTER TABLE dbo.sops ADD revision_of_id INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_sops_revision_of' AND object_id = OBJECT_ID(N'dbo.sops'))
  CREATE INDEX idx_sops_revision_of ON dbo.sops (revision_of_id) WHERE revision_of_id IS NOT NULL;

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'sops_code_key' AND object_id = OBJECT_ID(N'dbo.sops'))
  DROP INDEX sops_code_key ON dbo.sops;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'sops_code_version_key' AND object_id = OBJECT_ID(N'dbo.sops'))
  CREATE UNIQUE INDEX sops_code_version_key ON dbo.sops (code, version) WHERE code IS NOT NULL;

IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'sop_feedback_user_fk')
  ALTER TABLE dbo.sop_feedback DROP CONSTRAINT sop_feedback_user_fk;
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'sop_feedback_responder_fk')
  ALTER TABLE dbo.sop_feedback DROP CONSTRAINT sop_feedback_responder_fk;
GO
