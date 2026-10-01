(() => {
  "use strict";

  // Chips carry over day to day (the bankroll is your long-term score).
  const START_BANK = 100; // first-ever bankroll
  const DAILY_ALLOWANCE = 10; // free chips each new day you play
  const MIN_BET_SHARE = 0.02; // minimum bet ≈ 2% of the bankroll (the smallest chip)
  const ROUNDS = 7;
  const STORAGE_KEY = "map-wager-v2"; // v1 was the 1,000-chips-a-day version
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
  function shuffled(n, seed) {
    const order = Array.from({ length: n }, (_, i) => i);
    const rand = mulberry32(seed);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
  }
  // Sep 30 and Oct 1 were played on the original 142-place pool; from Oct 2 the full pool
  // gets a fresh shuffle. (Keeps those two days' places unchanged.)
  const LEGACY_POOL = 142, LEGACY_DAYS = 2;
  const legacy = dayIndex < LEGACY_DAYS;
  function newOrder() {
    // Places already played on the legacy days go to the back of the new rotation.
    const old = shuffled(LEGACY_POOL, 20260930).slice(0, LEGACY_DAYS * ROUNDS);
    const fresh = shuffled(window.PLACES.length, 20261002);
    return [...fresh.filter((i) => !old.includes(i)), ...fresh.filter((i) => old.includes(i))];
  }
  const order = legacy ? shuffled(LEGACY_POOL, 20260930) : newOrder();
  const slot = legacy ? dayIndex : dayIndex - LEGACY_DAYS;
  const start = ((slot * ROUNDS) % order.length + order.length) % order.length;
  const places = Array.from({ length: ROUNDS }, (_, i) => window.PLACES[order[(start + i) % order.length]]);

  // ---------- Payout modifiers ----------
  // Hot streak: after 3 hits in a row, payouts get +0.5x until you miss.
  // Bonus round: the last round pays double.
  const HOT_AFTER = 3, HOT_BONUS = 0.5;
  function streak() {
    // Consecutive hits; passed rounds neither add to nor break a streak.
    let n = 0;
    for (let i = game.results.length - 1; i >= 0; i--) {
      const r = game.results[i];
      if (r.pass) continue;
      if (!r.hit || r.practice) break;
      n++;
    }
    return n;
  }
  function payout(i) {
    const hot = streak() >= HOT_AFTER;
    const bonus = i === ROUNDS - 1;
    return { hot, bonus, mult: (places[i].pays + (hot ? HOT_BONUS : 0)) * (bonus ? 2 : 1) };
  }

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
  if (store.days[todayKey]?.sig !== sig) {
    const first = store.bank === undefined;
    if (first) store.bank = START_BANK;
    // Daily allowance once per day (not again if today's places were changed mid-day).
    const allowance = first || store.days[todayKey] ? 0 : DAILY_ALLOWANCE;
    store.bank += allowance;
    store.days[todayKey] = { sig, startBank: store.bank, allowance, results: [], done: false };
  }
  const game = store.days[todayKey];
  store.peak = Math.max(store.peak || 0, store.bank);
  const todayDelta = () => game.results.reduce((a, r) => a + (r.delta || 0), 0);

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

  // g is the guess, or null when the round was passed (just show the answer).
  function reveal(g, p) {
    if (g) { ripple(g); addPin("guess", g); }
    addPin("answer", p, p.name, g ? 500 : 0);
    setData("ring", [circle(p, p.r)]);
    if (g) setData("links", [{ type: "Feature", geometry: { type: "LineString", coordinates: [[g.lon, g.lat], [p.lon, p.lat]] } }]);
    // Frame the answer's circle and the guess.
    const pts = [...(g ? [[g.lon, g.lat]] : []), ...circle(p, p.r, 16).geometry.coordinates[0]];
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
  const broke = () => store.bank <= 0;

  // Chip buttons scale with the bankroll: ~2%, 5%, 10%, 25%, rounded to 1-2-5 steps.
  function nice(x) {
    if (x < 1) return 1;
    const p = 10 ** Math.floor(Math.log10(x));
    const m = x / p;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  }
  // Minimum bet scales with the bankroll: ~2%, rounded like the chips, at least 1, at most what you have.
  const minBet = () => Math.min(store.bank, nice(store.bank * MIN_BET_SHARE));
  const short = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}K` : String(n));
  function renderChips() {
    const values = [...new Set([MIN_BET_SHARE, 0.05, 0.1, 0.25].map((f) => nice(store.bank * f)))].filter((v) => v < store.bank);
    document.querySelectorAll("button.chip:not(.allin)").forEach((b, i) => {
      const v = values[i];
      b.style.display = v ? "" : "none";
      if (v) { b.dataset.add = v; b.textContent = short(v); }
    });
  }

  function setAction(text, enabled, handler) {
    const b = $("action-btn");
    b.textContent = text;
    b.style.display = text ? "" : "none";
    b.disabled = !enabled;
    b.onclick = handler;
  }

  function renderBank(delta) {
    $("chips").textContent = fmt(store.bank);
    const box = document.querySelector(".bank-chips");
    box.classList.remove("up", "down");
    if (delta) { void box.offsetWidth; box.classList.add(delta > 0 ? "up" : "down"); }
    $("round-label").textContent = `Round ${Math.min(round() + (phase === "reveal" ? 0 : 1), ROUNDS)} / ${ROUNDS}`;
  }

  function renderBet() {
    if (broke()) {
      $("chip-buttons").style.display = "none";
      $("bet-row").innerHTML = `<span>Out of chips: tap to play for fun · +${DAILY_ALLOWANCE} tomorrow</span>`;
      $("result").textContent = "";
      setAction("", false, null);
      return;
    }
    $("bet").textContent = fmt(bet);
    $("minbet").textContent = fmt(minBet());
    $("towin").textContent = fmt(bet * payout(round()).mult);
    $("result").textContent = bet > 0 ? "Tap the globe to play" : "";
    $("result").classList.toggle("hint", bet > 0);
    setAction("", false, null);
  }

  function startRound() {
    phase = "bet";
    bet = broke() ? 0 : minBet(); // the minimum bet is always on; chips only add to it
    clearMarks();
    const p = place();
    $("prompt-name").textContent = p.name;
    const pay = payout(round());
    $("prompt-label").textContent = pay.bonus ? "Bonus round · find" : "Find";
    $("line").innerHTML = `Within <b>${fmtLine(p.r)}</b> · pays <b>${+pay.mult.toFixed(2)}×</b>` +
      (pay.hot ? ` <span class="tag hot">🔥 +${HOT_BONUS}×</span>` : "") +
      (pay.bonus ? ` <span class="tag bonus">⭐ ×2</span>` : "");
    $("betbox").style.display = "";
    $("result").textContent = "";
    renderChips();
    renderBank();
    renderBet();
  }

  for (const b of document.querySelectorAll("button.chip")) {
    b.onclick = () => {
      if (phase !== "bet") return;
      bet = b.dataset.add === "all" ? store.bank : Math.min(store.bank, bet + Number(b.dataset.add));
      renderBet();
    };
  }
  $("clear-btn").onclick = () => { bet = minBet(); renderBet(); };
  $("pass-btn").onclick = () => { if (phase === "bet" && !game.done) resolve(null); };

  map.on("click", (e) => {
    if (game.done) return;
    if (phase === "reveal") { next(); return; }
    // Betting and tapping are one step: stack chips, then tap to play the round.
    if (!broke() && bet < minBet()) bet = minBet(); // safety net; the minimum is pre-filled
    resolve({ lon: e.lngLat.lng, lat: e.lngLat.lat });
  });

  // g = the tapped point, or null to pass the round.
  function resolve(g) {
    const p = place();
    const pay = payout(round());
    const practice = broke();
    let r;
    if (!g) {
      r = { name: p.name, pass: true, bet: 0, hit: false, delta: 0 };
    } else {
      const mi = distanceMi(g, p);
      const hit = mi <= p.r;
      const delta = practice ? 0 : Math.round(hit ? bet * pay.mult : -bet);
      r = { name: p.name, bet: practice ? 0 : bet, hit, delta, practice, mult: pay.mult, hot: pay.hot, bonus: pay.bonus,
        mi: +mi.toFixed(1), lat: +g.lat.toFixed(4), lon: +g.lon.toFixed(4) };
    }
    store.bank = Math.max(0, store.bank + r.delta);
    store.peak = Math.max(store.peak || 0, store.bank);
    game.results.push(r);
    phase = "reveal";
    $("betbox").style.display = "none";
    $("result").classList.remove("hint");
    const over = round() >= ROUNDS;
    if (over) game.done = true;
    saveStore();
    reveal(g, p);
    renderBank(r.delta);
    $("prompt-label").textContent = r.pass ? "Passed" : r.hit ? "Hit!" : "Miss";
    if (r.hit && !practice && streak() === HOT_AFTER && round() < ROUNDS) toast(`🔥 Hot streak! +${HOT_BONUS}× until you miss`);
    $("result").innerHTML = r.pass ? "No bet this round"
      : practice ? `${r.hit ? "Hit" : "Miss"} (practice) · ${fmtDist(r.mi)} away`
      : r.hit ? `<span class="win">+${fmt(r.delta)}</span> · ${fmtDist(r.mi)} away`
      : `<span class="lose">−${fmt(-r.delta)}</span> · ${fmtDist(r.mi)} away (line ${fmtLine(p.r)})`;
    if (over) setAction("See results", true, showOver);
    else setAction("Next place →", true, next);
  }

  function next() {
    if (game.done) { showOver(); return; }
    startRound();
  }


  // ---------- Results / stats / share ----------
  const signed = (n) => `${n >= 0 ? "+" : "−"}${fmt(Math.abs(n))}`;
  function computeStats() {
    const days = Object.entries(store.days).filter(([, g]) => g.done);
    const net = ([, g]) => g.results.reduce((a, r) => a + (r.delta || 0), 0);
    let streak = 0;
    const d = new Date();
    if (!store.days[dateKey(d)]?.done) d.setDate(d.getDate() - 1);
    for (let g; (g = store.days[dateKey(d)])?.done && net([0, g]) > 0; d.setDate(d.getDate() - 1)) streak++;
    return { bank: store.bank, peak: store.peak || store.bank, played: days.length, winning: days.filter((e) => net(e) > 0).length, streak };
  }

  function statsHTML(s) {
    return `<div><b>${fmt(s.bank)}</b>bankroll</div><div><b>${fmt(s.peak)}</b>peak</div><div><b>${s.played}</b>days</div>` +
      `<div><b>${s.winning}</b>in profit</div><div><b>${s.streak}</b>streak</div>`;
  }

  function showOver() {
    const d = todayDelta();
    $("over-title").textContent = broke() ? "Out of chips" : "Day complete";
    $("final-score").textContent = fmt(store.bank);
    $("over-sub").textContent = `${signed(d)} today · ${game.results.filter((r) => r.hit && !r.practice).length}/` +
      `${game.results.filter((r) => !r.pass && !r.practice).length} hits` + (broke() ? ` · +${DAILY_ALLOWANCE} chips tomorrow` : "");
    $("stats").innerHTML = statsHTML(computeStats());
    $("over").showModal();
  }

  $("stats-btn").onclick = () => { $("stats-all").innerHTML = statsHTML(computeStats()); $("statsbox").showModal(); };

  function shareText() {
    const date = parseKey(todayKey).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    // One line per round with the wager and what it won/lost (no place names, so no spoilers).
    const rounds = game.results.map((r, i) =>
      r.pass ? `${i + 1}. ⏭️ pass`
      : r.practice ? `${i + 1}. ${r.hit ? "🟢" : "🔴"} practice`
      : `${i + 1}. ${r.hit ? "🟢" : "🔴"}${r.bonus ? "⭐" : ""}${r.hot ? "🔥" : ""} bet ${fmt(r.bet)} → ${signed(r.delta)}`);
    return [
      `🎰 Map Wager · ${date}`,
      ...rounds,
      `${signed(todayDelta())} today · bankroll ${fmt(store.bank)}`,
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
      $("prompt-name").textContent = `${fmt(store.bank)} chips`;
      $("line").textContent = `New places and +${DAILY_ALLOWANCE} chips at midnight`;
      phase = "reveal";
      renderBank();
      setAction("Show results", true, showOver);
      showOver();
      return;
    }
    startRound();
    if (game.allowance && !game.results.length && !game.allowanceShown) {
      game.allowanceShown = true; saveStore();
      toast(`+${DAILY_ALLOWANCE} daily chips`);
    }
    if (!store.seenHelp) { store.seenHelp = true; saveStore(); $("help").showModal(); }
  });
})();
