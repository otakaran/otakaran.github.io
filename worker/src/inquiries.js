// ===========================================================================
// Inquiry handler — store the message, notify the owner, auto-reply to sender.
// Records expire (status='expired') after cfg.inquiryExpiryDays via cron.
// ===========================================================================
import { newId } from "./tokens.js";
import { validateInquiry } from "./validation.js";
import * as email from "./email.js";

export async function createInquiry(db, cfg, body, now = new Date()) {
  const v = validateInquiry(body);
  if (!v.ok) return { status: 400, body: { error: "validation", fields: v.errors } };
  const c = v.clean;

  const id = newId();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + cfg.inquiryExpiryDays * 86400000).toISOString();

  await db
    .prepare(
      `INSERT INTO inquiries
         (id, name, email, project_type, timeline, budget, message, status, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`
    )
    .bind(id, c.name, c.email, c.project_type, c.timeline, c.budget, c.message, nowIso, expiresAt)
    .run();

  await email.enqueueEmail(db, email.inquiryOwnerMessage(cfg, c));
  await email.enqueueEmail(db, email.inquiryAutoReply(cfg, c));

  return { status: 201, body: { ok: true } };
}
