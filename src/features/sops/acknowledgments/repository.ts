import "server-only";
import { queryAll, queryOne, execute } from "@/lib/db";

export type Acknowledgment = {
  id: number;
  sop_id: number;
  user_id: number;
  acknowledged_at: string;
  user_role: string | null;
  user_name: string;
  user_email: string;
};

export type AckStats = {
  total_eligible: number;
  acknowledged_count: number;
  percent: number;
};

/**
 * "Eligible to acknowledge" = active users in ANY of the SOP's departments
 * (migration 052 — a SOP can name several). A SOP with no departments at
 * all still falls back to every active user, so a company-wide SOP is
 * acknowledged by everyone. Admins are always eligible.
 */
export async function eligibleUserIds(sopId: number): Promise<number[]> {
  const rows = await queryAll<{ id: number }>(
    `SELECT u.id
     FROM users u
     WHERE u.is_active
       AND (
         u.role = 'admin'
         OR NOT EXISTS (SELECT 1 FROM sop_departments sd WHERE sd.sop_id = $1)
         OR EXISTS (
           SELECT 1 FROM sop_departments sd
           WHERE sd.sop_id = $1 AND sd.department_id = u.department_id
         )
       )`,
    [sopId]
  );
  return rows.map((r) => r.id);
}

export async function hasUserAcknowledged(
  sopId: number,
  userId: number
): Promise<boolean> {
  const row = await queryOne<{ id: number }>(
    `SELECT id FROM sop_acknowledgments WHERE sop_id = $1 AND user_id = $2 LIMIT 1`,
    [sopId, userId]
  );
  return !!row;
}

export async function recordAcknowledgment(input: {
  sop_id: number;
  user_id: number;
  user_role: string | null;
  user_agent: string | null;
  ip_address: string | null;
}): Promise<void> {
  await execute(
    `INSERT INTO sop_acknowledgments
       (sop_id, user_id, user_role, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (sop_id, user_id) DO NOTHING`,
    [
      input.sop_id,
      input.user_id,
      input.user_role,
      input.user_agent ? input.user_agent.slice(0, 500) : null,
      input.ip_address ? input.ip_address.slice(0, 60) : null,
    ]
  );
}

/**
 * Acknowledgment progress for a SOP. Used by the detail page banner
 * ("12 of 18 acknowledged") and by the reporting layer.
 */
export async function getAckStats(sopId: number): Promise<AckStats> {
  const eligibles = await eligibleUserIds(sopId);
  const totalEligible = eligibles.length;
  if (totalEligible === 0) {
    return { total_eligible: 0, acknowledged_count: 0, percent: 0 };
  }
  const acked = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n
     FROM sop_acknowledgments
     WHERE sop_id = $1 AND user_id = ANY($2::int[])`,
    [sopId, eligibles]
  );
  const ackCount = acked?.n ?? 0;
  return {
    total_eligible: totalEligible,
    acknowledged_count: ackCount,
    percent: Math.round((ackCount / totalEligible) * 100),
  };
}

export async function listAcknowledgments(
  sopId: number,
  limit = 100
): Promise<Acknowledgment[]> {
  return queryAll<Acknowledgment>(
    `SELECT a.id, a.sop_id, a.user_id, a.acknowledged_at, a.user_role,
            u.display_name AS user_name, u.email AS user_email
     FROM sop_acknowledgments a
     JOIN users u ON u.id = a.user_id
     WHERE a.sop_id = $1
     ORDER BY a.acknowledged_at DESC
     LIMIT $2`,
    [sopId, limit]
  );
}

/**
 * Approved SOPs the given user hasn't acknowledged yet AND is eligible
 * for. Drives the "SOPs awaiting your acknowledgment" tile on My Work.
 */
export async function listSopsAwaitingAck(
  userId: number,
  userRole: string,
  userDepartmentId: number | null,
  limit = 25
): Promise<Array<{ id: number; code: string | null; title: string; approved_at: string | null }>> {
  return queryAll(
    `SELECT s.id, s.code, s.title, s.approved_at
     FROM sops s
     WHERE s.status = 'approved'
       AND (
         $2 = 'admin'
         -- No departments named at all = company-wide (migration 052).
         OR NOT EXISTS (SELECT 1 FROM sop_departments sd WHERE sd.sop_id = s.id)
         OR EXISTS (
           SELECT 1 FROM sop_departments sd
           WHERE sd.sop_id = s.id AND sd.department_id = $3
         )
       )
       AND NOT EXISTS (
         SELECT 1 FROM sop_acknowledgments a
         WHERE a.sop_id = s.id AND a.user_id = $1
       )
     ORDER BY s.approved_at DESC NULLS LAST
     LIMIT $4`,
    [userId, userRole, userDepartmentId, limit]
  );
}
