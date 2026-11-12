/* The document's journey — a scroll-driven walk through the RAG pipeline.
 *
 * Every act is a sticky stage whose scene is a function of one number: how far
 * through that act you have scrolled, 0..1. Nothing animates on a timer, so
 * scrubbing backwards is exact and there is no state to fall out of sync.
 *
 * Tool names here are the real supported set, taken from content/rag-routing.md
 * and the parser copy -- not illustrative placeholders.
 */
(function () {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  // Sub-progress: map p through [a,b] onto 0..1, so one act can stage several
  // beats without any of them needing their own scroll listener.
  var seg = function (p, a, b) { return clamp((p - a) / (b - a), 0, 1); };
  var ease = function (t) { return t * t * (3 - 2 * t); };

  function e(tag, attrs, kids) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    (kids || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }
  function svg(vb) {
    return e("svg", { viewBox: vb, "aria-hidden": "true" });
  }
  /* Scene type is scaled globally rather than per call. Kept at 1 because the
     whole 1.25x now comes from the canvas (see .scene svg max-width): one
     multiplier is far easier to reason about than two, and scaling the canvas
     grows the geometry with the type instead of only the labels. */
  var TYPE = 1;

  function txt(x, y, s, cls, anchor, size) {
    var t = e("text", {
      x: x, y: y, "text-anchor": anchor || "start",
      "font-size": ((size || 11) * TYPE).toFixed(1), class: cls || ""
    });
    t.textContent = s;
    return t;
  }

  /* ---------------------------------------------------------------- acts -- */

  /* Taken from the SDK vendor docs (sdk/docs/.../vendors/), not from marketing
     copy. Marker, Tika and OpenParse appear in blog comparisons but are not
     supported chunkers, and PageIndex is deliberately NOT in the store list --
     it is vectorless, so it belongs with the retrieval strategies below. */
  var CHUNKERS = ["LangExtract", "LiteParse", "Unstructured", "record chunker"];
  var STORES = ["Cloudflare Vectorize", "Qdrant", "Pinecone", "Redis",
                "MongoDB Atlas", "Vertex AI", "Turso", "Couchbase"];
  var ROUTES = ["plain vector", "RAPTOR", "PageIndex", "Neo4j Hybrid",
                "LightRAG", "no-retrieval"];
  var ATTACKS = ["prompt injection", "jailbreak", "PII exfiltration",
                 "system-prompt leak", "toxicity bait", "hallucination probe",
                 "tool-gate bypass", "context stuffing"];
  /* Attribution (which defense layer let a probe through) and attestation
     (Ed25519-signed manifests that verify offline) stay first-party -- that is
     what the SDK docs mean by an owned harness. Promptfoo runs INSIDE it as a
     probe source, so the stage names both the harness and the tool. */
  var REDTEAM = ["Promptfoo", "Divinci probe taxonomy", "defense-layer attribution",
                 "TrustBench harness", "Ed25519 attestation"];
  var GUARDS = ["PII redaction", "Stanford NER fallback", "toxicity threshold",
                "off-topic refusal", "Slack", "PagerDuty"];

  /* Vendor marks. Only files that actually exist are referenced; anything
     missing degrades to the wordmark alone rather than a broken image, so
     dropping a file into /brand/vendors/ is all it takes to light one up.
     Third-party marks are used nominatively, to say which integrations are
     supported -- keep them unmodified and unrecoloured. */
  var LOGOS = {
    "Cloudflare Vectorize": "/pipeline/brand/vendors/cloudflare.svg",
    "Qdrant": "/pipeline/brand/vendors/qdrant.svg",
    "Pinecone": "https://pub-fb3e683317b24cf8b4260121edae02be.r2.dev/brand/vendors/pinecone.webp",
    "Redis": "/pipeline/brand/vendors/redis.svg",
    "MongoDB Atlas": "/pipeline/brand/vendors/mongodb.svg",
    "Vertex AI": "/pipeline/brand/companies/google.svg",
    "Turso": "/pipeline/brand/vendors/turso.svg",
    "Couchbase": "/pipeline/brand/vendors/couchbase.svg",
    "Neo4j Hybrid": "/pipeline/brand/vendors/neo4j.svg",
    "PageIndex": "https://pub-fb3e683317b24cf8b4260121edae02be.r2.dev/brand/vendors/pageindex.webp",
    "Unstructured": "https://pub-fb3e683317b24cf8b4260121edae02be.r2.dev/brand/vendors/unstructured.webp",
    "PII redaction": "/pipeline/brand/vendors/presidio.svg",
    "Slack": "/pipeline/brand/vendors/slack.svg",
    "PagerDuty": "/pipeline/brand/vendors/pagerduty.svg",
    "LangExtract": "/pipeline/brand/vendors/langextract.svg",
    // LiteParse is built on LlamaIndex, so it carries the LlamaIndex wordmark.
    "LiteParse": "/pipeline/brand/vendors/llamaindex-icon.svg",
    "LightRAG": "https://pub-fb3e683317b24cf8b4260121edae02be.r2.dev/brand/vendors/lightrag.webp",
    "Promptfoo": "/pipeline/brand/vendors/promptfoo.svg"
    // record chunker and RAPTOR have no third-party mark -- ours, or
    // techniques rather than products.
  };

  // Arm size as a fraction of viewport width; ?armscale=0.5 to trim it.
  var ARM_SCALE = (function () {
    var v = parseFloat(new URLSearchParams(location.search).get("armscale"));
    return isNaN(v) ? 0.62 : v;
  })();

  var CHUNKS = 6;

  var ACTS = [
    {
      id: "parse", step: "Stage 01", title: "Pick how it gets read.",
      body: "A 40-page policy PDF arrives. Chunking decides what retrieval can " +
            "ever find — a parser that flattens a table into prose caps the " +
            "quality of every answer downstream, and no store or embedding " +
            "model recovers it. Divinci scores each option on your document, " +
            "then splits on structure rather than a character count.",
      chips: CHUNKERS, build: parseScene,
      /* Only Unstructured is BYOK -- the catalog has it as credentials=byok,
         authProvider=UNSTRUCTURED, while LangExtract / LiteParse / the record
         chunker are all divinci-managed. The note used to claim "any of these",
         which read as though every option demanded a key of your own. */
      note: { text: "all managed — Unstructured takes your key",
              at: [0.14, 0.42], left: "1.5vw", bottom: "26vh" },
      // circle the layout region the winning parser recovered
      mark: { d: "M206 106 C 186 140, 192 200, 226 216 C 272 232, 352 230, 380 208 " +
                 "C 400 190, 398 124, 372 110 C 340 94, 226 92, 210 110",
              from: 0.34, to: 0.56 }
    },
    {
      id: "qa", step: "Stage 02", title: "AutoRAG writes the questions.",
      body: "Each chunk is interrogated for what it can answer. Those " +
            "question–answer pairs are kept — they become the evaluation set " +
            "that every later stage is graded against.",
      build: qaScene
    },
    {
      id: "vector", step: "Stage 03", title: "Chunks become vectors.",
      body: "Embedded once, stored wherever you already live — the default " +
            "that needs no account of your own, or the database you already " +
            "pay for. Fourteen stores; the index is a deployment detail, not " +
            "an architecture commitment.",
      chips: STORES, build: vectorScene
    },
    {
      id: "route", step: "Stage 04", title: "AutoRAG runs again, and routes.",
      body: "Now it quizzes the model with the saved questions and watches " +
            "which strategy actually answers each one — flat vector search, a " +
            "summary tree, a vectorless document tree, or a graph. The winner " +
            "becomes that chunk's route.",
      chips: ROUTES, build: routeScene,
      // ticks the right-hand end of the PageIndex row, clear of its label
      // a tick is one brush stroke, not handwriting -- see Brush's FREEZE_FRAME
      mark: { d: "M516 173 L 528 186 L 558 156", from: 0.54, to: 0.86,
              rigid: true, persist: true }
    },
    {
      id: "redteam", step: "Stage 05", title: "Then it gets attacked.",
      body: "Adversarial probes run against the assembled release from every " +
            "direction — Promptfoo's suites alongside our own taxonomy. A probe " +
            "that lands has to say which defense layer let it through, so " +
            "attribution stays inside the harness rather than in a scanner " +
            "bolted on the outside. Every run is signed and verifies offline.",
      chips: REDTEAM, build: redteamScene
    },
    {
      id: "guard", step: "Stage 06", title: "Guards and triggers go on.",
      body: "Moderation flags, notification triggers and security settings " +
            "attach to the release itself — so they ship, and roll back, with " +
            "it. PII detection runs on Microsoft Presidio by default, with " +
            "Stanford NER as the fallback; neither needs a key of your own.",
      chips: GUARDS, build: guardScene
    },
    {
      id: "chat", step: "Stage 07", title: "Out comes an answer you can trace.",
      body: "The same document, now answering hard questions with the chunk, " +
            "the route and the score behind every claim.",
      build: chatScene,
      mark: { d: "M104 214 C 180 222, 300 220, 372 212", from: 0.72, to: 0.94 }
    }
  ];

  /* -------------------------------------------------------------- scenes -- */

  /* A circle whose rim is N alternating semicircular lobes -- built from arcs
     rather than a blob path, so it stays a true circle at radius R and the
     wave is exactly the chord/2 bulge. `phase` rotates the lobe pattern, which
     is what lets it undulate on scroll. */
  function wavyCircle(cx, cy, R, N, phase) {
    var chord = 2 * R * Math.sin(Math.PI / N);
    var r = chord / 2, d = "";
    for (var i = 0; i <= N; i++) {
      var a = (i / N) * Math.PI * 2 + phase;
      var x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
      if (i === 0) d = "M" + x.toFixed(2) + " " + y.toFixed(2);
      else d += " A" + r.toFixed(2) + " " + r.toFixed(2) + " 0 0 " +
                (i % 2 ? 1 : 0) + " " + x.toFixed(2) + " " + y.toFixed(2);
    }
    return d + "Z";
  }

  /* An organic swimming line: a sine wave along -len..0 whose amplitude tapers
     to nothing at the head, so it reads as a tail flicking behind a nose. */
  function squiggle(len, amp, waves, phase) {
    var d = "", N = 18;
    for (var i = 0; i <= N; i++) {
      var u = i / N;                        // 0 = tail, 1 = head
      var x = -len * (1 - u);
      var taper = Math.pow(u, 0.65) * (1 - u * 0.15);
      var y = Math.sin(u * Math.PI * 2 * waves + phase) * amp * (1 - taper * 0.85);
      d += (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
    }
    return d;
  }

  /* One geometric motif per act, drawn faintly behind the scene. Each is
     generated from the stage's own idea -- a grid that subdivides, a lattice,
     a branching tree -- so the eight acts read as different places rather than
     the same canvas with different boxes on it. */
  function motif(kind) {
    var g = e("g", { opacity: 0.055, fill: "none", stroke: "var(--ink)",
                     "stroke-width": 1.2 });
    var i, j, a, x, y;
    if (kind === "__gone") {
      for (i = 0; i < 7; i++)
        g.appendChild(e("rect", { x: 300 - 22 * (i + 1), y: 210 - 15 * (i + 1),
                                  width: 44 * (i + 1), height: 30 * (i + 1), rx: 4 }));
    } else if (kind === "parse") {
      for (i = 1; i <= 7; i++)
        g.appendChild(e("path", { d: "M" + (300 - i * 26) + " 330 A " + (i * 26) +
                                     " " + (i * 26) + " 0 0 1 " + (300 + i * 26) + " 330" }));
    } else if (kind === "qa") {
      for (i = 0; i < 9; i++) for (j = 0; j < 6; j++)
        g.appendChild(e("rect", { x: 70 + i * 52, y: 60 + j * 52, width: 26, height: 26, rx: 3 }));
    } else if (kind === "vector") {
      for (i = 0; i < 7; i++) for (j = 0; j < 5; j++) {
        x = 80 + i * 74 + (j % 2 ? 37 : 0); y = 60 + j * 76;
        var d = "";
        for (var k = 0; k < 6; k++) {
          a = k / 6 * Math.PI * 2 + Math.PI / 6;
          d += (k ? "L" : "M") + (x + Math.cos(a) * 26).toFixed(1) + " " +
               (y + Math.sin(a) * 26).toFixed(1);
        }
        g.appendChild(e("path", { d: d + "Z" }));
      }
    } else if (kind === "route") {
      (function branch(x0, y0, len, ang, depth) {
        if (depth > 4) return;
        var x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len;
        g.appendChild(e("path", { d: "M" + x0 + " " + y0 + " L" + x1.toFixed(1) + " " + y1.toFixed(1) }));
        branch(x1, y1, len * 0.72, ang - 0.5, depth + 1);
        branch(x1, y1, len * 0.72, ang + 0.5, depth + 1);
      })(40, 210, 96, 0, 0);
    } else if (kind === "redteam") {
      for (i = 0; i < 36; i++) {
        a = i / 36 * Math.PI * 2;
        g.appendChild(e("path", { d: "M" + (300 + Math.cos(a) * 116).toFixed(1) + " " +
          (210 + Math.sin(a) * 116).toFixed(1) + " L" + (300 + Math.cos(a) * 196).toFixed(1) +
          " " + (210 + Math.sin(a) * 196).toFixed(1) }));
      }
    } else if (kind === "guard") {
      for (i = 0; i < 5; i++) {
        var sc = 1 + i * 0.5;
        g.appendChild(e("path", { d: "M300 " + (210 - 44 * sc) + " l " + (34 * sc) + " " +
          (16 * sc) + " v " + (26 * sc) + " c 0 " + (22 * sc) + " -" + (16 * sc) + " " +
          (34 * sc) + " -" + (34 * sc) + " " + (42 * sc) + " c -" + (18 * sc) + " -" +
          (8 * sc) + " -" + (34 * sc) + " -" + (20 * sc) + " -" + (34 * sc) + " -" +
          (42 * sc) + " v -" + (26 * sc) + " z" }));
      }
    } else if (kind === "chat") {
      for (i = 0; i < 5; i++)
        g.appendChild(e("path", { d: "M" + (120 + i * 18) + " " + (120 + i * 14) +
          " h " + (360 - i * 36) + " a 14 14 0 0 1 14 14 v " + (120 - i * 20) +
          " a 14 14 0 0 1 -14 14 h -" + (330 - i * 36) + " l -26 26 v -26 a 14 14 0 0 1 -14 -14 v -" +
          (94 - i * 20) + " a 14 14 0 0 1 14 -14 z" }));
    }
    return g;
  }

  function page(x, y, w, h, opts) {
    opts = opts || {};
    return e("rect", {
      x: x, y: y, width: w, height: h, rx: opts.r || 3,
      fill: opts.fill || "var(--card)",
      stroke: opts.stroke || "var(--ink)",
      "stroke-width": opts.sw || 1, opacity: opts.o == null ? 1 : opts.o
    });
  }
  function lines(x, y, w, n, gap, o) {
    var g = e("g", { opacity: o == null ? 0.5 : o });
    for (var i = 0; i < n; i++) {
      g.appendChild(e("rect", {
        x: x, y: y + i * gap, width: i % 3 === 2 ? w * 0.62 : w, height: 2, rx: 1,
        fill: "var(--ink)"
      }));
    }
    return g;
  }

  // 01 — a page splits into labelled chunks
  function chunkScene() {
    var s = svg("0 0 600 420"), g = e("g", {});
    var doc = e("g", {});
    doc.appendChild(page(210, 30, 180, 360));
    doc.appendChild(lines(228, 52, 144, 22, 14));
    g.appendChild(doc);

    var parts = [];
    for (var i = 0; i < CHUNKS; i++) {
      var grp = e("g", { opacity: 0 });
      grp.appendChild(page(210, 30 + i * 60, 180, 52, { fill: "var(--card)" }));
      grp.appendChild(lines(228, 44 + i * 60, 144, 3, 11, 0.55));
      grp.appendChild(txt(398, 60 + i * 60, "chunk " + (i + 1), "mono", "start", 10));
      g.appendChild(grp);
      parts.push(grp);
    }
    s.appendChild(g);

    return { svg: s, render: function (p) {
      var split = ease(seg(p, 0.05, 0.18));
      doc.setAttribute("opacity", (1 - split).toFixed(3));
      for (var i = 0; i < CHUNKS; i++) {
        /* Alternate sides, so the chunks vacate the document's own column
           instead of fanning within it. Left takes 0,2,4; right 1,3,5.

           Sideways FIRST, then vertical. Doing both at once sent chunks bound
           for opposite sides through each other's space -- they start stacked,
           so their paths cross. Once they are 196u apart horizontally, no
           vertical move can collide. */
        var out = ease(seg(p, 0.18 + i * 0.022, 0.40 + i * 0.022));
        var settle = ease(seg(p, 0.42, 0.60));
        var row = Math.floor(i / 2);
        var dx = (i % 2 ? 196 : -196) * out;
        var dy = ((44 + row * 122) - (30 + i * 60)) * settle;
        parts[i].setAttribute("opacity", split);
        parts[i].setAttribute("transform",
          "translate(" + dx.toFixed(1) + "," + dy.toFixed(1) + ")");
      }
    }};
  }

  // 01 — layout regions are detected, a parser wins, then the chunks peel off
  function parseScene() {
    var s = svg("0 0 600 420");
    var docG = e("g", {});
    docG.appendChild(page(210, 30, 180, 360));
    docG.appendChild(lines(228, 52, 144, 4, 14, 0.35));
    s.appendChild(docG);

    var regions = [
      { x: 228, y: 112, w: 144, h: 48, label: "table" },
      { x: 228, y: 176, w: 66, h: 66, label: "figure" },
      { x: 306, y: 176, w: 66, h: 66, label: "heading" },
      { x: 228, y: 258, w: 144, h: 34, label: "footnote" }
    ];
    var boxes = regions.map(function (r) {
      var g = e("g", { opacity: 0 });
      g.appendChild(e("rect", {
        x: r.x, y: r.y, width: r.w, height: r.h, rx: 2, fill: "none",
        stroke: "var(--accent)", "stroke-width": 1.2, "stroke-dasharray": "4 3"
      }));
      g.appendChild(txt(r.x + 3, r.y - 4, r.label, "mono", "start", 9.5));
      s.appendChild(g);
      return g;
    });

    /* The chunks the winning parser produces. They live in the same act now:
       the document is scored, then it comes apart -- which is the part a RAG
       engineer actually cares about, so it earns the screen time that a
       standalone "documents get chunked" stage did not. */
    var parts = [];
    for (var i = 0; i < CHUNKS; i++) {
      var grp = e("g", { opacity: 0 });
      grp.appendChild(page(210, 30 + i * 60, 180, 52, { fill: "var(--card)" }));
      grp.appendChild(lines(228, 44 + i * 60, 144, 3, 11, 0.55));
      grp.appendChild(txt(398, 60 + i * 60, "chunk " + (i + 1), "mono", "start", 10));
      s.appendChild(grp);
      parts.push(grp);
    }

    return { svg: s, render: function (p) {
      boxes.forEach(function (b, i) {
        var u = ease(seg(p, 0.10 + i * 0.07, 0.26 + i * 0.07));
        // regions fade back out once the winner is circled
        b.setAttribute("opacity", (u * (1 - ease(seg(p, 0.56, 0.66)))).toFixed(3));
      });

      // after the mark: the page becomes chunks, then they peel to both sides
      var split = ease(seg(p, 0.60, 0.70));
      docG.setAttribute("opacity", (1 - split).toFixed(3));
      for (var i = 0; i < CHUNKS; i++) {
        var out = ease(seg(p, 0.70 + i * 0.025, 0.86 + i * 0.025));
        var settle = ease(seg(p, 0.86, 0.97));
        var row = Math.floor(i / 2);
        var dx = (i % 2 ? 196 : -196) * out;
        var dy = ((44 + row * 122) - (30 + i * 60)) * settle;
        parts[i].setAttribute("opacity", split.toFixed(3));
        parts[i].setAttribute("transform",
          "translate(" + dx.toFixed(1) + "," + dy.toFixed(1) + ")");
      }
    }, chipAt: function (p) {
      var n = CHUNKERS.length;
      var i = Math.floor(seg(p, 0.12, 0.5) * n);
      return { on: clamp(i + 1, 0, n), pick: p > 0.52 ? 0 : -1 };
    }};
  }

  // 03 — each chunk emits QA pairs into a saved set
  function qaScene() {
    var s = svg("0 0 600 420");
    var QS = ["What is the retention period?", "Who approves an exception?",
              "Which regions are in scope?", "What triggers a breach notice?",
              "How long are logs kept?", "Who owns the DPA?"];
    var rows = [], cards = [];
    for (var i = 0; i < CHUNKS; i++) {
      var y = 34 + i * 58;
      s.appendChild(page(30, y, 120, 44, { o: 0.9 }));
      s.appendChild(lines(42, y + 12, 96, 2, 10, 0.45));
      var c = e("g", { opacity: 0 });
      c.appendChild(page(210, y, 300, 44, { fill: "var(--card)", stroke: "var(--accent)" }));
      c.appendChild(txt(224, y + 19, QS[i], "mono", "start", 10));
      c.appendChild(txt(224, y + 33, "→ chunk " + (i + 1) + " · saved to eval set",
                        "mono dim", "start", 9));
      s.appendChild(c);
      cards.push(c); rows.push(y);
    }
    return { svg: s, render: function (p) {
      cards.forEach(function (c, i) {
        var t = ease(seg(p, 0.1 + i * 0.11, 0.34 + i * 0.11));
        c.setAttribute("opacity", t);
        c.setAttribute("transform", "translate(" + lerp(-70, 0, t).toFixed(1) + ",0)");
      });
    }};
  }

  // 04 — chunks become coordinates, then land in a spoked index
  function vectorScene() {
    var s = svg("0 0 600 420");
    var nums = [];
    for (var i = 0; i < CHUNKS; i++) {
      // two columns of three, so the block stack cannot run into the copy
      var col = i % 2, row = Math.floor(i / 2);
      var x = 14 + col * 132, y = 92 + row * 78;
      var n = e("g", { opacity: 0 });
      n.appendChild(page(x, y, 124, 44, { o: 0.9 }));
      n.appendChild(txt(x + 10, y + 19, "chunk " + (i + 1), "mono dim", "start", 9));
      n.appendChild(txt(x + 10, y + 34,
        "[" + [0.42, -0.18, 0.77].map(function (v, j) {
          return (v + i * 0.07 * (j % 2 ? -1 : 1)).toFixed(2);
        }).join(", ") + "…]", "mono", "start", 9));
      s.appendChild(n); nums.push(n);
    }

    /* The index as a wheel: six vector nodes on a rim, each on its own spoke,
       the whole thing turning as you scroll. A static scatter said "points in
       space"; the spokes say "indexed and addressable". */
    var GX = 430, GY = 210, GR = 118;
    var wheel = e("g", {});

    /* Back to the spiral-arm galaxy -- the even phyllotaxis disc read as a
       diagram, this reads as an index with structure. Links are drawn between
       neighbouring stars rather than to a hub. */
    var pts = [], NP = 46;
    for (i = 0; i < NP; i++) {
      var a = (i / NP) * Math.PI * 2, rr = 38 + (i % 7) * 13;
      pts.push({ x: GX + Math.cos(a) * rr, y: GY + Math.sin(a) * rr * 0.86,
                 vec: i % 8 === 0 });
    }

    // each star links to its two nearest neighbours; vector stars also chain
    // to the next vector star, which is what traces a path through the index
    var links = [], vecIdx = pts.map(function (q, i2) { return q.vec ? i2 : -1; })
                                .filter(function (v) { return v >= 0; });
    pts.forEach(function (q, qi) {
      var near = pts.map(function (o, oi) { return { oi: oi, d: Math.hypot(o.x - q.x, o.y - q.y) }; })
        .filter(function (o) { return o.oi !== qi && o.d > 1; })
        .sort(function (a2, b2) { return a2.d - b2.d; }).slice(0, q.vec ? 3 : 1);
      near.forEach(function (o) {
        if (o.oi < qi) return;                       // one line per pair
        links.push({ el: e("line", { x1: q.x, y1: q.y, x2: pts[o.oi].x, y2: pts[o.oi].y,
                                     stroke: q.vec ? "var(--accent)" : "var(--ink)",
                                     "stroke-width": q.vec ? 1.1 : 0.7, opacity: 0 }),
                     vec: q.vec });
      });
    });
    vecIdx.forEach(function (vi2, k) {
      var nx = vecIdx[(k + 1) % vecIdx.length];
      links.push({ el: e("line", { x1: pts[vi2].x, y1: pts[vi2].y,
                                   x2: pts[nx].x, y2: pts[nx].y,
                                   stroke: "var(--accent)", "stroke-width": 1.2, opacity: 0 }),
                   vec: true });
    });
    links.forEach(function (l) { wheel.appendChild(l.el); });

    /* One spoke per chunk block, anchored at the block and pinned to that
       chunk's star on the rim. The star travels with the wheel, so the spoke
       sweeps like a gear arm — which is the claim being made: these six blocks
       ARE those six points, and the link survives the rotation.
       The spokes live OUTSIDE `wheel` deliberately. Inside it they would rotate
       bodily and tear away from the blocks; only their far end may move, so the
       rotation is applied by hand to that endpoint each frame. */
    /* Paired by height rather than by index: blocks run top-to-bottom, so
       matching them to stars sorted the same way starts the fan untangled.
       It still crosses as the wheel turns — that is a gear, not a bug. */
    var spokeStars = pts.filter(function (q) { return q.vec; })
                        .slice().sort(function (a3, b3) { return a3.y - b3.y; });
    var spokes = [];
    for (i = 0; i < CHUNKS; i++) {
      var sc = i % 2, sr = Math.floor(i / 2);
      var bx = 14 + sc * 132 + 124, by = 92 + sr * 78 + 22;   // block's right edge, mid-height
      spokes.push({
        el: e("line", { x1: bx, y1: by, x2: bx, y2: by, stroke: "var(--accent)",
                        "stroke-width": 0.9, "stroke-linecap": "round", opacity: 0 }),
        from: [bx, by], star: spokeStars[i % spokeStars.length]
      });
    }
    /* Behind EVERYTHING, chunk blocks included. Appended, these ran straight
       across the block faces and through their text; the blocks are opaque, so
       putting the spokes underneath lets each line emerge from its own block. */
    spokes.forEach(function (sp) { s.insertBefore(sp.el, s.firstChild); });

    var nodes = pts.map(function (q) {
      var n = e("circle", { cx: q.x, cy: q.y, r: q.vec ? 6 : 2.3,
                            fill: q.vec ? "var(--accent)" : "var(--ink)",
                            opacity: q.vec ? 0 : 0.3 });
      wheel.appendChild(n);
      return n;
    });
    s.appendChild(wheel);

    return { svg: s, render: function (p) {
      nums.forEach(function (n, i) {
        n.setAttribute("opacity", ease(seg(p, 0.04 + i * 0.05, 0.24 + i * 0.05)));
      });
      var t = ease(seg(p, 0.18, 0.72));
      var deg = p * 180;
      wheel.setAttribute("transform",
        "rotate(" + deg.toFixed(1) + " " + GX + " " + GY + ")");
      wheel.setAttribute("opacity", (0.25 + 0.75 * t).toFixed(3));

      /* Re-derive each spoke's far end from the same rotation the wheel group
         gets. SVG rotate() is clockwise in a y-down space, which is exactly
         [x cos - y sin, x sin + y cos] about the centre — so this tracks the
         star rather than approximating it. */
      var rad = deg * Math.PI / 180, ca = Math.cos(rad), sa = Math.sin(rad);
      spokes.forEach(function (sp, i2) {
        var dx = sp.star.x - GX, dy = sp.star.y - GY;
        sp.el.setAttribute("x2", (GX + dx * ca - dy * sa).toFixed(1));
        sp.el.setAttribute("y2", (GY + dx * sa + dy * ca).toFixed(1));
        // each spoke reaches out just after its block has landed
        var u = ease(seg(p, 0.26 + i2 * 0.045, 0.48 + i2 * 0.045));
        sp.el.setAttribute("opacity", (u * 0.3 * (0.3 + 0.7 * t)).toFixed(3));
      });
      // links thread outward through the galaxy as you scroll
      links.forEach(function (l, i) {
        var u = ease(seg(p, 0.20 + (i % 18) * 0.018, 0.42 + (i % 18) * 0.018));
        l.el.setAttribute("opacity", (u * (l.vec ? 0.75 : 0.22)).toFixed(3));
      });
      var vi = 0;
      pts.forEach(function (q, i) {
        if (!q.vec) return;
        var u = ease(seg(p, 0.22 + vi * 0.06, 0.44 + vi * 0.06));
        nodes[i].setAttribute("opacity", u.toFixed(3));
        nodes[i].setAttribute("r", (3 + u * 3.4).toFixed(1));
        vi++;
      });
    }, chipAt: function (p) {
      return { on: Math.round(seg(p, 0.35, 0.9) * STORES.length), pick: p > 0.9 ? 0 : -1 };
    }};
  }

  // 05 — the model is quizzed; each chunk gets its winning route
  function routeScene() {
    var s = svg("0 0 600 420");
    s.appendChild(page(240, 170, 120, 74, { fill: "var(--card)", sw: 1.4 }));
    s.appendChild(txt(300, 202, "model", "mono", "middle", 12));
    s.appendChild(txt(300, 220, "under test", "mono dim", "middle", 9));
    var wires = [], labels = [];
    for (var i = 0; i < CHUNKS; i++) {
      var y = 40 + i * 58;
      s.appendChild(page(20, y, 96, 34, { o: 0.85 }));
      s.appendChild(txt(32, y + 22, "chunk " + (i + 1), "mono", "start", 10));
      var w = e("path", {
        d: "M116 " + (y + 17) + " C 180 " + (y + 17) + ", 190 207, 240 207",
        fill: "none", stroke: "var(--accent)", "stroke-width": 1.1, opacity: 0
      });
      s.appendChild(w); wires.push(w);
      var l = e("g", { opacity: 0 });
      l.appendChild(page(400, y, 176, 34, { fill: "var(--card)", stroke: "var(--good)" }));
      l.appendChild(txt(412, y + 22, ROUTES[i], "mono", "start", 10));
      s.appendChild(l); labels.push(l);
    }
    return { svg: s, render: function (p) {
      wires.forEach(function (w, i) {
        var t = ease(seg(p, 0.08 + i * 0.09, 0.3 + i * 0.09));
        w.setAttribute("opacity", t * 0.8);
        var L = w.getTotalLength ? w.getTotalLength() : 200;
        w.style.strokeDasharray = L + " " + L;
        w.style.strokeDashoffset = L * (1 - t);
      });
      labels.forEach(function (l, i) {
        var t = ease(seg(p, 0.3 + i * 0.09, 0.5 + i * 0.09));
        l.setAttribute("opacity", t);
        l.setAttribute("transform", "translate(" + lerp(26, 0, t).toFixed(1) + ",0)");
      });
    }, chipAt: function (p) {
      return { on: Math.round(seg(p, 0.3, 0.95) * ROUTES.length), pick: -1 };
    }};
  }

  // 06 — probes swim in, strike the shield, and are turned away
  function redteamScene() {
    var s = svg("0 0 600 420");
    var CX = 300, CY = 210, R = 74, SHIELD = R + 18;

    var shieldRing = e("circle", { cx: CX, cy: CY, r: SHIELD, fill: "none",
                                   stroke: "var(--good)", "stroke-width": 2.4, opacity: 0.45 });
    s.appendChild(shieldRing);

    // the release itself: a wavy rim, not a plain disc
    var rim = e("path", { d: wavyCircle(CX, CY, R, 16, 0), fill: "var(--card)",
                          stroke: "var(--ink)", "stroke-width": 1.4 });
    s.appendChild(rim);
    s.appendChild(txt(CX, CY - 4, "release", "mono", "middle", 13));
    s.appendChild(txt(CX, CY + 14, "under probe", "mono dim", "middle", 9));

    var shots = ATTACKS.map(function (name, i) {
      var a = (-140 + i * (280 / (ATTACKS.length - 1))) * Math.PI / 180;
      var ang = a + (i % 2 ? 0.16 : -0.16);
      var g = e("g", { opacity: 0 });
      var body = e("g", {
        transform: "rotate(" + (ang * 180 / Math.PI + 180).toFixed(1) + ")"
      });
      var tail = e("path", {
        d: squiggle(52, 7, 1.5, 0), fill: "none", stroke: "var(--bad)",
        "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round"
      });
      body.appendChild(tail);
      body.appendChild(e("circle", { cx: 0, cy: 0, r: 2.6, fill: "var(--bad)" }));
      g.appendChild(body);
      var lx = Math.cos(ang) * 34, ly = Math.sin(ang) * 34;
      g.appendChild(txt(lx, ly + 4, name, "mono",
                        Math.cos(ang) >= 0 ? "start" : "end", 11));
      s.appendChild(g);
      return { g: g, tail: tail, ang: ang, dir: i % 3 };
    });

    /* Impact marks sit on the SHIELD radius, not the release rim -- the point
       of the scene is that nothing reaches the inner shape. */
    var sparks = shots.map(function () {
      var k = e("circle", { r: 3, fill: "var(--bad)", opacity: 0 });
      s.appendChild(k);
      return k;
    });

    return { svg: s, render: function (p) {
      rim.setAttribute("d", wavyCircle(CX, CY, R, 16, p * Math.PI * 0.6));
      var maxPulse = 0;
      shots.forEach(function (sh, i) {
        var t = seg(p, 0.05 + i * 0.075, 0.46 + i * 0.075);
        if (t <= 0 || t >= 1) { sh.g.setAttribute("opacity", 0); sparks[i].setAttribute("opacity", 0); return; }
        var HIT = 0.58, far = 300, near = SHIELD + 8, dist, u = 0, bend = 0;
        if (t < HIT) {
          dist = lerp(far, near, ease(t / HIT));
        } else {
          u = (t - HIT) / (1 - HIT);
          dist = lerp(near, near + 96, ease(u));
          bend = ease(u) * (sh.dir === 0 ? 0.30 : sh.dir === 1 ? -0.30 : 0.14);
        }
        // the tail keeps flicking the whole way in, faster while approaching
        sh.tail.setAttribute("d", squiggle(52, 7, 1.5, t * 26));
        var ang = sh.ang + bend;
        var x = CX + Math.cos(ang) * dist, y = CY + Math.sin(ang) * dist;
        var fade = t < HIT ? Math.min(1, t / 0.12) : 1 - ease(u) * 0.9;
        sh.g.setAttribute("opacity", fade.toFixed(3));
        sh.g.setAttribute("transform",
          "translate(" + x.toFixed(1) + "," + y.toFixed(1) + ")");
        var sp = t > HIT - 0.06 && t < HIT + 0.1 ? 1 - Math.abs(t - HIT) / 0.1 : 0;
        sparks[i].setAttribute("cx", (CX + Math.cos(sh.ang) * SHIELD).toFixed(1));
        sparks[i].setAttribute("cy", (CY + Math.sin(sh.ang) * SHIELD).toFixed(1));
        sparks[i].setAttribute("r", (2.4 + sp * 4).toFixed(1));
        sparks[i].setAttribute("opacity", (sp * 0.95).toFixed(3));
        if (sp > maxPulse) maxPulse = sp;
      });
      shieldRing.setAttribute("opacity", (0.45 + maxPulse * 0.5).toFixed(3));
      shieldRing.setAttribute("stroke-width", (2.4 + maxPulse * 1.8).toFixed(2));
    }, chipAt: function (p) {
      return { on: Math.round(seg(p, 0.35, 0.95) * REDTEAM.length), pick: -1 };
    }};
  }

  // 07 — guards attach to the release
  var GUARD_ITEMS = [
    { name: "PII redaction",   logo: "/pipeline/brand/vendors/presidio.svg" },
    { name: "Stanford NER",    glyph: "ner" },
    { name: "toxicity",        glyph: "shield" },
    { name: "off-topic",       glyph: "shield" },
    { name: "Slack",           logo: "/pipeline/brand/vendors/slack.svg" },
    { name: "PagerDuty",       logo: "/pipeline/brand/vendors/pagerduty.svg" }
  ];

  function guardScene() {
    var s = svg("0 0 600 420");
    var CX = 300, CARD = { x: 212, y: 140, w: 176, h: 140 };

    // the release the guards clamp onto
    var ring = e("rect", { x: CARD.x - 9, y: CARD.y - 9, width: CARD.w + 18,
                           height: CARD.h + 18, rx: 10, fill: "none",
                           stroke: "var(--good)", "stroke-width": 2, opacity: 0 });
    s.appendChild(ring);
    s.appendChild(page(CARD.x, CARD.y, CARD.w, CARD.h, { fill: "var(--card)", sw: 1.4, r: 6 }));
    s.appendChild(e("path", {
      d: "M" + CARD.x + " " + (CARD.y + 30) + " H " + (CARD.x + CARD.w),
      stroke: "var(--ink)", "stroke-width": 1, opacity: 0.35
    }));
    s.appendChild(txt(CX, CARD.y + 20, "release v4.2.0", "mono", "middle", 12));
    var counter = txt(CX, CARD.y + 62, "0 / 6 guards", "mono", "middle", 13);
    s.appendChild(counter);
    s.appendChild(txt(CX, CARD.y + 82, "ship and roll back", "mono dim", "middle", 9.5));
    s.appendChild(txt(CX, CARD.y + 96, "with the release", "mono dim", "middle", 9.5));

    // six slots on the card edge that fill as guards land
    var slots = GUARD_ITEMS.map(function (g, i) {
      var left = i % 2 === 0;
      var yy = CARD.y + 112;
      var cx = CARD.x + 26 + (i * (CARD.w - 52) / 5);
      var d = e("circle", { cx: cx, cy: yy, r: 3.4, fill: "none",
                            stroke: "var(--ink)", "stroke-width": 1, opacity: 0.4 });
      s.appendChild(d);
      return d;
    });

    var PW = 182, PH = 42;
    var pins = GUARD_ITEMS.map(function (g, i) {
      var left = i % 2 === 0;
      var row = Math.floor(i / 2);
      var x = left ? 2 : 416;
      var y = 30 + row * 160;
      var wrap = e("g", { opacity: 0 });

      // tether from the pill to the card, drawn as it attaches
      var y0 = y + PH / 2;
      var edge = left ? x + PW : x;
      var mid = left ? edge + 18 : edge - 18;
      var wire = e("path", {
        d: "M" + edge + " " + y0 + " H " + mid + " V 210 H " + (left ? CARD.x : CARD.x + CARD.w),
        fill: "none", stroke: "var(--warn)", "stroke-width": 1.2, opacity: 0.55
      });
      s.appendChild(wire);

      wrap.appendChild(page(x, y, PW, PH, { fill: "var(--card)", stroke: "var(--warn)", r: 5 }));
      // accent bar so the pill is not just an outlined box
      wrap.appendChild(e("rect", { x: x, y: y, width: 3.5, height: PH,
                                   rx: 1.6, fill: "var(--warn)", opacity: 0.85 }));

      if (g.logo) {
        wrap.appendChild(e("image", { href: g.logo, x: x + 12, y: y + 11,
                                      width: 20, height: 20,
                                      preserveAspectRatio: "xMidYMid meet" }));
      } else if (g.glyph === "shield") {
        wrap.appendChild(e("path", {
          d: "M" + (x + 22) + " " + (y + 10) + " l 9 4 v 7 c 0 5 -4 8 -9 10 " +
             "c -5 -2 -9 -5 -9 -10 v -7 z",
          fill: "none", stroke: "var(--ink)", "stroke-width": 1.3, opacity: 0.7
        }));
      } else {
        wrap.appendChild(e("circle", { cx: x + 22, cy: y + 21, r: 8, fill: "none",
                                       stroke: "var(--ink)", "stroke-width": 1.3, opacity: 0.7 }));
        wrap.appendChild(txt(x + 22, y + 25, "N", "mono", "middle", 10));
      }
      wrap.appendChild(txt(x + 42, y + 26, g.name, "mono", "start", 10.5));

      // a toggle that actually flips
      var tx = x + PW - 34, ty = y + 14;
      wrap.appendChild(e("rect", { x: tx, y: ty, width: 26, height: 14, rx: 7,
                                   fill: "var(--paper)", stroke: "var(--ink)",
                                   "stroke-width": 0.9, opacity: 0.55 }));
      var knob = e("circle", { cx: tx + 7, cy: ty + 7, r: 4.6, fill: "var(--ink)", opacity: 0.5 });
      wrap.appendChild(knob);

      s.appendChild(wrap);
      return { wrap: wrap, wire: wire, knob: knob, tx: tx, left: left };
    });

    return { svg: s, render: function (p) {
      var on = 0;
      pins.forEach(function (pin, i) {
        var t = ease(seg(p, 0.06 + i * 0.1, 0.30 + i * 0.1));
        pin.wrap.setAttribute("opacity", t.toFixed(3));
        pin.wrap.setAttribute("transform",
          "translate(" + (lerp(pin.left ? -30 : 30, 0, t)).toFixed(1) + ",0)");

        var w = ease(seg(p, 0.16 + i * 0.1, 0.40 + i * 0.1));
        var L = pin.wire.getTotalLength ? pin.wire.getTotalLength() : 120;
        pin.wire.style.strokeDasharray = L + " " + L;
        pin.wire.style.strokeDashoffset = (L * (1 - w)).toFixed(1);
        pin.wire.setAttribute("opacity", (0.55 * w).toFixed(3));

        // toggle flips once the tether lands
        var f = ease(seg(p, 0.30 + i * 0.1, 0.40 + i * 0.1));
        pin.knob.setAttribute("cx", (pin.tx + 7 + 12 * f).toFixed(1));
        pin.knob.setAttribute("fill", f > 0.5 ? "var(--good)" : "var(--ink)");
        pin.knob.setAttribute("opacity", (0.5 + 0.5 * f).toFixed(2));

        if (f > 0.5) {
          on++;
          slots[i].setAttribute("fill", "var(--good)");
          slots[i].setAttribute("stroke", "var(--good)");
          slots[i].setAttribute("opacity", 1);
        } else {
          slots[i].setAttribute("fill", "none");
          slots[i].setAttribute("stroke", "var(--ink)");
          slots[i].setAttribute("opacity", 0.4);
        }
      });
      counter.textContent = on + " / 6 guards";
      ring.setAttribute("opacity", (on / 6 * 0.9).toFixed(3));
    }, chipAt: function (p) {
      return { on: Math.round(seg(p, 0.1, 0.9) * GUARDS.length), pick: -1 };
    }};
  }

  // 08 — the finished thing, answering
  function chatScene() {
    var s = svg("0 0 600 420");
    s.appendChild(page(60, 30, 480, 360, { fill: "var(--card)", sw: 1.4, r: 8 }));
    var q = e("g", { opacity: 0 });
    q.appendChild(page(210, 60, 300, 40, { fill: "var(--paper)", r: 8 }));
    q.appendChild(txt(226, 84, "Can we keep EU logs for 18 months?", "mono", "start", 10.5));
    s.appendChild(q);

    var a = e("g", { opacity: 0 });
    a.appendChild(page(90, 122, 330, 96, { fill: "var(--paper)", r: 8 }));
    ["No — §4.2 caps EU log retention at 12", "months. §7.1 allows an 18-month",
     "exception only with a signed DPA."].forEach(function (l, i) {
      a.appendChild(txt(106, 148 + i * 20, l, "", "start", 11.5));
    });
    s.appendChild(a);

    var cites = ["chunk 3 · PageIndex · 0.94", "chunk 5 · BM25 hybrid · 0.88"];
    var cg = cites.map(function (c, i) {
      var g = e("g", { opacity: 0 });
      g.appendChild(page(90, 236 + i * 30, 250, 24, { fill: "var(--card)", stroke: "var(--good)" }));
      g.appendChild(txt(102, 252 + i * 30, c, "mono", "start", 9.5));
      s.appendChild(g);
      return g;
    });

    return { svg: s, render: function (p) {
      q.setAttribute("opacity", ease(seg(p, 0.08, 0.24)));
      a.setAttribute("opacity", ease(seg(p, 0.3, 0.52)));
      cg.forEach(function (g, i) {
        g.setAttribute("opacity", ease(seg(p, 0.55 + i * 0.12, 0.72 + i * 0.12)));
      });
    }};
  }

  /* ---------------------------------------------------------------- brush -- */

  /* The same hand from the hero, reused to annotate a few acts. It is
     deliberately not on every act -- a mark that appears eight times in a row
     stops reading as emphasis. The arm is positioned so the bristle tip sits on
     the leading end of the mark it is drawing; the tip offset comes from the
     same tips.json the hero uses, averaged rather than per-frame, because here
     the arm only has to be roughly on the stroke. */
  var armLive = false;

  var Brush = (function () {
    var armEl = document.getElementById("brusharm");
    var vidEl = document.getElementById("brushvid");
    var meta = null, active = null, loading = false;

    /* A rigid mark is a single brush stroke, not handwriting: the hand and
       brush travel as one body and the fingers stay still. We get that by
       pausing the video, because the jitter was never a wobble we drew -- the
       arm is positioned so the BRISTLE TIP lands on the path, and the tip moves
       0.066 x 0.207 of the box across the cycle (~86 x 213px here), so a moving
       tip makes the whole arm counter-shift to compensate.
       Frame 30 is the PREFERRED freeze point: its local neighbourhood varies by
       0.006 against the 0.04 typical elsewhere, so the pose is momentarily at
       rest there. Best-effort only -- the seek is refused until the video is
       buffered, and correctness does not depend on it, because tipNow() reads
       whichever frame is actually paused on screen. */
    var FREEZE_FRAME = 30;
    var frozen = null;
    var parkedAt = -1;              // currentTime we came to rest on; -1 = not parked

    /* Once parked, STAY parked. readyState is not a stable signal here: it dips
       back to 1 after a seek and while buffering, so requiring >= 2 made this
       oscillate -- pause, un-pause, pause -- and tipNow() flipped to the average
       tip on every dip. Parking is therefore a latch, and the frame we parked on
       is remembered rather than re-read. */
    function parked() { return parkedAt >= 0; }

    /* Re-asserted against the video's ACTUAL state every call rather than
       against a cached flag. The video loads lazily, and its one-shot `canplay`
       handler calls play() whenever that finishes -- which can land after we
       have already paused. Trusting the flag meant we believed we were frozen
       while the fingers kept moving, and never corrected it.
       ORDER MATTERS: pausing before a frame has been decoded is a trap. The
       element is preload="none", and Chrome will not buffer a paused video, so
       readyState sticks at 1 (HAVE_METADATA) forever. tipNow() then falls back
       to meta.tip -- the average over the whole cycle, 12px right and 32px above
       the real tip -- and the brush hovers off the tick permanently. So: reach
       HAVE_CURRENT_DATA first, and only then pause. */
    function setFrozen(on) {
      if (!vidEl || !meta) return;
      frozen = on;
      if (!on) {
        parkedAt = -1;
        if (vidEl.paused) vidEl.play().catch(function () {});
        return;
      }
      if (parked()) {
        if (!vidEl.paused) vidEl.pause();               // latched; just hold it
        return;
      }
      if (vidEl.readyState < 2) {                        // needs a decoded frame
        if (vidEl.paused) vidEl.play().catch(function () {});
        return;
      }
      vidEl.pause();
      /* Seeking is best-effort and ASYNC: currentTime does not become `want`
         before this returns, so parkedAt is taken from whatever is really
         showing and corrected by the `seeked` handler if the seek lands. */
      var want = FREEZE_FRAME / meta.fps;
      if (want < (vidEl.duration || 0) &&
          Math.abs(vidEl.currentTime - want) > 0.05) {
        try { vidEl.currentTime = want; } catch (e) {}
      }
      parkedAt = vidEl.currentTime;
    }

    /** Tip at a fractional frame position, wrapped into the table. */
    function frameTip(pos, n) {
      var i = ((Math.floor(pos) % n) + n) % n, j = (i + 1) % n;
      var f = pos - Math.floor(pos);
      var a = meta.tips[i], b = meta.tips[j];
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }

    function load() {
      if (loading) return;
      loading = true;
      fetch("/pipeline/leonardo-brush-tips.json")
        .then(function (r) { return r.json(); })
        .then(function (m) {
          var sx = 0, sy = 0;
          m.tips.forEach(function (t) { sx += t[0]; sy += t[1]; });
          m.tip = [sx / m.tips.length, sy / m.tips.length];   // pre-video fallback
          meta = m;
          /* Alpha support is NOT feature-detectable, and canPlayType asks the
             wrong question. Safari reports VP9-in-WebM as playable and then
             ignores the file's alpha_mode, so it painted the arm's whole
             bounding box opaque slate over the page. There is no test for
             "alpha in this container", so the engine is detected directly:
             WebKit takes the HEVC-with-alpha MP4, everyone else the VP9 WebM.
             Chrome/Edge/Firefox on iOS all put "Safari" in their UA, hence the
             exclusions. */
          var ua = navigator.userAgent;
          var isWebKit = /Safari/.test(ua) && !/Chrome|Chromium|Android|CriOS|FxiOS|Edg/.test(ua);
          var canWebm = !isWebKit && vidEl.canPlayType('video/webm; codecs="vp9"');
          vidEl.src = "https://pub-fb3e683317b24cf8b4260121edae02be.r2.dev/video/leonardo-brush" + (canWebm ? ".webm" : ".mp4");
          /* preload="none" in the markup keeps it off the critical path, but
             once we have decided to use it we need real frames, not just
             metadata -- a rigid stroke parks the video and a paused
             preload="none" element never buffers past readyState 1. */
          vidEl.preload = "auto";
          /* A seek requested while parking lands later; adopt the frame it
             actually reached and repaint, or the tip describes one frame while
             the screen shows another. */
          vidEl.addEventListener("seeked", function () {
            if (parkedAt >= 0) { parkedAt = vidEl.currentTime; onScroll(); }
          });
          vidEl.playbackRate = 0.45;
          vidEl.addEventListener("canplay", function () {
            vidEl.play().catch(function () {});
            onScroll();                            // and again once it can play
          }, { once: true });
          vidEl.load();
        })
        .then(function () { onScroll(); })      // repaint once assets land
        .catch(function () { meta = false; });
    }

    return {
      /* Where the bristles are in THIS video frame, interpolated between table
         entries. The averaged tip was fine on a small arm, but the per-frame
         offset spans 0.066 x 0.207 of the box -- about 130px at this size, which
         put the brush visibly off the mark it was supposed to be drawing. */
      /* Deliberately NOT special-cased for the rigid stroke. Pausing the video
         already makes currentTime constant, so this returns a constant tip on
         its own -- and reading the tip from the frame actually on screen is the
         only way it cannot disagree with it. Hard-coding tips[FREEZE_FRAME]
         instead put the bristles ~22px off the mark whenever the seek did not
         land, which it often does not before the video is fully buffered. */
      tipNow: function () {
        var n = meta.frames;
        /* Parked: read the tip from the frame we latched onto, NOT from
           readyState-gated live state. The fallback below is meta.tip, the
           average across the whole cycle, which sits ~12px right and ~32px
           above the real tip -- returning it for a frozen stroke is exactly
           how the brush ended up hovering off the tick. */
        if (parked()) return frameTip(parkedAt * meta.fps, n);
        if (!vidEl || vidEl.readyState < 2 || !vidEl.duration) return meta.tip;
        var pos = vidEl.currentTime * meta.fps;
        var i = Math.floor(pos) % n, j = (i + 1) % n, f = pos - Math.floor(pos);
        var a = meta.tips[i], b = meta.tips[j];
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      },

      /* Draw `markPath` up to drawT with the tip riding the leading end.
         `ready` (0..1) is the arm's arrival: the hand slides in and fades up
         before any ink is laid. Without it the mark drew while the arm was
         still fading in, so the tick appeared with no hand behind it. */
      to: function (svgEl, markPath, drawT, ready, rigid) {
        if (meta === false) return;
        if (!meta) { load(); return; }
        setFrozen(!!rigid);
        var L = markPath.getTotalLength ? markPath.getTotalLength() : 0;
        if (!L) return;
        markPath.style.strokeDasharray = L + " " + L;
        markPath.style.strokeDashoffset = L * (1 - drawT);
        /* The mark lives exactly as long as the hand does. Letting a finished
           tick persist after the hand left meant scrolling into the act at any
           point past the draw showed a mark nothing had drawn -- which is what
           kept reading as "the checkmark appears too early". */
        markPath.style.opacity = (0.9 * ready).toFixed(3);

        var pt = markPath.getPointAtLength(L * drawT);
        var r = svgEl.getBoundingClientRect();
        var vb = svgEl.viewBox.baseVal;
        /* preserveAspectRatio="xMidYMid meet" letterboxes the drawing inside the
           element box. Since the scene became height-fitted, the box is often
           WIDER than the content, so r.width/vb.width overstated the scale and
           ignored the centring gap -- the brush landed a fixed distance off
           every mark. Use the fitted scale and the real origin. */
        var k = Math.min(r.width / vb.width, r.height / vb.height);
        var ox = r.left + (r.width - vb.width * k) / 2;
        var oy = r.top + (r.height - vb.height * k) / 2;
        var px = ox + (pt.x - vb.x) * k;
        var py = oy + (pt.y - vb.y) * k;

        /* One constant size per viewport, at the original scale. Growing the
           arm until its far edge cleared the screen hid the crop, but made the
           hand enormous -- the clipped forearm is the better trade. Never
           upscaled past the source width, so the hatching stays sharp. */
        var aspect = meta.w / meta.h;
        var W = Math.min(innerWidth * ARM_SCALE, meta.w);
        var H = W / aspect;
        var tip = this.tipNow();
        armEl.style.width = W + "px";
        // Enter from below-right along the arm's own axis.
        var slide = (1 - ready) * 150;
        armEl.style.transform = "translate3d(" +
          (px - tip[0] * W + slide).toFixed(1) + "px," +
          (py - tip[1] * H + slide * 0.55).toFixed(1) + "px,0)";
        armEl.style.opacity = ready.toFixed(3);
        active = svgEl;
        /* A playing video needs a repaint every frame to keep the tip on the
           path. A frozen one does not -- nothing changes until the next scroll.
           But it must stay live until the video is actually decodable: until
           then tipNow() hands back meta.tip, the AVERAGE over the whole cycle,
           which sits 12px right and 32px above the frozen frame's real tip. Stop
           the loop before that resolves and the brush is stranded there, because
           nothing recomputes the transform once the video finally loads. */
        armLive = !rigid || !parked();
      },
      hide: function (svgEl) {
        if (active === svgEl) { armEl.style.opacity = 0; active = null; }
      }
    };
  })();

  /* ---------------------------------------------------------------- robot -- */

  /* Can this browser comfortably run the 3D mascot? Deliberately the same
     conservative probe divinci-chat-widget.ts uses for the robot launcher --
     any hint of a weak device keeps the 23KB poster and never fetches the
     ~316KB (gzipped) bundle. Kept in sync by hand; the two should not diverge. */
  function canRunRobot() {
    try {
      if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
      var c = navigator.connection;
      if (c && c.saveData) return false;
      if (c && c.effectiveType && /(^|-)2g$/.test(c.effectiveType)) return false;
      if (typeof navigator.deviceMemory === "number" && navigator.deviceMemory < 4) return false;
      if (typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency < 4) return false;
      // matches the CSS breakpoint that hides him outright
      if (innerWidth <= 900) return false;
      // same guard the robot scene itself uses: refuse software WebGL
      var cv = document.createElement("canvas");
      var gl = cv.getContext("webgl2", { failIfMajorPerformanceCaveat: true }) ||
               cv.getContext("webgl", { failIfMajorPerformanceCaveat: true });
      if (!gl) return false;
      var lose = gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
      return true;
    } catch (e) { return false; }
  }

  function fillRobot(box) {
    var img = document.createElement("img");
    img.src = "https://pub-fb3e683317b24cf8b4260121edae02be.r2.dev/images/pipeline-robot-poster.webp";
    img.alt = "";               // decorative; the copy carries the meaning
    img.decoding = "async";
    img.width = 900; img.height = 760;
    box.appendChild(img);
  }

  /* Load the bundle only once the act is genuinely near, and only once. */
  var robotState = "idle";
  function armRobot(box) {
    if (!canRunRobot()) return;
    var io = new IntersectionObserver(function (entries) {
      if (!entries.some(function (e) { return e.isIntersecting; })) return;
      io.disconnect();
      /* The mascot is in the hero, so it is "visible" instantly -- deliberately
         wait for load and then for an idle moment, so ~316KB of bundle plus a
         WebGL context never compete with first paint. The poster is already
         showing; nothing is missing while we wait. */
      var go = function () {
        if (window.requestIdleCallback) requestIdleCallback(function () { mountRobot(box); }, { timeout: 2500 });
        else setTimeout(function () { mountRobot(box); }, 400);
      };
      if (document.readyState === "complete") go();
      else addEventListener("load", go, { once: true });
    }, { rootMargin: "200% 0px" });
    io.observe(box);
  }

  function mountRobot(box) {
    if (robotState !== "idle") return;
    robotState = "loading";
    var s = document.createElement("script");
    s.src = "https://pub-fb3e683317b24cf8b4260121edae02be.r2.dev/js/pipeline-robot.js";
    s.async = true;
    s.onerror = function () { robotState = "failed"; };   // poster simply stays
    s.onload = function () {
      if (!window.DivinciPipelineRobot) { robotState = "failed"; return; }
      var slot = document.createElement("div");
      box.appendChild(slot);
      window.DivinciPipelineRobot.mount(slot, {
        onFail: function () { robotState = "failed"; box.classList.remove("live"); }
      });
      robotState = "live";
      /* The canvas exists before it has drawn anything; fading in on mount
         flashes an empty box over the poster. Wait for a real frame. */
      var tries = 0;
      (function wait() {
        var st = window.__r3f;
        if (st && st.gl.info.render.frame > 2) { box.classList.add("live"); return; }
        if (++tries > 180) return;                        // ~3s, then keep the poster
        requestAnimationFrame(wait);
      })();
    };
    document.head.appendChild(s);
  }

  /* ---------------------------------------------------------------- build -- */

  var host = document.getElementById("acts");
  var built = [];

  ACTS.forEach(function (spec, idx) {
    var section = document.createElement("section");
    section.className = "act";
    section.id = spec.id;
    section.style.height = "260vh";

    var stage = document.createElement("div");
    stage.className = "stage";
    stage.style.opacity = 0;

    var sceneBox = document.createElement("div");
    sceneBox.className = "scene";
    var scene = spec.build();
    // behind everything the scene drew
    scene.svg.insertBefore(motif(spec.id), scene.svg.firstChild);
    if (spec.mark) {
      scene.markEl = e("path", {
        d: spec.mark.d, fill: "none", stroke: "var(--accent)",
        "stroke-width": 2.6, "stroke-linecap": "round", "stroke-linejoin": "round",
        opacity: 0.9
      });
      scene.svg.appendChild(scene.markEl);
      /* Hide it immediately. Dasharray was only ever set inside Brush.to(), so
         until the brush first reached this act the mark sat on screen fully
         drawn -- the tick appeared long before anything drew it. getTotalLength
         needs the node in the document, hence doing it after appendChild. */
      (function (el) {
        el.style.opacity = 0;
        var L = el.getTotalLength ? el.getTotalLength() : 0;
        if (L) { el.style.strokeDasharray = L + " " + L; el.style.strokeDashoffset = L; }
      })(scene.markEl);
    }
    sceneBox.appendChild(scene.svg);

    var copy = document.createElement("div");
    copy.className = "copy";
    copy.innerHTML =
      '<div class="step">' + spec.step + '</div>' +
      '<h2>' + spec.title + '</h2>' +
      '<p>' + spec.body + '</p>';

    var chipEls = [];
    if (spec.chips) {
      var box = document.createElement("div");
      box.className = "chips";
      spec.chips.forEach(function (name) {
        var c = document.createElement("span");
        c.className = "chip";
        if (LOGOS[name]) {
          var img = document.createElement("img");
          img.className = "chip-logo";
          img.alt = "";
          img.loading = "lazy";
          img.decoding = "async";
          // No mark on disk yet -> drop the slot, keep the wordmark.
          img.onerror = function () { img.remove(); c.classList.add("nologo"); };
          img.src = LOGOS[name];
          c.appendChild(img);
        }
        var label = document.createElement("span");
        label.textContent = name;
        c.appendChild(label);
        box.appendChild(c);
        chipEls.push(c);
      });
      copy.appendChild(box);
    }

    stage.appendChild(sceneBox);
    stage.appendChild(copy);

    var noteEl = null;
    if (spec.note) {
      noteEl = document.createElement("span");
      noteEl.className = "note";
      noteEl.setAttribute("aria-hidden", "true");

      noteEl.innerHTML =
        '<span class="note-text">' + spec.note.text + '</span>' +
        '<svg class="note-line" viewBox="0 0 380 150" fill="none" aria-hidden="true">' +
        '<path d="M220 2 C 254 44, 276 18, 318 48 C 332 58, 348 52, 356 56" ' +
        'stroke="currentColor" stroke-width="2.6" stroke-linecap="round" filter="url(#ctaRough)"></path>' +
        '<path d="M341.0 56.9 L356 56 L347.7 43.5" stroke="currentColor" stroke-width="2.6" ' +
        'stroke-linecap="round" stroke-linejoin="round" filter="url(#ctaRough)"></path>' +
        '</svg>';
      stage.appendChild(noteEl);
    }
    section.appendChild(stage);
    host.appendChild(section);

    built.push({ spec: spec, section: section, stage: stage, note: noteEl,
                 scene: scene, chips: chipEls });
  });

  /* --------------------------------------------------------------- scroll -- */

  var pbar = document.getElementById("pbar");
  var legend = document.getElementById("legend");
  var queued = false;

  function frame() {
    queued = false;
    var vh = innerHeight;

    for (var i = 0; i < built.length; i++) {
      var b = built[i];
      var r = b.section.getBoundingClientRect();

      /* Adjacent sticky stages overlap during the handoff: the next section is
         rising into view while the current one is still pinned at the top. Fade
         each on the way in and out so only one act is ever legible.
         Computed for EVERY act, including ones too far away to bother
         rendering -- an act that never got an opacity written would otherwise
         sit at full strength waiting off-screen. */
      /* Window is a full viewport height deliberately. Two adjacent acts share
         a boundary, so act N's r.bottom IS act N+1's r.top; with a window w the
         band where both read as visible is (vh - 1.1w) wide. Narrowing w widens
         the overlap. At w = vh they hand off cleanly instead. */
      var enter = clamp((vh - r.top) / vh, 0, 1);
      var leave = clamp(r.bottom / vh, 0, 1);
      var vis = Math.min(enter, leave);
      b.stage.style.opacity = vis.toFixed(3);
      b.stage.style.visibility = vis < 0.01 ? "hidden" : "";

      if (r.bottom < -vh || r.top > vh * 2) continue;   // too far to redraw
      var range = b.section.offsetHeight - vh;
      var p = clamp(-r.top / (range || 1), 0, 1);
      b.scene.render(p);

      if (b.note) {
        var na = b.spec.note.at;
        b.note.style.setProperty("--note-p", ease(seg(p, na[0], na[1])).toFixed(3));
      }
      if (b.chips.length && b.scene.chipAt) {
        var st = b.scene.chipAt(p);
        for (var j = 0; j < b.chips.length; j++) {
          b.chips[j].classList.toggle("on", j < st.on);
          b.chips[j].classList.toggle("pick", st.pick === j);
        }
      }
      if (b.scene.markEl) {
        var m = b.spec.mark;
        var t = clamp((p - m.from) / (m.to - m.from), 0, 1);
        /* The hand lingers past the end of the draw instead of cutting out the
           instant the stroke completes. Previously it vanished at t=1 while the
           finished mark stayed, so any frame after that showed a tick with no
           hand -- which is exactly what "the checkmark appears before the arm
           draws it" looks like when you arrive at the act already scrolled in. */
        var post = clamp((p - m.to) / 0.06, 0, 1);
        var APPROACH = 0.25;
        var appear = clamp(t / APPROACH, 0, 1);
        if (p > m.from && post < 1 && r.top <= vh * 0.6 && r.bottom >= vh * 0.4) {
          var ready = appear * (1 - post);
          var drawT = clamp((t - APPROACH) / (1 - APPROACH), 0, 1);
          Brush.to(b.scene.svg, b.scene.markEl, drawT, ready, m.rigid);
          /* A persisting mark must not inherit the hand's exit fade. Brush.to
             ties the mark's opacity to `ready`, which carries (1 - post) so the
             ink leaves with the brush; re-assert it here from `appear` alone. */
          if (m.persist) b.scene.markEl.style.opacity = (0.9 * appear).toFixed(3);
        } else {
          Brush.hide(b.scene.svg);
          if (p <= m.from) {
            // rewound past the start: nothing has drawn it yet
            b.scene.markEl.style.opacity = 0;
            b.scene.markEl.style.strokeDashoffset = 9999;
          } else if (m.persist) {
            // drawn, and it stays drawn -- the hand leaves, the ink does not
            b.scene.markEl.style.opacity = 0.9;
            b.scene.markEl.style.strokeDashoffset = 0;
          } else {
            b.scene.markEl.style.opacity = 0;
          }
        }
      }
      if (r.top <= vh * 0.5 && r.bottom >= vh * 0.5) {
        legend.innerHTML = "<b>" + b.spec.step + "</b> · " +
          Math.round(p * 100) + "%";
      }
    }

    var doc = document.documentElement;
    pbar.style.width =
      (100 * clamp(scrollY / (doc.scrollHeight - vh), 0, 1)).toFixed(2) + "%";

    /* The scene is a pure function of scroll, but the ARM is not: its tip is
       tracked per video frame, so while it is on screen the page has to keep
       repainting even when the scroll has stopped. Without this, stopping
       inside a mark window left the brush frozen — or, if the video had not
       loaded yet, never drawn at all. */
    if (armLive) { armLive = false; queued = true; requestAnimationFrame(frame); }
  }

  /* Cap each scene to the height its grid row actually got. CSS could not do
     this: percentage heights refuse to resolve through the row, and a vh cap
     cannot account for the copy block underneath, so on short viewports the
     scene spilled onto the title. */
  /* Anchor each margin note so its ARROW TIP lands on the thing it points at,
     rather than positioning the note box and hoping. The tip sits at a fixed
     spot inside the note: .note-line is 380x150 at top:37px right:-134px within
     a 300px note, so the tip (356,56 in its viewBox) is at (410, 93) from the
     note's own origin. */
  var NOTE_TIP = [410, 93];

  function placeNotes() {
    for (var i = 0; i < built.length; i++) {
      var b = built[i];
      if (!b.note) continue;
      var chips = b.stage.querySelector(".chips .chip") || b.stage.querySelector(".chips");
      if (!chips) continue;
      var sr = b.stage.getBoundingClientRect();
      var cr = chips.getBoundingClientRect();
      if (!cr.width) continue;
      // aim just left of the chip row, vertically centred on it
      var tx = cr.left - 14, ty = cr.top + cr.height / 2;
      var left = tx - sr.left - NOTE_TIP[0];
      var top = ty - sr.top - NOTE_TIP[1];
      b.note.style.left = Math.max(8, left).toFixed(0) + "px";
      b.note.style.top = top.toFixed(0) + "px";
      b.note.style.bottom = "auto";
      // hide it if the margin is too tight for the note to sit clear
      b.note.style.visibility = left < 8 ? "hidden" : "";
    }
  }

  function fitScenes() {
    for (var i = 0; i < built.length; i++) {
      var box = built[i].scene.svg.parentNode;
      var h = box.clientHeight;
      if (h > 40) built[i].scene.svg.style.maxHeight = h + "px";
    }
  }

  function onScroll() {
    if (!queued) { queued = true; requestAnimationFrame(frame); }
  }
  function relayout() { fitScenes(); placeNotes(); }
  addEventListener("resize", relayout);
  addEventListener("load", relayout);
  relayout();
  // chips wrap once webfonts land, which moves the row the arrow points at
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll);

  // the mascot presenting the document, beside the headline
  var introRobot = document.getElementById("introRobot");
  if (introRobot) { fillRobot(introRobot); armRobot(introRobot); }

  frame();
})();
