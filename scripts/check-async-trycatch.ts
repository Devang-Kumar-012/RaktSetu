/**
 * FIND RETURNS THAT ESCAPE THEIR OWN `try`.
 *
 * THIS IS A REAL BUG CLASS, NOT A STYLE RULE.
 *
 *     try {
 *       return somePromise();   // <-- the `try` never sees the rejection
 *     } catch (err) {
 *       if (isUniqueViolation(err)) return "already_taken";
 *       throw err;
 *     }
 *
 * `return promise` evaluates the promise and hands it back, but the `try` block
 * finishes IMMEDIATELY. A later rejection is not caught by that `catch` — it
 * escapes to the caller. Every error mapping in the block silently stops working.
 *
 * This exact shape shipped once already: `markAlertResponded` lost its
 * unique-violation -> "already_taken" mapping, so a donor who lost a genuine
 * acceptance race saw a raw SQL constraint error instead of the correct outcome.
 *
 * WHY THIS IS A SOURCE CHECK, NOT A TYPE CHECK
 *
 * TypeScript accepts `return promise` in a function declared to return
 * `Promise<T>`; it is perfectly well-typed. Only the source shape reveals the
 * bug, so the check reads the source.
 *
 * WHY IT MATCHES NAMES, NOT JUST "ANY CALL"
 *
 * An earlier version of this check flagged every `return someCall()` inside a
 * `try`, which is useless: `ok()`, `fail()`, `jar.get()` and `JSON.parse()` are
 * all synchronous, and `return (await x) ?? y` was flagged despite being correct.
 * A check that cries wolf gets ignored, so this one flags a return ONLY when the
 * called function is actually async — either declared `async` in the same file,
 * or one of the project's known-async exports.
 *
 * The fix it points at is always `return await promise`.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

/**
 * Functions that are async in `src/` and are called from elsewhere. The list is
 * explicit rather than inferred, because a cross-file return of a promise is
 * exactly the case that matters and cannot be seen from one file alone.
 */
const KNOWN_ASYNC = new Set([
  // server/session.ts
  "getUserRoles", "grantRole", "setSessionActiveRole", "createUser",
  "authenticate", "createSession", "getUserForToken", "revokeSession",
  // server/sql-requests.ts
  "expireStaleRequests", "expandAlertRings", "markAlertResponded",
  "closeRequestAsRequester", "recordDonation", "matchDonorsForRequest",
  "matchingDonorStats",
  // server/sql-dashboard.ts
  "runDashboardTableQuery", "runDashboardRpc",
  // server/driver.ts + server/db.ts
  "getDriver", "initializeDatabase", "isDatabaseOperational", "closeDriver",
  // profile.ts
  "getSessionInfo", "requireRolePage", "requireAuthPage",
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

/**
 * Blank out comments and string/template literals so that braces and semicolons
 * inside them cannot confuse the parser.
 *
 * Newlines are PRESERVED (each replaced by itself) so every offset in the result
 * still maps to the right line in the original file. An earlier version collapsed
 * a multi-line template into one line and reported nonsense line numbers.
 */
function blank(src: string): string {
  const out = src.split("");
  const blankRange = (from: number, to: number) => {
    for (let i = from; i < to && i < out.length; i++) {
      if (out[i] !== "\n" && out[i] !== "\r") out[i] = " ";
    }
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      let j = i;
      while (j < src.length && src[j] !== "\n") j++;
      blankRange(i, j);
      i = j;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      let j = i + 2;
      while (j < src.length && !(src[j] === "*" && src[j + 1] === "/")) j++;
      j = Math.min(j + 2, src.length);
      blankRange(i, j);
      i = j;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      let j = i + 1;
      while (j < src.length && src[j] !== q) {
        if (src[j] === "\\") j++;
        j++;
      }
      j = Math.min(j + 1, src.length);
      blankRange(i + 1, j - 1);
      i = j;
      continue;
    }
    i++;
  }
  return out.join("");
}


const findings: { file: string; line: number; text: string }[] = [];

for (const file of walk(join(ROOT, "src"))) {
  const raw = readFileSync(file, "utf8");
  const src = blank(raw);

  // Async functions declared in THIS file.
  const localAsync = new Set<string>();
  // `const f = async …` — the function-expression / arrow form. The original
  // `markAlertResponded` bug lived in `const resolve = async () => …`, so a
  // scan that only recognises `async function` declarations misses the exact
  // shape that caused the incident.
  for (const m of src.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]*?)?=\s*async\b/g,
  )) {
    localAsync.add(m[1]);
  }
  for (const m of src.matchAll(/\basync\s+function\s+([A-Za-z_$][\w$]*)/g)) {
    localAsync.add(m[1]);
  }

  const lineOf = (idx: number): number => raw.slice(0, idx).split("\n").length;

  for (const m of src.matchAll(/\btry\s*\{/g)) {
    const open = src.indexOf("{", m.index);
    let depth = 0;
    let i = open;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) continue;

    // The `try` block's own braces close BEFORE its `catch` clause, so the clause
    // has to be looked for just after the matching `}`. `i` is the index OF that
    // brace, hence `i + 1`. Scanning INSIDE the block for "catch" finds nothing
    // and silently skips every site — which is how this check was briefly a
    // no-op that reported success while catching nothing.
    if (!/^\s*catch\b/.test(src.slice(i + 1, i + 41))) continue;

    const guarded = src.slice(open + 1, i);
    for (const r of guarded.matchAll(/\breturn\s+([^;]{0,200}?);/g)) {
      const expr = r[1];
      if (/^await\b/.test(expr)) continue; // already correct
      if (/^\(await\b/.test(expr)) continue; // `return (await x) ?? y`
      // The async call must be the returned expression itself, not a property
      // of something else: match a bare identifier immediately followed by `(`.
      const call = /^\s*\(?\s*([A-Za-z_$][\w$]*)\s*\(/.exec(expr);
      if (!call) continue;
      const name = call[1];
      if (!localAsync.has(name) && !KNOWN_ASYNC.has(name)) continue;
      findings.push({
        file: file.replace(`${ROOT}/`, ""),
        line: lineOf(open + 1 + r.index),
        text: expr.replace(/\s+/g, " ").slice(0, 80),
      });
    }
  }
}

if (findings.length === 0) {
  console.log("\n✓ no `return <async call>` can escape its own try/catch\n");
  process.exit(0);
}

console.log(`\n✗ ${findings.length} return(s) can escape their try/catch:`);
for (const f of findings) {
  console.log(`  - ${f.file}:${f.line}  return ${f.text};`);
}
console.log(
  "\n  Add `await` so the rejection is caught here: `return await <call>;`\n",
);
process.exit(1);
