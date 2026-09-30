/*
 * Reference rows the PostgreSQL edition seeds in its migrations (brands,
 * departments, divisions, config options, the org-unit tree). Ids are kept
 * so parent/child links inside the seed stay intact. created_at/updated_at
 * are left to their defaults.
 */

SET IDENTITY_INSERT dbo.brands ON;
INSERT INTO dbo.brands (id, name, is_active) VALUES (1, N'Verdi', 1);
INSERT INTO dbo.brands (id, name, is_active) VALUES (2, N'Ordable', 1);
INSERT INTO dbo.brands (id, name, is_active) VALUES (3, N'Mishmash', 1);
INSERT INTO dbo.brands (id, name, is_active) VALUES (4, N'Swish Catering', 1);
SET IDENTITY_INSERT dbo.brands OFF;

SET IDENTITY_INSERT dbo.divisions ON;
INSERT INTO dbo.divisions (id, code, name, sort_order, is_active) VALUES (1, N'DIV-BEX', N'Business Excellence Division', 1, 1);
INSERT INTO dbo.divisions (id, code, name, sort_order, is_active) VALUES (2, N'DIV-CX', N'Customer Experience Division', 2, 1);
INSERT INTO dbo.divisions (id, code, name, sort_order, is_active) VALUES (3, N'DIV-HR', N'Human Resources Division', 3, 1);
INSERT INTO dbo.divisions (id, code, name, sort_order, is_active) VALUES (4, N'DIV-IT', N'Information Technology Division', 4, 1);
INSERT INTO dbo.divisions (id, code, name, sort_order, is_active) VALUES (5, N'DIV-ADM', N'Admin & Government Formalities Division', 5, 1);
INSERT INTO dbo.divisions (id, code, name, sort_order, is_active) VALUES (6, N'DIV-FIN', N'Finance Division', 6, 1);
INSERT INTO dbo.divisions (id, code, name, sort_order, is_active) VALUES (7, N'DIV-SC', N'Supply Chain Division', 7, 1);
INSERT INTO dbo.divisions (id, code, name, sort_order, is_active) VALUES (8, N'DIV-WL', N'Warehouse & Logistics Division', 8, 1);
INSERT INTO dbo.divisions (id, code, name, sort_order, is_active) VALUES (9, N'DIV-PROD', N'Production Division', 9, 1);
INSERT INTO dbo.divisions (id, code, name, sort_order, is_active) VALUES (10, N'DIV-RD', N'R&D Division', 10, 1);
INSERT INTO dbo.divisions (id, code, name, sort_order, is_active) VALUES (11, N'DIV-PL', N'Property & Leasing Division', 11, 1);
INSERT INTO dbo.divisions (id, code, name, sort_order, is_active) VALUES (12, N'DIV-MKT', N'Marketing Division', 12, 1);
INSERT INTO dbo.divisions (id, code, name, sort_order, is_active) VALUES (13, N'DIV-LOG', N'Digital Commerce Division', 13, 1);
SET IDENTITY_INSERT dbo.divisions OFF;

SET IDENTITY_INSERT dbo.departments ON;
INSERT INTO dbo.departments (id, name, is_active, division_id, parent_department_id, code, manager_id) VALUES (1, N'Quality', 1, NULL, NULL, NULL, NULL);
INSERT INTO dbo.departments (id, name, is_active, division_id, parent_department_id, code, manager_id) VALUES (2, N'Operations', 1, NULL, NULL, NULL, NULL);
INSERT INTO dbo.departments (id, name, is_active, division_id, parent_department_id, code, manager_id) VALUES (3, N'Kitchen', 1, NULL, NULL, NULL, NULL);
INSERT INTO dbo.departments (id, name, is_active, division_id, parent_department_id, code, manager_id) VALUES (4, N'Front of House', 1, NULL, NULL, NULL, NULL);
INSERT INTO dbo.departments (id, name, is_active, division_id, parent_department_id, code, manager_id) VALUES (5, N'Procurement', 1, NULL, NULL, NULL, NULL);
INSERT INTO dbo.departments (id, name, is_active, division_id, parent_department_id, code, manager_id) VALUES (6, N'HR', 1, NULL, NULL, NULL, NULL);
INSERT INTO dbo.departments (id, name, is_active, division_id, parent_department_id, code, manager_id) VALUES (7, N'Finance', 1, NULL, NULL, NULL, NULL);
INSERT INTO dbo.departments (id, name, is_active, division_id, parent_department_id, code, manager_id) VALUES (8, N'IT', 1, NULL, NULL, NULL, NULL);
SET IDENTITY_INSERT dbo.departments OFF;

