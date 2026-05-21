/**
 * Registration validation (mirrors frontend/src/utils/registerValidation.js).
 * Set REGISTRATION_EMAIL_DOMAIN=* to allow any valid email domain (dev only).
 * Default email domain: gmail.com
 */
const DEFAULT_EMAIL_DOMAIN = "gmail.com";

const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function registrationEmailDomainFromEnv() {
  const raw = (process.env.REGISTRATION_EMAIL_DOMAIN ?? DEFAULT_EMAIL_DOMAIN).trim();
  if (!raw || raw === "*") return "";
  return raw.toLowerCase();
}

export function normalizeRegistrationEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

export function passwordRequirementStatus(password) {
  const pw = String(password ?? "");
  return [
    { key: "len", label: "At least 10 characters", ok: pw.length >= 10 },
    { key: "lower", label: "One lowercase letter (a–z)", ok: /[a-z]/.test(pw) },
    { key: "upper", label: "One uppercase letter (A–Z)", ok: /[A-Z]/.test(pw) },
    { key: "digit", label: "One number", ok: /\d/.test(pw) },
    {
      key: "special",
      label: "One symbol (!@#$%^&*…)",
      ok: /[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/.test(pw)
    }
  ];
}

export function validateRegisterForm(fields, emailDomain = registrationEmailDomainFromEnv()) {
  const name = String(fields.name ?? "").trim();
  const course = String(fields.course ?? "").trim();
  const email = normalizeRegistrationEmail(fields.email);
  const password = String(fields.password ?? "");

  /** @type {Record<string, string>} */
  const fieldErrors = {};

  if (name.length < 2) fieldErrors.name = "Enter your full name (at least 2 characters).";
  if (name.length > 120) fieldErrors.name = "Name is too long.";

  if (course.length > 80) fieldErrors.course = "Course name is too long.";

  if (!email) fieldErrors.email = "Enter your Gmail address.";
  else if (!EMAIL_FORMAT.test(email)) fieldErrors.email = "Use a valid email format (e.g. name@gmail.com).";
  else if (emailDomain) {
    const host = email.split("@")[1] || "";
    if (host !== emailDomain) {
      fieldErrors.email = `Use an email address ending in @${emailDomain}.`;
    }
  }

  if (!password) fieldErrors.password = "Choose a password.";
  else {
    const reqs = passwordRequirementStatus(password);
    const failed = reqs.filter((r) => !r.ok);
    if (failed.length) {
      fieldErrors.password = `Stronger password needed: ${failed.map((f) => f.label.toLowerCase()).join(", ")}.`;
    }
  }

  return {
    ok: Object.keys(fieldErrors).length === 0,
    fieldErrors,
    normalized: { name, course, email, password }
  };
}
