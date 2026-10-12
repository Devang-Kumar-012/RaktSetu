/**
 * Brace balance check for a CSS file.
 *
 * The editorial classes appended to `globals.css` are hand-maintained, and a
 * half-closed rule is silent in dev — the browser just drops the malformed block
 * and the page renders as if the class never existed. That is exactly how a
 * `position: relative` can go missing and let a full-bleed band escape to the
 * viewport. This fails loudly instead.
 *
 * Usage: npx tsx scripts/check-css-balance.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FILES = ["src/app/globals.css"];

let failed = false;

for (const file of FILES) {
  const css = readFileSync(join(import.meta.dirname, "..", file), "utf8");
  let depth = 0;
  let line = 1;
  let minDepth = 0;
  let minLine = 0;
  /** Line number of each currently-open `{`, so an unclosed block is reportable. */
  const openStack: number[] = [];
  let inComment = false;
  let inString: string | null = null;

  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    const next = css[i + 1];
    if (ch === "\n") line += 1;

    if (inComment) {
      if (ch === "*" && next === "/") {
        inComment = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      if (ch === inString && css[i - 1] !== "\\") inString = null;
      continue;
    }
    if (ch === "/" && next === "*") {
      inComment = true;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      openStack.push(line);
    }
    if (ch === "}") {
      depth -= 1;
      openStack.pop();
      if (depth < minDepth) {
        minDepth = depth;
        minLine = line;
      }
    }
  }

  if (depth === 0 && minDepth === 0) {
    console.log(`PASS  ${file} — all blocks balanced`);
  } else {
    failed = true;
    console.log(
      `FAIL  ${file} — ends at depth ${depth}` +
      (minDepth < 0 ? `, first stray "}" at line ${minLine}` : "") +
      (openStack.length ? `, unclosed "{" opened at line(s) ${openStack.join(", ")}` : "")
    );
  }

  /*
   * A missing SELECTOR is the other silent failure, and brace balancing cannot
   * see it: a body that lost its `.class {` line is still perfectly balanced, so
   * the block is simply dropped by the parser and the page renders as if the
   * class never existed. Every `{` must therefore open on a line that actually
   * contains a selector — not a blank line, not a dangling comment, and not a
   * declaration that was left without one.
   */
  const lines = css.split("\n");
  const problems: string[] = [];
  let inBlockComment = false;
  lines.forEach((line, i) => {
    const bare = line.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (inBlockComment) {
      if (bare.includes("*/") || line.includes("*/")) inBlockComment = false;
      return;
    }
    if (bare.startsWith("/*") && !bare.includes("*/")) {
      inBlockComment = true;
      return;
    }
    if (!line.includes("{")) return;
    // The part before the first brace on this line must be a non-empty selector.
    const beforeBrace = line.slice(0, line.indexOf("{")).trim();
    if (beforeBrace === "" || beforeBrace.endsWith(";") || beforeBrace.endsWith(",")) {
      problems.push(`line ${i + 1}: "{" with no selector -> ${line.trim().slice(0, 50)}`);
    }
  });

  if (problems.length) {
    failed = true;
    for (const p of problems) console.log(`FAIL  ${file} — ${p}`);
  }
}

process.exit(failed ? 1 : 0);
