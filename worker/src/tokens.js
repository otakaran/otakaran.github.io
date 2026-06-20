// ===========================================================================
// Management tokens — generate a high-entropy raw token (only ever placed in
// the visitor's email + the just-booked success response) and store only its
// salted SHA-256 hash. Lookups hash the incoming token and match the column.
// ===========================================================================

const B64URL = (bytes) => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** 32 random bytes → URL-safe base64 (~43 chars). */
export function newToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return B64URL(bytes);
}

/** Salted SHA-256 of a raw token → lowercase hex. Stable for a given salt. */
export async function hashToken(raw, salt) {
  const data = new TextEncoder().encode(`${salt}:${raw}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Short opaque id for table primary keys. */
export function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return B64URL(bytes);
}
