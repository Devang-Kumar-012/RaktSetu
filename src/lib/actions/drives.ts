"use server";

/**
 * Campus blood drive actions (migration 0015).
 *
 * A campus drive is a PLANNED, separate workflow from an emergency blood
 * request. Nothing in this file creates, edits or closes a blood request, and
 * no action here can touch the request lifecycle or the ring engine.
 *
 * Authorization is layered the way the rest of RaktSetu is:
 *   - the role ALWAYS comes from the database profile of the session user,
 *     never from a form field;
 *   - every mutation is additionally constrained by RLS and by database
 *     constraints (unique (drive, donor), one-way registration transitions,
 *     one donation per donor per drive), so a hand-crafted API call is refused
 *     even if it bypasses this file entirely;
 *   - clients have no DELETE grant on drives at all, and only the listed
 *     columns are updatable.
 */
import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSessionInfo } from "@/lib/profile";
import type { ProfileActionState } from "@/lib/actions/action-state";
import {
  BLOOD_COMPONENTS,
  DRIVE_DESCRIPTION_MAX,
  DRIVE_ORGANIZER_MAX,
  DRIVE_REGISTRATION_NOTE_MAX,
  DRIVE_REMINDER_WINDOW_HOURS,
  DRIVE_STATUS_OPTIONS,
  DRIVE_TARGET_BOUNDS,
  DRIVE_TITLE_MAX,
} from "@/lib/constants";
import { safetyLimitMessage, UNIQUE_VIOLATION } from "@/lib/safety";

function isUuid(value: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(value);
}

/**
 * Drives raise their own SQLSTATE (RS002) for a business-rule refusal (closed
 * drive, illegal registration move). That is a deliberate answer, not a
 * fault, so it is reported honestly instead of as a generic error.
 */
function driveRuleMessage(error: { code?: string | null; message?: string | null }): string | null {
  if (error?.code === "RS002" && typeof error.message === "string") return error.message;
  return null;
}

type Guard = { error: string; userId?: undefined } | { error?: undefined; userId: string };

/** Admin guard — role from the database profile, same pattern as lib/actions/admin.ts. */
async function requireDriveAdmin(): Promise<Guard> {
  const session = await getSessionInfo();
  if (!session.configured || !session.user || !session.profile) {
    return { error: "Please log in first." };
  }
  if (session.profile.role !== "admin" || session.profile.status !== "active") {
    return { error: "Only active administrator accounts can manage blood drives." };
  }
  return { userId: session.user.id };
}

/**
 * Check-in guard: an active admin OR an active volunteer. Volunteers checking
 * people in is exactly the on-the-ground coordination their existing role
 * already does (migration 0009 request_assistance), so this grants no new kind
 * of power — and never the power to record a donation, which stays admin-only.
 */
async function requireDriveCoordinator(): Promise<Guard> {
  const session = await getSessionInfo();
  if (!session.configured || !session.user || !session.profile) {
    return { error: "Please log in first." };
  }
  if (
    session.profile.status !== "active" ||
    (session.profile.role !== "admin" && session.profile.role !== "volunteer")
  ) {
    return { error: "Only active volunteers and administrators can check donors in." };
  }
  return { userId: session.user.id };
}

/** Validated, database-ready drive fields. */
interface DriveFields {
  title: string;
  organizer: string;
  venue: string;
  locality: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  targetUnits: number | null;
  status: string;
}

/** Shared field parsing/validation for creating and editing a drive.
 *
 *  Returns an explicitly discriminated `ok` result. An inferred
 *  `{error} | {value}` union collapses into a single object type with optional
 *  members, so an `if ("error" in parsed)` guard does not actually narrow and
 *  `parsed.error` stays `string | undefined`. The discriminant fixes that. */
