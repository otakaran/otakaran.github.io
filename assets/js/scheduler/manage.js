/* ==========================================================================
   OJA Scheduler — manage page controller (manage.html?token=…)
   Looks up a booking by its management token, then offers reschedule (reuses
   <oja-scheduler> in reschedule mode) or cancel with an inline confirmation.
   Times are shown in the visitor's own zone with Pacific alongside. Degrades
   to a clear message if the token is missing/invalid or the API is unreachable.
   ========================================================================== */
(function () {
  "use strict";
  var NS = window.OJAScheduler || {};
  var U = NS.util;
  var API_TZ = (window.OJA && window.OJA.tz) || "America/Los_Angeles";

  function resolveApiBase() {
    try {
      var o = new URLSearchParams(location.search).get("api");
      if (o && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(o)) return o.replace(/\/+$/, "");
    } catch (e) {}
    return ((window.OJA && window.OJA.apiBase) || "https://api.otakar.dev").replace(/\/+$/, "");
  }
  function el(tag, attrs, kids) {
    if (U && U.el) return U.el(tag, attrs, kids);
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (attrs[k] == null) return;
      if (k === "text") n.textContent = attrs[k]; else if (k === "class") n.className = attrs[k]; else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function emailAddr() {
    return ((window.OJA && window.OJA.emailUser) || "hello") + "@" + ((window.OJA && window.OJA.emailDomain) || "otakar.dev");
  }

  function message(root, title, body, opts) {
    opts = opts || {};
    clear(root);
    root.appendChild(el("p", { class: "section__index eyebrow", text: opts.eyebrow || "Manage your booking" }));
    root.appendChild(el("h1", { class: "section__title manage__title", text: title }));
    if (body) root.appendChild(el("p", { class: "section__intro lead", text: body }));
    var actions = el("div", { class: "manage__actions" });
    actions.appendChild(el("a", { class: "btn btn--primary", href: "/#book", text: opts.cta || "Book a call" }));
    actions.appendChild(el("a", { class: "btn btn--ghost", href: "mailto:" + emailAddr(), text: "Email me" }));
    root.appendChild(actions);
  }

  function summaryCard(b, displayTz) {
    var d = U ? U.describeSlot(displayTz, API_TZ, b.start, b.end) : null;
    var card = el("div", { class: "sched__summary sched__summary--static" });
    if (U) card.appendChild(U.icon(U.ICON.calendar, "sched__summary-icon"));
    card.appendChild(el("div", { class: "sched__summary-body" }, [
      el("span", { class: "sched__summary-label eyebrow", text: "Discovery call" }),
      el("strong", { class: "sched__summary-day", text: d ? d.dayYear : new Date(b.start).toLocaleString() }),
      d ? el("span", { class: "sched__summary-time", text: d.time }) : null,
      el("span", { class: "sched__summary-sub", text: (d && d.alt ? d.alt + " · " : "") + "30-minute video call" }),
    ]));
    return card;
  }

  function start() {
    var root = document.getElementById("manage");
    if (!root) return;
    var token = "";
    try { token = new URLSearchParams(location.search).get("token") || ""; } catch (e) {}
    if (!token) { message(root, "This link is missing its booking reference.", "Open the link from your confirmation email, or book a new call."); return; }
    if (!NS.WorkerProvider) { message(root, "Booking management is unavailable.", "Please email " + emailAddr() + " and I'll help."); return; }

    var provider = new NS.WorkerProvider({ apiBase: resolveApiBase() });
    clear(root);
    root.appendChild(el("div", { class: "sched__state" }, [
      el("span", { class: "sched__spinner", "aria-hidden": "true" }),
      el("p", { text: "Loading your booking…" }),
    ]));

    provider.getBooking(token).then(function (data) {
      var b = data.booking || {};
      if (b.status === "canceled") return message(root, "This booking is canceled.", "Want to find another time? Book a new call below.", { cta: "Book a new call" });
      renderActive(root, provider, token, b);
    }).catch(function (err) {
      if (err && err.status === 404) message(root, "We couldn't find that booking.", "The link may be invalid, or the booking may already be canceled.");
      else message(root, "Couldn't load your booking right now.", "Please try again in a moment, or email me and I'll sort it out.");
    });
  }

  function renderActive(root, provider, token, b, opts) {
    opts = opts || {};
    var displayTz = (U && U.detectTz()) || API_TZ;
    clear(root);
    root.appendChild(el("p", { class: "section__index eyebrow", text: "Manage your booking" }));
    root.appendChild(el("h1", { class: "section__title manage__title", text: b.name ? "Hi " + b.name.split(" ")[0] + ", here's your call" : "Your discovery call" }));
    if (opts.moved) {
      var ok = el("p", { class: "form-status", role: "status", "data-state": "ok", text: "Your call was moved. An updated invite is on its way to your inbox." });
      root.appendChild(ok);
    }
    root.appendChild(summaryCard(b, displayTz));

    var links = el("p", { class: "manage__links" });
    if (b.meeting_url) {
      links.appendChild(el("a", { href: b.meeting_url, target: "_blank", rel: "noopener", text: "Open the meeting link" }));
    }
    if (U && b.start) {
      var cal = U.calendarLinks(b, b.meeting_url);
      if (links.childNodes.length) links.appendChild(el("span", { class: "sched__sep", "aria-hidden": "true", text: " · " }));
      links.appendChild(el("a", { href: cal.google, target: "_blank", rel: "noopener", text: "Add to Google Calendar" }));
      links.appendChild(el("span", { class: "sched__sep", "aria-hidden": "true", text: " · " }));
      links.appendChild(el("a", { href: cal.ics, download: "discovery-call.ics", text: "Download .ics" }));
    }
    if (links.childNodes.length) root.appendChild(links);

    var actions = el("div", { class: "manage__actions" });
    var rescheduleBtn = el("button", { type: "button", class: "btn btn--primary", text: "Reschedule" });
    var cancelBtn = el("button", { type: "button", class: "btn btn--ghost", text: "Cancel the call" });
    actions.appendChild(rescheduleBtn);
    actions.appendChild(cancelBtn);
    root.appendChild(actions);

    var slot = el("div", { class: "manage__slot" });
    root.appendChild(slot);
    // After a reschedule the whole page re-renders from the new booking, so the
    // summary, calendar links and actions never show the old time.
    slot.addEventListener("oja:rescheduled", function (e) {
      var nb = (e.detail && e.detail.booking) || {};
      var next = { id: b.id, name: b.name, status: b.status, meeting_url: b.meeting_url, start: nb.start || b.start, end: nb.end || b.end, tz: nb.tz || b.tz };
      renderActive(root, provider, token, next, { moved: true });
      var h = root.querySelector(".manage__title");
      if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
    });
    var status = el("p", { class: "form-status", role: "alert" });
    status.hidden = true;
    root.appendChild(status);

    function setStatus(msg) {
      status.hidden = !msg;
      status.setAttribute("data-state", "err");
      status.textContent = msg || "";
    }

    rescheduleBtn.addEventListener("click", function () {
      clear(slot);
      setStatus("");
      actions.hidden = true;
      var back = el("button", { type: "button", class: "sched__change manage__back", text: "← Keep the current time" });
      back.addEventListener("click", function () { clear(slot); actions.hidden = false; rescheduleBtn.focus(); });
      var holder = el("div", { class: "panel panel--nested" });
      NS.OjaScheduler.mount(holder, { mode: "reschedule", token: token, apiBase: resolveApiBase() });
      slot.appendChild(back);
      slot.appendChild(holder);
      var first = holder.querySelector("button, select");
      if (first) first.focus({ preventScroll: true });
    });

    cancelBtn.addEventListener("click", function () {
      clear(slot);
      setStatus("");
      actions.hidden = true;
      var yes = el("button", { type: "button", class: "btn is-danger", text: "Yes, cancel the call" });
      var keep = el("button", { type: "button", class: "btn btn--ghost", text: "Keep it" });
      var box = el("div", { class: "manage__confirm", role: "group", "aria-labelledby": "manage-confirm-title" }, [
        el("p", { class: "manage__confirm-title", id: "manage-confirm-title", text: "Cancel this call?" }),
        el("p", { class: "form__note", text: "No hard feelings — you can book another time whenever you're ready." }),
        el("div", { class: "manage__actions" }, [yes, keep]),
      ]);
      slot.appendChild(box);
      keep.addEventListener("click", function () { clear(slot); actions.hidden = false; cancelBtn.focus(); });
      yes.addEventListener("click", function () {
        yes.disabled = true;
        keep.disabled = true;
        yes.textContent = "Canceling…";
        provider.cancel(token).then(function () {
          message(root, "Your call is canceled.", "Thanks for letting me know. You can book another time whenever you're ready.", { cta: "Book a new time" });
        }).catch(function () {
          yes.disabled = false;
          keep.disabled = false;
          yes.textContent = "Yes, cancel the call";
          setStatus("Couldn't cancel just now — please try again, or email " + emailAddr() + ".");
        });
      });
      yes.focus();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
