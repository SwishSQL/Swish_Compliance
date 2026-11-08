import "server-only";
import { getUserScope } from "@/lib/auth/access";
import { listSopsForSearch, type SopSearchDoc } from "./repository";

/**
 * The SOPs a user may see, with the same rule as the SOPs & Policies
 * register: privileged roles see everything; others see SOPs for all
 * departments or for any department in their scope.
 */
export async function visibleSops(user: { id: number; role: string }): Promise<SopSearchDoc[]> {
  const [docs, scope] = await Promise.all([listSopsForSearch(), getUserScope(user.id, user.role)]);
  if (scope.full) return docs;
  return docs.filter(
    (d) => d.is_all_departments || d.department_ids.some((id) => scope.departmentIds.includes(id))
  );
}
