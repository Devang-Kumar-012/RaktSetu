/**
 * Download the LIVE production data (Turso) into data/production/:
 * one CSV per table plus a plain-English report.md.
 *
 * The deployed site cannot write files you can open (Vercel's disk is
 * read-only and temporary), so this pulls them on demand instead. Read-only:
 * it never migrates or writes the production database.
 *
 * Needs RAKTSETU_DATABASE_URL and RAKTSETU_DATABASE_TOKEN, read from
 * .env.local (or .env) or the shell.
 *
 * Usage: npm run data:pull
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@libsql/client";

import { snapshotAsync, writeDataFiles } from "../src/lib/server/data-export";

const ROOT = join(import.meta.dirname, "..");
for (const file of [".env.local", ".env"]) {
  if (existsSync(join(ROOT, file))) process.loadEnvFile(join(ROOT, file));
}

async function main() {
  const url = process.env.RAKTSETU_DATABASE_URL?.trim();
  if (!url) {
    console.error(
      "RAKTSETU_DATABASE_URL is not set. Put your Turso URL and token in .env.local:\n" +
        "  RAKTSETU_DATABASE_URL=libsql://your-db.turso.io\n" +
        "  RAKTSETU_DATABASE_TOKEN=your-token",
    );
    process.exit(1);
  }
  const client = createClient({ url, authToken: process.env.RAKTSETU_DATABASE_TOKEN?.trim() || undefined });
  try {
    const snapshot = await snapshotAsync(
      async (sql) => (await client.execute(sql)).rows as unknown as Record<string, unknown>[],
    );
    const out = join(ROOT, "data", "production");
    writeDataFiles(snapshot, out);
    const users = snapshot.users?.rows.length ?? 0;
    const requests = snapshot.blood_requests?.rows.length ?? 0;
    console.log(`Saved ${Object.keys(snapshot).length} tables (${users} people, ${requests} requests) to ${out}`);
    console.log(`Open ${join(out, "report.md")} for the readable version.`);
  } catch (err) {
    console.error("Could not read the production database:", (err as Error).message);
    process.exit(1);
  } finally {
    client.close();
  }
}

main();
