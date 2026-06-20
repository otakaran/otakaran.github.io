/* ==========================================================================
   OJA Scheduler — MockProvider
   Generates availability client-side and simulates booking in memory. Used for
   front-end-only demos / screenshots when the Worker isn't running. NEVER the
   production fallback (a real API outage falls back to the email path instead).
   Enable with data-provider="mock" on the #scheduler mount.
   Implements the same interface as WorkerProvider.
   ========================================================================== */
(function () {
  "use strict";
  var NS = (window.OJAScheduler = window.OJAScheduler || {});
  var TZ = "America/Los_Angeles";

  function MockProvider(config) {
    this.cfg = config || {};
    this.taken = {}; // slotISO -> true
    this.booked = {}; // token -> {start, end, name, status}
  }

  // Mirror the server engine: weekdays, 10:00–14:30 PT, 30-min grid, >=24h, 45d.
  MockProvider.prototype.getAvailability = function (range) {
    var now = Date.now();
    var from = Math.max((range && range.from && range.from.getTime()) || now, now + 24 * 3600000);
    var to = (range && range.to && range.to.getTime()) || now + 45 * 86400000;
    var slots = [];
    var taken = this.taken;
    var day = new Date(from);
    for (var i = 0; i < 60 && slots.length < 400; i++) {
      var parts = pacificParts(new Date(day.getTime() + i * 86400000));
      if (parts.weekday === 0 || parts.weekday === 6) continue;
      for (var t = 600; t + 30 <= 900; t += 30) {
        var s = pacificWallClock(parts.year, parts.month, parts.day, Math.floor(t / 60), t % 60);
        var ms = s.getTime();
        if (ms < from || ms > to) continue;
        var iso = s.toISOString();
        if (taken[iso]) continue;
        slots.push({ start: iso, end: new Date(ms + 30 * 60000).toISOString() });
      }
    }
    return delay({ tz: TZ, slots: slots });
  };

  MockProvider.prototype.book = function (req) {
    if (this.taken[req.slot]) {
      return reject("That time was just taken — please pick another.", 409);
    }
    this.taken[req.slot] = true;
    var token = "mock-" + Math.random().toString(36).slice(2, 12);
    var end = new Date(new Date(req.slot).getTime() + 30 * 60000).toISOString();
    this.booked[token] = { start: req.slot, end: end, name: req.name, status: "booked" };
    return delay({
      ok: true,
      booking: { start: req.slot, end: end, name: req.name, email: req.email },
      manage_token: token,
      manage_url: "manage.html?token=" + token,
      meeting_url: "https://example.com/mock-meeting",
    });
  };

  MockProvider.prototype.reschedule = function (token, slot) {
    var b = this.booked[token];
    if (!b || b.status !== "booked") return reject("We couldn't find that booking.", 404);
    if (this.taken[slot]) return reject("That time was just taken — please pick another.", 409);
    delete this.taken[b.start];
    this.taken[slot] = true;
    b.start = slot;
    b.end = new Date(new Date(slot).getTime() + 30 * 60000).toISOString();
    return delay({ ok: true, booking: { start: b.start, end: b.end } });
  };

  MockProvider.prototype.cancel = function (token) {
    var b = this.booked[token];
    if (!b || b.status !== "booked") return reject("We couldn't find that booking.", 404);
    b.status = "canceled";
    delete this.taken[b.start];
    return delay({ ok: true });
  };

  MockProvider.prototype.getBooking = function (token) {
    var b = this.booked[token];
    if (!b) return reject("We couldn't find that booking.", 404);
    return delay({ booking: { start: b.start, end: b.end, name: b.name, status: b.status, meeting_url: "https://example.com/mock-meeting" } });
  };

  // --- helpers ---
  function delay(value) {
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve(value);
      }, 220);
    });
  }
  function reject(message, status) {
    return Promise.reject(new NS.SchedulerError(message, status));
  }
  function pacificParts(date) {
    var dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
    });
    var f = {};
    dtf.formatToParts(date).forEach(function (p) { if (p.type !== "literal") f[p.type] = p.value; });
    var wk = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return { year: +f.year, month: +f.month, day: +f.day, weekday: wk[f.weekday] };
  }
  function pacificWallClock(y, mo, d, h, mi) {
    var guess = Date.UTC(y, mo - 1, d, h, mi);
    var off = tzOffset(new Date(guess));
    var utc = guess - off;
    var off2 = tzOffset(new Date(utc));
    if (off2 !== off) utc = guess - off2;
    return new Date(utc);
  }
  function tzOffset(date) {
    var dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    var f = {};
    dtf.formatToParts(date).forEach(function (p) { if (p.type !== "literal") f[p.type] = p.value; });
    return Date.UTC(+f.year, +f.month - 1, +f.day, +f.hour, +f.minute, +f.second) - date.getTime();
  }

  NS.MockProvider = MockProvider;
})();
