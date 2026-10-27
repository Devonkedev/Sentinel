// EXUN Sentinel - single-page frontend (no build step, no dependencies)

const S = { token: null, user: null, places: {}, alerts: [] };
try { S.token = localStorage.getItem("exun_token"); } catch (e) { /* storage blocked */ }

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

// ---------------------------------------------------------------- helpers
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = n => n == null ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 });
const when = s => s ? s.replace("T", " ").slice(0, 16) : "—";
const pill = (level, text) => `<span class="pill ${esc(level)}">${esc(text || level)}</span>`;
const sevColor = { critical: "var(--critical)", high: "var(--serious)", medium: "var(--warning)", low: "var(--ink-3)", none: "var(--ink-3)" };

async function api(path, body) {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(S.token ? { Authorization: "Bearer " + S.token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && S.user) { logout(true); }
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function setToken(t) {
  S.token = t;
  try { t ? localStorage.setItem("exun_token", t) : localStorage.removeItem("exun_token"); } catch (e) { /* ignore */ }
}

async function logout(silent) {
  if (!silent) { try { await api("/api/logout", {}); } catch (e) { /* ignore */ } }
  setToken(null); S.user = null; location.hash = ""; render();
}

// ---------------------------------------------------------------- map
const DISTRICTS = [
  { name: "Civic Quarter", d: "M4 4 H44 V34 H4 Z" },
  { name: "Arcade District", d: "M50 4 H96 V34 H50 Z" },
  { name: "Old Town", d: "M4 40 H44 V76 H4 Z" },
  { name: "Central", d: "M50 40 H96 V47 H50 Z" },
  { name: "Utilities", d: "M50 56 H65 V76 H50 Z" },
  { name: "Riverside", d: "M70 56 H96 V76 H70 Z" },
];

function mapSVG({ sightings = [], agents = [], pick = null, id = "map" }) {
  const places = Object.entries(S.places).map(([name, [x, y]]) =>
    `<g><rect x="${x - 1.1}" y="${y - 1.1}" width="2.2" height="2.2" fill="#3a4763"/>
      <text x="${x + 2}" y="${y + 0.9}" font-size="2.3" fill="#7f8aa3">${esc(name.split(",")[0])}</text></g>`).join("");
  const sColor = { strong: "var(--critical)", possible: "var(--warning)", low: "var(--ink-3)" };
  const pins = sightings.filter(s => s.x != null).map(s =>
    `<circle class="pin" data-id="${s.id}" cx="${s.x}" cy="${s.y}" r="1.8" fill="${sColor[s.match_level]}" stroke="#0e1422" stroke-width=".6"
      opacity="${s.status === "dismissed" ? .35 : 1}"><title>${esc(s.location)} · match ${s.match_score} · ${when(s.seen_at)}</title></circle>`).join("");
  const seen = {};
  const ags = agents.map(a0 => {
    const k = a0.x + "," + a0.y, n = (seen[k] = (seen[k] || 0) + 1) - 1;
    const a = { ...a0, x: a0.x - 3 - n * 4.6, y: a0.y + 3.2 };
    return `<g><path d="M${a.x} ${a.y - 2.4} L${a.x + 2} ${a.y} L${a.x} ${a.y + 2.4} L${a.x - 2} ${a.y} Z" fill="var(--accent)" stroke="#0e1422" stroke-width=".6"><title>${esc(a.name)} · ${esc(a.status)}</title></path>
      <text x="${a.x}" y="${a.y + 4.6}" font-size="2.2" fill="#cfe0ff" font-weight="600" text-anchor="middle">${esc(a.name.replace("Agent ", "").split(" ")[0])}</text></g>`;
  }).join("");
  const picked = pick ? `<g><circle cx="${pick.x}" cy="${pick.y}" r="2.6" fill="none" stroke="#fff" stroke-width=".7"/><circle cx="${pick.x}" cy="${pick.y}" r=".8" fill="#fff"/></g>` : "";
  return `<svg class="map ${pick !== null ? "pick" : ""}" id="${id}" viewBox="0 0 100 80" role="img" aria-label="Map of nuxEland">
    ${DISTRICTS.map(d => `<path d="${d.d}" fill="#131b2c" stroke="#1f2a40" stroke-width=".4"/>`).join("")}
    ${DISTRICTS.map(d => { const m = d.d.match(/M(\d+) (\d+)/); return `<text x="${+m[1] + 1.5}" y="${+m[2] + 4}" font-size="2.3" fill="#4d5a76" font-weight="700" letter-spacing=".15">${d.name.toUpperCase()}</text>`; }).join("")}
    <path d="M0 50 C 20 46, 30 54, 48 52 S 70 44, 100 49" fill="none" stroke="#1d3a5f" stroke-width="2.6"/>
    <path d="M0 37 H100 M47 0 V80 M67.5 53 V80" stroke="#26314a" stroke-width="1.4"/>
    <text x="5" y="38.6" font-size="2" fill="#6b7896" font-style="italic">92nd Avenue →</text>
    ${places}${ags}${pins}${picked}
  </svg>`;
}

function bindPicker(svg, onPick) {
  svg.addEventListener("click", e => {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    onPick(Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10);
  });
}

function nearestPlace(x, y) {
  let best = null, bd = 1e9;
  for (const [name, [px, py]] of Object.entries(S.places)) {
    const d = Math.hypot(px - x, py - y);
    if (d < bd) { bd = d; best = name; }
  }
  return bd < 6 ? best : `Near ${best} (${x}, ${y})`;
}

// ---------------------------------------------------------------- energy chart
function energyChart(rows, spikes, log) {
  const W = 720, H = 260, P = { l: 52, r: 12, t: 16, b: 34 };
  const vals = rows.map(r => r.usage ?? 0);
  const max = Math.max(...vals, 1);
  const y = v => log
    ? H - P.b - (Math.log10(Math.max(v, 1)) / Math.log10(max * 1.2)) * (H - P.t - P.b)
    : H - P.b - (v / (max * 1.08)) * (H - P.t - P.b);
  const bw = (W - P.l - P.r) / rows.length;
  const ticks = log ? [1, 10, 100, 1000].filter(t => t <= max * 1.2) : [0, .25, .5, .75, 1].map(f => Math.round(max * f));
  const spikeDates = new Set(spikes.map(s => s.date));
  const bars = rows.map((r, i) => {
    const x = P.l + i * bw + 2, w = Math.max(2, bw - 4), top = y(r.usage ?? 0), base = H - P.b;
    const color = spikeDates.has(r.date) ? "var(--critical)" : "var(--bar)";
    const hgt = Math.max(1, base - top), rr = Math.min(4, w / 2, hgt);
    const path = `M${x} ${base} V${top + rr} Q${x} ${top} ${x + rr} ${top} H${x + w - rr} Q${x + w} ${top} ${x + w} ${top + rr} V${base} Z`;
    const rep = r.discrepancy != null && r.reported != null
      ? `<line x1="${x - 2}" x2="${x + w + 2}" y1="${y(r.reported)}" y2="${y(r.reported)}" stroke="var(--warning)" stroke-width="2" stroke-dasharray="3 2"/>` : "";
    return `<g class="bar" data-i="${i}"><rect x="${P.l + i * bw}" y="${P.t}" width="${bw}" height="${H - P.t - P.b}" fill="transparent"/>
      <path d="${path}" fill="${color}"/>${rep}
      <text x="${x + w / 2}" y="${H - P.b + 14}" font-size="10" fill="var(--ink-3)" text-anchor="middle">${r.date.slice(8)}</text></g>`;
  }).join("");
  const labels = spikes.map(s => {
    const i = rows.findIndex(r => r.date === s.date);
    return `<text x="${P.l + i * bw + bw / 2}" y="${y(s.usage) - 6}" font-size="11" fill="var(--ink)" font-weight="600" text-anchor="middle">${fmt(s.usage)} kWh</text>`;
  }).join("");
  return `<div class="chart" id="echart"><svg viewBox="0 0 ${W} ${H}">
    ${ticks.map(t => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)" stroke-width="1"/>
      <text x="${P.l - 6}" y="${y(t) + 3}" font-size="10" fill="var(--ink-3)" text-anchor="end">${fmt(t)}</text>`).join("")}
    ${bars}${labels}
    <text x="${P.l}" y="${H - 4}" font-size="10" fill="var(--ink-3)">October 2026 · daily kWh from meter register${log ? " · log scale" : ""}</text>
  </svg><div class="tooltip hidden"></div></div>`;
}

function bindChart(root, rows) {
  const tip = $(".tooltip", root);
  $$(".bar", root).forEach(g => {
    g.addEventListener("mousemove", e => {
      const r = rows[+g.dataset.i];
      tip.innerHTML = `<div class="muted">${r.date}</div><div>Usage (meter): <b>${fmt(r.usage)} kWh</b></div>
        ${r.reported != null ? `<div>Reported: <b>${fmt(r.reported)} kWh</b></div>` : ""}
        ${r.ratio != null ? `<div>${r.ratio}× baseline · z ${r.z}</div>` : ""}
        ${r.discrepancy != null ? `<div style="color:var(--warning)">⚠ Discrepancy ${fmt(r.discrepancy)} kWh</div>` : ""}`;
      tip.classList.remove("hidden");
      const box = root.getBoundingClientRect();
      let left = e.clientX - box.left + 12;
      if (left + tip.offsetWidth > box.width) left = e.clientX - box.left - tip.offsetWidth - 12;
      tip.style.left = left + "px";
      tip.style.top = (e.clientY - box.top - 10) + "px";
    });
    g.addEventListener("mouseleave", () => tip.classList.add("hidden"));
  });
}

// ---------------------------------------------------------------- auth view
function renderAuth(mode = "login") {
  $("#app").innerHTML = `<div class="auth"><div class="auth-card">
    <div class="brand"><div class="brand-mark">EX</div><div><div class="brand-name">EXUN Sentinel</div>
      <div class="brand-sub">Extradigital Exceptions &amp; Unknowns Network</div></div></div>
    <div class="tabs"><button data-m="login" class="${mode === "login" ? "on" : ""}">Sign in</button>
      <button data-m="register" class="${mode === "register" ? "on" : ""}">Create account</button></div>
    <form id="authf">
      ${mode === "register" ? `
        <label>Account type</label>
        <select name="role" id="rolesel"><option value="citizen">Citizen</option><option value="agent">Agent (requires authorisation)</option></select>
        <label>Display name</label><input name="name" required>` : ""}
      <label>Username</label><input name="username" autocomplete="username" required>
      <label>Password</label><input name="password" type="password" autocomplete="${mode === "login" ? "current-password" : "new-password"}" required>
      ${mode === "register" ? `<div id="codewrap" class="hidden"><label>Agency authorisation code</label><input name="agency_code"></div>` : ""}
      <div class="error" id="autherr"></div>
      <button class="btn primary" style="width:100%;justify-content:center;margin-top:6px">${mode === "login" ? "Sign in" : "Create account"}</button>
    </form>
    <div class="demo">Demo accounts:<br>
      <button class="btn sm" data-demo="conis:conis2026">Agent · Conis Nikrobo</button>
      <button class="btn sm" data-demo="mega:mega2026">Agent · Mega</button>
      <button class="btn sm" data-demo="citizen:citizen2026">Citizen</button>
      <div style="margin-top:6px">Agent sign-up code: <span class="mono">EXUN-2026</span></div>
    </div>
  </div></div>`;
  $$(".tabs button").forEach(b => b.onclick = () => renderAuth(b.dataset.m));
  const rs = $("#rolesel");
  if (rs) rs.onchange = () => $("#codewrap").classList.toggle("hidden", rs.value !== "agent");
  $$("[data-demo]").forEach(b => b.onclick = () => {
    const [u, p] = b.dataset.demo.split(":");
    renderAuth("login");
    $("#authf").username.value = u; $("#authf").password.value = p;
    $("#authf").requestSubmit();
  });
  $("#authf").onsubmit = async e => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    try {
      const r = await api(mode === "login" ? "/api/login" : "/api/register", body);
      setToken(r.token); S.user = r.user; location.hash = ""; render();
    } catch (err) { $("#autherr").textContent = err.message; }
  };
}

// ---------------------------------------------------------------- shell
const NAV = {
  agent: [
    ["sec", "Command"], ["dashboard", "Case dashboard", "◎"], ["alerts", "Alerts", "!"],
    ["sec", "Forensics"], ["energy", "Energy spikes", "⚡"], ["code", "Code forensics", "&lt;/&gt;"],
    ["sec", "Field"], ["sightings", "Sightings", "◉"], ["integrity", "Asset integrity", "▣"], ["agents", "Agent tracker", "◆"],
  ],
  citizen: [
    ["sec", "Help the investigation"], ["report", "Report a sighting", "＋"], ["sightings", "Sightings map", "◉"],
    ["integrity", "Asset integrity check", "▣"],
  ],
};

async function render() {
  if (!Object.keys(S.places).length) { try { S.places = await api("/api/places"); } catch (e) { /* offline */ } }
  if (!S.user && S.token) { try { S.user = await api("/api/me"); } catch (e) { setToken(null); } }
  if (!S.user) return renderAuth();
  const role = S.user.role;
  const nav = NAV[role];
  const views = nav.filter(n => n[0] !== "sec").map(n => n[0]);
  let view = location.hash.slice(1);
  if (!views.includes(view)) view = views[0];
  if (role === "agent") { try { S.alerts = await api("/api/alerts"); } catch (e) { S.alerts = []; } }
  const open = S.alerts.filter(a => a.status === "open").length;
  $("#app").innerHTML = `<div class="shell">
    <aside class="side">
      <div class="brand"><div class="brand-mark">EX</div><div><div class="brand-name">EXUN Sentinel</div><div class="brand-sub">${role === "agent" ? "Agent console" : "Citizen portal"}</div></div></div>
      <nav class="nav">${nav.map(n => n[0] === "sec" ? `<div class="sec">${n[1]}</div>` :
        `<a href="#${n[0]}" class="${n[0] === view ? "on" : ""}"><span style="width:18px;text-align:center">${n[2]}</span>${n[1]}
          ${n[0] === "alerts" && open ? `<span class="count">${open}</span>` : ""}</a>`).join("")}</nav>
      <div class="who"><div><div>${esc(S.user.name)}</div><div class="role">${role}${S.user.agent_id ? " · " + esc(S.user.agent_id) : ""}</div></div>
        <button class="btn sm" id="logout" style="margin-top:8px">Sign out</button></div>
    </aside>
    <main id="main"></main></div>`;
  $("#logout").onclick = () => logout();
  const main = $("#main");
  try { await VIEWS[view](main); } catch (err) { main.innerHTML = `<div class="card error">${esc(err.message)}</div>`; }
}
window.addEventListener("hashchange", render);

function head(title, text, actions = "") {
  return `<div class="page-head"><div><h1>${title}</h1><p>${text}</p></div><div class="row">${actions}</div></div>`;
}

// ---------------------------------------------------------------- views
const VIEWS = {};

VIEWS.dashboard = async main => {
  const [c, sightings, agents, integrity] = await Promise.all([api("/api/correlate"), api("/api/sightings"), api("/api/agents"), api("/api/integrity")]);
  const color = c.score >= 70 ? "var(--critical)" : c.score >= 40 ? "var(--warning)" : "var(--good)";
  const open = S.alerts.filter(a => a.status === "open");
  const strong = sightings.filter(s => s.match_level === "strong" && s.status !== "dismissed");
  main.innerHTML = `
    <div class="notice"><b>Notice EIA/EXUN/SUS-01</b> · effective 27 Oct 2026 · EXUN operational authority suspended pending review. Records remain accessible.</div>
    ${head("Case: Wenoti Arcade", `The Reckoning V: Origins · Machine <span class="mono">${CASE.machineId}</span> · 92nd Avenue, nuxEland`)}
    <div class="grid4">
      <div class="card stat"><div class="k">Open alerts</div><div class="v">${open.length}</div><div class="d">${open.filter(a => a.severity === "critical").length} critical</div></div>
      <div class="card stat"><div class="k">Strong POI-1 matches</div><div class="v">${strong.length}</div><div class="d">${sightings.length} sightings total</div></div>
      <div class="card stat"><div class="k">Agents in field</div><div class="v">${agents.filter(a => !/relocat|inactive/i.test(a.status)).length}/${agents.length}</div><div class="d">${agents.filter(a => /relocat/i.test(a.status)).length} relocation pending</div></div>
      <div class="card stat"><div class="k">Latest inspection</div><div class="v">${integrity[0] ? integrity[0].score : "—"}</div><div class="d">${integrity[0] ? integrity[0].condition + " surface damage" : "no inspection yet"}</div></div>
    </div>
    <div class="grid2">
      <div class="card">
        <h3>Correlation engine</h3>
        <div class="verdict" style="margin:8px 0 14px"><div class="score" style="color:${color}">${c.score}</div>
          <div><div class="label">${esc(c.verdict)}</div><div class="muted small">Weighs energy, code, sightings &amp; physical evidence</div></div></div>
        <div class="meter"><span style="width:${c.score}%;background:${color}"></span></div>
        <div class="list" style="margin-top:14px">${c.evidence.map(e => `<div class="row" style="gap:8px;align-items:flex-start">
          <span class="tag" style="min-width:74px;text-align:center">${esc(e.source)}</span>
          <span style="flex:1">${esc(e.text)}</span><span class="mono muted">+${e.weight}</span></div>`).join("")}</div>
        <div class="row" style="margin-top:14px">
          <button class="btn danger" id="escalate">Escalate verdict to authorities</button>
          <a class="btn" href="#energy">Run energy analysis</a><a class="btn" href="#code">Run code forensics</a></div>
        <div id="escmsg" class="small muted" style="margin-top:8px"></div>
      </div>
      <div class="card"><h3>Event timeline</h3>
        ${c.timeline.length ? `<div class="timeline" style="margin-top:10px">${c.timeline.map(t => `<div class="tl"><div class="t">${when(t.time)} · ${esc(t.source)}</div><div>${esc(t.text)}</div></div>`).join("")}</div>`
          : `<p class="muted">Run the energy and code analyses to build the timeline.</p>`}
      </div>
    </div>
    <div class="grid2">
      <div class="card"><h3>Live map</h3>${mapSVG({ sightings, agents })}
        <div class="map-legend"><span><span class="dot" style="background:var(--critical)"></span>Strong match</span>
          <span><span class="dot" style="background:var(--warning)"></span>Possible</span><span><span class="dot" style="background:var(--ink-3)"></span>Low</span>
          <span><span class="dot" style="background:var(--accent);border-radius:2px;transform:rotate(45deg)"></span>Agent</span></div></div>
      <div class="card"><h3>Recent alerts</h3><div class="list">${open.slice(0, 5).map(alertItem).join("") || `<p class="muted">No open alerts.</p>`}</div></div>
    </div>`;
  $("#escalate").onclick = async () => {
    const a = await api("/api/correlate/escalate", {});
    $("#escmsg").textContent = `Sent to: ${a.recipients.join(", ")}`;
    S.alerts = await api("/api/alerts");
  };
  bindAlertButtons(main);
};

function alertItem(a) {
  return `<div class="item"><div class="meta">${pill(a.severity)}<span>${esc(a.source)}</span><span>${when(a.time)}</span>
    <span class="tag">${esc(a.status)}</span></div>
    <div class="title">${esc(a.title)}</div><div class="small" style="color:var(--ink-2)">${esc(a.body)}</div>
    <div class="tags">${a.recipients.map(r => `<span class="tag">→ ${esc(r)}</span>`).join("")}</div>
    ${a.status === "open" ? `<div class="row" style="margin-top:8px"><button class="btn sm" data-ack="${a.id}">Acknowledge</button><button class="btn sm" data-res="${a.id}">Resolve</button></div>` :
      `<div class="small muted" style="margin-top:6px">${a.status} by ${esc(a.handled_by || "")}</div>`}</div>`;
}

function bindAlertButtons(root) {
  $$("[data-ack],[data-res]", root).forEach(b => b.onclick = async () => {
    await api(`/api/alerts/${b.dataset.ack || b.dataset.res}/${b.dataset.ack ? "ack" : "resolve"}`, {});
    render();
  });
}

VIEWS.alerts = async main => {
  const filter = sessionFilter("alerts", "open");
  const items = S.alerts.filter(a => filter === "all" || a.status === filter);
  main.innerHTML = head("Alerts", "Every automated finding is routed to the responsible authority based on its source and severity.") + `
    <div class="tabs" style="max-width:360px">${["open", "acknowledged", "resolved", "all"].map(f => `<button data-f="${f}" class="${f === filter ? "on" : ""}">${f}</button>`).join("")}</div>
    <div class="grid2"><div class="list">${items.map(alertItem).join("") || `<p class="muted">Nothing here.</p>`}</div>
    <div class="card"><h3>Routing rules</h3><table><tr><th>Trigger</th><th>Severity</th><th>Notified</th></tr>
      ${[["Class removed but still referenced", "critical", "EIA Command, EXUN Ops, Cyber Forensics, National Defence Liaison"],
         ["Energy spike not explained by HVAC", "critical", "EXUN Ops, Department of Electricity"],
         ["Reported usage ≠ meter register", "high", "Department of Electricity"],
         ["Correlated verdict ≥ 70", "critical", "EIA Command, EXUN Ops, Defence Liaison, Dept. of Electricity"],
         ["Strong POI-1 sighting (≥ 60)", "high", "EXUN Field Agents, EXUN Ops"],
         ["Severe surface damage", "high", "EXUN Ops, Facility Owner, Vendor"],
         ["Spike consistent with HVAC", "low", "Facility Owner"]].map(r => `<tr><td>${r[0]}</td><td>${pill(r[1])}</td><td class="small">${r[2]}</td></tr>`).join("")}
    </table></div></div>`;
  $$("[data-f]", main).forEach(b => b.onclick = () => { sessionFilter("alerts", b.dataset.f, true); VIEWS.alerts(main); });
  bindAlertButtons(main);
};

const _filters = {};
function sessionFilter(key, def, set) {
  if (set) _filters[key] = def;
  return _filters[key] || def;
}

// ---- energy
VIEWS.energy = async main => {
  const history = await api("/api/energy");
  main.innerHTML = head("Energy spike detection",
    "Recomputes daily usage from the meter register, finds outliers with a robust (median/MAD) z-score, flags reported figures that disagree with the meter, and tests whether an HVAC startup could explain each spike.") + `
    <div class="grid2">
      <div class="card"><h3>Meter readings</h3>
        <div style="max-height:380px;overflow:auto"><table id="etable"><thead><tr><th>Date</th><th class="num">Meter (kWh)</th><th class="num">Reported daily (kWh)</th><th></th></tr></thead><tbody></tbody></table></div>
        <div class="row" style="margin-top:10px"><button class="btn sm" id="addrow">+ Row</button><button class="btn sm" id="loadcase">Load dossier data</button>
          <button class="btn sm" id="pastecsv">Paste CSV</button></div>
        <textarea id="csv" class="hidden code" style="min-height:100px;margin-top:8px" placeholder="date,meter,usage&#10;2026-10-13,18477.2,24.6"></textarea>
      </div>
      <div class="card"><h3>HVAC hypothesis</h3>
        <p class="small muted">The Department of Electricity noted a compressor startup. Set the largest plausible HVAC load; the engine checks whether it could produce the excess energy.</p>
        <div class="grid2"><div><label>Compressor rating (kW)</label><input id="hkw" type="number" value="15" step="1"></div>
          <div><label>Hours running at full load</label><input id="hh" type="number" value="24" step="1" max="24"></div></div>
        <label class="check"><input type="checkbox" id="harm" checked> Elevated harmonic content recorded</label>
        <label class="check"><input type="checkbox" id="phase" checked> Phase imbalance recorded (no single phase accounts for excursion)</label>
        <button class="btn primary" id="run" style="margin-top:14px">Analyse readings</button>
        <div class="error" id="eerr"></div>
      </div>
    </div>
    <div id="eresult"></div>
    ${history.length ? `<div class="card"><h3>Previous analyses</h3><table><tr><th>When</th><th>By</th><th>Spikes</th><th>Discrepancies</th></tr>
      ${history.map(h => `<tr><td>${when(h.created)}</td><td>${esc(h.by)}</td><td>${h.result.spikes.map(s => s.date + " (" + s.verdict.replace("_", " ") + ")").join(", ") || "none"}</td><td>${h.result.discrepancies.length}</td></tr>`).join("")}</table></div>` : ""}`;
  const tbody = $("#etable tbody");
  const addRow = (d = "", m = "", u = "") => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><input type="date" value="${d}" style="text-align:left"></td><td><input type="number" step="0.1" value="${m}"></td><td><input type="number" step="0.1" value="${u}"></td><td><button class="btn sm" title="Remove">×</button></td>`;
    $("button", tr).onclick = () => tr.remove();
    tbody.appendChild(tr);
  };
  const loadCase = () => { tbody.innerHTML = ""; CASE.energy.forEach(r => addRow(...r)); };
  loadCase();
  $("#addrow").onclick = () => addRow();
  $("#loadcase").onclick = loadCase;
  $("#pastecsv").onclick = () => {
    const ta = $("#csv");
    if (ta.classList.contains("hidden")) { ta.classList.remove("hidden"); return; }
    const lines = ta.value.trim().split(/\n+/).map(l => l.split(/[,\t;]/).map(s => s.trim())).filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p[0]));
    if (lines.length) { tbody.innerHTML = ""; lines.forEach(p => addRow(p[0], p[1], p[2])); ta.classList.add("hidden"); }
  };
  $("#run").onclick = async () => {
    const rows = $$("tr", tbody).map(tr => { const i = $$("input", tr); return { date: i[0].value, meter: i[1].value, usage: i[2].value }; }).filter(r => r.date);
    try {
      $("#eerr").textContent = "";
      const rep = await api("/api/energy/analyze", { rows, hvac_kw: +$("#hkw").value, hvac_hours: +$("#hh").value, harmonics: $("#harm").checked, phase_imbalance: $("#phase").checked });
      showEnergy(rep.result);
      S.alerts = await api("/api/alerts");
    } catch (err) { $("#eerr").textContent = err.message; }
  };
};

