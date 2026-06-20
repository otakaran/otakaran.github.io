/* ==========================================================================
   OJA Scheduler — WorkerProvider
   Talks to the first-party booking API (api.otakar.dev). One of two adapters
   behind a stable provider interface; swapping to Cal.com/Calendly later is a
   new adapter + one config value, no change to <oja-scheduler> or the page.

   Interface (all async, throw SchedulerError on failure):
     getAvailability({from, to}) -> { tz, slots: [{start, end}] }
     book({name, email, topic, slot, turnstile_token, company})
                                 -> { ok, booking, manage_token, manage_url, meeting_url }
     reschedule(token, slot)     -> { ok, booking }
     cancel(token)               -> { ok }
     getBooking(token)           -> { booking: {start, end, name, status, meeting_url} }
   ========================================================================== */
(function () {
  "use strict";
  var NS = (window.OJAScheduler = window.OJAScheduler || {});

  function SchedulerError(message, status, data) {
    this.name = "SchedulerError";
    this.message = message || "Something went wrong.";
    this.status = status || 0;
    this.data = data || null;
  }
  SchedulerError.prototype = Object.create(Error.prototype);
  NS.SchedulerError = SchedulerError;

  function WorkerProvider(config) {
    this.base = String((config && config.apiBase) || "").replace(/\/+$/, "");
  }

  WorkerProvider.prototype.getAvailability = function (range) {
    var url = this.base + "/availability";
    var qs = [];
    if (range && range.from) qs.push("from=" + encodeURIComponent(range.from.toISOString()));
    if (range && range.to) qs.push("to=" + encodeURIComponent(range.to.toISOString()));
    if (qs.length) url += "?" + qs.join("&");
    return fetch(url, { headers: { Accept: "application/json" }, credentials: "omit" }).then(parse);
  };

  WorkerProvider.prototype.book = function (req) {
    return this._post("/bookings", req);
  };

  WorkerProvider.prototype.reschedule = function (token, slot) {
    return this._post("/bookings/" + encodeURIComponent(token) + "/reschedule", { slot: slot });
  };

  WorkerProvider.prototype.cancel = function (token) {
    return this._post("/bookings/" + encodeURIComponent(token) + "/cancel", {});
  };

  WorkerProvider.prototype.getBooking = function (token) {
    return fetch(this.base + "/bookings/" + encodeURIComponent(token), {
      headers: { Accept: "application/json" },
      credentials: "omit",
    }).then(parse);
  };

  WorkerProvider.prototype._post = function (path, body) {
    return fetch(this.base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "omit",
      body: JSON.stringify(body || {}),
    }).then(parse);
  };

  function parse(res) {
    return res
      .json()
      .catch(function () {
        return {};
      })
      .then(function (data) {
        if (!res.ok) {
          throw new SchedulerError(
            data.message || messageForStatus(res.status),
            res.status,
            data
          );
        }
        return data;
      });
  }

  function messageForStatus(status) {
    if (status === 409) return "That time was just taken — please pick another.";
    if (status === 422) return "That time isn't available — please pick another.";
    if (status === 429) return "Too many requests — please try again in a little while.";
    if (status === 404) return "We couldn't find that booking.";
    return "Something went wrong — please try again.";
  }

  NS.WorkerProvider = WorkerProvider;
})();
