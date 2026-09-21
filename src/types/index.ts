/** Account roles within RaktSetu. Admin is provisioned out-of-band, never self-registered. */
export type UserRole = "requester" | "donor" | "volunteer" | "hospital" | "admin";

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

/** Shape of a stored donor profile (future table `donor_profiles`). */
export interface DonorProfile {
  id: string;
  userId: string;
  bloodGroup: string;
  lastDonationDate: string | null;
  city: string;
  available: boolean;
}

/** Shape of a blood request (future table `blood_requests`). */
export interface BloodRequest {
  id: string;
  patientPseudonym: string;
  bloodGroup: string;
  hospitalName: string;
  city: string;
  urgency: "routine" | "urgent" | "critical";
  status: "open" | "fulfilled" | "closed";
  createdAt: string;
}
