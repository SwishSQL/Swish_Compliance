/*
 * Swish Compliance — SQL Server baseline schema.
 *
 * Equivalent to the PostgreSQL edition after its migrations 001-055, generated
 * from the catalog those migrations produce (not re-typed by hand), then
 * adapted to SQL Server:
 *
 *   - SERIAL -> INT IDENTITY, TIMESTAMPTZ -> DATETIMEOFFSET(3),
 *     TEXT/JSONB -> NVARCHAR(MAX), VARCHAR(n) -> NVARCHAR(n) (Arabic text).
 *   - UNIQUE on a nullable column -> filtered unique index (SQL Server's
 *     UNIQUE constraint allows only ONE NULL; PostgreSQL allows many).
 *   - Foreign keys are declared without ON DELETE actions: SQL Server
 *     rejects most of the original CASCADE / SET NULL rules (multiple
 *     cascade paths, self-references). The exact PostgreSQL ON DELETE
 *     behaviour is reproduced instead by the INSTEAD OF DELETE triggers at
 *     the end of this file.
 *   - updated_at is maintained by AFTER UPDATE triggers (was a BEFORE
 *     UPDATE plpgsql trigger).
 */

CREATE TABLE dbo.audit_attachments (
  id                           INT IDENTITY(1,1) NOT NULL,
  audit_id                     INT NOT NULL,
  file_url                     NVARCHAR(MAX) NOT NULL,
  file_name                    NVARCHAR(MAX) NOT NULL,
  file_mime                    NVARCHAR(120) NULL,
  file_size                    INT NULL,
  uploaded_by                  INT NULL,
  uploaded_at                  DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_audit_attachments_uploaded_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT audit_attachments_pkey PRIMARY KEY (id)
);

CREATE TABLE dbo.audit_logs (
  id                           INT IDENTITY(1,1) NOT NULL,
  user_id                      INT NULL,
  user_email                   NVARCHAR(255) NULL,
  action                       NVARCHAR(80) NOT NULL,
  entity                       NVARCHAR(60) NULL,
  entity_id                    INT NULL,
  details                      NVARCHAR(MAX) NULL,
  ip_address                   NVARCHAR(60) NULL,
  created_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_audit_logs_created_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT audit_logs_pkey PRIMARY KEY (id),
  CONSTRAINT CK_audit_logs_details_json CHECK (details IS NULL OR ISJSON(details) = 1)
);

CREATE TABLE dbo.audit_responses (
  id                           INT IDENTITY(1,1) NOT NULL,
  audit_id                     INT NOT NULL,
  item_id                      INT NOT NULL,
  response                     NVARCHAR(10) NULL,
  notes                        NVARCHAR(MAX) NULL,
  evidence_url                 NVARCHAR(MAX) NULL,
  created_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_audit_responses_created_at DEFAULT SYSUTCDATETIME(),
  updated_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_audit_responses_updated_at DEFAULT SYSUTCDATETIME(),
  evidence_name                NVARCHAR(255) NULL,
  evidence_mime                NVARCHAR(120) NULL,
  [percent]                    SMALLINT NULL,
  yes_percent                  SMALLINT NULL,
  no_percent                   SMALLINT NULL,
  na_percent                   SMALLINT NULL,
  CONSTRAINT audit_responses_pkey PRIMARY KEY (id),
  CONSTRAINT audit_responses_audit_id_item_id_key UNIQUE (audit_id, item_id),
  CONSTRAINT audit_responses_percent_range CHECK ((([percent] IS NULL) OR (([percent] >= 0) AND ([percent] <= 100)))),
  CONSTRAINT audit_responses_percent_split_chk CHECK ((((yes_percent IS NULL) AND (no_percent IS NULL) AND (na_percent IS NULL)) OR (((yes_percent >= 0) AND (yes_percent <= 100)) AND ((no_percent >= 0) AND (no_percent <= 100)) AND ((na_percent >= 0) AND (na_percent <= 100)) AND (((yes_percent + no_percent) + na_percent) = 100))))
);

CREATE TABLE dbo.audit_sops (
  audit_id                     INT NOT NULL,
  sop_id                       INT NOT NULL,
  created_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_audit_sops_created_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT audit_sops_pkey PRIMARY KEY (audit_id, sop_id)
);

CREATE TABLE dbo.audit_tests (
  audit_id                     INT NOT NULL,
  check_id                     INT NOT NULL,
  created_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_audit_tests_created_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT audit_tests_pkey PRIMARY KEY (audit_id, check_id)
);

CREATE TABLE dbo.audits (
  id                           INT IDENTITY(1,1) NOT NULL,
  template_id                  INT NULL,
  brand_id                     INT NULL,
  department_id                INT NULL,
  location                     NVARCHAR(200) NULL,
  auditor_id                   INT NULL,
  audit_date                   DATE NOT NULL CONSTRAINT DF_audits_audit_date DEFAULT CAST(SYSUTCDATETIME() AS DATE),
  status                       NVARCHAR(30) NOT NULL CONSTRAINT DF_audits_status DEFAULT N'in_progress',
  score                        DECIMAL(5,2) NULL,
  max_score                    INT NULL,
  critical_failed              INT NULL CONSTRAINT DF_audits_critical_failed DEFAULT 0,
  summary                      NVARCHAR(MAX) NULL,
  submitted_at                 DATETIMEOFFSET(3) NULL,
  closed_at                    DATETIMEOFFSET(3) NULL,
  created_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_audits_created_at DEFAULT SYSUTCDATETIME(),
  updated_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_audits_updated_at DEFAULT SYSUTCDATETIME(),
  policy_id                    INT NULL,
  framework_id                 INT NULL,
  domain_id                    INT NULL,
  control_id                   INT NULL,
  start_at                     DATETIMEOFFSET(3) NULL,
  end_at                       DATETIMEOFFSET(3) NULL,
  assigned_to                  INT NULL,
  scope_type                   NVARCHAR(20) NULL,
  auditee_id                   INT NULL,
  reviewer_id                  INT NULL,
  objective                    NVARCHAR(MAX) NULL,
  notes                        NVARCHAR(MAX) NULL,
  auditee_custom_name          NVARCHAR(200) NULL,
  CONSTRAINT audits_pkey PRIMARY KEY (id)
);

CREATE TABLE dbo.brands (
  id                           INT IDENTITY(1,1) NOT NULL,
  name                         NVARCHAR(120) NOT NULL,
  is_active                    BIT NOT NULL CONSTRAINT DF_brands_is_active DEFAULT 1,
  created_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_brands_created_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT brands_pkey PRIMARY KEY (id),
  CONSTRAINT brands_name_key UNIQUE (name)
);

CREATE TABLE dbo.capa_evidences (
  id                           INT IDENTITY(1,1) NOT NULL,
  capa_id                      INT NOT NULL,
  file_url                     NVARCHAR(MAX) NOT NULL,
  file_name                    NVARCHAR(MAX) NOT NULL,
  file_mime                    NVARCHAR(120) NULL,
  file_size                    INT NULL,
  uploaded_by                  INT NULL,
  uploaded_at                  DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_capa_evidences_uploaded_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT capa_evidences_pkey PRIMARY KEY (id)
);

CREATE TABLE dbo.check_checklist_items (
  check_id                     INT NOT NULL,
  checklist_item_id            INT NOT NULL,
  created_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_check_checklist_items_created_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT check_checklist_items_pkey PRIMARY KEY (check_id, checklist_item_id)
);

CREATE TABLE dbo.check_results (
  id                           INT IDENTITY(1,1) NOT NULL,
  check_id                     INT NOT NULL,
  status                       NVARCHAR(20) NOT NULL,
  notes                        NVARCHAR(MAX) NULL,
  evidence_url                 NVARCHAR(MAX) NULL,
  performed_by                 INT NULL,
  created_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_check_results_created_at DEFAULT SYSUTCDATETIME(),
  evidence_name                NVARCHAR(255) NULL,
  evidence_mime                NVARCHAR(120) NULL,
  checklist_template_id        INT NULL,
  CONSTRAINT check_results_pkey PRIMARY KEY (id)
);

