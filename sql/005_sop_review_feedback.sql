/*
 * 1. Remove the standalone Supply Chain SOP review module (migration 004):
 *    its pages are gone and its data is not kept.
 * 2. Review feedback on every SOP: reviewers comment per section of the
 *    SOP template; Compliance / OPEX / Business Excellence respond.
 *
 * Safe to run more than once (the Deploy Console runs new sql/ files
 * itself before the app's own migrator applies them).
 */
IF OBJECT_ID(N'dbo.sc_sop_feedback', N'U') IS NOT NULL DROP TABLE dbo.sc_sop_feedback;
IF OBJECT_ID(N'dbo.sc_sop_steps', N'U') IS NOT NULL DROP TABLE dbo.sc_sop_steps;
IF OBJECT_ID(N'dbo.sc_sop_processes', N'U') IS NOT NULL DROP TABLE dbo.sc_sop_processes;
IF OBJECT_ID(N'dbo.sc_sop_refs', N'U') IS NOT NULL DROP TABLE dbo.sc_sop_refs;
IF OBJECT_ID(N'dbo.sc_sop_meta', N'U') IS NOT NULL DROP TABLE dbo.sc_sop_meta;
GO

IF OBJECT_ID(N'dbo.sop_feedback', N'U') IS NULL
CREATE TABLE dbo.sop_feedback (
  id            INT IDENTITY(1,1) NOT NULL CONSTRAINT sop_feedback_pkey PRIMARY KEY,
  sop_id        INT           NOT NULL CONSTRAINT sop_feedback_sop_fk REFERENCES dbo.sops(id) ON DELETE CASCADE,
  section_key   NVARCHAR(40)  NOT NULL,
  user_id       INT           NULL CONSTRAINT sop_feedback_user_fk REFERENCES dbo.users(id),
  reviewer_name NVARCHAR(255) NOT NULL,
  reviewer_dept NVARCHAR(120) NULL,
  reviewer_role NVARCHAR(120) NULL,
  fb_type       NVARCHAR(60)  NOT NULL,
  comment       NVARCHAR(MAX) NOT NULL,
  proposed      NVARCHAR(MAX) NULL,
  evidence      NVARCHAR(500) NULL,
  status        NVARCHAR(20)  NOT NULL CONSTRAINT DF_sop_feedback_status DEFAULT N'Open',
  response      NVARCHAR(40)  NULL,
  response_note NVARCHAR(MAX) NULL,
  responded_by  INT           NULL CONSTRAINT sop_feedback_responder_fk REFERENCES dbo.users(id),
  responded_at  DATETIMEOFFSET(3) NULL,
  created_at    DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_sop_feedback_created_at DEFAULT SYSUTCDATETIME()
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sop_feedback_sop' AND object_id = OBJECT_ID(N'dbo.sop_feedback'))
CREATE INDEX IX_sop_feedback_sop ON dbo.sop_feedback (sop_id, section_key);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sop_feedback_user' AND object_id = OBJECT_ID(N'dbo.sop_feedback'))
CREATE INDEX IX_sop_feedback_user ON dbo.sop_feedback (user_id, created_at);
GO
