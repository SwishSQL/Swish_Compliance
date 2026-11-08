import "server-only";
import { queryAll, queryOne, execute } from "@/lib/db";
import type { SopFeedback } from "./types";

const FB_SELECT = `
  SELECT f.id, f.sop_id, s.title AS sop_title, s.code AS sop_code, f.section_key,
         f.user_id, f.reviewer_name, f.reviewer_dept, f.reviewer_role, f.fb_type,
         f.comment, f.proposed, f.evidence, f.status, f.response, f.response_note,
         u.display_name AS responder_name, f.responded_at, f.created_at
  FROM sop_feedback f
  JOIN sops s ON s.id = f.sop_id
  LEFT JOIN users u ON u.id = f.responded_by`;

export type FeedbackView = "mine" | "all";

export async function listSopFeedback(opts: {
  view: FeedbackView;
  userId: number;
  sopId?: number;
  section?: string;
  q?: string;
  status?: string;
}): Promise<SopFeedback[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.view === "mine") {
    params.push(opts.userId);
    where.push(`f.user_id = $${params.length}`);
  }
  if (opts.sopId) {
    params.push(opts.sopId);
    where.push(`f.sop_id = $${params.length}`);
  }
  if (opts.section) {
    params.push(opts.section);
    where.push(`f.section_key = $${params.length}`);
  }
  if (opts.status === "Open" || opts.status === "Closed") {
    params.push(opts.status);
    where.push(`f.status = $${params.length}`);
  }
  if (opts.q?.trim()) {
    params.push(`%${opts.q.trim()}%`);
    const p = `$${params.length}`;
    where.push(
      `(s.title LIKE ${p} OR f.fb_type LIKE ${p} OR f.comment LIKE ${p} OR f.reviewer_name LIKE ${p} OR f.proposed LIKE ${p})`
    );
  }
  return queryAll<SopFeedback>(
    `${FB_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY f.created_at DESC, f.id DESC`,
    params
  );
}

/** Feedback count per section of one SOP (key "general" = whole SOP). */
export async function sopFeedbackCountBySection(sopId: number): Promise<Record<string, number>> {
  const rows = await queryAll<{ section_key: string; n: number }>(
    `SELECT section_key, COUNT(*) AS n FROM sop_feedback WHERE sop_id = $1 GROUP BY section_key`,
    [sopId]
  );
  return Object.fromEntries(rows.map((r) => [r.section_key, Number(r.n)]));
}

/** Open feedback per SOP, for the register badges. */
export async function openFeedbackBySop(): Promise<Record<number, number>> {
  const rows = await queryAll<{ sop_id: number; n: number }>(
    `SELECT sop_id, COUNT(*) AS n FROM sop_feedback WHERE status = N'Open' GROUP BY sop_id`
  );
  return Object.fromEntries(rows.map((r) => [r.sop_id, Number(r.n)]));
}

export async function createSopFeedback(input: {
  sopId: number;
  sectionKey: string;
  userId: number;
  reviewerName: string;
  reviewerDept: string | null;
  reviewerRole: string | null;
  fbType: string;
  comment: string;
  proposed: string | null;
  evidence: string | null;
}): Promise<number> {
  const row = await queryOne<{ id: number }>(
    `INSERT INTO sop_feedback
       (sop_id, section_key, user_id, reviewer_name, reviewer_dept, reviewer_role, fb_type, comment, proposed, evidence)
     OUTPUT INSERTED.id
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      input.sopId,
      input.sectionKey,
      input.userId,
      input.reviewerName,
      input.reviewerDept,
      input.reviewerRole,
      input.fbType,
      input.comment,
      input.proposed,
      input.evidence,
    ]
  );
  return row!.id;
}

export async function getSopFeedback(id: number): Promise<SopFeedback | undefined> {
  return queryOne<SopFeedback>(`${FB_SELECT} WHERE f.id = $1`, [id]);
}

export async function respondSopFeedback(input: {
  id: number;
  responderId: number;
  response: string | null;
  note: string | null;
  status: "Open" | "Closed";
}): Promise<void> {
  await execute(
    `UPDATE sop_feedback
       SET response = $1, response_note = $2, status = $3,
           responded_by = $4, responded_at = SYSUTCDATETIME()
     WHERE id = $5`,
    [input.response, input.note, input.status, input.responderId, input.id]
  );
}

/** Reviewers may withdraw their own feedback while nobody has responded. */
export async function deleteOwnSopFeedback(id: number, userId: number): Promise<number> {
  return execute(
    `DELETE FROM sop_feedback WHERE id = $1 AND user_id = $2 AND response IS NULL`,
    [id, userId]
  );
}

/** Every non-archived SOP with its template sections, for "Ask the SOPs". */
export type SopSearchDoc = {
  id: number;
  code: string | null;
  title: string;
  status: string;
  description: string | null;
  is_all_departments: boolean;
  department_ids: number[];
  department_names: string[];
} & Record<string, unknown>;

export async function listSopsForSearch(): Promise<SopSearchDoc[]> {
  const rows = await queryAll<Record<string, unknown>>(
    `SELECT s.id, s.code, s.title, s.status, s.description, s.is_all_departments,
            s.purpose, s.scope, s.process_flow, s.roles_responsibilities, s.inputs_outputs,
            s.tools_forms, s.kpis, s.ownership_review, s.appendices, s.signatures_approval,
            (SELECT STRING_AGG(CAST(sd.department_id AS NVARCHAR(12)), ',') FROM sop_departments sd WHERE sd.sop_id = s.id) AS dept_ids,
            (SELECT STRING_AGG(d.name, '|') FROM sop_departments sd JOIN departments d ON d.id = sd.department_id WHERE sd.sop_id = s.id) AS dept_names
     FROM sops s
     WHERE s.status <> N'archived'`
  );
  return rows.map((r) => ({
    ...r,
    is_all_departments: !!r.is_all_departments,
    department_ids: r.dept_ids ? String(r.dept_ids).split(",").map(Number) : [],
    department_names: r.dept_names ? String(r.dept_names).split("|") : [],
  })) as SopSearchDoc[];
}