function showEnergy(r) {
  const top = r.spikes.slice().sort((a, b) => b.usage - a.usage)[0];
  const el = $("#eresult");
  let log = false;
  const draw = () => {
    el.innerHTML = `
    <div class="grid4">
      <div class="card stat"><div class="k">Baseline (median)</div><div class="v">${fmt(r.baseline_median)}</div><div class="d">kWh/day · MAD ${fmt(r.mad)}</div></div>
      <div class="card stat"><div class="k">Peak day</div><div class="v">${top ? fmt(top.usage) : "—"}</div><div class="d">${top ? top.date + " · " + top.ratio + "× baseline" : "no spikes"}</div></div>
      <div class="card stat"><div class="k">HVAC can explain</div><div class="v">${top ? top.hvac_coverage + "%" : "—"}</div><div class="d">${top ? "of " + fmt(top.excess_kwh) + " kWh excess" : ""}</div></div>
      <div class="card stat"><div class="k">Meter discrepancies</div><div class="v" style="color:${r.discrepancies.length ? "var(--warning)" : "inherit"}">${r.discrepancies.length}</div><div class="d">${r.discrepancies.length ? "referred to Dept. of Electricity" : "records consistent"}</div></div>
    </div>
    <div class="card"><div class="row" style="justify-content:space-between"><h3>Daily consumption</h3>
      <label class="check" style="margin:0"><input type="checkbox" id="logs" ${log ? "checked" : ""}> Log scale</label></div>
      ${energyChart(r.rows, r.spikes, log)}
      <div class="map-legend"><span><span class="dot" style="background:var(--bar)"></span>Normal day</span><span><span class="dot" style="background:var(--critical)"></span>Detected spike</span>
        <span><span style="display:inline-block;width:16px;border-top:2px dashed var(--warning);vertical-align:middle;margin-right:5px"></span>Reported figure (when it disagrees with meter)</span></div></div>
    ${r.spikes.map(s => `<div class="card"><div class="row" style="justify-content:space-between">
      <h2>${s.date}: ${fmt(s.usage)} kWh</h2>${pill(s.verdict === "anomalous" ? "critical" : s.verdict === "suspicious" ? "high" : "good", s.verdict.replace("_", " "))}</div>
      <div class="row small muted" style="margin-bottom:8px">Anomaly score ${s.anomaly_score} · robust z ${s.z}</div>
      <ul style="margin:0;padding-left:18px">${s.reasons.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>`).join("")}
    ${r.discrepancies.length ? `<div class="card"><h3>Record discrepancies</h3>
      <p class="small">The dossier requires discrepancies to be forwarded to the Department of Electricity. These have been referred automatically.</p>
      <table><tr><th>Date</th><th class="num">Reported</th><th class="num">Meter Δ</th><th class="num">Gap</th></tr>
      ${r.discrepancies.map(d => `<tr class="warn"><td>${d.date}</td><td class="num">${fmt(d.reported)}</td><td class="num">${fmt(d.meter_delta)}</td><td class="num">${d.gap > 0 ? "+" : ""}${fmt(d.gap)}</td></tr>`).join("")}</table></div>` : ""}`;
    bindChart($("#echart"), r.rows);
    $("#logs").onchange = e => { log = e.target.checked; draw(); };
  };
  draw();
}

// ---- code
VIEWS.code = async main => {
  const history = await api("/api/code");
  main.innerHTML = head("Code forensics",
    "Structurally compares a known-good build against the build recovered from the machine: classes, methods, free functions, dangling references and orphaned dependencies. Severity determines who is alerted.") + `
    <div class="card"><div class="grid3">
      <div><label>Machine ID</label><input id="mid" value="${CASE.machineId}"></div>
      <div><label>Baseline captured</label><input id="cb" type="date" value="2026-10-01"></div>
      <div><label>Recovered build captured</label><input id="ca" type="date" value="2026-10-24"></div></div>
      <div class="grid2" style="margin-top:12px">
        <div><div class="row" style="justify-content:space-between"><label>Known-good source</label><input type="file" id="fo" accept=".txt,.cpp,.h,.hpp,.cc" style="width:auto;padding:3px;font-size:11px"></div><textarea id="orig" class="code" spellcheck="false"></textarea></div>
        <div><div class="row" style="justify-content:space-between"><label>Recovered source</label><input type="file" id="fa" accept=".txt,.cpp,.h,.hpp,.cc" style="width:auto;padding:3px;font-size:11px"></div><textarea id="alt" class="code" spellcheck="false"></textarea></div>
      </div>
      <div class="row" style="margin-top:12px"><button class="btn primary" id="crun">Run forensic comparison</button><button class="btn" id="cload">Load case files</button></div>
      <div class="error" id="cerr"></div></div>
    <div id="cresult"></div>
    ${history.length ? `<div class="card"><h3>Previous comparisons</h3><table><tr><th>When</th><th>By</th><th>Machine</th><th>Severity</th><th>Removed</th></tr>
      ${history.map(h => `<tr><td>${when(h.created)}</td><td>${esc(h.by)}</td><td class="mono">${esc(h.machine_id)}</td><td>${pill(h.result.severity)}</td><td>${esc(h.result.removed_classes.join(", ") || "—")}</td></tr>`).join("")}</table></div>` : ""}`;
  const load = async () => {
    const [o, a] = await Promise.all(["samples/OriginalCode.txt", "samples/AlteredCode.txt"].map(p => fetch(p).then(r => r.text())));
    $("#orig").value = o; $("#alt").value = a;
  };
  $("#cload").onclick = load;
  for (const [inp, ta] of [["#fo", "#orig"], ["#fa", "#alt"]]) {
    $(inp).onchange = async e => { const f = e.target.files[0]; if (f) $(ta).value = await f.text(); };
  }
  $("#crun").onclick = async () => {
    try {
      $("#cerr").textContent = "";
      const rep = await api("/api/code/analyze", {
        original: $("#orig").value, altered: $("#alt").value, machine_id: $("#mid").value,
        captured_before: $("#cb").value, captured_after: $("#ca").value,
        original_label: "known-good", altered_label: "recovered",
      });
      showCode(rep);
      S.alerts = await api("/api/alerts");
    } catch (err) { $("#cerr").textContent = err.message; }
  };
  await load();
};

function showCode(rep) {
  const r = rep.result;
  const routes = { critical: "EIA Command, EXUN Operations, Cyber Forensics Unit, National Defence Liaison", high: "EXUN Operations, Cyber Forensics Unit", medium: "Cyber Forensics Unit, Machine Vendor", low: "Logged only", none: "Logged only" };
  $("#cresult").innerHTML = `
    <div class="card" style="border-color:${sevColor[r.severity]}"><div class="row" style="justify-content:space-between">
      <div><h3>Overall severity</h3><div class="row"><span style="font-size:26px;font-weight:800;color:${sevColor[r.severity]}">${r.severity.toUpperCase()}</span>
        <span class="muted">${r.stats.lines_before} → ${r.stats.lines_after} lines · −${r.stats.removed} / +${r.stats.added}</span></div></div>
      <div class="small"><div class="muted">Alert routed to</div><div>${routes[r.severity]}</div></div></div>
      <div class="small muted mono" style="margin-top:8px">sha256 known-good ${r.hash_before}… · recovered ${r.hash_after}…</div></div>
    <div class="grid2">
      <div class="card"><h3>Findings</h3><div class="list">${r.findings.map(f => `<div class="item"><div class="meta">${pill(f.severity)}</div>
        <div class="title">${esc(f.title)}</div><div class="small" style="color:var(--ink-2)">${esc(f.detail)}</div></div>`).join("")}</div></div>
      <div class="card"><h3>Class map</h3>
        <div class="small muted" style="margin:6px 0">Known-good</div>
        <div class="classes">${Object.entries(r.classes_before).map(([n, m]) => `<div class="cls ${r.removed_classes.includes(n) ? "gone" : ""}"><b>${esc(n)}</b><br><span class="muted">${m.map(esc).join(", ")}</span></div>`).join("")}</div>
        <div class="small muted" style="margin:12px 0 6px">Recovered</div>
        <div class="classes">${Object.entries(r.classes_after).map(([n, m]) => `<div class="cls"><b>${esc(n)}</b><br><span class="muted">${m.map(esc).join(", ")}</span></div>`).join("")}</div>
        ${r.dangling.map(d => `<div class="small muted" style="margin:14px 0 6px">Dangling references to <b style="color:var(--critical)">${esc(d.class)}</b></div>
          <div class="diff">${d.references.map(x => `<div class="del">L${x.line}  ${esc(x.code)}</div>`).join("")}</div>`).join("")}
      </div></div>
    <div class="card"><h3>Unified diff</h3><div class="diff">${r.diff.map(l => `<div class="${l.startsWith("@@") || l.startsWith("---") || l.startsWith("+++") ? "hunk" : l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : ""}">${esc(l) || " "}</div>`).join("") || "<div>No differences.</div>"}</div></div>`;
}

// ---- sightings
function sightingItem(s, agent) {
  return `<div class="item" id="s-${s.id}"><div class="meta">${pill(s.match_level === "strong" ? "critical" : s.match_level === "possible" ? "medium" : "low", s.match_level + " · " + s.match_score)}
    <span>${esc(s.location)}</span><span>${when(s.seen_at)}</span><span>${esc(s.reporter_name)}</span>
    ${s.status !== "new" ? `<span class="tag">${esc(s.status)}</span>` : ""}${s.case_ref ? `<span class="tag">${esc(s.case_ref)}</span>` : ""}</div>
    <div style="margin-top:6px">${esc(s.description)}</div>
    <div class="tags">${s.traits.map(t => `<span class="tag">${esc(t)}</span>`).join("")}</div>
    ${agent && s.status === "new" ? `<div class="row" style="margin-top:8px"><button class="btn sm" data-verify="${s.id}">Verify</button><button class="btn sm" data-dismiss="${s.id}">Dismiss</button></div>` : ""}</div>`;
}

VIEWS.sightings = async main => {
  const agent = S.user.role === "agent";
  const all = await api("/api/sightings");
  const filter = sessionFilter("sight", "all");
  const items = all.filter(s => filter === "all" || s.match_level === filter);
  main.innerHTML = head(agent ? "Sightings" : "Sightings map",
    agent ? "Citizen and agent reports, each scored against the POI-1 profile from Transcript A." : "Recent public reports. Reporter identities are hidden.",
    agent ? "" : `<a class="btn primary" href="#report">＋ Report a sighting</a>`) + `
    <div class="grid2"><div class="card">${mapSVG({ sightings: items })}
      <div class="map-legend"><span><span class="dot" style="background:var(--critical)"></span>Strong (≥60)</span><span><span class="dot" style="background:var(--warning)"></span>Possible (35–59)</span><span><span class="dot" style="background:var(--ink-3)"></span>Low</span></div>
      <h3>POI-1 profile</h3>
      <div class="tags">${["Pointed ears", "Armour (bedazzled)", "Scabbard / sword", "Leather gloves", "Boots", "Thick accent", "Nervous", "Unfamiliar with modern life", "Near arcades / electronics"].map(t => `<span class="tag">${t}</span>`).join("")}</div></div>
    <div><div class="tabs">${["all", "strong", "possible", "low"].map(f => `<button data-f="${f}" class="${f === filter ? "on" : ""}">${f}</button>`).join("")}</div>
      <div class="list">${items.map(s => sightingItem(s, agent)).join("") || `<p class="muted">No sightings.</p>`}</div></div></div>`;
  $$("[data-f]", main).forEach(b => b.onclick = () => { sessionFilter("sight", b.dataset.f, true); VIEWS.sightings(main); });
  $$("[data-verify],[data-dismiss]", main).forEach(b => b.onclick = async () => {
    await api(`/api/sightings/${b.dataset.verify || b.dataset.dismiss}/${b.dataset.verify ? "verify" : "dismiss"}`, {});
    VIEWS.sightings(main);
  });
  $$(".pin", main).forEach(p => p.addEventListener("click", () => {
    const el = $("#s-" + p.dataset.id);
    if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.style.outline = "2px solid var(--accent)"; setTimeout(() => el.style.outline = "", 1500); }
  }));
};

