"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { saveResponsesBulkAction } from "./actions";

export type AnswerValue = "pass" | "fail" | "na";

type AnswerState = {
  response: AnswerValue | null;
  /** How the sampled interactions broke down (migration 054). Must sum to
   *  100 together before the row is savable. Null = not yet touched. */
  yesPercent: number | null;
  noPercent: number | null;
  naPercent: number | null;
  notes: string;
};

type AuditAnswersContextValue = {
  auditId: number;
  canEdit: boolean;
  get: (itemId: number) => AnswerState;
  setResponse: (itemId: number, response: AnswerValue) => void;
  setSplit: (itemId: number, field: "yes" | "no" | "na", value: number | null) => void;
  setNotes: (itemId: number, notes: string) => void;
  /** Item ids whose answer differs from what's stored on the server. */
  dirtyIds: number[];
  /** Dirty items whose Yes+No+N-A doesn't add up to 100 — not savable yet. */
  invalidIds: number[];
  answeredCount: number;
  totalCount: number;
  saving: boolean;
  error: string | null;
  savedAt: number | null;
  /** Persists every dirty answer. Returns true when nothing is left unsaved
   *  — Submit uses that to decide whether it's safe to continue. Refuses
   *  outright (no partial save) when any dirty row doesn't sum to 100. */
  saveAll: () => Promise<boolean>;
};

const Ctx = createContext<AuditAnswersContextValue | null>(null);

export function useAuditAnswers(): AuditAnswersContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useAuditAnswers must be used inside <AuditAnswersProvider>");
  }
  return ctx;
}

const EMPTY_SPLIT = { yesPercent: null, noPercent: null, naPercent: null } as const;

/** The clean, no-nuance split a freshly-picked verdict starts at — the
 *  radio buttons are a shortcut for this common case; the three boxes are
 *  what the auditor actually fine-tunes for a partial-N-A sample. */
function defaultSplitFor(
  response: AnswerValue
): Pick<AnswerState, "yesPercent" | "noPercent" | "naPercent"> {
  return {
    yesPercent: response === "pass" ? 100 : 0,
    noPercent: response === "fail" ? 100 : 0,
    naPercent: response === "na" ? 100 : 0,
  };
}

function splitSum(a: AnswerState): number {
  return (a.yesPercent ?? 0) + (a.noPercent ?? 0) + (a.naPercent ?? 0);
}

/**
 * Holds every question's answer for one audit in a single place, so the
 * page can offer ONE "Save all answers" button (and a Submit that flushes
 * first) instead of a Save per question.
 *
 * The same checklist item can appear under more than one test — the audit
 * stores a single response per (audit_id, item_id), so state is keyed by
 * item id and every on-screen copy of that question stays in sync while
 * the auditor types.
 */