CREATE TABLE dbo.checklist_item_answers (
  id                           INT IDENTITY(1,1) NOT NULL,
  item_id                      INT NOT NULL,
  answer                       NVARCHAR(10) NOT NULL,
  note                         NVARCHAR(MAX) NULL,
  answered_by                  INT NULL,
  answered_at                  DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_checklist_item_answers_answered_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT checklist_item_answers_pkey PRIMARY KEY (id)
);

CREATE TABLE dbo.checklist_items (
  id                           INT IDENTITY(1,1) NOT NULL,
  template_id                  INT NOT NULL,
  sort_order                   INT NOT NULL CONSTRAINT DF_checklist_items_sort_order DEFAULT 0,
  question                     NVARCHAR(MAX) NOT NULL,
  guidance                     NVARCHAR(MAX) NULL,
  weight                       INT NOT NULL CONSTRAINT DF_checklist_items_weight DEFAULT 1,
  is_critical                  BIT NOT NULL CONSTRAINT DF_checklist_items_is_critical DEFAULT 0,
  created_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_checklist_items_created_at DEFAULT SYSUTCDATETIME(),
  code                         NVARCHAR(40) NULL,
  section                      NVARCHAR(120) NULL,
  CONSTRAINT checklist_items_pkey PRIMARY KEY (id)
);

CREATE TABLE dbo.checklist_templates (
  id                           INT IDENTITY(1,1) NOT NULL,
  code                         NVARCHAR(40) NULL,
  name                         NVARCHAR(200) NOT NULL,
  description                  NVARCHAR(MAX) NULL,
  category                     NVARCHAR(80) NULL,
  is_active                    BIT NOT NULL CONSTRAINT DF_checklist_templates_is_active DEFAULT 1,
  created_by                   INT NULL,
  created_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_checklist_templates_created_at DEFAULT SYSUTCDATETIME(),
  updated_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_checklist_templates_updated_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT checklist_templates_pkey PRIMARY KEY (id)
);

CREATE TABLE dbo.checks (
  id                           INT IDENTITY(1,1) NOT NULL,
  code                         NVARCHAR(40) NULL,
  name                         NVARCHAR(255) NOT NULL,
  description                  NVARCHAR(MAX) NULL,
  control_id                   INT NULL,
  owner_user_id                INT NULL,
  frequency                    NVARCHAR(30) NOT NULL CONSTRAINT DF_checks_frequency DEFAULT N'monthly',
  is_active                    BIT NOT NULL CONSTRAINT DF_checks_is_active DEFAULT 1,
  last_status                  NVARCHAR(20) NULL,
  last_result_at               DATETIMEOFFSET(3) NULL,
  next_due_date                DATE NULL,
  created_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_checks_created_at DEFAULT SYSUTCDATETIME(),
  updated_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_checks_updated_at DEFAULT SYSUTCDATETIME(),
  checklist_template_id        INT NULL,
  procedure_steps              NVARCHAR(MAX) NULL,
  evidence_needed              NVARCHAR(MAX) NULL,
  method                       NVARCHAR(80) NULL,
  performer_role               NVARCHAR(150) NULL,
  reviewer_role                NVARCHAR(150) NULL,
  pass_criteria                NVARCHAR(MAX) NULL,
  fail_criteria                NVARCHAR(MAX) NULL,
  frequency_label              NVARCHAR(MAX) NULL,
  evidence_code                NVARCHAR(MAX) NULL,
  CONSTRAINT checks_pkey PRIMARY KEY (id)
);

CREATE TABLE dbo.config_options (
  id                           INT IDENTITY(1,1) NOT NULL,
  kind                         NVARCHAR(60) NOT NULL,
  value                        NVARCHAR(120) NOT NULL,
  label                        NVARCHAR(255) NOT NULL,
  sort_order                   INT NOT NULL CONSTRAINT DF_config_options_sort_order DEFAULT 0,
  is_active                    BIT NOT NULL CONSTRAINT DF_config_options_is_active DEFAULT 1,
  created_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_config_options_created_at DEFAULT SYSUTCDATETIME(),
  updated_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_config_options_updated_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT config_options_pkey PRIMARY KEY (id),
  CONSTRAINT config_options_kind_value_key UNIQUE (kind, value)
);

CREATE TABLE dbo.control_links (
  id                           INT IDENTITY(1,1) NOT NULL,
  control_id                   INT NOT NULL,
  entity_type                  NVARCHAR(40) NOT NULL,
  entity_id                    INT NOT NULL,
  created_by                   INT NULL,
  created_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_control_links_created_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT control_links_pkey PRIMARY KEY (id),
  CONSTRAINT control_links_control_id_entity_type_entity_id_key UNIQUE (control_id, entity_type, entity_id)
);

CREATE TABLE dbo.controls (
  id                           INT IDENTITY(1,1) NOT NULL,
  code                         NVARCHAR(40) NULL,
  name                         NVARCHAR(255) NOT NULL,
  description                  NVARCHAR(MAX) NULL,
  framework_id                 INT NULL,
  category                     NVARCHAR(80) NULL,
  owner_user_id                INT NULL,
  is_active                    BIT NOT NULL CONSTRAINT DF_controls_is_active DEFAULT 1,
  health_status                NVARCHAR(20) NOT NULL CONSTRAINT DF_controls_health_status DEFAULT N'unknown',
  health_updated_at            DATETIMEOFFSET(3) NULL,
  created_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_controls_created_at DEFAULT SYSUTCDATETIME(),
  updated_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_controls_updated_at DEFAULT SYSUTCDATETIME(),
  requirement                  NVARCHAR(MAX) NULL,
  clause_reference             NVARCHAR(255) NULL,
  evidence_required            NVARCHAR(MAX) NULL,
  risk_weight                  INT NULL,
  control_type                 NVARCHAR(80) NULL,
  frequency                    NVARCHAR(60) NULL,
  reviewer_prompt              NVARCHAR(MAX) NULL,
  CONSTRAINT controls_pkey PRIMARY KEY (id)
);

CREATE TABLE dbo.corrective_actions (
  id                           INT IDENTITY(1,1) NOT NULL,
  code                         NVARCHAR(40) NULL,
  title                        NVARCHAR(255) NOT NULL,
  description                  NVARCHAR(MAX) NULL,
  severity                     NVARCHAR(20) NOT NULL CONSTRAINT DF_corrective_actions_severity DEFAULT N'medium',
  status                       NVARCHAR(30) NOT NULL CONSTRAINT DF_corrective_actions_status DEFAULT N'open',
  source_audit_id              INT NULL,
  source_item_id               INT NULL,
  brand_id                     INT NULL,
  department_id                INT NULL,
  assigned_to                  INT NULL,
  created_by                   INT NULL,
  verified_by                  INT NULL,
  due_date                     DATE NULL,
  resolution_note              NVARCHAR(MAX) NULL,
  evidence_url                 NVARCHAR(MAX) NULL,
  submitted_at                 DATETIMEOFFSET(3) NULL,
  verified_at                  DATETIMEOFFSET(3) NULL,
  closed_at                    DATETIMEOFFSET(3) NULL,
  created_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_corrective_actions_created_at DEFAULT SYSUTCDATETIME(),
  updated_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_corrective_actions_updated_at DEFAULT SYSUTCDATETIME(),
  start_date                   DATE NULL,
  reviewer_id                  INT NULL,
  assignment_note              NVARCHAR(MAX) NULL,
  root_cause                   NVARCHAR(MAX) NULL,
  corrective_action_taken      NVARCHAR(MAX) NULL,
  preventive_action_taken      NVARCHAR(MAX) NULL,
  completion_note              NVARCHAR(MAX) NULL,
  rejection_reason             NVARCHAR(MAX) NULL,
  CONSTRAINT corrective_actions_pkey PRIMARY KEY (id)
);