function readDriveFields(
  formData: FormData
): { ok: false; error: string } | { ok: true; value: DriveFields } {
  const title = String(formData.get("title") ?? "").trim();
  const organizer = String(formData.get("organizer") ?? "").trim();
  const venue = String(formData.get("venue") ?? "").trim();
  const locality = String(formData.get("locality") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const startsRaw = String(formData.get("startsAt") ?? "").trim();
  const endsRaw = String(formData.get("endsAt") ?? "").trim();
  const targetRaw = String(formData.get("targetUnits") ?? "").trim();
  const status = String(formData.get("status") ?? "upcoming").trim();

  if (title.length < 3 || title.length > DRIVE_TITLE_MAX) {
    return { ok: false, error: `Drive title must be 3-${DRIVE_TITLE_MAX} characters.` };
  }
  if (organizer.length < 2 || organizer.length > DRIVE_ORGANIZER_MAX) {
    return {
      ok: false,
      error: `Organising college or group must be 2-${DRIVE_ORGANIZER_MAX} characters.`,
    };
  }
  if (venue.length < 2 || venue.length > DRIVE_ORGANIZER_MAX) {
    return { ok: false, error: "Please give a venue of at least 2 characters." };
  }
  if (locality.length < 2 || locality.length > 120) {
    return { ok: false, error: "Please give a locality of at least 2 characters." };
  }
  if (description.length > DRIVE_DESCRIPTION_MAX) {
    return {
      ok: false,
      error: `Instructions must be ${DRIVE_DESCRIPTION_MAX} characters or fewer.`,
    };
  }

  const startsAt = new Date(startsRaw);
  const endsAt = new Date(endsRaw);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return { ok: false, error: "Please give a valid start and end time." };
  }
  if (endsAt.getTime() <= startsAt.getTime()) {
    return { ok: false, error: "The drive must end after it starts." };
  }

  let targetUnits: number | null = null;
  if (targetRaw !== "") {
    const parsed = Number(targetRaw);
    if (
      !Number.isInteger(parsed) ||
      parsed < DRIVE_TARGET_BOUNDS.min ||
      parsed > DRIVE_TARGET_BOUNDS.max
    ) {
      return {
        ok: false,
        error: `Target units must be a whole number between ${DRIVE_TARGET_BOUNDS.min} and ${DRIVE_TARGET_BOUNDS.max}, or left blank.`,
      };
    }
    targetUnits = parsed;
  }

  if (!(DRIVE_STATUS_OPTIONS as readonly { value: string }[]).some((s) => s.value === status)) {
    return { ok: false, error: "Invalid drive status." };
  }

  return {
    ok: true,
    value: {
      title,
      organizer,
      venue,
      locality,
      description: description === "" ? null : description,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      targetUnits,
      status,
    },
  };
}

/** The listing date, derived in IST so it can never disagree with the schedule. */
function istDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** Creates a drive. Admin-only; starts unpublished so nothing leaks by accident. */
export async function createCampusDrive(
  _prev: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const guard = await requireDriveAdmin();
  if (guard.error) return { ok: false, error: guard.error };

  const parsed = readDriveFields(formData);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const v = parsed.value;

  const supabase = await createSupabaseServerClient();
  const { data, error: dbError } = await supabase
    .from("campus_blood_drives")
    .insert({
      title: v.title,
      organizer: v.organizer,
      drive_date: istDate(v.startsAt),
      starts_at: v.startsAt,
      ends_at: v.endsAt,
      venue: v.venue,
      locality: v.locality,
      description: v.description,
      target_units: v.targetUnits,
      status: v.status,
      published: false,
    })
    .select("id")
    .maybeSingle();

  if (dbError) {
    const rule = driveRuleMessage(dbError);
    if (rule) return { ok: false, error: rule };
    const limited = safetyLimitMessage(dbError);
    if (limited) return { ok: false, error: limited };
    console.error("createCampusDrive failed:", dbError.message);
    return { ok: false, error: "Could not create the drive. Please try again." };
  }
  if (!data) return { ok: false, error: "The drive could not be created." };

  revalidatePath("/admin/drives");
  revalidatePath("/drives");
  return { ok: true, error: null, success: "Drive created. It stays a draft until you publish it." };
}


/** Edits a drive. Admin-only. A cancellation or completion notifies the roster
 *  in the database; this action never touches a blood request. */
