"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/guard";
import { execute, queryOne } from "@/lib/db";

/**
 * Bring an archived SOP back to Approved (admin only). The original
 * approver and approval date are kept — this undoes the archive, it is not
 * a new approval, so no approval/acknowledgement notifications are sent.
 * Refused while another approved version of the same SOP is live, so two
 * versions can never be in force at once.
 */
export async function restoreSopAction(formData: FormData) {
  const user = await requireUser();
  if (user.role !== "admin") throw new Error("Only an admin can restore an archived SOP.");
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid SOP.");

  const live = await queryOne<{ id: number }>(
    `SELECT other.id
     FROM sops other
     JOIN sops me ON me.id = $1
     WHERE other.id <> me.id AND other.status = 'approved'
       AND (other.revision_of_id = me.id OR me.revision_of_id = other.id
            OR (me.code IS NOT NULL AND other.code = me.code))`,
    [id]
  );
  if (live) {
    throw new Error(
      `Another version of this SOP is currently approved (SOP #${live.id}). Archive it first.`
    );
  }

  const changed = await execute(
    `UPDATE sops SET status = 'approved' WHERE id = $1 AND status = 'archived'`,
    [id]
  );
  if (!changed) throw new Error("This SOP is not archived.");

  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details)
     VALUES ($1, $2, 'sop:restored', 'sop', $3, $4)`,
    [
      user.id,
      user.email,
      id,
      JSON.stringify({
        from: "archived",
        to: "approved",
        user_name: user.displayName,
        user_role: user.role,
      }),
    ]
  );

  revalidatePath("/sops");
  revalidatePath(`/sops/${id}`);
}
