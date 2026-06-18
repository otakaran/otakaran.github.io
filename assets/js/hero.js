/* ==========================================================================
   OJA Solutions — Data-flow hero
   Evolves the original radial line-field (old_web/script.js) into a systems
   diagram: a node graph with data "packets" flowing along its edges.

   Guardrails:
   - Does nothing under prefers-reduced-motion (CSS shows a static backdrop).
   - Pauses when the tab is hidden or the hero scrolls out of view.
   - Caps node/packet counts and devicePixelRatio for steady performance.
   - Purely decorative; aria-hidden. No-JS gets the CSS fallback.
   ========================================================================== */
(function () {
  "use strict";

  var canvas = document.getElementById("hero-canvas");
  if (!canvas || !canvas.getContext) return;

  var reduceMQ = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (reduceMQ.matches) return; // CSS .hero__bg-fallback handles this case

  var ctx = canvas.getContext("2d", { alpha: true });

  var COLORS = {
    edge: "169,176,182",        // steel, faint
    edgeLit: "216,220,223",
    nodeCore: "110,124,133",    // steel-500
    nodeRing: "188,195,200",    // steel-300
    green: "43,192,121",        // safety green (on dark)
    orange: "255,126,62"        // signal orange (on dark)
  };

  var dpr = 1, W = 0, H = 0;
  var nodes = [], edges = [], adj = [], packets = [];
  var raf = 0, running = false, lastT = 0;
  var pointer = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, fine: false };

  function rand(a, b) { return a + Math.random() * (b - a); }

  /* Even-ish node spread via rejection sampling, then nearest-neighbour edges. */
  function build() {
    var cssW = canvas.clientWidth || window.innerWidth;
    var cssH = canvas.clientHeight || window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = cssW; H = cssH;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var area = W * H;
    var count = Math.max(22, Math.min(64, Math.round(area / 26000)));
    var minDist = Math.sqrt(area / count) * 0.62;

    nodes = [];
    var tries = 0, guard = count * 60;
    while (nodes.length < count && tries++ < guard) {
      var x = rand(0, W), y = rand(0, H), ok = true;
      for (var i = 0; i < nodes.length; i++) {
        var dx = nodes[i].x - x, dy = nodes[i].y - y;
        if (dx * dx + dy * dy < minDist * minDist) { ok = false; break; }
      }
      if (ok) {
        nodes.push({
          x: x, y: y, bx: x, by: y,
          z: rand(0.15, 1),                 // depth → parallax strength
          phase: rand(0, Math.PI * 2),
          amp: rand(1.5, 5),
          r: rand(1.6, 3.2),
          accent: Math.random() < 0.16 ? (Math.random() < 0.5 ? "green" : "orange") : null
        });
      }
    }

    // Edges: connect each node to its 2–3 nearest neighbours within range.
    var maxLen = minDist * 2.4;
    var seen = {};
    edges = [];
    adj = nodes.map(function () { return []; });
    for (var a = 0; a < nodes.length; a++) {
      var dists = [];
      for (var b = 0; b < nodes.length; b++) {
        if (a === b) continue;
        var ex = nodes[a].x - nodes[b].x, ey = nodes[a].y - nodes[b].y;
        dists.push({ b: b, d: Math.hypot(ex, ey) });
      }
      dists.sort(function (m, n) { return m.d - n.d; });
      var k = 2 + (Math.random() < 0.5 ? 1 : 0);
      for (var j = 0; j < k && j < dists.length; j++) {
        if (dists[j].d > maxLen) break;
        var lo = Math.min(a, dists[j].b), hi = Math.max(a, dists[j].b);
        var key = lo + "-" + hi;
        if (seen[key]) continue;
        seen[key] = 1;
        var idx = edges.length;
        edges.push({ a: lo, b: hi, len: dists[j].d });
        adj[lo].push(idx); adj[hi].push(idx);
      }
    }

    // Packets travelling along edges.
    var pCount = Math.min(40, Math.max(8, Math.round(edges.length * 0.5)));
    packets = [];
    for (var p = 0; p < pCount && edges.length; p++) packets.push(spawnPacket());
  }

  function spawnPacket() {
    var e = (Math.random() * edges.length) | 0;
    var forward = Math.random() < 0.5;
    return {
      e: e,
      from: forward ? edges[e].a : edges[e].b,
      to: forward ? edges[e].b : edges[e].a,
      t: Math.random(),
      speed: rand(0.05, 0.14),               // progress per second
      color: Math.random() < 0.5 ? "green" : "orange"
    };
  }

  /* When a packet reaches a node, continue onto a random incident edge. */
  function hop(pk) {
    var options = adj[pk.to];
    if (!options || !options.length) { var n = spawnPacket(); copy(n, pk); return; }
    var idx = options[(Math.random() * options.length) | 0];
    var e = edges[idx];
    pk.e = idx;
    pk.from = pk.to;
    pk.to = (e.a === pk.from) ? e.b : e.a;
    pk.t = 0;
  }
  function copy(src, dst) { dst.e = src.e; dst.from = src.from; dst.to = src.to; dst.t = src.t; dst.speed = src.speed; dst.color = src.color; }

  function update(dt) {
    pointer.x += (pointer.tx - pointer.x) * 0.06;
    pointer.y += (pointer.ty - pointer.y) * 0.06;
    var px = (pointer.x - 0.5), py = (pointer.y - 0.5);

    for (var i = 0; i < nodes.length; i++) {
      var nd = nodes[i];
      nd.phase += dt * 0.6;
      var par = nd.z * 14;
      nd.x = nd.bx + Math.cos(nd.phase) * nd.amp + px * par;
      nd.y = nd.by + Math.sin(nd.phase * 0.9) * nd.amp + py * par;
    }
    for (var p = 0; p < packets.length; p++) {
      var pk = packets[p];
      pk.t += pk.speed * dt;
      while (pk.t >= 1) { pk.t -= 1; hop(pk); }
    }
  }

  function render() {
    ctx.clearRect(0, 0, W, H);

    // Edges
    ctx.lineWidth = 1;
    for (var i = 0; i < edges.length; i++) {
      var na = nodes[edges[i].a], nb = nodes[edges[i].b];
      ctx.strokeStyle = "rgba(" + COLORS.edge + ",0.16)";
      ctx.beginPath();
      ctx.moveTo(na.x, na.y);
      ctx.lineTo(nb.x, nb.y);
      ctx.stroke();
    }

    // Nodes
    for (var n = 0; n < nodes.length; n++) {
      var nd = nodes[n];
      if (nd.accent) {
        var c = COLORS[nd.accent];
        ctx.fillStyle = "rgba(" + c + ",0.14)";
        ctx.beginPath(); ctx.arc(nd.x, nd.y, nd.r * 3.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(" + c + ",0.95)";
        ctx.beginPath(); ctx.arc(nd.x, nd.y, nd.r * 1.15, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = "rgba(" + COLORS.nodeRing + ",0.5)";
        ctx.beginPath(); ctx.arc(nd.x, nd.y, nd.r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(" + COLORS.nodeCore + ",0.9)";
        ctx.beginPath(); ctx.arc(nd.x, nd.y, nd.r * 0.5, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Packets (cheap glow = translucent halo + bright core)
    for (var p = 0; p < packets.length; p++) {
      var pk = packets[p], e = edges[pk.e];
      if (!e) continue;
      var f = nodes[pk.from], to = nodes[pk.to];
      var x = f.x + (to.x - f.x) * pk.t;
      var y = f.y + (to.y - f.y) * pk.t;
      var col = COLORS[pk.color];
      ctx.fillStyle = "rgba(" + col + ",0.16)";
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(" + col + ",0.95)";
      ctx.beginPath(); ctx.arc(x, y, 2.1, 0, Math.PI * 2); ctx.fill();
    }
  }

  function frame(ts) {
    if (!running) return;
    var dt = lastT ? Math.min((ts - lastT) / 1000, 0.05) : 0.016;
    lastT = ts;
    update(dt);
    render();
    raf = requestAnimationFrame(frame);
  }

  function start() { if (running) return; running = true; lastT = 0; raf = requestAnimationFrame(frame); }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }

  // Resize (debounced) — rebuild the graph to fit.
  var rt = 0;
  function onResize() {
    clearTimeout(rt);
    rt = setTimeout(function () { build(); if (!running) render(); }, 150);
  }
  window.addEventListener("resize", onResize, { passive: true });

  // Pause when tab hidden.
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop(); else start();
  });

  // Pause when the hero is scrolled out of view.
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) start(); else stop(); });
    }, { threshold: 0.02 });
    io.observe(canvas);
  }

  // Subtle pointer parallax (fine pointers only).
  if (window.matchMedia("(pointer: fine)").matches) {
    pointer.fine = true;
    window.addEventListener("pointermove", function (ev) {
      pointer.tx = ev.clientX / window.innerWidth;
      pointer.ty = ev.clientY / window.innerHeight;
    }, { passive: true });
  }

  // Swap between the animated canvas and the CSS static backdrop.
  var fallback = document.querySelector(".hero__bg-fallback");
  function showFallback(show) { if (fallback) fallback.classList.toggle("is-hidden", !show); }

  // React to reduced-motion being toggled mid-session.
  var onReduceChange = function () {
    if (reduceMQ.matches) { stop(); ctx.clearRect(0, 0, W, H); showFallback(true); }
    else { showFallback(false); build(); start(); }
  };
  if (reduceMQ.addEventListener) reduceMQ.addEventListener("change", onReduceChange);

  try { build(); } catch (e) { return; } // on failure, leave the CSS fallback in place
  showFallback(false);
  start();
})();