CREATE TABLE dbo.deleted_records (
  id                           INT IDENTITY(1,1) NOT NULL,
  entity_type                  NVARCHAR(40) NOT NULL,
  entity_id                    INT NOT NULL,
  snapshot                     NVARCHAR(MAX) NOT NULL,
  deleted_by                   INT NULL,
  deleted_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_deleted_records_deleted_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT deleted_records_pkey PRIMARY KEY (id),
  CONSTRAINT CK_deleted_records_snapshot_json CHECK (snapshot IS NULL OR ISJSON(snapshot) = 1)
);

CREATE TABLE dbo.departments (
  id                           INT IDENTITY(1,1) NOT NULL,
  name                         NVARCHAR(120) NOT NULL,
  is_active                    BIT NOT NULL CONSTRAINT DF_departments_is_active DEFAULT 1,
  created_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_departments_created_at DEFAULT SYSUTCDATETIME(),
  division_id                  INT NULL,
  parent_department_id         INT NULL,
  code                         NVARCHAR(40) NULL,
  manager_id                   INT NULL,
  CONSTRAINT departments_pkey PRIMARY KEY (id),
  CONSTRAINT departments_name_key UNIQUE (name)
);

CREATE TABLE dbo.divisions (
  id                           INT IDENTITY(1,1) NOT NULL,
  code                         NVARCHAR(40) NOT NULL,
  name                         NVARCHAR(200) NOT NULL,
  sort_order                   INT NOT NULL CONSTRAINT DF_divisions_sort_order DEFAULT 0,
  is_active                    BIT NOT NULL CONSTRAINT DF_divisions_is_active DEFAULT 1,
  created_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_divisions_created_at DEFAULT SYSUTCDATETIME(),
  updated_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_divisions_updated_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT divisions_pkey PRIMARY KEY (id),
  CONSTRAINT divisions_code_key UNIQUE (code)
);

CREATE TABLE dbo.domains (
  id                           INT IDENTITY(1,1) NOT NULL,
  code                         NVARCHAR(40) NOT NULL,
  name                         NVARCHAR(200) NOT NULL,
  description                  NVARCHAR(MAX) NULL,
  sort_order                   INT NOT NULL CONSTRAINT DF_domains_sort_order DEFAULT 0,
  is_active                    BIT NOT NULL CONSTRAINT DF_domains_is_active DEFAULT 1,
  created_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_domains_created_at DEFAULT SYSUTCDATETIME(),
  updated_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_domains_updated_at DEFAULT SYSUTCDATETIME(),
  sop_id                       INT NULL,
  department_id                INT NULL,
  review_scope_method          NVARCHAR(MAX) NULL,
  evidence_to_obtain           NVARCHAR(MAX) NULL,
  review_focus                 NVARCHAR(MAX) NULL,
  how_to_verify                NVARCHAR(MAX) NULL,
  CONSTRAINT domains_pkey PRIMARY KEY (id),
  CONSTRAINT domains_code_key UNIQUE (code)
);

CREATE TABLE dbo.evidence_files (
  id                           INT IDENTITY(1,1) NOT NULL,
  entity_type                  NVARCHAR(40) NOT NULL,
  entity_id                    INT NOT NULL,
  file_name                    NVARCHAR(255) NOT NULL,
  file_url                     NVARCHAR(MAX) NOT NULL,
  description                  NVARCHAR(MAX) NULL,
  uploaded_by                  INT NULL,
  created_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_evidence_files_created_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT evidence_files_pkey PRIMARY KEY (id)
);

CREATE TABLE dbo.frameworks (
  id                           INT IDENTITY(1,1) NOT NULL,
  code                         NVARCHAR(40) NOT NULL,
  name                         NVARCHAR(200) NOT NULL,
  description                  NVARCHAR(MAX) NULL,
  category                     NVARCHAR(80) NULL,
  is_active                    BIT NOT NULL CONSTRAINT DF_frameworks_is_active DEFAULT 0,
  activated_by                 INT NULL,
  activated_at                 DATETIMEOFFSET(3) NULL,
  owner_user_id                INT NULL,
  created_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_frameworks_created_at DEFAULT SYSUTCDATETIME(),
  updated_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_frameworks_updated_at DEFAULT SYSUTCDATETIME(),
  reference_source             NVARCHAR(MAX) NULL,
  scope                        NVARCHAR(MAX) NULL,
  review_frequency             NVARCHAR(60) NULL,
  domain_id                    INT NULL,
  owner_label                  NVARCHAR(MAX) NULL,
  audit_frequency              NVARCHAR(MAX) NULL,
  sop_id                       INT NULL,
  department_id                INT NULL,
  CONSTRAINT frameworks_pkey PRIMARY KEY (id),
  CONSTRAINT frameworks_code_key UNIQUE (code)
);

CREATE TABLE dbo.notifications (
  id                           INT IDENTITY(1,1) NOT NULL,
  user_id                      INT NOT NULL,
  actor_id                     INT NULL,
  actor_name                   NVARCHAR(255) NULL,
  actor_role                   NVARCHAR(40) NULL,
  kind                         NVARCHAR(80) NOT NULL,
  title                        NVARCHAR(MAX) NOT NULL,
  body                         NVARCHAR(MAX) NULL,
  severity                     NVARCHAR(20) NOT NULL CONSTRAINT DF_notifications_severity DEFAULT N'info',
  entity_type                  NVARCHAR(40) NULL,
  entity_id                    INT NULL,
  href                         NVARCHAR(MAX) NULL,
  is_read                      BIT NOT NULL CONSTRAINT DF_notifications_is_read DEFAULT 0,
  read_at                      DATETIMEOFFSET(3) NULL,
  created_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_notifications_created_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT notifications_pkey PRIMARY KEY (id)
);

CREATE TABLE dbo.org_units (
  id                           INT IDENTITY(1,1) NOT NULL,
  code                         NVARCHAR(40) NOT NULL,
  name                         NVARCHAR(200) NOT NULL,
  parent_id                    INT NULL,
  level                        SMALLINT NOT NULL,
  sort_order                   INT NOT NULL CONSTRAINT DF_org_units_sort_order DEFAULT 0,
  is_active                    BIT NOT NULL CONSTRAINT DF_org_units_is_active DEFAULT 1,
  created_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_org_units_created_at DEFAULT SYSUTCDATETIME(),
  updated_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_org_units_updated_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT org_units_pkey PRIMARY KEY (id),
  CONSTRAINT org_units_code_key UNIQUE (code)
);

CREATE TABLE dbo.sop_acknowledgments (
  id                           INT IDENTITY(1,1) NOT NULL,
  sop_id                       INT NOT NULL,
  user_id                      INT NOT NULL,
  acknowledged_at              DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_sop_acknowledgments_acknowledged_at DEFAULT SYSUTCDATETIME(),
  user_role                    NVARCHAR(40) NULL,
  user_agent                   NVARCHAR(500) NULL,
  ip_address                   NVARCHAR(60) NULL,
  CONSTRAINT sop_acknowledgments_pkey PRIMARY KEY (id),
  CONSTRAINT sop_acknowledgments_sop_id_user_id_key UNIQUE (sop_id, user_id)
);

CREATE TABLE dbo.sop_departments (
  sop_id                       INT NOT NULL,
  department_id                INT NOT NULL,
  created_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_sop_departments_created_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT sop_departments_pkey PRIMARY KEY (sop_id, department_id)
);

CREATE TABLE dbo.sop_versions (
  id                           INT IDENTITY(1,1) NOT NULL,
  sop_id                       INT NOT NULL,
  version                      NVARCHAR(20) NOT NULL,
  changed_by                   INT NULL,
  change_note                  NVARCHAR(MAX) NULL,
  snapshot                     NVARCHAR(MAX) NOT NULL,
  created_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_sop_versions_created_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT sop_versions_pkey PRIMARY KEY (id),
  CONSTRAINT CK_sop_versions_snapshot_json CHECK (snapshot IS NULL OR ISJSON(snapshot) = 1)
);

