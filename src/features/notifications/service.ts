import "server-only";
import { execute, queryAll } from "@/lib/db";
import type { NotificationSeverity } from "./types";

type Audience = {
  /** Specific user IDs to notify (always included unless excluded). */
  userIds?: number[];
  /** Notify every active user holding one of these roles. */
  roles?: string[];
  /** Always exclude the actor (so people don't notify themselves). */
  excludeActorId?: number;
};

type Actor = {
  id: number;
  name: string;
  role: string;
};

type NotifyInput = {
  audience: Audience;
  actor: Actor;
  kind: string;
  title: string;
  body?: string | null;
  severity?: NotificationSeverity;
  entity?: { type: string; id: number; href: string };
};

/** Resolve the audience to a deduped list of user IDs. */
async function resolveAudience(audience: Audience): Promise<number[]> {
  const set = new Set<number>();

  if (audience.userIds) {
    audience.userIds.forEach((id) => set.add(id));
  }
  if (audience.roles && audience.roles.length > 0) {
    const rows = await queryAll<{ id: number }>(
      `SELECT id FROM users
       WHERE is_active = 1 AND role = ANY($1::text[])`,
      [audience.roles]
    );
    rows.forEach((r) => set.add(r.id));
  }
  if (audience.excludeActorId) {
    set.delete(audience.excludeActorId);
  }
  return Array.from(set);
}

/**
 * Fan a single event out to its audience. Each recipient gets their own
 * notification row. Safe to call from server actions — failures are caught
 * here so a notification glitch never breaks the underlying business action.
 */
export async function notify(input: NotifyInput): Promise<void> {
  try {
    const recipients = await resolveAudience({
      ...input.audience,
      excludeActorId: input.actor.id,
    });
    if (recipients.length === 0) {
      console.warn(
        `[notifications] notify(${input.kind}) — no recipients matched audience`,
        JSON.stringify(input.audience)
      );
      return;
    }
    console.log(
      `[notifications] notify(${input.kind}) → ${recipients.length} recipient(s):`,
      recipients
    );

    const severity = input.severity ?? "info";

    // Bulk insert via a single query with one row per recipient. The
    // recipient ids travel as one JSON param so a large audience can't hit
    // SQL Server's 2,100-parameter / 1,000-row VALUES limits.
    await execute(
      `INSERT INTO notifications
        (user_id, actor_id, actor_name, actor_role, kind, title, body, severity,
         entity_type, entity_id, href)
       SELECT CAST(r.value AS INT), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
       FROM OPENJSON($1) r`,
      [
        JSON.stringify(recipients),
        input.actor.id,
        input.actor.name,
        input.actor.role,
        input.kind,
        input.title,
        input.body ?? null,
        severity,
        input.entity?.type ?? null,
        input.entity?.id ?? null,
        input.entity?.href ?? null,
      ]
    );
  } catch (err) {
    // Don't let notification errors bubble up into the main action.
    console.error("[notifications] notify() failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Audience helpers used across actions
// ---------------------------------------------------------------------------

export const ROLE_COMPLIANCE = ["compliance"];
export const ROLE_BE = ["business_excellence"];
export const ROLE_CEO = ["ceo"];
export const ROLE_ADMIN = ["admin"];
export const ROLE_REVIEWERS = ["compliance", "business_excellence", "ceo"];
