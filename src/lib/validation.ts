/**
 * Field-level validation shared by client forms and server actions.
 * Server actions ALWAYS re-validate — client checks are convenience only.
 */

import { AVAILABILITY_OPTIONS, BLOOD_GROUPS, REGISTER_ROLES } from "@/lib/constants";

export function validateFullName(value: string): string | null {
  const name = value.trim();
  if (name.length < 2) return "Please enter your full name.";
  if (name.length > 80) return "Name must be 80 characters or fewer.";
  return null;
}

export function validateBloodGroup(value: string): string | null {
  if (!value) return "Please select a blood group.";
  if (!(BLOOD_GROUPS as readonly string[]).includes(value)) {
    return "Please choose a blood group from the list.";
  }
  return null;
}

export function validateLocality(value: string, required = true): string | null {
  const locality = value.trim();
  if (!locality) return required ? "Please enter your locality." : null;
  if (locality.length < 2) return "Locality is too short.";
  if (locality.length > 100) return "Locality must be 100 characters or fewer.";
  if (/[\n\r]/.test(locality)) return "Locality must be a single line.";
  return null;
}

export function validatePhone(value: string): string | null {
  const phone = value.trim();
  const digits = phone.replace(/[^0-9]/g, "");
  if (!phone) return "Please enter a phone number.";
  if (digits.length < 8 || digits.length > 15) {
    return "Phone number must contain 8 to 15 digits.";
  }
  if (!/^[+]?[0-9][0-9\s-]*$/.test(phone)) {
    return "Phone number can contain digits, spaces, dashes, and an optional leading +.";
  }
  return null;
}

/** Empty string means "no date" and is valid. */
export function validateLastDonationDate(value: string): string | null {
  const date = value.trim();
  if (!date) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Please provide a valid date.";
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "Please provide a valid date.";
  const today = new Date().toISOString().slice(0, 10);
  if (date > today) return "Last donation date cannot be in the future.";
  return null;
}

export function validateAvailability(value: string): string | null {
  if (!(AVAILABILITY_OPTIONS as readonly { value: string }[]).some((o) => o.value === value)) {
    return "Please choose an availability status.";
  }
  return null;
}

export function validateRegisterRole(value: string): string | null {
  if (!(REGISTER_ROLES as readonly { value: string }[]).some((r) => r.value === value)) {
    return "Please choose a valid role.";
  }
  return null;
}

/* ------------------------------------------------------------------------ */
/* Blood request validation                                                  */
/* ------------------------------------------------------------------------ */

import { BLOOD_COMPONENTS, URGENCY_OPTIONS, MIN_UNITS, MAX_UNITS, REQUEST_NOTE_MAX } from "@/lib/constants";

export function validateBloodComponent(value: string): string | null {
  if (!(BLOOD_COMPONENTS as readonly { value: string }[]).some((c) => c.value === value)) {
    return "Please choose Whole Blood or Platelets.";
  }
  return null;
}

export function validateUnits(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return "Please enter the number of units.";
  const n = Number(trimmed);
  if (n < MIN_UNITS || n > MAX_UNITS) {
    return `Units must be between ${MIN_UNITS} and ${MAX_UNITS}.`;
  }
  return null;
}

export function validateUrgency(value: string): string | null {
  if (!(URGENCY_OPTIONS as readonly { value: string }[]).some((u) => u.value === value)) {
    return "Please choose an urgency level.";
  }
  return null;
}

export function validateHospitalName(value: string): string | null {
  const name = value.trim();
  if (name.length < 2) return "Please enter the hospital name.";
  if (name.length > 120) return "Hospital name must be 120 characters or fewer.";
  if (/[\n\r]/.test(name)) return "Hospital name must be a single line.";
  return null;
}

/**
 * Required-by deadline. Accepts the datetime-local input shape
 * ("YYYY-MM-DDTHH:mm"). The deadline must be in the future and within
 * 30 days (requests older than that make no sense for emergency matching).
 */
export function validateRequiredBy(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
    return "Please pick a required-by date and time.";
  }
  const deadline = new Date(trimmed);
  if (Number.isNaN(deadline.getTime())) {
    return "Please pick a required-by date and time.";
  }
  if (deadline.getTime() <= Date.now()) {
    return "The required-by time must be in the future.";
  }
  const maxDate = Date.now() + 30 * 24 * 60 * 60 * 1000;
  if (deadline.getTime() > maxDate) {
    return "The required-by date cannot be more than 30 days ahead.";
  }
  return null;
}

export function validateContactName(value: string): string | null {
  const name = value.trim();
  if (name.length < 2) return "Please enter a contact name.";
  if (name.length > 80) return "Contact name must be 80 characters or fewer.";
  return null;
}

export function validateRequestNote(value: string): string | null {
  const note = value.trim();
  if (note.length > REQUEST_NOTE_MAX) {
    return `Note must be ${REQUEST_NOTE_MAX} characters or fewer.`;
  }
  return null;
}