CREATE TABLE dbo.sops (
  id                           INT IDENTITY(1,1) NOT NULL,
  code                         NVARCHAR(40) NULL,
  title                        NVARCHAR(255) NOT NULL,
  description                  NVARCHAR(MAX) NULL,
  version                      NVARCHAR(20) NOT NULL CONSTRAINT DF_sops_version DEFAULT N'1.0',
  status                       NVARCHAR(30) NOT NULL CONSTRAINT DF_sops_status DEFAULT N'draft',
  file_url                     NVARCHAR(MAX) NULL,
  brand_id                     INT NULL,
  department_id                INT NULL,
  owner_id                     INT NULL,
  created_by                   INT NULL,
  approved_by                  INT NULL,
  approved_at                  DATETIMEOFFSET(3) NULL,
  effective_date               DATE NULL,
  review_date                  DATE NULL,
  created_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_sops_created_at DEFAULT SYSUTCDATETIME(),
  updated_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_sops_updated_at DEFAULT SYSUTCDATETIME(),
  attachment_data_url          NVARCHAR(MAX) NULL,
  attachment_name              NVARCHAR(255) NULL,
  attachment_mime              NVARCHAR(120) NULL,
  purpose                      NVARCHAR(MAX) NULL,
  scope                        NVARCHAR(MAX) NULL,
  process_flow                 NVARCHAR(MAX) NULL,
  roles_responsibilities       NVARCHAR(MAX) NULL,
  inputs_outputs               NVARCHAR(MAX) NULL,
  tools_forms                  NVARCHAR(MAX) NULL,
  kpis                         NVARCHAR(MAX) NULL,
  ownership_review             NVARCHAR(MAX) NULL,
  appendices                   NVARCHAR(MAX) NULL,
  signatures_approval          NVARCHAR(MAX) NULL,
  brand_is_function            BIT NOT NULL CONSTRAINT DF_sops_brand_is_function DEFAULT 0,
  is_all_departments           BIT NOT NULL CONSTRAINT DF_sops_is_all_departments DEFAULT 0,
  home_domain_id               INT NULL,
  CONSTRAINT sops_pkey PRIMARY KEY (id)
);

CREATE TABLE dbo.user_brands (
  user_id                      INT NOT NULL,
  brand_id                     INT NOT NULL,
  created_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_user_brands_created_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT user_brands_pkey PRIMARY KEY (user_id, brand_id)
);

CREATE TABLE dbo.user_departments (
  user_id                      INT NOT NULL,
  department_id                INT NOT NULL,
  created_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_user_departments_created_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT user_departments_pkey PRIMARY KEY (user_id, department_id)
);

CREATE TABLE dbo.user_domains (
  user_id                      INT NOT NULL,
  domain_id                    INT NOT NULL,
  created_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_user_domains_created_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT user_domains_pkey PRIMARY KEY (user_id, domain_id)
);

CREATE TABLE dbo.users (
  id                           INT IDENTITY(1,1) NOT NULL,
  email                        NVARCHAR(255) NOT NULL,
  password_hash                NVARCHAR(255) NOT NULL,
  display_name                 NVARCHAR(255) NOT NULL,
  role                         NVARCHAR(40) NOT NULL CONSTRAINT DF_users_role DEFAULT N'viewer',
  brand_id                     INT NULL,
  department_id                INT NULL,
  is_active                    BIT NOT NULL CONSTRAINT DF_users_is_active DEFAULT 1,
  created_at                   DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_users_created_at DEFAULT SYSUTCDATETIME(),
  last_login_at                DATETIMEOFFSET(3) NULL,
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_email_key UNIQUE (email)
);

-- UNIQUE on nullable columns: PostgreSQL allows many NULLs, SQL Server's
-- UNIQUE constraint allows one. A filtered index keeps PostgreSQL's rule.
CREATE UNIQUE INDEX checklist_templates_code_key ON dbo.checklist_templates (code) WHERE code IS NOT NULL;
CREATE UNIQUE INDEX checks_code_key ON dbo.checks (code) WHERE code IS NOT NULL;
CREATE UNIQUE INDEX controls_code_key ON dbo.controls (code) WHERE code IS NOT NULL;
CREATE UNIQUE INDEX corrective_actions_code_key ON dbo.corrective_actions (code) WHERE code IS NOT NULL;
CREATE UNIQUE INDEX sops_code_key ON dbo.sops (code) WHERE code IS NOT NULL;

-- Indexes
CREATE INDEX idx_audit_attachments_audit ON dbo.audit_attachments (audit_id, uploaded_at DESC);
CREATE INDEX idx_audit_logs_created ON dbo.audit_logs (created_at DESC);
CREATE INDEX idx_audit_logs_user ON dbo.audit_logs (user_id);
CREATE INDEX idx_responses_audit ON dbo.audit_responses (audit_id);
CREATE INDEX idx_audit_sops_sop ON dbo.audit_sops (sop_id);
CREATE INDEX idx_audit_tests_audit ON dbo.audit_tests (audit_id);
CREATE INDEX idx_audit_tests_check ON dbo.audit_tests (check_id);
CREATE INDEX idx_audits_assigned_to ON dbo.audits (assigned_to);
CREATE INDEX idx_audits_auditee ON dbo.audits (auditee_id);
CREATE INDEX idx_audits_auditor ON dbo.audits (auditor_id);
CREATE INDEX idx_audits_brand ON dbo.audits (brand_id);
CREATE INDEX idx_audits_control ON dbo.audits (control_id);
CREATE INDEX idx_audits_date ON dbo.audits (audit_date DESC);
CREATE INDEX idx_audits_domain ON dbo.audits (domain_id);
CREATE INDEX idx_audits_framework ON dbo.audits (framework_id);
CREATE INDEX idx_audits_policy ON dbo.audits (policy_id);
CREATE INDEX idx_audits_reviewer ON dbo.audits (reviewer_id);
CREATE INDEX idx_audits_start_at ON dbo.audits (start_at);
CREATE INDEX idx_audits_status ON dbo.audits (status);
CREATE INDEX idx_capa_evidences_capa ON dbo.capa_evidences (capa_id, uploaded_at DESC);
CREATE INDEX idx_cci_check ON dbo.check_checklist_items (check_id);
CREATE INDEX idx_cci_item ON dbo.check_checklist_items (checklist_item_id);
CREATE INDEX idx_check_results_check ON dbo.check_results (check_id, created_at DESC);
CREATE INDEX idx_check_results_checklist_template ON dbo.check_results (checklist_template_id);
CREATE INDEX idx_cia_item_latest ON dbo.checklist_item_answers (item_id, answered_at DESC);
CREATE INDEX idx_cia_user ON dbo.checklist_item_answers (answered_by);
CREATE INDEX idx_checklist_items_section ON dbo.checklist_items (section);
CREATE INDEX idx_checklist_items_tpl ON dbo.checklist_items (template_id, sort_order);
CREATE UNIQUE INDEX uq_checklist_items_code ON dbo.checklist_items (code) WHERE code IS NOT NULL;
CREATE INDEX idx_checklist_tpl_active ON dbo.checklist_templates (is_active);
CREATE INDEX idx_checklist_tpl_category ON dbo.checklist_templates (category);
CREATE INDEX idx_checks_checklist_template ON dbo.checks (checklist_template_id);
CREATE INDEX idx_checks_control ON dbo.checks (control_id);
CREATE INDEX idx_checks_status ON dbo.checks (last_status);
CREATE INDEX idx_config_kind_active ON dbo.config_options (kind, is_active, sort_order);
CREATE INDEX idx_control_links_entity ON dbo.control_links (entity_type, entity_id);
CREATE INDEX idx_controls_framework ON dbo.controls (framework_id);
CREATE INDEX idx_controls_health ON dbo.controls (health_status);
CREATE INDEX idx_capa_assignee ON dbo.corrective_actions (assigned_to);
CREATE INDEX idx_capa_audit ON dbo.corrective_actions (source_audit_id);
CREATE INDEX idx_capa_due ON dbo.corrective_actions (due_date);
CREATE INDEX idx_capa_reviewer ON dbo.corrective_actions (reviewer_id);
CREATE INDEX idx_capa_status ON dbo.corrective_actions (status);
CREATE INDEX idx_deleted_records_deleted_at ON dbo.deleted_records (deleted_at DESC);
CREATE INDEX idx_deleted_records_entity ON dbo.deleted_records (entity_type, entity_id);
CREATE INDEX idx_departments_division ON dbo.departments (division_id);
CREATE INDEX idx_departments_manager ON dbo.departments (manager_id);
CREATE INDEX idx_departments_parent ON dbo.departments (parent_department_id);
CREATE UNIQUE INDEX uq_departments_code ON dbo.departments (code) WHERE code IS NOT NULL;
CREATE INDEX idx_domains_dept ON dbo.domains (department_id);
CREATE INDEX idx_domains_sop ON dbo.domains (sop_id);
CREATE INDEX idx_evidence_entity ON dbo.evidence_files (entity_type, entity_id);
CREATE INDEX idx_frameworks_dept ON dbo.frameworks (department_id);
CREATE INDEX idx_frameworks_domain ON dbo.frameworks (domain_id);
CREATE INDEX idx_frameworks_sop ON dbo.frameworks (sop_id);
CREATE INDEX idx_notif_entity ON dbo.notifications (entity_type, entity_id);
CREATE INDEX idx_notif_user_created ON dbo.notifications (user_id, created_at DESC);
CREATE INDEX idx_notif_user_unread ON dbo.notifications (user_id, is_read, created_at DESC);
CREATE INDEX idx_org_units_level ON dbo.org_units (level);
CREATE INDEX idx_org_units_parent ON dbo.org_units (parent_id, sort_order);
CREATE INDEX idx_sop_ack_at ON dbo.sop_acknowledgments (acknowledged_at DESC);
CREATE INDEX idx_sop_ack_sop ON dbo.sop_acknowledgments (sop_id);
CREATE INDEX idx_sop_ack_user ON dbo.sop_acknowledgments (user_id);
CREATE INDEX idx_sop_departments_dept ON dbo.sop_departments (department_id);
CREATE INDEX idx_sop_versions_sop ON dbo.sop_versions (sop_id);
CREATE INDEX idx_sops_brand ON dbo.sops (brand_id);
CREATE INDEX idx_sops_department ON dbo.sops (department_id);
CREATE INDEX idx_sops_home_domain ON dbo.sops (home_domain_id);
CREATE INDEX idx_sops_status ON dbo.sops (status);
CREATE INDEX idx_user_brands_brand ON dbo.user_brands (brand_id);
CREATE INDEX idx_user_depts_dept ON dbo.user_departments (department_id);
CREATE INDEX idx_user_domains_domain ON dbo.user_domains (domain_id);
CREATE INDEX idx_users_email ON dbo.users (email);

