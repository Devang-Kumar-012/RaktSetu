/** Account roles within RaktSetu. Admin is provisioned out-of-band, never self-registered. */
export type UserRole = "requester" | "donor" | "volunteer" | "hospital" | "admin";

/** Account roles stored in the profiles table. */
export type AccountRole = "donor" | "requester" | "volunteer" | "admin";

export type AccountStatus = "active" | "suspended";

/** Row shape of the `profiles` table (see supabase/migrations/0001_profiles.sql). */
export interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: AccountRole;
  status: AccountStatus;
  created_at: string;
  updated_at: string;
}


/** Registration form values — minimal personal data by design. */
export interface RegisterFormValues {
  fullName: string;
  email: string;
  password: string;
  role: Exclude<UserRole, "admin">;
}

export interface LoginFormValues {
  email: string;
  password: string;
}

export type DonorAvailability = "available" | "temporarily_unavailable";

/** Row shape of the `donor_profiles` table (migration 0002). Private to the donor (admins can read). */
export interface DonorProfile {
  user_id: string;
  blood_group: string;
  locality: string;
  last_donation_date: string | null;
  phone: string;
  /** Approximate coordinate (~1 km grid), set by the donor. Never exposed to others. */
  latitude: number | null;
  longitude: number | null;
  availability: DonorAvailability;
  donation_count: number;
  created_at: string;
  updated_at: string;
}

/** Row shape of the `volunteer_profiles` table (migration 0002). Private to the volunteer (admins can read). */
export interface VolunteerProfile {
  user_id: string;
  locality: string | null;
  phone: string | null;
  availability: DonorAvailability;
  created_at: string;
  updated_at: string;
}

/** Row shape of `request_assistance` (migration 0009). Own-row RLS only. */
export type AssistanceStatus = "assisting" | "stopped";

export interface RequestAssistance {
  id: string;
  request_id: string;
  volunteer_id: string;
  status: AssistanceStatus;
  note: string | null;
  created_at: string;
  updated_at: string;
}

/** Safe request view returned by volunteer_* SQL functions (migration 0009).
 *  Deliberately excludes requester contact details and any donor private data. */
export interface VolunteerRequestView {
  id: string;
  blood_group: string;
  blood_component: BloodComponent;
  units: number;
  hospital_name: string;
  hospital_locality: string;
  urgency: RequestUrgency;
  required_by: string;
  status: BloodRequestStatus;
  note: string | null;
  created_at: string;
  donor_accepted: boolean;
  volunteers_assisting: number;
  me_assisting: boolean;
}


/** Minimal donor info exposed for future matching (view `donor_directory`).
 *  Deliberately excludes name, phone, last donation date, and donation count. */
export interface DonorDirectoryEntry {
  user_id: string;
  blood_group: string;
  locality: string;
  availability: DonorAvailability;
}

/** Row shape of a blood request (table `blood_requests`, migration 0004). */
export type BloodRequestStatus = "active" | "fulfilled" | "expired" | "cancelled";
export type BloodComponent = "whole_blood" | "platelets";
export type RequestUrgency = "routine" | "urgent" | "critical";

export interface BloodRequest {
  id: string;
  requester_id: string;
  blood_group: string;
  blood_component: BloodComponent;
  units: number;
  hospital_name: string;
  hospital_locality: string;
  urgency: RequestUrgency;
  /** ISO timestamptz — the deadline for donors to respond. */
  required_by: string;
  contact_name: string;
  contact_phone: string;
  note: string | null;
  status: BloodRequestStatus;
  fulfilled_at: string | null;
  cancelled_at: string | null;
  /** Approximate hospital-area coordinate (~1 km), geocoded at creation. */
  hospital_latitude: number | null;
  hospital_longitude: number | null;
  created_at: string;
  updated_at: string;
}

/** Blood request form values (client-side shape before serialization). */
export interface BloodRequestFormValues {
  bloodGroup: string;
  bloodComponent: BloodComponent;
  units: number;
  hospitalName: string;
  hospitalLocality: string;
  urgency: RequestUrgency;
  /** "YYYY-MM-DDTHH:mm" local input value. */
  requiredBy: string;
  contactName: string;
  contactPhone: string;
  note: string;
}

/** Singleton row of `platform_settings` (migration 0010). Admin-managed. */
export interface PlatformSettings {
  id: number;
  alert_rings_km: number[];
  alert_window_minutes: number;
  alert_due_at_offset_minutes: number;
  donation_interval_days: number;
  /** 0016: central operational values. Defaults reproduce current behaviour. */
  max_alert_rings: number;
  cooldown_reminder_lead_days: number;
  donor_alert_reminder_hours: number;
  drive_reminder_window_hours: number;
  updated_at: string;
}

