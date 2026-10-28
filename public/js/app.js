// EXUN Sentinel frontend (vanilla ES modules, no build step)
import { icon } from "./icons.js";
import { PLACES, POI_TRAITS, SUBJECTS, scoreSighting } from "./poi.js";
import CV from "./cv.js";

const CASE = {
  machineId: "MJWHKZLTNBUXE5A",
  energy: [
    ["2026-10-13", 18477.2, 24.6], ["2026-10-14", 18505.3, 28.1], ["2026-10-15", 18528.2, 22.9],
    ["2026-10-16", 18559.6, 31.4], ["2026-10-17", 18586.3, 26.7], ["2026-10-18", 18621.5, 35.2],
    ["2026-10-19", 18651.3, 29.8], ["2026-10-20", 18674.8, 23.5], ["2026-10-21", 18702.4, 27.6],
    ["2026-10-22", 18727.5, 25.1], ["2026-10-23", 21411.5, 2684.0], ["2026-10-24", 21442.2, 503.2],
    ["2026-10-25", 21464.0, 21.8], ["2026-10-26", 21492.9, 28.9],
  ],
};

const S = { token: null, user: null, alerts: [], comms: null, route: null, poll: null, viewTimer: null, pendingRef: null, flash: null };

// ================================================================ utilities
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = n => (n == null ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 }));
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};
S.token = store.get("exun_token");