export async function updateCampusDrive(
  _prev: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const guard = await requireDriveAdmin();
  if (guard.error) return { ok: false, error: guard.error };

  const driveId = String(formData.get("driveId") ?? "").trim();
  if (!isUuid(driveId)) return { ok: false, error: "Invalid drive reference." };

  const parsed = readDriveFields(formData);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const v = parsed.value;
  const publishNow = String(formData.get("publishNow") ?? "") === "on";

  const supabase = await createSupabaseServerClient();
  const { error: dbError } = await supabase
    .from("campus_blood_drives")
    .update({
      title: v.title,
      organizer: v.organizer,
      drive_date: istDate(v.startsAt),
      starts_at: v.startsAt,
      ends_at: v.endsAt,
      venue: v.venue,
      locality: v.locality,
      description: v.description,
      target_units: v.targetUnits,
      status: v.status,
      ...(publishNow ? { published: true } : {}),
    })
    .eq("id", driveId);

  if (dbError) {
    const rule = driveRuleMessage(dbError);
    if (rule) return { ok: false, error: rule };
    console.error("updateCampusDrive failed:", dbError.message);
    return { ok: false, error: "Could not save the drive. Please try again." };
  }

  revalidatePath("/admin/drives");
  revalidatePath(`/admin/drives/${driveId}`);
  revalidatePath("/drives");
  revalidatePath(`/drives/${driveId}`);
  revalidatePath("/notifications");
  return { ok: true, error: null, success: "Drive saved." };
}

/**
 * Publishes or unpublishes a drive. Admin-only.
 *
 * Unpublishing hides a drive from donors but never deletes its roster or any
 * recorded donation — those are records, and losing them would destroy the
 * donation history a donor relies on for their own availability interval.
 */
export async function setDrivePublished(
  _prev: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const guard = await requireDriveAdmin();
  if (guard.error) return { ok: false, error: guard.error };

  const driveId = String(formData.get("driveId") ?? "").trim();
  const published = String(formData.get("published") ?? "") === "on";
  if (!isUuid(driveId)) return { ok: false, error: "Invalid drive reference." };

  const supabase = await createSupabaseServerClient();
  const { error: dbError } = await supabase
    .from("campus_blood_drives")
    .update({ published })
    .eq("id", driveId);

  if (dbError) {
    console.error("setDrivePublished failed:", dbError.message);
    return { ok: false, error: "Could not change visibility. Please try again." };
  }

  revalidatePath("/admin/drives");
  revalidatePath(`/admin/drives/${driveId}`);
  revalidatePath("/drives");
  revalidatePath(`/drives/${driveId}`);
  return {
    ok: true,
    error: null,
    success: published
      ? "Drive published — donors can register now."
      : "Drive hidden from donors. Its records are kept.",
  };
}


/**
 * Registers the signed-in donor for a drive.
 *
 * The donor's own id always comes from the session, never the form, and the
 * (drive, donor) unique constraint plus the before-insert guard in the database
 * make a duplicate impossible. An optional note lets a donor say they can no
 * longer attend without the organisers needing their phone number.
 */
export async function registerForDrive(
  _prev: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const session = await getSessionInfo();
  if (!session.configured || !session.user || !session.profile) {
    return { ok: false, error: "Please log in to register." };
  }
  if (session.profile.status !== "active") {
    return { ok: false, error: "Only active donor accounts can register for a drive." };
  }
  if (session.profile.role !== "donor") {
    return { ok: false, error: "Only donors can register for a campus blood drive." };
  }

  const driveId = String(formData.get("driveId") ?? "").trim();
  if (!isUuid(driveId)) return { ok: false, error: "Invalid drive reference." };

  const note = String(formData.get("note") ?? "").trim();
  if (note.length > DRIVE_REGISTRATION_NOTE_MAX) {
    return { ok: false, error: `Note must be ${DRIVE_REGISTRATION_NOTE_MAX} characters or fewer.` };
  }

  const supabase = await createSupabaseServerClient();

  // Own-row RLS scopes this to the caller, so it can only ever reveal the
  // caller's own registration, never anyone else's.
  const { data: existing } = await supabase
    .from("campus_drive_registrations")
    .select("id, status")
    .eq("drive_id", driveId)
    .eq("donor_id", session.user.id)
    .maybeSingle();
  if (existing) {
    return {
      ok: false,
      error:
        existing.status === "cancelled"
          ? "You cancelled this registration earlier. Contact the organisers to rejoin."
          : "You are already registered for this drive.",
    };
  }

  const { error: dbError } = await supabase.from("campus_drive_registrations").insert({
    drive_id: driveId,
    donor_id: session.user.id,
    status: "registered",
    note: note === "" ? null : note,
  });

  if (dbError) {
    if (dbError.code === UNIQUE_VIOLATION) {
      return { ok: false, error: "You are already registered for this drive." };
    }
    const rule = driveRuleMessage(dbError);
    if (rule) return { ok: false, error: rule };
    const limited = safetyLimitMessage(dbError);
    if (limited) return { ok: false, error: limited };
    console.error("registerForDrive failed:", dbError.message);
    return { ok: false, error: "Could not register. Please try again." };
  }

  revalidatePath(`/drives/${driveId}`);
  revalidatePath("/drives");
  revalidatePath(`/admin/drives/${driveId}`);
  revalidatePath("/notifications");
  return { ok: true, error: null, success: "You are registered for this drive." };
}

