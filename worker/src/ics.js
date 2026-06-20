// ===========================================================================
// Minimal RFC 5545 iCalendar builder — pure. One VEVENT, CRLF line endings,
// text escaping per spec. Used as the calendar attachment on confirmations.
// ===========================================================================

function icsEscape(text) {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// UTC basic format: 20260625T170000Z
function icsStamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Build an ICS string for a single confirmed meeting.
 * status: "CONFIRMED" | "CANCELLED".
 */
export function buildICS({
  uid,
  start,
  end,
  summary,
  description,
  location,
  organizerEmail,
  organizerName,
  attendeeEmail,
  attendeeName,
  status = "CONFIRMED",
  sequence = 0,
}) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OJA Solutions//Booking//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${status === "CANCELLED" ? "CANCEL" : "REQUEST"}`,
    "BEGIN:VEVENT",
    `UID:${icsEscape(uid)}`,
    `SEQUENCE:${sequence}`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsEscape(summary)}`,
    `STATUS:${status}`,
  ];
  if (description) lines.push(`DESCRIPTION:${icsEscape(description)}`);
  if (location) lines.push(`LOCATION:${icsEscape(location)}`);
  if (organizerEmail) {
    lines.push(`ORGANIZER;CN=${icsEscape(organizerName || organizerEmail)}:mailto:${organizerEmail}`);
  }
  if (attendeeEmail) {
    lines.push(
      `ATTENDEE;CN=${icsEscape(attendeeName || attendeeEmail)};RSVP=TRUE:mailto:${attendeeEmail}`
    );
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

/** Base64 of a UTF-8 string (for Resend attachments). */
export function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
