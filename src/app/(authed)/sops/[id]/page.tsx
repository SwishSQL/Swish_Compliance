import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, canDeleteOrArchive } from "@/lib/auth/guard";
import Workspace from "@/features/shell/Workspace";
import { getSopById, listSopEvents } from "@/features/sops/repository";
import { queryAll } from "@/lib/db";
import {
  SOP_STATUS_LABEL,
  SOP_STATUS_TONE,
  SOP_SECTIONS,
  isSopLocked,
  availableTransitions,
  canEditSopFields,
} from "@/features/sops/types";
import {
  updateSopAttachmentAction,
  removeSopAttachmentAction,
} from "@/features/sops/actions";
import { acknowledgeSopAction } from "@/features/sops/acknowledgments/actions";
import {
  hasUserAcknowledged,
  getAckStats,
  listAcknowledgments,
} from "@/features/sops/acknowledgments/repository";
import FilePicker from "@/features/sops/FilePicker";
import AttachmentDisplay from "@/features/sops/AttachmentDisplay";
import ApprovalActions from "@/features/sops/ApprovalActions";
import DeleteEntityButton from "@/features/admin/delete/DeleteEntityButton";

const ROLE_LABEL: Record<string, string> = {
  admin: "Administrator",
  ceo: "CEO",
  business_excellence: "Business Excellence",
  compliance: "Compliance",
  opex: "Operational Excellence",
  department_manager: "Department Manager",
  auditor: "Auditor",
  viewer: "Viewer",
};

