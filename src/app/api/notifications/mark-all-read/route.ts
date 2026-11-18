import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/guard";
import { markAllRead } from "@/features/notifications/repository";

export async function POST() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await markAllRead(user.id);
  return NextResponse.json({ ok: true });
}
