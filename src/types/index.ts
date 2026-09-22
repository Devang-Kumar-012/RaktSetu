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
  availability: DonorAvailability;
  created_at: string;
  updated_at: string;
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
