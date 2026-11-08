import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { listSopFeedback } from "@/features/sops/feedback/repository";
import { visibleSops } from "@/features/sops/feedback/scope";
import { sectionLabel } from "@/features/sops/feedback/types";

/** CSV of SOP review feedback (opens in Excel), filtered like the page. */
export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  const sp = req.nextUrl.searchParams;
  const sopId = Number(sp.get("sop")) || undefined;
  const [sops, all] = await Promise.all([
    visibleSops(user),
    listSopFeedback({
      view: sp.get("view") === "mine" ? "mine" : "all",
      userId: user.id,
      sopId,
      q: sp.get("q") ?? undefined,
      status: sp.get("status") ?? undefined,
    }),
  ]);
  const ids = new Set(sops.map((s) => s.id));
  const rows = all.filter((r) => ids.has(r.sop_id) || r.user_id === user.id);

  const cols: [string, (r: (typeof rows)[number]) => unknown][] = [
    ["ID", (r) => r.id],
    ["Date", (r) => r.created_at],
    ["SOP code", (r) => r.sop_code],
    ["SOP", (r) => r.sop_title],
    ["Section", (r) => sectionLabel(r.section_key)],
    ["Name", (r) => r.reviewer_name],
    ["Department", (r) => r.reviewer_dept],
    ["Role", (r) => r.reviewer_role],
    ["Type", (r) => r.fb_type],
    ["Comment", (r) => r.comment],
    ["Proposed wording", (r) => r.proposed],
    ["Evidence", (r) => r.evidence],
    ["Response", (r) => r.response],
    ["Response note", (r) => r.response_note],
    ["Responded by", (r) => r.responder_name],
    ["Status", (r) => r.status],
  ];
  const cell = (v: unknown) => {
    const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "");
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv =
    "﻿" +
    [cols.map((c) => c[0]).join(","), ...rows.map((r) => cols.map(([, get]) => cell(get(r))).join(","))].join("\r\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="SOP_Feedback_${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
