/**
 * Public, anonymous view of completed donations — the homepage "lives touched" wall.
 *
 * Reads only rows an admin recorded in `donations`, so every entry is a real
 * completed donation. The projection is deliberately coarse: no donor, no
 * requester, no note, no exact date (month only), so no entry can identify a
 * person. Anything that would narrow it further does not belong here.
 */

import { getDriver } from "./driver";

export interface PublicDonation {
  month: string; // YYYY-MM
  units: number;
  blood_group: string | null;
  blood_component: string;
  locality: string | null;
  drive_title: string | null;
}

export interface PublicImpact {
  totalDonations: number;
  totalUnits: number;
  recent: PublicDonation[];
}

/** Null when the database can't be read, so the homepage hides the section instead of failing. */
export async function getPublicImpact(limit = 9): Promise<PublicImpact | null> {
  try {
    const db = await getDriver();
    const totals = await db.queryOne<{ donations: number; units: number }>(
      `SELECT COUNT(*) AS donations, COALESCE(SUM(units), 0) AS units FROM donations`,
    );
    const recent = await db.query<PublicDonation>(
      `SELECT substr(h.donated_on, 1, 7) AS month,
              h.units,
              r.blood_group,
              COALESCE(h.blood_component, r.blood_component) AS blood_component,
              r.locality,
              d.title AS drive_title
         FROM donations h
         LEFT JOIN blood_requests r ON r.id = h.request_id
         LEFT JOIN campus_blood_drives d ON d.id = h.drive_id
        ORDER BY h.donated_on DESC, h.created_at DESC
        LIMIT ?`,
      [limit],
    );
    return {
      totalDonations: Number(totals?.donations ?? 0),
      totalUnits: Number(totals?.units ?? 0),
      recent: recent.map((row) => ({ ...row, units: Number(row.units) })),
    };
  } catch {
    return null;
  }
}