/** Withdraws the caller's own registration while the drive is still open. */
export async function unregisterFromDrive(
  _prev: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const session = await getSessionInfo();
  if (!session.configured || !session.user || !session.profile) {
    return { ok: false, error: "Please log in first." };
  }

  const driveId = String(formData.get("driveId") ?? "").trim();
  if (!isUuid(driveId)) return { ok: false, error: "Invalid drive reference." };

  const supabase = await createSupabaseServerClient();
  // The own-row filter and the one-way transition guard both apply: a settled
  // registration cannot be reopened or cancelled again.
  const { data, error: dbError } = await supabase
    .from("campus_drive_registrations")
    .update({ status: "cancelled" })
    .eq("drive_id", driveId)
    .eq("donor_id", session.user.id)
    .in("status", ["registered", "checked_in"])
    .select("id")
    .maybeSingle();

  if (dbError) {
    const rule = driveRuleMessage(dbError);
    if (rule) return { ok: false, error: rule };
    console.error("unregisterFromDrive failed:", dbError.message);
    return { ok: false, error: "Could not withdraw. Please try again." };
  }
  if (!data) {
    return { ok: false, error: "That registration can no longer be changed." };
  }

  revalidatePath(`/drives/${driveId}`);
  revalidatePath("/drives");
  revalidatePath(`/admin/drives/${driveId}`);
  return { ok: true, error: null, success: "Your registration has been withdrawn." };
}


/**
 * Checks one registered donor in (or marks them as having taken part).
 *
 * Admin or active volunteer. The donor uuid comes from the roster the caller
 * was already permitted to read, and the one-way transition guard in the
 * database blocks anything that is not a legal forward move — so a volunteer
 * cannot fabricate a participation for someone who never attended.
 */
