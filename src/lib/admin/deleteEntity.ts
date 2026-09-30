import "server-only";
import { withTransaction, queryOne, queryAll } from "@/lib/db";

/**
 * Generic admin "Delete" for the seven entities that have a real detail
 * page: SOPs, Domains, Frameworks, Controls, Checklist templates, Audits,
 * CAPAs. Gated to admin/compliance by the caller (canDeleteOrArchive) —
 * this module assumes the permission check already happened.
 *
 * Every entity here has FK dependents (see sql/*.sql). Most relationships
 * are ON DELETE SET NULL — the dependent row survives, just orphaned —
 * but a few CASCADE (real data loss: a checklist template's questions, an
 * audit's responses) and one RESTRICTs (a template still used by an audit
 * can't be deleted at the DB level at all). getDeleteImpact() surfaces
 * that distinction so the confirmation dialog can show it truthfully
 * instead of a generic "are you sure?".
 */

export type EntityType =
  | "sop"
  | "domain"
  | "framework"
  | "control"
  | "checklist_template"
  | "audit"
  | "capa"
  | "brand"
  | "department";

const ENTITY_TABLE: Record<EntityType, string> = {
  sop: "sops",
  domain: "domains",
  framework: "frameworks",
  control: "controls",
  checklist_template: "checklist_templates",
  audit: "audits",
  capa: "corrective_actions",
  brand: "brands",
  department: "departments",
};

export const ENTITY_LABEL: Record<EntityType, string> = {
  sop: "SOP",
  domain: "Domain",
  framework: "Framework",
  control: "Control",
  checklist_template: "Checklist template",
  audit: "Audit",
  capa: "Corrective action",
  brand: "Brand",
  department: "Department",
};

export const ENTITY_LIST_PATH: Record<EntityType, string> = {
  sop: "/sops",
  domain: "/domains",
  framework: "/frameworks",
  control: "/controls",
  checklist_template: "/checklists/templates",
  audit: "/audits",
  capa: "/capa",
  brand: "/admin/config?tab=brands",
  department: "/admin/config?tab=departments",
};

export type ImpactRow = {
  label: string;
  count: number;
  /** true = the dependent rows are hard-deleted too (real data loss).
   *  false = the dependent rows survive with this FK set to NULL. */
  cascaded: boolean;
};

export type DeleteImpact = {
  exists: boolean;
  title: string;
  rows: ImpactRow[];
  /** Set when the DB will refuse the delete outright (an ON DELETE
   *  RESTRICT dependent still has rows). The UI should disable confirm
   *  and show this instead of attempting the delete. */
  blockedReason: string | null;
};

async function impactCount(sql: string, id: number): Promise<number> {
  const row = await queryOne<{ n: string }>(sql, [id]);
  return Number(row?.n ?? 0);
}

/**
 * Impact preview — read-only, safe to call speculatively (e.g. as soon as
 * the delete dialog opens) since it makes no writes.
 */
