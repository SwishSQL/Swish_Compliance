# Roles, permissions & approval workflows (RBAC)

Branch `feat/rbac`. Additive: no existing data is deleted or rewritten, and
nobody gains access from the migration.

## 1. How it works

| Piece | Where |
|---|---|
| Roles, permission keys, default matrix | `src/lib/auth/permissions.ts` |
| Multiple roles per user | `user_roles` (migration 007), backfilled from `users.role` (kept as the primary role) |
| Admin overrides of the matrix | `role_permissions` + **Administration → Permissions** (`/admin/permissions`) |
| Loading the user | `requireUser()` re-reads active flag, roles and permissions from the DB on **every request**, so role changes and deactivation apply immediately (previously the 8 h session token kept the old role). |
| Record-level rules (own department, assigned record, no self-approval) | Next to each record: `src/features/sops/types.ts`, `src/features/capa/workflow.ts`, `src/features/audits/actions.ts`, `canView*` helpers |
| Organisation-wide visibility | permission `records.view_all`; everyone else is scoped by `user_departments` / `user_brands` |

Every server action checks permissions itself — hiding a button is never the
only protection, and opening another department's SOP / CAPA / audit by URL
returns 404.

## 2. Permission matrix (defaults)

✓ = granted. Record-level rules apply on top (e.g. a Department Manager's
rights only cover their own departments).

