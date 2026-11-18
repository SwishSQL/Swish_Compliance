import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/guard";
import { listForUser, unreadCount } from "@/features/notifications/repository";

/** GET /api/notifications — used by the bell to poll the user's inbox. */
export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [items, unread] = await Promise.all([
    listForUser(user.id, { limit: 10 }),
    unreadCount(user.id),
  ]);

  return NextResponse.json(
    { items, unread },
    {
      headers: {
        // Tell the browser never to cache so the count is always live.
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}