-- Foreign keys. ON DELETE behaviour lives in the INSTEAD OF DELETE triggers below.
ALTER TABLE dbo.audit_attachments ADD CONSTRAINT audit_attachments_audit_id_fkey FOREIGN KEY (audit_id) REFERENCES dbo.audits (id);
ALTER TABLE dbo.audit_attachments ADD CONSTRAINT audit_attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES dbo.users (id);
ALTER TABLE dbo.audit_logs ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES dbo.users (id);
ALTER TABLE dbo.audit_responses ADD CONSTRAINT audit_responses_audit_id_fkey FOREIGN KEY (audit_id) REFERENCES dbo.audits (id);
ALTER TABLE dbo.audit_responses ADD CONSTRAINT audit_responses_item_id_fkey FOREIGN KEY (item_id) REFERENCES dbo.checklist_items (id);
ALTER TABLE dbo.audit_sops ADD CONSTRAINT audit_sops_audit_id_fkey FOREIGN KEY (audit_id) REFERENCES dbo.audits (id);
ALTER TABLE dbo.audit_sops ADD CONSTRAINT audit_sops_sop_id_fkey FOREIGN KEY (sop_id) REFERENCES dbo.sops (id);
ALTER TABLE dbo.audit_tests ADD CONSTRAINT audit_tests_audit_id_fkey FOREIGN KEY (audit_id) REFERENCES dbo.audits (id);
ALTER TABLE dbo.audit_tests ADD CONSTRAINT audit_tests_check_id_fkey FOREIGN KEY (check_id) REFERENCES dbo.checks (id);
ALTER TABLE dbo.audits ADD CONSTRAINT audits_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES dbo.users (id);
ALTER TABLE dbo.audits ADD CONSTRAINT audits_auditee_id_fkey FOREIGN KEY (auditee_id) REFERENCES dbo.users (id);
ALTER TABLE dbo.audits ADD CONSTRAINT audits_auditor_id_fkey FOREIGN KEY (auditor_id) REFERENCES dbo.users (id);
ALTER TABLE dbo.audits ADD CONSTRAINT audits_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES dbo.brands (id);
ALTER TABLE dbo.audits ADD CONSTRAINT audits_control_id_fkey FOREIGN KEY (control_id) REFERENCES dbo.controls (id);
ALTER TABLE dbo.audits ADD CONSTRAINT audits_department_id_fkey FOREIGN KEY (department_id) REFERENCES dbo.departments (id);
ALTER TABLE dbo.audits ADD CONSTRAINT audits_domain_id_fkey FOREIGN KEY (domain_id) REFERENCES dbo.domains (id);
ALTER TABLE dbo.audits ADD CONSTRAINT audits_framework_id_fkey FOREIGN KEY (framework_id) REFERENCES dbo.frameworks (id);
ALTER TABLE dbo.audits ADD CONSTRAINT audits_policy_id_fkey FOREIGN KEY (policy_id) REFERENCES dbo.sops (id);
ALTER TABLE dbo.audits ADD CONSTRAINT audits_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES dbo.users (id);
ALTER TABLE dbo.audits ADD CONSTRAINT audits_template_id_fkey FOREIGN KEY (template_id) REFERENCES dbo.checklist_templates (id);
ALTER TABLE dbo.capa_evidences ADD CONSTRAINT capa_evidences_capa_id_fkey FOREIGN KEY (capa_id) REFERENCES dbo.corrective_actions (id);
ALTER TABLE dbo.capa_evidences ADD CONSTRAINT capa_evidences_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES dbo.users (id);
ALTER TABLE dbo.check_checklist_items ADD CONSTRAINT check_checklist_items_check_id_fkey FOREIGN KEY (check_id) REFERENCES dbo.checks (id);
ALTER TABLE dbo.check_checklist_items ADD CONSTRAINT check_checklist_items_checklist_item_id_fkey FOREIGN KEY (checklist_item_id) REFERENCES dbo.checklist_items (id);
ALTER TABLE dbo.check_results ADD CONSTRAINT check_results_check_id_fkey FOREIGN KEY (check_id) REFERENCES dbo.checks (id);
ALTER TABLE dbo.check_results ADD CONSTRAINT check_results_checklist_template_id_fkey FOREIGN KEY (checklist_template_id) REFERENCES dbo.checklist_templates (id);
ALTER TABLE dbo.check_results ADD CONSTRAINT check_results_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES dbo.users (id);
ALTER TABLE dbo.checklist_item_answers ADD CONSTRAINT checklist_item_answers_answered_by_fkey FOREIGN KEY (answered_by) REFERENCES dbo.users (id);
ALTER TABLE dbo.checklist_item_answers ADD CONSTRAINT checklist_item_answers_item_id_fkey FOREIGN KEY (item_id) REFERENCES dbo.checklist_items (id);
ALTER TABLE dbo.checklist_items ADD CONSTRAINT checklist_items_template_id_fkey FOREIGN KEY (template_id) REFERENCES dbo.checklist_templates (id);
ALTER TABLE dbo.checklist_templates ADD CONSTRAINT checklist_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES dbo.users (id);
ALTER TABLE dbo.checks ADD CONSTRAINT checks_checklist_template_id_fkey FOREIGN KEY (checklist_template_id) REFERENCES dbo.checklist_templates (id);
ALTER TABLE dbo.checks ADD CONSTRAINT checks_control_id_fkey FOREIGN KEY (control_id) REFERENCES dbo.controls (id);
ALTER TABLE dbo.checks ADD CONSTRAINT checks_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES dbo.users (id);
ALTER TABLE dbo.control_links ADD CONSTRAINT control_links_control_id_fkey FOREIGN KEY (control_id) REFERENCES dbo.controls (id);
ALTER TABLE dbo.control_links ADD CONSTRAINT control_links_created_by_fkey FOREIGN KEY (created_by) REFERENCES dbo.users (id);
ALTER TABLE dbo.controls ADD CONSTRAINT controls_framework_id_fkey FOREIGN KEY (framework_id) REFERENCES dbo.frameworks (id);
ALTER TABLE dbo.controls ADD CONSTRAINT controls_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES dbo.users (id);
ALTER TABLE dbo.corrective_actions ADD CONSTRAINT corrective_actions_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES dbo.users (id);
ALTER TABLE dbo.corrective_actions ADD CONSTRAINT corrective_actions_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES dbo.brands (id);
ALTER TABLE dbo.corrective_actions ADD CONSTRAINT corrective_actions_created_by_fkey FOREIGN KEY (created_by) REFERENCES dbo.users (id);
ALTER TABLE dbo.corrective_actions ADD CONSTRAINT corrective_actions_department_id_fkey FOREIGN KEY (department_id) REFERENCES dbo.departments (id);
ALTER TABLE dbo.corrective_actions ADD CONSTRAINT corrective_actions_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES dbo.users (id);
ALTER TABLE dbo.corrective_actions ADD CONSTRAINT corrective_actions_source_audit_id_fkey FOREIGN KEY (source_audit_id) REFERENCES dbo.audits (id);
ALTER TABLE dbo.corrective_actions ADD CONSTRAINT corrective_actions_source_item_id_fkey FOREIGN KEY (source_item_id) REFERENCES dbo.checklist_items (id);
ALTER TABLE dbo.corrective_actions ADD CONSTRAINT corrective_actions_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES dbo.users (id);
ALTER TABLE dbo.deleted_records ADD CONSTRAINT deleted_records_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES dbo.users (id);
ALTER TABLE dbo.departments ADD CONSTRAINT departments_division_id_fkey FOREIGN KEY (division_id) REFERENCES dbo.divisions (id);
ALTER TABLE dbo.departments ADD CONSTRAINT departments_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES dbo.users (id);
ALTER TABLE dbo.departments ADD CONSTRAINT departments_parent_department_id_fkey FOREIGN KEY (parent_department_id) REFERENCES dbo.departments (id);
ALTER TABLE dbo.domains ADD CONSTRAINT domains_department_id_fkey FOREIGN KEY (department_id) REFERENCES dbo.departments (id);
ALTER TABLE dbo.domains ADD CONSTRAINT domains_sop_id_fkey FOREIGN KEY (sop_id) REFERENCES dbo.sops (id);
ALTER TABLE dbo.evidence_files ADD CONSTRAINT evidence_files_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES dbo.users (id);
ALTER TABLE dbo.frameworks ADD CONSTRAINT frameworks_activated_by_fkey FOREIGN KEY (activated_by) REFERENCES dbo.users (id);
ALTER TABLE dbo.frameworks ADD CONSTRAINT frameworks_department_id_fkey FOREIGN KEY (department_id) REFERENCES dbo.departments (id);
ALTER TABLE dbo.frameworks ADD CONSTRAINT frameworks_domain_id_fkey FOREIGN KEY (domain_id) REFERENCES dbo.domains (id);
ALTER TABLE dbo.frameworks ADD CONSTRAINT frameworks_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES dbo.users (id);
ALTER TABLE dbo.frameworks ADD CONSTRAINT frameworks_sop_id_fkey FOREIGN KEY (sop_id) REFERENCES dbo.sops (id);
ALTER TABLE dbo.notifications ADD CONSTRAINT notifications_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES dbo.users (id);
ALTER TABLE dbo.notifications ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES dbo.users (id);
ALTER TABLE dbo.org_units ADD CONSTRAINT org_units_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES dbo.org_units (id);
ALTER TABLE dbo.sop_acknowledgments ADD CONSTRAINT sop_acknowledgments_sop_id_fkey FOREIGN KEY (sop_id) REFERENCES dbo.sops (id);
ALTER TABLE dbo.sop_acknowledgments ADD CONSTRAINT sop_acknowledgments_user_id_fkey FOREIGN KEY (user_id) REFERENCES dbo.users (id);
ALTER TABLE dbo.sop_departments ADD CONSTRAINT sop_departments_department_id_fkey FOREIGN KEY (department_id) REFERENCES dbo.departments (id);
ALTER TABLE dbo.sop_departments ADD CONSTRAINT sop_departments_sop_id_fkey FOREIGN KEY (sop_id) REFERENCES dbo.sops (id);
ALTER TABLE dbo.sop_versions ADD CONSTRAINT sop_versions_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES dbo.users (id);
ALTER TABLE dbo.sop_versions ADD CONSTRAINT sop_versions_sop_id_fkey FOREIGN KEY (sop_id) REFERENCES dbo.sops (id);
ALTER TABLE dbo.sops ADD CONSTRAINT sops_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES dbo.users (id);
ALTER TABLE dbo.sops ADD CONSTRAINT sops_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES dbo.brands (id);
ALTER TABLE dbo.sops ADD CONSTRAINT sops_created_by_fkey FOREIGN KEY (created_by) REFERENCES dbo.users (id);
ALTER TABLE dbo.sops ADD CONSTRAINT sops_department_id_fkey FOREIGN KEY (department_id) REFERENCES dbo.departments (id);
ALTER TABLE dbo.sops ADD CONSTRAINT sops_home_domain_id_fkey FOREIGN KEY (home_domain_id) REFERENCES dbo.domains (id);
ALTER TABLE dbo.sops ADD CONSTRAINT sops_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES dbo.users (id);
ALTER TABLE dbo.user_brands ADD CONSTRAINT user_brands_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES dbo.brands (id);
ALTER TABLE dbo.user_brands ADD CONSTRAINT user_brands_user_id_fkey FOREIGN KEY (user_id) REFERENCES dbo.users (id);
ALTER TABLE dbo.user_departments ADD CONSTRAINT user_departments_department_id_fkey FOREIGN KEY (department_id) REFERENCES dbo.departments (id);
ALTER TABLE dbo.user_departments ADD CONSTRAINT user_departments_user_id_fkey FOREIGN KEY (user_id) REFERENCES dbo.users (id);
ALTER TABLE dbo.user_domains ADD CONSTRAINT user_domains_domain_id_fkey FOREIGN KEY (domain_id) REFERENCES dbo.domains (id);
ALTER TABLE dbo.user_domains ADD CONSTRAINT user_domains_user_id_fkey FOREIGN KEY (user_id) REFERENCES dbo.users (id);
ALTER TABLE dbo.users ADD CONSTRAINT users_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES dbo.brands (id);
ALTER TABLE dbo.users ADD CONSTRAINT users_department_id_fkey FOREIGN KEY (department_id) REFERENCES dbo.departments (id);