| Permission | Admin | IBE | Compliance | CEO | OPEX | Dept Manager | Member |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Users, roles, scope (`admin.users`) | ✓ | | | | | | |
| Permission matrix (`admin.permissions`) | ✓ | | | | | | |
| Settings, reference data, imports (`admin.settings`) | ✓ | | | | | | |
| Audit trail (`admin.audit_logs`) | ✓ | | | | | | |
| Reassign a user's work (`admin.reassign`) | ✓ | ✓ | | | | | |
| See all departments/brands (`records.view_all`) | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| View GRC library (`grc.view`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Edit GRC library (`grc.edit`) | | ✓ | ✓ | | | | |
| Delete / archive governed records (`grc.delete`) | | | ✓ | | | | |
| Create SOPs, any department (`sop.create_any`) | | ✓ | ✓ | | ✓ | | |
| Create SOPs, own department (`sop.create_own_dept`) | | | | | | ✓ | |
| Edit drafts of any department (`sop.edit_any_draft`) | | ✓ | ✓ | | ✓ | | |
| OPEX stage (`sop.review_opex`) | | | | | ✓ | | |
| Validate OPEX-authored SOP (`sop.validate_dept`) | | | | | | ✓ | |
| Compliance stage (`sop.review_compliance`) | | | ✓ | | | | |
| IBE stage (`sop.review_ibe`) | | ✓ | | | | | |
| CEO final stage (`sop.review_ceo`) | | | | ✓ | | | |
| Archive / restore approved SOP (`sop.archive`) | | | ✓ | | | | |
| Create & assign audits (`audit.create`) | | ✓ | ✓ | | | | |
| Review & finalize audits (`audit.finalize`) | | ✓ | ✓ | | | | |
| Cancel audits (`audit.cancel`) | | | ✓ | | | | |
| Assign CAPAs, any department (`capa.assign_any`) | | ✓ | ✓ | | | | |
| Assign CAPAs, own department (`capa.assign_own_dept`) | | | | | | ✓ | |
| Manager review of CAPAs (`capa.manager_review`) | | | | | | ✓ | |
| Verify & close CAPAs (`capa.verify_close`) | | | ✓ | | | | |
| Monitor CAPAs (`capa.monitor`) | ✓ | ✓ | ✓ | ✓ | | ✓ | |

Legacy roles `auditor` and `viewer` are kept so existing accounts keep
working; they grant the same as a Department Member.

**Assignment-based rights (not roles):**
- **Auditor** = the user an audit is assigned to: can answer, upload evidence, submit and reopen until finalized. Nobody else can edit it (the creator can, if they may create audits).
- **CAPA assignee**: saves progress, uploads evidence, submits. Can't review, verify or close their own CAPA.

## 3. SOP & Policy workflow

Policies use the same `sops` table, so they follow the same workflow.

| Author | Route |
|---|---|
| Department Manager, Compliance, IBE | → **OPEX** → Compliance → IBE → CEO → Approved |
| OPEX | → **Department Manager validation** (manager of the SOP's department) → Compliance → IBE → CEO → Approved |
| SOPs already in the workflow before this change | keep the old route: Compliance → IBE → CEO |

- **Approve** moves to the next stage (comment required).
- **Return** sends it back for correction (reason required): OPEX, department validation and Compliance return to the author; IBE returns to Compliance; the CEO returns to IBE.
- **Reject** (reason required) ends the submission. The author can reopen it as a new draft.
- **No self-approval:** nobody can approve a SOP they created or own, at any stage. Another holder of that stage's permission must approve it, so a Compliance-authored SOP needs a second Compliance officer.
- Every decision is stored in `sop_approvals` (SOP id, version, approver, role, decision, from/to status, comment, time), and also in the audit trail.
- **Versions:** approved SOPs are locked. Changes start a new draft version that goes through the route again. The previous version stays live until the new one is approved, then it is archived. A rejected revision never replaces the approved one. Audits link to the SOP row (version) they tested.

## 4. Audits

- Only `audit.create` (Compliance, IBE) can create and assign audits.
- On creation, the assigned auditor **and the audited department's manager(s) / auditee** are notified.
- The auditor answers and submits. **Compliance/IBE reviews and finalizes** (`audit.finalize`); the auditor who performed the audit can't finalize it.
- **Finalizing locks the results and generates CAPAs for failed tests.** This used to happen on submit.
- Finalized and cancelled audits can't be edited, have attachments removed, or be deleted, by anyone including admin.
- Visibility: organisation-wide users; the creator, auditor, auditee and reviewer; and managers of the audited department.

## 5. CAPAs

`Open → Assigned → In progress → Pending manager review → Pending compliance verification → Closed`.
**Returned for correction** sends it back to the assignee.

- Assign: Compliance/IBE anywhere; a Department Manager only within their department, and only to its members.
- The assignee works and submits. It goes to the department manager first, or straight to Compliance if the department has no other manager.
- The Department Manager forwards it or returns it. Compliance verifies and **formally closes** it, or returns it.
- Nobody reviews or closes a CAPA assigned to themselves. Members and Department Managers can't close. IBE monitors and assigns but doesn't close.
- Existing rows keep their legacy status (`submitted`, `verified`, `rejected`). Compliance can close legacy `submitted` / `verified` CAPAs.
- Every step is audit-logged. Closed CAPAs and their evidence can't be deleted or changed.

## 6. Notifications & escalations

Recipients now include users who hold the role as an *additional* role.
Reminders run hourly from server start (`REMINDERS_DISABLED=true` turns them
off) and are de-duplicated in `reminders_sent`:

| Kind | To | When |
|---|---|---|
| `capa:due_soon` | assignee | due within 3 days (once) |
| `capa:overdue` | assignee, creator, department managers | weekly while overdue |
| `audit:due_soon` | auditor | window ends within 2 days (once) |
| `audit:overdue` | auditor, creator | weekly while overdue |
| `sop:review_due` | owner | review date within 30 days (once) |

The workflow events in the spec (submitted, approved, returned, rejected, awaiting CEO, audit assigned, CAPA assigned / submitted / returned / closed) are sent by the actions above. Email is **not** sent: the app has no mail server configured.

## 7. User & role management

`/admin/users/[id]`:
- Set the primary role plus any additional roles, the departments and the brands.
- Activate or deactivate the user.
- See the user's **outstanding work** and reassign it to someone else before deactivating them.

Saving a user no longer wipes their brand/domain links. That was an existing bug: the form didn't send those fields.

## 8. Audit trail

`audit_logs` is now **append-only**: database triggers block every UPDATE and DELETE. The one exception is the existing user-delete trigger, which nulls `user_id`. Role changes log before and after roles. Permission-matrix changes log the before and after overrides.

## 9. Decisions made that need business confirmation

1. **Admin has no business approvals.** Admin can't approve SOPs, close CAPAs, finalize audits or edit SOP content. If an admin also does business work, give them that role as an additional role.
2. **CAPA closure is Compliance only.** IBE can assign and monitor CAPAs, but not close them. Before this change, IBE/admin verified CAPAs.
3. **Operational reviewer for Compliance/IBE-authored SOPs = OPEX.**
4. **Return targets:** each stage returns to a fixed earlier stage (listed in §3). Users can't pick the stage.
5. **Reject is final for that submission.** The author may reopen it as a new draft.
6. **Policies** follow the SOP route, with the CEO as final approver. A separate configurable Policy approver needs a document-type field, which doesn't exist yet.
7. **"All departments" SOPs** can be validated by any Department Manager when OPEX authored them.
8. **Existing `viewer` and `auditor` users** get Department Member access (scoped to their departments). Previously viewers could open most pages. Reassign roles where they need more.
9. **Reports and Roadmap** are organisation-wide pages, so only `records.view_all` roles see them. A department-level dashboard for managers is a follow-up.
10. **Audit independence** is enforced as "the auditor can't finalize their own audit". Blocking a department's own staff from auditing it needs a rule from the business.
11. **Email notifications** need a mail server (SMTP) before they can be added.

## 10. Test results

`npm test`: 77 tests pass, including 22 RBAC tests in `tests/rbac.test.ts` that cover the §13 acceptance list. These test the same rule functions the server actions call:
- A DM can't edit another department's SOP.
- The full DM and OPEX approval routes work.
- OPEX can't approve at later stages.
- The CEO can approve but not edit.
- Self-approval is blocked.
- Admin has no approvals.
- A member can work on a CAPA but not close it.
- A DM can assign and review only their own department's CAPAs.
- Compliance can close, but not their own CAPA.
- The visibility rules hold.
- The migration only adds.

`next build` and `tsc` pass. **Not yet tested:** a run against a real database with one test user per role. Do that on a staging copy before merging.
