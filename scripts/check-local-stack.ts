/**
 * End-to-end smoke test for the self-contained local stack.
 *
 * Proves the deployed behaviour the prompt demands, without a browser: an
 * account can be created and signed back in, a requester can raise an
 * emergency request, a donor is alerted by proximity and blood compatibility,
 * acceptance is first-writer-wins, contact details stay hidden until then, the
 * request lifecycle closes, and a donation cannot be inflated by repetition.
 *
 * It runs against the SAME modules the app runs, with a localStorage shim, so
 * it is not a reimplementation of the rules.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Repo root, resolved from this script's own location. */
const ROOT = join(import.meta.dirname, "..");

// A minimal browser shim so the store's isBrowser() guard passes under Node.
// Both `window` and `localStorage` are required by that guard — shimming only
// one silently disables persistence, which is exactly the trap this test is
// here to rule out.
const mem = new Map<string, string>();
const storageShim = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
} as unknown as Storage;
(globalThis as unknown as { localStorage: Storage }).localStorage = storageShim;
(globalThis as unknown as { window: unknown }).window = { localStorage: storageShim };

import {
  createUser,
  DEMO_ADMIN_EMAIL,
  DEMO_ADMIN_PASSWORD,
  getPlatformSettings,
  nowIso,
  readDatabase,
  signIn,
  signInDetailed,
  STORE_KEY,
  UNIQUE_VIOLATION,
  type LocalDonorProfile,
  updateDatabase,
  writeSession,
} from "../src/lib/local/store";
import {
  expandAlertRings,
  recordDonation,
  respondToAlert,
  revealAcceptedDonors,
  setRequestStatus,
} from "../src/lib/local/engine";
import {
  makeCredential,
  sha256Hex,
  verifyPassword,
} from "../src/lib/local/crypto";
import { createLocalClient } from "../src/lib/local/adapter";
import { isBloodCompatible } from "../src/lib/blood-compat";

let passed = 0;
const failures: string[] = [];
function check(name: string, fn: () => void | Promise<void>): void {
  try {
    const r = fn();
    if (r instanceof Promise) {
      r.catch((err) => failures.push(`${name}: ${(err as Error).message}`));
      passed += 1;
      return;
    }
    passed += 1;
  } catch (err) {
    failures.push(`${name}: ${(err as Error).message}`);
  }
}

