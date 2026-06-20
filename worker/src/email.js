// ===========================================================================
// Email — durable outbox + Resend delivery + message templates.
// Flow: handlers enqueue rows into email_outbox, then the request opportunist-
// ically flushes via ctx.waitUntil(); the cron retries anything still pending.
// Failures never block the API response or lose the message.
// ===========================================================================
import { newId } from "./tokens.js";
import { buildICS, toBase64 } from "./ics.js";

const MAX_ATTEMPTS = 6;
const BACKOFF_MIN = [1, 5, 15, 60, 180, 720]; // minutes per attempt

/** Human-readable slot, e.g. "Thursday, June 25, 2026 at 10:00 AM PDT". */
export function formatSlot(cfg, startUTC) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: cfg.tz,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(startUTC);
}

function wrapHtml(bodyHtml) {
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#171D21;line-height:1.55;max-width:560px;margin:auto;padding:8px">
${bodyHtml}
<hr style="border:none;border-top:1px solid #E8EBED;margin:24px 0">
<p style="color:#6E7C85;font-size:13px">OJA Solutions · AI engineering &amp; workflow automation</p>
</body></html>`;
}

// --- Templates -------------------------------------------------------------

export function bookingVisitorMessage(cfg, booking, manageUrl) {
  const when = formatSlot(cfg, new Date(booking.slot_start_utc));
  const ics = buildICS({
    uid: `${booking.id}@otakar.dev`,
    start: new Date(booking.slot_start_utc),
    end: new Date(booking.slot_end_utc),
    summary: "Discovery call — OJA Solutions",
    description: `30-minute discovery call with Otakar Andrysek.\nJoin: ${cfg.meetingUrl}\nManage: ${manageUrl}`,
    location: cfg.meetingUrl,
    organizerEmail: cfg.ownerEmail,
    organizerName: "Otakar Andrysek",
    attendeeEmail: booking.email,
    attendeeName: booking.name,
  });
  return {
    to: booking.email,
    subject: "Your discovery call is booked — OJA Solutions",
    text: [
      `Hi ${booking.name},`,
      ``,
      `Your 30-minute discovery call is confirmed for:`,
      `  ${when}`,
      ``,
      `Join link: ${cfg.meetingUrl}`,
      booking.topic ? `What you'd like to cover: ${booking.topic}` : ``,
      ``,
      `Need to change it? Reschedule or cancel here:`,
      `  ${manageUrl}`,
      ``,
      `Talk soon,`,
      `Otakar — OJA Solutions`,
    ]
      .filter((l) => l !== null)
      .join("\n"),
    html: wrapHtml(
      `<h2 style="margin:0 0 12px">Your discovery call is booked</h2>
<p>Hi ${esc(booking.name)},</p>
<p>Your 30-minute discovery call is confirmed for:</p>
<p style="font-size:17px;font-weight:600">${esc(when)}</p>
<p><a href="${esc(cfg.meetingUrl)}" style="color:#157F4B">Join link</a></p>
${booking.topic ? `<p style="color:#586771">What you'd like to cover: ${esc(booking.topic)}</p>` : ""}
<p>Need to change it? <a href="${esc(manageUrl)}" style="color:#157F4B">Reschedule or cancel</a>.</p>
<p>Talk soon,<br>Otakar</p>`
    ),
    icsFilename: "discovery-call.ics",
    icsContent: ics,
  };
}

export function bookingOwnerMessage(cfg, booking) {
  const when = formatSlot(cfg, new Date(booking.slot_start_utc));
  return {
    to: cfg.ownerEmail,
    subject: `New booking: ${booking.name} — ${when}`,
    text: [
      `New discovery call booked.`,
      ``,
      `When:  ${when}`,
      `Name:  ${booking.name}`,
      `Email: ${booking.email}`,
      booking.topic ? `Topic: ${booking.topic}` : ``,
    ]
      .filter(Boolean)
      .join("\n"),
    html: wrapHtml(
      `<h2 style="margin:0 0 12px">New discovery call booked</h2>
<p><strong>When:</strong> ${esc(when)}<br>
<strong>Name:</strong> ${esc(booking.name)}<br>
<strong>Email:</strong> <a href="mailto:${esc(booking.email)}">${esc(booking.email)}</a>
${booking.topic ? `<br><strong>Topic:</strong> ${esc(booking.topic)}` : ""}</p>`
    ),
  };
}

export function cancelVisitorMessage(cfg, booking) {
  const when = formatSlot(cfg, new Date(booking.slot_start_utc));
  return {
    to: booking.email,
    subject: "Your discovery call is canceled — OJA Solutions",
    text: `Hi ${booking.name},\n\nYour discovery call for ${when} has been canceled. ` +
      `Want to pick a new time? ${cfg.siteOrigin}/#book\n\nOtakar — OJA Solutions`,
    html: wrapHtml(
      `<h2 style="margin:0 0 12px">Your call is canceled</h2>
<p>Hi ${esc(booking.name)},</p>
<p>Your discovery call for <strong>${esc(when)}</strong> has been canceled.</p>
<p>Want to pick a new time? <a href="${esc(cfg.siteOrigin)}/#book" style="color:#157F4B">Book again</a>.</p>`
    ),
  };
}

