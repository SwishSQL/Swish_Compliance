/**
 * PostgreSQL placeholder syntax -> SQL Server named-parameter syntax.
 *
 * The app was written against `pg`, which uses positional `$1, $2, ...`
 * placeholders and accepts JS arrays as a single parameter (`= ANY($1)`).
 * The `mssql` driver instead wants named `@p1, @p2, ...` parameters bound
 * one at a time, and has no array parameter type at all.
 *
 * Rewriting all ~285 call sites by hand would be both enormous and risky,
 * so this module translates the SQL at runtime instead. That keeps every
 * repository/action/page query exactly as it is today.
 *
 * What it handles:
 *   1. `$n`               -> `@pn`
 *   2. `= ANY($n)`        -> `IN (@pn_0, @pn_1, ...)`   (n is a JS array)
 *      `<> ALL($n)`       -> `NOT IN (@pn_0, ...)`
 *      ...including the `::int[]` / `::text[]` casts those sites carry.
 *   3. Leaves `$` inside string literals, quoted identifiers and comments
 *      completely alone — a literal like '$5.00' must not become '@p5.00'.
 *
 * Anything it cannot translate safely throws rather than guessing, so a
 * mistake surfaces immediately instead of silently returning wrong rows.
 */

export type BoundParam = { name: string; value: unknown };

export type TranslatedQuery = {
  /** SQL with `@pN` placeholders, ready for the mssql driver. */
  text: string;
  /** Parameters to bind, already expanded for any array arguments. */
  params: BoundParam[];
};

/**
 * `col = ANY($1)` / `col = ANY($1::int[])`.
 * Captured from the operator onwards because the replacement (`IN`)
 * has to swallow the `=` too — `col = (a, b)` is not valid SQL.
 */
const ANY_PATTERN =
  /^=\s*ANY\s*\(\s*\$(\d+)\s*(?:::\s*[A-Za-z_][A-Za-z0-9_]*\s*\[\s*\]\s*)?\)/i;

/** `col <> ALL($1)` / `col != ALL($1::int[])` -> `col NOT IN (...)`. */
const ALL_PATTERN =
  /^(?:<>|!=)\s*ALL\s*\(\s*\$(\d+)\s*(?:::\s*[A-Za-z_][A-Za-z0-9_]*\s*\[\s*\]\s*)?\)/i;

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

/**
 * Translate one pg-style query into an mssql-style one.
 *
 * @param text   SQL using `$n` placeholders.
 * @param values Positional values, `values[0]` being `$1`.
 */