export default async function SopDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id: idStr } = await params;
  const id = Number(idStr);
  const sop = await getSopById(id);
  if (!sop) notFound();

  const locked = isSopLocked(sop.status);
  const transitions = availableTransitions(user.role, sop.status);
  const events = await listSopEvents(id);

  // Cross-references (user spec): each SOP has ONE home domain (from its
  // department); its frameworks are the ones under that home domain.
  const sopDomains = await queryAll<{ id: number; name: string }>(
    `SELECT dm.id, dm.name FROM domains dm
     JOIN sops s ON s.home_domain_id = dm.id
     WHERE s.id = $1`,
    [id]
  );
  const sopFrameworks = await queryAll<{ id: number; code: string | null; name: string }>(
    `SELECT f.id, f.code, f.name
     FROM frameworks f
     JOIN sops s ON s.home_domain_id = f.domain_id
     WHERE s.id = $1
     ORDER BY f.code, f.name`,
    [id]
  );

  // Acknowledgments — only relevant once the SOP is approved.
  const isApproved = sop.status === "approved";
  const userAck = isApproved ? await hasUserAcknowledged(id, user.id) : false;
  const ackStats = isApproved
    ? await getAckStats(id)
    : { total_eligible: 0, acknowledged_count: 0, percent: 0 };
  const ackList =
    isApproved && user.role === "admin" ? await listAcknowledgments(id, 50) : [];

  // Editing the attachment is allowed for:
  //  - admin always (until locked)
  //  - department_manager when status is draft or returned_to_dm and they own it
  //  - compliance when status is pending_compliance or returned_to_compliance
  //  - business_excellence when status is pending_business_excellence or returned_to_be
  //  - ceo when status is pending_ceo
  const canEditAttachment =
    !locked &&
    (user.role === "admin" ||
      (user.role === "department_manager" &&
        (sop.status === "draft" || sop.status === "returned_to_dm") &&
        (sop.owner_id === user.id || sop.created_by === user.id)) ||
      (user.role === "compliance" &&
        (sop.status === "pending_compliance" || sop.status === "returned_to_compliance")) ||
      (user.role === "business_excellence" &&
        (sop.status === "pending_business_excellence" || sop.status === "returned_to_be")) ||
      (user.role === "ceo" && sop.status === "pending_ceo"));

  // Most-recent rejection comment to surface above the actions card so the
  // current actor can read it without scrolling to history.
  const recentRejection = events.find(
    (e) =>
      (e.action === "sop:returned_to_dm" ||
        e.action === "sop:returned_to_compliance" ||
        e.action === "sop:returned_to_be") &&
      e.details &&
      (e.details as Record<string, unknown>).comment
  );

  return (
    <Workspace
      section="Compliance Library / SOPs & Policies"
      subtitle={sop.title}
      sessionLabel="Session"
      userLabel={user.displayName}
    >
      {/* Header card */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 mb-4">
        <div className="flex items-start justify-between gap-6 mb-6">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <span
                className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${SOP_STATUS_TONE[sop.status]}`}
              >
                {SOP_STATUS_LABEL[sop.status]}
              </span>
              <span className="text-xs text-gray-500">v{sop.version}</span>
              {locked && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                  🔒 Locked — read only
                </span>
              )}
            </div>
            <h2 className="text-2xl font-bold text-gray-900">{sop.title}</h2>
            {sop.description && (
              <p className="text-gray-600 mt-2 whitespace-pre-line">{sop.description}</p>
            )}
          </div>

          {sop.file_url && (
            <a
              href={sop.file_url}
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium whitespace-nowrap"
            >
              Open external link ↗
            </a>
          )}
        </div>

        {/* Attachment (if any) */}
        {sop.attachment_data_url && (
          <div className="mb-6">
            <AttachmentDisplay
              dataUrl={sop.attachment_data_url}
              name={sop.attachment_name}
              mime={sop.attachment_mime}
            />
          </div>
        )}

        <div className="flex items-center gap-4">
          <Link href="/sops" className="text-sm text-gray-500 hover:text-gray-700">
            ← Back to list
          </Link>
          {/* Edit button — visible only when the current role + status combo
              allows content edits (matches the canEditSopFields gate in
              the action). Locked statuses (approved / archived) hide it. */}
          <div className="ml-auto flex items-center gap-2">
            {canEditSopFields(user.role, sop.status) && (
              <Link
                href={`/sops/${sop.id}/edit`}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-brand-50 text-brand-700 border border-brand-200 hover:bg-brand-100"
              >
                ✏️ Edit SOP
              </Link>
            )}
            {canDeleteOrArchive(user.role) && (
              <DeleteEntityButton entityType="sop" entityId={sop.id} label="SOP" />
            )}
          </div>
        </div>
      </div>

      {/* Highlight the most-recent rejection comment so the current actor sees it */}
      {recentRejection && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5 mb-4">
          <div className="text-xs font-semibold text-red-700 uppercase tracking-wider mb-1">
            Last rejection comment
          </div>
          <div className="text-sm text-red-900 italic">
            &ldquo;{((recentRejection.details ?? {}) as { comment?: string }).comment}&rdquo;
          </div>
          <div className="text-xs text-red-700 mt-2">
            by {((recentRejection.details ?? {}) as { user_name?: string }).user_name ?? recentRejection.user_email}
            {" · "}
            {ROLE_LABEL[
              ((recentRejection.details ?? {}) as { user_role?: string }).user_role ?? ""
            ] ?? "—"}
            {" · "}
            {new Date(recentRejection.created_at).toLocaleString()}
          </div>
        </div>
      )}

      {/* Workflow actions. `transitions` already comes from
          availableTransitions(role, status), which is the authoritative
          check — it correctly returns the Approved→Archived transition
          for admin/compliance even though the SOP is otherwise locked.
          The old `&& !locked` here duplicated that check incorrectly and
          hid Archive along with everything else, so an approved SOP had
          no visible actions for anyone, admin included. */}
      {transitions.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-4">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">
            Available actions
          </h3>
          <ApprovalActions
            sopId={sop.id}
            transitions={transitions.map((t) => ({
              to: t.to,
              label: t.label,
              description: t.description,
              tone: t.tone,
              commentRequired: t.commentRequired,
            }))}
          />
          <p className="text-xs text-gray-500 mt-3">
            Click any action — a popup will ask you for the comment that will be
            stored in the approval history.
          </p>
        </div>
      )}

      {/* Locked banner */}
      {locked && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 mb-4 text-sm text-emerald-800">
          🔒 This SOP has been given final approval by the CEO and is now locked.
          No further modifications are allowed by any user.
        </div>
      )}

      {/* ─── Acknowledgment block (only on approved SOPs) ─── */}
      {isApproved && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden mb-4">
          {/* Top strip — user-specific call-to-action */}
          {userAck ? (
            <div className="bg-gradient-to-r from-emerald-50 to-emerald-100/70 border-b border-emerald-200 px-6 py-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xl shrink-0">
                ✓
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-emerald-900">
                  You&rsquo;ve confirmed you read &amp; understood this SOP
                </div>
                <div className="text-xs text-emerald-700 mt-0.5">
                  Recorded under your account ({user.displayName}). Your role and timestamp are stored in the audit log.
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-gradient-to-r from-amber-50 to-amber-100/70 border-b border-amber-200 px-6 py-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-amber-500 text-white flex items-center justify-center text-xl shrink-0">
                  📖
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-amber-900">
                    Please read this SOP and confirm
                  </div>
                  <div className="text-xs text-amber-800 mt-0.5">
                    Open the attachment, read it through, then click below. Your acknowledgment is logged with your name, role, and timestamp.
                  </div>
                </div>
              </div>
              <form action={acknowledgeSopAction}>
                <input type="hidden" name="sop_id" value={sop.id} />
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 bg-brand-700 hover:bg-brand-800 text-white px-4 py-2.5 rounded-lg text-sm font-medium shadow-sm"
                >
                  ✓ I&rsquo;ve read &amp; understood
                </button>
              </form>
            </div>
          )}

          {/* Team progress bar */}
          <div className="px-6 py-5">
            <div className="flex items-end justify-between mb-2">
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold">
                  Team acknowledgment
                </div>
                <div className="text-sm font-semibold text-gray-800 mt-0.5">
                  {ackStats.acknowledged_count} of {ackStats.total_eligible} acknowledged
                  {ackStats.total_eligible > 0 && (
                    <span className="text-gray-400 font-normal ml-2">
                      ({ackStats.percent}%)
                    </span>
                  )}
                </div>
              </div>
              {ackStats.total_eligible > 0 && (
                <div
                  className={`text-2xl font-bold tabular-nums ${
                    ackStats.percent >= 80
                      ? "text-emerald-600"
                      : ackStats.percent >= 50
                        ? "text-amber-600"
                        : "text-red-600"
                  }`}
                >
                  {ackStats.percent}%
                </div>
              )}
            </div>
            <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all bg-gradient-to-r ${
                  ackStats.percent >= 80
                    ? "from-emerald-400 to-emerald-600"
                    : ackStats.percent >= 50
                      ? "from-amber-400 to-amber-600"
                      : "from-red-400 to-red-600"
                }`}
                style={{ width: `${ackStats.percent}%` }}
              />
            </div>
            <div className="text-[11px] text-gray-500 mt-2">
              {sop.department_names.length > 0
                ? `Eligible audience: active members of ${sop.department_names.join(", ")} + administrators.`
                : `Eligible audience: all active users (this SOP has no department assigned).`}
            </div>

            {/* Admin-only list of who acknowledged */}
            {user.role === "admin" && ackList.length > 0 && (
              <div className="mt-5 border-t border-gray-100 pt-4">
                <div className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold mb-2">
                  Who has acknowledged ({ackList.length})
                </div>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-1.5 text-xs">
                  {ackList.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-gray-50"
                    >
                      <span className="font-medium text-gray-800 truncate">
                        {a.user_name}
                      </span>
                      <span className="text-gray-500 shrink-0">
                        {new Date(a.acknowledged_at).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Manage attachment */}
      {canEditAttachment && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 mb-4">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">
            Attachment
          </h3>

          {sop.attachment_data_url ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                Replace the current file or remove it. Every change is recorded in the audit log.
              </p>
              <form action={updateSopAttachmentAction} className="space-y-3">
                <input type="hidden" name="id" value={sop.id} />
                <FilePicker name="attachment_file" />
                <button
                  type="submit"
                  className="bg-brand-700 hover:bg-brand-800 text-white px-4 py-2 rounded-lg text-sm font-medium"
                >
                  Replace attachment
                </button>
              </form>

              <form action={removeSopAttachmentAction} className="pt-2 border-t border-gray-100">
                <input type="hidden" name="id" value={sop.id} />
                <button
                  type="submit"
                  className="text-sm text-red-600 hover:text-red-800 hover:underline"
                >
                  Remove the current attachment
                </button>
              </form>
            </div>
          ) : (
            <form action={updateSopAttachmentAction} className="space-y-3">
              <input type="hidden" name="id" value={sop.id} />
              <FilePicker name="attachment_file" />
              <button
                type="submit"
                className="bg-brand-700 hover:bg-brand-800 text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                Upload attachment
              </button>
            </form>
          )}
        </div>
      )}

      {/* Approval history */}
      {events.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-4">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">
            Approval history ({events.length})
          </h3>
          <ol className="space-y-3">
            {events.map((e) => {
              const detail = (e.details ?? {}) as {
                from?: string;
                to?: string;
                comment?: string;
                user_name?: string;
                user_role?: string;
                name?: string;
              };
              const friendly = friendlyAction(e.action);
              const userName = detail.user_name ?? e.user_email ?? "system";
              const userRole = ROLE_LABEL[detail.user_role ?? ""] ?? detail.user_role ?? "";
              return (
                <li key={e.id} className="border-l-2 border-gray-200 pl-4 pb-2">
                  <div className="flex items-center gap-2 text-sm flex-wrap">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${friendly.tone}`}
                    >
                      {friendly.label}
                    </span>
                    <span className="text-gray-800 font-medium">{userName}</span>
                    {userRole && (
                      <span className="text-xs text-gray-500">({userRole})</span>
                    )}
                    <span className="text-xs text-gray-400">
                      · {new Date(e.created_at).toLocaleString()}
                    </span>
                  </div>
                  {detail.from && detail.to && (
                    <div className="text-xs text-gray-500 mt-1">
                      Status: <span className="font-mono">{detail.from}</span> →{" "}
                      <span className="font-mono">{detail.to}</span>
                    </div>
                  )}
                  {detail.comment && (
                    <div className="mt-2 p-3 bg-gray-50 rounded-lg text-sm text-gray-800 italic">
                      &ldquo;{detail.comment}&rdquo;
                    </div>
                  )}
                  {detail.name && !detail.comment && (
                    <div className="text-xs text-gray-500 mt-1">File: {detail.name}</div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* ── Structured SOP sections (Universal Template) ─────────── */}
      {SOP_SECTIONS.some((s) => {
        const v = sop[s.key as keyof typeof sop];
        return typeof v === "string" && v.trim().length > 0;
      }) && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden mb-4">
          <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-brand-50 to-emerald-50/50">
            <h3 className="text-sm font-semibold text-brand-800 uppercase tracking-wider">
              📝 SOP Content
            </h3>
            <p className="text-[11px] text-brand-700/80 mt-0.5">
              Structured sections from the Universal SOP Template.
            </p>
          </div>
          <div className="divide-y divide-gray-100">
            {SOP_SECTIONS.map((sec) => {
              const value = sop[sec.key as keyof typeof sop];
              if (typeof value !== "string" || value.trim().length === 0) return null;
              return (
                <div key={sec.key} className="px-6 py-5">
                  <div className="flex items-center gap-2.5 mb-3">
                    <span className="w-8 h-8 rounded-lg bg-brand-700 text-white text-xs font-bold flex items-center justify-center shrink-0">
                      {sec.num}
                    </span>
                    <h4 className="text-sm font-bold text-gray-800 tracking-wide uppercase">
                      {sec.label}
                    </h4>
                  </div>
                  <pre className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap font-sans bg-gray-50 rounded-lg p-4 border border-gray-100">
                    {value}
                  </pre>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Metadata grid */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">
          Details
        </h3>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 text-sm">
          <Field label="Brand">
            {sop.brand_is_function ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-brand-50 text-brand-700 border border-brand-200">
                ✦ Brand / Function
              </span>
            ) : (
              sop.brand_name ?? "—"
            )}
          </Field>
          <Field label={sop.department_names.length > 1 ? "Departments" : "Department"}>
            {sop.is_all_departments ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-brand-50 text-brand-700 border border-brand-200">
                ✦ All departments
              </span>
            ) : sop.department_names.length > 0 ? (
              <span className="flex flex-wrap gap-1">
                {sop.department_names.map((name) => (
                  <span
                    key={name}
                    className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700 border border-gray-200"
                  >
                    {name}
                  </span>
                ))}
              </span>
            ) : (
              "—"
            )}
          </Field>
          <Field label="Owner">{sop.owner_name ?? "—"}</Field>
          <Field label="Created by">{sop.created_by_name ?? "—"}</Field>
          <Field label="Effective date">{formatDate(sop.effective_date)}</Field>
          <Field label="Next review">{formatDate(sop.review_date)}</Field>
          <Field label="Created at">{formatDateTime(sop.created_at)}</Field>
          <Field label="Last updated">{formatDateTime(sop.updated_at)}</Field>
          {sop.approved_by_name && (
            <>
              <Field label="Approved by">{sop.approved_by_name}</Field>
              <Field label="Approved at">{formatDateTime(sop.approved_at)}</Field>
            </>
          )}
        </dl>
      </div>

      {/* Cross-reference panels — Domains + Frameworks governing this SOP */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        <details className="group bg-white rounded-xl border border-gray-200 shadow-sm">
          <summary className="cursor-pointer list-none px-4 py-3 flex items-center gap-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <span className="transition-transform group-open:rotate-90 text-gray-400">▶</span>
            Domains ({sopDomains.length})
          </summary>
          <ul className="border-t border-gray-100 divide-y divide-gray-100">
            {sopDomains.length === 0 && <li className="px-4 py-3 text-xs text-gray-400">No linked domains.</li>}
            {sopDomains.map((d) => (
              <li key={d.id} className="px-4 py-2 text-sm">
                <Link href={`/domains/${d.id}`} className="text-brand-700 hover:underline">{d.name}</Link>
              </li>
            ))}
          </ul>
        </details>
        <details className="group bg-white rounded-xl border border-gray-200 shadow-sm">
          <summary className="cursor-pointer list-none px-4 py-3 flex items-center gap-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <span className="transition-transform group-open:rotate-90 text-gray-400">▶</span>
            Frameworks ({sopFrameworks.length})
          </summary>
          <ul className="border-t border-gray-100 divide-y divide-gray-100">
            {sopFrameworks.length === 0 && <li className="px-4 py-3 text-xs text-gray-400">No linked frameworks.</li>}
            {sopFrameworks.map((f) => (
              <li key={f.id} className="px-4 py-2 text-sm">
                <Link href={`/frameworks/${f.id}`} className="text-brand-700 hover:underline">
                  {f.name}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </Workspace>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-gray-500 mb-1">{label}</dt>
      <dd className="text-gray-900">{children}</dd>
    </div>
  );
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString();
}
function formatDateTime(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

function friendlyAction(action: string): { label: string; tone: string } {
  if (action === "create")                       return { label: "Created", tone: "bg-gray-100 text-gray-700" };
  if (action === "sop:pending_compliance")       return { label: "Sent to Compliance", tone: "bg-amber-50 text-amber-700" };
  if (action === "sop:returned_to_dm")           return { label: "Rejected → returned to DM", tone: "bg-red-50 text-red-700" };
  if (action === "sop:pending_business_excellence") return { label: "Approved → forwarded to BE", tone: "bg-indigo-50 text-indigo-700" };
  if (action === "sop:returned_to_compliance")   return { label: "Rejected → returned to Compliance", tone: "bg-red-50 text-red-700" };
  if (action === "sop:pending_ceo")              return { label: "Approved → forwarded to CEO", tone: "bg-purple-50 text-purple-700" };
  if (action === "sop:returned_to_be")           return { label: "Rejected → returned to BE", tone: "bg-red-50 text-red-700" };
  if (action === "sop:approved")                 return { label: "Final Approved 🔒", tone: "bg-emerald-50 text-emerald-700" };
  if (action === "sop:archived")                 return { label: "Archived", tone: "bg-gray-100 text-gray-700" };
  if (action === "sop:attachment_updated")       return { label: "Attachment updated", tone: "bg-indigo-50 text-indigo-700" };
  if (action === "sop:attachment_removed")       return { label: "Attachment removed", tone: "bg-gray-100 text-gray-600" };
  if (action === "sop:acknowledged")             return { label: "Acknowledged ✓", tone: "bg-emerald-50 text-emerald-700" };
  return { label: action, tone: "bg-gray-100 text-gray-700" };
}
