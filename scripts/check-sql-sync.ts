/**
 * Cross-checks src/lib/blood-compat.ts against a faithful transcription of
 * public.blood_groups_compatible() in migration 0005, for every
 * donor × recipient × component combination.
 *
 * Run with: npx tsx scripts/check-sql-sync.ts
 */
import { isBloodCompatible } from "../src/lib/blood-compat";
