/**
 * Import this FIRST in any check that creates or deletes a database file.
 *
 * It points RAKTSETU_DATA_DIR at a fresh temporary folder before the database
 * modules load (they read it once, at import), so a test run can never touch
 * the developer's real data/raktsetu.db. Several checks used to delete that
 * file outright on every `npm run check`.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.RAKTSETU_DATA_DIR = mkdtempSync(join(tmpdir(), "raktsetu-check-"));
delete process.env.RAKTSETU_DATABASE_URL;