GO
CREATE TRIGGER dbo.trg_responses_updated_at ON dbo.audit_responses AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM inserted) RETURN;
  UPDATE t SET updated_at = SYSUTCDATETIME()
  FROM dbo.audit_responses t JOIN inserted i ON i.id = t.id;
END;
GO
CREATE TRIGGER dbo.trg_audits_updated_at ON dbo.audits AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM inserted) RETURN;
  UPDATE t SET updated_at = SYSUTCDATETIME()
  FROM dbo.audits t JOIN inserted i ON i.id = t.id;
END;
GO
CREATE TRIGGER dbo.trg_checklist_tpl_updated_at ON dbo.checklist_templates AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM inserted) RETURN;
  UPDATE t SET updated_at = SYSUTCDATETIME()
  FROM dbo.checklist_templates t JOIN inserted i ON i.id = t.id;
END;
GO
CREATE TRIGGER dbo.trg_checks_updated_at ON dbo.checks AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM inserted) RETURN;
  UPDATE t SET updated_at = SYSUTCDATETIME()
  FROM dbo.checks t JOIN inserted i ON i.id = t.id;
END;
GO
CREATE TRIGGER dbo.trg_config_options_updated_at ON dbo.config_options AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM inserted) RETURN;
  UPDATE t SET updated_at = SYSUTCDATETIME()
  FROM dbo.config_options t JOIN inserted i ON i.id = t.id;
