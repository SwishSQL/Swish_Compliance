import "server-only";
import { queryAll, queryOne, execute, withTransaction } from "@/lib/db";
import type { TxClient } from "@/lib/db";
import type { Sop, SopStatus } from "./types";

const SOP_SELECT = `
  s.id, s.code, s.title, s.description, s.version, s.status, s.file_url,
  s.attachment_data_url, s.attachment_name, s.attachment_mime,
  s.brand_id, b.name AS brand_name,
  s.department_id, d.name AS department_name,
  s.owner_id, u_o.display_name AS owner_name,
  s.created_by, u_c.display_name AS created_by_name,
  s.approved_by, u_a.display_name AS approved_by_name,
  s.approved_at, s.effective_date, s.review_date, s.created_at, s.updated_at,
  s.brand_is_function, s.is_all_departments,
  s.purpose, s.scope, s.process_flow, s.roles_responsibilities,
  s.inputs_outputs, s.tools_forms, s.kpis,
  s.ownership_review, s.appendices, s.signatures_approval,
  -- Every department this SOP applies to (migration 052). department_id
  -- above is still the first of these, kept for the joins and scope walks
  -- that predate the junction.
  COALESCE(
    (SELECT array_agg(sd.department_id ORDER BY dep.name)
       FROM sop_departments sd JOIN departments dep ON dep.id = sd.department_id
       WHERE sd.sop_id = s.id),
    ARRAY[]::int[]
  ) AS department_ids,
  COALESCE(
    (SELECT array_agg(dep.name ORDER BY dep.name)
       FROM sop_departments sd JOIN departments dep ON dep.id = sd.department_id
       WHERE sd.sop_id = s.id),
    ARRAY[]::text[]
  ) AS department_names
FROM sops s
LEFT JOIN brands       b   ON b.id   = s.brand_id
LEFT JOIN departments  d   ON d.id   = s.department_id
LEFT JOIN users        u_o ON u_o.id = s.owner_id
LEFT JOIN users        u_c ON u_c.id = s.created_by
LEFT JOIN users        u_a ON u_a.id = s.approved_by
`;

export type ListFilters = {
  status?: SopStatus;
  search?: string;
  brandId?: number;
  departmentId?: number;
  limit?: number;
  offset?: number;
};

