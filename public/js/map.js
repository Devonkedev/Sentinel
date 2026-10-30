// Real map (Leaflet + OpenStreetMap data). Geocoding goes through Nominatim.
const SCOTLAND_YARD = [51.5033, -0.1247];
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const NOMINATIM = "https://nominatim.openstreetmap.org";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const hasPos = o => o && Number.isFinite(o.lat) && Number.isFinite(o.lng);
export const fmtPos = p => `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`;

const live = new Set();
export function destroyMaps() { for (const m of live) m.destroy(); }

const LEVEL = { strong: "var(--critical)", possible: "var(--warning)", low: "var(--ink-3)" };
const divPin = (cls, color, html = "", size = 16) => L.divIcon({ className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2],
  html: `<span class="mk ${cls}" style="--mk:${color}">${html}</span>` });

// Mounts a map in `host`. Works before `host` is attached: it frames itself on first layout.
export function createMap(host, { onClick, height = 420 } = {}) {
  host.classList.add("geo-map");
  host.style.height = height + "px";
  if (!window.L) {
    host.innerHTML = `<div class="geo-fail">The map couldn't load. Check your connection and reload.</div>`;
    return { setPins() {}, setAgents() {}, setPick() {}, destroy() {} };
  }
  const map = L.map(host, { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView(SCOTLAND_YARD, 13);
  L.tileLayer(TILES, { maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' }).addTo(map);
  map.on("focus", () => map.scrollWheelZoom.enable());
  map.on("blur", () => map.scrollWheelZoom.disable());
  L.marker(SCOTLAND_YARD, { icon: divPin("hq", "var(--ink)", "", 12), keyboard: false, zIndexOffset: -500 })
    .bindTooltip("New Scotland Yard", { permanent: true, direction: "right", offset: [8, 0], className: "mk-label" }).addTo(map);

  const pins = L.layerGroup().addTo(map), people = L.layerGroup().addTo(map);
  let pickMarker = null, framed = false, points = [], sig = "";
  const frame = () => {
    if (!host.clientWidth) return;
    map.invalidateSize();
    if (framed) return;
    framed = true;
    if (points.length === 1) map.setView(points[0], 15);
    else if (points.length) map.fitBounds(points, { padding: [36, 36], maxZoom: 15 });
  };
  const ro = new ResizeObserver(frame);
  ro.observe(host);
  if (onClick) { map.on("click", e => onClick({ lat: e.latlng.lat, lng: e.latlng.lng })); host.classList.add("picking"); }

  const api = {
    // Replaces sighting pins; `popup(s)` returns trusted HTML. Only reframes the first time.
    setPins(items, popup) {
      const next = items.filter(hasPos);
      const key = JSON.stringify(next.map(s => [s.id, s.status, s.match_level]));
      if (key === sig) return;
      sig = key;
      pins.clearLayers();
      for (const s of next) {
        const shape = s.subject === "agent" ? "tri" : s.subject === "character" ? "sq" : "rd";
        const color = s.subject === "agent" ? "var(--change)" : LEVEL[s.match_level] || LEVEL.low;
        const hot = s.match_level === "strong" && s.status !== "dismissed";
        const m = L.marker([s.lat, s.lng], { icon: divPin(`${shape} ${hot ? "hot" : ""} ${s.status === "dismissed" ? "dim" : ""}`, color), title: s.location });
        if (popup) m.bindPopup(popup(s));
        m.addTo(pins);
      }
      points = points.concat(next.filter(s => s.status !== "dismissed").map(s => [s.lat, s.lng]));
      frame();
    },
    setAgents(agents) {
      people.clearLayers();
      const next = agents.filter(hasPos);
      for (const a of next) {
        L.marker([a.lat, a.lng], { icon: divPin("dia", "var(--accent)"), zIndexOffset: 500 })
          .bindTooltip(esc(a.name), { permanent: true, direction: "top", offset: [0, -10], className: "mk-label strong" })
          .bindPopup(`<b>${esc(a.name)}</b><br>${esc(a.status)}<br>${esc(a.location || "")}`).addTo(people);
      }
      points = points.concat(next.map(a => [a.lat, a.lng]));
      frame();
    },
    setPick(p, { move = true } = {}) {
      if (pickMarker) { pickMarker.remove(); pickMarker = null; }
      if (!hasPos(p)) return;
      pickMarker = L.marker([p.lat, p.lng], { icon: divPin("pick", "var(--accent)", "", 22), zIndexOffset: 1000 }).addTo(map);
      points = [[p.lat, p.lng]];
      framed = framed || move;
      if (move && host.clientWidth) map.setView([p.lat, p.lng], Math.max(map.getZoom(), 15));
      else if (move) { framed = false; frame(); }
    },
    destroy() { ro.disconnect(); live.delete(api); map.remove(); },
  };
  live.add(api);
  return api;
}

const shortName = r => {
  const a = r.address || {};
  const first = r.name || a.amenity || a.building || a.shop || [a.house_number, a.road].filter(Boolean).join(" ") || a.neighbourhood;
  const area = a.suburb || a.city_district || a.city || a.town || a.village || a.county;
  const label = [first, area].filter(Boolean).join(", ");
  return (label || r.display_name || "").slice(0, 80);
};

async function nominatim(path) {
  const res = await fetch(`${NOMINATIM}/${path}&format=jsonv2&addressdetails=1`, { cache: "no-store" });
  if (!res.ok) throw new Error("Lookup failed");
  return res.json();
}

// Search box, "use my location" and a clickable map. `value()` is { lat, lng, location } or null.
export function locationPicker(host, { initial = null, onChange = () => {}, height = 320, label = "Search for a place, street or postcode" } = {}) {
  host.innerHTML = `<div class="geo-search">
      <input type="search" aria-label="${esc(label)}" placeholder="${esc(label)}" autocomplete="off" enterkeyhint="search">
      <button type="button" class="btn" data-go>Search</button>
      <button type="button" class="btn" data-me>My location</button></div>
    <div class="geo-results hidden" role="listbox"></div>
    <div data-map></div>
    <div class="hint geo-msg" role="status" aria-live="polite"></div>`;
  const input = host.querySelector("input"), results = host.querySelector(".geo-results"), msg = host.querySelector(".geo-msg");
  let cur = hasPos(initial) ? { lat: initial.lat, lng: initial.lng, location: initial.location || fmtPos(initial) } : null;
  let lookup = 0;
  const say = t => { msg.textContent = t; };
  const set = (p, name, move = true) => {
    cur = { lat: +p.lat, lng: +p.lng, location: name || fmtPos({ lat: +p.lat, lng: +p.lng }) };
    map.setPick(cur, { move });
    say(cur.location);
    onChange(cur);
  };
  const reverse = async p => {
    const mine = ++lookup;
    set(p, null, false);
    say("Finding the address…");
    try {
      const r = await nominatim(`reverse?lat=${p.lat}&lon=${p.lng}&zoom=18`);
      if (mine === lookup) set(p, shortName(r), false);
    } catch { if (mine === lookup) say(`${fmtPos(p)} (address lookup unavailable, coordinates will be used)`); }
  };
  const map = createMap(host.querySelector("[data-map]"), { onClick: reverse, height });
  const search = async () => {
    const q = input.value.trim();
    if (!q) return input.focus();
    const mine = ++lookup;
    say("Searching…");
    results.classList.add("hidden");
    try {
      const found = await nominatim(`search?q=${encodeURIComponent(q)}&limit=5`);
      if (mine !== lookup) return;
      if (!found.length) return say(`Nothing found for “${q}”. Try another name, or click the map.`);
      say("");
      results.innerHTML = found.map((r, i) => `<button type="button" role="option" data-i="${i}"><b>${esc(shortName(r))}</b><span>${esc(r.display_name)}</span></button>`).join("");
      results.classList.remove("hidden");
      results.querySelectorAll("button").forEach(b => (b.onclick = () => {
        const r = found[+b.dataset.i];
        results.classList.add("hidden");
        set({ lat: r.lat, lng: r.lon }, shortName(r));
      }));
    } catch { if (mine === lookup) say("Place search is unavailable right now. Click the map instead."); }
  };
  input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); search(); } });
  host.querySelector("[data-go]").onclick = search;
  host.querySelector("[data-me]").onclick = () => {
    if (!navigator.geolocation) return say("This browser can't share its location.");
    say("Asking for your location…");
    navigator.geolocation.getCurrentPosition(
      pos => { const p = { lat: pos.coords.latitude, lng: pos.coords.longitude }; map.setPick(p); reverse(p); },
      () => say("Location access was denied. Search or click the map instead."),
      { enableHighAccuracy: true, timeout: 10000 });
  };
  if (cur) { map.setPick(cur); say(cur.location); } else say("No location chosen yet. Search, use your location, or click the map.");
  return { map, value: () => cur };
}
