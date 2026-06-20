// ===========================================================================
// OJA booking/contact API — Cloudflare Worker entrypoint (router + cron).
//   GET  /availability?from&to
//   POST /bookings
//   GET  /bookings/:token                 (manage-page lookup)
//   POST /bookings/:token/reschedule
//   POST /bookings/:token/cancel
//   POST /inquiries
//   scheduled() -> outbox retry + record expiry
// Cross-cutting concerns (CORS, origin allow-list, rate limit, Turnstile,
// honeypot, JSON parsing, email flush, error shaping) live here; the handler
// modules stay pure-ish and return { status, body }.
// ===========================================================================
import { getConfig } from "./config.js";
import { json, preflight, originAllowed } from "./http.js";
import { rateLimit } from "./ratelimit.js";
import { verifyTurnstile } from "./turnstile.js";
import { honeypotTripped } from "./validation.js";
import * as booking from "./booking.js";
import { createInquiry } from "./inquiries.js";
import { flushOutbox } from "./email.js";
import { handleScheduled } from "./cron.js";

export default {
  async fetch(request, env, ctx) {
    const cfg = getConfig(env);
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const method = request.method;
    const reply = (data, status = 200, headers) =>
      json(data, { status, origin, allowedOrigin: cfg.allowedOrigin, headers });

    if (method === "OPTIONS") return preflight(origin, cfg.allowedOrigin);

    if (url.pathname === "/" || url.pathname === "/health") {
      return reply({ ok: true, service: "oja-api" });
    }

    if (!originAllowed(origin, cfg.allowedOrigin)) {
      return reply({ error: "forbidden-origin" }, 403);
    }

    const ip =
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("x-forwarded-for") ||
      "0.0.0.0";

    try {
      // ---- GET /availability ----
      if (url.pathname === "/availability" && method === "GET") {
        const now = new Date();
        const fromParam = url.searchParams.get("from");
        const toParam = url.searchParams.get("to");
        const from = fromParam ? new Date(fromParam) : now;
        const to = toParam ? new Date(toParam) : new Date(now.getTime() + cfg.horizonDays * 86400000);
        if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
          return reply({ error: "bad-range" }, 400);
        }
        const res = await booking.getAvailability(env.DB, cfg, { from, to, now });
        return reply(res.body, res.status);
      }

      // ---- GET /bookings/:token (manage lookup) ----
      const getTokenMatch = url.pathname.match(/^\/bookings\/([^/]+)$/);
      if (getTokenMatch && method === "GET") {
        const res = await booking.getBooking(env.DB, cfg, decodeURIComponent(getTokenMatch[1]));
        return reply(res.body, res.status);
      }

      // ---- POST endpoints (rate-limited) ----
      if (method === "POST") {
        const rl = await rateLimit(env.DB, `${ip}:${url.pathname}`, {
          max: cfg.rateMax,
          windowSeconds: cfg.rateWindowSeconds,
        });
        if (!rl.allowed) {
          return reply(
            { error: "rate-limited", message: "Too many requests — please try again later." },
            429,
            { "Retry-After": String(rl.retryAfter) }
          );
        }

        const body = await readJson(request);
        if (body === null) return reply({ error: "bad-json" }, 400);

        // POST /bookings
        if (url.pathname === "/bookings") {
          if (honeypotTripped(body)) return reply({ ok: true }, 201); // swallow bots quietly
          const ts = await verifyTurnstile(body.turnstile_token, cfg.turnstileSecret, ip);
          if (!ts.ok) return reply({ error: "captcha", message: "Verification failed — please try again." }, 400);
          const res = await booking.createBooking(env.DB, cfg, body);
          ctx.waitUntil(flushOutbox(env.DB, cfg));
          return reply(res.body, res.status);
        }

        // POST /inquiries
        if (url.pathname === "/inquiries") {
          if (honeypotTripped(body)) return reply({ ok: true }, 201);
          const ts = await verifyTurnstile(body.turnstile_token, cfg.turnstileSecret, ip);
          if (!ts.ok) return reply({ error: "captcha", message: "Verification failed — please try again." }, 400);
          const res = await createInquiry(env.DB, cfg, body);
          ctx.waitUntil(flushOutbox(env.DB, cfg));
          return reply(res.body, res.status);
        }

        // POST /bookings/:token/reschedule | /cancel
        const actionMatch = url.pathname.match(/^\/bookings\/([^/]+)\/(reschedule|cancel)$/);
        if (actionMatch) {
          const token = decodeURIComponent(actionMatch[1]);
          const res =
            actionMatch[2] === "reschedule"
              ? await booking.rescheduleBooking(env.DB, cfg, token, body)
              : await booking.cancelBooking(env.DB, cfg, token);
          ctx.waitUntil(flushOutbox(env.DB, cfg));
          return reply(res.body, res.status);
        }
      }

      return reply({ error: "not-found" }, 404);
    } catch (err) {
      console.error("API error:", err && err.stack ? err.stack : err);
      return reply({ error: "server-error", message: "Something went wrong. Please try again." }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduled(env));
  },
};

async function readJson(request) {
  try {
    const text = await request.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return null;
  }
}