/** Row shape of `request_reports` (migration 0010, widened by 0014). */
/** The five reasons RaktSetu offers. `spam` and `harassment` are the legacy
 *  0010 values: still valid on historical rows, no longer offered in the UI. */
export type ReportReason =
  | "fake"
  | "incorrect_information"
  | "no_longer_needed"
  | "abuse_misuse"
  | "other"
  | "spam"
  | "harassment";

/** Moderation state of a report. NEVER the request's lifecycle status:
 *  `open -> under_review -> reviewed | dismissed`. */
export type ReportStatus = "open" | "under_review" | "reviewed" | "dismissed";

export interface RequestReport {
  id: string;
  request_id: string;
  reporter_id: string;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Row shape of `donation_history` (migration 0010, extended by 0015). No
 *  medical data. `drive_id` is set when the donation was collected at a campus
 *  drive; `request_id` is then null, never both. */
export interface DonationRecord {
  id: string;
  donor_id: string;
  request_id: string | null;
  drive_id: string | null;
  blood_component: BloodComponent | null;
  donated_on: string;
  units: number;
  created_at: string;
  updated_at: string;
}

/* ------------------------------------------------------------------------ */
/* Campus blood drives (migration 0015)                                      */
/* ------------------------------------------------------------------------ */

/** A drive's own lifecycle — deliberately NOT the blood-request lifecycle, and
 *  never mixed with it. There is still no 'accepted' request status anywhere. */
export type CampusDriveStatus = "upcoming" | "ongoing" | "completed" | "cancelled";

/** A donor's participation state within one drive. */
export type DriveRegistrationStatus =
  | "registered"
  | "checked_in"
  | "participated"
  | "cancelled";

export interface CampusDrive {
  id: string;
  title: string;
  organizer: string;
  drive_date: string;
  starts_at: string;
  ends_at: string;
  venue: string;
  locality: string;
  description: string | null;
  target_units: number | null;
  status: CampusDriveStatus;
  published: boolean;
  reminder_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A registration row. Exposes a donor uuid + state only — never a phone
 *  number or location, which stay behind donor_profiles' own-row RLS. */
export interface DriveRegistration {
  id: string;
  drive_id: string;
  donor_id: string;
  status: DriveRegistrationStatus;
  note: string | null;
  registered_at: string;
  updated_at: string;
}

/** Aggregate operational figures for one drive (campus_drive_stats()).
 *  Counts only — no individual donor is ever represented. */
export interface CampusDriveStats {
  registered: number;
  checked_in: number;
  participated: number;
  cancelled: number;
  units_collected: number;
  target_units: number | null;
  /** Blood-group -> registered-donor count. A tally, never a roster. */
  group_breakdown: Record<string, number> | null;
}

/** Return shape of admin_platform_overview() (migration 0010). */
export interface AdminOverview {
  total_users: number;
  total_donors: number;
  total_requesters: number;
  total_volunteers: number;
  total_admins: number;
  suspended_users: number;
  active_requests: number;
  fulfilled_requests: number;
  expired_requests: number;
  cancelled_requests: number;
  completed_donations: number;
  open_reports: number;
  under_review_reports: number;
  resolved_reports: number;
  reports_last_24h: number;
  active_alerts: number;
  accepted_alerts: number;
  available_donors: number;
}

/** One rung of the recognition ladder, as returned by donor_recognition(). */
export interface RecognitionMilestone {
  count: number;
  reached: boolean;
}

/** A donor's OWN recognition, computed from donation_history (migration 0016).
 *  Never derived from alerts, acceptances or any medical judgement. */
export interface DonorRecognition {
  total_donations: number;
  total_units: number;
  first_donation: string | null;
  last_donation: string | null;
  /** The next rung, or null once the ladder is complete. */
  next_milestone: number | null;
  milestones: RecognitionMilestone[] | null;
}

/** Per-user notification preferences (migration 0016). Advisory categories
 *  only — emergency workflow notices are never suppressible. */
export interface NotificationPreferences {
  user_id: string;
  drive_updates: boolean;
  donor_reminders: boolean;
  recognition_updates: boolean;
  created_at: string;
  updated_at: string;
}

/** Singleton row of platform_safety_limits (migration 0014). Every anti-abuse
 *  limit lives here so none is a magic number inside a trigger. */
export interface PlatformSafetyLimits {
  id: number;
  max_active_requests_per_requester: number;
  min_request_interval_seconds: number;
  max_requests_per_hour: number;
  max_reports_per_day: number;
  max_alert_responses_per_minute: number;
  updated_at: string;
}

/** Return shape of admin_list_alerts() (migration 0010). Admin-only. */
export interface AdminAlertRow {
  alert_id: number;
  request_id: string;
  donor_id: string;
  ring_km: number;
  status: string;
  response: string | null;
  due_at: string;
  created_at: string;
  responded_at: string | null;
  accepted_at: string | null;
  blood_group: string;
  hospital_name: string;
  hospital_locality: string;
}

/** Row shape returned by public.donor_active_alerts() (migration 0011).
 *  The donor's OWN alert queue — requester contact fields are null except
 *  inside the caller's own accepted alert while contact_shared_until. */
export interface DonorAlertRow {
  alert_id: number;
  request_id: string;
  ring_km: number;
  /** APPROXIMATE whole-km straight-line distance from the caller's own rounded
   *  point to the hospital (0012, haversine_km). Null when either side has no
   *  point. Coordinates themselves are never returned. */
  approx_distance_km: number | null;
  status: "queued" | "sent" | "opened" | "responded" | "expired";
  response: "accepted" | "declined" | null;
  due_at: string;
  created_at: string;
  responded_at: string | null;
  contact_shared_until: string | null;
  blood_group: string;
  blood_component: BloodComponent;
  units: number;
  hospital_name: string;
  hospital_locality: string;
  urgency: RequestUrgency;
  required_by: string;
  note: string | null;
  request_status: BloodRequestStatus;
  requester_contact_name: string | null;
  requester_contact_phone: string | null;
}

/** Row shape returned by public.donor_donation_history() (migration 0012) —
 *  the caller's OWN completed donations. Request columns are null when the
 *  record is not linked to a request. Never requester contact, never
 *  coordinates — coordination and counts only, no medical data. */
export interface DonorDonationRow {
  donation_date: string;
  units: number;
  blood_component: BloodComponent | null;
  hospital_name: string | null;
  hospital_locality: string | null;
  request_status: BloodRequestStatus | null;
  request_id: string | null;
  /** 0015: set when this donation was collected at a campus drive. Request
   *  columns are null for those rows, and vice versa. */
  drive_id: string | null;
  drive_title: string | null;
}

/** Row shape returned by public.reveal_accepted_donors() (migration 0011).
 *  The only path exposing donor contact to another user: requester-only,
 *  post-acceptance, until contact_shared_until. */
export interface AcceptedDonor {
  request_id: string;
  donor_name: string;
  donor_phone: string;
  donor_blood_group: string;
  donor_locality: string;
}

/** Row shape returned by public.requester_ring_status() (migration 0011) —
 *  ring-engine progress for the caller's OWN requests only. */
export interface RequesterRingStatus {
  request_id: string;
  ring_index: number;
  ring_km: number;
  started_at: string;
  finished_at: string | null;
  alerts_sent: number;
  outcome: "accepted" | "request_closed" | "rings_exhausted" | null;
}

/** Row shape returned by public.admin_ring_progress() (migration 0011). */
export interface AdminRingProgressRow {
  request_id: string;
  ring_index: number;
  ring_km: number;
  started_at: string;
  finished_at: string | null;
  alerts_sent: number;
  outcome: string | null;
  request_status: string;
  blood_group: string;
  hospital_name: string;
  hospital_locality: string;
  required_by: string;
}

/** Row shape of `notifications` (migrations 0011–0013). In-app only — RaktSetu
 *  has no email/SMS/chat providers anywhere in the system.
 *
 *  ONE kind per logical event: the kind, together with `user_id`, `request_id`
 *  and `alert_id`, is the stable event key the database uses to deliver a given
 *  event to a given recipient at most once (migration 0013). */
export type NotificationKind =
  // donor: emergency alerts
  | "alert_received"
  | "alert_expiring"
  | "already_accepted"
  // shared lifecycle (donor + requester)
  | "request_closed"
  | "request_fulfilled"
  | "request_cancelled"
  | "request_expired"
  // requester lifecycle
  | "request_created"
  | "donor_accepted"
  | "rings_exhausted"
  // donor: eligibility / account
  | "eligibility_updated"
  | "acceptance_confirmed"
  | "account_status_changed"
  // volunteer: coordination
  | "volunteer_request_nearby"
  | "assisted_request_accepted"
  | "assisted_request_fulfilled"
  | "assisted_request_cancelled"
  | "assisted_request_expired"
  // admin: operations
  | "admin_report_received"
  // 0015: campus blood drives (in-app only)
  | "drive_registered"
  | "drive_upcoming_reminder"
  | "drive_updated"
  | "drive_completed"
  // 0016: advisory engagement categories (never emergency workflow notices)
  | "recognition_milestone"
  | "donor_cooldown_ending"
  | "donor_alert_pending";

export interface NotificationRow {
  id: number;
  user_id: string;
  kind: NotificationKind;

  request_id: string | null;
  alert_id: number | null;
  /** 0015: set for campus-drive events, so the same donor gets at most one of
   *  each drive event per drive rather than one ever. */
  drive_id: string | null;
  /** 0016: stable server-chosen reference for events belonging to neither a
   *  request, alert nor drive (a recognition milestone, a cooldown reminder). */
  dedupe_key: string | null;
  title: string;
  body: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}