VIEWS.report = async main => {
  let pick = null;
  const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  main.innerHTML = head("Report a sighting",
    "Seen someone matching this description? Describe them in your own words: appearance, clothing, how they spoke and acted. Every report is reviewed by EXUN agents.") + `
    <div class="grid2"><div class="card"><form id="sf">
      <label>What did you see?</label>
      <textarea name="description" required placeholder="e.g. Tall man in shiny armour with pointy ears and a sword on his belt, wearing leather gloves. Spoke with a strange accent and seemed confused by the traffic lights."></textarea>
      <div class="grid2"><div><label>When</label><input type="datetime-local" name="seen_at" value="${nowLocal}"></div>
        <div><label>Where</label><select name="place"><option value="">Pick on map…</option>${Object.keys(S.places).map(p => `<option>${esc(p)}</option>`).join("")}</select></div></div>
      <div class="small muted" id="locmsg" style="margin-top:6px">Tap the map to drop a pin.</div>
      <label class="check"><input type="checkbox" name="anonymous"> Submit anonymously</label>
      <div class="error" id="serr"></div>
      <button class="btn primary" style="margin-top:6px">Submit report</button></form>
      <div id="sres" style="margin-top:14px"></div></div>
    <div class="card"><h3>Location</h3><div id="pickmap"></div>
      <p class="small muted" style="margin-top:10px">Do not approach. If the person is near electrical equipment that is sparking or humming, move away and report it.</p></div></div>`;
  const drawMap = () => {
    $("#pickmap").innerHTML = mapSVG({ pick, id: "pm" });
    bindPicker($("#pm"), (x, y) => { pick = { x, y }; $("#sf").place.value = ""; $("#locmsg").textContent = nearestPlace(x, y); drawMap(); });
  };
  drawMap();
  $("#sf").place.onchange = e => {
    const p = S.places[e.target.value];
    if (p) { pick = { x: p[0], y: p[1] }; $("#locmsg").textContent = e.target.value; drawMap(); }
  };
  $("#sf").onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    if (!pick) { $("#serr").textContent = "Please choose a location."; return; }
    try {
      const s = await api("/api/sightings", { description: f.description.value, seen_at: f.seen_at.value, anonymous: f.anonymous.checked,
        location: f.place.value || nearestPlace(pick.x, pick.y), x: pick.x, y: pick.y });
      $("#serr").textContent = "";
      const msg = { strong: "This closely matches the person EXUN is looking for. Field agents have been alerted.", possible: "This partially matches. An analyst will review it.", low: "Thank you. Your report has been logged." };
      $("#sres").innerHTML = `<div class="item"><div class="meta">${pill(s.match_level === "strong" ? "critical" : s.match_level === "possible" ? "medium" : "low", "match " + s.match_score)}</div>
        <div class="title">${msg[s.match_level]}</div><div class="tags">${s.traits.map(t => `<span class="tag">${esc(t)}</span>`).join("")}</div></div>`;
      f.description.value = "";
    } catch (err) { $("#serr").textContent = err.message; }
  };
};