END;
GO
CREATE TRIGGER dbo.trg_controls_updated_at ON dbo.controls AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM inserted) RETURN;
  UPDATE t SET updated_at = SYSUTCDATETIME()
  FROM dbo.controls t JOIN inserted i ON i.id = t.id;
END;
GO
CREATE TRIGGER dbo.trg_capa_updated_at ON dbo.corrective_actions AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM inserted) RETURN;
  UPDATE t SET updated_at = SYSUTCDATETIME()
  FROM dbo.corrective_actions t JOIN inserted i ON i.id = t.id;
END;
GO
CREATE TRIGGER dbo.trg_divisions_updated_at ON dbo.divisions AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM inserted) RETURN;
  UPDATE t SET updated_at = SYSUTCDATETIME()
  FROM dbo.divisions t JOIN inserted i ON i.id = t.id;
END;
GO
CREATE TRIGGER dbo.trg_domains_updated_at ON dbo.domains AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM inserted) RETURN;
  UPDATE t SET updated_at = SYSUTCDATETIME()
  FROM dbo.domains t JOIN inserted i ON i.id = t.id;
END;
GO
CREATE TRIGGER dbo.trg_frameworks_updated_at ON dbo.frameworks AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM inserted) RETURN;
  UPDATE t SET updated_at = SYSUTCDATETIME()
  FROM dbo.frameworks t JOIN inserted i ON i.id = t.id;
END;
GO
CREATE TRIGGER dbo.trg_org_units_updated_at ON dbo.org_units AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM inserted) RETURN;
  UPDATE t SET updated_at = SYSUTCDATETIME()
  FROM dbo.org_units t JOIN inserted i ON i.id = t.id;
END;
GO
CREATE TRIGGER dbo.trg_sops_updated_at ON dbo.sops AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM inserted) RETURN;
  UPDATE t SET updated_at = SYSUTCDATETIME()
  FROM dbo.sops t JOIN inserted i ON i.id = t.id;
END;
GO
CREATE TRIGGER dbo.trg_audits_on_delete ON dbo.audits INSTEAD OF DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM deleted) RETURN;
  DELETE FROM dbo.audit_attachments WHERE audit_id IN (SELECT id FROM deleted);
  DELETE FROM dbo.audit_responses WHERE audit_id IN (SELECT id FROM deleted);
  DELETE FROM dbo.audit_sops WHERE audit_id IN (SELECT id FROM deleted);
  DELETE FROM dbo.audit_tests WHERE audit_id IN (SELECT id FROM deleted);
  UPDATE dbo.corrective_actions SET source_audit_id = NULL WHERE source_audit_id IN (SELECT id FROM deleted);
  DELETE FROM dbo.audits WHERE id IN (SELECT id FROM deleted);
END;
GO
CREATE TRIGGER dbo.trg_brands_on_delete ON dbo.brands INSTEAD OF DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM deleted) RETURN;
  DELETE FROM dbo.user_brands WHERE brand_id IN (SELECT id FROM deleted);
  UPDATE dbo.audits SET brand_id = NULL WHERE brand_id IN (SELECT id FROM deleted);
  UPDATE dbo.corrective_actions SET brand_id = NULL WHERE brand_id IN (SELECT id FROM deleted);
  UPDATE dbo.sops SET brand_id = NULL WHERE brand_id IN (SELECT id FROM deleted);
  UPDATE dbo.users SET brand_id = NULL WHERE brand_id IN (SELECT id FROM deleted);
  DELETE FROM dbo.brands WHERE id IN (SELECT id FROM deleted);
END;
GO
CREATE TRIGGER dbo.trg_checklist_items_on_delete ON dbo.checklist_items INSTEAD OF DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM deleted) RETURN;
  DELETE FROM dbo.audit_responses WHERE item_id IN (SELECT id FROM deleted);
  DELETE FROM dbo.check_checklist_items WHERE checklist_item_id IN (SELECT id FROM deleted);
  DELETE FROM dbo.checklist_item_answers WHERE item_id IN (SELECT id FROM deleted);
  UPDATE dbo.corrective_actions SET source_item_id = NULL WHERE source_item_id IN (SELECT id FROM deleted);
  DELETE FROM dbo.checklist_items WHERE id IN (SELECT id FROM deleted);
END;
GO
CREATE TRIGGER dbo.trg_checklist_templates_on_delete ON dbo.checklist_templates INSTEAD OF DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM deleted) RETURN;
  DELETE FROM dbo.checklist_items WHERE template_id IN (SELECT id FROM deleted);
  UPDATE dbo.check_results SET checklist_template_id = NULL WHERE checklist_template_id IN (SELECT id FROM deleted);
  UPDATE dbo.checks SET checklist_template_id = NULL WHERE checklist_template_id IN (SELECT id FROM deleted);
  DELETE FROM dbo.checklist_templates WHERE id IN (SELECT id FROM deleted);
END;
GO
CREATE TRIGGER dbo.trg_checks_on_delete ON dbo.checks INSTEAD OF DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM deleted) RETURN;
  DELETE FROM dbo.audit_tests WHERE check_id IN (SELECT id FROM deleted);
  DELETE FROM dbo.check_checklist_items WHERE check_id IN (SELECT id FROM deleted);
  DELETE FROM dbo.check_results WHERE check_id IN (SELECT id FROM deleted);
  DELETE FROM dbo.checks WHERE id IN (SELECT id FROM deleted);
END;
GO
CREATE TRIGGER dbo.trg_controls_on_delete ON dbo.controls INSTEAD OF DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM deleted) RETURN;
  DELETE FROM dbo.control_links WHERE control_id IN (SELECT id FROM deleted);
  UPDATE dbo.audits SET control_id = NULL WHERE control_id IN (SELECT id FROM deleted);
  UPDATE dbo.checks SET control_id = NULL WHERE control_id IN (SELECT id FROM deleted);
  DELETE FROM dbo.controls WHERE id IN (SELECT id FROM deleted);
END;
GO
CREATE TRIGGER dbo.trg_corrective_actions_on_delete ON dbo.corrective_actions INSTEAD OF DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM deleted) RETURN;
  DELETE FROM dbo.capa_evidences WHERE capa_id IN (SELECT id FROM deleted);
  DELETE FROM dbo.corrective_actions WHERE id IN (SELECT id FROM deleted);
