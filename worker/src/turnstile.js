// ===========================================================================
// Cloudflare Turnstile — server-side verification of the client token.
// If no secret is configured (local dev), verification is skipped (returns ok)
// so the flow is testable without keys. In production the secret is always set.
// ===========================================================================

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(token, secret, remoteIp) {
  if (!secret) return { ok: true, skipped: true }; // dev: no key configured
  if (!token) return { ok: false, skipped: false, error: "missing-token" };

  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (remoteIp) form.append("remoteip", remoteIp);

  try {
    const res = await fetch(VERIFY_URL, { method: "POST", body: form });
    const data = await res.json();
    return { ok: !!data.success, skipped: false, error: data["error-codes"]?.join(",") };
  } catch (err) {
    return { ok: false, skipped: false, error: String(err) };
  }
}
