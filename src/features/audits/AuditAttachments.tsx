"use client";

import { useRef, useState, useTransition } from "react";
import {
  addAuditAttachmentsAction,
  deleteAuditAttachmentAction,
} from "./actions";

type Attachment = {
  id: number;
  file_url: string;
  file_name: string;
  file_mime: string | null;
  file_size: number | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
};

/**
 * Audit-level multi-file upload + list. Sits inside the Submit-audit
 * card. Files are validated and stored as base64 data URLs on the
 * server; the input uses `multiple` so the user can pick several at
 * once or drop a folder.
 *
 * canEdit gates upload + delete; viewers without permission still see
 * the list but the buttons disappear.
 */
export default function AuditAttachments({
  auditId,
  attachments,
  canEdit,
}: {
  auditId: number;
  attachments: Attachment[];
  canEdit: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pickedCount, setPickedCount] = useState(0);

  function onFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    setPickedCount(e.target.files?.length ?? 0);
    setError(null);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        const res = await addAuditAttachmentsAction(fd);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        // Reset the picker so the next upload starts fresh.
        if (inputRef.current) inputRef.current.value = "";
        setPickedCount(0);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed.");
      }
    });
  }

  function onDelete(attachmentId: number, name: string) {
    if (!window.confirm(`Remove "${name}"?`)) return;
    const fd = new FormData();
    fd.append("attachment_id", String(attachmentId));
    fd.append("audit_id", String(auditId));
    startTransition(async () => {
      try {
        const res = await deleteAuditAttachmentAction(fd);
        if (!res.ok) setError(res.error);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Delete failed.");
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="text-[10px] uppercase tracking-[0.2em] text-gray-500 font-semibold">
        Attachments
        {attachments.length > 0 && (
          <span className="ml-2 text-gray-400 font-normal normal-case tracking-normal">
            ({attachments.length})
          </span>
        )}
      </div>

      {/* Existing files */}
      {attachments.length > 0 && (
        <ul className="space-y-1.5">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-3 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm"
            >
              <span className="text-lg shrink-0">{iconForMime(a.file_mime)}</span>
              <a
                href={a.file_url}
                target="_blank"
                rel="noreferrer"
                download={a.file_name}
                className="font-medium text-brand-700 hover:underline truncate flex-1 min-w-0"
                title={a.file_name}
              >
                {a.file_name}
              </a>
              <span className="text-[11px] text-gray-500 shrink-0">
                {formatSize(a.file_size)}
              </span>
              <span className="text-[11px] text-gray-400 shrink-0 hidden md:inline">
                {a.uploaded_by_name ?? "—"} ·{" "}
                {new Date(a.uploaded_at).toLocaleDateString()}
              </span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => onDelete(a.id, a.file_name)}
                  disabled={pending}
                  className="text-xs text-red-600 hover:text-red-800 hover:underline disabled:opacity-50 shrink-0"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Upload form — only when the viewer can edit. */}
      {canEdit && (
        <form
          onSubmit={onSubmit}
          className="flex flex-wrap items-center gap-3 p-3 border border-dashed border-gray-300 rounded-lg bg-white"
        >
          <input type="hidden" name="audit_id" value={auditId} />
          <input
            ref={inputRef}
            type="file"
            name="files"
            multiple
            onChange={onFilesChange}
            disabled={pending}
            className="text-xs text-gray-700 file:mr-3 file:px-3 file:py-1.5 file:rounded-md file:border-0 file:bg-brand-50 file:text-brand-700 file:font-medium file:cursor-pointer hover:file:bg-brand-100"
          />
          <button
            type="submit"
            disabled={pending || pickedCount === 0}
            className="bg-brand-700 hover:bg-brand-800 text-white px-4 py-1.5 rounded-md text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pending
              ? "Uploading…"
              : pickedCount > 0
              ? `Upload ${pickedCount} file${pickedCount === 1 ? "" : "s"}`
              : "Upload"}
          </button>
          <p className="text-[11px] text-gray-400 basis-full">
            PDF · Word · Excel · PowerPoint · image · text · CSV — up to 10 MB
            each. Pick more than one at once.
          </p>
        </form>
      )}

      {error && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {!canEdit && attachments.length === 0 && (
        <p className="text-xs text-gray-400">No attachments.</p>
      )}
    </div>
  );
}

/* ─── helpers ──────────────────────────────────────────────────── */

function iconForMime(mime: string | null): string {
  if (!mime) return "📎";
  if (mime.startsWith("image/")) return "🖼️";
  if (mime === "application/pdf") return "📄";
  if (mime.includes("word")) return "📝";
  if (mime.includes("excel") || mime.includes("spreadsheet")) return "📊";
  if (mime.includes("powerpoint") || mime.includes("presentation")) return "📑";
  if (mime.startsWith("text/")) return "📃";
  return "📎";
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