END;
GO
CREATE TRIGGER dbo.trg_departments_on_delete ON dbo.departments INSTEAD OF DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM deleted) RETURN;
  DELETE FROM dbo.sop_departments WHERE department_id IN (SELECT id FROM deleted);
  DELETE FROM dbo.user_departments WHERE department_id IN (SELECT id FROM deleted);
  UPDATE dbo.audits SET department_id = NULL WHERE department_id IN (SELECT id FROM deleted);
  UPDATE dbo.corrective_actions SET department_id = NULL WHERE department_id IN (SELECT id FROM deleted);
  UPDATE dbo.departments SET parent_department_id = NULL WHERE parent_department_id IN (SELECT id FROM deleted);
  UPDATE dbo.domains SET department_id = NULL WHERE department_id IN (SELECT id FROM deleted);
  UPDATE dbo.frameworks SET department_id = NULL WHERE department_id IN (SELECT id FROM deleted);
  UPDATE dbo.sops SET department_id = NULL WHERE department_id IN (SELECT id FROM deleted);
  UPDATE dbo.users SET department_id = NULL WHERE department_id IN (SELECT id FROM deleted);
  DELETE FROM dbo.departments WHERE id IN (SELECT id FROM deleted);
END;
GO
CREATE TRIGGER dbo.trg_divisions_on_delete ON dbo.divisions INSTEAD OF DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM deleted) RETURN;
  UPDATE dbo.departments SET division_id = NULL WHERE division_id IN (SELECT id FROM deleted);
  DELETE FROM dbo.divisions WHERE id IN (SELECT id FROM deleted);
END;
GO
CREATE TRIGGER dbo.trg_domains_on_delete ON dbo.domains INSTEAD OF DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM deleted) RETURN;
  DELETE FROM dbo.user_domains WHERE domain_id IN (SELECT id FROM deleted);
  UPDATE dbo.audits SET domain_id = NULL WHERE domain_id IN (SELECT id FROM deleted);
  UPDATE dbo.frameworks SET domain_id = NULL WHERE domain_id IN (SELECT id FROM deleted);
  UPDATE dbo.sops SET home_domain_id = NULL WHERE home_domain_id IN (SELECT id FROM deleted);
  DELETE FROM dbo.domains WHERE id IN (SELECT id FROM deleted);
END;
GO
CREATE TRIGGER dbo.trg_frameworks_on_delete ON dbo.frameworks INSTEAD OF DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM deleted) RETURN;
  UPDATE dbo.audits SET framework_id = NULL WHERE framework_id IN (SELECT id FROM deleted);
  UPDATE dbo.controls SET framework_id = NULL WHERE framework_id IN (SELECT id FROM deleted);
  DELETE FROM dbo.frameworks WHERE id IN (SELECT id FROM deleted);
END;
GO
CREATE TRIGGER dbo.trg_org_units_on_delete ON dbo.org_units INSTEAD OF DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM deleted) RETURN;
  DECLARE @ids TABLE (id INT PRIMARY KEY);
  WITH tree AS (
    SELECT id FROM deleted
    UNION ALL
    SELECT c.id FROM dbo.org_units c JOIN tree ON c.parent_id = tree.id
  )
  INSERT INTO @ids (id) SELECT DISTINCT id FROM tree OPTION (MAXRECURSION 0);
  DELETE FROM dbo.org_units WHERE id IN (SELECT id FROM @ids);
END;
GO
CREATE TRIGGER dbo.trg_sops_on_delete ON dbo.sops INSTEAD OF DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM deleted) RETURN;
  DELETE FROM dbo.audit_sops WHERE sop_id IN (SELECT id FROM deleted);
  DELETE FROM dbo.sop_acknowledgments WHERE sop_id IN (SELECT id FROM deleted);
  DELETE FROM dbo.sop_departments WHERE sop_id IN (SELECT id FROM deleted);
  DELETE FROM dbo.sop_versions WHERE sop_id IN (SELECT id FROM deleted);
  UPDATE dbo.audits SET policy_id = NULL WHERE policy_id IN (SELECT id FROM deleted);
  UPDATE dbo.domains SET sop_id = NULL WHERE sop_id IN (SELECT id FROM deleted);
  UPDATE dbo.frameworks SET sop_id = NULL WHERE sop_id IN (SELECT id FROM deleted);
  DELETE FROM dbo.sops WHERE id IN (SELECT id FROM deleted);
END;
GO
CREATE TRIGGER dbo.trg_users_on_delete ON dbo.users INSTEAD OF DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM deleted) RETURN;
  DELETE FROM dbo.notifications WHERE user_id IN (SELECT id FROM deleted);
  DELETE FROM dbo.sop_acknowledgments WHERE user_id IN (SELECT id FROM deleted);
  DELETE FROM dbo.user_brands WHERE user_id IN (SELECT id FROM deleted);
  DELETE FROM dbo.user_departments WHERE user_id IN (SELECT id FROM deleted);
  DELETE FROM dbo.user_domains WHERE user_id IN (SELECT id FROM deleted);
  UPDATE dbo.audit_attachments SET uploaded_by = NULL WHERE uploaded_by IN (SELECT id FROM deleted);
  UPDATE dbo.audit_logs SET user_id = NULL WHERE user_id IN (SELECT id FROM deleted);
  UPDATE dbo.audits SET assigned_to = NULL WHERE assigned_to IN (SELECT id FROM deleted);
  UPDATE dbo.audits SET auditee_id = NULL WHERE auditee_id IN (SELECT id FROM deleted);
  UPDATE dbo.audits SET auditor_id = NULL WHERE auditor_id IN (SELECT id FROM deleted);
  UPDATE dbo.audits SET reviewer_id = NULL WHERE reviewer_id IN (SELECT id FROM deleted);
  UPDATE dbo.capa_evidences SET uploaded_by = NULL WHERE uploaded_by IN (SELECT id FROM deleted);
  UPDATE dbo.check_results SET performed_by = NULL WHERE performed_by IN (SELECT id FROM deleted);
  UPDATE dbo.checklist_item_answers SET answered_by = NULL WHERE answered_by IN (SELECT id FROM deleted);
  UPDATE dbo.checklist_templates SET created_by = NULL WHERE created_by IN (SELECT id FROM deleted);
  UPDATE dbo.checks SET owner_user_id = NULL WHERE owner_user_id IN (SELECT id FROM deleted);
  UPDATE dbo.control_links SET created_by = NULL WHERE created_by IN (SELECT id FROM deleted);
  UPDATE dbo.controls SET owner_user_id = NULL WHERE owner_user_id IN (SELECT id FROM deleted);
  UPDATE dbo.corrective_actions SET assigned_to = NULL WHERE assigned_to IN (SELECT id FROM deleted);
  UPDATE dbo.corrective_actions SET created_by = NULL WHERE created_by IN (SELECT id FROM deleted);
  UPDATE dbo.corrective_actions SET reviewer_id = NULL WHERE reviewer_id IN (SELECT id FROM deleted);
  UPDATE dbo.corrective_actions SET verified_by = NULL WHERE verified_by IN (SELECT id FROM deleted);
  UPDATE dbo.deleted_records SET deleted_by = NULL WHERE deleted_by IN (SELECT id FROM deleted);
  UPDATE dbo.departments SET manager_id = NULL WHERE manager_id IN (SELECT id FROM deleted);
  UPDATE dbo.evidence_files SET uploaded_by = NULL WHERE uploaded_by IN (SELECT id FROM deleted);
  UPDATE dbo.frameworks SET activated_by = NULL WHERE activated_by IN (SELECT id FROM deleted);
  UPDATE dbo.frameworks SET owner_user_id = NULL WHERE owner_user_id IN (SELECT id FROM deleted);
  UPDATE dbo.notifications SET actor_id = NULL WHERE actor_id IN (SELECT id FROM deleted);
  UPDATE dbo.sop_versions SET changed_by = NULL WHERE changed_by IN (SELECT id FROM deleted);
  UPDATE dbo.sops SET approved_by = NULL WHERE approved_by IN (SELECT id FROM deleted);
  UPDATE dbo.sops SET created_by = NULL WHERE created_by IN (SELECT id FROM deleted);
  UPDATE dbo.sops SET owner_id = NULL WHERE owner_id IN (SELECT id FROM deleted);
  DELETE FROM dbo.users WHERE id IN (SELECT id FROM deleted);
END;
GO
