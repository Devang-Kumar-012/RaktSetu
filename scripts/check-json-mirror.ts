/**
 * The local driver mirrors committed data to data/json/<table>.json, with secrets redacted.
 *
 * Usage: npm run check:json-mirror
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "raktsetu-json-"));
process.env.RAKTSETU_DATA_DIR = dir;
delete process.env.RAKTSETU_DATABASE_URL;

async function main() {
  const { getDriver, closeDriver } = await import("../src/lib/server/driver");
  const db = await getDriver();
  const users = () => readFileSync(join(dir, "json", "users.json"), "utf8");
  const user = (id: string) => (JSON.parse(users()) as Array<Record<string, unknown>>).find((u) => u.id === id);
  const now = new Date().toISOString();

  await db.run(
    "INSERT INTO users (id, email, password_hash, full_name, role, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
    ["u-csv", "csv@example.com", "scrypt$secret", 'Csv, "Tester"', "donor", now, now],
  );
  await db.run(
    "INSERT INTO users (id, email, password_hash, full_name, role, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
    ["u-evil", "evil@example.com", "x", "=HYPERLINK(\"http://x\")", "donor", now, now],
  );
  assert.equal(user("u-csv")?.full_name, 'Csv, "Tester"', "a committed signup appears, text as typed");
  assert.equal(user("u-csv")?.password_hash, "[redacted]", "password hashes are redacted");
  assert.ok(!users().includes("scrypt$secret"), "password hashes are never written to JSON");
  assert.equal(user("u-evil")?.full_name, '=HYPERLINK("http://x")', "values round-trip unchanged");
  assert.ok(existsSync(join(dir, "json", "sessions.json")), "every table gets its own JSON file");

  await assert.rejects(
    db.transaction(async (t) => {
      await t.run("UPDATE users SET full_name = 'Rolled Back' WHERE id = 'u-csv'");
      throw new Error("abort");
    }),
  );
  await db.run("SELECT 1");
  assert.ok(!users().includes("Rolled Back"), "a rolled-back transaction never reaches the JSON");

  // The plain-English report sits beside the JSON files and never carries a secret.
  const report = readFileSync(join(dir, "report.md"), "utf8");
  assert.ok(report.includes("# RaktSetu data report") && report.includes("csv@example.com"), "report.md lists the signup");
  assert.ok(report.includes("Csv, \"Tester\""), "names appear as typed");
  assert.ok(!report.includes("scrypt$secret") && !report.includes("u-csv"), "no password hashes or internal ids");

  await closeDriver();

  // The production pull path: same files, read through the Turso client (a `file:` URL here).
  const { createClient } = await import("@libsql/client");
  const { snapshotAsync, writeDataFiles } = await import("../src/lib/server/data-export");
  const client = createClient({ url: `file:${join(dir, "raktsetu.db")}` });
  const pulled = join(dir, "production");
  writeDataFiles(
    await snapshotAsync(async (sql) => (await client.execute(sql)).rows as unknown as Record<string, unknown>[]),
    pulled,
  );
  client.close();
  assert.ok(readFileSync(join(pulled, "json", "users.json"), "utf8").includes("csv@example.com"), "pulled JSON carries the data");
  assert.ok(readFileSync(join(pulled, "report.md"), "utf8").includes("csv@example.com"), "pulled report lists the signup");
  assert.ok(!readFileSync(join(pulled, "json", "users.json"), "utf8").includes("scrypt$secret"), "pulled JSON redacts hashes");
  rmSync(dir, { recursive: true, force: true });
  console.log("json mirror checks passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
