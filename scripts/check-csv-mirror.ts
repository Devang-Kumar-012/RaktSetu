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

  await closeDriver();
  rmSync(dir, { recursive: true, force: true });
  console.log("csv mirror checks passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