export function cancelOwnerMessage(cfg, booking) {
  const when = formatSlot(cfg, new Date(booking.slot_start_utc));
  return {
    to: cfg.ownerEmail,
    subject: `Canceled: ${booking.name} — ${when}`,
    text: `Booking canceled.\n\nWhen: ${when}\nName: ${booking.name}\nEmail: ${booking.email}`,
    html: wrapHtml(
      `<h2 style="margin:0 0 12px">Booking canceled</h2>
<p><strong>When:</strong> ${esc(when)}<br><strong>Name:</strong> ${esc(booking.name)}<br>
<strong>Email:</strong> ${esc(booking.email)}</p>`
    ),
  };
}

export function rescheduleVisitorMessage(cfg, booking, prevStartUtc, manageUrl) {
  const when = formatSlot(cfg, new Date(booking.slot_start_utc));
  const prev = formatSlot(cfg, new Date(prevStartUtc));
  const ics = buildICS({
    uid: `${booking.id}@otakar.dev`,
    sequence: 1,
    start: new Date(booking.slot_start_utc),
    end: new Date(booking.slot_end_utc),
    summary: "Discovery call — OJA Solutions",
    description: `Rescheduled 30-minute discovery call.\nJoin: ${cfg.meetingUrl}\nManage: ${manageUrl}`,
    location: cfg.meetingUrl,
    organizerEmail: cfg.ownerEmail,
    organizerName: "Otakar Andrysek",
    attendeeEmail: booking.email,
    attendeeName: booking.name,
  });
  return {
    to: booking.email,
    subject: "Your discovery call was rescheduled — OJA Solutions",
    text: `Hi ${booking.name},\n\nYour discovery call has moved.\n\nWas:  ${prev}\nNow:  ${when}\n\n` +
      `Join link: ${cfg.meetingUrl}\nManage: ${manageUrl}\n\nOtakar — OJA Solutions`,
    html: wrapHtml(
      `<h2 style="margin:0 0 12px">Your call was rescheduled</h2>
<p>Hi ${esc(booking.name)},</p>
<p><strong>Was:</strong> <s style="color:#909AA1">${esc(prev)}</s><br>
<strong>Now:</strong> ${esc(when)}</p>
<p><a href="${esc(cfg.meetingUrl)}" style="color:#157F4B">Join link</a> · <a href="${esc(manageUrl)}" style="color:#157F4B">Manage</a></p>`
    ),
    icsFilename: "discovery-call.ics",
    icsContent: ics,
  };
}

export function rescheduleOwnerMessage(cfg, booking, prevStartUtc) {
  const when = formatSlot(cfg, new Date(booking.slot_start_utc));
  const prev = formatSlot(cfg, new Date(prevStartUtc));
  return {
    to: cfg.ownerEmail,
    subject: `Rescheduled: ${booking.name} — ${when}`,
    text: `Booking rescheduled.\n\nWas: ${prev}\nNow: ${when}\nName: ${booking.name}\nEmail: ${booking.email}`,
    html: wrapHtml(
      `<h2 style="margin:0 0 12px">Booking rescheduled</h2>
<p><strong>Was:</strong> ${esc(prev)}<br><strong>Now:</strong> ${esc(when)}<br>
<strong>Name:</strong> ${esc(booking.name)}<br><strong>Email:</strong> ${esc(booking.email)}</p>`
    ),
  };
}

