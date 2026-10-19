/**
 * The local driver mirrors committed data to data/csv/<table>.csv, with secrets redacted.
 *
 * Usage: npm run check:csv-mirror
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "raktsetu-csv-"));
process.env.RAKTSETU_DATA_DIR = dir;
delete process.env.RAKTSETU_DATABASE_URL;

async function main() {
  const { getDriver, closeDriver } = await import("../src/lib/server/driver");
  const db = await getDriver();
  const users = () => readFileSync(join(dir, "csv", "users.csv"), "utf8");
  const now = new Date().toISOString();

  await db.run(
    "INSERT INTO users (id, email, password_hash, full_name, role, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
    ["u-csv", "csv@example.com", "scrypt$secret", 'Csv, "Tester"', "donor", now, now],
  );
  await db.run(
    "INSERT INTO users (id, email, password_hash, full_name, role, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
    ["u-evil", "evil@example.com", "x", "=HYPERLINK(\"http://x\")", "donor", now, now],
  );
  const csv = users();
  assert.match(csv.split("\r\n")[0], /^id,email,password_hash,full_name,/, "the header row lists the columns");
  assert.ok(csv.includes('csv@example.com,[redacted],"Csv, ""Tester"""'), "a committed signup appears, quoted per RFC 4180");
  assert.ok(!csv.includes("scrypt$secret"), "password hashes are never written to CSV");
  assert.ok(csv.includes(`"'=HYPERLINK(""http://x"")"`), "formula-like input is neutralised");
  assert.ok(existsSync(join(dir, "csv", "sessions.csv")), "every table gets its own CSV file");

  await assert.rejects(
    db.transaction(async (t) => {
      await t.run("UPDATE users SET full_name = 'Rolled Back' WHERE id = 'u-csv'");
      throw new Error("abort");
    }),
  );
  await db.run("SELECT 1");
  assert.ok(!users().includes("Rolled Back"), "a rolled-back transaction never reaches the CSV");

  // The plain-English report sits beside the CSVs and never carries a secret.
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
  assert.ok(readFileSync(join(pulled, "csv", "users.csv"), "utf8").includes("csv@example.com"), "pulled CSVs carry the data");
  assert.ok(readFileSync(join(pulled, "report.md"), "utf8").includes("csv@example.com"), "pulled report lists the signup");
  assert.ok(!readFileSync(join(pulled, "csv", "users.csv"), "utf8").includes("scrypt$secret"), "pulled CSVs redact hashes");
  rmSync(dir, { recursive: true, force: true });
  console.log("csv mirror checks passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
