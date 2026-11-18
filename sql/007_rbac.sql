/*
 * Role-based access control (docs/RBAC.md).
 *
 *  - user_roles: a user can hold several roles. Backfilled from users.role,
 *    which stays as the user's primary role (nothing else changes for
 *    existing accounts — no one gains access from this migration).
 *  - role_permissions: admin overrides of the default role × permission
 *    matrix (src/lib/auth/permissions.ts). Empty = the defaults apply.
 *  - sops.workflow_route: which approval route a SOP follows
 *    ('standard' = OPEX stage first, 'opex_authored' = department
 *    validation first). NULL = legacy SOP already in flight; it keeps the
 *    old route (starts at the Compliance stage).
 *  - sop_approvals: one row per approval decision, with version, approver,
 *    role, decision, from/to status and comment.
 *  - reminders_sent: de-duplicates due-soon / overdue notifications.
 *  - audit_logs becomes append-only (only the user-delete trigger may null
 *    out user_id).
 *
 * Additive only. Safe to run more than once.
 */
IF OBJECT_ID(N'dbo.user_roles', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.user_roles (
    user_id     INT NOT NULL,
    role        NVARCHAR(40) NOT NULL,
    created_at  DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_user_roles_created_at DEFAULT SYSUTCDATETIME(),
    -- No FK on purpose (like sops.revision_of_id): users has an INSTEAD OF
    -- DELETE trigger, and orphan rows for a deleted user are harmless.
    CONSTRAINT user_roles_pkey PRIMARY KEY (user_id, role)
  );
END
GO

INSERT INTO dbo.user_roles (user_id, role)
SELECT u.id, u.role FROM dbo.users u
WHERE u.role IS NOT NULL AND u.role <> N''
  AND NOT EXISTS (SELECT 1 FROM dbo.user_roles r WHERE r.user_id = u.id AND r.role = u.role);
GO

IF OBJECT_ID(N'dbo.role_permissions', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.role_permissions (
    role        NVARCHAR(40) NOT NULL,
    permission  NVARCHAR(80) NOT NULL,
    allowed     BIT NOT NULL,
    updated_by  INT NULL,
    updated_at  DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_role_permissions_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT role_permissions_pkey PRIMARY KEY (role, permission)
  );
END
GO

IF COL_LENGTH(N'dbo.sops', N'workflow_route') IS NULL
  ALTER TABLE dbo.sops ADD workflow_route NVARCHAR(20) NULL;
GO

IF OBJECT_ID(N'dbo.sop_approvals', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.sop_approvals (
    id             INT IDENTITY(1,1) NOT NULL,
    sop_id         INT NOT NULL,
    sop_version    NVARCHAR(20) NULL,
    approver_id    INT NULL,
    approver_name  NVARCHAR(200) NULL,
    approver_role  NVARCHAR(40) NULL,
    decision       NVARCHAR(20) NOT NULL,   -- submit | approve | return | reject
    from_status    NVARCHAR(30) NOT NULL,
    to_status      NVARCHAR(30) NOT NULL,
    comment        NVARCHAR(MAX) NULL,
    decided_at     DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_sop_approvals_decided_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT sop_approvals_pkey PRIMARY KEY (id)
  );
  CREATE INDEX idx_sop_approvals_sop ON dbo.sop_approvals (sop_id, decided_at);
END
GO

IF OBJECT_ID(N'dbo.reminders_sent', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.reminders_sent (
    kind         NVARCHAR(60) NOT NULL,
    entity_type  NVARCHAR(30) NOT NULL,
    entity_id    INT NOT NULL,
    sent_on      DATE NOT NULL,
    CONSTRAINT reminders_sent_pkey PRIMARY KEY (kind, entity_type, entity_id, sent_on)
  );
END
GO

CREATE OR ALTER TRIGGER dbo.trg_audit_logs_no_delete ON dbo.audit_logs INSTEAD OF DELETE AS
BEGIN
  SET NOCOUNT ON;
  THROW 51001, N'audit_logs is append-only: rows cannot be deleted.', 1;
END
GO

-- The only allowed update is nulling user_id (trg_users_on_delete).
CREATE OR ALTER TRIGGER dbo.trg_audit_logs_no_update ON dbo.audit_logs INSTEAD OF UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM inserted WHERE user_id IS NOT NULL)
     OR EXISTS (
       SELECT i.id, i.user_email, i.action, i.entity, i.entity_id, i.details, i.ip_address, i.created_at FROM inserted i
       EXCEPT
       SELECT d.id, d.user_email, d.action, d.entity, d.entity_id, d.details, d.ip_address, d.created_at FROM deleted d
     )
    THROW 51002, N'audit_logs is append-only: rows cannot be changed.', 1;
  UPDATE a SET user_id = NULL FROM dbo.audit_logs a JOIN inserted i ON i.id = a.id;
END
GO