// ---- integrity
VIEWS.integrity = async main => {
  const history = await api("/api/integrity");
  let img = null, ref = null, result = null;
  main.innerHTML = head("Asset integrity check",
    "Upload a photo of the machine's casing. Computer vision flags abrasions, discolouration and, if you add a reference photo, any change since it was taken. Everything runs on your device.") + `
    <div class="grid2"><div class="card">
      <div class="grid2"><div><label>Machine ID</label><input id="imid" value="${CASE.machineId}"></div>
        <div><label>Notes</label><input id="inotes" placeholder="e.g. right-side casing"></div></div>
      <label>Inspection photo</label><input type="file" id="iimg" accept="image/*">
      <label>Reference photo (optional, same angle)</label><input type="file" id="iref" accept="image/*">
      <div class="row" style="margin-top:12px"><button class="btn" id="isample">Use sample photos</button>
        <button class="btn primary" id="irun" disabled>Analyse</button><button class="btn" id="isave" disabled>Submit report</button></div>
      <div class="error" id="ierr"></div>
      <div id="imetrics" style="margin-top:12px"></div></div>
    <div class="card"><div class="cv-stage" id="stage"><div class="drop">No photo loaded</div></div>
      <div class="map-legend"><span><span class="dot" style="background:#ee7a2f;border-radius:2px"></span>Discolouration</span>
        <span><span class="dot" style="background:#e0a526;border-radius:2px"></span>Abrasion</span><span><span class="dot" style="background:#b38cff;border-radius:2px"></span>Change vs reference</span></div></div></div>
    ${history.length ? `<div class="card"><h3>${S.user.role === "agent" ? "All inspections" : "My inspections"}</h3><table><tr><th></th><th>When</th><th>By</th><th>Machine</th><th>Condition</th><th>Findings</th></tr>
      ${history.map(h => `<tr><td>${h.thumbnail ? `<img class="thumb" src="${h.thumbnail}" alt="">` : ""}</td><td>${when(h.created)}</td><td>${esc(h.by_name)}</td><td class="mono">${esc(h.machine_id)}</td>
        <td>${pill(h.condition === "severe" ? "critical" : h.condition === "moderate" ? "medium" : "good", h.condition + " · " + h.score)}</td><td class="small">${h.findings.map(f => esc(f.text)).join("<br>")}</td></tr>`).join("")}</table></div>` : ""}`;
  const loadFile = file => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const show = c => { $("#stage").innerHTML = ""; $("#stage").appendChild(c); };
  $("#iimg").onchange = async e => { if (e.target.files[0]) { img = await loadFile(e.target.files[0]); show(img); $("#irun").disabled = false; } };
  $("#iref").onchange = async e => { if (e.target.files[0]) ref = await loadFile(e.target.files[0]); };
  $("#isample").onclick = () => { img = CV.sample(true); ref = CV.sample(false); show(img); $("#irun").disabled = false; };
  $("#irun").onclick = () => {
    result = CV.analyze(img, ref);
    show(result.overlay);
    const m = result.metrics;
    const cond = result.score >= 60 ? ["critical", "severe"] : result.score >= 30 ? ["medium", "moderate"] : ["good", "minor"];
    $("#imetrics").innerHTML = `<div class="verdict"><div class="score" style="color:${sevColor[cond[0]] || "var(--good)"}">${result.score}</div>
      <div><div class="label">${cond[1]} surface damage</div><div class="small muted">${m.resolution} · ${m.regions} region(s)</div></div></div>
      <table style="margin-top:12px"><tr><td>Discoloured area</td><td class="num">${m.discolouration_pct}%</td></tr><tr><td>Abraded area</td><td class="num">${m.abrasion_pct}%</td></tr>
        <tr><td>Changed vs reference</td><td class="num">${m.change_vs_reference_pct == null ? "no reference" : m.change_vs_reference_pct + "%"}</td></tr></table>
      <ul class="small" style="padding-left:18px;margin-top:10px">${result.findings.map(f => `<li>${esc(f.text)}</li>`).join("")}</ul>
      <p class="small muted">Surface findings describe the exterior only. They do not establish internal damage or cause.</p>`;
    $("#isave").disabled = false;
  };
  $("#isave").onclick = async () => {
    try {
      await api("/api/integrity", { machine_id: $("#imid").value, notes: $("#inotes").value, score: result.score, metrics: result.metrics, findings: result.findings, thumbnail: result.thumbnail });
      VIEWS.integrity(main);
    } catch (err) { $("#ierr").textContent = err.message; }
  };
};

