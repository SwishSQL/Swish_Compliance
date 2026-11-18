/**
 * RBAC acceptance tests (docs/RBAC.md §13) for the pure permission and
 * workflow rules. Server actions call exactly these functions, so a rule
 * that fails here fails at the API too.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  effectivePermissions,
  DEFAULT_ROLE_PERMISSIONS,
  ROLES,
  PERMISSION_KEYS,
} from "../src/lib/auth/permissions.ts";
import {
  availableTransitions,
  findTransition,
  transitionBlocker,
  canEditSopFields,
  canViewSop,
  routeForAuthor,
  firstReviewStage,
  type SopActor,
  type SopRef,
} from "../src/features/sops/types.ts";
import {
  canWorkOnCapa,
  canManagerReviewCapa,
  canVerifyCloseCapa,
  canAssignCapa,
  canViewCapa,
  submitTarget,
  type CapaRef,
} from "../src/features/capa/workflow.ts";

const FINANCE = 10;
const HR = 20;

function actor(id: number, roles: string[], departmentIds: number[] = []): SopActor {
  return { id, permissions: effectivePermissions(roles), departmentIds };
}

const dm = actor(1, ["department_manager"], [FINANCE]);
const otherDm = actor(2, ["department_manager"], [HR]);
const opex = actor(3, ["opex"]);
const compliance = actor(4, ["compliance"]);
const compliance2 = actor(5, ["compliance"]);
const ibe = actor(6, ["business_excellence"]);
const ceo = actor(7, ["ceo"]);
const member = actor(8, ["department_member"], [FINANCE]);
const admin = actor(9, ["admin"]);

function sop(over: Partial<SopRef> = {}): SopRef {
  return {
    status: "draft",
    created_by: dm.id,
    owner_id: dm.id,
    workflow_route: "standard",
    department_ids: [FINANCE],
    is_all_departments: false,
    ...over,
  };
}

const targets = (a: SopActor, s: SopRef) => availableTransitions(a, s).map((t) => t.to).sort();

// ── Permission registry ──────────────────────────────────────────────

test("every default grant is a known permission", () => {
  for (const r of ROLES) for (const p of DEFAULT_ROLE_PERMISSIONS[r]) assert.ok(PERMISSION_KEYS.includes(p), `${r}:${p}`);
});

test("admin overrides add and remove permissions; unknown ones are ignored", () => {
  const p = effectivePermissions(["opex"], [
    { role: "opex", permission: "grc.edit", allowed: true },
    { role: "opex", permission: "sop.review_opex", allowed: false },
    { role: "opex", permission: "made.up", allowed: true },
  ]);
  assert.ok(p.has("grc.edit"));
  assert.ok(!p.has("sop.review_opex"));
  assert.ok(!p.has("made.up" as never));
});

test("multiple roles combine; unknown roles grant nothing", () => {
  const p = effectivePermissions(["department_manager", "auditor", "nonsense"]);
  assert.ok(p.has("capa.manager_review"));
  assert.ok(!p.has("records.view_all"));
});

test("IBE has no user-management permissions; admin has no business approvals", () => {
  const ibeP = effectivePermissions(["business_excellence"]);
  assert.ok(!ibeP.has("admin.users") && !ibeP.has("admin.permissions"));
  const adminP = effectivePermissions(["admin"]);
  for (const p of ["sop.review_compliance", "sop.review_ceo", "capa.verify_close", "audit.finalize"]) {
    assert.ok(!adminP.has(p as never), p);
  }
});

test("department members get nothing beyond their record-level rights", () => {
  assert.equal(effectivePermissions(["department_member"]).size, 0);
  assert.equal(effectivePermissions(["viewer"]).size, 0);
});

// ── SOP workflow ─────────────────────────────────────────────────────

test("a Department Manager cannot edit another department's SOP", () => {
  assert.equal(canEditSopFields(dm, sop()), true);
  assert.equal(canEditSopFields(otherDm, sop({ created_by: 99, owner_id: 99 })), false);
});

test("a DM's SOP goes DM → OPEX → Compliance → IBE → CEO → approved", () => {
  assert.equal(routeForAuthor(dm), "standard");
  assert.equal(firstReviewStage("standard"), "pending_opex");
  assert.deepEqual(targets(dm, sop()), ["pending_opex"]);
  assert.ok(targets(opex, sop({ status: "pending_opex" })).includes("pending_compliance"));
  assert.ok(targets(compliance, sop({ status: "pending_compliance" })).includes("pending_business_excellence"));
  assert.ok(targets(ibe, sop({ status: "pending_business_excellence" })).includes("pending_ceo"));
  assert.ok(targets(ceo, sop({ status: "pending_ceo" })).includes("approved"));
});

test("an OPEX-authored SOP is validated by the department's manager first", () => {
  assert.equal(routeForAuthor(opex), "opex_authored");
  const s = sop({ created_by: opex.id, owner_id: opex.id, workflow_route: "opex_authored" });
  assert.deepEqual(targets(opex, s), ["pending_dept_validation"]);
  const pending = { ...s, status: "pending_dept_validation" as const };
  assert.ok(targets(dm, pending).includes("pending_compliance"));
  assert.deepEqual(targets(otherDm, pending), [], "a manager of another department can't validate");
});

test("OPEX cannot approve at the Compliance, IBE or CEO stages", () => {
  for (const status of ["pending_compliance", "pending_business_excellence", "pending_ceo"] as const) {
    assert.deepEqual(targets(opex, sop({ status })), [], status);
  }
});

test("the CEO cannot edit SOP content but can give final approval", () => {
  const s = sop({ status: "pending_ceo" });
  assert.equal(canEditSopFields(ceo, s), false);
  assert.ok(targets(ceo, s).includes("approved"));
});

test("users cannot approve their own submissions", () => {
  const own = sop({ status: "pending_compliance", created_by: compliance.id, owner_id: compliance.id });
  const t = findTransition(own, "pending_business_excellence")!;
  assert.match(transitionBlocker(compliance, own, t) ?? "", /can't approve/);
  assert.equal(transitionBlocker(compliance2, own, t), null, "another compliance officer can");
  assert.ok(targets(compliance, own).includes("returned_to_dm"), "returning is still allowed");
});

test("admin cannot take business approval steps", () => {
  assert.deepEqual(targets(admin, sop({ status: "pending_ceo" })), []);
});

test("legacy in-flight SOPs keep the old route", () => {
  const legacy = sop({ workflow_route: null, status: "returned_to_dm" });
  assert.deepEqual(targets(dm, legacy), ["pending_compliance"]);
});

test("reject ends the submission; the author can reopen it", () => {
  assert.ok(targets(compliance, sop({ status: "pending_compliance" })).includes("rejected"));
  assert.deepEqual(targets(dm, sop({ status: "rejected" })), ["draft"]);
  assert.equal(canEditSopFields(dm, sop({ status: "rejected" })), false);
});

test("approved SOPs cannot be edited directly", () => {
  for (const a of [dm, opex, compliance, ibe, ceo, admin]) assert.equal(canEditSopFields(a, sop({ status: "approved" })), false);
});

test("SOP visibility: members see approved SOPs of their department only", () => {
  const view = (a: SopActor, s: SopRef, fullScope = false) => canViewSop({ ...a, fullScope }, s);
  assert.equal(view(member, sop({ status: "approved", created_by: 99, owner_id: 99 })), true);
  assert.equal(view(member, sop({ status: "pending_opex", created_by: 99, owner_id: 99 })), false);
  assert.equal(view(member, sop({ status: "approved", created_by: 99, owner_id: 99, department_ids: [HR] })), false);
  assert.equal(view(otherDm, sop({ status: "pending_opex", created_by: 99, owner_id: 99 })), false);
  assert.equal(view(ceo, sop({ status: "pending_opex" }), true), true);
});

// ── CAPA workflow ────────────────────────────────────────────────────

function capa(over: Partial<CapaRef> = {}): CapaRef {
  return { status: "in_progress", assigned_to: member.id, created_by: compliance.id, department_id: FINANCE, ...over };
}

test("a Department Member can work on an assigned CAPA but cannot close it", () => {
  assert.equal(canWorkOnCapa(member, capa()), true);
  assert.equal(canVerifyCloseCapa(member, capa({ status: "pending_compliance_verification" })), false);
  assert.equal(canManagerReviewCapa(member, capa({ status: "pending_manager_review" })), false);
  assert.equal(canWorkOnCapa(member, capa({ status: "pending_manager_review" })), false, "locked once submitted");
});

test("a Department Manager assigns and reviews their department's CAPAs", () => {
  assert.equal(canAssignCapa(dm, FINANCE), true);
  assert.equal(canAssignCapa(dm, HR), false);
  assert.equal(canManagerReviewCapa(dm, capa({ status: "pending_manager_review" })), true);
  assert.equal(canManagerReviewCapa(otherDm, capa({ status: "pending_manager_review" })), false);
  assert.equal(canVerifyCloseCapa(dm, capa({ status: "pending_compliance_verification" })), false, "DMs can't close");
});

test("submissions go to the manager first, unless the assignee is the only manager", () => {
  assert.equal(submitTarget([dm.id], member.id), "pending_manager_review");
  assert.equal(submitTarget([member.id], member.id), "pending_compliance_verification");
  assert.equal(submitTarget([], member.id), "pending_compliance_verification");
});

test("Compliance verifies and closes; never their own CAPA; IBE monitors only", () => {
  assert.equal(canVerifyCloseCapa(compliance, capa({ status: "pending_compliance_verification" })), true);
  assert.equal(canVerifyCloseCapa(compliance, capa({ status: "submitted" })), true, "legacy submitted");
  assert.equal(
    canVerifyCloseCapa(compliance, capa({ status: "pending_compliance_verification", assigned_to: compliance.id })),
    false
  );
  assert.equal(canVerifyCloseCapa(ibe, capa({ status: "pending_compliance_verification" })), false);
  assert.equal(canAssignCapa(ibe, HR), true);
});

test("CAPA visibility follows assignment and department", () => {
  const view = (a: SopActor, c: CapaRef, fullScope = false) => canViewCapa({ ...a, fullScope }, c);
  assert.equal(view(member, capa()), true, "assignee");
  assert.equal(view(member, capa({ assigned_to: 99 })), false, "a member doesn't see colleagues' CAPAs");
  assert.equal(view(dm, capa({ assigned_to: 99 })), true, "manager sees the department's CAPAs");
  assert.equal(view(otherDm, capa({ assigned_to: 99 })), false);
});

// ── Migration ────────────────────────────────────────────────────────

test("migration 007 only adds (no DROP / DELETE of data) and backfills roles", () => {
  const text = fs.readFileSync(new URL("../sql/007_rbac.sql", import.meta.url), "utf8");
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");
  assert.doesNotMatch(code, /\bDROP\s+(TABLE|COLUMN)\b/i);
  assert.doesNotMatch(code, /\bDELETE\s+FROM\b/i);
  assert.match(code, /INSERT INTO dbo\.user_roles/);
});
