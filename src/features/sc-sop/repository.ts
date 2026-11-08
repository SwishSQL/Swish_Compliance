import "server-only";
import { queryAll, queryOne, execute } from "@/lib/db";
import type { ScFeedback, ScMeta, ScProcess, ScRef, ScRegister, ScStep } from "./types";

/*
 * The docket itself only changes with a migration, so it is loaded once per
 * server process and kept in memory (≈ 0.5 MB). Feedback is always live.
 */
let cached: { at: number; reg: ScRegister } | null = null;
const TTL_MS = 10 * 60_000;

export async function getRegister(): Promise<ScRegister> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.reg;
  const [metaRows, procRows, stepRows, refRows] = await Promise.all([
    queryAll<{ meta_key: string; data: string }>(`SELECT meta_key, data FROM sc_sop_meta`),
    queryAll<{ data: string }>(`SELECT data FROM sc_sop_processes ORDER BY seq`),
    queryAll<{ data: string }>(`SELECT data FROM sc_sop_steps ORDER BY seq`),
    queryAll<{ id: string; data: string }>(`SELECT id, data FROM sc_sop_refs`),
  ]);
  const meta = Object.fromEntries(metaRows.map((r) => [r.meta_key, JSON.parse(r.data)])) as ScMeta;
  const reg: ScRegister = {
    meta,
    procs: procRows.map((r) => JSON.parse(r.data) as ScProcess),
    steps: stepRows.map((r) => JSON.parse(r.data) as ScStep),
    refs: Object.fromEntries(refRows.map((r) => [r.id, JSON.parse(r.data) as ScRef])),
  };
  cached = { at: Date.now(), reg };
  return reg;
}

/* ─── Feedback ─────────────────────────────────────────────────────── */

const FB_SELECT = `
  SELECT f.id, f.ref_code, f.source, f.user_id, f.reviewer_name, f.reviewer_dept,
         f.reviewer_role, f.step_ref, f.fb_type, f.comment, f.proposed, f.evidence,
         f.status, f.response, f.response_note, u.display_name AS responder_name,
         f.responded_at, f.created_at
  FROM sc_sop_feedback f
  LEFT JOIN users u ON u.id = f.responded_by`;

export type FeedbackView = "mine" | "register" | "all";

export async function listFeedback(opts: {
  view: FeedbackView;
  userId: number;
  q?: string;
  status?: string;
}): Promise<ScFeedback[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.view === "mine") {
    params.push(opts.userId);
    where.push(`f.user_id = $${params.length}`);
  } else if (opts.view === "register") {
    where.push(`f.source = N'register'`);
  }
  if (opts.status === "Open" || opts.status === "Closed") {
    params.push(opts.status);
    where.push(`f.status = $${params.length}`);
  }
  if (opts.q?.trim()) {
    params.push(`%${opts.q.trim()}%`);
    const p = `$${params.length}`;
    where.push(
      `(f.step_ref LIKE ${p} OR f.fb_type LIKE ${p} OR f.comment LIKE ${p} OR f.reviewer_name LIKE ${p} OR f.proposed LIKE ${p})`
    );
  }
  return queryAll<ScFeedback>(
    `${FB_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY f.created_at DESC, f.id DESC`,
    params
  );
}

export async function feedbackCounts(userId: number): Promise<{ mine: number; register: number; all: number; open: number }> {
  const row = await queryOne<{ mine: number; register: number; all_n: number; open_n: number }>(
    `SELECT SUM(CASE WHEN user_id = $1 THEN 1 ELSE 0 END) AS mine,
            SUM(CASE WHEN source = N'register' THEN 1 ELSE 0 END) AS register,
            COUNT(*) AS all_n,
            SUM(CASE WHEN status = N'Open' THEN 1 ELSE 0 END) AS open_n
     FROM sc_sop_feedback`,
    [userId]
  );
  return {
    mine: Number(row?.mine ?? 0),
    register: Number(row?.register ?? 0),
    all: Number(row?.all_n ?? 0),
    open: Number(row?.open_n ?? 0),
  };
}

/** Feedback count per step / process reference, for the docket badges. */
export async function feedbackCountByStep(): Promise<Record<string, number>> {
  const rows = await queryAll<{ step_ref: string; n: number }>(
    `SELECT step_ref, COUNT(*) AS n FROM sc_sop_feedback GROUP BY step_ref`
  );
  return Object.fromEntries(rows.map((r) => [r.step_ref, Number(r.n)]));
}

export async function createFeedback(input: {
  userId: number;
  reviewerName: string;
  reviewerDept: string | null;
  reviewerRole: string | null;
  stepRef: string;
  fbType: string;
  comment: string;
  proposed: string | null;
  evidence: string | null;
}): Promise<number> {
  const row = await queryOne<{ id: number }>(
    `INSERT INTO sc_sop_feedback
       (source, user_id, reviewer_name, reviewer_dept, reviewer_role, step_ref, fb_type, comment, proposed, evidence)
     OUTPUT INSERTED.id
     VALUES (N'app', $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      input.userId,
      input.reviewerName,
      input.reviewerDept,
      input.reviewerRole,
      input.stepRef,
      input.fbType,
      input.comment,
      input.proposed,
      input.evidence,
    ]
  );
  const id = row!.id;
  await execute(`UPDATE sc_sop_feedback SET ref_code = $1 WHERE id = $2`, [
    `FB-A${String(id).padStart(4, "0")}`,
    id,
  ]);
  return id;
}

export async function getFeedback(id: number): Promise<ScFeedback | undefined> {
  return queryOne<ScFeedback>(`${FB_SELECT} WHERE f.id = $1`, [id]);
}

export async function respondFeedback(input: {
  id: number;
  responderId: number;
  response: string | null;
  note: string | null;
  status: "Open" | "Closed";
}): Promise<void> {
  await execute(
    `UPDATE sc_sop_feedback
       SET response = $1, response_note = $2, status = $3,
           responded_by = $4, responded_at = SYSUTCDATETIME()
     WHERE id = $5`,
    [input.response, input.note, input.status, input.responderId, input.id]
  );
}

/** Reviewers may withdraw their own feedback while nobody has responded. */
export async function deleteOwnFeedback(id: number, userId: number): Promise<number> {
  return execute(
    `DELETE FROM sc_sop_feedback WHERE id = $1 AND user_id = $2 AND source = N'app' AND response IS NULL`,
    [id, userId]
  );
}