export async function setDriveAttendance(
  _prev: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const guard = await requireDriveCoordinator();
  if (guard.error) return { ok: false, error: guard.error };

  const driveId = String(formData.get("driveId") ?? "").trim();
  const donorId = String(formData.get("donorId") ?? "").trim();
  const next = String(formData.get("status") ?? "").trim();
  if (!isUuid(driveId) || !isUuid(donorId)) {
    return { ok: false, error: "Invalid drive or donor reference." };
  }
  if (next !== "checked_in" && next !== "participated") {
    return { ok: false, error: "Invalid attendance state." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error: dbError } = await supabase
    .from("campus_drive_registrations")
    .update({ status: next })
    .eq("drive_id", driveId)
    .eq("donor_id", donorId)
    .select("id")
    .maybeSingle();

  if (dbError) {
    const rule = driveRuleMessage(dbError);
    if (rule) return { ok: false, error: rule };
    console.error("setDriveAttendance failed:", dbError.message);
    return { ok: false, error: "Could not update attendance. Please try again." };
  }
  if (!data) {
    return { ok: false, error: "That registration could not be updated. Refresh and try again." };
  }

  revalidatePath(`/admin/drives/${driveId}`);
  revalidatePath(`/drives/${driveId}`);
  return {
    ok: true,
    error: null,
    success: next === "checked_in" ? "Donor checked in." : "Marked as having taken part.",
  };
}


/**
 * Records a donation collected at a drive into the EXISTING donation_history
 * ledger — not a parallel record. That reuse is deliberate: the 0012 trigger
 * sync_donor_profile_from_donation() fires on this table, so the donor's
 * availability interval starts and their donation count advance through the
 * exact same code path an emergency donation already uses. There is no second
 * cooldown and no second eligibility rule that can drift out of step.
 *
 * ADMIN ONLY. Volunteers may check donors in but may not assert that a donation
 * happened, because a donation record has a real consequence for that donor's
 * future matching availability.
 *
 * This records that a donation was COLLECTED. It is not, and must not be read
 * as, a claim that the donor was medically eligible — the blood bank and
 * medical staff remain the sole authority on who may donate.
 */
export async function recordDriveDonation(
  _prev: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const guard = await requireDriveAdmin();
  if (guard.error) return { ok: false, error: guard.error };

  const driveId = String(formData.get("driveId") ?? "").trim();
  const donorId = String(formData.get("donorId") ?? "").trim();
  const donatedOn = String(formData.get("donatedOn") ?? "").trim();
  const component = String(formData.get("bloodComponent") ?? "").trim();
  const unitsRaw = String(formData.get("units") ?? "1").trim();

  if (!isUuid(driveId) || !isUuid(donorId)) {
    return { ok: false, error: "Invalid drive or donor reference." };
  }
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(donatedOn) ||
    Number.isNaN(Date.parse(`${donatedOn}T00:00:00Z`))
  ) {
    return { ok: false, error: "Please give a valid donation date." };
  }
  if (donatedOn > new Date().toISOString().slice(0, 10)) {
    return { ok: false, error: "The donation date cannot be in the future." };
  }
  if (!(BLOOD_COMPONENTS as readonly { value: string }[]).some((c) => c.value === component)) {
    return { ok: false, error: "Please choose a blood component." };
  }
  const units = Number(unitsRaw);
  if (!Number.isInteger(units) || units < 1 || units > 10) {
    return { ok: false, error: "Units must be between 1 and 10." };
  }

  const supabase = await createSupabaseServerClient();

  // Only someone actually on the drive's roster can be credited with it, which
  // keeps the aggregate honest and stops drive donations being attributed to
  // accounts that never attended.
  const { data: registration } = await supabase
    .from("campus_drive_registrations")
    .select("id")
    .eq("drive_id", driveId)
    .eq("donor_id", donorId)
    .maybeSingle();
  if (!registration) {
    return { ok: false, error: "That donor is not registered for this drive." };
  }

  const { error: dbError } = await supabase.from("donation_history").insert({
    donor_id: donorId,
    // A drive donation belongs to the drive, never to a blood request.
    request_id: null,
    drive_id: driveId,
    blood_component: component,
    donated_on: donatedOn,
    units,
  });

  if (dbError) {
    // donation_history_drive_once_uidx is the real guarantee: one donation per
    // donor per drive, enforced in the database.
    if (dbError.code === UNIQUE_VIOLATION) {
      return { ok: false, error: "A donation is already recorded for this donor at this drive." };
    }
    const rule = driveRuleMessage(dbError);
    if (rule) return { ok: false, error: rule };
    console.error("recordDriveDonation failed:", dbError.message);
    return { ok: false, error: "Could not record the donation. Please try again." };
  }

  revalidatePath(`/admin/drives/${driveId}`);
  revalidatePath(`/drives/${driveId}`);
  revalidatePath("/admin/donations");
  revalidatePath("/dashboard/donor");
  revalidatePath("/notifications");
  return {
    ok: true,
    error: null,
    success: "Donation recorded. The donor's availability interval has been updated.",
  };
}

/**
 * Sends the one-shot upcoming-drive reminders.
 *
 * Mirrors the pg_cron job in migration 0015 so reminders still go out when
 * pg_cron is unavailable — the same pattern the ring engine already uses for
 * its expiring nudge. Safe to call on every drive page view: reminder_sent_at
 * plus the drive-aware duplicate guard make it idempotent.
 */
export async function tickDriveReminders(): Promise<void> {
  try {
    const session = await getSessionInfo();
    if (!session.configured || !session.user || !session.profile) return;
    if (session.profile.status !== "active") return;
    const supabase = await createSupabaseServerClient();
    await supabase.rpc("emit_drive_reminders", {
      p_within_hours: DRIVE_REMINDER_WINDOW_HOURS,
    });
  } catch {
    // Best-effort: a reminder sweep must never break the page it rides on.
  }
}