// ---- agents
VIEWS.agents = async main => {
  const agents = await api("/api/agents");
  const me = agents.find(a => a.username === S.user.username);
  let pick = me ? { x: me.x, y: me.y } : null;
  main.innerHTML = head("Agent tracker", "Last known positions and status of EXUN personnel. Check in to update your own position.") + `
    <div class="grid2"><div class="card"><div id="amap"></div></div>
    <div class="card">${me ? `<h3>Check in · ${esc(me.name)}</h3><form id="cf">
      <label>Location</label><select name="place"><option value="">Pick on map…</option>${Object.keys(S.places).map(p => `<option ${p === me.location ? "selected" : ""}>${esc(p)}</option>`).join("")}</select>
      <div class="small muted" id="cmsg" style="margin-top:4px">${esc(me.location)}</div>
      <label>Status</label><select name="status">${["Active - Surveillance", "Active - Case lead", "Active - Interview", "Off duty", "Relocation pending", "Needs backup"].map(s => `<option ${s === me.status ? "selected" : ""}>${s}</option>`).join("")}</select>
      <label>Note</label><input name="note" placeholder="optional">
      <button class="btn primary" style="margin-top:12px">Check in</button></form>` : `<p class="muted">No agent profile linked to this account.</p>`}</div></div>
    <div class="card"><h3>Personnel</h3><table><tr><th>ID</th><th>Agent</th><th>Status</th><th>Last location</th><th>Last check-in</th><th>Assignment</th></tr>
      ${agents.map(a => `<tr class="${/backup/i.test(a.status) ? "flag" : ""}"><td class="mono">${esc(a.id)}</td><td>${esc(a.name)}<div class="small muted">${esc(a.rank)}</div></td>
        <td>${pill(/backup/i.test(a.status) ? "critical" : /relocat|off/i.test(a.status) ? "medium" : "good", a.status)}</td><td>${esc(a.location)}</td><td>${when(a.last_checkin)}</td><td class="small">${esc(a.assignment)}</td></tr>
        ${a.trail.length ? `<tr><td></td><td colspan="5" class="small muted">Trail: ${a.trail.slice(0, 5).map(t => `${when(t.time)} ${esc(t.location)}${t.note ? " (" + esc(t.note) + ")" : ""}`).join(" ← ")}</td></tr>` : ""}`).join("")}</table></div>`;
  const draw = () => {
    $("#amap").innerHTML = mapSVG({ agents, pick: me ? pick : null, id: "am" });
    if (me) bindPicker($("#am"), (x, y) => { pick = { x, y }; $("#cf").place.value = ""; $("#cmsg").textContent = nearestPlace(x, y); draw(); });
  };
  draw();
  if (!me) return;
  $("#cf").place.onchange = e => { const p = S.places[e.target.value]; if (p) { pick = { x: p[0], y: p[1] }; $("#cmsg").textContent = e.target.value; draw(); } };
  $("#cf").onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    await api("/api/agents/checkin", { location: f.place.value || nearestPlace(pick.x, pick.y), x: pick.x, y: pick.y, status: f.status.value, note: f.note.value });
    VIEWS.agents(main);
  };
};

render();