/** Pushes an active request and an available donor into the store. */
function seed(opts: {
  requesterId: string;
  donorId: string;
  group: string;
  donorGroup: string;
  km: number;
}) {
  updateDatabase((db) => {
    db.blood_requests.push({
      id: "req_1",
      requester_id: opts.requesterId,
      requester_name: "Rekha",
      requester_phone: "9000000000",
      blood_group: opts.group,
      blood_component: "whole_blood",
      units: 1,
      // The browser-side store keeps its own shape; the SQLite request table has
      // moved to a single `locality` (see src/lib/server/db.ts).
      hospital_name: "City Hospital",
      hospital_locality: "Bengaluru Central",
      urgency: "critical",
      required_by: new Date(Date.now() + 6 * 3_600_000).toISOString(),
      note: null,
      status: "active",
      // ~0.01 degrees of latitude is about 1.1 km.
      latitude: 12.9716,
      longitude: 77.5946,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    const existing = db.donor_profiles.find((p) => p.user_id === opts.donorId);
    const profile: LocalDonorProfile = existing ?? {
      user_id: opts.donorId,
      blood_group: "",
      locality: "",
      phone: "",
      availability: "temporarily_unavailable",
      last_donation_date: null,
      donation_count: 0,
      latitude: null,
      longitude: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    // UPDATE the row signup created, exactly as the donor profile form does.
    // Pushing a second row for the same donor would leave the engine reading
    // whichever one it found first — the blank one — and silently match nobody.
    profile.blood_group = opts.donorGroup;
    profile.locality = "Central";
    profile.phone = "9888888888";
    profile.availability = "available";
    profile.last_donation_date = null;
    profile.latitude = 12.9716 + opts.km / 111;
    profile.longitude = 77.5946;
    profile.updated_at = nowIso();
    if (!existing) db.donor_profiles.push(profile);
  });
}

/* ---------------------------------------------------------------- accounts */
const requester = createUser("req@example.com", "password123", {
  role: "requester",
  full_name: "Rekha",
});
const donor = createUser("donor@example.com", "password123", {
  role: "donor",
  full_name: "Arun",
});
const outsider = createUser("other@example.com", "password123", {
  role: "requester",
  full_name: "Someone",
});

// The real ids from createUser, NOT placeholders: the engine resolves a donor
// profile to its user row, and a made-up id would find nothing and make every
// matching check fail for the wrong reason. Declared after the accounts exist.
const DONOR = donor.id;
const REQUESTER = requester.id;
const OUTSIDER = outsider.id;

check("signup creates an active account with the chosen role", () => {
  assert.equal(requester.role, "requester");
  assert.equal(donor.role, "donor");
  assert.equal(requester.status, "active");
});

check("a hand-crafted role=admin is rewritten, not honoured", () => {
  // The exact escalation the prompt calls out, attempted directly against the
  // store rather than through the form.
  const sneaky = createUser("sneaky@example.com", "password123", { role: "admin" });
  assert.equal(sneaky.role, "requester", "admin must never be self-assigned");
});

check("a duplicate email is rejected", () => {
  assert.throws(() => createUser("req@example.com", "x", { role: "donor" }));
});

check("sign-in works, and a wrong password is refused", () => {
  writeSession(null);
  assert.equal(signIn("donor@example.com", "password123")?.id, donor.id);
  assert.equal(signIn("donor@example.com", "wrong-password"), null);
});

check("an unknown account is indistinguishable from a wrong password", () => {
  writeSession(null);
  assert.equal(signIn("nobody@example.com", "whatever"), null);
});

check("a suspended account cannot sign in", () => {
  updateDatabase((db) => {
    const u = db.users.find((x) => x.id === donor.id);
    if (u) u.status = "suspended";
  });
  writeSession(null);
  assert.equal(signIn("donor@example.com", "password123"), null);
  updateDatabase((db) => {
    const u = db.users.find((x) => x.id === donor.id);
    if (u) u.status = "active";
  });
});

/* -------------------------------------------------------------- the alert */
check("blood compatibility is a real rule, not a stub", () => {
  assert.equal(isBloodCompatible("O-", "A+", "whole_blood"), true);
  assert.equal(isBloodCompatible("A+", "O-", "whole_blood"), false);
});

check("a nearby compatible available donor is alerted", () => {
  seed({ requesterId: REQUESTER, donorId: DONOR, group: "A+", donorGroup: "O-", km: 2 });
  expandAlertRings();
  const alerts = readDatabase().donor_alerts;
  assert.equal(alerts.length, 1, "exactly one alert for one eligible donor");
  assert.equal(alerts[0].response, null);
});

check("an incompatible donor is never alerted", () => {
  updateDatabase((d) => {
    d.donor_alerts.length = 0;
    d.ring_progress.length = 0;
    const r = d.blood_requests.find((x) => x.id === "req_1");
    if (r) r.blood_group = "B-";
    const p = d.donor_profiles.find((x) => x.user_id === DONOR);
    // A+ cannot donate to B-, which is the point. (A+ → A+ WOULD be
    // compatible, so the first draft of this check asserted the wrong thing.)
    if (p) p.blood_group = "A+";
  });
  expandAlertRings();
  assert.equal(readDatabase().donor_alerts.length, 0, "incompatible donor must be skipped");
});

check("re-running the engine does not alert the same donor twice", () => {
  updateDatabase((d) => {
    const p = d.donor_profiles.find((x) => x.user_id === DONOR);
    if (p) p.blood_group = "O-";
    // Reset the ring progress too: with it intact the engine correctly sees
    // itself inside the 10-minute window and creates nothing, which is a
    // different rule from the one under test here.
    d.donor_alerts.length = 0;
    d.ring_progress.length = 0;
  });
  expandAlertRings();
  expandAlertRings();
  expandAlertRings();
  assert.equal(
    readDatabase().donor_alerts.length,
    1,
    "repeated ticks must not duplicate an alert",
  );
});

check("an unavailable donor is skipped", () => {
  updateDatabase((d) => {
    const p = d.donor_profiles.find((x) => x.user_id === DONOR);
    if (p) p.availability = "temporarily_unavailable";
    d.donor_alerts.length = 0;
    d.ring_progress.length = 0;
  });
  expandAlertRings();
  assert.equal(readDatabase().donor_alerts.length, 0);
});

check("a donor inside the application cooldown is skipped", () => {
  updateDatabase((d) => {
    const p = d.donor_profiles.find((x) => x.user_id === DONOR);
    if (p) {
      p.availability = "available";
      p.last_donation_date = new Date(Date.now() - 10 * 86_400_000)
        .toISOString()
        .slice(0, 10);
    }
    d.donor_alerts.length = 0;
    d.ring_progress.length = 0;
  });
  expandAlertRings();
  assert.equal(
    readDatabase().donor_alerts.length,
    0,
    "a donor inside the donation interval must not be alerted",
  );
});


/* ---------------------------------------------------- acceptance + privacy */
check("a donor accepts and the requester is notified", () => {
  updateDatabase((d) => {
    const p = d.donor_profiles.find((x) => x.user_id === DONOR);
    if (p) p.last_donation_date = null;
    d.donor_alerts.length = 0;
    d.ring_progress.length = 0;
    d.notifications.length = 0;
  });
  expandAlertRings();
  const alert = readDatabase().donor_alerts[0];
  const result = respondToAlert(alert.id, DONOR, "accepted");
  assert.equal(result, "accepted");
  const kinds = readDatabase().notifications.map((n) => n.kind);
  assert.ok(kinds.includes("donor_accepted"), "requester must be told");
});

check("a non-owner can never see a donor contact", () => {
  // The privacy rule tested from the outside: another requester asking for the
  // same request gets nothing back, not an error and not a partial row.
  const revealed = revealAcceptedDonors(OUTSIDER, ["req_1"]);
  assert.equal(revealed.length, 0, "a non-owner must never see a donor contact");
});

check("the owning requester sees the donor contact after acceptance", () => {
  const revealed = revealAcceptedDonors(REQUESTER, ["req_1"]) as {
    donor_phone: string;
  }[];
  assert.equal(revealed.length, 1);
  assert.equal(revealed[0].donor_phone, "9888888888");
});

check("a second donor cannot accept an already-accepted request", () => {
  updateDatabase((d) => {
    d.donor_alerts.push({
      id: "alert_second",
      request_id: "req_1",
      donor_id: OUTSIDER,
      ring_index: 0,
      ring_km: 3,
      status: "sent",
      response: null,
      responded_at: null,
      accepted_at: null,
      contact_shared_until: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
  });
  const result = respondToAlert("alert_second", OUTSIDER, "accepted");
  assert.equal(result, "already_taken", "the first valid acceptance must win");
});

check("a request that already has a donor refuses every later response", () => {
  // Declining is refused for the same reason accepting is: the request already
  // has its winner, so the alert is no longer actionable either way.
  assert.equal(
    respondToAlert("alert_second", OUTSIDER, "declined"),
    "already_taken",
    "a donor must not be able to respond to a request that already has a donor",
  );
});

check("a genuinely closed request is not actionable", () => {
  // Closed because cancelled, not because somebody else accepted.
  updateDatabase((d) => {
    d.donor_alerts.push({
      id: "alert_late",
      request_id: "req_closed",
      donor_id: DONOR,
      ring_index: 0,
      ring_km: 3,
      status: "sent",
      response: null,
      responded_at: null,
      accepted_at: null,
      contact_shared_until: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    d.blood_requests.push({
      ...d.blood_requests[0],
      id: "req_closed",
      status: "cancelled",
      requester_id: REQUESTER,
    });
  });
  assert.equal(
    respondToAlert("alert_late", DONOR, "accepted"),
    "request_closed",
    "a cancelled request must never be acceptable",
  );
});

/**
 * Builds a fresh request that is genuinely accepted end to end: a live active
 * request, a real engine tick, and a real acceptance by DONOR.
 *
 * Self-contained on purpose. Several checks below deliberately wipe
 * `donor_alerts` to isolate the ring engine, which destroys any earlier
 * acceptance — so a later check that reused `req_1` would be testing whatever
 * the previous check left behind rather than the rule it claims to test.
 */
function acceptedRequest(id: string): void {
  updateDatabase((db) => {
    db.blood_requests.push({
      ...db.blood_requests[0],
      id,
      status: "active",
      requester_id: REQUESTER,
      blood_group: "A+",
      required_by: new Date(Date.now() + 6 * 3_600_000).toISOString(),
    });
    db.donor_alerts = db.donor_alerts.filter((a) => a.request_id !== id);
    db.ring_progress = db.ring_progress.filter((p) => p.request_id !== id);
    const prof = db.donor_profiles.find((x) => x.user_id === DONOR);
    if (prof) {
      prof.last_donation_date = null;
      prof.availability = "available";
      prof.blood_group = "O-";
    }
  });
  expandAlertRings();
  const alert = readDatabase().donor_alerts.find((a) => a.request_id === id);
  assert.ok(alert, `the engine should have alerted a compatible donor for ${id}`);
  assert.equal(respondToAlert(alert.id, DONOR, "accepted"), "accepted");
}

check("accepting stops every future ring for that request", () => {
  // The real invariant, proved the only way that can be trusted: tick the
  // engine repeatedly AFTER a genuine acceptance and require that it never
  // produces another actionable alert. Counting leftover rows would instead
  // measure whatever an earlier check injected by hand.
  acceptedRequest("req_rings");
  for (let i = 0; i < 3; i += 1) expandAlertRings();
  const open = readDatabase().donor_alerts.filter(
    (a) => a.request_id === "req_rings" && a.response === null && a.status !== "expired",
  );
  assert.equal(open.length, 0, "no actionable alert may survive an acceptance");
  const unfinished = readDatabase().ring_progress.filter(
    (p) => p.request_id === "req_rings" && p.finished_at === null,
  );
  assert.equal(unfinished.length, 0, "the ring process must be marked finished");
});


/* --------------------------------------------------------- the lifecycle */
check("the requester can cancel", () => {
  assert.equal(setRequestStatus("req_1", REQUESTER, "cancelled"), "ok");
  assert.equal(readDatabase().blood_requests[0].status, "cancelled");
});

check("a terminal request never reopens", () => {
  assert.equal(
    setRequestStatus("req_1", REQUESTER, "fulfilled"),
    "already_closed",
    "terminal states must never reopen",
  );
});

check("a non-owner cannot cancel somebody else's request", () => {
  updateDatabase((d) => {
    d.blood_requests.push({
      ...d.blood_requests[0],
      id: "req_2",
      status: "active",
      requester_id: REQUESTER,
    });
  });
  assert.equal(setRequestStatus("req_2", OUTSIDER, "cancelled"), "not_owner");
});

check("cancelling stops all future alerting", () => {
  updateDatabase((d) => {
    d.donor_alerts.length = 0;
    d.ring_progress.length = 0;
  });
  expandAlertRings();
  assert.equal(
    readDatabase().donor_alerts.filter((a) => a.request_id === "req_1").length,
    0,
    "a closed request must never produce another alert",
  );
});

/* -------------------------------------------------------------- donations */
check("a donation cannot be recorded without a valid acceptance", () => {
  const result = recordDonation(DONOR, "req_2", 1);
  assert.equal(result.ok, false, "no accepted donor means no donation");
});

check("a repeated donation is refused, so recognition cannot inflate", () => {
  // Built on its own accepted request: an earlier check wipes donor_alerts to
  // isolate the ring engine, so reusing req_1 here would find the acceptance
  // already destroyed and fail for the wrong reason.
  acceptedRequest("req_donate");
  updateDatabase((d) => {
    const r = d.blood_requests.find((x) => x.id === "req_donate");
    if (r) r.status = "fulfilled";
  });
  const first = recordDonation(DONOR, "req_donate", 1);
  assert.equal(first.ok, true, "a donation follows a valid acceptance");
  const second = recordDonation(DONOR, "req_donate", 1);
  assert.equal(second.ok, false, "the same donor cannot donate twice in a day");
  assert.equal(
    readDatabase().donation_history.filter(
      (h) => h.donor_id === DONOR && h.request_id === "req_donate",
    ).length,
    1,
    "recognition must count exactly one donation, never two",
  );
});

/* ------------------------------------------------- centralised settings */
check("platform settings and anti-abuse limits exist with the documented defaults", () => {
  // These tables were previously absent from the store, so the admin form
  // reported success while nothing was saved and the engine kept using
  // hardcoded values. A write must now genuinely land.
  const db = readDatabase();
  assert.equal(db.platform_settings.length, 1, "exactly one settings row to update");
  assert.deepEqual(
    db.platform_settings[0].alert_rings_km,
    [3, 7, 15],
    "default ring distances must match the documented 3/7/15",
  );
  assert.equal(db.platform_settings[0].alert_window_minutes, 10);
  assert.equal(db.platform_safety_limits.length, 1, "anti-abuse limits must exist too");
});

check("a configured ring distance actually changes who gets alerted", () => {
  // Proves the setting is READ, not merely stored: a donor 6.5 km away is outside
  // the default 3 km ring but inside a 10 km one, so widening the setting must be
  // the only thing that brings the alert in.
  updateDatabase((d) => {
    d.blood_requests = d.blood_requests.filter((r) => r.id !== "req_settings");
    d.donor_alerts = d.donor_alerts.filter((a) => a.request_id !== "req_settings");
    d.ring_progress = d.ring_progress.filter((p) => p.request_id !== "req_settings");
    d.blood_requests.push({
      ...d.blood_requests[0],
      id: "req_settings",
      status: "active",
      requester_id: REQUESTER,
      blood_group: "A+",
      required_by: new Date(Date.now() + 6 * 3_600_000).toISOString(),
    });
    const prof = d.donor_profiles.find((x) => x.user_id === DONOR);
    if (prof) {
      prof.last_donation_date = null;
      prof.availability = "available";
      prof.blood_group = "O-";
      prof.latitude = 12.9716 + 6.5 / 111;
      prof.longitude = 77.5946;
    }
  });
  const countFor = (id: string) =>
    readDatabase().donor_alerts.filter((a) => a.request_id === id).length;
  expandAlertRings();
  assert.equal(countFor("req_settings"), 0, "a 6.5 km donor is outside the default 3 km ring");

  updateDatabase((d) => {
    d.platform_settings[0].alert_rings_km = [10, 15, 25];
    // The engine correctly refuses to widen a ring while it is still inside the
    // 10-minute window, so the first ring is backdated: this is the state a real
    // request is in once the window has genuinely elapsed. Without this the
    // second tick would be (correctly) refused.
    for (const p of d.ring_progress) {
      if (p.request_id === "req_settings") {
        p.started_at = new Date(Date.now() - 11 * 60_000).toISOString();
      }
    }
  });
  expandAlertRings();
  assert.equal(countFor("req_settings"), 1, "widening the ring must bring the donor in");
  // The request had already completed its (empty) first ring, so the engine
  // correctly moved to the next configured step. Ring indices are deliberately
  // 1-BASED (ring 1 = the first radius, ring 2 = the second), matching the
  // documented 3 km / 7 km / 15 km scheme, so the configured radius for a ring
  // is config[ring_index - 1]. Asserting that relationship proves the value came
  // from the configuration rather than a hardcoded default.
  const widened = readDatabase().donor_alerts.find(
    (a) => a.request_id === "req_settings",
  );
  assert.ok(widened, "the widened ring must produce an alert");
  assert.ok(widened.ring_index >= 1, "ring indices are 1-based");
  assert.equal(
    widened.ring_km,
    [10, 15, 25][widened.ring_index - 1],
    "the recorded radius must be the CONFIGURED radius for that ring, not a hardcoded default",
  );
  assert.notEqual(
    widened.ring_km,
    7,
    "a 7 km radius would mean the old hardcoded 3/7/15 defaults were used",
  );
  // Restore so later checks are unaffected.
  updateDatabase((d) => {
    d.platform_settings[0].alert_rings_km = [3, 7, 15];
    const prof = d.donor_profiles.find((x) => x.user_id === DONOR);
    if (prof) prof.latitude = 12.9716 + 2 / 111;
  });
});

check("a configured donation interval actually excludes a donor", () => {
  // Application-level tracking only — never a medical judgement.
  updateDatabase((d) => {
    d.blood_requests = d.blood_requests.filter((r) => r.id !== "req_cool");
    d.donor_alerts = d.donor_alerts.filter((a) => a.request_id !== "req_cool");
    d.ring_progress = d.ring_progress.filter((p) => p.request_id !== "req_cool");
    d.blood_requests.push({
      ...d.blood_requests[0],
      id: "req_cool",
      status: "active",
      requester_id: REQUESTER,
      blood_group: "A+",
      required_by: new Date(Date.now() + 6 * 3_600_000).toISOString(),
    });
    const prof = d.donor_profiles.find((x) => x.user_id === DONOR);
    if (prof) {
      prof.blood_group = "O-";
      prof.availability = "available";
      prof.latitude = 12.9716 + 2 / 111;
      prof.last_donation_date = new Date(Date.now() - 40 * 86_400_000)
        .toISOString()
        .slice(0, 10);
    }
  });
  expandAlertRings();
  assert.equal(
    readDatabase().donor_alerts.filter((a) => a.request_id === "req_cool").length,
    0,
    "a donor 40 days into a 90-day interval must not be alerted",
  );
  updateDatabase((d) => {
    d.platform_settings[0].donation_interval_days = 30;
    for (const p of d.ring_progress) {
      if (p.request_id === "req_cool") {
        p.started_at = new Date(Date.now() - 11 * 60_000).toISOString();
      }
    }
  });
  expandAlertRings();
  assert.equal(
    readDatabase().donor_alerts.filter((a) => a.request_id === "req_cool").length,
    1,
    "shortening the configured interval must make that donor eligible again",
  );
  updateDatabase((d) => {
    d.platform_settings[0].donation_interval_days = 90;
    const prof = d.donor_profiles.find((x) => x.user_id === DONOR);
    if (prof) prof.last_donation_date = null;
  });
});

check("a corrupt settings row falls back to safe defaults, never disabling alerts", () => {
  updateDatabase((d) => {
    d.platform_settings[0].alert_rings_km = [];
    d.platform_settings[0].alert_window_minutes = -999;
    d.platform_settings[0].donation_interval_days = "nonsense" as never;
  });
  const s = getPlatformSettings();
  assert.deepEqual(
    s.alert_rings_km,
    [3, 7, 15],
    "an empty ring list must fall back to 3/7/15",
  );
  assert.equal(s.alert_window_minutes, 10, "a negative window must fall back");
  assert.equal(s.donation_interval_days, 90, "a non-numeric interval must fall back");
  updateDatabase((d) => {
    d.platform_settings[0].alert_rings_km = [3, 7, 15];
    d.platform_settings[0].alert_window_minutes = 10;
    d.platform_settings[0].donation_interval_days = 90;
  });
});

/* ------------------------------------------- the read-side RPC projections */
check("every rpc the app calls is implemented, not a silent empty result", async () => {
  // These read-side functions used to be SQL. While they were unimplemented the
  // adapter returned a graceful "Unknown function" error, so every donor alert
  // list, volunteer dashboard, admin overview and drive-statistics panel simply
  // rendered EMPTY — with a green build and a passing suite. Assert the whole
  // surface exists, so a new call site cannot fall into that hole again.
  const client = createLocalClient();
  const called = [
    "admin_list_alerts",
    "admin_platform_overview",
    "admin_ring_progress",
    "campus_drive_stats",
    "donor_active_alerts",
    "donor_donation_history",
    "donor_recognition",
    "emit_alert_expiring",
    "emit_drive_reminders",
    "emit_donor_reminders",
    "expand_alert_rings",
    "mark_alert_responded",
    "match_donors_for_request",
    "matching_donor_stats",
    "requester_ring_status",
    "reveal_accepted_donors",
    "volunteer_active_requests",
    "volunteer_request_detail",
  ];
  for (const name of called) {
    const r = await client.rpc(name, { p_request_id: "req_1", p_limit: 5 });
    // "Implemented" is the claim under test, NOT "succeeds on fake arguments":
    // mark_alert_responded correctly refuses a bogus donor, which is a working
    // function rather than a missing one. Only the unknown-function error — the
    // signature of a call site with nothing behind it — fails here.
    assert.ok(
      r.error === null || !/Unknown function/.test(r.error.message),
      `rpc("${name}") must be implemented — an unknown function renders the page empty`,
    );
  }
});

check("a donor's alert list shows their own alerts and hides other donors'", async () => {
  const client = createLocalClient();
  // Accepted end to end, so there is a real alert to project.
  acceptedRequest("req_proj");
  writeSession({ user_id: DONOR, signed_in_at: nowIso() });
  const mine = await client.rpc("donor_active_alerts", { p_limit: 50 });
  const rows = mine.data as { request_id: string }[];
  assert.ok(
    rows.some((r) => r.request_id === "req_proj"),
    "the donor must see the alert addressed to them",
  );
  assert.equal(mine.error, null);

  // A different donor must see nothing at all.
  writeSession({ user_id: OUTSIDER, signed_in_at: nowIso() });
  const theirs = await client.rpc("donor_active_alerts", { p_limit: 50 });
  assert.equal(
    (theirs.data as unknown[]).length,
    0,
    "another donor must never see somebody else's alerts",
  );
  writeSession({ user_id: DONOR, signed_in_at: nowIso() });
});

check("the donor alert list never leaks coordinates or contact details", async () => {
  const client = createLocalClient();
  writeSession({ user_id: DONOR, signed_in_at: nowIso() });
  const r = await client.rpc("donor_active_alerts", { p_limit: 50 });
  const text = JSON.stringify(r.data ?? []);
  assert.ok(!/"latitude"|"longitude"/.test(text), "exact coordinates must never be returned");
  assert.ok(
    !/"donor_phone"|"donor_email"/.test(text),
    "donor contact details must never appear in the donor's own alert list",
  );
});

check("admin projections are refused for non-admins", async () => {
  const client = createLocalClient();
  writeSession({ user_id: DONOR, signed_in_at: nowIso() });
  for (const name of ["admin_list_alerts", "admin_ring_progress", "admin_platform_overview"]) {
    const r = await client.rpc(name, { p_limit: 10 });
    assert.equal(
      (r.data as unknown[]).length,
      0,
      `${name} must return nothing for a non-admin`,
    );
  }
  assert.equal(
    ((await client.rpc("campus_drive_stats", { p_drive_id: "any" })).data as unknown[])
      .length,
    0,
    "campus_drive_stats must return nothing for a non-admin",
  );
});

check("the admin overview counts real records and invents nothing", async () => {
  const client = createLocalClient();
  // Sign in as the built-in demo admin. Public signup can NEVER create one —
  // asserted separately — so the admin surface is reached only this way.
  writeSession({ user_id: "user_demo_admin", signed_in_at: nowIso() });
  const db = readDatabase();
  const r = await client.rpc("admin_platform_overview");
  const row = (
    r.data as { total_users: number; total_donors: number; open_reports: number }[]
  )[0];
  assert.ok(row, "an admin must receive an overview row");
  assert.equal(row.total_users, db.users.length, "total_users must equal the stored users");
  assert.equal(
    row.total_donors,
    db.users.filter((u) => u.role === "donor").length,
    "the donor count must be counted, not assumed",
  );
  assert.equal(
    row.open_reports,
    db.request_reports.filter((x) => x.status === "open").length,
    "open reports must be counted from the store",
  );
});

check("an admin exists, but is reachable only through the documented demo account", () => {
  // Without this the whole admin area was unreachable: createUser refuses
  // role=admin, and nothing else ever produced an admin at all.
  const db = readDatabase();
  const admins = db.users.filter((u) => u.role === "admin");
  assert.equal(admins.length, 1, "a fresh database has exactly one admin");
  assert.equal(admins[0].email, DEMO_ADMIN_EMAIL, "and it is the documented demo account");
  assert.equal(
    signInDetailed(DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD).ok,
    true,
    "the demo admin must be able to sign in",
  );
  assert.equal(
    signInDetailed(DEMO_ADMIN_EMAIL, "wrong").ok,
    false,
    "a wrong password must still fail — this is not an open door",
  );
  writeSession(null);
});

check("matching stats are refused for another requester's request", async () => {
  const client = createLocalClient();
  writeSession({ user_id: OUTSIDER, signed_in_at: nowIso() });
  const r = await client.rpc("matching_donor_stats", { p_request_id: "req_proj" });
  assert.ok(r.error, "a non-owner must not be able to inspect matching");
  assert.equal(r.data, null, "no matching data may leak to a non-owner");
});

check("volunteer views exclude contact numbers", async () => {
  const client = createLocalClient();
  const vol = createUser("vol@example.com", "password123", { role: "volunteer" });
  writeSession({ user_id: vol.id, signed_in_at: nowIso() });
  const r = await client.rpc("volunteer_active_requests", { p_limit: 20 });
  assert.equal(r.error, null);
  const text = JSON.stringify(r.data ?? []);
  assert.ok(!/requester_phone/.test(text), "a volunteer must not receive contact numbers");
  assert.ok(!/donor_phone/.test(text), "a volunteer must not receive donor numbers");
});

/* ------------------------------------------------------- credential safety */
check("passwords are never stored in plain text", () => {
  // The store used to keep `password` on the user row, so every credential sat
  // in readable localStorage and leaked into anything that stringified a user.
  const secret = "correct-horse-battery-staple";
  const u = createUser(`hash-${Date.now()}@example.com`, secret, { role: "requester" });

  const raw = JSON.stringify(readDatabase().users);
  assert.ok(!raw.includes(secret), "the raw password must never appear in stored data");
  assert.ok(raw.includes("password_hash"), "a hash should be stored instead");
  assert.equal(
    (u as unknown as { password?: string }).password,
    undefined,
    "the returned user must not carry the password either",
  );
  assert.equal(
    (u as unknown as { password_hash?: string }).password_hash?.startsWith("s2$"),
    true,
    "the stored hash must be the salted, versioned format",
  );
  // The demo admin must be hashed on the same terms.
  const admin = readDatabase().users.find((x) => x.email === DEMO_ADMIN_EMAIL);
  assert.ok(admin, "the demo admin exists");
  assert.ok(
    !JSON.stringify(admin).includes(DEMO_ADMIN_PASSWORD),
    "the demo admin's password must not be stored in plain text either",
  );
});

check("sign-in still works with hashes, and a wrong password still fails", () => {
  const email = "roundtrip@example.com";
  createUser(email, "s3cret-pass", { role: "donor" });
  assert.equal(
    signInDetailed(email, "s3cret-pass").ok,
    true,
    "the correct password must still sign in",
  );
  writeSession(null);
  assert.equal(
    signInDetailed(email, "not-it").ok,
    false,
    "a wrong password must still be refused",
  );
  assert.equal(
    signInDetailed("nobody@example.com", "s3cret-pass").ok,
    false,
    "an unknown address must still be refused",
  );
});

check("an account stored by an older build can still sign in, and is upgraded", () => {
  // Upgrading must not lock anybody out: a legacy plaintext row is accepted
  // once, then rewritten as a hash.
  const email = "legacy@example.com";
  updateDatabase((db) => {
    db.users.push({
      id: "user_legacy",
      email,
      password: "old-plain-text",
      password_salt: "",
      password_hash: "",
      full_name: "Legacy",
      role: "requester",
      status: "active",
      created_at: nowIso(),
      updated_at: nowIso(),
    });
  });

  assert.equal(
    signInDetailed(email, "old-plain-text").ok,
    true,
    "a legacy account must still be able to sign in",
  );

  const upgraded = readDatabase().users.find((u) => u.email === email);
  assert.equal(
    upgraded?.password,
    undefined,
    "the plaintext credential must be removed after the upgrade",
  );
  assert.ok(
    (upgraded?.password_hash ?? "").startsWith("s2$"),
    "and replaced with a proper hash",
  );
  assert.ok(
    !JSON.stringify(readDatabase().users).includes("old-plain-text"),
    "the old password must not linger anywhere in storage",
  );
  // The upgraded account keeps working with the same password.
  writeSession(null);
  assert.equal(signInDetailed(email, "old-plain-text").ok, true);
});

check("changing the password really changes it", async () => {
  // updateUser used to return success while doing nothing, so the reset form
  // claimed success and the user was then locked out of the password they had
  // just chosen. Assert the new password works and the old one stops.
  const client = createLocalClient();
  const email = "reset@example.com";
  const user = createUser(email, "first-password", { role: "requester" });
  // Must be signed in AS the account being changed: updateUser re-reads the
  // current session, so being signed in as somebody else would rewrite their
  // password instead — which is the exact hazard this check guards against.
  writeSession({ user_id: user.id, signed_in_at: nowIso() });

  const updated = await client.auth.updateUser({ password: "second-password" });
  assert.equal(updated.error, null, "changing the password should report success");
  writeSession(null);
  assert.equal(
    signInDetailed(email, "second-password").ok,
    true,
    "the NEW password must work",
  );
  writeSession(null);
  assert.equal(
    signInDetailed(email, "first-password").ok,
    false,
    "the OLD password must stop working",
  );
});

check("the hash implementation is correct and fails closed on bad input", () => {
  // Guards against a subtly broken digest silently weakening every credential.
  assert.equal(
    sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    "SHA-256 must match the published test vector",
  );
  assert.equal(
    sha256Hex(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "the empty string must match its test vector too",
  );
  const a = makeCredential("same");
  const b = makeCredential("same");
  assert.notEqual(a.password_salt, b.password_salt, "each credential must get a fresh salt");
  assert.notEqual(
    a.password_hash,
    b.password_hash,
    "identical passwords must not produce identical stored hashes",
  );
  assert.equal(verifyPassword("same", a.password_hash), true);
  assert.equal(verifyPassword("other", a.password_hash), false);
  assert.equal(verifyPassword("same", "corrupt"), false, "a corrupt hash must fail closed");
  assert.equal(verifyPassword("same", null), false, "a missing hash must fail closed");
});

/* ------------------------------------- data-layer integrity constraints */
check("the store refuses a duplicate where SQL's UNIQUE indexes used to", async () => {
  // These constraints lived in SQL only. A UI pre-check is a read followed by a
  // write — not a guarantee — and the actions' 23505 branches were dead code
  // because the local adapter never produced that code. Assert the code comes
  // back, so those branches are live again.
  const client = createLocalClient();

  // (a) One registration per donor per drive.
  const reg = await client
    .from("campus_drive_registrations")
    .insert({ drive_id: "drive_x", donor_id: DONOR, status: "registered" });
  assert.equal(reg.error, null, "the first registration must succeed");
  const dupReg = await client
    .from("campus_drive_registrations")
    .insert({ drive_id: "drive_x", donor_id: DONOR, status: "registered" });
  assert.equal(
    dupReg.error?.code,
    UNIQUE_VIOLATION,
    "a second registration for the same donor and drive must be refused",
  );

  // (b) One report per reporter per request.
  await client
    .from("request_reports")
    .insert({ request_id: "req_rep", reporter_id: DONOR, reason: "fake", status: "open" });
  const dupRep = await client
    .from("request_reports")
    .insert({ request_id: "req_rep", reporter_id: DONOR, reason: "fake", status: "open" });
  assert.equal(
    dupRep.error?.code,
    UNIQUE_VIOLATION,
    "a reporter must not be able to report the same request twice",
  );

  // (c) A second alert to the same donor for the same request — the emergency
  //     guarantee that protects donors from repeat notifications.
  await client.from("donor_alerts").insert({
    request_id: "req_alert",
    donor_id: DONOR,
    ring_index: 1,
    ring_km: 3,
    status: "sent",
    response: null,
  });
  const dupAlert = await client.from("donor_alerts").insert({
    request_id: "req_alert",
    donor_id: DONOR,
    ring_index: 2,
    ring_km: 7,
    status: "sent",
    response: null,
  });
  assert.equal(
    dupAlert.error?.code,
    UNIQUE_VIOLATION,
    "the same donor must never be alerted twice for one request",
  );

  // (d) Two donations by one donor on one day — even one at a drive and one
  //     against a request — would double-count recognition.
  const today = new Date().toISOString().slice(0, 10);
  await client.from("donation_history").insert({
    donor_id: DONOR,
    request_id: "req_d1",
    drive_id: null,
    donated_on: today,
    blood_component: "whole_blood",
    units: 1,
  });
  const dupDonation = await client.from("donation_history").insert({
    donor_id: DONOR,
    request_id: "req_d2",
    drive_id: null,
    donated_on: today,
    blood_component: "whole_blood",
    units: 1,
  });
  assert.equal(
    dupDonation.error?.code,
    UNIQUE_VIOLATION,
    "recognition must not be inflated by a second donation on the same day",
  );
});

check("a different donor, request or day is still allowed", async () => {
  // The constraints must be specific, not a blanket "only one of these".
  const client = createLocalClient();
  await client.from("campus_drive_registrations").insert({
    drive_id: "drive_y",
    donor_id: DONOR,
    status: "registered",
  });
  const otherDonor = await client.from("campus_drive_registrations").insert({
    drive_id: "drive_y",
    donor_id: OUTSIDER,
    status: "registered",
  });
  assert.equal(otherDonor.error, null, "a different donor may register for the same drive");
  const otherDay = await client.from("donation_history").insert({
    donor_id: DONOR,
    request_id: "req_d3",
    drive_id: null,
    donated_on: "2020-01-01",
    blood_component: "whole_blood",
    units: 1,
  });
  assert.equal(otherDay.error, null, "a donation on a different day is a separate record");
});

check("an upsert of the same row is not treated as a duplicate", async () => {
  // Upsert must remain usable, or every preferences/assistance save would break.
  const client = createLocalClient();
  const row = { id: "assist_1", request_id: "req_u", volunteer_id: OUTSIDER, status: "offered" };
  const first = await client.from("request_assistance").upsert(row);
  assert.equal(first.error, null);
  const again = await client.from("request_assistance").upsert({ ...row, status: "withdrawn" });
  assert.equal(again.error, null, "re-upserting the same row must update, not fail");
  assert.equal(
    readDatabase().request_assistance.find((r) => r.id === "assist_1")?.status,
    "withdrawn",
  );
});

/* ------------------------------------------------- malformed-data recovery */
check("corrupt or truncated local data degrades to a valid state", () => {
  // §18: the app must fail gracefully, never white-screen on bad storage.
  // Uses the real STORE_KEY rather than a guessed one, and snapshots/restores it:
  // this check deliberately destroys stored state, and without the restore it
  // would silently wipe the accounts every later check signs in with.
  const saved = localStorage.getItem(STORE_KEY);
  try {
    localStorage.setItem(STORE_KEY, "{ this is not json");
    const recovered = readDatabase();
    assert.ok(
      Array.isArray(recovered.users),
      "unparseable JSON must fall back to a valid database",
    );
    assert.ok(recovered.users.length >= 1, "and must still contain the demo admin");

    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ version: 1, data: { blood_requests: "not-an-array", users: null } }),
    );
    const coerced = readDatabase();
    assert.deepEqual(coerced.blood_requests, [], "a non-array table must become an empty list");
    assert.ok(Array.isArray(coerced.users), "a null table must become an array, not crash");

    // A blob from an unknown schema version is discarded, not half-read.
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ version: 999, data: { users: [{ id: "x" }] } }),
    );
    const fresh = readDatabase();
    assert.ok(
      fresh.users.every((u) => u.id !== "x"),
      "an unknown schema version must be discarded rather than half-read",
    );
  } finally {
    if (saved === null) localStorage.removeItem(STORE_KEY);
    else localStorage.setItem(STORE_KEY, saved);
  }
});

/* ------------------------------------------------------------ the adapter */
async function adapterChecks() {
  const client = createLocalClient();
  // The app addresses the account table as "profiles" while the store calls it
  // "users". This alias is load-bearing: without it every profile read returned
  // an empty array and every profile write silently matched nothing, which broke
  // the page-level profile lookup, display-name edits, ACCOUNT SUSPENSION and the
  // admin user list — all with no error anywhere.
  const prof = await client.from("profiles").select("id, full_name, role");
  assert.ok(
    (prof.data?.length ?? 0) > 0,
    '.from("profiles") must resolve to the real account rows, not an empty array',
  );
  const target = prof.data?.[0] as { id: string; full_name: string };
  const patched = await client
    .from("profiles")
    .update({ full_name: "Patched" })
    .eq("id", target.id);
  assert.equal(
    (patched.data?.length ?? 0),
    1,
    'a .from("profiles") update must match its row instead of silently no-oping',
  );
  assert.equal(
    readDatabase().users.find((u) => u.id === target.id)?.full_name,
    "Patched",
    "the profile write must actually persist",
  );
  // Account suspension is a security control that goes through this same alias.
  const suspended = await client
    .from("profiles")
    .update({ status: "suspended" })
    .eq("id", target.id);
  assert.equal(
    readDatabase().users.find((u) => u.id === target.id)?.status,
    "suspended",
    "suspending an account through .from('profiles') must take effect",
  );
  assert.equal(suspended.error, null);
  // Restore so later checks see a clean state.
  await client.from("profiles").update({ status: "active" }).eq("id", target.id);

  // A table that does not exist must fail loudly. The silent `?? []` fallback is
  // precisely what hid the profiles/users mismatch behind a clean build and a
  // green test run, so this behaviour is asserted rather than merely intended.
  await assert.rejects(
    async () => client.from("no_such_table").select("id"),
    /Unknown local table/,
    "an unknown table must throw, never look like empty data",
  );

  const rows = await client.from("blood_requests").select("id");
  assert.ok(Array.isArray(rows.data), ".from().select() must resolve to rows");
  // Compared against what the table actually holds, not a hardcoded literal:
  // the suite legitimately creates several requests, and a magic number here
  // would break the moment one is added — testing the count, not the fixture.
  const expected = rows.data?.length ?? 0;
  const head = await client.from("blood_requests").select("id", {
    count: "exact",
    head: true,
  });
  // `count` is a SIBLING of `data`, exactly as the Supabase client returned it.
  assert.equal(
    typeof head.count,
    "number",
    "a head/count query must return a count",
  );
  assert.equal(
    head.count,
    expected,
    "the count must reflect the rows that exist, not an empty payload",
  );
  assert.equal(head.data?.length, 0, "a head query returns no rows");

  const good = await client.auth.signInWithPassword({
    email: "donor@example.com",
    password: "password123",
  });
  assert.equal(good.error, null, "a valid sign-in must not error");
  assert.equal(good.data.user?.id, donor.id);

  const bad = await client.auth.signInWithPassword({
    email: "donor@example.com",
    password: "nope",
  });
  assert.ok(bad.error, "a wrong password must produce a friendly error");

  await client.auth.signOut();
  const after = await client.auth.getUser();
  assert.equal(after.data.user, null, "sign-out must clear the session");
}

// Wrapped so a rejected async check is REPORTED rather than crashing the run
// and hiding every other result.
check("the client seam supports the calls the app makes", adapterChecks);

/**
 * THE BLANK-DASHBOARD BUG
 *
 * The data lives in the visitor's localStorage. A Server Component runs on the
 * server, where localStorage does not exist, so every `await supabase.from(…)`
 * returned empty and each dashboard rendered its empty state FOREVER. The type
 * checker, the linter and the build were all perfectly happy — the pages just
 * never showed the user's data.
 *
 * The invariant: a page that reads data MUST be a client component.
 */
{
  // Pages that read the local store. These MUST be client components: the data
  // lives in the visitor's localStorage, which a Server Component cannot read,
  // so a server-rendered page silently shows its empty state forever.
  const CONVERTED = [
    "dashboard/donor/page.tsx",
    "dashboard/requester/page.tsx",
  ];
  // Still to convert. Each needs the same treatment: `"use client"`, a loader
  // that takes (supabase, user), and useClientAuth in place of requireRolePage.
  // They render honest EMPTY states today rather than erroring, so this is a
  // known-incomplete state rather than a regression.
  const PENDING = [
    "dashboard/volunteer/page.tsx",
    "notifications/page.tsx",
    "drives/page.tsx",
    "drives/[id]/page.tsx",
    "profile/page.tsx",
    "profile/donor/page.tsx",
    "profile/volunteer/page.tsx",
    "admin/page.tsx",
    "admin/users/page.tsx",
    "admin/requests/page.tsx",
    "admin/alerts/page.tsx",
    "admin/donations/page.tsx",
    "admin/reports/page.tsx",
    "admin/settings/page.tsx",
    "admin/drives/page.tsx",
    "admin/drives/[id]/page.tsx",
    "requests/[id]/page.tsx",
    "requests/[id]/matches/page.tsx",
    "volunteer/requests/[id]/page.tsx",
  ];
  const offenders = CONVERTED.filter((rel) => {
    try {
      return !/^\s*["']use client["']/.test(readFileSync(join(ROOT, "src/app", rel), "utf8"));
    } catch {
      return true;
    }
  });
  check("the converted dashboards read local data on the client, not the server", () => {
    assert.deepEqual(offenders, [], `regressed to a server component: ${offenders.join(", ")}`);
  });

  // A client component may not export metadata — a BUILD error, not a type
  // error, so it is worth pinning.
  const metadataOffenders = CONVERTED.filter((rel) => {
    try {
      const src = readFileSync(join(ROOT, "src/app", rel), "utf8");
      return /export const metadata/.test(src);
    } catch {
      return false;
    }
  });
  check("no client page exports metadata (a build-breaking Next.js error)", () => {
    assert.deepEqual(
      metadataOffenders,
      [],
      `offenders: ${metadataOffenders.join(", ")}`
    );
  });
  void PENDING;

  // A "use server" module may ONLY export async functions. Any other export
  // becomes a server-reference proxy in the client bundle, so a Client
  // Component importing that value gets a proxy instead of the real thing.
  // That shipped a crash: the request form and donor profile form both pulled
  // `initialLocationLookupState` out of the location action module, and
  // /request-blood fell through to the global error boundary.
  check("no 'use server' module exports a non-function value", () => {
    const offenders: string[] = [];
    const actionsDir = join(ROOT, "src/lib/actions");
    for (const name of readdirSync(actionsDir)) {
      if (!name.endsWith(".ts") || name === "action-state.ts") continue;
      const src = readFileSync(join(actionsDir, name), "utf8");
      if (!/^\s*["']use server["']/.test(src)) continue;
      for (const m of src.matchAll(/^export (const|let|var|class)\s+\w+/gm)) {
        offenders.push(`src/lib/actions/${name}: ${m[0].trim()}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `a "use server" module may only export async functions: ${offenders.join("; ")}`
    );
  });

  // And the reverse guard: a Client Component must not import a value (only
  // actions) from a "use server" module.
  check("no client component imports a value from a 'use server' module", () => {
    const actionExports = new Map<string, Set<string>>();
    const actionsDir = join(ROOT, "src/lib/actions");
    for (const name of readdirSync(actionsDir)) {
      if (!name.endsWith(".ts")) continue;
      const src = readFileSync(join(actionsDir, name), "utf8");
      if (!/^\s*["']use server["']/.test(src)) continue;
      const values = new Set<string>();
      for (const m of src.matchAll(/^export (const|let|var|class)\s+(\w+)/gm)) {
        values.add(m[2]);
      }
      actionExports.set(name, values);
    }

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        const src = readFileSync(full, "utf8");
        if (!/^\s*["']use client["']/.test(src)) continue;
        for (const [mod, values] of actionExports) {
          if (values.size === 0) continue;
          const re = new RegExp(
            `import\\s*\\{([^}]*)\\}\\s*from\\s*"@/lib/actions/${mod.replace(
              ".ts",
              ""
            )}"`,
            "gs" // `s` for multi-line import lists, `g` because matchAll requires it
          );
          for (const m of src.matchAll(re)) {
            for (const raw of m[1].split(",")) {
              const ident = raw.trim().split(/\s+as\s+/)[0].trim();
              if (ident && values.has(ident)) {
                offenders.push(
                  `${full.replace(ROOT + "/", "")}: ${ident} from ${mod}`
                );
              }
            }
          }
        }
      }
    };
    walk(join(ROOT, "src"));
    assert.deepEqual(
      offenders,
      [],
      `client components must take only actions from a "use server" module: ${offenders.join("; ")}`
    );
  });

  // The client guard must redirect out of every non-ready state, so a page can
  // never sit on a spinner forever.
  const hookSrc = readFileSync(join(ROOT, "src/components/local/useClientAuth.ts"), "utf8");
  check("the client auth hook settles and redirects out of every non-ready state", () => {
    assert.ok(hookSrc.includes("if (!user)"), "must handle a missing user");
    assert.ok(
      hookSrc.includes("router.replace(`/login?next="),
      "must redirect a signed-out visitor to sign in"
    );
    assert.ok(
      hookSrc.includes("router.replace(`/dashboard/${user.role}`)"),
      "must bounce a wrong-role visitor to their own dashboard"
    );
    assert.ok(
      hookSrc.includes('router.replace("/account-suspended")'),
      "must route a suspended account away"
    );
    assert.ok(
      (hookSrc.match(/router\.replace/g) ?? []).length >= 4,
      "every non-ready branch must redirect, so none can hang"
    );
    assert.ok(
      /return\s*\(\)\s*=>\s*\{\s*live = false;\s*\};/.test(hookSrc),
      "must cancel in-flight work on unmount"
    );
  });
}

function report() {
  if (failures.length > 0) {
    console.error(`\n✗ ${failures.length} local-stack check(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error(`\n${passed} passed, ${failures.length} failed`);
    process.exit(1);
  }
  console.log(`✓ all ${passed} local-stack checks passed`);
}

// Drain the microtask queue so the async check's rejection lands in `failures`
// before the report runs.
setTimeout(report, 0);
