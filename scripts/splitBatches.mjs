/**
 * Split a T-SQL script on `GO` separators.
 *
 * `GO` is not a SQL statement — it is a client-side batch separator that
 * tools like SSMS and sqlcmd honour, so a script runner has to implement
 * it too. It matters here because SQL Server requires CREATE TRIGGER /
 * PROCEDURE / VIEW / FUNCTION to be the first statement in its batch,
 * which is impossible in a migration file without batch boundaries.
 *
 * A `GO` only separates when it is the sole content of its line, and never
 * when it appears inside a string literal, a quoted or bracketed
 * identifier, or a comment.
 */
export function splitBatches(text) {
  const batches = [];
  let current = "";
  let i = 0;
  const n = text.length;
  /** A GO only counts at the start of a line (ignoring indentation). */
  let atLineStart = true;

  while (i < n) {
    const ch = text[i];

    // -- line comment
    if (ch === "-" && text[i + 1] === "-") {
      while (i < n && text[i] !== "\n") current += text[i++];
      continue;
    }

    // /* block comment */
    if (ch === "/" && text[i + 1] === "*") {
      current += "/*";
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) current += text[i++];
      if (i < n) {
        current += "*/";
        i += 2;
      }
      atLineStart = false;
      continue;
    }

    // 'string literal' ('' escapes a quote)
    if (ch === "'") {
      current += ch;
      i++;
      while (i < n) {
        if (text[i] === "'") {
          if (text[i + 1] === "'") {
            current += "''";
            i += 2;
            continue;
          }
          current += "'";
          i++;
          break;
        }
        current += text[i++];
      }
      atLineStart = false;
      continue;
    }

    // [bracketed identifier] (]] escapes a bracket)
    if (ch === "[") {
      current += ch;
      i++;
      while (i < n) {
        if (text[i] === "]") {
          if (text[i + 1] === "]") {
            current += "]]";
            i += 2;
            continue;
          }
          current += "]";
          i++;
          break;
        }
        current += text[i++];
      }
      atLineStart = false;
      continue;
    }

    // "quoted identifier"
    if (ch === '"') {
      current += ch;
      i++;
      while (i < n) {
        if (text[i] === '"') {
          current += '"';
          i++;
          break;
        }
        current += text[i++];
      }
      atLineStart = false;
      continue;
    }

    if (atLineStart && (ch === "G" || ch === "g")) {
      // `GO` alone on the line — a trailing repeat count ("GO 5") is not
      // supported, and is rejected rather than silently run once.
      const match = /^go[ \t]*(\d*)[ \t]*(?:\r?\n|$)/i.exec(text.slice(i));
      if (match) {
        if (match[1]) {
          throw new Error(
            `"GO ${match[1]}" (batch repeat count) is not supported by this runner.`
          );
        }
        batches.push(current);
        current = "";
        i += match[0].length;
        atLineStart = true;
        continue;
      }
    }

    if (ch === "\n") atLineStart = true;
    else if (ch !== " " && ch !== "\t" && ch !== "\r") atLineStart = false;

    current += ch;
    i++;
  }

  batches.push(current);
  return batches.map((b) => b.trim()).filter((b) => b.length > 0);
}