// Server timestamps end in Z (UTC); user-entered times are local wall-clock
const toDate = s => (s ? new Date(/Z$/.test(s) ? s : /^\d{4}-\d{2}-\d{2}$/.test(s) ? s + "T00:00" : s) : null);
function when(s) {
  const d = toDate(s);
  if (!d || isNaN(d)) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function ago(s) {
  const d = toDate(s);
  if (!d || isNaN(d)) return "—";
  const m = Math.round((Date.now() - d) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  if (m < 10080) return `${Math.round(m / 1440)}d ago`;
  return when(s);
}
const initials = name => name.replace(/^Agent\s+/, "").split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
const SEV = { critical: "var(--critical)", high: "var(--serious)", medium: "var(--warning)", low: "var(--ink-3)", none: "var(--ink-3)", good: "var(--good)" };
const pill = (level, text) => `<span class="pill ${esc(level)}">${esc(text ?? level)}</span>`;
const levelSev = l => (l === "strong" ? "critical" : l === "possible" ? "medium" : l === "agent" ? "info" : "low");
const subjectOf = s => s.subject || "poi1";
const SUBJECT_UI = {
  poi1: { icon: "target", label: "POI-1", tag: "POI-1" },
  character: { icon: "gamepad", label: "Video game character", tag: "Character" },
  agent: { icon: "badge", label: "EXUN agent", tag: "Agent" },
};
const dmId = (a, b) => "dm-" + [a, b].sort().join("-");

async function api(path, body) {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(S.token ? { Authorization: "Bearer " + S.token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && S.user) { signOut(); throw new Error("Your session expired. Please sign in again."); }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(msg, { type = "ok", sub = "" } = {}) {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `${icon(type === "err" ? "alert" : type === "info" ? "info" : "checkCircle")}<div><div>${esc(msg)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ""}</div>`;
  $("#toasts").appendChild(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 220); }, type === "err" ? 6000 : 4000);
}

function confirmDialog({ title, body, ok = "Confirm", danger = false }) {
  return new Promise(resolve => {
    const o = document.createElement("div");
    o.className = "overlay";
    o.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="mt"><h2 id="mt">${esc(title)}</h2>
      <div class="ink2">${body}</div><div class="actions"><button class="btn" data-a="0">Cancel</button>
      <button class="btn ${danger ? "danger" : "primary"}" data-a="1">${esc(ok)}</button></div></div>`;
    const done = v => { o.remove(); document.removeEventListener("keydown", key); resolve(v); };
    const key = e => { if (e.key === "Escape") done(false); };
    o.addEventListener("click", e => { if (e.target === o) done(false); const a = e.target.closest("[data-a]"); if (a) done(a.dataset.a === "1"); });
    document.addEventListener("keydown", key);
    document.body.appendChild(o);
    $("[data-a='1']", o).focus();
  });
}

// Run an async action with a busy button and error toast
async function busy(btn, fn) {
  if (btn) { btn.classList.add("busy"); btn.disabled = true; }
  try { return await fn(); }
  catch (err) { toast(err.message, { type: "err" }); }
  finally { if (btn) { btn.classList.remove("busy"); btn.disabled = false; } }
}

function empty(ic, title, text, action = "") {
  return `<div class="empty"><div class="ic">${icon(ic)}</div><h3>${esc(title)}</h3><p>${text}</p>${action}</div>`;
}

function head(title, text, { eyebrow = "", actions = "" } = {}) {
  return `<div class="page-head"><div>${eyebrow ? `<div class="eyebrow">${eyebrow}</div>` : ""}<h1>${title}</h1>${text ? `<p>${text}</p>` : ""}</div>
    ${actions ? `<div class="row">${actions}</div>` : ""}</div>`;
}

function setTheme(t) {
  document.documentElement.dataset.theme = t;
  store.set("exun_theme", t);
  $$("[data-theme-toggle]").forEach(b => (b.innerHTML = icon(t === "dark" ? "sun" : "moon")));
}
const themeBtn = (cls = "btn ghost icon") => `<button class="${cls}" data-theme-toggle aria-label="Toggle theme" title="Toggle theme">${icon(document.documentElement.dataset.theme === "dark" ? "sun" : "moon")}</button>`;
// "Discuss" buttons attach a piece of evidence to a new comms message
document.addEventListener("click", e => {
  const b = e.target.closest("[data-discuss]");
  if (!b) return;
  S.pendingRef = JSON.parse(b.dataset.discuss);
  location.hash = "comms/" + (b.dataset.conv || "wenoti");
});
const discussBtn = (ref, conv = "wenoti") => `<button class="btn sm ghost" data-discuss='${esc(JSON.stringify(ref))}' data-conv="${conv}">${icon("message")}Discuss</button>`;

document.addEventListener("click", e => {
  if (e.target.closest("[data-theme-toggle]")) setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});

// ================================================================ map
const DISTRICTS = [
  ["Civic Quarter", 4, 4, 40, 30], ["Arcade District", 50, 4, 46, 30], ["Old Town", 4, 40, 40, 36],
  ["Central", 50, 40, 46, 7], ["Utilities", 50, 56, 15, 20], ["Riverside", 70, 56, 26, 20],
];

const SHORT = { "etiNuxe Intelligence Agency HQ": "EIA HQ", "Department of Electricity": "Electricity Dept.", "92nd Ave Substation": "Substation", "Riverside Market": "Market" };

function mapSVG({ sightings = [], agents = [], pick = null, id = "map" }) {
  const places = Object.entries(PLACES).map(([name, [x, y]]) =>
    `<g><rect x="${x - 1}" y="${y - 1}" width="2" height="2" rx=".4" style="fill:var(--map-place)" opacity=".6"/>
      <text x="${name.startsWith("Wenoti") ? x + 2.6 : x}" y="${name.startsWith("Wenoti") ? y - 1.4 : y + 3.6}" font-size="2.1" text-anchor="${name.startsWith("Wenoti") ? "start" : "middle"}" style="fill:var(--map-place)">${esc(SHORT[name] || name.split(",")[0])}</text><title>${esc(name)}</title></g>`).join("");
  const color = { strong: "var(--critical)", possible: "var(--warning)", low: "var(--ink-3)" };
  const recent = s => Date.now() - (toDate(s.seen_at) || 0) < 72 * 3600e3;
  color.agent = "var(--change)";
  const shape = s => {
    const c = `class="pin" data-id="${s.id}" style="fill:${color[s.match_level] || color.low};stroke:var(--map-bg)" stroke-width=".6" opacity="${s.status === "dismissed" ? .35 : 1}"`;
    const t = `<title>${esc(SUBJECT_UI[subjectOf(s)].tag)} · ${esc(s.location)} · ${when(s.seen_at)}</title>`;
    if (subjectOf(s) === "character") return `<rect ${c} x="${s.x - 1.7}" y="${s.y - 1.7}" width="3.4" height="3.4" rx=".5">${t}</rect>`;
    if (subjectOf(s) === "agent") return `<path ${c} d="M${s.x} ${s.y - 2.1} L${s.x + 2} ${s.y + 1.6} L${s.x - 2} ${s.y + 1.6} Z">${t}</path>`;
    return `<circle ${c} cx="${s.x}" cy="${s.y}" r="1.8">${t}</circle>`;
  };
  const pins = sightings.filter(s => s.x != null).map(s => `<g>
    ${s.match_level === "strong" && s.status !== "dismissed" && recent(s) ? `<circle class="pulse" cx="${s.x}" cy="${s.y}" r="1.8" style="fill:${color.strong}"/>` : ""}
    ${shape(s)}</g>`).join("");
  const seen = {};
  const ags = agents.map(a0 => {
    const k = a0.x + "," + a0.y, n = (seen[k] = (seen[k] || 0) + 1) - 1;
    const x = a0.x - 3 - n * 6, y = a0.y - 3.6;
    return `<g><path d="M${x} ${y - 2.2} L${x + 2} ${y} L${x} ${y + 2.2} L${x - 2} ${y} Z" style="fill:var(--accent);stroke:var(--map-bg)" stroke-width=".6"><title>${esc(a0.name)} · ${esc(a0.status)}</title></path>
      <text x="${x}" y="${y - 3}" font-size="2.1" font-weight="600" text-anchor="middle" style="fill:var(--accent)">${esc(a0.name.replace("Agent ", "").split(" ")[0])}</text></g>`;
  }).join("");
  const picked = pick ? `<g><circle cx="${pick.x}" cy="${pick.y}" r="3" fill="none" style="stroke:var(--accent)" stroke-width=".7"/><circle cx="${pick.x}" cy="${pick.y}" r="1" style="fill:var(--accent)"/></g>` : "";
  return `<svg class="map ${pick !== null ? "pick" : ""}" id="${id}" viewBox="0 0 100 80" role="img" aria-label="Map of nuxEland">
    ${DISTRICTS.map(([n, x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.2" style="fill:var(--map-district);stroke:var(--map-district-line)" stroke-width=".35"/>
      <text x="${x + 1.6}" y="${y + 3.6}" font-size="2.1" font-weight="700" letter-spacing=".15" style="fill:var(--map-label)">${n.toUpperCase()}</text>`).join("")}
    <path d="M0 50 C 20 46, 30 54, 48 52 S 70 44, 100 49" fill="none" style="stroke:var(--map-river)" stroke-width="2.6"/>
    <path d="M0 37 H100 M47 0 V80 M67.5 53 V80" style="stroke:var(--map-road)" stroke-width="1.4"/>
    <text x="5" y="38.6" font-size="1.9" font-style="italic" style="fill:var(--map-label)">92nd Avenue →</text>
    ${places}${ags}${pins}${picked}</svg>`;
}

function bindPicker(svg, onPick) {
  svg.addEventListener("click", e => {
    if (e.target.closest(".pin")) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    onPick(Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10);
  });
}

function nearestPlace(x, y) {
  let best = null, bd = Infinity;
  for (const [name, [px, py]] of Object.entries(PLACES)) {
    const d = Math.hypot(px - x, py - y);
    if (d < bd) { bd = d; best = name; }
  }
  return bd < 6 ? best : `Near ${best.split(",")[0]}`;
}

const mapLegend = (agents = false, subjects = false) => `<div class="legend">
  <span><i class="sw" style="background:var(--critical)"></i>Strong match</span>
  <span><i class="sw" style="background:var(--warning)"></i>Possible</span>
  <span><i class="sw" style="background:var(--ink-3)"></i>Low</span>
  ${subjects ? `<span><i class="sw" style="background:var(--ink-2)"></i>POI-1</span><span><i class="sw sq" style="background:var(--ink-2)"></i>Other character</span>
    ${S.user?.role === "agent" ? `<span><i class="sw tri"></i>Agent sighting</span>` : ""}` : ""}
  ${agents ? `<span><i class="sw dia" style="background:var(--accent)"></i>Agent position</span>` : ""}</div>`;

// ================================================================ energy chart
function energyChart(rows, spikes, log) {
  const W = 760, H = 270, P = { l: 48, r: 8, t: 22, b: 30 };
  const max = Math.max(...rows.map(r => Math.max(r.usage ?? 0, r.reported ?? 0)), 1);
  const y = v => log
    ? H - P.b - (Math.log10(Math.max(v, 1)) / Math.log10(max * 1.25)) * (H - P.t - P.b)
    : H - P.b - (v / (max * 1.08)) * (H - P.t - P.b);
  const bw = (W - P.l - P.r) / rows.length;
  const ticks = log ? [1, 10, 100, 1000, 10000].filter(t => t <= max * 1.25) : [0, .25, .5, .75, 1].map(f => Math.round(max * f));
  const spikeDates = new Set(spikes.map(s => s.date));
  const bars = rows.map((r, i) => {
    const x = P.l + i * bw + 3, w = Math.max(2, bw - 6), top = y(r.usage ?? 0), base = H - P.b;
    const hgt = Math.max(1, base - top), rr = Math.min(4, w / 2, hgt);
    const d = `M${x} ${base} V${top + rr} Q${x} ${top} ${x + rr} ${top} H${x + w - rr} Q${x + w} ${top} ${x + w} ${top + rr} V${base} Z`;
    const rep = r.discrepancy != null && r.reported != null
      ? `<line x1="${x - 3}" x2="${x + w + 3}" y1="${y(r.reported)}" y2="${y(r.reported)}" style="stroke:var(--warning)" stroke-width="2" stroke-dasharray="4 3"/>` : "";
    return `<g class="bar" data-i="${i}"><rect x="${P.l + i * bw}" y="${P.t}" width="${bw}" height="${H - P.t - P.b}" fill="transparent"/>
      <path d="${d}" style="fill:${spikeDates.has(r.date) ? "var(--critical)" : "var(--bar)"}"/>${rep}
      <text x="${x + w / 2}" y="${H - P.b + 16}" font-size="10.5" text-anchor="middle" style="fill:var(--ink-3)">${r.date.slice(8)}</text></g>`;
  }).join("");
  const labels = spikes.map(s => {
    const i = rows.findIndex(r => r.date === s.date);
    return `<text x="${P.l + i * bw + bw / 2}" y="${y(s.usage) - 7}" font-size="11.5" font-weight="600" text-anchor="middle" style="fill:var(--ink)">${fmt(s.usage)} kWh</text>`;
  }).join("");
  return `<div class="chart" id="echart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily energy consumption">
    ${ticks.map(t => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}" style="stroke:var(--line)"/>
      <text x="${P.l - 8}" y="${y(t) + 3.5}" font-size="10.5" text-anchor="end" style="fill:var(--ink-3)">${fmt(t)}</text>`).join("")}
    ${bars}${labels}</svg><div class="tip hidden"></div></div>`;
}

function bindChart(root, rows) {
  const tip = $(".tip", root);
  $$(".bar", root).forEach(g => {
    g.addEventListener("mousemove", e => {
      const r = rows[+g.dataset.i];
      tip.innerHTML = `<div class="muted">${toDate(r.date).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</div>
        <div>Usage (meter): <b>${fmt(r.usage)} kWh</b></div>
        ${r.reported != null ? `<div>Reported: <b>${fmt(r.reported)} kWh</b></div>` : ""}
        ${r.ratio != null ? `<div class="muted">${r.ratio}× baseline · z ${r.z}</div>` : ""}
        ${r.discrepancy != null ? `<div style="color:var(--warning)">Discrepancy: ${r.discrepancy > 0 ? "+" : ""}${fmt(r.discrepancy)} kWh</div>` : ""}`;
      tip.classList.remove("hidden");
      const box = root.getBoundingClientRect();
      let left = e.clientX - box.left + 14;
      if (left + tip.offsetWidth > box.width) left = e.clientX - box.left - tip.offsetWidth - 14;
      tip.style.left = left + "px";
      tip.style.top = Math.max(0, e.clientY - box.top - tip.offsetHeight - 8) + "px";
    });
    g.addEventListener("mouseleave", () => tip.classList.add("hidden"));
  });
}

// ================================================================ landing / auth
async function renderLanding(mode = "login", role = "citizen") {
  $("#app").innerHTML = `<div class="landing">
    <section class="hero">
      <div class="row between"><a class="brand" href="#"><span class="brand-mark">${icon("shield")}</span>
        <span><div class="brand-name">EXUN Sentinel</div><div class="brand-sub">Extradigital Exceptions &amp; Unknowns Network</div></span></a></div>
      <div class="hero-body">
        <span class="badge"><span class="live"></span>Public appeal</span>
        <h1>Have you seen this person?</h1>
        <p class="lead">Since 23 October, a person in costume has been linked to unexplained power surges at Wenoti Arcade on 92nd Avenue. If you see someone matching this description, report it. Every report is reviewed by an agent.</p>
        <p class="ink2" style="margin-top:-2px">Seen <b>another video game character</b> out in the real world, or someone claiming to be an <b>EXUN agent</b>? Report that too.</p>
        <div class="look">
          <div>${icon("ear")}Sharp, pointed ears</div><div>${icon("shield")}Bedazzled armour</div>
          <div>${icon("sword")}Scabbard at the waist</div><div>${icon("hand")}Leather gloves and boots</div>
          <div>${icon("mic")}Thick accent, stutters</div><div>${icon("zap")}Near arcade machines</div>
        </div>
        <div class="row" style="margin-bottom:24px"><button class="btn primary" id="cta" style="height:40px">${icon("plus")}Report a sighting</button><span class="small muted">Free citizen account, takes 20 seconds</span></div>
        <div class="hero-stats" id="hstats"><div><div class="v">—</div><div class="k">Reports filed</div></div></div>
      </div>
      <div class="hero-foot">Do not approach. If equipment nearby is sparking or humming, move away first, then report.</div>
    </section>
    <section class="auth-side"><div class="auth-card">
      <h2>${mode === "login" ? "Welcome back" : "Create an account"}</h2>
      <p class="muted">${mode === "login" ? "Sign in to report sightings or open the agent console." : "Citizens can report sightings and check machines. Agents need an authorisation code."}</p>
      <div class="seg block" style="margin-top:18px" role="tablist">
        <button data-m="login" class="${mode === "login" ? "on" : ""}">Sign in</button><button data-m="register" class="${mode === "register" ? "on" : ""}">Create account</button></div>
      <form id="authf" novalidate>
        ${mode === "register" ? `
          <div class="field"><span class="label">I am a</span><div class="seg block" id="rolesel">
            <button type="button" data-r="citizen" class="${role === "citizen" ? "on" : ""}">${icon("users")}Citizen</button>
            <button type="button" data-r="agent" class="${role === "agent" ? "on" : ""}">${icon("shield")}Agent</button></div></div>
          <div class="field"><label for="f-name">Display name</label><input id="f-name" name="name" autocomplete="name" required></div>` : ""}
        <div class="field"><label for="f-user">Username</label><input id="f-user" name="username" autocomplete="username" autocapitalize="off" required></div>
        <div class="field"><label for="f-pass">Password</label><input id="f-pass" name="password" type="password" autocomplete="${mode === "login" ? "current-password" : "new-password"}" required>
          ${mode === "register" ? `<div class="hint">At least 6 characters.</div>` : ""}</div>
        ${mode === "register" && role === "agent" ? `<div class="field"><label for="f-code">Agency authorisation code</label><input id="f-code" name="agency_code" autocomplete="off"></div>` : ""}
        <div class="error" id="autherr"></div>
        <button class="btn primary block" style="margin-top:18px;height:40px">${mode === "login" ? "Sign in" : "Create account"}${icon("arrow")}</button>
      </form>
      <div class="demo"><div class="small muted">Demo accounts, one click</div><div class="demo-grid">
        ${[["conis:conis2026", "Conis Nikrobo", "Agent · case lead"], ["mega:mega2026", "Agent Mega", "Agent · field"], ["citizen:citizen2026", "Demo Citizen", "Citizen"]].map(([c, n, r]) =>
          `<button class="demo-btn" data-demo="${c}"><span class="avatar">${initials(n)}</span><span class="who"><div>${n}</div><div>${r}</div></span>${icon("arrow")}</button>`).join("")}
      </div><div class="hint" style="margin-top:10px">Agent sign-up code for the demo: <span class="mono">EXUN-2026</span></div></div>
    </div></section>
    <div class="theme-fab">${themeBtn("btn icon")}</div>
  </div>`;

  $$("[data-m]").forEach(b => (b.onclick = () => renderLanding(b.dataset.m, role)));
  $("#cta").onclick = () => renderLanding("register", "citizen").then(() => { $(".auth-card").scrollIntoView({ behavior: "smooth" }); $("#f-name").focus({ preventScroll: true }); });
  $$("#rolesel [data-r]").forEach(b => (b.onclick = () => {
    const f = $("#authf"), keep = { name: f.name?.value, username: f.username.value };
    renderLanding("register", b.dataset.r).then(() => { Object.entries(keep).forEach(([k, v]) => { if ($("#authf")[k]) $("#authf")[k].value = v || ""; }); });
  }));
  $$("[data-demo]").forEach(b => (b.onclick = () => busy(b, () => signIn("/api/login", Object.fromEntries([["username", b.dataset.demo.split(":")[0]], ["password", b.dataset.demo.split(":")[1]]])))));
  $("#authf").onsubmit = e => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    if (mode === "register") body.role = role;
    $("#autherr").textContent = "";
    return busy(e.submitter || $("#authf button.primary"), async () => {
      try { await signIn(mode === "login" ? "/api/login" : "/api/register", body); }
      catch (err) { $("#autherr").textContent = err.message; }
    });
  };

  try {
    const s = await api("/api/public/summary");
    $("#hstats").innerHTML = `<div><div class="v">${s.sightings}</div><div class="k">Reports filed</div></div>
      <div><div class="v">${s.strong}</div><div class="k">Strong matches</div></div>
      <div><div class="v">${s.characters || 0}</div><div class="k">Other characters</div></div>
      ${s.latest ? `<div><div class="v" style="font-size:16px;line-height:1.9">${esc(s.latest.location.split(",")[0])}</div><div class="k">Last seen ${ago(s.latest.seen_at)}</div></div>` : ""}`;
  } catch { /* stats are optional */ }
}

async function signIn(path, body) {
  const r = await api(path, body);
  S.token = r.token; S.user = r.user;
  store.set("exun_token", r.token);
  location.hash = "";
  toast(`Signed in as ${r.user.name}`);
  boot();
}

function signOut() {
  S.token = null; S.user = null; S.alerts = []; S.comms = null;
  clearInterval(S.viewTimer);
  store.set("exun_token", null);
  clearInterval(S.poll);
  history.replaceState(null, "", location.pathname);
  renderLanding();
}

// ================================================================ shell & routing
const ROUTES = {
  dashboard: { title: "Case dashboard", icon: "grid", roles: ["agent"], sec: "Command" },
  comms: { title: "Comms", icon: "message", roles: ["agent"], sec: "Command" },
  alerts: { title: "Alerts", icon: "bell", roles: ["agent"], sec: "Command" },
  energy: { title: "Energy spikes", icon: "zap", roles: ["agent"], sec: "Forensics" },
  code: { title: "Code forensics", icon: "code", roles: ["agent"], sec: "Forensics" },
  report: { title: "Report a sighting", icon: "plus", roles: ["citizen"], sec: "Help the investigation" },
  sightings: { title: "Sightings", icon: "pin", roles: ["agent", "citizen"], sec: { agent: "Field", citizen: "Help the investigation" } },
  integrity: { title: "Asset integrity", icon: "scan", roles: ["agent", "citizen"], sec: { agent: "Field", citizen: "Help the investigation" } },
  agents: { title: "Agent tracker", icon: "users", roles: ["agent"], sec: "Field" },
};
const routesFor = role => Object.entries(ROUTES).filter(([, r]) => r.roles.includes(role));

function renderShell() {
  const role = S.user.role;
  let lastSec = null;
  const nav = routesFor(role).map(([id, r]) => {
    const sec = typeof r.sec === "string" ? r.sec : r.sec[role];
    const h = sec !== lastSec ? `<div class="sec">${sec}</div>` : "";
    lastSec = sec;
    return `${h}<a href="#${id}" data-route="${id}">${icon(r.icon)}<span>${r.title}</span>${id === "alerts" ? `<span class="count hidden" id="acount"></span>` : id === "comms" ? `<span class="count hidden" id="ccount"></span>` : ""}</a>`;
  }).join("");
  const brand = `<a class="brand" href="#"><span class="brand-mark">${icon("shield")}</span><span><div class="brand-name">EXUN Sentinel</div>
    <div class="brand-sub">${role === "agent" ? "Agent console" : "Citizen portal"}</div></span></a>`;
  $("#app").innerHTML = `<div class="shell" id="shell">
    <aside class="side" id="side">${brand}<nav class="nav">${nav}</nav>
      <div class="side-foot"><div class="me"><span class="avatar">${initials(S.user.name)}</span>
        <div class="who"><div>${esc(S.user.name)}</div><div>${role === "agent" ? "Agent · " + esc(S.user.agent_id || "") : "Citizen"}</div></div>${themeBtn()}</div>
        <button class="btn ghost block" id="logout" style="justify-content:flex-start">${icon("logout")}Sign out</button></div>
    </aside>
    <div class="scrim" id="scrim"></div>
    <div><header class="topbar"><button class="btn ghost icon" id="menu" aria-label="Open menu">${icon("menu")}</button>${brand}<span style="flex:1"></span>${themeBtn()}</header>
      <main id="main" tabindex="-1"></main></div>
  </div>`;
  $("#logout").onclick = () => { signOut(); toast("Signed out", { type: "info" }); };
  $("#menu").onclick = () => $("#shell").classList.add("open");
  $("#scrim").onclick = () => $("#shell").classList.remove("open");
}

function updateBadge() {
  const el = $("#acount");
  if (el) {
    const n = S.alerts.filter(a => a.status === "open").length;
    el.textContent = n;
    el.classList.toggle("hidden", !n);
  }
  const c = $("#ccount");
  if (c && S.comms) {
    const all = [...S.comms.channels, ...S.comms.dms];
    const n = all.reduce((t, x) => t + x.unread, 0), m = all.reduce((t, x) => t + x.mentions, 0);
    c.textContent = m ? "@" + m : n;
    c.classList.toggle("hidden", !n);
    c.style.background = m ? "var(--warning)" : "var(--accent)";
  }
}

async function refreshComms(notify) {
  if (S.user?.role !== "agent") return;
  const before = S.comms;
  try { S.comms = await api("/api/comms"); } catch { return; }
  if (notify && before && S.route !== "comms") {
    const prev = Object.fromEntries([...before.channels, ...before.dms].map(x => [x.id, x.mentions]));
    for (const x of [...S.comms.channels, ...S.comms.dms]) {
      if (x.mentions > (prev[x.id] || 0) && x.last) toast(`${x.last.from_name} mentioned you`, { type: "info", sub: `${x.kind === "dm" ? "Direct message" : "#" + x.name}: ${x.last.text}` });
    }
  }
  updateBadge();
}

async function refreshAlerts(notify) {
  if (S.user?.role !== "agent") return;
  const before = new Set(S.alerts.map(a => a.id + a.time));
  try { S.alerts = await api("/api/alerts"); } catch { return; }
  if (notify) {
    const fresh = S.alerts.filter(a => a.status === "open" && !before.has(a.id + a.time) && ["critical", "high"].includes(a.severity));
    fresh.slice(0, 2).forEach(a => toast(a.title, { type: "err", sub: a.source }));
  }
  updateBadge();
}

async function navigate() {
  if (!S.user) return;
  const allowed = routesFor(S.user.role).map(([id]) => id);
  let [id, param] = location.hash.slice(1).split("/");
  if (!allowed.includes(id)) id = allowed[0];
  S.route = id;
  clearInterval(S.viewTimer);
  $$("[data-route]").forEach(a => (a.getAttribute("data-route") === id ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  $("#shell")?.classList.remove("open");
  document.title = `${ROUTES[id].title} · EXUN Sentinel`;
  const main = $("#main");
  main.innerHTML = `<div class="skeleton" style="height:56px;width:40%;margin-bottom:24px"></div>
    <div class="grid g3"><div class="skeleton" style="height:120px"></div><div class="skeleton" style="height:120px"></div><div class="skeleton" style="height:120px"></div></div>
    <div class="skeleton" style="height:280px;margin-top:16px"></div>`;
  try {
    const wrap = document.createElement("div");
    wrap.className = "view-enter";
    await VIEWS[id](wrap, param ? decodeURIComponent(param) : null);
    if (S.route !== id) return;
    main.replaceChildren(wrap);
    window.scrollTo(0, 0);
  } catch (err) {
    if (S.route === id) main.innerHTML = `<div class="card">${empty("alert", "Something went wrong", esc(err.message), `<button class="btn" onclick="location.reload()">${icon("refresh")}Reload</button>`)}</div>`;
  }
}
// Re-render the current view in place (after an action)
const rerender = () => navigate();
window.addEventListener("hashchange", navigate);

async function boot() {
  if (!S.user && S.token) { try { S.user = await api("/api/me"); } catch { S.token = null; store.set("exun_token", null); } }
  if (!S.user) return renderLanding();
  renderShell();
  await Promise.all([refreshAlerts(false), refreshComms(false)]);
  clearInterval(S.poll);
  if (S.user.role === "agent") S.poll = setInterval(() => { refreshAlerts(true); refreshComms(true); }, 20000);
  navigate();
}

// ================================================================ views
const VIEWS = {};

VIEWS.dashboard = async el => {
  const [c, sightings, agents, integrity, energy, code, wenoti] = await Promise.all(
    ["/api/correlate", "/api/sightings", "/api/agents", "/api/integrity", "/api/energy", "/api/code", "/api/comms/wenoti"].map(p => api(p)));
  await refreshAlerts(false);
  const color = c.score >= 70 ? "var(--critical)" : c.score >= 40 ? "var(--warning)" : "var(--good)";
  const open = S.alerts.filter(a => a.status === "open");
  const strong = sightings.filter(s => s.status !== "dismissed" && ((subjectOf(s) === "poi1" && s.match_level === "strong") || s.also_poi1));
  const chars = sightings.filter(s => subjectOf(s) === "character" && s.status !== "dismissed");
  const escalated = S.alerts.some(a => a.source === "Correlation engine");
  const steps = [
    ["energy", "Analyse the energy readings", energy.length > 0],
    ["code", "Compare the game source code", code.length > 0],
    ["integrity", "Inspect the machine casing", integrity.length > 0],
    ["sightings", "Triage new sightings", !sightings.some(s => s.status === "new")],
    ["dashboard", "Escalate the case verdict", escalated],
  ];
  const doneCount = steps.filter(s => s[2]).length;
  const tlColor = { Energy: "var(--critical)", Code: "var(--serious)", Sighting: "var(--accent)", Integrity: "var(--warning)" };
  el.innerHTML = `
    <div class="banner">${icon("alert")}<div><b>Notice EIA/EXUN/SUS-01</b> · effective 27 Oct 2026. EXUN operational authority is suspended pending administrative review. Case records remain accessible.</div></div>
    ${head("Wenoti Arcade", `The Reckoning V: Origins · machine <span class="mono">${CASE.machineId}</span> · 92nd Avenue, nuxEland`, { eyebrow: "Active case" })}
    <div class="grid g4">
      ${[["bell", "Open alerts", open.length, `${open.filter(a => a.severity === "critical").length} critical`, "#alerts"],
         ["target", "Strong POI-1 matches", strong.length, `${chars.length} other character report${chars.length === 1 ? "" : "s"}`, "#sightings"],
         ["users", "Agents in the field", `${agents.filter(a => !/relocat|off/i.test(a.status)).length}<span class="muted" style="font-size:18px">/${agents.length}</span>`, `${agents.filter(a => /relocat/i.test(a.status)).length} relocation pending`, "#agents"],
         ["scan", "Latest inspection", integrity[0] ? integrity[0].score : "—", integrity[0] ? `${integrity[0].condition} surface damage` : "No inspection yet", "#integrity"]]
        .map(([ic, k, v, d, href]) => `<a class="card stat" href="${href}" style="color:inherit;text-decoration:none"><div class="k">${icon(ic)}${k}</div><div class="v">${v}</div><div class="d">${d}</div></a>`).join("")}
    </div>
    <div class="grid g-side" style="margin-top:16px">
      <div class="card">
        <div class="card-head"><div><h2>${icon("activity")}Correlation engine</h2><div class="sub">Weighs energy, code, sightings and physical evidence together</div></div></div>
        <div class="gauge"><div class="num" style="color:${color}">${c.score}</div><div><div class="lbl">${esc(c.verdict)}</div><div class="muted small">Escalation threshold 40 · malicious at 70</div></div></div>
        <div class="meter" style="margin:16px 0 18px"><span style="width:${c.score}%;background:${color}"></span></div>
        <div class="evidence">${c.evidence.map(e => `<span class="tag">${esc(e.source)}</span><span>${esc(e.text)}</span><span class="w ${e.weight ? "pos" : ""}">+${e.weight}</span>`).join("")}</div>
        <div class="row" style="margin-top:20px">
          <button class="btn danger" id="escalate" ${c.score < 40 ? "disabled" : ""}>${icon("send")}Escalate to authorities</button>
          ${c.score < 40 ? `<span class="small muted">Run the analyses to build the case first.</span>` : ""}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div><h2>${icon("checkCircle")}Investigation checklist</h2><div class="sub">${doneCount} of ${steps.length} complete</div></div></div>
        <div class="meter" style="margin-bottom:12px"><span style="width:${(doneCount / steps.length) * 100}%;background:var(--good)"></span></div>
        <div class="steps">${steps.map(([r, t, done], i) => `<a class="step ${done ? "done" : ""}" href="#${r}" ${r === "dashboard" ? 'data-esc="1"' : ""}>
          <span class="dot">${done ? icon("check") : i + 1}</span><span class="t">${t}</span><span class="go">${icon("arrow")}</span></a>`).join("")}</div>
      </div>
    </div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><div class="card-head"><h2>${icon("pin")}Live map</h2><a class="btn sm ghost" href="#sightings">Open sightings${icon("arrow")}</a></div>
        ${mapSVG({ sightings, agents })}${mapLegend(true)}</div>
      <div class="card"><div class="card-head"><h2>${icon("clock")}Event timeline</h2></div>
        ${c.timeline.length ? `<div class="timeline">${c.timeline.map(t => `<div class="tl" style="--tl:${tlColor[t.source] || "var(--accent)"}"><div class="t">${when(t.time)} · ${esc(t.source)}</div><div class="x">${esc(t.text)}</div></div>`).join("")}</div>`
          : empty("clock", "No events yet", "Run the energy and code analyses to build the timeline.")}
      </div>
    </div>
    <div class="grid g-side" style="margin-top:16px">
      <div class="card"><div class="card-head"><h2>${icon("bell")}Open alerts</h2><a class="btn sm ghost" href="#alerts">View all${icon("arrow")}</a></div>
        <div class="list">${open.slice(0, 3).map(alertItem).join("") || empty("checkCircle", "All clear", "No open alerts right now.")}</div></div>
      <div class="card"><div class="card-head"><div><h2>${icon("message")}#wenoti-case</h2><div class="sub">Latest from the case channel</div></div><a class="btn sm ghost" href="#comms/wenoti">Open${icon("arrow")}</a></div>
        <div class="mini-msgs">${wenoti.messages.slice(-4).map(m => `<div class="mini-msg ${m.urgent ? "urgent" : ""}"><span class="avatar sm">${initials(m.from_name)}</span>
          <div><div class="small"><b>${esc(m.from_name)}</b> <span class="muted">${ago(m.time)}</span></div><div class="ink2 small">${renderText(m.text)}</div></div></div>`).join("")
          || empty("message", "No messages yet", "Start the conversation in Comms.")}</div>
        <a class="btn block" href="#comms/wenoti" style="margin-top:12px">${icon("message")}Reply in Comms</a></div>
    </div>`;

  const doEscalate = async btn => {
    const ok = await confirmDialog({
      title: "Escalate case verdict?", danger: true, ok: "Escalate",
      body: `This sends the verdict <b>${esc(c.verdict)} (${c.score}/100)</b> and its evidence to ${c.score >= 70 ? "EIA Command, EXUN Operations, the National Defence Liaison and the Department of Electricity" : "EXUN Operations and the Department of Electricity"}.`,
    });
    if (!ok) return;
    await busy(btn, async () => {
      const a = await api("/api/correlate/escalate", {});
      toast("Verdict escalated", { sub: "Sent to " + a.recipients.join(", ") });
      rerender();
    });
  };
  $("#escalate", el).onclick = e => doEscalate(e.currentTarget);
  $("[data-esc]", el).onclick = e => { e.preventDefault(); if (c.score >= 40) doEscalate($("#escalate")); else toast("Not enough evidence to escalate yet", { type: "info" }); };
  bindAlertButtons(el);
};

function alertItem(a) {
  return `<div class="item sev" style="--sev:${SEV[a.severity]}">
    <div class="meta">${pill(a.severity)}<span>${esc(a.source)}</span><span title="${esc(when(a.time))}">${ago(a.time)}</span>
      ${a.repeats ? `<span class="tag">×${a.repeats}</span>` : ""}${a.status !== "open" ? `<span class="tag">${icon("check")}${esc(a.status)}${a.handled_by ? " by " + esc(a.handled_by) : ""}</span>` : ""}</div>
    <div class="title">${esc(a.title)}</div><div class="body">${esc(a.body)}</div>
    <div class="tags" style="margin-top:10px">${(a.recipients || []).map(r => `<span class="tag">${icon("send")}${esc(r)}</span>`).join("")}</div>
    <div class="actions">${a.status === "open" ? `<button class="btn sm" data-ack="${a.id}">${icon("check")}Acknowledge</button>` : ""}
      ${a.status !== "resolved" ? `<button class="btn sm ghost" data-res="${a.id}">Resolve</button>` : ""}
      ${discussBtn({ type: "alert", id: a.id, label: a.title }, a.source === "Sightings" ? "sightings" : a.source === "Comms" ? "field" : "wenoti")}</div></div>`;
}

function bindAlertButtons(root) {
  $$("[data-ack],[data-res]", root).forEach(b => (b.onclick = () => busy(b, async () => {
    const ack = Boolean(b.dataset.ack);
    await api(`/api/alerts/${b.dataset.ack || b.dataset.res}/${ack ? "ack" : "resolve"}`, {});
    toast(ack ? "Alert acknowledged" : "Alert resolved");
    await refreshAlerts(false);
    rerender();
  })));
}

const filters = {};
VIEWS.alerts = async el => {
  await refreshAlerts(false);
  const f = filters.alerts || "open";
  const count = s => S.alerts.filter(a => s === "all" || a.status === s).length;
  const items = S.alerts.filter(a => f === "all" || a.status === f);
  el.innerHTML = head("Alerts", "Every automated finding is routed to the responsible authority based on its source and severity.") + `
    <div class="grid g-side"><div>
      <div class="seg" style="margin-bottom:14px">${["open", "acknowledged", "resolved", "all"].map(s => `<button data-f="${s}" class="${s === f ? "on" : ""}">${s}<span class="n">${count(s)}</span></button>`).join("")}</div>
      <div class="list">${items.map(alertItem).join("") || `<div class="card">${empty("checkCircle", f === "open" ? "No open alerts" : "Nothing here", "Alerts appear when analyses, sightings or inspections find something.")}</div>`}</div></div>
    <div><div class="card" style="position:sticky;top:20px"><div class="card-head"><h2>${icon("layers")}Routing rules</h2></div><div class="table-wrap"><table>
      <tr><th>Trigger</th><th>Severity</th><th>Notified</th></tr>
      ${[["Class removed but still referenced", "critical", "EIA Command, EXUN Ops, Cyber Forensics, Defence Liaison"],
         ["Energy spike HVAC can't explain", "critical", "EXUN Ops, Dept. of Electricity"],
         ["Reported usage ≠ meter register", "high", "Dept. of Electricity"],
         ["Case verdict ≥ 70, escalated", "critical", "EIA Command, EXUN Ops, Defence Liaison, Dept. of Electricity"],
         ["Strong POI-1 sighting (≥ 60)", "high", "EXUN Field Agents, EXUN Ops"],
         ["Agent requests backup", "critical", "EXUN Field Agents, EXUN Ops"],
         ["Severe surface damage", "high", "EXUN Ops, Facility Owner, Vendor"],
         ["Spike consistent with HVAC", "low", "Facility Owner"]].map(r => `<tr><td>${r[0]}</td><td>${pill(r[1])}</td><td class="small ink2">${r[2]}</td></tr>`).join("")}
    </table></div></div></div></div>`;
  $$("[data-f]", el).forEach(b => (b.onclick = () => { filters.alerts = b.dataset.f; rerender(); }));
  bindAlertButtons(el);
};

// ---------------------------------------------------------------- comms
const REF_ROUTES = { alert: "alerts", sighting: "sightings", energy: "energy", code: "code", agent: "agents" };
const REF_ICONS = { alert: "bell", sighting: "pin", energy: "zap", code: "code", agent: "users" };

function renderText(text) {
  const known = new Set([S.user.username, ...(S.comms?.dms || []).map(x => x.with)]);
  return esc(text).replace(/@([a-z0-9_]+)/gi, (m, u) => known.has(u.toLowerCase())
    ? `<span class="mention ${u.toLowerCase() === S.user.username ? "me" : ""}">@${esc(u)}</span>` : m);
}

const dayLabel = t => {
  const d = toDate(t), today = new Date(), y = new Date(Date.now() - 86400e3);
  const same = (a, b) => a.toDateString() === b.toDateString();
  return same(d, today) ? "Today" : same(d, y) ? "Yesterday" : d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
};

function messageHTML(m, prev) {
  const cont = prev && prev.from === m.from && !m.urgent && toDate(m.time) - toDate(prev.time) < 5 * 60e3 && dayLabel(prev.time) === dayLabel(m.time);
  const time = toDate(m.time).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${!prev || dayLabel(prev.time) !== dayLabel(m.time) ? `<div class="day-sep"><span>${dayLabel(m.time)}</span></div>` : ""}
  <div class="msg ${cont ? "cont" : ""} ${m.urgent ? "urgent" : ""} ${m.from === S.user.username ? "mine" : ""}" id="m-${m.id}">
    <span class="avatar">${cont ? "" : initials(m.from_name)}</span>
    <div class="mb">${cont ? "" : `<div class="mh"><span class="who">${esc(m.from_name)}</span><span class="tm" title="${esc(when(m.time))}">${time}</span>
      ${m.urgent ? `<span class="pill critical">Urgent</span>` : ""}${m.pinned ? `<span class="pin-tag">${icon("bookmark")}Pinned</span>` : ""}</div>`}
      <div class="txt">${renderText(m.text)}</div>
      ${m.ref ? `<a class="ref-card" href="#${REF_ROUTES[m.ref.type]}" data-ref='${esc(JSON.stringify(m.ref))}'>${icon(REF_ICONS[m.ref.type])}<span>${esc(m.ref.label || m.ref.type)}</span>${icon("arrow")}</a>` : ""}
    </div>
    <div class="tools"><button class="btn sm ghost icon" data-pin="${m.id}" title="${m.pinned ? "Unpin" : "Pin"}" aria-label="${m.pinned ? "Unpin message" : "Pin message"}">${icon("bookmark")}</button></div>
  </div>`;
}

VIEWS.comms = async (el, param) => {
  const [overview, sightings] = await Promise.all([api("/api/comms"), api("/api/sightings")]);
  S.comms = overview;
  updateBadge();
  const convs = () => [...S.comms.channels, ...S.comms.dms];
  if (param && !convs().some(c => c.id === param)) { toast("Conversation not found", { type: "err" }); param = null; }
  const st = { id: param || "wenoti", messages: [], last: null, sending: false };
  el.classList.add("comms-page");

  el.innerHTML = head("Comms", "Coordinate with other agents. Share evidence, mention teammates with @username, and flag anything urgent.", { eyebrow: "Command" }) + `
    <div class="comms ${param ? "thread-open" : ""}" id="comms">
      <aside class="comms-list" id="clist" aria-label="Conversations"></aside>
      <section class="thread" id="thread" aria-live="polite"></section>
    </div>`;
  const root = $("#comms", el);

  const listHTML = () => {
    const item = c => `<a href="#comms/${c.id}" data-conv="${c.id}" class="conv ${c.id === st.id ? "on" : ""} ${c.unread ? "has-unread" : ""}">
      ${c.kind === "dm" ? `<span class="avatar sm">${initials(c.name)}<i class="presence ${c.online ? "on" : ""}"></i></span>` : `<span class="hash">${icon("hash")}</span>`}
      <span class="cv"><span class="nm">${esc(c.kind === "dm" ? c.name : c.name)}</span>
        <span class="pv">${c.last ? esc((c.kind === "dm" ? "" : c.last.from_name.replace(/^Agent\s+/, "").split(" ")[0] + ": ") + c.last.text) : c.kind === "dm" ? esc(c.status || "Say hello") : esc(c.topic)}</span></span>
      ${c.mentions ? `<span class="badge-n at">@${c.mentions}</span>` : c.unread ? `<span class="badge-n">${c.unread}</span>` : ""}</a>`;
    const onlineCount = S.comms.online.length;
    return `<div class="sec">Channels</div>${S.comms.channels.map(item).join("")}
      <div class="sec">Direct messages <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:500">· ${onlineCount} online</span></div>
      ${S.comms.dms.map(item).join("") || `<div class="hint" style="padding:0 10px">No other agents yet.</div>`}`;
  };
  const drawList = () => { $("#clist", root).innerHTML = listHTML(); };

  const conv = () => convs().find(c => c.id === st.id);
  const attachOptions = () => {
    const open = S.alerts.filter(a => a.status !== "resolved").slice(0, 8);
    const recent = sightings.slice(0, 8);
    return `<option value="">Attach evidence…</option>
      ${open.length ? `<optgroup label="Alerts">${open.map(a => `<option value='${esc(JSON.stringify({ type: "alert", id: a.id, label: a.title }))}'>${esc(a.title.slice(0, 70))}</option>`).join("")}</optgroup>` : ""}
      ${recent.length ? `<optgroup label="Sightings">${recent.map(x => `<option value='${esc(JSON.stringify({ type: "sighting", id: x.id, label: `${SUBJECT_UI[subjectOf(x)].tag} sighting at ${x.location}` }))}'>${esc(SUBJECT_UI[subjectOf(x)].tag)} · ${esc(x.location)} · ${esc(when(x.seen_at))}</option>`).join("")}</optgroup>` : ""}
      <optgroup label="Analyses"><option value='${esc(JSON.stringify({ type: "energy", id: "latest", label: "Latest energy spike analysis" }))}'>Latest energy analysis</option>
      <option value='${esc(JSON.stringify({ type: "code", id: "latest", label: "Latest code forensics report" }))}'>Latest code forensics</option></optgroup>`;
  };

  const drawThread = data => {
    const c = conv();
    const mentionable = S.comms.dms.map(x => x.with);
    $("#thread", root).innerHTML = `
      <header class="thread-head">
        <button class="btn ghost icon back" id="cback" aria-label="Back to conversations">${icon("back")}</button>
        ${c.kind === "dm" ? `<span class="avatar">${initials(c.name)}<i class="presence ${c.online ? "on" : ""}"></i></span>` : `<span class="hash lg">${icon("hash")}</span>`}
        <div style="min-width:0;flex:1"><h2>${esc(c.name)}</h2><div class="sub">${c.kind === "dm" ? `${c.online ? "Online" : "Offline"} · ${esc(c.status || "")}` : esc(c.topic)}</div></div>
        ${data.pinned.length ? `<button class="btn sm ghost" id="pintoggle">${icon("bookmark")}${data.pinned.length} pinned</button>` : ""}
      </header>
      <div class="pinned hidden" id="pinned">${data.pinned.map(m => `<a href="#" data-jump="${m.id}"><b>${esc(m.from_name)}:</b> ${esc(m.text.slice(0, 140))}</a>`).join("")}</div>
      <div class="msgs" id="msgs"></div>
      <form class="composer" id="composer">
        <div id="refchip"></div>
        <textarea id="ctext" rows="1" placeholder="Message ${c.kind === "dm" ? esc(c.name) : "#" + esc(c.name)}" aria-label="Message"></textarea>
        <div class="bar">
          <select id="attach" class="btn sm ghost" aria-label="Attach evidence" style="width:auto;max-width:200px;height:30px;padding:0 8px">${attachOptions()}</select>
          <button type="button" class="btn sm ghost" id="urgent" aria-pressed="false" title="Urgent messages alert every field agent">${icon("siren")}Urgent</button>
          <span class="hint mention-hint">${mentionable.length ? "Mention: " + mentionable.map(u => `<button type="button" class="linkish" data-mention="${u}">@${u}</button>`).join(" ") : ""}</span>
          <span style="flex:1"></span>
          <span class="hint kbd-hint">Enter to send · Shift+Enter for a new line</span>
          <button class="btn primary sm" id="csend">${icon("send")}Send</button>
        </div>
      </form>`;
    st.messages = data.messages;
    st.last = data.messages.at(-1)?.time || null;
    $("#msgs", root).innerHTML = data.messages.length
      ? data.messages.map((m, i) => messageHTML(m, data.messages[i - 1])).join("")
      : empty(c.kind === "dm" ? "message" : "hash", "No messages yet", c.kind === "dm" ? `Start a private conversation with ${esc(c.name)}.` : "Be the first to post in this channel.");
    scrollBottom(true);
    bindThread();
  };

  const scrollBottom = force => {
    const box = $("#msgs", root);
    if (force || box.scrollHeight - box.scrollTop - box.clientHeight < 120) box.scrollTop = box.scrollHeight;
  };

  const append = msgs => {
    if (!msgs.length) return;
    const box = $("#msgs", root);
    if (!st.messages.length) box.innerHTML = "";
    for (const m of msgs) {
      if (st.messages.some(x => x.id === m.id)) continue;
      box.insertAdjacentHTML("beforeend", messageHTML(m, st.messages.at(-1)));
      st.messages.push(m);
    }
    st.last = st.messages.at(-1)?.time || st.last;
    scrollBottom(false);
  };

  const refChip = () => {
    $("#refchip", root).innerHTML = S.pendingRef ? `<div class="ref-chip">${icon(REF_ICONS[S.pendingRef.type] || "paperclip")}<span>${esc(S.pendingRef.label)}</span>
      <button type="button" class="btn ghost icon sm" id="refx" aria-label="Remove attachment">${icon("x")}</button></div>` : "";
    const x = $("#refx", root);
    if (x) x.onclick = () => { S.pendingRef = null; refChip(); };
  };

  const bindThread = () => {
    const ta = $("#ctext", root), urgent = $("#urgent", root);
    refChip();
    const grow = () => { ta.style.height = "auto"; ta.style.height = Math.min(160, ta.scrollHeight) + "px"; };
    ta.oninput = grow;
    ta.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("#composer", root).requestSubmit(); } };
    urgent.onclick = () => { const on = urgent.getAttribute("aria-pressed") !== "true"; urgent.setAttribute("aria-pressed", on); urgent.classList.toggle("danger", on); };
    $("#attach", root).onchange = e => { if (e.target.value) { S.pendingRef = JSON.parse(e.target.value); refChip(); e.target.value = ""; ta.focus(); } };
    $$("[data-mention]", root).forEach(b => (b.onclick = () => { ta.value += (ta.value && !/\s$/.test(ta.value) ? " " : "") + "@" + b.dataset.mention + " "; ta.focus(); grow(); }));
    $("#cback", root).onclick = () => { root.classList.remove("thread-open"); history.replaceState(null, "", "#comms"); };
    const pt = $("#pintoggle", root);
    if (pt) pt.onclick = () => $("#pinned", root).classList.toggle("hidden");
    $$("[data-jump]", root).forEach(a => (a.onclick = e => {
      e.preventDefault();
      const m = $("#m-" + a.dataset.jump, root);
      if (m) { m.scrollIntoView({ behavior: "smooth", block: "center" }); m.classList.add("flash"); setTimeout(() => m.classList.remove("flash"), 1600); }
    }));
    $("#composer", root).onsubmit = e => {
      e.preventDefault();
      const text = ta.value.trim();
      if (!text || st.sending) return;
      st.sending = true;
      const isUrgent = urgent.getAttribute("aria-pressed") === "true";
      return busy($("#csend", root), async () => {
        const m = await api(`/api/comms/${st.id}`, { text, ref: S.pendingRef, urgent: isUrgent });
        ta.value = ""; grow();
        S.pendingRef = null; refChip();
        if (isUrgent) { urgent.click(); toast("Urgent message sent", { sub: "Every field agent has been alerted" }); }
        append([m]);
        scrollBottom(true);
      }).finally(() => { st.sending = false; });
    };
    ta.focus({ preventScroll: true });
  };

  // Delegated: pin buttons and evidence links inside the thread
  root.addEventListener("click", e => {
    const p = e.target.closest("[data-pin]");
    if (p) return busy(p, async () => {
      const m = await api(`/api/comms/${st.id}/pin/${p.dataset.pin}`, {});
      toast(m.pinned ? "Message pinned" : "Message unpinned");
      await open(st.id);
    });
    const r = e.target.closest("[data-ref]");
    if (r) { const ref = JSON.parse(r.dataset.ref); if (ref.type === "sighting") S.flash = ref.id; }
    const c = e.target.closest("[data-conv]");
    if (c) { e.preventDefault(); history.replaceState(null, "", "#comms/" + c.dataset.conv); root.classList.add("thread-open"); open(c.dataset.conv); }
  });

  const markRead = async id => {
    try { await api(`/api/comms/${id}/read`, {}); } catch { return; }
    const c = convs().find(x => x.id === id);
    if (c) { c.unread = 0; c.mentions = 0; }
    updateBadge();
    drawList();
  };

  async function open(id) {
    st.id = id;
    drawList();
    $("#thread", root).innerHTML = `<div class="skeleton" style="height:100%;border-radius:0"></div>`;
    const data = await api(`/api/comms/${id}`);
    if (st.id !== id) return;
    drawThread(data);
    markRead(id);
  }

  // On phones the list shows first; don't open (and mark read) a conversation the user hasn't picked
  if (param || !matchMedia("(max-width: 820px)").matches) await open(st.id);
  else { st.id = null; drawList(); }

  // Poll for new messages and conversation updates while this view is open
  S.viewTimer = setInterval(async () => {
    if (S.route !== "comms" || document.hidden) return;
    try {
      const id = st.id;
      const [data, ov] = await Promise.all([id ? api(`/api/comms/${id}` + (st.last ? `?after=${encodeURIComponent(st.last)}` : "")) : { messages: [] }, api("/api/comms")]);
      S.comms = ov;
      if (id && st.id === id && data.messages.length) { append(data.messages); markRead(id); }
      else { drawList(); updateBadge(); }
      const head = $(".thread-head .sub", root), c = conv();
      if (head && c?.kind === "dm") head.textContent = `${c.online ? "Online" : "Offline"} · ${c.status || ""}`;
    } catch { /* transient */ }
  }, 4000);
};

// ---------------------------------------------------------------- energy
VIEWS.energy = async el => {
  const history = await api("/api/energy");
  el.innerHTML = head("Energy spike detection",
    "Recomputes daily usage from the meter register, finds outliers with a robust z-score, flags reported figures that disagree with the meter, and tests whether an HVAC startup could explain each spike.",
    { eyebrow: "Forensics" }) + `
    <div class="grid g-side">
      <div class="card"><div class="card-head"><div><h2>${icon("file")}Meter readings</h2><div class="sub">Department of Electricity dossier · Wenoti Arcade</div></div>
        <div class="row"><button class="btn sm ghost" id="loadcase">${icon("refresh")}Reset to dossier</button><button class="btn sm ghost" id="pastecsv">Paste CSV</button></div></div>
        <div id="csvbox" class="hidden" style="margin-bottom:12px"><textarea id="csv" class="code" style="min-height:110px" placeholder="date,meter,usage&#10;2026-10-13,18477.2,24.6"></textarea>
          <div class="row" style="margin-top:8px"><button class="btn sm primary" id="csvok">Import rows</button><button class="btn sm ghost" id="csvx">Cancel</button></div></div>
        <div class="table-wrap" style="max-height:360px;overflow:auto"><table class="edit-table"><thead><tr><th>Date</th><th class="num">Meter (kWh)</th><th class="num">Reported daily (kWh)</th><th></th></tr></thead><tbody id="etb"></tbody></table></div>
        <button class="btn sm ghost" id="addrow" style="margin-top:8px">${icon("plus")}Add day</button>
      </div>
      <div class="card"><div class="card-head"><div><h2>${icon("zap")}HVAC hypothesis</h2><div class="sub">Could a compressor startup explain the excess?</div></div></div>
        <div class="grid g2" style="gap:12px">
          <div class="field" style="margin:0"><label for="hkw">Compressor rating (kW)</label><input id="hkw" type="number" value="15" min="0" step="1"></div>
          <div class="field" style="margin:0"><label for="hh">Hours at full load</label><input id="hh" type="number" value="24" min="0" max="24" step="1"></div></div>
        <div class="hint">Defaults are generous: a large commercial unit running all day.</div>
        <label class="check"><input type="checkbox" id="harm" checked><span>Elevated harmonic content recorded<div class="hint" style="margin:0">Points to switching electronics rather than motors</div></span></label>
        <label class="check"><input type="checkbox" id="phase" checked><span>Phase imbalance recorded<div class="hint" style="margin:0">No single phase accounts for the excursion</div></span></label>
        <button class="btn primary block" id="run" style="margin-top:20px;height:40px">${icon("activity")}Analyse readings</button>
      </div>
    </div>
    <div id="eresult"></div>
    ${history.length ? `<div class="card" style="margin-top:16px"><div class="card-head"><h2>${icon("clock")}Previous analyses</h2></div><div class="table-wrap"><table>
      <tr><th>When</th><th>By</th><th>Spikes</th><th class="num">Discrepancies</th></tr>
      ${history.map(h => `<tr><td>${ago(h.created)}</td><td>${esc(h.by)}</td><td>${h.result.spikes.map(s => `${s.date} ${pill(s.verdict === "anomalous" ? "critical" : s.verdict === "suspicious" ? "high" : "good", s.verdict.replace("_", " "))}`).join(" ") || "none"}</td><td class="num">${h.result.discrepancies.length}</td></tr>`).join("")}
    </table></div></div>` : ""}`;

  const tbody = $("#etb", el);
  const addRow = (d = "", m = "", u = "") => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><input type="date" value="${d}" aria-label="Date"></td><td><input type="number" step="0.1" value="${m}" aria-label="Meter reading"></td>
      <td><input type="number" step="0.1" value="${u}" aria-label="Reported usage"></td><td><button class="btn sm ghost icon" aria-label="Remove row">${icon("x")}</button></td>`;
    $("button", tr).onclick = () => tr.remove();
    tbody.appendChild(tr);
  };
  const loadCase = () => { tbody.innerHTML = ""; CASE.energy.forEach(r => addRow(...r)); };
  loadCase();
  $("#loadcase", el).onclick = loadCase;
  $("#addrow", el).onclick = () => addRow();
  $("#pastecsv", el).onclick = () => { $("#csvbox", el).classList.remove("hidden"); $("#csv", el).focus(); };
  $("#csvx", el).onclick = () => $("#csvbox", el).classList.add("hidden");
  $("#csvok", el).onclick = () => {
    const lines = $("#csv", el).value.trim().split(/\n+/).map(l => l.split(/[,\t;]/).map(s => s.trim())).filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p[0]));
    if (!lines.length) return toast("No valid rows found", { type: "err", sub: "Expected: date,meter,usage" });
    tbody.innerHTML = ""; lines.forEach(p => addRow(p[0], p[1], p[2]));
    $("#csvbox", el).classList.add("hidden");
    toast(`Imported ${lines.length} rows`);
  };
  $("#run", el).onclick = e => busy(e.currentTarget, async () => {
    const rows = $$("tr", tbody).map(tr => { const i = $$("input", tr); return { date: i[0].value, meter: i[1].value, usage: i[2].value }; }).filter(r => r.date);
    const rep = await api("/api/energy/analyze", { rows, hvac_kw: +$("#hkw").value, hvac_hours: +$("#hh").value, harmonics: $("#harm").checked, phase_imbalance: $("#phase").checked });
    showEnergy($("#eresult"), rep.result);
    const sp = rep.result.spikes.filter(s => s.verdict !== "hvac_consistent").length;
    toast(sp ? `${sp} anomalous spike(s) detected` : "No anomalous spikes", { type: sp ? "err" : "ok", sub: rep.result.discrepancies.length ? `${rep.result.discrepancies.length} discrepancy referred to the Department of Electricity` : "" });
    refreshAlerts(false);
    $("#eresult").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  if (history[0]) showEnergy($("#eresult", el), history[0].result);
};

function showEnergy(root, r) {
  const top = [...r.spikes].sort((a, b) => b.usage - a.usage)[0];
  let log = false;
  const draw = () => {
    root.innerHTML = `
    <div class="grid g4" style="margin-top:16px">
      <div class="card stat"><div class="k">Baseline (median)</div><div class="v">${fmt(r.baseline_median)}</div><div class="d">kWh per day · MAD ${fmt(r.mad)}</div></div>
      <div class="card stat"><div class="k">Peak day</div><div class="v" style="color:${top ? "var(--critical)" : "inherit"}">${top ? fmt(top.usage) : "—"}</div><div class="d">${top ? `${when(top.date)} · ${top.ratio}× baseline` : "No spikes"}</div></div>
      <div class="card stat"><div class="k">HVAC could explain</div><div class="v">${top ? Math.round(top.hvac_coverage) + "%" : "—"}</div><div class="d">${top ? `of ${fmt(top.excess_kwh)} kWh excess` : "—"}</div></div>
      <div class="card stat"><div class="k">Meter discrepancies</div><div class="v" style="color:${r.discrepancies.length ? "var(--warning)" : "inherit"}">${r.discrepancies.length}</div><div class="d">${r.discrepancies.length ? "Referred to Dept. of Electricity" : "Records consistent"}</div></div>
    </div>
    <div class="card" style="margin-top:16px"><div class="card-head"><div><h2>${icon("activity")}Daily consumption</h2><div class="sub">October 2026 · computed from the meter register</div></div>
      <div class="seg"><button data-scale="lin" class="${log ? "" : "on"}">Linear</button><button data-scale="log" class="${log ? "on" : ""}">Log</button></div></div>
      ${energyChart(r.rows, r.spikes, log)}
      <div class="legend"><span><i class="sw sq" style="background:var(--bar)"></i>Normal day</span><span><i class="sw sq" style="background:var(--critical)"></i>Detected spike</span>
        <span><i class="sw dash"></i>Reported figure that disagrees with the meter</span></div></div>
    ${r.spikes.map(s => `<div class="card ${s.verdict === "anomalous" ? "tone-critical" : ""}" style="margin-top:16px"><div class="card-head">
      <div><h2>${when(s.date)}: ${fmt(s.usage)} kWh</h2><div class="sub">Anomaly score ${s.anomaly_score} · robust z ${s.z}</div></div>
      ${pill(s.verdict === "anomalous" ? "critical" : s.verdict === "suspicious" ? "high" : "good", s.verdict === "hvac_consistent" ? "Consistent with HVAC" : s.verdict)}</div>
      <ul style="margin:0;padding-left:18px" class="ink2">${s.reasons.map(x => `<li style="margin:3px 0">${esc(x)}</li>`).join("")}</ul></div>`).join("")}
    ${r.discrepancies.length ? `<div class="card" style="margin-top:16px"><div class="card-head"><div><h2>${icon("alert")}Record discrepancies</h2>
      <div class="sub">The dossier requires discrepancies to be forwarded to the Department of Electricity. These were referred automatically.</div></div></div>
      <div class="table-wrap"><table><tr><th>Date</th><th class="num">Reported</th><th class="num">Meter Δ</th><th class="num">Gap</th></tr>
      ${r.discrepancies.map(d => `<tr class="warn"><td>${when(d.date)}</td><td class="num">${fmt(d.reported)}</td><td class="num">${fmt(d.meter_delta)}</td><td class="num">${d.gap > 0 ? "+" : ""}${fmt(d.gap)}</td></tr>`).join("")}</table></div></div>` : ""}`;
    bindChart($("#echart", root), r.rows);
    $$("[data-scale]", root).forEach(b => (b.onclick = () => { log = b.dataset.scale === "log"; draw(); }));
  };
  draw();
}

// ---------------------------------------------------------------- code
VIEWS.code = async el => {
  const history = await api("/api/code");
  el.innerHTML = head("Code forensics",
    "Structurally compares a known-good build with the build recovered from the machine: classes, methods, dangling references and orphaned dependencies. Severity decides who gets alerted.",
    { eyebrow: "Forensics" }) + `
    <div class="card"><div class="grid g3" style="gap:12px">
      <div class="field" style="margin:0"><label for="mid">Machine ID</label><input id="mid" value="${CASE.machineId}" class="mono"></div>
      <div class="field" style="margin:0"><label for="cb">Baseline captured</label><input id="cb" type="date" value="2026-10-01"></div>
      <div class="field" style="margin:0"><label for="ca">Recovered build captured</label><input id="ca" type="date" value="2026-10-24"></div></div>
      <div class="grid g2" style="margin-top:16px">
        ${[["orig", "Known-good source", "fo"], ["alt", "Recovered source", "fa"]].map(([id, label, fid]) => `<div class="editor" id="ed-${id}">
          <div class="meta"><span class="label" style="margin:0">${label} <span class="muted" id="lc-${id}"></span></span>
            <label class="btn sm ghost" for="${fid}">${icon("upload")}Open file</label><input type="file" id="${fid}" class="sr" accept=".txt,.cpp,.cc,.h,.hpp,.c"></div>
          <textarea id="${id}" class="code" spellcheck="false" placeholder="Paste source or drop a file here"></textarea></div>`).join("")}
      </div>
      <div class="row" style="margin-top:14px"><button class="btn primary" id="crun">${icon("code")}Run forensic comparison</button>
        <button class="btn ghost" id="cload">${icon("refresh")}Load case files</button><button class="btn ghost" id="cswap">${icon("swap")}Swap</button></div>
    </div>
    <div id="cresult"></div>
    ${history.length ? `<div class="card" style="margin-top:16px"><div class="card-head"><h2>${icon("clock")}Previous comparisons</h2></div><div class="table-wrap"><table>
      <tr><th>When</th><th>By</th><th>Machine</th><th>Severity</th><th>Removed</th></tr>
      ${history.map(h => `<tr><td>${ago(h.created)}</td><td>${esc(h.by)}</td><td class="mono">${esc(h.machine_id)}</td><td>${pill(h.result.severity)}</td><td>${esc(h.result.removed_classes.join(", ") || "—")}</td></tr>`).join("")}
    </table></div></div>` : ""}`;

  const count = id => { const v = $("#" + id, el).value; $("#lc-" + id, el).textContent = v ? `· ${v.split("\n").length} lines` : ""; };
  const load = async () => {
    const [o, a] = await Promise.all(["samples/OriginalCode.txt", "samples/AlteredCode.txt"].map(p => fetch(p).then(r => r.text())));
    $("#orig", el).value = o; $("#alt", el).value = a; count("orig"); count("alt");
  };
  for (const [fid, id] of [["fo", "orig"], ["fa", "alt"]]) {
    const ta = $("#" + id, el), ed = $("#ed-" + id, el);
    ta.oninput = () => count(id);
    $("#" + fid, el).onchange = async e => { const f = e.target.files[0]; if (f) { ta.value = await f.text(); count(id); } };
    ed.ondragover = e => { e.preventDefault(); ed.classList.add("dragover"); };
    ed.ondragleave = () => ed.classList.remove("dragover");
    ed.ondrop = async e => { e.preventDefault(); ed.classList.remove("dragover"); const f = e.dataTransfer.files[0]; if (f) { ta.value = await f.text(); count(id); toast(`Loaded ${f.name}`); } };
  }
  $("#cload", el).onclick = () => load().then(() => toast("Case files loaded"));
  $("#cswap", el).onclick = () => { const o = $("#orig", el), a = $("#alt", el); [o.value, a.value] = [a.value, o.value]; count("orig"); count("alt"); };
  $("#crun", el).onclick = e => busy(e.currentTarget, async () => {
    const rep = await api("/api/code/analyze", {
      original: $("#orig").value, altered: $("#alt").value, machine_id: $("#mid").value,
      captured_before: $("#cb").value, captured_after: $("#ca").value, original_label: "known-good", altered_label: "recovered",
    });
    showCode($("#cresult"), rep);
    toast(`Severity: ${rep.result.severity.toUpperCase()}`, { type: ["critical", "high"].includes(rep.result.severity) ? "err" : "ok", sub: rep.result.findings[0]?.title });
    refreshAlerts(false);
    $("#cresult").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  await load();
  if (history[0]) showCode($("#cresult", el), history[0]);
};

const CODE_ROUTES = {
  critical: "EIA Command, EXUN Operations, Cyber Forensics Unit, National Defence Liaison",
  high: "EXUN Operations, Cyber Forensics Unit", medium: "Cyber Forensics Unit, Machine Vendor", low: "Logged only", none: "Logged only",
};

function showCode(root, rep) {
  const r = rep.result;
  root.innerHTML = `
    <div class="card ${r.severity === "critical" ? "tone-critical" : ""}" style="margin-top:16px"><div class="row between" style="align-items:flex-start">
      <div><div class="label">Overall severity</div><div class="row" style="gap:14px"><span style="font-size:30px;font-weight:800;letter-spacing:-.02em;color:${SEV[r.severity]}">${r.severity.toUpperCase()}</span>
        <span class="ink2">${r.stats.lines_before} → ${r.stats.lines_after} lines · <span style="color:var(--critical)">−${r.stats.removed}</span> / <span style="color:var(--good)">+${r.stats.added}</span></span></div>
        <div class="small muted mono" style="margin-top:6px">sha256 ${r.hash_before}… → ${r.hash_after}…</div></div>
      <div class="small" style="max-width:340px"><div class="label">${icon("send")} Alert routed to</div><div>${CODE_ROUTES[r.severity]}</div></div></div></div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><div class="card-head"><h2>${icon("alert")}Findings</h2><span class="muted small">${r.findings.length}</span></div>
        <div class="list">${r.findings.map(f => `<div class="item sev" style="--sev:${SEV[f.severity]}"><div class="meta">${pill(f.severity)}</div>
          <div class="title">${esc(f.title)}</div><div class="body">${esc(f.detail)}</div></div>`).join("")}</div></div>
      <div class="card"><div class="card-head"><h2>${icon("layers")}Class map</h2></div>
        <div class="label">Known-good</div>
        <div class="classes">${Object.entries(r.classes_before).map(([n, m]) => `<div class="cls ${r.removed_classes.includes(n) ? "gone" : ""}"><b>${esc(n)}</b><span>${m.map(esc).join(", ")}</span></div>`).join("")}</div>
        <div class="label" style="margin-top:16px">Recovered</div>
        <div class="classes">${Object.entries(r.classes_after).map(([n, m]) => `<div class="cls"><b>${esc(n)}</b><span>${m.map(esc).join(", ")}</span></div>`).join("") || `<span class="muted">No classes</span>`}</div>
        ${r.dangling.map(d => `<div class="label" style="margin-top:18px">Dangling references to <span style="color:var(--critical)">${esc(d.class)}</span></div>
          <div class="diff">${d.references.map(x => `<div class="del">L${x.line}  ${esc(x.code)}</div>`).join("")}</div>`).join("")}
      </div></div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h2>${icon("code")}Unified diff</h2></div>
      <div class="diff">${r.diff.map(l => `<div class="${l.startsWith("@@") || l.startsWith("---") || l.startsWith("+++") ? "hunk" : l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : ""}">${esc(l)}</div>`).join("") || "<div>No differences.</div>"}</div></div>`;
}

// ---------------------------------------------------------------- sightings
function subjectLine(s) {
  const subj = subjectOf(s);
  if (subj === "character") return `${esc(s.character_name || "Unidentified character")}${s.game ? ` <span class="muted">· ${esc(s.game)}</span>` : ""}`;
  if (subj === "agent") return `${s.agent_name ? `Claimed to be <b>${esc(s.agent_name)}</b>` : "Unnamed agent"}`;
  return "POI-1";
}

function sightingItem(s, agent, agents = []) {
  const subj = subjectOf(s);
  const linked = s.linked_agent && agents.find(a => a.id === s.linked_agent);
  const scorePill = subj === "agent" ? pill("info", "Agent report") : pill(levelSev(s.match_level), `${s.match_level} · ${s.match_score}`);
  return `<div class="item sev" id="s-${s.id}" style="--sev:${subj === "agent" ? "var(--change)" : SEV[levelSev(s.match_level)]}">
    <div class="meta"><span class="tag">${icon(SUBJECT_UI[subj].icon)}${SUBJECT_UI[subj].tag}</span>${scorePill}
      <span>${icon("pin")} ${esc(s.location)}</span><span>${icon("clock")} ${when(s.seen_at)}</span><span>${esc(s.reporter_name)}</span>
      ${s.status !== "new" ? `<span class="tag">${s.status === "verified" ? icon("check") : ""}${esc(s.status)}</span>` : ""}${s.case_ref ? `<span class="tag">${esc(s.case_ref)}</span>` : ""}</div>
    ${subj !== "poi1" ? `<div class="title">${subjectLine(s)}</div>` : ""}
    <div class="body" style="margin-top:${subj === "poi1" ? 8 : 0}px;color:var(--ink)">${esc(s.description)}</div>
    ${s.also_poi1 ? `<div class="banner" style="margin:10px 0 0">${icon("target")}<div><b>Also matches POI-1.</b> This character report fits the Wenoti profile.</div></div>` : ""}
    ${subj === "agent" && agent ? `<div class="row small" style="margin-top:8px">${linked ? `<span class="pill good">Linked to ${esc(linked.name)}</span>` : s.impostor ? `<span class="pill critical">Possible impersonator</span>` : `<span class="pill">Not linked</span>`}</div>` : ""}
    ${s.traits.length ? `<div class="tags" style="margin-top:10px">${s.traits.map(t => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
    ${agent ? `<div class="actions">
      ${s.status === "new" ? `<button class="btn sm" data-verify="${s.id}">${icon("check")}Verify</button><button class="btn sm ghost" data-dismiss="${s.id}">Dismiss</button>` : ""}
      ${subj === "agent" ? `<select class="btn sm" data-link="${s.id}" aria-label="Link to agent" style="width:auto;height:30px;padding:0 8px">
        <option value="">Link to agent…</option>${agents.map(a => `<option value="${a.id}" ${a.id === s.linked_agent ? "selected" : ""}>${esc(a.name)}</option>`).join("")}<option value="__impostor" ${s.impostor ? "selected" : ""}>Not an agent (impersonator)</option></select>` : ""}
      ${discussBtn({ type: "sighting", id: s.id, label: `${SUBJECT_UI[subj].tag} sighting at ${s.location}` }, "sightings")}</div>` : ""}</div>`;
}

VIEWS.sightings = async el => {
  const agent = S.user.role === "agent";
  const [all, agents] = await Promise.all([api("/api/sightings"), agent ? api("/api/agents") : []]);
  const subj = filters.subj || "all", lvl = filters.sight || "all";
  const bySubj = all.filter(s => subj === "all" || subjectOf(s) === subj);
  const items = bySubj.filter(s => lvl === "all" || subj === "agent" || s.match_level === lvl);
  const n = (list, f) => list.filter(f).length;
  const subjects = [["all", "All", null], ["poi1", "POI-1", "target"], ["character", "Characters", "gamepad"], ...(agent ? [["agent", "Agents", "badge"]] : [])];
  el.innerHTML = head(agent ? "Sightings" : "Sightings map",
    agent ? "Reports of POI-1, other video game characters and EXUN agents, each scored against its own profile."
      : "Recent public reports of POI-1 and other video game characters. Reporter identities are never shown.",
    { eyebrow: agent ? "Field" : "", actions: `<a class="btn primary" href="#report">${icon("plus")}Report a sighting</a>` }) + `
    <div class="grid g2">
      <div><div class="card" style="position:sticky;top:20px">${mapSVG({ sightings: items })}${mapLegend(false, true)}
        <div class="label" style="margin-top:18px">Profiles</div>
        <div class="small ink2"><b>POI-1:</b> pointed ears, bedazzled armour, scabbard, leather gloves and boots, thick accent.<br>
          <b>Other characters:</b> glitching or pixelated, impossible movement, game gear, power disturbances nearby.</div>
        ${agent ? `<div class="hint" style="margin-top:8px">Agent sightings are visible to agents and the reporter only.</div>` : ""}</div></div>
      <div>
        <div class="seg" style="margin-bottom:10px">${subjects.map(([k, l, ic]) => `<button data-subj="${k}" class="${k === subj ? "on" : ""}">${ic ? icon(ic) : ""}${l}<span class="n">${n(all, s => k === "all" || subjectOf(s) === k)}</span></button>`).join("")}</div>
        ${subj !== "agent" ? `<div class="seg" style="margin-bottom:14px">${["all", "strong", "possible", "low"].map(l => `<button data-f="${l}" class="${l === lvl ? "on" : ""}">${l}<span class="n">${n(bySubj, s => l === "all" || s.match_level === l)}</span></button>`).join("")}</div>` : ""}
        <div class="list">${items.map(s => sightingItem(s, agent, agents)).join("") || `<div class="card">${empty("eye", "No sightings", "Nothing matches this filter yet.", `<a class="btn primary" href="#report">${icon("plus")}Report a sighting</a>`)}</div>`}</div></div>
    </div>`;
  $$("[data-subj]", el).forEach(b => (b.onclick = () => { filters.subj = b.dataset.subj; rerender(); }));
  $$("[data-f]", el).forEach(b => (b.onclick = () => { filters.sight = b.dataset.f; rerender(); }));
  $$("[data-verify],[data-dismiss]", el).forEach(b => (b.onclick = () => busy(b, async () => {
    const v = Boolean(b.dataset.verify);
    await api(`/api/sightings/${b.dataset.verify || b.dataset.dismiss}/${v ? "verify" : "dismiss"}`, {});
    toast(v ? "Sighting verified" : "Sighting dismissed");
    rerender();
  })));
  $$("[data-link]", el).forEach(sel => (sel.onchange = () => busy(null, async () => {
    const impostor = sel.value === "__impostor";
    await api(`/api/sightings/${sel.dataset.link}/link`, { agent_id: impostor ? null : sel.value || null, impostor });
    toast(impostor ? "Marked as a possible impersonator" : sel.value ? "Linked to agent profile" : "Link removed");
    rerender();
  })));
  const flash = id => {
    const item = $("#s-" + id);
    if (!item) return;
    item.scrollIntoView({ behavior: "smooth", block: "center" });
    item.classList.add("flash");
    setTimeout(() => item.classList.remove("flash"), 1600);
  };
  $$(".pin", el).forEach(p => p.addEventListener("click", () => flash(p.dataset.id)));
  if (S.flash) { const id = S.flash; S.flash = null; setTimeout(() => flash(id), 50); }
};

const REPORT_COPY = {
  poi1: {
    title: "POI-1", desc: "The armoured man linked to Wenoti Arcade",
    placeholder: "e.g. Tall man in shiny armour with pointed ears and a sword on his belt. Leather gloves. Spoke with a strange accent and seemed confused by the traffic lights.",
    hint: "Start typing. Matching details light up as you write.",
  },
  character: {
    title: "Another video game character", desc: "Anyone who looks like they stepped out of a game",
    placeholder: "e.g. A short figure in a green tunic who looked slightly pixelated. Jumped clean over a parked car. The street lights flickered as they ran past.",
    hint: "Describe how they looked and moved, and anything odd nearby (flickering lights, sparks, humming).",
  },
  agent: {
    title: "An EXUN agent", desc: "Someone who is, or says they are, an agent",
    placeholder: "e.g. Woman in a grey coat said she was with EXUN, showed a badge and asked whether the arcade machines had been acting strangely.",
    hint: "If they gave a name or showed ID, include it. This helps us spot people impersonating agents.",
  },
};

VIEWS.report = async el => {
  let pick = null, subject = filters.reportSubject || "poi1";
  const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  el.innerHTML = head("Report a sighting",
    "Seen POI-1, another character who seems to have escaped a game, or an EXUN agent? Tell us what you saw. Every report is reviewed by an agent.",
    { eyebrow: "Help the investigation" }) + `<div id="rwrap"><form id="sf" novalidate>
      <div class="card" style="margin-bottom:16px"><div class="card-head"><h2><span class="step-n">1</span>Who did you see?</h2></div>
        <div class="choice-grid" role="radiogroup">${Object.entries(REPORT_COPY).map(([k, c]) => `<button type="button" class="choice ${k === subject ? "on" : ""}" data-subject="${k}" role="radio" aria-checked="${k === subject}">
          <span class="ic">${icon(SUBJECT_UI[k].icon)}</span><span class="t">${c.title}</span><span class="d">${c.desc}</span></button>`).join("")}</div></div>
      <div class="grid g2">
      <div class="card"><div class="card-head"><h2><span class="step-n">2</span>What did you see?</h2></div>
        <div id="extra"></div>
        <div class="field" style="margin-top:0"><label for="desc">Description</label><textarea name="description" id="desc" rows="6" required></textarea></div>
        <div class="row between" style="margin-top:16px"><span class="label" style="margin:0" id="mlabel"></span><span class="mono small" id="mscore">0</span></div>
        <div class="meter" id="mmeter"><span id="mbar" style="width:0%"></span></div>
        <div class="tags" id="mchips" style="margin-top:12px"></div>
        <div class="hint" id="mhint" style="margin-top:10px"></div>
      </div>
      <div class="card"><div class="card-head"><h2><span class="step-n">3</span>Where and when?</h2></div>
        <div id="pickmap"></div>
        <div class="grid g2" style="gap:12px;margin-top:12px">
          <div class="field" style="margin:0"><label for="place">Location</label><select name="place" id="place"><option value="">Tap the map or choose…</option>${Object.keys(PLACES).map(p => `<option>${esc(p)}</option>`).join("")}</select></div>
          <div class="field" style="margin:0"><label for="seen">Time</label><input type="datetime-local" id="seen" name="seen_at" value="${nowLocal}"></div></div>
        <div class="hint" id="locmsg">No location selected yet.</div>
        <label class="check"><input type="checkbox" name="anonymous"><span>Submit anonymously<div class="hint" style="margin:0">Agents won't see your name.</div></span></label>
        <div class="hint" id="privacy" style="margin-top:10px"></div>
        <div class="error" id="serr"></div>
        <button class="btn primary block" style="margin-top:16px;height:42px">${icon("send")}Submit report</button>
      </div></div></form></div>`;

  const f = $("#sf", el);
  const setSubject = k => {
    subject = filters.reportSubject = k;
    $$(".choice", el).forEach(c => { const on = c.dataset.subject === k; c.classList.toggle("on", on); c.setAttribute("aria-checked", on); });
    const keep = { character_name: f.character_name?.value, game: f.game?.value, agent_name: f.agent_name?.value };
    $("#extra", el).innerHTML = k === "character" ? `<div class="grid g2" style="gap:12px;margin-bottom:14px">
        <div class="field" style="margin:0"><label for="cname">Character name</label><input id="cname" name="character_name" placeholder="If you recognise them"></div>
        <div class="field" style="margin:0"><label for="cgame">Game</label><input id="cgame" name="game" placeholder="e.g. Dungeon Dash"></div></div>`
      : k === "agent" ? `<div class="field" style="margin:0 0 14px"><label for="aname">Name or codename they gave</label><input id="aname" name="agent_name" placeholder="Leave blank if they didn't say"></div>` : "";
    Object.entries(keep).forEach(([n, v]) => { if (f[n] && v) f[n].value = v; });
    f.description.placeholder = REPORT_COPY[k].placeholder;
    $("#mlabel", el).textContent = k === "agent" ? "Details we look for" : `Match with ${k === "poi1" ? "POI-1" : "escaped-character"} profile`;
    $("#mchips", el).innerHTML = SUBJECTS[k].traits.map(([t]) => `<span class="chip" data-t="${esc(t)}">${icon("check")}${esc(t)}</span>`).join("");
    $("#privacy", el).innerHTML = k === "agent" ? `${icon("shield")} Agent sightings are only visible to EXUN, never on the public map.` : "";
    live();
  };
  const live = () => {
    const m = scoreSighting(subject, f.description.value, pick?.x, pick?.y);
    $("#mscore", el).textContent = subject === "agent" ? `${m.traits.length}/${SUBJECTS.agent.traits.length}` : m.score;
    $("#mbar", el).style.width = (subject === "agent" ? (100 * m.traits.length) / SUBJECTS.agent.traits.length : m.score) + "%";
    $("#mbar", el).style.background = subject === "agent" ? "var(--change)" : m.level === "strong" ? "var(--critical)" : m.level === "possible" ? "var(--warning)" : "var(--accent)";
    $$(".chip", el).forEach(c => c.classList.toggle("on", m.traits.includes(c.dataset.t)));
    const empty = !f.description.value.trim();
    $("#mhint", el).textContent = empty || subject === "agent" ? REPORT_COPY[subject].hint
      : m.level === "strong" ? (subject === "poi1" ? "This closely matches POI-1. Agents will be alerted as soon as you submit." : "This looks like an escaped character. Agents will be alerted when you submit.")
      : m.level === "possible" ? "Partial match. Any other details you remember help." : "Keep going: clothing, how they moved, what was happening around them.";
  };
  const drawMap = () => {
    $("#pickmap", el).innerHTML = mapSVG({ pick, id: "pm" });
    bindPicker($("#pm", el), (x, y) => { pick = { x, y }; f.place.value = ""; $("#locmsg", el).textContent = nearestPlace(x, y); drawMap(); live(); });
  };
  $$(".choice", el).forEach(c => (c.onclick = () => setSubject(c.dataset.subject)));
  drawMap();
  setSubject(subject);
  f.description.oninput = live;
  f.place.onchange = e => {
    const p = PLACES[e.target.value];
    if (p) { pick = { x: p[0], y: p[1] }; $("#locmsg", el).textContent = e.target.value; drawMap(); live(); }
  };
  f.onsubmit = e => {
    e.preventDefault();
    $("#serr", el).textContent = "";
    if (f.description.value.trim().length < 10) { $("#serr", el).textContent = "Please describe what you saw (at least 10 characters)."; return f.description.focus(); }
    if (!pick) { $("#serr", el).textContent = "Please choose a location on the map or from the list."; return; }
    return busy(e.submitter, async () => {
      const s = await api("/api/sightings", {
        subject, description: f.description.value, seen_at: f.seen_at.value, anonymous: f.anonymous.checked,
        character_name: f.character_name?.value, game: f.game?.value, agent_name: f.agent_name?.value,
        location: f.place.value || nearestPlace(pick.x, pick.y), x: pick.x, y: pick.y,
      });
      const msg = s.subject === "agent"
        ? ["Agent report received", "EXUN Operations will review it. If this person isn't a real agent, we'll follow up.", "info", "Agent report"]
        : s.also_poi1 || (s.subject === "poi1" && s.match_level === "strong")
          ? ["Field agents have been alerted", "Your description closely matches the person EXUN is looking for. Thank you. Stay at a safe distance.", "critical", `strong match · ${s.match_score}`]
          : s.match_level === "strong" ? ["Field agents have been alerted", "This looks like a character that has left its game. Thank you. Stay at a safe distance.", "critical", `strong match · ${s.match_score}`]
          : s.match_level === "possible" ? ["An analyst will review your report", "It partially matches the profile. Thank you for reporting.", "medium", `possible match · ${s.match_score}`]
          : ["Report logged", "Thank you. Every report helps, even when it doesn't match.", "low", `low match · ${s.match_score}`];
      $("#rwrap", el).innerHTML = `<div class="card" style="max-width:560px;margin:0 auto;text-align:center;padding:36px 24px">
        <div style="width:56px;height:56px;border-radius:50%;margin:0 auto 14px;display:grid;place-items:center;background:var(--good-soft);color:var(--good)">${icon("check")}</div>
        <h2 style="font-size:20px;margin-bottom:6px">${msg[0]}</h2><p class="ink2">${msg[1]}</p>
        <div style="margin:16px 0" class="row" ><span style="flex:1"></span><span class="tag">${icon(SUBJECT_UI[s.subject].icon)}${SUBJECT_UI[s.subject].tag}</span>${pill(msg[2], msg[3])}<span style="flex:1"></span></div>
        ${s.traits.length ? `<div class="tags" style="justify-content:center">${s.traits.map(t => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
        <div class="row" style="justify-content:center;margin-top:22px"><button class="btn primary" id="again">${icon("plus")}Report another</button><a class="btn" href="#sightings">View map</a></div></div>`;
      $("#again", el).onclick = rerender;
      if (msg[2] === "critical") toast("Strong match: agents alerted", { type: "info" });
    });
  };
};

// ---------------------------------------------------------------- integrity
VIEWS.integrity = async el => {
  const history = await api("/api/integrity");
  const imgs = { main: null, ref: null };
  let result = null, showOriginal = false;
  el.innerHTML = head("Asset integrity check",
    "Upload a photo of the machine casing. Computer vision flags abrasions and discolouration and, with a reference photo, anything that changed. Images are analysed on your device.",
    { eyebrow: S.user.role === "agent" ? "Field" : "" }) + `
    <div class="grid g-side">
      <div class="card"><div class="card-head"><h2>${icon("scan")}Analysis</h2>
        <div class="seg hidden" id="viewseg"><button data-v="ann" class="on">Annotated</button><button data-v="orig">Original</button></div></div>
        <div class="stage" id="stage">${empty("scan", "No photo yet", "Add an inspection photo, or try the sample photos.")}</div>
        <div class="legend"><span><i class="sw sq" style="background:#ee7a2f"></i>Discolouration</span><span><i class="sw sq" style="background:#e0a526"></i>Abrasion</span><span><i class="sw sq" style="background:#b38cff"></i>Change vs reference</span></div>
        <div id="imetrics"></div>
      </div>
      <div class="card"><div class="card-head"><h2>${icon("upload")}Photos</h2><button class="btn sm ghost" id="isample">Use sample photos</button></div>
        ${[["main", "Inspection photo", "Required"], ["ref", "Reference photo", "Optional · same angle, taken earlier"]].map(([k, t, h]) => `
          <div class="field"><span class="label">${t}</span><label class="drop" id="drop-${k}" for="file-${k}"><div class="ic">${icon("upload")}</div><div><b>Click to upload</b> or drag a photo here</div><div class="hint">${h}</div></label>
          <input type="file" id="file-${k}" class="sr" accept="image/*"></div>`).join("")}
        <div class="grid g2" style="gap:12px;margin-top:4px">
          <div class="field"><label for="imid">Machine ID</label><input id="imid" class="mono" value="${CASE.machineId}"></div>
          <div class="field"><label for="inotes">Notes</label><input id="inotes" placeholder="e.g. right-side casing"></div></div>
        <div class="row" style="margin-top:18px"><button class="btn primary" id="irun" disabled>${icon("scan")}Analyse</button><button class="btn" id="isave" disabled>${icon("send")}Submit report</button></div>
      </div>
    </div>
    ${history.length ? `<div class="card" style="margin-top:16px"><div class="card-head"><h2>${icon("clock")}${S.user.role === "agent" ? "All inspections" : "My inspections"}</h2></div><div class="table-wrap"><table>
      <tr><th></th><th>When</th><th>By</th><th>Machine</th><th>Condition</th><th>Findings</th></tr>
      ${history.map(h => `<tr><td>${h.thumbnail ? `<img class="thumb" src="${h.thumbnail}" alt="Inspection thumbnail">` : ""}</td><td>${ago(h.created)}</td><td>${esc(h.by_name)}</td><td class="mono small">${esc(h.machine_id)}</td>
        <td>${pill(h.condition === "severe" ? "critical" : h.condition === "moderate" ? "medium" : "good", `${h.condition} · ${h.score}`)}</td><td class="small ink2">${h.findings.slice(0, 3).map(f => esc(f.text)).join("<br>")}</td></tr>`).join("")}
    </table></div></div>` : ""}`;

  const stage = $("#stage", el);
  const show = node => { stage.replaceChildren(node); };
  const setImg = (k, img, name) => {
    imgs[k] = img;
    const d = $("#drop-" + k, el);
    d.classList.add("has");
    const src = img instanceof HTMLCanvasElement ? img.toDataURL("image/jpeg", .6) : img.src;
    d.innerHTML = `<img src="${src}" alt=""><div style="flex:1;min-width:0"><b>${esc(name)}</b><div class="hint">Click to replace</div></div>${icon("check")}`;
    if (k === "main") { show(img); $("#irun", el).disabled = false; }
    result = null; $("#isave", el).disabled = true; $("#viewseg", el).classList.add("hidden"); $("#imetrics", el).innerHTML = "";
  };
  const loadFile = file => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Could not read that image")); i.src = URL.createObjectURL(file); });
  for (const k of ["main", "ref"]) {
    const input = $("#file-" + k, el), d = $("#drop-" + k, el);
    const take = async file => { if (!file || !file.type.startsWith("image/")) return toast("Please choose an image file", { type: "err" }); try { setImg(k, await loadFile(file), file.name); } catch (e) { toast(e.message, { type: "err" }); } };
    input.onchange = e => take(e.target.files[0]);
    d.ondragover = e => { e.preventDefault(); d.classList.add("dragover"); };
    d.ondragleave = () => d.classList.remove("dragover");
    d.ondrop = e => { e.preventDefault(); d.classList.remove("dragover"); take(e.dataTransfer.files[0]); };
  }
  $("#isample", el).onclick = () => { setImg("ref", CV.sample(false), "sample-reference.png"); setImg("main", CV.sample(true), "sample-inspection.png"); toast("Sample photos loaded", { type: "info" }); };
  $$("#viewseg button", el).forEach(b => (b.onclick = () => {
    showOriginal = b.dataset.v === "orig";
    $$("#viewseg button", el).forEach(x => x.classList.toggle("on", x === b));
    show(showOriginal ? imgs.main : result.overlay);
  }));
  $("#irun", el).onclick = e => busy(e.currentTarget, async () => {
    await new Promise(r => setTimeout(r, 30));
    result = CV.analyze(imgs.main, imgs.ref);
    show(result.overlay);
    $("#viewseg", el).classList.remove("hidden");
    $$("#viewseg button", el).forEach(x => x.classList.toggle("on", x.dataset.v === "ann"));
    const m = result.metrics;
    const cond = result.score >= 60 ? ["critical", "Severe"] : result.score >= 30 ? ["medium", "Moderate"] : ["good", "Minor"];
    $("#imetrics", el).innerHTML = `<div class="gauge" style="margin-top:18px"><div class="num" style="font-size:42px;color:${SEV[cond[0]]}">${result.score}</div>
        <div><div class="lbl">${cond[1]} surface damage</div><div class="muted small">${m.resolution} · ${m.regions} region(s) flagged</div></div></div>
      <div class="grid g3" style="gap:10px;margin-top:14px">
        <div class="card stat" style="padding:12px"><div class="k">Discoloured</div><div class="v" style="font-size:20px">${m.discolouration_pct}%</div></div>
        <div class="card stat" style="padding:12px"><div class="k">Abraded</div><div class="v" style="font-size:20px">${m.abrasion_pct}%</div></div>
        <div class="card stat" style="padding:12px"><div class="k">Changed</div><div class="v" style="font-size:20px">${m.change_vs_reference_pct == null ? "—" : m.change_vs_reference_pct + "%"}</div></div></div>
      <ul class="ink2" style="padding-left:18px;margin:14px 0 6px">${result.findings.map(f => `<li style="margin:3px 0">${esc(f.text)}</li>`).join("")}</ul>
      <div class="hint">Surface findings describe the exterior only. They don't establish internal damage or cause.</div>`;
    $("#isave", el).disabled = false;
  });
  $("#isave", el).onclick = e => busy(e.currentTarget, async () => {
    const r = await api("/api/integrity", { machine_id: $("#imid").value, notes: $("#inotes").value, score: result.score, metrics: result.metrics, findings: result.findings, thumbnail: result.thumbnail });
    toast("Inspection submitted", { sub: r.condition === "minor" ? "No alert needed" : "The facility owner has been notified" });
    rerender();
  });
};

// ---------------------------------------------------------------- agents
VIEWS.agents = async el => {
  const [agents, sightings] = await Promise.all([api("/api/agents"), api("/api/sightings")]);
  const seenBy = id => sightings.filter(s => s.linked_agent === id);
  const me = agents.find(a => a.username === S.user.username);
  let pick = me ? { x: me.x, y: me.y } : null;
  const tone = s => (/backup/i.test(s) ? "critical" : /relocat|off/i.test(s) ? "medium" : "good");
  el.innerHTML = head("Agent tracker", "Last known positions and status of EXUN personnel. Check in to update your own, or message a teammate directly.",
    { eyebrow: "Field", actions: `<a class="btn" href="#comms/field">${icon("hash")}field-ops</a>` }) + `
    <div class="grid g-side">
      <div class="card"><div id="amap"></div><div class="legend"><span><i class="sw dia" style="background:var(--accent)"></i>Agent position</span>${me ? `<span class="muted">Tap the map to set your check-in location</span>` : ""}</div></div>
      <div class="card">${me ? `<div class="card-head"><div><h2>${icon("pin")}Check in</h2><div class="sub">${esc(me.name)} · last ${ago(me.last_checkin)}</div></div></div><form id="cf">
        <div class="field" style="margin-top:0"><label for="cplace">Location</label><select name="place" id="cplace"><option value="">Tap the map or choose…</option>${Object.keys(PLACES).map(p => `<option ${p === me.location ? "selected" : ""}>${esc(p)}</option>`).join("")}</select>
          <div class="hint" id="cmsg">${esc(me.location)}</div></div>
        <div class="field"><label for="cstat">Status</label><select name="status" id="cstat">${["Active - Surveillance", "Active - Case lead", "Active - Interview", "Off duty", "Relocation pending", "Needs backup"].map(s => `<option ${s === me.status ? "selected" : ""}>${s}</option>`).join("")}</select>
          <div class="hint">"Needs backup" alerts every field agent immediately.</div></div>
        <div class="field"><label for="cnote">Note</label><input name="note" id="cnote" placeholder="Optional"></div>
        <button class="btn primary block" style="margin-top:18px">${icon("check")}Check in</button></form>`
        : empty("users", "No agent profile", "This account isn't linked to an agent profile.")}</div>
    </div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h2>${icon("users")}Personnel</h2><span class="muted small">${agents.length} agents</span></div><div class="table-wrap"><table>
      <tr><th>Agent</th><th>Status</th><th>Last location</th><th>Last check-in</th><th>Public sightings</th><th>Assignment</th><th></th></tr>
      ${agents.map(a => `<tr class="${tone(a.status) === "critical" ? "flag" : ""}"><td><div class="row" style="gap:10px;flex-wrap:nowrap"><span class="avatar">${initials(a.name)}</span><div><div style="font-weight:600">${esc(a.name)}${a.username === S.user.username ? ' <span class="muted small">(you)</span>' : ""}</div><div class="small muted mono">${esc(a.id)} · ${esc(a.rank)}</div></div></div></td>
        <td>${pill(tone(a.status), a.status)}</td><td>${esc(a.location)}</td><td title="${esc(when(a.last_checkin))}">${ago(a.last_checkin)}</td>
        <td>${seenBy(a.id).length ? `<a href="#sightings" data-seen="${seenBy(a.id)[0].id}">${seenBy(a.id).length} · ${esc(seenBy(a.id)[0].location.split(",")[0])}</a><div class="hint">${ago(seenBy(a.id)[0].seen_at)}</div>` : `<span class="muted">—</span>`}</td>
        <td class="small ink2">${esc(a.assignment)}
        ${a.trail.length ? `<div class="hint">Trail: ${a.trail.slice(0, 3).map(t => esc(t.location.split(",")[0])).join(" ← ")}</div>` : ""}</td>
        <td>${a.username !== S.user.username ? `<a class="btn sm" href="#comms/${dmId(S.user.username, a.username)}">${icon("message")}Message</a>` : ""}</td></tr>`).join("")}
    </table></div></div>`;
  $$("[data-seen]", el).forEach(a => (a.onclick = () => { S.flash = a.dataset.seen; filters.subj = "agent"; }));
  const draw = () => {
    $("#amap", el).innerHTML = mapSVG({ agents, pick: me ? pick : null, id: "am" });
    if (me) bindPicker($("#am", el), (x, y) => { pick = { x, y }; $("#cplace", el).value = ""; $("#cmsg", el).textContent = nearestPlace(x, y); draw(); });
  };
  draw();
  if (!me) return;
  $("#cplace", el).onchange = e => { const p = PLACES[e.target.value]; if (p) { pick = { x: p[0], y: p[1] }; $("#cmsg", el).textContent = e.target.value; draw(); } };
  $("#cf", el).onsubmit = e => {
    e.preventDefault();
    const f = e.target;
    return busy(e.submitter, async () => {
      const r = await api("/api/agents/checkin", { location: f.place.value || nearestPlace(pick.x, pick.y), x: pick.x, y: pick.y, status: f.status.value, note: f.note.value });
      toast(/backup/i.test(r.status) ? "Backup requested. All field agents alerted." : "Checked in", { type: /backup/i.test(r.status) ? "err" : "ok", sub: r.location });
      refreshAlerts(false);
      rerender();
    });
  };
};

boot();
