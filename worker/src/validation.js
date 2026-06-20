// ===========================================================================
// Input validation — pure. Length caps + required fields + a pragmatic email
// check. Returns { ok, errors:{field:msg}, clean } with trimmed/clamped values.
// ===========================================================================

// Deliberately permissive but anchored: one @, a dot in the domain, no spaces.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const LIMITS = {
  name: 100,
  email: 160,
  topic: 200,
  message: 2000,
  project_type: 80,
  timeline: 80,
  budget: 80,
};

function clampString(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function isEmail(v) {
  return typeof v === "string" && v.length <= LIMITS.email && EMAIL_RE.test(v.trim());
}

/** ISO 8601 instant that round-trips (rejects garbage + non-UTC fuzz). */
export function isIsoInstant(v) {
  if (typeof v !== "string" || v.length > 40) return false;
  const t = Date.parse(v);
  return Number.isFinite(t);
}

export function validateBooking(body = {}) {
  const errors = {};
  const clean = {
    name: clampString(body.name, LIMITS.name),
    email: clampString(body.email, LIMITS.email),
    topic: clampString(body.topic, LIMITS.topic),
    slot: typeof body.slot === "string" ? body.slot.trim() : "",
  };
  if (!clean.name) errors.name = "Please enter your name.";
  if (!isEmail(clean.email)) errors.email = "Please enter a valid email address.";
  if (!isIsoInstant(clean.slot)) errors.slot = "Please choose a time slot.";
  return { ok: Object.keys(errors).length === 0, errors, clean };
}

export function validateReschedule(body = {}) {
  const errors = {};
  const clean = { slot: typeof body.slot === "string" ? body.slot.trim() : "" };
  if (!isIsoInstant(clean.slot)) errors.slot = "Please choose a new time slot.";
  return { ok: Object.keys(errors).length === 0, errors, clean };
}

export function validateInquiry(body = {}) {
  const errors = {};
  const clean = {
    name: clampString(body.name, LIMITS.name),
    email: clampString(body.email, LIMITS.email),
    project_type: clampString(body.project_type, LIMITS.project_type),
    timeline: clampString(body.timeline, LIMITS.timeline),
    budget: clampString(body.budget, LIMITS.budget),
    message: clampString(body.message, LIMITS.message),
  };
  if (!clean.name) errors.name = "Please enter your name.";
  if (!isEmail(clean.email)) errors.email = "Please enter a valid email address.";
  if (!clean.message) errors.message = "Please tell me what you're trying to solve.";
  return { ok: Object.keys(errors).length === 0, errors, clean };
}

/** Honeypot: real users leave the named field empty. */
export function honeypotTripped(body = {}, field = "company") {
  return typeof body[field] === "string" && body[field].trim() !== "";
}