export async function getDeleteImpact(
  type: EntityType,
  id: number
): Promise<DeleteImpact> {
  const table = ENTITY_TABLE[type];
  const titleCol =
    type === "sop" || type === "capa"
      ? "title"
      : type === "audit"
      ? "NULL"
      : "name";
  const row = await queryOne<{ title: string | null }>(
    `SELECT ${titleCol === "NULL" ? "NULL" : titleCol} AS title FROM ${table} WHERE id = $1`,
    [id]
  );
  if (!row) {
    return { exists: false, title: "", rows: [], blockedReason: null };
  }

  let rows: ImpactRow[] = [];
  let blockedReason: string | null = null;

  switch (type) {
    case "sop": {
      rows = [
        {
          label: "Version history entries",
          count: await impactCount(`SELECT COUNT(*) n FROM sop_versions WHERE sop_id = $1`, id),
          cascaded: true,
        },
        {
          label: "Acknowledgements",
          count: await impactCount(
            `SELECT COUNT(*) n FROM sop_acknowledgments WHERE sop_id = $1`,
            id
          ),
          cascaded: true,
        },
        {
          label: "Domains that name this as their SOP (will be unlinked)",
          count: await impactCount(`SELECT COUNT(*) n FROM domains WHERE sop_id = $1`, id),
          cascaded: false,
        },
        {
          label: "Frameworks that name this as their SOP (will be unlinked)",
          count: await impactCount(`SELECT COUNT(*) n FROM frameworks WHERE sop_id = $1`, id),
          cascaded: false,
        },
        {
          // Counts every audit that names this SOP at all (migration
          // 055 — an audit can cover several), not just the ones where
          // it happens to be the first/primary one.
          label: "Audits scoped to this SOP (will be unlinked, kept)",
          count: await impactCount(
            `SELECT COUNT(*) n FROM (
               SELECT id FROM audits WHERE policy_id = $1
               UNION
               SELECT audit_id FROM audit_sops WHERE sop_id = $1
             ) x`,
            id
          ),
          cascaded: false,
        },
      ];
      break;
    }
    case "domain": {
      rows = [
        {
          label: "Frameworks under this domain (will be unlinked, kept)",
          count: await impactCount(`SELECT COUNT(*) n FROM frameworks WHERE domain_id = $1`, id),
          cascaded: false,
        },
        {
          label: "User access grants for this domain",
          count: await impactCount(`SELECT COUNT(*) n FROM user_domains WHERE domain_id = $1`, id),
          cascaded: true,
        },
        {
          label: "Audits scoped to this domain (will be unlinked, kept)",
          count: await impactCount(`SELECT COUNT(*) n FROM audits WHERE domain_id = $1`, id),
          cascaded: false,
        },
      ];
      break;
    }
    case "framework": {
      rows = [
        {
          label: "Controls under this framework (will be unlinked, kept)",
          count: await impactCount(
            `SELECT COUNT(*) n FROM controls WHERE framework_id = $1`,
            id
          ),
          cascaded: false,
        },
        {
          label: "Audits scoped to this framework (will be unlinked, kept)",
          count: await impactCount(`SELECT COUNT(*) n FROM audits WHERE framework_id = $1`, id),
          cascaded: false,
        },
      ];
      break;
    }
    case "control": {
      rows = [
        {
          label: "Traceability links (SOP/document/audit/check/CAPA)",
          count: await impactCount(
            `SELECT COUNT(*) n FROM control_links WHERE control_id = $1`,
            id
          ),
          cascaded: true,
        },
        {
          label: "Tests under this control (will be unlinked, kept)",
          count: await impactCount(`SELECT COUNT(*) n FROM checks WHERE control_id = $1`, id),
          cascaded: false,
        },
        {
          label: "Audits scoped to this control (will be unlinked, kept)",
          count: await impactCount(`SELECT COUNT(*) n FROM audits WHERE control_id = $1`, id),
          cascaded: false,
        },
      ];
      break;
    }
    case "checklist_template": {
      const auditsUsing = await impactCount(
        `SELECT COUNT(*) n FROM audits WHERE template_id = $1`,
        id
      );
      if (auditsUsing > 0) {
        blockedReason = `${auditsUsing} audit${
          auditsUsing === 1 ? " uses" : "s use"
        } this template directly and must be reassigned or deleted first.`;
      }
      rows = [
        {
          label: "Questions in this template",
          count: await impactCount(
            `SELECT COUNT(*) n FROM checklist_items WHERE template_id = $1`,
            id
          ),
          cascaded: true,
        },
        {
          label: "Tests defaulting to this template (will be unlinked, kept)",
          count: await impactCount(
            `SELECT COUNT(*) n FROM checks WHERE checklist_template_id = $1`,
            id
          ),
          cascaded: false,
        },
        {
          label: "Audits using this template",
          count: auditsUsing,
          cascaded: false,
        },
      ];
      break;
    }
    case "audit": {
      rows = [
        {
          label: "Recorded responses",
          count: await impactCount(
            `SELECT COUNT(*) n FROM audit_responses WHERE audit_id = $1`,
            id
          ),
          cascaded: true,
        },
        {
          label: "Linked tests",
          count: await impactCount(`SELECT COUNT(*) n FROM audit_tests WHERE audit_id = $1`, id),
          cascaded: true,
        },
        {
          label: "Attachments",
          count: await impactCount(
            `SELECT COUNT(*) n FROM audit_attachments WHERE audit_id = $1`,
            id
          ),
          cascaded: true,
        },
        {
          label: "Corrective actions raised from this audit (will be unlinked, kept)",
          count: await impactCount(
            `SELECT COUNT(*) n FROM corrective_actions WHERE source_audit_id = $1`,
            id
          ),
          cascaded: false,
        },
      ];
      break;
    }
    case "capa": {
      rows = [
        {
          label: "Evidence files",
          count: await impactCount(
            `SELECT COUNT(*) n FROM capa_evidences WHERE capa_id = $1`,
            id
          ),
          cascaded: true,
        },
      ];
      break;
    }
    case "brand": {
      rows = [
        {
          label: "User access grants for this brand",
          count: await impactCount(
            `SELECT COUNT(*) n FROM user_brands WHERE brand_id = $1`,
            id
          ),
          cascaded: true,
        },
        {
          label: "Users with this as their home brand (will be unlinked, kept)",
          count: await impactCount(`SELECT COUNT(*) n FROM users WHERE brand_id = $1`, id),
          cascaded: false,
        },
        {
          label: "SOPs scoped to this brand (will be unlinked, kept)",
          count: await impactCount(`SELECT COUNT(*) n FROM sops WHERE brand_id = $1`, id),
          cascaded: false,
        },
        {
          label: "Audits scoped to this brand (will be unlinked, kept)",
          count: await impactCount(`SELECT COUNT(*) n FROM audits WHERE brand_id = $1`, id),
          cascaded: false,
        },
        {
          label: "Corrective actions scoped to this brand (will be unlinked, kept)",
          count: await impactCount(
            `SELECT COUNT(*) n FROM corrective_actions WHERE brand_id = $1`,
            id
          ),
          cascaded: false,
        },
      ];
      break;
    }
    case "department": {
      // Every FK into departments is ON DELETE SET NULL except
      // user_departments, which CASCADEs (see sql/007_user_multi_scope.sql).
      // Nothing here blocks the delete, but SOPs / audits / CAPAs losing
      // their department is a real governance change, so it is spelled out
      // rather than hidden behind a generic warning.
      rows = [
        {
          label: "User access grants for this department",
          count: await impactCount(
            `SELECT COUNT(*) n FROM user_departments WHERE department_id = $1`,
            id
          ),
          cascaded: true,
        },
        {
          label: "Users with this as their home department (will be unlinked, kept)",
          count: await impactCount(`SELECT COUNT(*) n FROM users WHERE department_id = $1`, id),
          cascaded: false,
        },
        {
          label: "Sub-departments under it (will become top-level, kept)",
          count: await impactCount(
            `SELECT COUNT(*) n FROM departments WHERE parent_department_id = $1`,
            id
          ),
          cascaded: false,
        },
        {
          label: "SOPs that apply to this department (the SOPs are kept)",
          count: await impactCount(
            `SELECT COUNT(*) n FROM sop_departments WHERE department_id = $1`,
            id
          ),
          cascaded: true,
        },
        {
          label: "SOPs owned by this department (will be unlinked, kept)",
          count: await impactCount(`SELECT COUNT(*) n FROM sops WHERE department_id = $1`, id),
          cascaded: false,
        },
        {
          label: "Domains scoped to this department (will be unlinked, kept)",
          count: await impactCount(`SELECT COUNT(*) n FROM domains WHERE department_id = $1`, id),
          cascaded: false,
        },
        {
          label: "Frameworks scoped to this department (will be unlinked, kept)",
          count: await impactCount(
            `SELECT COUNT(*) n FROM frameworks WHERE department_id = $1`,
            id
          ),
          cascaded: false,
        },
        {
          label: "Audits of this department (will be unlinked, kept)",
          count: await impactCount(`SELECT COUNT(*) n FROM audits WHERE department_id = $1`, id),
          cascaded: false,
        },
        {
          label: "Corrective actions for this department (will be unlinked, kept)",
          count: await impactCount(
            `SELECT COUNT(*) n FROM corrective_actions WHERE department_id = $1`,
            id
          ),
          cascaded: false,
        },
      ];
      break;
    }
  }

  return {
    exists: true,
    title: row.title ?? "this record",
    rows: rows.filter((r) => r.count > 0),
    blockedReason,
  };
}