export function translateQuery(text: string, values: unknown[] = []): TranslatedQuery {
  const out: string[] = [];
  /** Placeholder index (1-based) -> the parameters emitted for it. */
  const emitted = new Map<number, BoundParam[]>();

  /** Look up a `$n` reference and fail loudly on an out-of-range one. */
  function valueAt(index: number): unknown {
    if (index < 1 || index > values.length) {
      throw new Error(
        `SQL placeholder $${index} has no matching parameter ` +
          `(${values.length} provided). Query: ${text}`
      );
    }
    return values[index - 1];
  }

  /** Register (once) the single scalar parameter behind `$n`. */
  function scalarParam(index: number): string {
    const value = valueAt(index);
    if (Array.isArray(value)) {
      throw new Error(
        `Parameter $${index} is an array, but it is not used as ` +
          `"= ANY($${index})" or "<> ALL($${index})". SQL Server has no array ` +
          `parameter type, so the query needs rewriting. Query: ${text}`
      );
    }
    const name = `p${index}`;
    if (!emitted.has(index)) emitted.set(index, [{ name, value }]);
    return `@${name}`;
  }

  /**
   * Expand `$n` (a JS array) into a parenthesised list for IN / NOT IN.
   * Each element becomes its own parameter so values stay parameterised —
   * nothing is ever interpolated into the SQL text.
   */
  function listParams(index: number, negated: boolean): string {
    const value = valueAt(index);
    if (!Array.isArray(value)) {
      throw new Error(
        `Parameter $${index} is used as "ANY(...)"/"ALL(...)" but the value ` +
          `is not an array (got ${typeof value}). Query: ${text}`
      );
    }

    if (value.length === 0) {
      // Postgres: `x = ANY('{}')` is FALSE, so the row is dropped.
      // `x IN (NULL)` evaluates to UNKNOWN, which a WHERE clause also
      // drops — same observable result, and NULL is type-compatible with
      // any column so this can't raise a conversion error.
      if (negated) {
        // `x <> ALL('{}')` is TRUE in Postgres (nothing to conflict with),
        // but `x NOT IN (NULL)` is UNKNOWN — the opposite. There is no
        // safe left-operand-agnostic rewrite, so refuse rather than
        // silently invert the caller's filter. No src/ query hits this.
        throw new Error(
          `Parameter $${index} is an empty array used with ALL(...). ` +
            `That cannot be translated without changing the query's meaning ` +
            `— guard the empty case in the caller. Query: ${text}`
        );
      }
      return "IN (NULL)";
    }

    if (!emitted.has(index)) {
      emitted.set(
        index,
        value.map((element, i) => ({ name: `p${index}_${i}`, value: element }))
      );
    }
    const names = emitted.get(index)!.map((p) => `@${p.name}`);
    return `${negated ? "NOT IN" : "IN"} (${names.join(", ")})`;
  }

  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i];

    // ---- Regions where `$` must be left untouched --------------------

    // Single-quoted string literal; '' is an escaped quote.
    if (ch === "'") {
      out.push(ch);
      i++;
      while (i < n) {
        if (text[i] === "'") {
          if (text[i + 1] === "'") {
            out.push("''");
            i += 2;
            continue;
          }
          out.push("'");
          i++;
          break;
        }
        out.push(text[i]);
        i++;
      }
      continue;
    }

    // Double-quoted identifier ("" is an escaped quote).
    if (ch === '"') {
      out.push(ch);
      i++;
      while (i < n) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            out.push('""');
            i += 2;
            continue;
          }
          out.push('"');
          i++;
          break;
        }
        out.push(text[i]);
        i++;
      }
      continue;
    }

    // Bracketed identifier — SQL Server's [Order Details]; ]] escapes ].
    if (ch === "[") {
      out.push(ch);
      i++;
      while (i < n) {
        if (text[i] === "]") {
          if (text[i + 1] === "]") {
            out.push("]]");
            i += 2;
            continue;
          }
          out.push("]");
          i++;
          break;
        }
        out.push(text[i]);
        i++;
      }
      continue;
    }

    // `-- line comment`
    if (ch === "-" && text[i + 1] === "-") {
      while (i < n && text[i] !== "\n") {
        out.push(text[i]);
        i++;
      }
      continue;
    }

    // `/* block comment */`
    if (ch === "/" && text[i + 1] === "*") {
      out.push("/*");
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) {
        out.push(text[i]);
        i++;
      }
      if (i < n) {
        out.push("*/");
        i += 2;
      }
      continue;
    }

    // ---- Array comparisons, which rewrite the operator as well -------

    if (ch === "=" || ch === "<" || ch === "!") {
      const rest = text.slice(i);
      const anyMatch = ANY_PATTERN.exec(rest);
      if (anyMatch) {
        out.push(listParams(Number(anyMatch[1]), false));
        i += anyMatch[0].length;
        continue;
      }
      const allMatch = ALL_PATTERN.exec(rest);
      if (allMatch) {
        out.push(listParams(Number(allMatch[1]), true));
        i += allMatch[0].length;
        continue;
      }
    }

    // ---- Plain positional placeholder --------------------------------

    if (ch === "$" && isDigit(text[i + 1])) {
      let j = i + 1;
      while (j < n && isDigit(text[j])) j++;
      out.push(scalarParam(Number(text.slice(i + 1, j))));
      i = j;
      continue;
    }

    out.push(ch);
    i++;
  }

  // Flatten in placeholder order so binding is deterministic.
  const params: BoundParam[] = [];
  for (const index of [...emitted.keys()].sort((a, b) => a - b)) {
    params.push(...emitted.get(index)!);
  }

  return { text: out.join(""), params };
}
