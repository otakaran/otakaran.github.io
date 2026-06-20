/* ==========================================================================
   OJA Scheduler — <oja-scheduler> custom element
   Self-booking UI for the 30-min discovery call. Light DOM (inherits page
   tokens/components). Replaceable provider behind a stable interface.

   Contract (per the implementation plan):
     mount(container, config) · destroy() · getAvailability(range)
     book(req) · reschedule(token, slot) · cancel(token)

   Resilience: the page ships a static .scheduler-fallback (email path). The
   element hides it while live, and restores it if availability can't load —
   so a backend/JS outage always leaves a working way to get in touch.
   ========================================================================== */
(function () {
  "use strict";
  var NS = (window.OJAScheduler = window.OJAScheduler || {});
  var TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

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
        if (k === "text") node.textContent = attrs[k];
        else if (k === "html") node.innerHTML = attrs[k];
        else if (k === "class") node.className = attrs[k];
        else if (k in node && k !== "list") {
          try { node[k] = attrs[k]; } catch (e) { node.setAttribute(k, attrs[k]); }
        } else node.setAttribute(k, attrs[k]);
      });
    }
    (kids || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  // --- date/time formatting in the API's timezone ------------------------
  function fmt(tz, opts) {
    return new Intl.DateTimeFormat("en-US", Object.assign({ timeZone: tz }, opts));
  }
  function dateKey(tz, d) {
    var f = {};
    fmt(tz, { year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(d)
      .forEach(function (p) { if (p.type !== "literal") f[p.type] = p.value; });
    return f.year + "-" + f.month + "-" + f.day;
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
    this.state = { phase: "loading", tz: "America/Los_Angeles", dates: [], byDate: {}, selectedDate: null, selectedSlot: null, error: "" };

    this.classList.add("oja-scheduler");
    this.setAttribute("aria-live", "polite");
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
    this.state.phase = "loading";
    this.render();
    this.getAvailability()
      .then(function (data) {
        self.state.tz = data.tz || self.state.tz;
        var byDate = {};
        var order = [];
        (data.slots || []).forEach(function (s) {
          var k = dateKey(self.state.tz, new Date(s.start));
          if (!byDate[k]) { byDate[k] = []; order.push(k); }
          byDate[k].push(s);
        });
        self.state.byDate = byDate;
        self.state.dates = order;
        self.state.selectedDate = order[0] || null;
        self.state.phase = order.length ? "pick" : "empty";
        self.render();
      })
      .catch(function (err) {
        self.state.phase = "fatal";
        self.state.error = (err && err.message) || "Live scheduling is unavailable right now.";
        self.render();
      });
  };

  // ============================ rendering =================================
  OjaScheduler.prototype.render = function () {
    var s = this.state;
    this.innerHTML = "";
    if (s.phase === "loading") return this.appendChild(this._loading());
    if (s.phase === "fatal") return this._renderFatal();
    if (s.phase === "empty") return this.appendChild(this._empty());
    if (s.phase === "done") return this.appendChild(this._done());

    var wrap = el("div", { class: "sched" });
    wrap.appendChild(this._picker());
    if (s.selectedSlot && (s.phase === "details" || s.phase === "confirm" || s.phase === "submitting")) {
      wrap.appendChild(this._detailStep());
    }
    this.appendChild(wrap);
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

  OjaScheduler.prototype._picker = function () {
    var self = this;
    var s = this.state;
    var box = el("div", { class: "sched__pick" });

    box.appendChild(el("p", { class: "sched__prompt eyebrow", text: this.cfg.mode === "reschedule" ? "Pick a new time" : "Pick a day, then a time" }));

    // Day rail
    var rail = el("div", { class: "sched__days", role: "tablist", "aria-label": "Available days" });
    s.dates.forEach(function (k) {
      var d = new Date(s.byDate[k][0].start);
      var chip = el("button", {
        type: "button",
        class: "sched__day" + (k === s.selectedDate ? " is-active" : ""),
        role: "tab",
        "aria-selected": k === s.selectedDate ? "true" : "false",
      }, [
        el("span", { class: "sched__day-wd", text: fmt(s.tz, { weekday: "short" }).format(d) }),
        el("span", { class: "sched__day-dm", text: fmt(s.tz, { month: "short", day: "numeric" }).format(d) }),
      ]);
      chip.addEventListener("click", function () {
        s.selectedDate = k;
        s.selectedSlot = null;
        s.phase = "pick";
        self.render();
      });
      rail.appendChild(chip);
    });
    box.appendChild(rail);

    // Time grid for the selected day
    var grid = el("div", { class: "sched__times", role: "list", "aria-label": "Available times" });
    (s.byDate[s.selectedDate] || []).forEach(function (slot) {
      var d = new Date(slot.start);
      var btn = el("button", {
        type: "button",
        class: "sched__time" + (s.selectedSlot === slot.start ? " is-active" : ""),
        role: "listitem",
        "aria-pressed": s.selectedSlot === slot.start ? "true" : "false",
        text: fmt(s.tz, { hour: "numeric", minute: "2-digit" }).format(d),
      });
      btn.addEventListener("click", function () {
        s.selectedSlot = slot.start;
        s.phase = self.cfg.mode === "reschedule" ? "confirm" : "details";
        self.render();
        var step = self.querySelector(".sched__detail");
        if (step) step.scrollIntoView({ block: "nearest", behavior: "smooth" });
        var firstField = self.querySelector(".sched__detail input, .sched__detail button");
        if (firstField) firstField.focus();
      });
      grid.appendChild(btn);
    });
    box.appendChild(grid);
    box.appendChild(el("p", { class: "form__note", text: "Times shown in Pacific (" + tzAbbr(s.tz) + "). A 30-minute video call." }));
    return box;
  };

  OjaScheduler.prototype._detailStep = function () {
    var self = this;
    var s = this.state;
    var when = formatFull(s.tz, new Date(s.selectedSlot));
    var box = el("div", { class: "sched__detail" });

    box.appendChild(el("div", { class: "sched__chosen" }, [
      el("span", { class: "sched__chosen-label eyebrow", text: this.cfg.mode === "reschedule" ? "New time" : "Selected" }),
      el("strong", { text: when }),
      (function () {
        var change = el("button", { type: "button", class: "sched__change", text: "Change" });
        change.addEventListener("click", function () { s.phase = "pick"; s.selectedSlot = null; self.render(); });
        return change;
      })(),
    ]));

    if (this.cfg.mode === "reschedule") {
      var rbtn = el("button", { type: "button", class: "btn btn--primary btn--block", text: s.phase === "submitting" ? "Rescheduling…" : "Confirm new time" });
      rbtn.disabled = s.phase === "submitting";
      rbtn.addEventListener("click", function () { self._submitReschedule(); });
      box.appendChild(rbtn);
      box.appendChild(this._statusLine());
      return box;
    }

    // Booking form
    var form = el("form", { class: "form sched__form", novalidate: "novalidate" });
    form.appendChild(field("Name", el("input", { type: "text", name: "name", required: "required", autocomplete: "name", maxlength: "100" }), true));
    form.appendChild(field("Email", el("input", { type: "email", name: "email", required: "required", autocomplete: "email", maxlength: "160" }), true));
    form.appendChild(field("What would you like to cover? (optional)", el("textarea", { name: "topic", maxlength: "200", rows: "3" }), false));

    // Honeypot
    var hp = el("div", { class: "hp-field", "aria-hidden": "true" }, [
      el("label", { for: "sched-company", text: "Company (leave blank)" }),
      el("input", { id: "sched-company", name: "company", type: "text", tabindex: "-1", autocomplete: "off" }),
    ]);
    form.appendChild(hp);

    if (this.cfg.turnstileSiteKey) {
      form.appendChild(el("div", { class: "cf-turnstile sched__turnstile", "data-sitekey": this.cfg.turnstileSiteKey, "data-theme": "light" }));
      ensureTurnstile();
    }

    var submit = el("button", { type: "submit", class: "btn btn--primary btn--block", text: s.phase === "submitting" ? "Booking…" : "Confirm booking" });
    submit.disabled = s.phase === "submitting";
    form.appendChild(submit);
    form.appendChild(this._statusLine());
    form.addEventListener("submit", function (e) { e.preventDefault(); self._submitBooking(form); });
    box.appendChild(form);
    return box;
  };

  OjaScheduler.prototype._statusLine = function () {
    var p = el("p", { class: "form-status sched__status", role: "status", "aria-live": "polite" });
    if (this.state.error) { p.setAttribute("data-state", "err"); p.textContent = this.state.error; }
    else p.hidden = true;
    return p;
  };

  OjaScheduler.prototype._submitBooking = function (form) {
    var self = this;
    var s = this.state;
    var data = {
      name: (form.name.value || "").trim(),
      email: (form.email.value || "").trim(),
      topic: (form.topic.value || "").trim(),
      slot: s.selectedSlot,
      company: form.company.value || "",
    };
    if (!data.name || !data.email) {
      s.error = "Please add your name and email.";
      this.render();
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
        s.phase = "done";
        self.render();
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
      .reschedule(this.cfg.token, s.selectedSlot)
      .then(function (res) {
        s.result = { booking: res.booking, rescheduled: true };
        s.phase = "done";
        self.render();
      })
      .catch(function (err) { self._failBack(err); });
  };

  OjaScheduler.prototype._failBack = function (err) {
    var s = this.state;
    s.error = (err && err.message) || "Something went wrong — please try again.";
    // 409/422 mean the slot is gone — push them back to the picker + refresh.
    if (err && (err.status === 409 || err.status === 422)) {
      s.phase = "pick";
      s.selectedSlot = null;
      this.render();
      this.loadAvailability();
    } else {
      s.phase = this.cfg.mode === "reschedule" ? "confirm" : "details";
      this.render();
    }
  };

  OjaScheduler.prototype._done = function () {
    var s = this.state;
    var b = (s.result && s.result.booking) || {};
    var when = b.start ? formatFull(s.tz, new Date(b.start)) : "";
    var rescheduled = s.result && s.result.rescheduled;
    var box = el("div", { class: "sched__done" }, [
      el("span", { class: "sched__check", "aria-hidden": "true", text: "✓" }),
      el("h3", { class: "sched__done-title", text: rescheduled ? "Your call was moved" : "You're booked" }),
      el("p", { class: "sched__done-when", text: when }),
      el("p", { class: "form__note", text: "A confirmation" + (rescheduled ? "" : " with a calendar invite") + " is on its way to your inbox. Check spam if you don't see it." }),
    ]);
    if (s.result && s.result.meeting_url) {
      box.appendChild(el("a", { class: "btn btn--ghost", href: s.result.meeting_url, target: "_blank", rel: "noopener", text: "Open the meeting link" }));
    }
    if (s.result && s.result.manage_url) {
      box.appendChild(el("a", { class: "sched__manage-link", href: s.result.manage_url, text: "Reschedule or cancel" }));
    }
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
  function field(labelText, control, required) {
    var id = "f-" + (control.name || Math.random().toString(36).slice(2));
    control.id = id;
    var label = el("label", { class: "field__label", for: id }, [labelText]);
    if (required) label.appendChild(el("span", { class: "req", "aria-hidden": "true", text: " *" }));
    return el("div", { class: "field" }, [label, control]);
  }
  function formatFull(tz, d) {
    return fmt(tz, {
      weekday: "long", month: "long", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", timeZoneName: "short",
    }).format(d);
  }
  function tzAbbr(tz) {
    try {
      var parts = fmt(tz, { timeZoneName: "short", hour: "numeric" }).formatToParts(new Date());
      var p = parts.find(function (x) { return x.type === "timeZoneName"; });
      return p ? p.value : "PT";
    } catch (e) { return "PT"; }
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