/**
 * Delete an entity for good: snapshot the row into deleted_records, remove
 * any polymorphic control_links pointing at it (entity_id has no real FK,
 * so the DB can't cascade those on its own), delete the row, and log it.
 * Everything happens in one transaction — a failure midway leaves the row
 * intact rather than half-deleted.
 */
export async function deleteEntityWithBackup(
  type: EntityType,
  id: number,
  actor: { id: number; email: string }
): Promise<void> {
  const table = ENTITY_TABLE[type];

  await withTransaction(async (client) => {
    const existing = await client.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      throw new Error(`${ENTITY_LABEL[type]} not found — it may already be deleted.`);
    }
    const snapshot = existing.rows[0];

    // checklist_template deletion is blocked at the DB level (ON DELETE
    // RESTRICT from audits.template_id) — surface that as a normal error
    // rather than letting a raw Postgres constraint violation bubble up.
    if (type === "checklist_template") {
      const inUse = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM audits WHERE template_id = $1`,
        [id]
      );
      if (inUse.rows[0].n > 0) {
        throw new Error(
          `Can't delete — ${inUse.rows[0].n} audit(s) still use this template directly.`
        );
      }
    }

    await client.query(
      `INSERT INTO deleted_records (entity_type, entity_id, snapshot, deleted_by)
       VALUES ($1, $2, $3, $4)`,
      [type, id, JSON.stringify(snapshot), actor.id]
    );

    // Polymorphic links (control_links.entity_type/entity_id) aren't real
    // FKs, so nothing cascades them automatically.
    await client.query(
      `DELETE FROM control_links WHERE entity_type = $1 AND entity_id = $2`,
      [type, id]
    );
    if (type === "control") {
      await client.query(`DELETE FROM control_links WHERE control_id = $1`, [id]);
    }

    await client.query(`DELETE FROM ${table} WHERE id = $1`, [id]);

    await client.query(
      `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        actor.id,
        actor.email,
        `${type}:deleted`,
        type,
        id,
        JSON.stringify({ title: snapshot.title ?? snapshot.name ?? null }),
      ]
    );
  });
}

/** Used by the confirm dialog to show a couple of recent deletions can be
 *  found again if someone asks "where did X go" — not a restore UI, just
 *  reassurance that a snapshot exists. */
export async function getRecentDeletion(type: EntityType, id: number) {
  return queryOne<{ deleted_at: string; deleted_by: number | null }>(
    `SELECT deleted_at, deleted_by FROM deleted_records
     WHERE entity_type = $1 AND entity_id = $2
     ORDER BY deleted_at DESC LIMIT 1`,
    [type, id]
  );
}

// Re-exported so callers don't need a second import from "@/lib/db".
export { queryAll };
