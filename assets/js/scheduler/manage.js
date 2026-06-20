/* ==========================================================================
   OJA Scheduler — manage page controller (manage.html?token=…)
   Looks up a booking by its management token, then offers reschedule (reuses
   <oja-scheduler> in reschedule mode) or cancel. Degrades to a clear message
   if the token is missing/invalid or the API is unreachable.
   ========================================================================== */
(function () {
  "use strict";
  var NS = window.OJAScheduler || {};
  var TZ = (window.OJA && window.OJA.tz) || "America/Los_Angeles";

  function resolveApiBase() {
    try {
      var o = new URLSearchParams(location.search).get("api");
      if (o && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(o)) return o.replace(/\/+$/, "");
    } catch (e) {}
    return ((window.OJA && window.OJA.apiBase) || "https://api.otakar.dev").replace(/\/+$/, "");
  }
  function fmtFull(d) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: TZ, weekday: "long", month: "long", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", timeZoneName: "short",
    }).format(d);
  }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k]; else if (k === "class") n.className = attrs[k]; else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function message(root, title, body) {
    clear(root);
    root.appendChild(el("h2", { class: "section__title", text: title }));
    if (body) root.appendChild(el("p", { class: "section__intro lead", text: body }));
    root.appendChild(el("a", { class: "btn btn--primary", href: "/#book", text: "Book a call" }));
  }

  function start() {
    var root = document.getElementById("manage");
    if (!root) return;
    var token = "";
    try { token = new URLSearchParams(location.search).get("token") || ""; } catch (e) {}
    if (!token) { message(root, "This link is missing its booking reference.", "Open the link from your confirmation email, or book a new call below."); return; }
    if (!NS.WorkerProvider) { message(root, "Booking management is unavailable.", "Please email hello@otakar.dev and I'll help."); return; }

    var provider = new NS.WorkerProvider({ apiBase: resolveApiBase() });
    clear(root);
    root.appendChild(el("div", { class: "sched__state" }, [
      el("span", { class: "sched__spinner", "aria-hidden": "true" }),
      el("p", { text: "Loading your booking…" }),
    ]));

    provider.getBooking(token).then(function (data) {
      var b = data.booking || {};
      if (b.status === "canceled") return message(root, "This booking is canceled.", "Want to find another time? Book a new call below.");
      renderActive(root, provider, token, b);
    }).catch(function (err) {
      if (err && err.status === 404) message(root, "We couldn't find that booking.", "The link may be invalid, or the booking may already be canceled.");
      else message(root, "Couldn't load your booking right now.", "Please try again in a moment.");
    });
  }

  function renderActive(root, provider, token, b) {
    clear(root);
    root.appendChild(el("p", { class: "section__index eyebrow", text: "Manage your booking" }));
    root.appendChild(el("h2", { class: "section__title", text: "Your discovery call" }));
    root.appendChild(el("p", { class: "manage__when lead", text: fmtFull(new Date(b.start)) }));
    if (b.meeting_url) {
      root.appendChild(el("p", {}, [el("a", { href: b.meeting_url, target: "_blank", rel: "noopener", class: "text-accent", text: "Open the meeting link" })]));
    }

    var actions = el("div", { class: "manage__actions" });
    var rescheduleBtn = el("button", { type: "button", class: "btn btn--ghost", text: "Reschedule" });
    var cancelBtn = el("button", { type: "button", class: "btn btn--ghost", text: "Cancel booking" });
    actions.appendChild(rescheduleBtn);
    actions.appendChild(cancelBtn);
    root.appendChild(actions);

    var slot = el("div", { class: "manage__slot" });
    root.appendChild(slot);

    rescheduleBtn.addEventListener("click", function () {
      clear(slot);
      actions.hidden = true;
      slot.appendChild(el("div", { class: "panel" }, [
        (function () {
          var holder = el("div");
          NS.OjaScheduler.mount(holder, { mode: "reschedule", token: token, apiBase: resolveApiBase() });
          return holder;
        })(),
      ]));
    });

    var confirming = false;
    cancelBtn.addEventListener("click", function () {
      if (!confirming) {
        confirming = true;
        cancelBtn.textContent = "Tap again to confirm cancel";
        cancelBtn.classList.add("is-danger");
        return;
      }
      cancelBtn.disabled = true;
      cancelBtn.textContent = "Canceling…";
      provider.cancel(token).then(function () {
        message(root, "Your call is canceled.", "Thanks for letting me know. You can book another time below whenever you're ready.");
      }).catch(function () {
        cancelBtn.disabled = false;
        cancelBtn.textContent = "Cancel booking";
        confirming = false;
        var note = el("p", { class: "form-status", "data-state": "err", text: "Couldn't cancel just now — please try again." });
        root.appendChild(note);
      });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
