/* ==========================================================================
   OJA Solutions — Project inquiry form (#inquiry-form -> POST /inquiries)
   Progressive enhancement: without this file (or on a network failure) the
   form still works via the bot-safe mailto action main.js installs. With it,
   the inquiry is posted as JSON to the first-party API, with a honeypot and
   optional Turnstile token, and inline status feedback.
   ========================================================================== */
(function () {
  "use strict";

  function resolveApiBase() {
    try {
      var override = new URLSearchParams(location.search).get("api");
      if (override && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(override)) {
        return override.replace(/\/+$/, "");
      }
    } catch (e) {}
    return ((window.OJA && window.OJA.apiBase) || "https://api.otakar.dev").replace(/\/+$/, "");
  }

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  ready(function () {
    var form = document.getElementById("inquiry-form");
    if (!form) return;

    var status = form.querySelector(".form-status");
    var submit = form.querySelector('button[type="submit"]');
    var siteKey = (window.OJA && window.OJA.turnstileSiteKey) || form.getAttribute("data-turnstile-key") || "";

    // Optional Turnstile widget, injected before the actions when a key is set.
    if (siteKey && !form.querySelector(".cf-turnstile")) {
      var holder = document.createElement("div");
      holder.className = "cf-turnstile";
      holder.setAttribute("data-sitekey", siteKey);
      var actions = form.querySelector(".form__actions");
      form.insertBefore(holder, actions);
      loadTurnstile();
    }

    function setStatus(state, msg) {
      if (!status) return;
      status.hidden = false;
      status.setAttribute("data-state", state);
      status.textContent = msg;
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();

      var name = (form.name && form.name.value || "").trim();
      var email = (form.email && form.email.value || "").trim();
      var message = (form.message && form.message.value || "").trim();
      if (!name || !email || !message) {
        setStatus("err", "Please fill in your name, email, and a short message.");
        return;
      }

      var body = {
        name: name,
        email: email,
        project_type: (form.project_type && form.project_type.value) || "",
        timeline: (form.timeline && form.timeline.value) || "",
        message: message,
        company: (form.company && form.company.value) || "", // honeypot
      };
      var ts = form.querySelector('[name="cf-turnstile-response"]');
      if (ts) body.turnstile_token = ts.value;

      if (submit) { submit.disabled = true; }
      setStatus("", "Sending…");
      if (status) status.removeAttribute("data-state");

      fetch(resolveApiBase() + "/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "omit",
        body: JSON.stringify(body),
      })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            return { ok: res.ok, status: res.status, data: data };
          });
        })
        .then(function (r) {
          if (r.ok) {
            form.reset();
            setStatus("ok", "Thanks — your message is in. I'll reply personally, usually within a business day.");
          } else if (r.status === 429) {
            setStatus("err", "That's a few too many submissions — please try again in a little while.");
            if (submit) submit.disabled = false;
          } else if (r.data && r.data.error === "captcha") {
            setStatus("err", "Verification failed — please try again.");
            if (window.turnstile) try { window.turnstile.reset(); } catch (e) {}
            if (submit) submit.disabled = false;
          } else {
            failToEmail(r.data && r.data.message);
          }
        })
        .catch(function () { failToEmail(); });
    });

    function failToEmail(msg) {
      if (submit) submit.disabled = false;
      var user = (window.OJA && window.OJA.emailUser) || "hello";
      var domain = (window.OJA && window.OJA.emailDomain) || "otakar.dev";
      setStatus("err", (msg ? msg + " " : "Couldn't send just now. ") + "You can also email " + user + "@" + domain + " directly.");
      // Make the bot-safe mailto immediately usable as a manual fallback.
      form.setAttribute("action", "mailto:" + user + "@" + domain);
    }
  });

  var _loading = false;
  function loadTurnstile() {
    if (_loading || window.turnstile) return;
    _loading = true;
    var sc = document.createElement("script");
    sc.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    sc.async = true;
    sc.defer = true;
    document.head.appendChild(sc);
  }
})();
