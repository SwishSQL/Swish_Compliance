import { NextResponse } from "next/server";
import { z } from "zod";
import { changeOwnPassword } from "@/lib/auth/session";
import { getAuthUser } from "@/lib/auth/guard";
import { execute } from "@/lib/db";

const Body = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters." },
      { status: 400 }
    );
  }

  const result = await changeOwnPassword(
    user.id,
    parsed.data.currentPassword,
    parsed.data.newPassword
  );
  if (result === "wrong_current") {
    return NextResponse.json(
      { error: "Current password is incorrect." },
      { status: 400 }
    );
  }

  await execute(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id)
     VALUES ($1, $2, 'change_password', 'user', $3)`,
    [user.id, user.email, user.id]
  );

  return NextResponse.json({ ok: true });
}
