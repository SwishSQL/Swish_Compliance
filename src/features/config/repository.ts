import "server-only";
import { queryAll, queryOne, execute } from "@/lib/db";
import type { ConfigOption } from "./types";

export async function listOptions(kind: string, activeOnly = false): Promise<ConfigOption[]> {
  if (activeOnly) {
    return queryAll<ConfigOption>(
      `SELECT * FROM config_options WHERE kind = $1 AND is_active = 1
       ORDER BY sort_order ASC, label ASC`,
      [kind]
    );
  }
  return queryAll<ConfigOption>(
    `SELECT * FROM config_options WHERE kind = $1 ORDER BY sort_order ASC, label ASC`,
    [kind]
  );
}

export async function createOption(input: {
  kind: string;
  label: string;
  value?: string;
}): Promise<number> {
  // Auto-derive a slug-style value from the label if none given.
  const value =
    input.value && input.value.trim().length > 0
      ? input.value.trim()
      : input.label
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "")
          .slice(0, 80) || `opt_${Date.now()}`;

  const nextOrder = await queryOne<{ n: number }>(
    `SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM config_options WHERE kind = $1`,
    [input.kind]
  );

  const row = await queryOne<{ id: number }>(
    `INSERT INTO config_options (kind, value, label, sort_order)
     OUTPUT INSERTED.id
     VALUES ($1, $2, $3, $4)`,
    [input.kind, value, input.label, nextOrder?.n ?? 1]
  );
  return row!.id;
}

export async function renameOption(id: number, label: string): Promise<void> {
  await execute(`UPDATE config_options SET label = $2 WHERE id = $1`, [id, label]);
}

export async function toggleOption(id: number, active: boolean): Promise<void> {
  await execute(`UPDATE config_options SET is_active = $2 WHERE id = $1`, [id, active]);
}

export async function deleteOption(id: number): Promise<void> {
  await execute(`DELETE FROM config_options WHERE id = $1`, [id]);
}

export async function moveOption(id: number, direction: "up" | "down"): Promise<void> {
  const me = await queryOne<{ id: number; kind: string; sort_order: number }>(
    `SELECT id, kind, sort_order FROM config_options WHERE id = $1`,
    [id]
  );
  if (!me) return;
  const neighbour = await queryOne<{ id: number; sort_order: number }>(
    direction === "up"
      ? `SELECT TOP (1) id, sort_order FROM config_options
           WHERE kind = $1 AND sort_order < $2
           ORDER BY sort_order DESC`
      : `SELECT TOP (1) id, sort_order FROM config_options
           WHERE kind = $1 AND sort_order > $2
           ORDER BY sort_order ASC`,
    [me.kind, me.sort_order]
  );
  if (!neighbour) return;
  await execute(`UPDATE config_options SET sort_order = $2 WHERE id = $1`, [me.id, neighbour.sort_order]);
  await execute(`UPDATE config_options SET sort_order = $2 WHERE id = $1`, [neighbour.id, me.sort_order]);
}
