// ===========================================================================
// Config — normalize Worker env (vars + secrets) into one typed object with
// safe defaults, so tests and `wrangler dev` work without a full secret set.
// ===========================================================================

export function getConfig(env = {}) {
  const num = (v, d) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  const str = (v, d) => (v == null || v === "" ? d : String(v));

  const allowedOrigin = str(env.ALLOWED_ORIGIN, "https://otakar.dev");
  const holidays = new Set(
    str(env.HOLIDAYS, "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );

  return {
    // Availability
    tz: str(env.BUSINESS_TZ, "America/Los_Angeles"),
    businessStart: str(env.BUSINESS_START, "10:00"),
    businessEnd: str(env.BUSINESS_END, "15:00"),
    slotMinutes: num(env.SLOT_MINUTES, 30),
    bufferMinutes: num(env.BUFFER_MINUTES, 15),
    meetingMinutes: num(env.MEETING_MINUTES, 30),
    noticeHours: num(env.NOTICE_HOURS, 24),
    horizonDays: num(env.HORIZON_DAYS, 45),
    holidays,

    // Origins / links
    allowedOrigin,
    siteOrigin: str(env.SITE_ORIGIN, allowedOrigin),
    meetingUrl: str(env.MEETING_URL, "https://example.com/meeting-link-not-set"),

    // Email (Resend)
    resendApiKey: str(env.RESEND_API_KEY, ""),
    resendFrom: str(env.RESEND_FROM, "OJA Solutions <hello@otakar.dev>"),
    ownerEmail: str(env.OWNER_EMAIL, "hello@otakar.dev"),
    inquiryExpiryDays: num(env.INQUIRY_EXPIRY_DAYS, 180),

    // Anti-abuse
    turnstileSecret: str(env.TURNSTILE_SECRET, ""),
    mgmtTokenSalt: str(env.MGMT_TOKEN_SALT, "dev-insecure-salt-change-me"),
    rateMax: num(env.RATE_MAX, 8),
    rateWindowSeconds: num(env.RATE_WINDOW_SECONDS, 3600),
  };
}
