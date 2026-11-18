import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { anyFrameworkMatches, domainMatches, frameworkMatches, idParam } from "../src/features/filters/match.ts";
import { canManageSop, canEditSopFields, nextSopVersion } from "../src/features/sops/types.ts";
import { effectivePermissions } from "../src/lib/auth/permissions.ts";
import { splitBatches } from "../scripts/splitBatches.mjs";

/* Two domains: 1 (Ops: departments 10, 11; brand 100) and 2 (HR: department 20). */
const lin = {
  frameworks: [
    { id: 5, name: "Food safety", domain_id: 1 },
    { id: 6, name: "Recruitment", domain_id: 2 },
    { id: 7, name: "Orphan", domain_id: null },
  ],
  domainDepts: new Map([
    [1, new Set([10, 11])],
    [2, new Set([20])],
  ]),
  domainBrands: new Map([[1, new Set([100])]]),
  frameworkDept: new Map([[7, 30]]),
};

test("domain filters: department and brand come from the domain's SOPs", () => {
  assert.equal(domainMatches(lin, 1, { department: 11 }), true);
  assert.equal(domainMatches(lin, 2, { department: 11 }), false);
  assert.equal(domainMatches(lin, 1, { brand: 100 }), true);
  assert.equal(domainMatches(lin, 2, { brand: 100 }), false);
});

test("framework filters: domain, own department, inherited department", () => {
  assert.equal(frameworkMatches(lin, 5, { domain: 1 }), true);
  assert.equal(frameworkMatches(lin, 6, { domain: 1 }), false);
  assert.equal(frameworkMatches(lin, 6, { department: 20 }), true);
  assert.equal(frameworkMatches(lin, 7, { department: 30 }), true, "own department");
  assert.equal(frameworkMatches(lin, 7, { brand: 100 }), false);
});

test("checklists/questions match when any linked framework matches", () => {
  assert.equal(anyFrameworkMatches(lin, [6, 5], { domain: 1 }), true);
  assert.equal(anyFrameworkMatches(lin, [6], { domain: 1 }), false);
  assert.equal(anyFrameworkMatches(lin, [], {}), true, "no filter keeps unlinked items");
  assert.equal(anyFrameworkMatches(lin, [], { domain: 1 }), false);
  assert.equal(anyFrameworkMatches(lin, [5, 6], { framework: 6 }), true);
});

test("idParam accepts positive integers only", () => {
  assert.equal(idParam("12"), 12);
  assert.equal(idParam(""), undefined);
  assert.equal(idParam("abc"), undefined);
  assert.equal(idParam("-3"), undefined);
});

test("next SOP version bumps the minor number", () => {
  assert.equal(nextSopVersion("1.0"), "1.1");
  assert.equal(nextSopVersion("1.9"), "1.10");
  assert.equal(nextSopVersion("2"), "2.1");
  assert.equal(nextSopVersion(" 3.4 "), "3.5");
});

test("who manages an SOP: SOP editors and the owning department manager (RBAC)", () => {
  const sop = { status: "approved" as const, owner_id: 7, created_by: 8, department_ids: [10] };
  const actor = (role: string, id: number, departmentIds: number[] = []) => ({
    id,
    permissions: effectivePermissions([role]),
    departmentIds,
  });
  for (const r of ["compliance", "opex", "business_excellence"]) assert.equal(canManageSop(actor(r, 1), sop), true, r);
  assert.equal(canManageSop(actor("department_manager", 7), sop), true, "owner");
  assert.equal(canManageSop(actor("department_manager", 8), sop), true, "creator");
  assert.equal(canManageSop(actor("department_manager", 9, [10]), sop), true, "DM of the SOP's department");
  assert.equal(canManageSop(actor("department_manager", 9, [20]), sop), false, "DM of another department");
  assert.equal(canManageSop(actor("department_member", 3, [10]), sop), false);
  assert.equal(canManageSop(actor("ceo", 1), sop), false);
  assert.equal(canManageSop(actor("admin", 1), sop), false, "admin is technical only");
});

test("approved SOP content stays locked; editors edit drafts and reviews", () => {
  const a = (role: string) => ({ id: 1, permissions: effectivePermissions([role]), departmentIds: [] as number[] });
  const sop = (status: string) => ({ status: status as never, owner_id: 7, created_by: 7 });
  assert.equal(canEditSopFields(a("compliance"), sop("approved")), false);
  assert.equal(canEditSopFields(a("opex"), sop("draft")), true);
  assert.equal(canEditSopFields(a("compliance"), sop("pending_ceo")), true);
  assert.equal(canEditSopFields(a("department_member"), sop("draft")), false);
  assert.equal(canEditSopFields(a("ceo"), sop("pending_ceo")), false, "CEO never edits content");
});

test("migration 006 is safe to run twice", () => {
  const text = fs.readFileSync(new URL("../sql/006_sop_revisions.sql", import.meta.url), "utf8");
  const lines = text.split(/\r?\n/);
  const unguarded = lines.filter(
    (l, i) => /^\s*(ALTER TABLE|CREATE (UNIQUE )?INDEX|DROP INDEX)/.test(l) && !lines[i - 1]?.trim().startsWith("IF ")
  );
  assert.deepEqual(unguarded, []);
  assert.equal(splitBatches(text).length, 2);
});