export async function listSops(f: ListFilters = {}): Promise<{ rows: Sop[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (f.status) {
    params.push(f.status);
    conditions.push(`s.status = $${params.length}`);
  }
  if (f.search) {
    params.push(`%${f.search}%`);
    conditions.push(`(s.title ILIKE $${params.length} OR s.code ILIKE $${params.length})`);
  }
  if (f.brandId) {
    params.push(f.brandId);
    conditions.push(`s.brand_id = $${params.length}`);
  }
  if (f.departmentId) {
    params.push(f.departmentId);
    // Matches any of the SOP's departments, not just the first — the
    // junction was backfilled from department_id, so single-department
    // SOPs behave exactly as they did before migration 052.
    conditions.push(
      `EXISTS (SELECT 1 FROM sop_departments sd
                WHERE sd.sop_id = s.id AND sd.department_id = $${params.length})`
    );
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const limit = f.limit ?? 50;
  const offset = f.offset ?? 0;
  params.push(limit, offset);

  const rows = await queryAll<Sop>(
    `SELECT ${SOP_SELECT} ${where}
     ORDER BY s.updated_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const totalRow = await queryOne<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM sops s ${where}`,
    params.slice(0, params.length - 2)
  );

  return { rows, total: totalRow?.total ?? 0 };
}

export async function getSopById(id: number): Promise<Sop | undefined> {
  return queryOne<Sop>(`SELECT ${SOP_SELECT} WHERE s.id = $1`, [id]);
}

export type CreateSopInput = {
  code?: string | null;
  title: string;
  description?: string | null;
  version?: string;
  file_url?: string | null;
  attachment_data_url?: string | null;
  attachment_name?: string | null;
  attachment_mime?: string | null;
  brand_id?: number | null;
  department_id?: number | null;
  /** Every department this SOP applies to (migration 052). */
  department_ids?: number[];
  owner_id?: number | null;
  effective_date?: string | null;
  review_date?: string | null;
  created_by: number;
  // Scope flags (migration 020) — TRUE overrides the corresponding _id.
  brand_is_function?: boolean;
  is_all_departments?: boolean;
  // 10 structured sections - all optional
  purpose?: string | null;
  scope?: string | null;
  process_flow?: string | null;
  roles_responsibilities?: string | null;
  inputs_outputs?: string | null;
  tools_forms?: string | null;
  kpis?: string | null;
  ownership_review?: string | null;
  appendices?: string | null;
  signatures_approval?: string | null;
};

/**
 * Which departments a SOP applies to, resolved from the multi-select.
 *
 * `is_all_departments` already means "every department, including ones
 * added later", so it wins outright and leaves the junction empty rather
 * than freezing today's list into it. Otherwise the junction holds the
 * chosen departments, and `department_id` mirrors the first of them so
 * every pre-existing join and scope walk keeps resolving.
 */
function resolveDepartments(input: {
  is_all_departments?: boolean;
  department_ids?: number[];
  department_id?: number | null;
}): { departmentId: number | null; departmentIds: number[] } {
  if (input.is_all_departments) return { departmentId: null, departmentIds: [] };

  const ids = Array.from(
    new Set((input.department_ids ?? []).filter((n) => Number.isInteger(n) && n > 0))
  );
  // Callers that predate the multi-select still send a single id.
  if (ids.length === 0 && input.department_id != null) ids.push(input.department_id);

  return { departmentId: ids[0] ?? null, departmentIds: ids };
}

/** Rewrite a SOP's department links inside an existing transaction. */
async function replaceSopDepartments(
  client: TxClient,
  sopId: number,
  departmentIds: number[]
): Promise<void> {
  await client.query(`DELETE FROM sop_departments WHERE sop_id = $1`, [sopId]);
  for (const departmentId of departmentIds) {
    await client.query(
      `INSERT INTO sop_departments (sop_id, department_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [sopId, departmentId]
    );
  }
}

export async function createSop(input: CreateSopInput): Promise<number> {
  // brand_id is meaningless when brand_is_function is true (the SOP spans
  // every brand); same logic for is_all_departments. Force the *_id columns
  // to NULL in those cases so the data on disk doesn't disagree with the
  // semantic flag.
  const brandId = input.brand_is_function ? null : input.brand_id ?? null;
  const { departmentId, departmentIds } = resolveDepartments(input);

  return withTransaction(async (client) => {
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO sops
        (code, title, description, version, status, file_url,
         attachment_data_url, attachment_name, attachment_mime,
         brand_id, department_id, owner_id, created_by, effective_date, review_date,
         brand_is_function, is_all_departments,
         purpose, scope, process_flow, roles_responsibilities,
         inputs_outputs, tools_forms, kpis,
         ownership_review, appendices, signatures_approval)
       VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
               $15, $16,
               $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
       RETURNING id`,
      [
        input.code ?? null,
        input.title,
        input.description ?? null,
        input.version ?? "1.0",
        input.file_url ?? null,
        input.attachment_data_url ?? null,
        input.attachment_name ?? null,
        input.attachment_mime ?? null,
        brandId,
        departmentId,
        input.owner_id ?? input.created_by,
        input.created_by,
        input.effective_date ?? null,
        input.review_date ?? null,
        input.brand_is_function ?? false,
        input.is_all_departments ?? false,
        input.purpose ?? null,
        input.scope ?? null,
        input.process_flow ?? null,
        input.roles_responsibilities ?? null,
        input.inputs_outputs ?? null,
        input.tools_forms ?? null,
        input.kpis ?? null,
        input.ownership_review ?? null,
        input.appendices ?? null,
        input.signatures_approval ?? null,
      ]
    );
    const sopId = rows[0].id;
    await replaceSopDepartments(client, sopId, departmentIds);
    return sopId;
  });
}

export type UpdateSopInput = {
  id: number;
  code?: string | null;
  title: string;
  description?: string | null;
  file_url?: string | null;
  attachment_data_url?: string | null;
  attachment_name?: string | null;
  attachment_mime?: string | null;
  /** When true, the attachment columns are replaced (including to NULL).
   *  When false, the existing attachment stays untouched. Lets the edit
   *  form re-save title/sections without forcing a re-upload. */
  update_attachment: boolean;
  brand_id?: number | null;
  department_id?: number | null;
  /** Every department this SOP applies to (migration 052). */
  department_ids?: number[];
  owner_id?: number | null;
  effective_date?: string | null;
  review_date?: string | null;
  brand_is_function?: boolean;
  is_all_departments?: boolean;
  purpose?: string | null;
  scope?: string | null;
  process_flow?: string | null;
  roles_responsibilities?: string | null;
  inputs_outputs?: string | null;
  tools_forms?: string | null;
  kpis?: string | null;
  ownership_review?: string | null;
  appendices?: string | null;
  signatures_approval?: string | null;
};

/**
 * In-place edit of an SOP's content (title, description, 10 sections,
 * brand/dept/scope flags, dates, file URL/attachment). Status is NOT
 * touched — workflow stays driven by setSopStatus/transitionSopAction.
 *
 * The attachment columns are conditionally updated via CASE based on
 * `update_attachment` so a routine field edit doesn't blow away an
 * already-uploaded file.
 */
export async function updateSop(input: UpdateSopInput): Promise<void> {
  const brandId = input.brand_is_function ? null : input.brand_id ?? null;
  const { departmentId, departmentIds } = resolveDepartments(input);

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE sops SET
         code                   = $2,
         title                  = $3,
         description            = $4,
         file_url               = $5,
         attachment_data_url    = CASE WHEN $6  THEN $7  ELSE attachment_data_url END,
         attachment_name        = CASE WHEN $6  THEN $8  ELSE attachment_name     END,
         attachment_mime        = CASE WHEN $6  THEN $9  ELSE attachment_mime     END,
         brand_id               = $10,
         department_id          = $11,
         owner_id               = COALESCE($12, owner_id),
         effective_date         = $13,
         review_date            = $14,
         brand_is_function      = $15,
         is_all_departments     = $16,
         purpose                = $17,
         scope                  = $18,
         process_flow           = $19,
         roles_responsibilities = $20,
         inputs_outputs         = $21,
         tools_forms            = $22,
         kpis                   = $23,
         ownership_review       = $24,
         appendices             = $25,
         signatures_approval    = $26
       WHERE id = $1`,
      [
        input.id,
        input.code ?? null,
        input.title,
        input.description ?? null,
        input.file_url ?? null,
        input.update_attachment,
        input.attachment_data_url ?? null,
        input.attachment_name ?? null,
        input.attachment_mime ?? null,
        brandId,
        departmentId,
        input.owner_id ?? null,
        input.effective_date ?? null,
        input.review_date ?? null,
        input.brand_is_function ?? false,
        input.is_all_departments ?? false,
        input.purpose ?? null,
        input.scope ?? null,
        input.process_flow ?? null,
        input.roles_responsibilities ?? null,
        input.inputs_outputs ?? null,
        input.tools_forms ?? null,
        input.kpis ?? null,
        input.ownership_review ?? null,
        input.appendices ?? null,
        input.signatures_approval ?? null,
      ]
    );
    await replaceSopDepartments(client, input.id, departmentIds);
  });
}

export async function setSopAttachment(
  id: number,
  dataUrl: string | null,
  name: string | null,
  mime: string | null
): Promise<void> {
  await execute(
    `UPDATE sops SET attachment_data_url = $2, attachment_name = $3, attachment_mime = $4 WHERE id = $1`,
    [id, dataUrl, name, mime]
  );
}

export type SopEvent = {
  id: number;
  action: string;
  user_email: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

/** Workflow / change history for a SOP, read from audit_logs. */
export async function listSopEvents(sopId: number): Promise<SopEvent[]> {
  return queryAll<SopEvent>(
    `SELECT id, action, user_email, details, created_at
     FROM audit_logs
     WHERE entity = 'sop' AND entity_id = $1
     ORDER BY created_at DESC
     LIMIT 100`,
    [sopId]
  );
}

export async function setSopStatus(
  id: number,
  status: SopStatus,
  approverId: number | null
): Promise<void> {
  if (status === "approved") {
    await execute(
      `UPDATE sops SET status = 'approved', approved_by = $1, approved_at = NOW() WHERE id = $2`,
      [approverId, id]
    );
  } else {
    await execute(`UPDATE sops SET status = $1 WHERE id = $2`, [status, id]);
  }
}
