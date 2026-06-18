/* ==========================================================================
   OJA Solutions — Static data-flow motif
   Paints ONE static frame of the hero's node-graph visual language into any
   <canvas class="motif-field" data-density="…">, so the animated hero appears
   to settle into a calm, still graph further down the page.

   Guardrails (mirror hero.js's posture):
   - Does nothing under prefers-reduced-motion (the canvas just stays empty;
     it is decorative + aria-hidden, so no content is ever lost).
   - ONE paint, no requestAnimationFrame loop → negligible cost.
   - Repaints on resize (debounced) so the field stays crisp.
   - Caps node count and devicePixelRatio. Fails silently — a broken paint
     leaves an empty, harmless canvas.
   ========================================================================== */
(function () {
  "use strict";

  var fields = document.querySelectorAll("canvas.motif-field");
  if (!fields.length) return;

  var reduceMQ = window.matchMedia("(prefers-reduced-motion: reduce)");

  // Shared node/edge language as hero.js, in two tones so the graph reads on
  // both the dark bands (footer, locale) and the light Build section. Quiet
  // enough to be texture, present enough to actually carry the theme.
  var TONES = {
    dark: {
      edge: "169,176,182", core: "188,195,200", ring: "110,124,133",
      green: "43,192,121", orange: "255,126,62",
      edgeA: 0.16, ringA: 0.5, coreA: 0.9, haloA: 0.13, accentA: 0.82
    },
    light: {
      edge: "88,103,113", core: "68,80,90", ring: "144,154,161",
      green: "21,127,75", orange: "216,84,15",
      edgeA: 0.22, ringA: 0.42, coreA: 0.85, haloA: 0.16, accentA: 0.85
    }
  };

  function rand(a, b) { return a + Math.random() * (b - a); }

  /* Even-ish spread via rejection sampling, then nearest-neighbour edges —
     the same construction as the hero, frozen at a single instant. */
  function paint(canvas) {
    if (reduceMQ.matches) return;            // leave the canvas empty
    var ctx = canvas.getContext && canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    var cssW = canvas.clientWidth;
    var cssH = canvas.clientHeight;
    if (!cssW || !cssH) return;

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    var T = TONES[canvas.getAttribute("data-tone") === "light" ? "light" : "dark"];
    var density = parseFloat(canvas.getAttribute("data-density")) || 1;
    var area = cssW * cssH;
    var count = Math.max(8, Math.min(40, Math.round(area / 22000 * density)));
    var minDist = Math.sqrt(area / count) * 0.66;

    var nodes = [];
    var tries = 0, guard = count * 60;
    while (nodes.length < count && tries++ < guard) {
      var x = rand(0, cssW), y = rand(0, cssH), ok = true;
      for (var i = 0; i < nodes.length; i++) {
        var dx = nodes[i].x - x, dy = nodes[i].y - y;
        if (dx * dx + dy * dy < minDist * minDist) { ok = false; break; }
      }
      if (ok) {
        nodes.push({
          x: x, y: y,
          r: rand(1.6, 3),
          accent: Math.random() < 0.14 ? (Math.random() < 0.5 ? "green" : "orange") : null
        });
      }
    }

    // Edges: each node to its 2 nearest neighbours within range.
    var maxLen = minDist * 2.4;
    var seen = {};
    var edges = [];
    for (var a = 0; a < nodes.length; a++) {
      var dists = [];
      for (var b = 0; b < nodes.length; b++) {
        if (a === b) continue;
        var ex = nodes[a].x - nodes[b].x, ey = nodes[a].y - nodes[b].y;
        dists.push({ b: b, d: Math.hypot(ex, ey) });
      }
      dists.sort(function (m, n) { return m.d - n.d; });
      for (var j = 0; j < 2 && j < dists.length; j++) {
        if (dists[j].d > maxLen) break;
        var lo = Math.min(a, dists[j].b), hi = Math.max(a, dists[j].b);
        var key = lo + "-" + hi;
        if (seen[key]) continue;
        seen[key] = 1;
        edges.push({ a: lo, b: hi });
      }
    }

    // Edges
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(" + T.edge + "," + T.edgeA + ")";
    for (var e = 0; e < edges.length; e++) {
      var na = nodes[edges[e].a], nb = nodes[edges[e].b];
      ctx.beginPath();
      ctx.moveTo(na.x, na.y);
      ctx.lineTo(nb.x, nb.y);
      ctx.stroke();
    }

    // Nodes
    for (var n = 0; n < nodes.length; n++) {
      var nd = nodes[n];
      if (nd.accent) {
        var c = T[nd.accent];
        ctx.fillStyle = "rgba(" + c + "," + T.haloA + ")";
        ctx.beginPath(); ctx.arc(nd.x, nd.y, nd.r * 3.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(" + c + "," + T.accentA + ")";
        ctx.beginPath(); ctx.arc(nd.x, nd.y, nd.r * 1.05, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = "rgba(" + T.ring + "," + T.ringA + ")";
        ctx.beginPath(); ctx.arc(nd.x, nd.y, nd.r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(" + T.core + "," + T.coreA + ")";
        ctx.beginPath(); ctx.arc(nd.x, nd.y, nd.r * 0.5, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  function paintAll() {
    for (var i = 0; i < fields.length; i++) {
      try { paint(fields[i]); } catch (_) { /* leave canvas empty on failure */ }
    }
  }

  // Repaint on resize (debounced) so the field reflows with the layout.
  var rt = 0;
  window.addEventListener("resize", function () {
    clearTimeout(rt);
    rt = setTimeout(paintAll, 200);
  }, { passive: true });

  // React to reduced-motion toggled mid-session: clear or repaint.
  if (reduceMQ.addEventListener) {
    reduceMQ.addEventListener("change", function () {
      if (reduceMQ.matches) {
        for (var i = 0; i < fields.length; i++) {
          var c = fields[i], cx = c.getContext && c.getContext("2d");
          if (cx) cx.clearRect(0, 0, c.width, c.height);
        }
      } else {
        paintAll();
      }
    });
  }

  paintAll();
})();
