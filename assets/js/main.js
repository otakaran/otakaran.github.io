/* ==========================================================================
   OJA Solutions — UI behaviour (progressive enhancement)
   Header scroll state · mobile nav · active-section highlight ·
   reveal-on-scroll · footer year. Everything degrades gracefully without JS;
   the page is fully usable if this file never loads.
   ========================================================================== */
(function () {
  "use strict";

  var root = document.documentElement;
  // Belt-and-braces: the inline head script already swaps these, but ensure it.
  root.classList.remove("no-js");
  root.classList.add("js");

  var reduceMQ = window.matchMedia("(prefers-reduced-motion: reduce)");
  root.setAttribute("data-motion", reduceMQ.matches ? "reduce" : "full");
  if (reduceMQ.addEventListener) {
    reduceMQ.addEventListener("change", function () {
      root.setAttribute("data-motion", reduceMQ.matches ? "reduce" : "full");
    });
  }

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    // Marks that JS UI enhancements are live; CSS gates the transparent header
    // and collapsible mobile nav on this so a failed load degrades cleanly.
    root.classList.add("js-nav");
    setFooterYear();
    initHeaderScroll();
    initMobileNav();
    initActiveSection();
    initReveal();
  }

  function setFooterYear() {
    var y = document.querySelector("[data-year]");
    if (y) y.textContent = String(new Date().getFullYear());
  }

  /* Solidify the fixed header once the hero is scrolled past. */
  function initHeaderScroll() {
    var header = document.querySelector(".site-header");
    var hero = document.querySelector(".hero");
    if (!header) return;
    var point = 120;
    var measure = function () { point = hero ? Math.max(80, hero.offsetHeight - header.offsetHeight) : 120; };
    measure();
    window.addEventListener("resize", measure, { passive: true });

    var ticking = false;
    var onScroll = function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        header.classList.toggle("at-top", window.scrollY <= point);
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* Mobile nav: toggle button drives .is-open + aria-expanded. */
  function initMobileNav() {
    var header = document.querySelector(".site-header");
    var toggle = document.querySelector(".nav-toggle");
    var nav = document.getElementById("primary-nav");
    if (!header || !toggle || !nav) return;

    var setOpen = function (open) {
      header.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    };

    toggle.addEventListener("click", function () {
      setOpen(!header.classList.contains("is-open"));
    });

    nav.addEventListener("click", function (e) {
      if (e.target.closest("a")) setOpen(false);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && header.classList.contains("is-open")) {
        setOpen(false);
        toggle.focus();
      }
    });

    // Reset when leaving the mobile breakpoint.
    var mq = window.matchMedia("(min-width: 48em)");
    var onChange = function () { if (mq.matches) setOpen(false); };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
  }

  /* Highlight the nav link for the section currently in view. */
  function initActiveSection() {
    if (!("IntersectionObserver" in window)) return;
    var links = Array.prototype.slice.call(document.querySelectorAll('.nav__link[href^="#"]'));
    if (!links.length) return;

    var map = {};
    var sections = [];
    links.forEach(function (link) {
      var id = link.getAttribute("href").slice(1);
      var sec = id && document.getElementById(id);
      if (sec) { map[id] = link; sections.push(sec); }
    });

    var setActive = function (id) {
      links.forEach(function (l) {
        var on = l.getAttribute("href") === "#" + id;
        l.classList.toggle("is-active", on);
        if (on) l.setAttribute("aria-current", "true"); else l.removeAttribute("aria-current");
      });
    };

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) setActive(en.target.id);
      });
    }, { rootMargin: "-45% 0px -50% 0px", threshold: 0 });
    sections.forEach(function (s) { io.observe(s); });
  }

  /* Reveal elements as they enter the viewport. */
  function initReveal() {
    var items = Array.prototype.slice.call(document.querySelectorAll("[data-reveal]"));
    if (!items.length) return;
    if (reduceMQ.matches || !("IntersectionObserver" in window)) {
      items.forEach(function (el) { el.classList.add("is-visible"); });
      return;
    }
    root.classList.add("reveal-on"); // only now do we allow [data-reveal] to start hidden
    var io = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("is-visible"); obs.unobserve(en.target); }
      });
    }, { rootMargin: "0px 0px -10% 0px", threshold: 0.08 });
    items.forEach(function (el) { io.observe(el); });
  }
})();
