// ===========================================================================
// HTTP helpers — CORS (origin allow-list) + JSON responses. Pure-ish.
// ===========================================================================

export function corsHeaders(requestOrigin, allowedOrigin) {
  const headers = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
  // Echo the origin only when it matches the allow-list (supports "*" for dev).
  if (allowedOrigin === "*") {
    headers["Access-Control-Allow-Origin"] = "*";
  } else if (requestOrigin && requestOrigin === allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = requestOrigin;
  }
  return headers;
}

export function json(data, { status = 200, origin, allowedOrigin, headers = {} } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(origin, allowedOrigin),
      ...headers,
    },
  });
}

export function preflight(origin, allowedOrigin) {
  return new Response(null, { status: 204, headers: corsHeaders(origin, allowedOrigin) });
}

/**
 * True when the request origin is allowed to call the API.
 * A missing Origin (non-browser client / curl) is allowed — CSRF isn't a
 * concern here (no cookies/sessions) and Turnstile + rate-limit + honeypot are
 * the real guards. A *present but mismatched* browser origin is rejected, and
 * such requests also never receive an Access-Control-Allow-Origin header.
 */
export function originAllowed(requestOrigin, allowedOrigin) {
  if (allowedOrigin === "*") return true;
  if (!requestOrigin) return true;
  return requestOrigin === allowedOrigin;
}
