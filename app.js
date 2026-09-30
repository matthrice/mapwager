(() => {
  "use strict";

  const START_CHIPS = 1000;
  const MIN_BET = 10;
  const ROUNDS = 7;
  const STORAGE_KEY = "map-wager-v1";
  const EPOCH = "2026-09-30"; // day 0
  const EARTH_MI = 3958.8;

  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.round(n).toLocaleString();

  // ---------- Dates ----------
  const pad = (n) => String(n).padStart(2, "0");
  const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
  const todayKey = dateKey(new Date());
  const dayIndex = Math.round((parseKey(todayKey) - parseKey(EPOCH)) / 864e5);

  // ---------- Today's places (same for everyone) ----------
  // One fixed shuffle of the pool (seeded PRNG), then day N takes the next ROUNDS, so days
  // don't repeat until the pool runs out.
  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const order = window.PLACES.map((_, i) => i);
  const rand = mulberry32(20260930);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const start = ((dayIndex * ROUNDS) % order.length + order.length) % order.length;
  const places = Array.from({ length: ROUNDS }, (_, i) => window.PLACES[order[(start + i) % order.length]]);

  // ---------- Storage ----------
  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
  }
  function saveStore() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch { /* private mode */ }
  }
  const store = loadStore();
  store.days = store.days || {};
  const sig = places.map((p) => p.name).join("|");
  const game = store.days[todayKey]?.sig === sig ? store.days[todayKey]
    : (store.days[todayKey] = { sig, chips: START_CHIPS, results: [], done: false });

  // ---------- Geometry ----------
  const rad = (d) => (d * Math.PI) / 180;
  function distanceMi(a, b) {
    const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
    return 2 * EARTH_MI * Math.asin(Math.sqrt(h));
  }
  // Polygon approximating the circle of radius rMi around a point (for drawing the line).
  function circle(p, rMi, steps = 72) {
    const d = rMi / EARTH_MI, lat1 = rad(p.lat), lon1 = rad(p.lon), coords = [];
    for (let i = 0; i <= steps; i++) {
      const b = (2 * Math.PI * i) / steps;
      const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
      const lon2 = lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
      coords.push([((lon2 * 180) / Math.PI + 540) % 360 - 180, (lat2 * 180) / Math.PI]);
    }
    return { type: "Feature", geometry: { type: "Polygon", coordinates: [coords] } };
  }
  const fmtDist = (mi) => (mi < 0.1 ? `${Math.round((mi * 5280) / 10) * 10} ft` : `${mi < 10 ? mi.toFixed(1) : fmt(mi)} mi`);
  const fmtLine = (r) => `${r} ${r === 1 ? "mile" : "miles"}`;

  // ---------- Setup check ----------
  const token = window.MAPBOX_TOKEN || "";
  if (!window.mapboxgl || !token.startsWith("pk.")) {
    $("prompt-name").textContent = "Map failed to load";
    return;
  }

  // ---------- Map: spinning globe, no labels ----------
  mapboxgl.accessToken = token;
  const map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/outdoors-v12",
    projection: "globe",
    center: [10, 20],
    zoom: 1.3,
    dragRotate: false,
    pitchWithRotate: false,
    doubleClickZoom: false,
    touchPitch: false
  });
  map.touchZoomRotate.disableRotation();

  map.on("style.load", () => {
    // Topography plus country borders: hide every label, roads, state/province lines, rail,
    // buildings and other man-made layers. Terrain shading, land cover, water and
    // country (admin-0) borders stay.
    const MANMADE = /road|bridge|tunnel|admin|boundary|transit|aeroway|building|ferry|rail|path|golf|pitch|structure|gate|fence|barrier|landuse/;
    const COUNTRY_BORDER = /^admin-0/;
    for (const layer of map.getStyle().layers) {
      const hide = layer.type === "symbol" || (MANMADE.test(layer.id) && !COUNTRY_BORDER.test(layer.id));
      if (hide) map.setLayoutProperty(layer.id, "visibility", "none");
    }
    map.setFog({ color: "#0e5a3a", "high-color": "#083a25", "space-color": "#06140d", "horizon-blend": 0.08, "star-intensity": 0.15 });
    map.addSource("ring", { type: "geojson", data: fc() });
    map.addLayer({ id: "ring-fill", type: "fill", source: "ring", paint: { "fill-color": "#d4af37", "fill-opacity": 0.18 } });
    map.addLayer({ id: "ring-line", type: "line", source: "ring", paint: { "line-color": "#d4af37", "line-width": 2.5 } });
    map.addSource("links", { type: "geojson", data: fc() });
    map.addLayer({
      id: "links", type: "line", source: "links", layout: { "line-cap": "round" },
      paint: { "line-color": "#d4af37", "line-width": 3, "line-dasharray": [2, 1.5] }
    });
  });

  const fc = (features = []) => ({ type: "FeatureCollection", features });
  const setData = (id, features) => map.getSource(id)?.setData(fc(features));
  const topPad = () => $("top").getBoundingClientRect().bottom - $("stage").getBoundingClientRect().top + 16;

  // ---------- Marks ----------
  let markers = [];
  function markerAt(pt, inner) {
    const wrap = document.createElement("div");
    wrap.className = "marker";
    wrap.appendChild(inner);
    return new mapboxgl.Marker({ element: wrap }).setLngLat([pt.lon, pt.lat]).addTo(map);
  }
  function addPin(cls, pt, label, delay) {
    const el = document.createElement("div");
    el.className = `pin ${cls}`;
    if (delay) el.style.setProperty("--delay", `${delay}ms`);
    if (label) {
      const l = document.createElement("div");
      l.className = "label";
      l.textContent = label;
      el.appendChild(l);
    }
    const m = markerAt(pt, el);
    if (cls === "answer") m.getElement().style.zIndex = 1;
    markers.push(m);
  }
  function ripple(pt) {
    const el = document.createElement("div");
    el.className = "ripple";
    const m = markerAt(pt, el);
    setTimeout(() => m.remove(), 700);
  }
  function clearMarks() {
    markers.forEach((m) => m.remove());
    markers = [];
    setData("ring", []);
    setData("links", []);
  }

  function reveal(g, p) {
    ripple(g);
    addPin("guess", g);
    addPin("answer", p, p.name, 500);
    setData("ring", [circle(p, p.r)]);
    setData("links", [{ type: "Feature", geometry: { type: "LineString", coordinates: [[g.lon, g.lat], [p.lon, p.lat]] } }]);
    // Frame the answer's circle and the guess.
    const pts = [[g.lon, g.lat], ...circle(p, p.r, 16).geometry.coordinates[0]];
    const lons = pts.map((c) => c[0]), lats = pts.map((c) => c[1]);
    const cam = map.cameraForBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], {
      padding: { top: Math.min(topPad(), map.getContainer().clientHeight * 0.55), bottom: 40, left: 40, right: 40 },
      maxZoom: 12
    });
    if (cam) map.easeTo({ ...cam, duration: 900 });
  }

  // ---------- Game flow ----------
  let bet = 0;
  let phase = "bet"; // bet (stack chips, then tap) → reveal
  const round = () => game.results.length;
  const place = () => places[Math.min(round(), ROUNDS - 1)];
  const minBet = () => Math.min(MIN_BET, game.chips);

  function setAction(text, enabled, handler) {
    const b = $("action-btn");
    b.textContent = text;
    b.style.display = text ? "" : "none";
    b.disabled = !enabled;
    b.onclick = handler;
  }

  function renderBank(delta) {
    $("chips").textContent = fmt(game.chips);
    const box = document.querySelector(".bank-chips");
    box.classList.remove("up", "down");
    if (delta) { void box.offsetWidth; box.classList.add(delta > 0 ? "up" : "down"); }
    $("round-label").textContent = `Round ${Math.min(round() + (phase === "reveal" ? 0 : 1), ROUNDS)} / ${ROUNDS}`;
    $("cashout-btn").style.display = !game.done && round() > 0 && phase === "bet" ? "" : "none";
  }

  function renderBet() {
    const p = place();
    $("bet").textContent = fmt(bet);
    $("towin").textContent = fmt(bet * p.pays);
    $("result").textContent = bet > 0 ? "Tap the globe to play" : "";
    setAction("", false, null);
  }

  function startRound() {
    phase = "bet";
    bet = 0;
    clearMarks();
    const p = place();
    $("prompt-label").textContent = "Find";
    $("prompt-name").textContent = p.name;
    $("line").innerHTML = `Within <b>${fmtLine(p.r)}</b> · pays <b>${p.pays}×</b>`;
    $("betbox").style.display = "";
    $("result").textContent = "";
    renderBank();
    renderBet();
  }

  for (const b of document.querySelectorAll("button.chip")) {
    b.onclick = () => {
      if (phase !== "bet") return;
      bet = b.dataset.add === "all" ? game.chips : Math.min(game.chips, bet + Number(b.dataset.add));
      renderBet();
    };
  }
  $("clear-btn").onclick = () => { bet = 0; renderBet(); };

  map.on("click", (e) => {
    if (game.done) return;
    if (phase === "reveal") { next(); return; }
    // Betting and tapping are one step: stack chips, then tap to play the round.
    if (bet < minBet() || bet <= 0) { toast("Place your bet first"); return; }
    resolve({ lon: e.lngLat.lng, lat: e.lngLat.lat });
  });

  function resolve(g) {
    const p = place();
    const mi = distanceMi(g, p);
    const hit = mi <= p.r;
    const delta = hit ? bet * p.pays : -bet;
    game.chips = Math.round(game.chips + delta);
    game.results.push({ name: p.name, bet, hit, delta: Math.round(delta), mi: +mi.toFixed(1), lat: +g.lat.toFixed(4), lon: +g.lon.toFixed(4) });
    phase = "reveal";
    $("betbox").style.display = "none";
    const over = game.chips <= 0 || round() >= ROUNDS;
    if (over) finish(false);
    saveStore();
    reveal(g, p);
    renderBank(delta);
    $("prompt-label").textContent = hit ? "Hit!" : "Miss";
    $("result").innerHTML = (hit
      ? `<span class="win">+${fmt(delta)}</span> · ${fmtDist(mi)} away`
      : `<span class="lose">−${fmt(-delta)}</span> · ${fmtDist(mi)} away (line ${fmtLine(p.r)})`);
    if (over) setAction(game.chips <= 0 ? "Busted · see results" : "See results", true, showOver);
    else setAction("Next place →", true, next);
  }

  function next() {
    if (game.done) { showOver(); return; }
    startRound();
  }

  $("cashout-btn").onclick = () => {
    if (game.done || phase !== "bet") return;
    finish(true);
    saveStore();
    renderBank();
    showOver();
  };

  function finish(cashedOut) {
    game.done = true;
    game.cashedOut = cashedOut;
  }

  // ---------- Results / stats / share ----------
  function computeStats() {
    const days = Object.entries(store.days).filter(([, g]) => g.done);
    const finals = days.map(([, g]) => g.chips);
    let streak = 0;
    const d = new Date();
    if (!store.days[dateKey(d)]?.done) d.setDate(d.getDate() - 1);
    while (store.days[dateKey(d)]?.done && store.days[dateKey(d)].chips > START_CHIPS) { streak++; d.setDate(d.getDate() - 1); }
    return {
      played: days.length,
      best: finals.length ? Math.max(...finals) : 0,
      avg: finals.length ? Math.round(finals.reduce((a, b) => a + b, 0) / finals.length) : 0,
      winning: finals.filter((c) => c > START_CHIPS).length,
      streak
    };
  }

  function statsHTML(s) {
    return `<div><b>${s.played}</b>played</div><div><b>${fmt(s.avg)}</b>average</div>` +
      `<div><b>${fmt(s.best)}</b>best</div><div><b>${s.winning}</b>in profit</div><div><b>${s.streak}</b>streak</div>`;
  }

  function showOver() {
    const up = game.chips - START_CHIPS;
    $("over-title").textContent = game.chips <= 0 ? "Busted" : game.cashedOut ? "Cashed out" : "Final tally";
    $("final-score").textContent = fmt(game.chips);
    $("over-sub").textContent = `${up >= 0 ? "+" : "−"}${fmt(Math.abs(up))} chips · ${game.results.filter((r) => r.hit).length}/${game.results.length} hits`;
    $("stats").innerHTML = statsHTML(computeStats());
    $("over").showModal();
  }

  $("stats-btn").onclick = () => { $("stats-all").innerHTML = statsHTML(computeStats()); $("statsbox").showModal(); };

  function shareText() {
    const date = parseKey(todayKey).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const up = game.chips - START_CHIPS;
    // One line per round with the wager and what it won/lost (no place names, so no spoilers).
    const rounds = game.results.map((r, i) =>
      `${i + 1}. ${r.hit ? "🟢" : "🔴"} bet ${fmt(r.bet)} → ${r.delta >= 0 ? "+" : "−"}${fmt(Math.abs(r.delta))}`);
    const ending = game.cashedOut ? `💰 cashed out after ${game.results.length}` : game.chips <= 0 ? "💥 busted" : null;
    return [
      `🎰 Map Wager · ${date}`,
      ...rounds,
      ...(ending ? [ending] : []),
      `${fmt(game.chips)} chips (${up >= 0 ? "+" : "−"}${fmt(Math.abs(up))})`,
      "https://mapwager.com"
    ].join("\n");
  }
  $("share-btn").onclick = async () => {
    const text = shareText();
    try {
      if (navigator.share && matchMedia("(pointer: coarse)").matches) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); toast("Copied to clipboard"); }
    } catch { /* cancelled */ }
  };

  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove("show"), 1600);
  }

  $("help-btn").onclick = () => $("help").showModal();
  for (const d of document.querySelectorAll("dialog")) {
    d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
  }

  // ---------- Boot ----------
  map.on("load", () => {
    if (game.done) {
      $("betbox").style.display = "none";
      $("prompt-label").textContent = "Today's table is closed";
      $("prompt-name").textContent = `${fmt(game.chips)} chips`;
      $("line").textContent = "New places at midnight";
      phase = "reveal";
      renderBank();
      setAction("Show results", true, showOver);
      showOver();
      return;
    }
    startRound();
    if (!store.seenHelp) { store.seenHelp = true; saveStore(); $("help").showModal(); }
  });
})();