export function inquiryOwnerMessage(cfg, inquiry) {
  return {
    to: cfg.ownerEmail,
    subject: `New inquiry: ${inquiry.name}${inquiry.project_type ? ` — ${inquiry.project_type}` : ""}`,
    text: [
      `New project inquiry.`,
      ``,
      `Name:     ${inquiry.name}`,
      `Email:    ${inquiry.email}`,
      inquiry.project_type ? `Type:     ${inquiry.project_type}` : ``,
      inquiry.timeline ? `Timeline: ${inquiry.timeline}` : ``,
      inquiry.budget ? `Budget:   ${inquiry.budget}` : ``,
      ``,
      `Message:`,
      inquiry.message,
    ]
      .filter(Boolean)
      .join("\n"),
    html: wrapHtml(
      `<h2 style="margin:0 0 12px">New project inquiry</h2>
<p><strong>Name:</strong> ${esc(inquiry.name)}<br>
<strong>Email:</strong> <a href="mailto:${esc(inquiry.email)}">${esc(inquiry.email)}</a>
${inquiry.project_type ? `<br><strong>Type:</strong> ${esc(inquiry.project_type)}` : ""}
${inquiry.timeline ? `<br><strong>Timeline:</strong> ${esc(inquiry.timeline)}` : ""}
${inquiry.budget ? `<br><strong>Budget:</strong> ${esc(inquiry.budget)}` : ""}</p>
<p style="white-space:pre-wrap;background:#F7F4EE;border:1px solid #E8EBED;border-radius:8px;padding:12px">${esc(inquiry.message)}</p>`
    ),
  };
}

export function inquiryAutoReply(cfg, inquiry) {
  return {
    to: inquiry.email,
    subject: "Thanks — I got your message (OJA Solutions)",
    text: `Hi ${inquiry.name},\n\nThanks for reaching out. I've got your note and will reply personally, ` +
      `usually within a business day.\n\nIf it's time-sensitive, you can also book a call: ${cfg.siteOrigin}/#book\n\n` +
      `Otakar — OJA Solutions`,
    html: wrapHtml(
      `<h2 style="margin:0 0 12px">Thanks — I got your message</h2>
<p>Hi ${esc(inquiry.name)},</p>
<p>Thanks for reaching out. I'll reply personally, usually within a business day.</p>
<p>If it's time-sensitive, you can also <a href="${esc(cfg.siteOrigin)}/#book" style="color:#157F4B">book a call</a>.</p>
<p>Otakar</p>`
    ),
  };
}

// --- Outbox ----------------------------------------------------------------

export async function enqueueEmail(db, msg, now = Date.now()) {
  const attachments = msg.icsContent
    ? [{ filename: msg.icsFilename || "event.ics", content: toBase64(msg.icsContent) }]
    : [];
  const payload = JSON.stringify({ text: msg.text || "", html: msg.html || "", attachments });
  await db
    .prepare(
      `INSERT INTO email_outbox (id, to_addr, subject, payload_json, attempts, next_retry_at, status, created_at)
       VALUES (?, ?, ?, ?, 0, ?, 'pending', ?)`
    )
    .bind(newId(), msg.to, msg.subject, payload, new Date(now).toISOString(), new Date(now).toISOString())
    .run();
}

async function sendViaResend(cfg, row) {
  if (!cfg.resendApiKey) {
    return { ok: false, error: "RESEND_API_KEY not set (dev) — left pending" };
  }
  const payload = JSON.parse(row.payload_json);
  const body = {
    from: cfg.resendFrom,
    to: [row.to_addr],
    subject: row.subject,
    text: payload.text,
    html: payload.html,
  };
  if (payload.attachments?.length) {
    body.attachments = payload.attachments.map((a) => ({
      filename: a.filename,
      content: a.content, // base64
    }));
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const detail = await res.text();
    return { ok: false, error: `Resend ${res.status}: ${detail.slice(0, 300)}` };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Attempt delivery of due pending messages. Returns {sent, failed, pending}. */
export async function flushOutbox(db, cfg, { limit = 20, now = Date.now() } = {}) {
  const due = await db
    .prepare(
      `SELECT * FROM email_outbox WHERE status = 'pending' AND next_retry_at <= ?
       ORDER BY next_retry_at ASC LIMIT ?`
    )
    .bind(new Date(now).toISOString(), limit)
    .all();

  let sent = 0,
    failed = 0,
    pending = 0;

  for (const row of due.results || []) {
    const result = await sendViaResend(cfg, row);
    if (result.ok) {
      await db.prepare(`UPDATE email_outbox SET status='sent', last_error=NULL WHERE id=?`).bind(row.id).run();
      sent++;
      continue;
    }
    const attempts = row.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await db
        .prepare(`UPDATE email_outbox SET status='failed', attempts=?, last_error=? WHERE id=?`)
        .bind(attempts, result.error, row.id)
        .run();
      failed++;
    } else {
      const backoffMin = BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)];
      const nextRetry = new Date(now + backoffMin * 60000).toISOString();
      await db
        .prepare(`UPDATE email_outbox SET attempts=?, next_retry_at=?, last_error=? WHERE id=?`)
        .bind(attempts, nextRetry, result.error, row.id)
        .run();
      pending++;
    }
  }
  return { sent, failed, pending, processed: (due.results || []).length };
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
