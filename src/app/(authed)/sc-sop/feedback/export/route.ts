import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { listFeedback, type FeedbackView } from "@/features/sc-sop/repository";
import { canTriageScFeedback } from "@/features/sc-sop/types";

/** CSV of the feedback list as filtered on /sc-sop/feedback (opens in Excel). */
export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  const sp = req.nextUrl.searchParams;
  const v = sp.get("view");
  const view: FeedbackView = v === "register" ? "register" : v === "all" && canTriageScFeedback(user.role) ? "all" : "mine";
  const rows = await listFeedback({
    view,
    userId: user.id,
    q: sp.get("q") ?? undefined,
    status: sp.get("status") ?? undefined,
  });

  const cols = [
    ["Feedback ID", "ref_code"],
    ["Date", "created_at"],
    ["Name", "reviewer_name"],
    ["Department", "reviewer_dept"],
    ["Role", "reviewer_role"],
    ["Step ID", "step_ref"],
    ["Type", "fb_type"],
    ["Comment", "comment"],
    ["Proposed wording", "proposed"],
    ["Evidence", "evidence"],
    ["Response", "response"],
    ["Response note", "response_note"],
    ["Responded by", "responder_name"],
    ["Status", "status"],
  ] as const;
  const cell = (v: unknown) => {
    const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "");
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv =
    "﻿" +
    [cols.map((c) => c[0]).join(","), ...rows.map((r) => cols.map(([, k]) => cell(r[k])).join(","))].join("\r\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="Swish_SC_SOP_Feedback_${view}_${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