SET IDENTITY_INSERT dbo.config_options ON;
INSERT INTO dbo.config_options (id, kind, value, label, sort_order, is_active) VALUES (1, N'checklist_category', N'food_safety', N'Food Safety', 1, 1);
INSERT INTO dbo.config_options (id, kind, value, label, sort_order, is_active) VALUES (2, N'checklist_category', N'fire_safety', N'Fire Safety', 2, 1);
INSERT INTO dbo.config_options (id, kind, value, label, sort_order, is_active) VALUES (3, N'checklist_category', N'cleanliness', N'Cleanliness', 3, 1);
INSERT INTO dbo.config_options (id, kind, value, label, sort_order, is_active) VALUES (4, N'checklist_category', N'customer_experience', N'Customer Experience', 4, 1);
INSERT INTO dbo.config_options (id, kind, value, label, sort_order, is_active) VALUES (5, N'checklist_category', N'hr_training', N'HR / Training', 5, 1);
INSERT INTO dbo.config_options (id, kind, value, label, sort_order, is_active) VALUES (6, N'checklist_category', N'equipment', N'Equipment / Maintenance', 6, 1);
INSERT INTO dbo.config_options (id, kind, value, label, sort_order, is_active) VALUES (7, N'checklist_category', N'other', N'Other', 7, 1);
INSERT INTO dbo.config_options (id, kind, value, label, sort_order, is_active) VALUES (8, N'framework_category', N'food_safety', N'Food Safety', 1, 1);
INSERT INTO dbo.config_options (id, kind, value, label, sort_order, is_active) VALUES (9, N'framework_category', N'hse', N'HSE', 2, 1);
INSERT INTO dbo.config_options (id, kind, value, label, sort_order, is_active) VALUES (10, N'framework_category', N'legal', N'Legal', 3, 1);
INSERT INTO dbo.config_options (id, kind, value, label, sort_order, is_active) VALUES (11, N'framework_category', N'quality', N'Quality', 4, 1);
INSERT INTO dbo.config_options (id, kind, value, label, sort_order, is_active) VALUES (12, N'framework_category', N'environment', N'Environment', 5, 1);
INSERT INTO dbo.config_options (id, kind, value, label, sort_order, is_active) VALUES (13, N'framework_category', N'other', N'Other', 6, 1);
INSERT INTO dbo.config_options (id, kind, value, label, sort_order, is_active) VALUES (14, N'control_category', N'preventive', N'Preventive', 1, 1);
INSERT INTO dbo.config_options (id, kind, value, label, sort_order, is_active) VALUES (15, N'control_category', N'detective', N'Detective', 2, 1);
INSERT INTO dbo.config_options (id, kind, value, label, sort_order, is_active) VALUES (16, N'control_category', N'corrective', N'Corrective', 3, 1);
INSERT INTO dbo.config_options (id, kind, value, label, sort_order, is_active) VALUES (17, N'control_category', N'directive', N'Directive', 4, 1);
SET IDENTITY_INSERT dbo.config_options OFF;

SET IDENTITY_INSERT dbo.org_units ON;
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (1, N'A', N'Centralized', NULL, 1, 1, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (2, N'B', N'Brand Wise', NULL, 1, 2, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (3, N'A.1', N'HR', 1, 2, 1, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (4, N'A.2', N'Finance', 1, 2, 2, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (5, N'A.3', N'CPU', 1, 2, 3, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (6, N'A.4', N'IT', 1, 2, 4, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (7, N'A.5', N'Customer Experience', 1, 2, 5, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (8, N'B.1', N'Marketing', 2, 2, 1, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (9, N'B.2', N'Operation', 2, 2, 2, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (10, N'A.1.1', N'Admin', 3, 3, 1, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (11, N'A.1.2', N'Recruitment', 3, 3, 2, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (12, N'A.1.3', N'Payroll', 3, 3, 3, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (13, N'A.1.4', N'Employee Relations', 3, 3, 4, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (14, N'A.2.1', N'Accounting', 4, 3, 1, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (15, N'A.2.2', N'Cost Control', 4, 3, 2, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (16, N'A.2.3', N'Procurement', 4, 3, 3, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (17, N'A.2.4', N'Payroll Finance', 4, 3, 4, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (18, N'A.3.1', N'Production', 5, 3, 1, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (19, N'A.3.2', N'Quality Control', 5, 3, 2, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (20, N'A.3.3', N'Warehouse', 5, 3, 3, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (21, N'A.3.4', N'Packing', 5, 3, 4, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (22, N'A.3.5', N'Dispatch', 5, 3, 5, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (23, N'A.4.1', N'Technical Support', 6, 3, 1, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (24, N'A.4.2', N'Systems', 6, 3, 2, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (25, N'A.5.1', N'Call Center', 7, 3, 1, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (26, N'A.5.2', N'Technical Team', 7, 3, 2, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (27, N'B.1.1', N'Yelo', 8, 3, 1, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (28, N'B.1.2', N'Mishmash', 8, 3, 2, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (29, N'B.1.3', N'BBT', 8, 3, 3, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (30, N'B.1.4', N'Other Brands', 8, 3, 4, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (31, N'B.2.1', N'Yelo', 9, 3, 1, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (32, N'B.2.2', N'Mishmash', 9, 3, 2, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (33, N'B.2.3', N'BBT', 9, 3, 3, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (34, N'B.2.1.1', N'Branch 1', 31, 4, 1, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (35, N'B.2.1.2', N'Branch 2', 31, 4, 2, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (36, N'B.2.1.3', N'Branch 3', 31, 4, 3, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (37, N'B.2.2.1', N'Branch 1', 32, 4, 1, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (38, N'B.2.2.2', N'Branch 2', 32, 4, 2, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (39, N'B.2.2.3', N'Branch 3', 32, 4, 3, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (40, N'B.2.3.1', N'Branch 1', 33, 4, 1, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (41, N'B.2.3.2', N'Branch 2', 33, 4, 2, 1);
INSERT INTO dbo.org_units (id, code, name, parent_id, level, sort_order, is_active) VALUES (42, N'B.2.3.3', N'Branch 3', 33, 4, 3, 1);
SET IDENTITY_INSERT dbo.org_units OFF;