export function AuditAnswersProvider({
  auditId,
  canEdit,
  initial,
  children,
}: {
  auditId: number;
  canEdit: boolean;
  /** One entry per distinct checklist item in the audit's scope. */
  initial: {
    itemId: number;
    response: AnswerValue | null;
    yesPercent: number | null;
    noPercent: number | null;
    naPercent: number | null;
    notes: string | null;
  }[];
  children: ReactNode;
}) {
  const buildMap = (src: typeof initial) => {
    const m = new Map<number, AnswerState>();
    for (const r of src) {
      m.set(r.itemId, {
        response: r.response,
        yesPercent: r.yesPercent,
        noPercent: r.noPercent,
        naPercent: r.naPercent,
        notes: r.notes ?? "",
      });
    }
    return m;
  };

  // `saved` mirrors what the server currently holds; `answers` is what the
  // auditor has on screen. Comparing the two is what makes the unsaved
  // count honest rather than "anything ever touched".
  const [answers, setAnswers] = useState(() => buildMap(initial));
  const [saved, setSaved] = useState(() => buildMap(initial));
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saving, startSaving] = useTransition();

  const EMPTY: AnswerState = useMemo(
    () => ({ response: null, ...EMPTY_SPLIT, notes: "" }),
    []
  );

  const get = useCallback(
    (itemId: number) => answers.get(itemId) ?? EMPTY,
    [answers, EMPTY]
  );

  const setResponse = useCallback((itemId: number, response: AnswerValue) => {
    setAnswers((prev) => {
      const cur = prev.get(itemId) ?? { response: null, ...EMPTY_SPLIT, notes: "" };
      // Re-clicking the current verdict must not wipe a split the auditor
      // already fine-tuned; picking a different one resets to its clean
      // 100/0/0 default, which is then free to be broken down further.
      if (cur.response === response) return prev;
      const next = new Map(prev);
      next.set(itemId, { ...cur, response, ...defaultSplitFor(response) });
      return next;
    });
    setError(null);
  }, []);

  const setSplit = useCallback(
    (itemId: number, field: "yes" | "no" | "na", value: number | null) => {
      setAnswers((prev) => {
        const next = new Map(prev);
        const cur = next.get(itemId) ?? { response: null, ...EMPTY_SPLIT, notes: "" };
        const clamped =
          value === null || Number.isNaN(value)
            ? null
            : Math.max(0, Math.min(100, Math.round(value)));
        const key =
          field === "yes" ? "yesPercent" : field === "no" ? "noPercent" : "naPercent";
        next.set(itemId, { ...cur, [key]: clamped });
        return next;
      });
      setError(null);
    },
    []
  );

  const setNotes = useCallback((itemId: number, notes: string) => {
    setAnswers((prev) => {
      const next = new Map(prev);
      const cur = next.get(itemId) ?? { response: null, ...EMPTY_SPLIT, notes: "" };
      next.set(itemId, { ...cur, notes });
      return next;
    });
    setError(null);
  }, []);

  const dirtyIds = useMemo(() => {
    const out: number[] = [];
    for (const [itemId, cur] of answers) {
      // A note with no Yes/No/N-A isn't savable — audit_responses.response
      // is what scoring reads, so a note alone would be a silent no-op.
      if (!cur.response) continue;
      const was = saved.get(itemId);
      if (
        !was ||
        was.response !== cur.response ||
        was.yesPercent !== cur.yesPercent ||
        was.noPercent !== cur.noPercent ||
        was.naPercent !== cur.naPercent ||
        (was.notes ?? "") !== cur.notes
      ) {
        out.push(itemId);
      }
    }
    return out;
  }, [answers, saved]);

  const invalidIds = useMemo(
    () => dirtyIds.filter((itemId) => splitSum(answers.get(itemId)!) !== 100),
    [dirtyIds, answers]
  );

  const answeredCount = useMemo(
    () => [...answers.values()].filter((a) => a.response).length,
    [answers]
  );

  const saveAll = useCallback(async () => {
    if (!canEdit || dirtyIds.length === 0) return true;
    if (invalidIds.length > 0) {
      setError(
        `${invalidIds.length} question${invalidIds.length === 1 ? "" : "s"} ` +
          `have a Yes/No/N-A split that doesn't add up to 100% — fix ${
            invalidIds.length === 1 ? "it" : "them"
          } before saving.`
      );
      return false;
    }
    const payload = dirtyIds.map((itemId) => {
      const a = answers.get(itemId)!;
      return {
        itemId,
        response: a.response as AnswerValue,
        yesPercent: a.yesPercent ?? 0,
        noPercent: a.noPercent ?? 0,
        naPercent: a.naPercent ?? 0,
        notes: a.notes,
      };
    });

    return new Promise<boolean>((resolve) => {
      startSaving(async () => {
        const result = await saveResponsesBulkAction({ auditId, answers: payload });
        if (!result.ok) {
          setError(result.error);
          resolve(false);
          return;
        }
        // Fold the just-saved values into the server mirror so the unsaved
        // count drops to zero without a refetch.
        setSaved((prev) => {
          const next = new Map(prev);
          for (const p of payload) {
            next.set(p.itemId, {
              response: p.response,
              yesPercent: p.yesPercent,
              noPercent: p.noPercent,
              naPercent: p.naPercent,
              notes: p.notes,
            });
          }
          return next;
        });
        setError(null);
        setSavedAt(Date.now());
        resolve(true);
      });
    });
  }, [auditId, canEdit, dirtyIds, invalidIds, answers]);

  const value: AuditAnswersContextValue = {
    auditId,
    canEdit,
    get,
    setResponse,
    setSplit,
    setNotes,
    dirtyIds,
    invalidIds,
    answeredCount,
    totalCount: initial.length,
    saving,
    error,
    savedAt,
    saveAll,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
