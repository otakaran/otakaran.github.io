/* ==========================================================================
   OJA Scheduler — <oja-scheduler> custom element (v2)
   Self-booking UI for the 30-min discovery call. Light DOM (inherits page
   tokens/components). Replaceable provider behind a stable interface.

   Contract (per the implementation plan):
     mount(container, config) · destroy() · getAvailability(range)
     book(req) · reschedule(token, slot) · cancel(token)

   Flow: ① month calendar + time list (shown in the visitor's own time zone,
   switchable) → ② summary + details form → ③ confirmation with add-to-
   calendar links. The form is built once and updated in place, so a failed
   submit never wipes what the visitor typed.

   Resilience: the page ships a static .scheduler-fallback (email path). The
   element hides it while live, and restores it if availability can't load —
   so a backend/JS outage always leaves a working way to get in touch.
   ========================================================================== */
(function () {
  "use strict";
  var NS = (window.OJAScheduler = window.OJAScheduler || {});
  var TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var WEEKDAY_HEAD = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]; // Sunday-first (en-US)
  var WEEKDAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  // Curated zones offered in the switcher (the visitor's detected zone is added on top).
  var COMMON_ZONES = [
    "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York",
    "Europe/London", "Europe/Prague", "UTC",
  ];
  var MEETING_MINUTES = 30;

  // --- config resolution -------------------------------------------------
  function resolveApiBase(attr) {
    // Allow a localhost override for local testing (?api=http://127.0.0.1:8787);
    // never honor an arbitrary remote host from the query string.
    try {
      var override = new URLSearchParams(location.search).get("api");
      if (override && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(override)) {
        return override.replace(/\/+$/, "");
      }
    } catch (e) {}
    return (attr || (window.OJA && window.OJA.apiBase) || "https://api.otakar.dev").replace(/\/+$/, "");
  }

  function makeProvider(cfg) {
    if (cfg.provider === "mock" && NS.MockProvider) return new NS.MockProvider(cfg);
    return new NS.WorkerProvider(cfg);
  }

  // --- small DOM helper --------------------------------------------------
  function el(tag, attrs, kids) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === "text") node.textContent = v;
        else if (k === "html") node.innerHTML = v;
        else if (k === "class") node.className = v;
        else if (k === "on") Object.keys(v).forEach(function (ev) { node.addEventListener(ev, v[ev]); });
        else node.setAttribute(k, v === true ? "" : v);
      });
    }
    (kids || []).forEach(function (c) {
      if (c == null || c === false) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }
  function svg(path, cls) {
    var wrap = el("span", { class: cls || "sched__icon", "aria-hidden": "true" });
    wrap.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + path + "</svg>";
    return wrap;
  }
  var ICON = {
    prev: '<path d="M15 6l-6 6 6 6"/>',
    next: '<path d="M9 6l6 6-6 6"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    video: '<rect x="3" y="7" width="13" height="10" rx="2"/><path d="M16 11l5-3v8l-5-3z"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  };

  // --- date/time helpers (all Intl-based, no deps) ------------------------
  var _fmtCache = {};
  function fmt(tz, opts) {
    var key = tz + "|" + JSON.stringify(opts);
    if (!_fmtCache[key]) _fmtCache[key] = new Intl.DateTimeFormat("en-US", Object.assign({ timeZone: tz }, opts));
    return _fmtCache[key];
  }
  function partsIn(tz, d) {
    var f = {};
    fmt(tz, { year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .forEach(function (p) { if (p.type !== "literal") f[p.type] = p.value; });
    var wk = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return { year: +f.year, month: +f.month, day: +f.day, weekday: wk[f.weekday], hour: +f.hour, minute: +f.minute };
  }
  function keyOf(y, m, d) {
    return y + "-" + (m < 10 ? "0" : "") + m + "-" + (d < 10 ? "0" : "") + d;
  }
  function dateKey(tz, d) {
    var p = partsIn(tz, d);
    return keyOf(p.year, p.month, p.day);
  }
  function parseKey(k) {
    var a = k.split("-");
    return { y: +a[0], m: +a[1], d: +a[2] };
  }
  // Calendar arithmetic on a Y-M-D key (uses UTC purely as a day counter).
  function shiftKey(k, days) {
    var p = parseKey(k);
    var t = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
    return keyOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function weekdayOf(y, m, d) { return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
  function weekdayOfKey(k) { var p = parseKey(k); return weekdayOf(p.y, p.m, p.d); }
  function monthName(y, m) {
    return fmt("UTC", { month: "long", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, 1)));
  }
  function shortDate(y, m, d) {
    return fmt("UTC", { weekday: "short", month: "short", day: "numeric" }).format(new Date(Date.UTC(y, m - 1, d)));
  }
  function longDate(y, m, d) {
    return fmt("UTC", { weekday: "long", month: "long", day: "numeric" }).format(new Date(Date.UTC(y, m - 1, d)));
  }
  function longDateYear(y, m, d) {
    return fmt("UTC", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, d)));
  }
  function fmtTime(tz, d) { return fmt(tz, { hour: "numeric", minute: "2-digit" }).format(d); }
  function fmtRange(tz, a, b) {
    var f = fmt(tz, { hour: "numeric", minute: "2-digit" });
    if (typeof f.formatRange === "function") {
      try { return f.formatRange(a, b).replace(/\s*[–-]\s*/, " – "); } catch (e) {}
    }
    return f.format(a) + " – " + f.format(b);
  }
  function tzAbbr(tz, d) {
    try {
      var parts = fmt(tz, { timeZoneName: "short", hour: "numeric" }).formatToParts(d || new Date());
      var p = parts.filter(function (x) { return x.type === "timeZoneName"; })[0];
      return p ? p.value : tz;
    } catch (e) { return tz; }
  }
  function validTz(tz) {
    if (!tz || typeof tz !== "string") return false;
    try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch (e) { return false; }
  }
  function detectTz() {
    try {
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return validTz(tz) ? tz : null;
    } catch (e) { return null; }
  }
  function cityName(tz) {
    if (tz === "UTC" || tz === "Etc/UTC") return "UTC";
    var last = tz.split("/").pop().replace(/_/g, " ");
    if (tz === "America/Los_Angeles") return "Pacific (Los Angeles)";
    if (tz === "America/Denver") return "Mountain (Denver)";
    if (tz === "America/Chicago") return "Central (Chicago)";
    if (tz === "America/New_York") return "Eastern (New York)";
    return last;
  }
  function tzLabel(tz, d) { return cityName(tz) + " · " + tzAbbr(tz, d); }
  function sameZoneClock(a, b, d) {
    // Two zones that currently share the same offset display identical times.
    if (a === b) return true;
    return fmt(a, { hour: "numeric", minute: "2-digit", hourCycle: "h23" }).format(d) === fmt(b, { hour: "numeric", minute: "2-digit", hourCycle: "h23" }).format(d)
      && dateKey(a, d) === dateKey(b, d);
  }

  // Build the "when" lines shown in summaries / confirmations.
  function describeSlot(displayTz, apiTz, start, end) {
    var s = new Date(start), e = end ? new Date(end) : new Date(s.getTime() + MEETING_MINUTES * 60000);
    var p = partsIn(displayTz, s);
    var out = {
      day: longDate(p.year, p.month, p.day),
      dayYear: longDateYear(p.year, p.month, p.day),
      time: fmtRange(displayTz, s, e) + " " + tzAbbr(displayTz, s),
      alt: "",
    };
    if (!sameZoneClock(displayTz, apiTz, s)) {
      var q = partsIn(apiTz, s);
      var sameDay = keyOf(q.year, q.month, q.day) === keyOf(p.year, p.month, p.day);
      out.alt = (sameDay ? "" : shortDate(q.year, q.month, q.day) + ", ") + fmtTime(apiTz, s) + " Pacific (" + tzAbbr(apiTz, s) + ")";
    }
    return out;
  }

  // --- add-to-calendar helpers ------------------------------------------
  function icsStamp(d) { return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); }
  function icsEscape(t) { return String(t).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
  function calendarLinks(booking, meetingUrl, manageUrl) {
    var s = new Date(booking.start), e = new Date(booking.end || s.getTime() + MEETING_MINUTES * 60000);
    var title = "Discovery call — OJA Solutions";
    var details = "30-minute discovery call with Otakar Andrysek (OJA Solutions)." +
      (meetingUrl ? "\nJoin: " + meetingUrl : "") + (manageUrl ? "\nManage: " + manageUrl : "");
    var google = "https://calendar.google.com/calendar/render?action=TEMPLATE" +
      "&text=" + encodeURIComponent(title) +
      "&dates=" + icsStamp(s) + "/" + icsStamp(e) +
      "&details=" + encodeURIComponent(details) +
      (meetingUrl ? "&location=" + encodeURIComponent(meetingUrl) : "");
    var ics = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//OJA Solutions//Booking//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      "UID:" + icsStamp(s) + "-discovery@otakar.dev",
      "DTSTAMP:" + icsStamp(new Date()),
      "DTSTART:" + icsStamp(s),
      "DTEND:" + icsStamp(e),
      "SUMMARY:" + icsEscape(title),
      "DESCRIPTION:" + icsEscape(details),
      meetingUrl ? "LOCATION:" + icsEscape(meetingUrl) : null,
      meetingUrl ? "URL:" + icsEscape(meetingUrl) : null,
      "END:VEVENT", "END:VCALENDAR",
    ].filter(Boolean).join("\r\n") + "\r\n";
    var icsHref = "";
    try {
      icsHref = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    } catch (e) {
      icsHref = "data:text/calendar;charset=utf-8," + encodeURIComponent(ics);
    }
    return { google: google, ics: icsHref };
  }

  // ============================ element ==================================
  function OjaScheduler() {
    return Reflect.construct(HTMLElement, [], OjaScheduler);
  }
  OjaScheduler.prototype = Object.create(HTMLElement.prototype);
  OjaScheduler.prototype.constructor = OjaScheduler;

  OjaScheduler.prototype.connectedCallback = function () {
    if (this._mounted) return;
    this._mounted = true;

    this.cfg = {
      apiBase: resolveApiBase(this.getAttribute("data-api")),
      provider: this.getAttribute("data-provider") || (window.OJA && window.OJA.provider) || "worker",
      turnstileSiteKey: this.getAttribute("data-turnstile-key") || (window.OJA && window.OJA.turnstileSiteKey) || "",
      mode: this.getAttribute("data-mode") || "book",
      token: this.getAttribute("data-token") || "",
    };
    this.provider = makeProvider(this.cfg);
    this.fallback = this._siblingFallback();
    var apiTz = "America/Los_Angeles";
    this.state = {
      phase: "loading",
      apiTz: apiTz,
      tz: detectTz() || apiTz,
      slots: [],
      dates: [],
      byDate: {},
      month: null,            // { y, m } calendar cursor in display tz
      selectedDate: null,
      selectedSlot: null,
      selectedEnd: null,
      error: "",
      result: null,
      form: { name: "", email: "", topic: "" },
    };
    this._live = el("p", { class: "visually-hidden sched__live", role: "status", "aria-live": "polite" });
    this.classList.add("oja-scheduler");
    if (this.fallback) this.fallback.hidden = true;
    this.render();
    this.loadAvailability();
  };

  OjaScheduler.prototype.disconnectedCallback = function () {
    this._mounted = false;
  };

  OjaScheduler.prototype._siblingFallback = function () {
    var p = this.parentElement;
    return p ? p.querySelector(".scheduler-fallback") : null;
  };

  // ---- contract: data delegation ----
  OjaScheduler.prototype.getAvailability = function (range) {
    return this.provider.getAvailability(range || this._defaultRange());
  };
  OjaScheduler.prototype.book = function (req) { return this.provider.book(req); };
  OjaScheduler.prototype.reschedule = function (token, slot) { return this.provider.reschedule(token, slot); };
  OjaScheduler.prototype.cancel = function (token) { return this.provider.cancel(token); };
  OjaScheduler.prototype.destroy = function () {
    this.innerHTML = "";
    if (this.fallback) this.fallback.hidden = false;
    this.remove();
  };

  OjaScheduler.prototype._defaultRange = function () {
    var now = new Date();
    return { from: now, to: new Date(now.getTime() + 45 * 86400000) };
  };

  // ---- availability load + grouping ----
  OjaScheduler.prototype.loadAvailability = function () {
    var self = this;
    var s = this.state;
    s.phase = "loading";
    this.render();
    this.getAvailability()
      .then(function (data) {
        s.apiTz = data.tz || s.apiTz;
        s.slots = (data.slots || []).slice().sort(function (a, b) { return Date.parse(a.start) - Date.parse(b.start); });
        self._regroup();
        s.phase = s.dates.length ? "pick" : "empty";
        self.render();
      })
      .catch(function (err) {
        s.phase = "fatal";
        s.error = (err && err.message) || "Live scheduling is unavailable right now.";
        self.render();
      });
  };

  // Group slots by calendar date in the *display* zone (late Pacific slots can
  // land on the next day in Europe/Asia), keep the selection if it survives.
  OjaScheduler.prototype._regroup = function () {
    var s = this.state;
    var byDate = {}, order = [];
    s.slots.forEach(function (slot) {
      var k = dateKey(s.tz, new Date(slot.start));
      if (!byDate[k]) { byDate[k] = []; order.push(k); }
      byDate[k].push(slot);
    });
    order.sort();
    s.byDate = byDate;
    s.dates = order;
    if (s.selectedSlot) {
      s.selectedDate = dateKey(s.tz, new Date(s.selectedSlot));
    } else if (!s.selectedDate || !byDate[s.selectedDate]) {
      s.selectedDate = order[0] || null;
    }
    var anchor = s.selectedDate || order[0] || dateKey(s.tz, new Date());
    var p = parseKey(anchor);
    s.month = { y: p.y, m: p.m };
  };

  OjaScheduler.prototype._setTz = function (tz) {
    if (!validTz(tz)) return;
    this.state.tz = tz;
    this._regroup();
    this.render();
    this._announce("Times now shown in " + tzLabel(tz, new Date()) + ".");
  };

  OjaScheduler.prototype._announce = function (msg) {
    var live = this._live;
    if (!live) return;
    live.textContent = "";
    setTimeout(function () { live.textContent = msg; }, 30);
  };

  // ============================ rendering =================================
  OjaScheduler.prototype._clear = function () {
    this.innerHTML = "";
    this.appendChild(this._live);
    this._detail = null;
  };

  OjaScheduler.prototype.render = function () {
    var s = this.state;
    if (s.phase === "loading") { this._clear(); this.appendChild(this._loading()); return; }
    if (s.phase === "fatal") { this._clear(); this._renderFatal(); return; }
    if (s.phase === "empty") { this._clear(); this.appendChild(this._empty()); return; }
    if (s.phase === "done") { this._clear(); this.appendChild(this._done()); return; }

    if (s.phase === "pick") {
      this._clear();
      var wrap = el("div", { class: "sched" });
      wrap.appendChild(this._stepper(1));
      wrap.appendChild(this._picker());
      this.appendChild(wrap);
      return;
    }

    // details | submitting — build once per selected slot, then update in place.
    if (!this._detail || this._detail._slot !== s.selectedSlot) {
      this._clear();
      var w = el("div", { class: "sched" });
      w.appendChild(this._stepper(2));
      this._detail = this._detailStep();
      this._detail._slot = s.selectedSlot;
      w.appendChild(this._detail);
      this.appendChild(w);
    }
    this._syncDetail();
  };

  OjaScheduler.prototype._loading = function () {
    return el("div", { class: "sched__state" }, [
      el("span", { class: "sched__spinner", "aria-hidden": "true" }),
      el("p", { text: "Loading available times…" }),
    ]);
  };

  OjaScheduler.prototype._empty = function () {
    var wrap = el("div", { class: "sched__state" }, [
      el("p", { text: "No open times in the next several weeks." }),
    ]);
    wrap.appendChild(this._emailButton("No open times — email to book"));
    return wrap;
  };

  OjaScheduler.prototype._renderFatal = function () {
    // Live availability couldn't load. If the page ships the static email
    // fallback, just restore it — it already explains the email path; no need
    // to surface a raw network error. Otherwise (e.g. manage page) render our own.
    if (this.fallback) { this.fallback.hidden = false; return; }
    this.appendChild(
      el("div", { class: "sched__state" }, [
        el("p", { class: "form__note", text: "Live scheduling is offline right now." }),
        this._emailButton("Email to book a call"),
      ])
    );
  };

  OjaScheduler.prototype._stepper = function (current) {
    var labels = this.cfg.mode === "reschedule"
      ? ["Pick a new time", "Confirm", "Done"]
      : ["Pick a time", "Your details", "Confirmed"];
    var ol = el("ol", { class: "sched__steps", "aria-label": "Booking steps" });
    labels.forEach(function (label, i) {
      var n = i + 1;
      var li = el("li", {
        class: "sched__step" + (n < current ? " is-done" : n === current ? " is-current" : ""),
        "aria-current": n === current ? "step" : null,
      }, [
        el("span", { class: "sched__step-n", "aria-hidden": "true" }, [n < current ? svg(ICON.check, "sched__step-check") : String(n)]),
        el("span", { class: "sched__step-label", text: label }),
      ]);
      ol.appendChild(li);
    });
    return ol;
  };

  // ---- step 1: calendar + times ----
  OjaScheduler.prototype._picker = function () {
    var self = this;
    var s = this.state;
    var box = el("div", { class: "sched__pick" });

    box.appendChild(this._calendar());
    box.appendChild(this._timeList());

    // Footer: time-zone switcher + meeting meta
    var tzSel = el("select", { class: "sched__tz-select", id: "sched-tz", "aria-label": "Time zone for the times shown" });
    var zones = [];
    var detected = detectTz();
    if (detected) zones.push(detected);
    COMMON_ZONES.forEach(function (z) { if (zones.indexOf(z) < 0) zones.push(z); });
    if (zones.indexOf(s.tz) < 0) zones.unshift(s.tz);
    var now = new Date();
    zones.forEach(function (z) {
      var opt = el("option", { value: z, text: tzLabel(z, now) + (z === detected ? " · your time" : "") });
      if (z === s.tz) opt.selected = true;
      tzSel.appendChild(opt);
    });
    tzSel.addEventListener("change", function () { self._setTz(tzSel.value); });
    var foot = el("div", { class: "sched__foot" }, [
      el("label", { class: "sched__tz", for: "sched-tz" }, [svg(ICON.globe), el("span", { class: "visually-hidden", text: "Time zone" }), tzSel]),
      el("span", { class: "sched__meta" }, [svg(ICON.video), el("span", { text: MEETING_MINUTES + "-minute video call" })]),
    ]);
    box.appendChild(foot);

    if (s.error) box.appendChild(this._statusLine());
    return box;
  };

  OjaScheduler.prototype._monthBounds = function () {
    var s = this.state;
    var today = parseKey(dateKey(s.tz, new Date()));
    var last = s.dates.length ? parseKey(s.dates[s.dates.length - 1]) : today;
    return { min: today.y * 12 + (today.m - 1), max: Math.max(today.y * 12 + (today.m - 1), last.y * 12 + (last.m - 1)) };
  };

  OjaScheduler.prototype._calendar = function () {
    var self = this;
    var s = this.state;
    var y = s.month.y, m = s.month.m;
    var idx = y * 12 + (m - 1);
    var bounds = this._monthBounds();
    var todayKey = dateKey(s.tz, new Date());

    var titleId = "sched-cal-title";
    var cal = el("div", { class: "sched__cal", role: "group", "aria-labelledby": titleId });

    var prev = el("button", { type: "button", class: "sched__cal-nav", "aria-label": "Previous month" }, [svg(ICON.prev)]);
    var next = el("button", { type: "button", class: "sched__cal-nav", "aria-label": "Next month" }, [svg(ICON.next)]);
    prev.disabled = idx <= bounds.min;
    next.disabled = idx >= bounds.max;
    prev.addEventListener("click", function () { self._shiftMonth(-1); });
    next.addEventListener("click", function () { self._shiftMonth(1); });
    cal.appendChild(el("div", { class: "sched__cal-head" }, [
      prev,
      el("h4", { class: "sched__cal-title", id: titleId, text: monthName(y, m) }),
      next,
    ]));

    var grid = el("div", { class: "sched__cal-grid" });
    WEEKDAY_HEAD.forEach(function (wd, i) {
      grid.appendChild(el("span", { class: "sched__cal-wd", "aria-hidden": "true", text: wd, title: WEEKDAY_FULL[i] }));
    });
    var lead = weekdayOf(y, m, 1);
    for (var i = 0; i < lead; i++) grid.appendChild(el("span", { class: "sched__cal-pad", "aria-hidden": "true" }));

    var n = daysInMonth(y, m);
    var focusKey = (s.selectedDate && parseKey(s.selectedDate).y === y && parseKey(s.selectedDate).m === m) ? s.selectedDate : null;
    if (!focusKey) {
      for (var d = 1; d <= n; d++) { var k0 = keyOf(y, m, d); if (s.byDate[k0]) { focusKey = k0; break; } }
    }
    if (!focusKey) focusKey = keyOf(y, m, 1);

    for (var day = 1; day <= n; day++) {
      var k = keyOf(y, m, day);
      var avail = !!s.byDate[k];
      var isSel = k === s.selectedDate;
      var btn = el("button", {
        type: "button",
        class: "sched__cal-day" + (avail ? " is-avail" : "") + (isSel ? " is-active" : "") + (k === todayKey ? " is-today" : ""),
        "data-date": k,
        "aria-label": longDate(y, m, day) + (avail ? ", " + s.byDate[k].length + " times available" : ", no times available"),
        "aria-pressed": avail ? (isSel ? "true" : "false") : null,
        "aria-current": k === todayKey ? "date" : null,
        tabindex: k === focusKey ? "0" : "-1",
      }, [el("span", { class: "sched__cal-num", text: String(day) })]);
      if (!avail) btn.setAttribute("aria-disabled", "true");
      if (avail) {
        btn.addEventListener("click", (function (key) {
          return function () { self._selectDate(key); };
        })(k));
      }
      grid.appendChild(btn);
    }
    grid.addEventListener("keydown", function (e) { self._calKeydown(e); });
    cal.appendChild(grid);
    return cal;
  };

  OjaScheduler.prototype._shiftMonth = function (delta, focusKey) {
    var s = this.state;
    var idx = s.month.y * 12 + (s.month.m - 1) + delta;
    var b = this._monthBounds();
    if (idx < b.min || idx > b.max) return;
    s.month = { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
    this._replacePicker();
    var target = focusKey
      ? this.querySelector('.sched__cal-day[data-date="' + focusKey + '"]')
      : this.querySelector(".sched__cal-day[tabindex='0']");
    var nav = this.querySelector(".sched__cal-nav" + (delta < 0 ? ":first-child" : ":last-child"));
    if (focusKey && target) target.focus();
    else if (nav && !nav.disabled) nav.focus();
    this._announce(monthName(s.month.y, s.month.m));
  };

  OjaScheduler.prototype._selectDate = function (key) {
    var s = this.state;
    s.selectedDate = key;
    s.selectedSlot = null;
    s.error = "";
    this._replacePicker();
    var btn = this.querySelector('.sched__cal-day[data-date="' + key + '"]');
    if (btn) btn.focus();
    var p = parseKey(key);
    this._announce("Showing " + (s.byDate[key] || []).length + " times for " + longDate(p.y, p.m, p.d) + ".");
  };

  // Re-render just the picker (keeps the live region + stepper intact).
  OjaScheduler.prototype._replacePicker = function () {
    var old = this.querySelector(".sched__pick");
    var fresh = this._picker();
    if (old && old.parentNode) old.parentNode.replaceChild(fresh, old);
    else this.render();
  };

  OjaScheduler.prototype._calKeydown = function (e) {
    var t = e.target;
    if (!t || !t.classList || !t.classList.contains("sched__cal-day")) return;
    var key = t.getAttribute("data-date");
    var next = null;
    switch (e.key) {
      case "ArrowLeft": next = shiftKey(key, -1); break;
      case "ArrowRight": next = shiftKey(key, 1); break;
      case "ArrowUp": next = shiftKey(key, -7); break;
      case "ArrowDown": next = shiftKey(key, 7); break;
      case "Home": next = shiftKey(key, -weekdayOfKey(key)); break;
      case "End": next = shiftKey(key, 6 - weekdayOfKey(key)); break;
      case "PageUp": e.preventDefault(); this._shiftMonth(-1); return;
      case "PageDown": e.preventDefault(); this._shiftMonth(1); return;
      default: return;
    }
    e.preventDefault();
    var p = parseKey(next);
    var s = this.state;
    if (p.y !== s.month.y || p.m !== s.month.m) {
      var delta = (p.y * 12 + p.m - 1) - (s.month.y * 12 + s.month.m - 1);
      this._shiftMonth(delta, next);
      return;
    }
    var btn = this.querySelector('.sched__cal-day[data-date="' + next + '"]');
    if (btn) {
      this.querySelectorAll(".sched__cal-day").forEach(function (b) { b.setAttribute("tabindex", "-1"); });
      btn.setAttribute("tabindex", "0");
      btn.focus();
    }
  };

  OjaScheduler.prototype._timeList = function () {
    var self = this;
    var s = this.state;
    var box = el("div", { class: "sched__slots" });
    var list = s.byDate[s.selectedDate] || [];
    var p = s.selectedDate ? parseKey(s.selectedDate) : null;
    box.appendChild(el("p", { class: "sched__slots-head" }, [
      el("strong", { text: p ? shortDate(p.y, p.m, p.d) : "Pick a day" }),
      el("span", { class: "sched__slots-count", text: list.length ? list.length + (list.length === 1 ? " time" : " times") : "" }),
    ]));
    var grid = el("div", { class: "sched__times", role: "list", "aria-label": "Available times" });
    list.forEach(function (slot) {
      var d = new Date(slot.start);
      var btn = el("button", {
        type: "button",
        class: "sched__time" + (s.selectedSlot === slot.start ? " is-active" : ""),
        role: "listitem",
        "aria-pressed": s.selectedSlot === slot.start ? "true" : "false",
        "aria-label": fmtTime(s.tz, d) + " " + tzAbbr(s.tz, d),
        text: fmtTime(s.tz, d),
      });
      btn.addEventListener("click", function () { self._selectSlot(slot); });
      grid.appendChild(btn);
    });
    if (!list.length) grid.appendChild(el("p", { class: "form__note", text: "Choose a highlighted day to see times." }));
    box.appendChild(grid);
    return box;
  };

  OjaScheduler.prototype._selectSlot = function (slot) {
    var s = this.state;
    s.selectedSlot = slot.start;
    s.selectedEnd = slot.end || null;
    s.error = "";
    s.phase = this.cfg.mode === "reschedule" ? "confirm" : "details";
    this.render();
    var step = this.querySelector(".sched__detail");
    if (step && typeof step.scrollIntoView === "function") {
      try { step.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (e) {}
    }
    var firstField = this.querySelector(".sched__form input, .sched__detail .btn--primary");
    if (firstField) firstField.focus({ preventScroll: true });
    var d = describeSlot(s.tz, s.apiTz, s.selectedSlot, s.selectedEnd);
    this._announce("Selected " + d.day + ", " + d.time + ". " + (this.cfg.mode === "reschedule" ? "Confirm the new time." : "Enter your details to confirm."));
  };

  // ---- step 2: summary + form ----
  OjaScheduler.prototype._summary = function () {
    var self = this;
    var s = this.state;
    var d = describeSlot(s.tz, s.apiTz, s.selectedSlot, s.selectedEnd);
    var change = el("button", { type: "button", class: "sched__change", text: "Change" });
    change.addEventListener("click", function () {
      s.phase = "pick";
      s.selectedSlot = null;
      s.error = "";
      self.render();
      var sel = self.querySelector(".sched__cal-day.is-active") || self.querySelector(".sched__cal-day[tabindex='0']");
      if (sel) sel.focus({ preventScroll: true });
    });
    return el("div", { class: "sched__summary" }, [
      svg(ICON.calendar, "sched__summary-icon"),
      el("div", { class: "sched__summary-body" }, [
        el("span", { class: "sched__summary-label eyebrow", text: this.cfg.mode === "reschedule" ? "New time" : "Your time" }),
        el("strong", { class: "sched__summary-day", text: d.day }),
        el("span", { class: "sched__summary-time", text: d.time }),
        el("span", { class: "sched__summary-sub", text: (d.alt ? d.alt + " · " : "") + MEETING_MINUTES + "-minute video call" }),
      ]),
      change,
    ]);
  };

  OjaScheduler.prototype._detailStep = function () {
    var self = this;
    var s = this.state;
    var box = el("div", { class: "sched__detail" });
    box.appendChild(this._summary());

    if (this.cfg.mode === "reschedule") {
      var rbtn = el("button", { type: "button", class: "btn btn--primary btn--block", text: "Confirm new time" });
      rbtn.addEventListener("click", function () { self._submitReschedule(); });
      box.appendChild(rbtn);
      box.appendChild(el("p", { class: "form__note", text: "You'll get an updated calendar invite by email." }));
      box.appendChild(this._statusLine());
      box._submit = rbtn;
      return box;
    }

    // Booking form — built once; values persist in state across re-renders.
    var form = el("form", { class: "form sched__form", novalidate: "novalidate" });
    var nameIn = el("input", { type: "text", name: "name", required: "required", autocomplete: "name", maxlength: "100", value: s.form.name });
    var emailIn = el("input", { type: "email", name: "email", required: "required", autocomplete: "email", inputmode: "email", maxlength: "160", value: s.form.email });
    var topicIn = el("textarea", { name: "topic", maxlength: "200", rows: "3", placeholder: "A sentence or two is plenty." });
    topicIn.value = s.form.topic;
    [nameIn, emailIn, topicIn].forEach(function (inp) {
      inp.addEventListener("input", function () {
        s.form[inp.name] = inp.value;
        self._clearFieldError(inp);
      });
    });
    form.appendChild(el("div", { class: "form__row form__row--2" }, [
      field("Name", nameIn, true),
      field("Email", emailIn, true),
    ]));
    form.appendChild(field("What would you like to cover?", topicIn, false, "Optional"));

    // Honeypot
    form.appendChild(el("div", { class: "hp-field", "aria-hidden": "true" }, [
      el("label", { for: "sched-company", text: "Company (leave blank)" }),
      el("input", { id: "sched-company", name: "company", type: "text", tabindex: "-1", autocomplete: "off" }),
    ]));

    if (this.cfg.turnstileSiteKey) {
      var tsHolder = el("div", { class: "cf-turnstile sched__turnstile", "data-theme": "light" });
      form.appendChild(tsHolder);
      mountTurnstile(tsHolder, this.cfg.turnstileSiteKey);
    }

    var submit = el("button", { type: "submit", class: "btn btn--primary btn--block btn--lg" }, [
      el("span", { class: "sched__submit-label", text: "Confirm booking" }),
      el("span", { class: "btn__arrow", "aria-hidden": "true", text: "→" }),
    ]);
    form.appendChild(submit);
    form.appendChild(el("p", { class: "form__note sched__fine", text: "You'll get a confirmation email with a calendar invite and the video link. No prep needed." }));
    form.appendChild(this._statusLine());
    form.addEventListener("submit", function (e) { e.preventDefault(); self._submitBooking(form); });
    box.appendChild(form);
    box._submit = submit;
    return box;
  };

  // Update the detail step in place: busy state + status message.
  OjaScheduler.prototype._syncDetail = function () {
    var s = this.state;
    var d = this._detail;
    if (!d) return;
    var busy = s.phase === "submitting";
    var btn = d._submit;
    if (btn) {
      btn.disabled = busy;
      btn.setAttribute("aria-busy", busy ? "true" : "false");
      var label = btn.querySelector(".sched__submit-label");
      if (label) label.textContent = busy ? "Booking…" : "Confirm booking";
      else if (this.cfg.mode === "reschedule") btn.textContent = busy ? "Rescheduling…" : "Confirm new time";
    }
    var status = d.querySelector(".sched__status");
    if (status) {
      if (s.error) { status.hidden = false; status.setAttribute("data-state", "err"); status.textContent = s.error; }
      else { status.hidden = true; status.textContent = ""; }
    }
  };

  OjaScheduler.prototype._statusLine = function () {
    var p = el("p", { class: "form-status sched__status", role: "alert" });
    if (this.state.error) { p.setAttribute("data-state", "err"); p.textContent = this.state.error; }
    else p.hidden = true;
    return p;
  };

  OjaScheduler.prototype._setFieldError = function (input, msg) {
    var wrap = input.closest(".field");
    input.setAttribute("aria-invalid", "true");
    if (!wrap) return;
    wrap.classList.add("is-invalid");
    var hint = wrap.querySelector(".field__error");
    if (!hint) { hint = el("p", { class: "field__error", id: input.id + "-err" }); wrap.appendChild(hint); }
    hint.textContent = msg;
    input.setAttribute("aria-describedby", hint.id);
  };
  OjaScheduler.prototype._clearFieldError = function (input) {
    var wrap = input.closest(".field");
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
    if (!wrap) return;
    wrap.classList.remove("is-invalid");
    var hint = wrap.querySelector(".field__error");
    if (hint) hint.remove();
  };

  OjaScheduler.prototype._submitBooking = function (form) {
    var self = this;
    var s = this.state;
    var data = {
      name: (form.name.value || "").trim(),
      email: (form.email.value || "").trim(),
      topic: (form.topic.value || "").trim(),
      slot: s.selectedSlot,
      tz: s.tz,
      company: form.company.value || "",
    };
    var firstBad = null;
    if (!data.name) { this._setFieldError(form.name, "Please enter your name."); firstBad = firstBad || form.name; }
    if (!data.email || !EMAIL_RE.test(data.email)) { this._setFieldError(form.email, "Please enter a valid email address."); firstBad = firstBad || form.email; }
    if (firstBad) {
      s.error = "Please check the highlighted fields.";
      this._syncDetail();
      firstBad.focus();
      return;
    }
    var ts = form.querySelector('[name="cf-turnstile-response"]');
    if (ts) data.turnstile_token = ts.value;

    s.error = "";
    s.phase = "submitting";
    this.render();
    this.provider
      .book(data)
      .then(function (res) {
        s.result = res;
        s.result.email = data.email;
        s.phase = "done";
        self.render();
        var h = self.querySelector(".sched__done-title");
        if (h) h.focus({ preventScroll: true });
        self._announce("Booked. A confirmation is on its way to " + data.email + ".");
      })
      .catch(function (err) { self._failBack(err); });
  };

  OjaScheduler.prototype._submitReschedule = function () {
    var self = this;
    var s = this.state;
    s.error = "";
    s.phase = "submitting";
    this.render();
    this.provider
      .reschedule(this.cfg.token, s.selectedSlot, { tz: s.tz })
      .then(function (res) {
        s.result = { booking: res.booking, rescheduled: true };
        s.phase = "done";
        self.render();
        var h = self.querySelector(".sched__done-title");
        if (h) h.focus({ preventScroll: true });
        self._announce("Your call was moved.");
      })
      .catch(function (err) { self._failBack(err); });
  };

  OjaScheduler.prototype._failBack = function (err) {
    var s = this.state;
    s.error = (err && err.message) || "Something went wrong — please try again.";
    if (err && (err.status === 409 || err.status === 422)) {
      // The slot is gone: back to the picker with the message visible, then refresh.
      var self = this;
      var msg = s.error;
      s.phase = "pick";
      s.selectedSlot = null;
      this.render();
      this._announce(msg);
      this.getAvailability().then(function (data) {
        s.apiTz = data.tz || s.apiTz;
        s.slots = (data.slots || []).slice().sort(function (a, b) { return Date.parse(a.start) - Date.parse(b.start); });
        self._regroup();
        s.error = msg;
        s.phase = s.dates.length ? "pick" : "empty";
        self.render();
      }).catch(function () { /* keep the current grid */ });
    } else if (err && err.data && err.data.error === "captcha") {
      s.phase = this.cfg.mode === "reschedule" ? "confirm" : "details";
      if (window.turnstile) { try { window.turnstile.reset(); } catch (e) {} }
      this.render();
    } else {
      s.phase = this.cfg.mode === "reschedule" ? "confirm" : "details";
      this.render();
    }
  };

  // ---- step 3: confirmation ----
  OjaScheduler.prototype._done = function () {
    var s = this.state;
    var b = (s.result && s.result.booking) || {};
    var rescheduled = s.result && s.result.rescheduled;
    var d = b.start ? describeSlot(s.tz, s.apiTz, b.start, b.end) : null;
    var box = el("div", { class: "sched__done" });
    box.appendChild(svg(ICON.check, "sched__check"));
    box.appendChild(el("h3", { class: "sched__done-title", tabindex: "-1", text: rescheduled ? "Your call was moved" : "You're booked" }));
    if (d) {
      box.appendChild(el("p", { class: "sched__done-when" }, [
        el("strong", { text: d.dayYear }),
        el("span", { text: d.time }),
        d.alt ? el("span", { class: "sched__done-alt", text: d.alt }) : null,
      ]));
    }
    var to = s.result && s.result.email;
    box.appendChild(el("p", { class: "sched__done-note" }, [
      "A confirmation" + (rescheduled ? " with the updated invite" : " with a calendar invite") + " is on its way" + (to ? " to " : "."),
      to ? el("strong", { text: to }) : null,
      to ? ". " : " ",
      "Check spam if you don't see it in a few minutes.",
    ]));

    var actions = el("div", { class: "sched__done-actions" });
    if (b.start) {
      var links = calendarLinks(b, s.result && s.result.meeting_url, s.result && s.result.manage_url);
      actions.appendChild(el("a", { class: "btn btn--ghost", href: links.google, target: "_blank", rel: "noopener", text: "Add to Google Calendar" }));
      actions.appendChild(el("a", { class: "btn btn--ghost", href: links.ics, download: "discovery-call.ics", text: "Download .ics" }));
    }
    if (actions.childNodes.length) box.appendChild(actions);

    var links2 = el("p", { class: "sched__done-links" });
    if (s.result && s.result.meeting_url) {
      links2.appendChild(el("a", { href: s.result.meeting_url, target: "_blank", rel: "noopener", text: "Open the meeting link" }));
    }
    if (s.result && s.result.manage_url) {
      if (links2.childNodes.length) links2.appendChild(el("span", { class: "sched__sep", "aria-hidden": "true", text: " · " }));
      links2.appendChild(el("a", { href: s.result.manage_url, text: "Reschedule or cancel" }));
    }
    if (links2.childNodes.length) box.appendChild(links2);
    return box;
  };

  OjaScheduler.prototype._emailButton = function (label) {
    var a = el("a", { class: "btn btn--primary", href: "#book", text: label });
    var user = (window.OJA && window.OJA.emailUser) || "hello";
    var domain = (window.OJA && window.OJA.emailDomain) || "otakar.dev";
    a.setAttribute("href", "mailto:" + user + "@" + domain + "?subject=" + encodeURIComponent("Discovery call — OJA Solutions"));
    return a;
  };

  // ---- contract: static mount ----
  OjaScheduler.mount = function (container, config) {
    var node = document.createElement("oja-scheduler");
    if (config) {
      if (config.apiBase) node.setAttribute("data-api", config.apiBase);
      if (config.provider) node.setAttribute("data-provider", config.provider);
      if (config.turnstileSiteKey) node.setAttribute("data-turnstile-key", config.turnstileSiteKey);
      if (config.mode) node.setAttribute("data-mode", config.mode);
      if (config.token) node.setAttribute("data-token", config.token);
    }
    container.appendChild(node);
    return node;
  };

  // --- shared helpers ----------------------------------------------------
  function field(labelText, control, required, hint) {
    var id = "f-sched-" + (control.name || Math.random().toString(36).slice(2));
    control.id = id;
    var label = el("label", { class: "field__label", for: id }, [labelText]);
    if (required) label.appendChild(el("span", { class: "req", "aria-hidden": "true", text: " *" }));
    if (hint) label.appendChild(el("span", { class: "field__opt", text: " " + hint }));
    return el("div", { class: "field" }, [label, control]);
  }
  // Turnstile's implicit mode only renders .cf-turnstile divs present when its
  // script loads. The detail step can be rebuilt later (Change → new time, or
  // after a 409), so once the API is available we render explicitly.
  function mountTurnstile(holder, sitekey) {
    if (window.turnstile && typeof window.turnstile.render === "function") {
      try { window.turnstile.render(holder, { sitekey: sitekey, theme: "light" }); return; } catch (e) {}
    }
    holder.setAttribute("data-sitekey", sitekey); // first load: implicit render picks it up
    ensureTurnstile();
  }
  var _turnstileLoading = false;
  function ensureTurnstile() {
    if (_turnstileLoading || window.turnstile) return;
    _turnstileLoading = true;
    var sc = document.createElement("script");
    sc.src = TURNSTILE_SRC;
    sc.async = true;
    sc.defer = true;
    document.head.appendChild(sc);
  }

  // --- define + autoboot -------------------------------------------------
  if ("customElements" in window && !customElements.get("oja-scheduler")) {
    try { customElements.define("oja-scheduler", OjaScheduler); } catch (e) {}
  }
  NS.OjaScheduler = OjaScheduler;
  // Formatting helpers shared with manage.js (same wording everywhere).
  NS.util = { describeSlot: describeSlot, detectTz: detectTz, validTz: validTz, tzLabel: tzLabel, calendarLinks: calendarLinks, el: el, icon: svg, ICON: ICON };

  function boot() {
    var mount = document.getElementById("scheduler");
    if (!mount || mount.querySelector("oja-scheduler") || !("customElements" in window)) return;
    if (mount.getAttribute("data-autoboot") === "off") return;
    OjaScheduler.mount(mount, {
      provider: mount.getAttribute("data-provider") || undefined,
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
