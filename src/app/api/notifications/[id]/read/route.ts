import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/guard";
import { markRead } from "@/features/notifications/repository";

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await context.params;
  await markRead(Number(id), user.id);
  return NextResponse.json({ ok: true });
}
