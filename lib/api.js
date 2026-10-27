// EXUN Sentinel API. Web-standard Request -> Response handler.
// `store` is any { get(key) -> value|null, set(key, value) } JSON store
// (Netlify Blobs in production, a JSON file locally, memory in tests).

import { PLACES, matchPoi } from "../public/js/poi.js";
import { analyzeEnergy, analyzeCode, correlate } from "./engines.js";

const enc = new TextEncoder();
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = s => atob(s.replace(/-/g, "+").replace(/_/g, "/"));
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const randHex = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const uid = () => randHex(5);
const nowIso = () => new Date().toISOString().slice(0, 19) + "Z";

const LIMITS = { alerts: 200, energy: 20, code: 20, integrity: 50, sightings: 500 };

const ROUTES = {
  code_critical: ["EIA Command", "EXUN Operations", "Cyber Forensics Unit", "National Defence Liaison"],
  code_high: ["EXUN Operations", "Cyber Forensics Unit"],
  code_medium: ["Cyber Forensics Unit", "Machine Vendor"],
  energy_anomaly: ["EXUN Operations", "Department of Electricity"],
  energy_hvac: ["Facility Owner (Wenoti Arcade)"],
  meter_discrepancy: ["Department of Electricity"],
  sighting_strong: ["EXUN Field Agents", "EXUN Operations"],
  sighting_possible: ["EXUN Operations (triage)"],
  integrity_severe: ["EXUN Operations", "Facility Owner (Wenoti Arcade)", "Machine Vendor"],
  integrity_moderate: ["Facility Owner (Wenoti Arcade)"],
  correlation_malicious: ["EIA Command", "EXUN Operations", "National Defence Liaison", "Department of Electricity"],
  correlation_suspicious: ["EXUN Operations", "Department of Electricity"],
};

let ITERATIONS = 100000;

async function hashPw(password, salt) {
  salt = salt || randHex(16);
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc.encode(salt), iterations: ITERATIONS, hash: "SHA-256" }, key, 256);
  return { salt, hash: hex(bits) };
}

function newSighting(description, location, x, y, seenAt, reporterName, reporter) {
  const { score, level, traits } = matchPoi(description, x, y);
  return {
    id: uid(), created: nowIso(), seen_at: seenAt, description, location, x, y, reporter, reporter_name: reporterName,
    match_score: score, match_level: level, traits, status: "new", case_ref: null,
  };
}

async function seedData() {
  const users = {}, agents = [];
  const roster = [
    ["AG-001", "Conis Nikrobo", "conis", "Handler", "Active - Case lead", "etiNuxe Intelligence Agency HQ"],
    ["AG-007", "Agent Nano", "nano", "Field agent", "Relocation pending", "Wenoti Arcade, 92nd Ave"],
    ["AG-008", "Agent Mega", "mega", "Field agent", "Active - Surveillance", "Wenoti Arcade, 92nd Ave"],
  ];
  for (const [id, name, username, rank, status, place] of roster) {
    const [x, y] = PLACES[place];
    users[username] = { username, name, role: "agent", agent_id: id, created: nowIso(), ...(await hashPw(username + "2026")) };
    agents.push({
      id, name, username, rank, status, location: place, x, y, last_checkin: "2026-10-25T23:54",
      assignment: "Wenoti Arcade / The Reckoning V: Origins (MJWHKZLTNBUXE5A)",
      trail: username === "conis" ? [] : [{ time: "2026-10-23T22:31", location: "Wenoti Arcade, 92nd Ave", x: 63, y: 38, note: "Contact with POI-1" }],
    });
  }
  users.citizen = { username: "citizen", name: "Demo Citizen", role: "citizen", agent_id: null, created: nowIso(), ...(await hashPw("citizen2026")) };
  const s = newSighting(
    "Male, wearing sharp pointed ears, leather gloves and boots, and bedazzled armour with a scabbard slung around his waist. " +
    "Thick accent, stuttering, flinched when approached. Fiddled with The Reckoning V arcade machine, then looked at his bare " +
    "wrist as if checking a watch and hurried out. Machine began warbling and reverberating afterwards.",
    "Wenoti Arcade, 92nd Ave", 63, 38, "2026-10-23T22:31", "Agents Nano & Mega (Transcript A)", "nano");
  Object.assign(s, { status: "verified", case_ref: "POI-1" });
  return { users, agents, sightings: [s], alerts: [], energy: [], code: [], integrity: [] };
}

export function createApi({ store, secret = "exun-dev-secret", agencyCode = "EXUN-2026", iterations }) {
  if (iterations) ITERATIONS = iterations;
  let hmacKey;
  const key = async () => (hmacKey ||= await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]));

  async function signToken(username) {
    const payload = b64url(enc.encode(JSON.stringify({ u: username, exp: Date.now() + 7 * 86400e3 })));
    return payload + "." + b64url(await crypto.subtle.sign("HMAC", await key(), enc.encode(payload)));
  }

  async function verifyToken(token) {
    const [payload, sig] = String(token || "").split(".");
    if (!payload || !sig) return null;
    try {
      const raw = Uint8Array.from(fromB64url(sig), c => c.charCodeAt(0));
      if (!(await crypto.subtle.verify("HMAC", await key(), raw, enc.encode(payload)))) return null;
      const data = JSON.parse(fromB64url(payload));
      return data.exp > Date.now() ? data.u : null;
    } catch { return null; }
  }

  // Per-request collection cache with explicit saves
  function db() {
    const cache = {}, dirty = new Set();
    return {
      async get(name) { if (!(name in cache)) cache[name] = (await store.get(name)) ?? (name === "users" ? {} : []); return cache[name]; },
      touch(name) { dirty.add(name); },
      async flush() {
        for (const name of dirty) {
          const v = cache[name];
          if (Array.isArray(v) && LIMITS[name]) v.length = Math.min(v.length, LIMITS[name]);
          await store.set(name, v);
        }
      },
    };
  }

  let seeded = false;
  async function ensureSeed() {
    if (seeded) return;
    if (!(await store.get("users"))) {
      const data = await seedData();
      for (const [k, v] of Object.entries(data)) await store.set(k, v);
    }
    seeded = true;
  }

  async function raiseAlert(d, route, severity, source, title, body, ref = null) {
    const alerts = await d.get("alerts");
    d.touch("alerts");
    const existing = alerts.find(a => a.status === "open" && a.route === route && a.title === title);
    if (existing) { Object.assign(existing, { time: nowIso(), body, ref, repeats: (existing.repeats || 1) + 1 }); return existing; }
    const alert = { id: uid(), time: nowIso(), severity, source, title, body, recipients: ROUTES[route], route, ref, status: "open" };
    alerts.unshift(alert);
    return alert;
  }

  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  const publicUser = u => ({ username: u.username, name: u.name, role: u.role, agent_id: u.agent_id });
  const publicSighting = (s, viewer) => (viewer.role === "agent" || s.reporter === viewer.username ? s : { ...s, reporter: null, reporter_name: "Citizen report" });

  async function correlation(d) {
    const [energy, code, integrity, sightings] = await Promise.all(["energy", "code", "integrity", "sightings"].map(n => d.get(n)));
    return correlate({ energy: energy[0], code: code[0], integrity: integrity[0], sightings });
  }

  return async function handle(req) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "");
    const method = req.method;
    let body = {};
    if (method === "POST") { try { body = await req.json(); } catch { body = {}; } }
    await ensureSeed();
    const d = db();
    try {
      const res = await route(path, method, body, req, d);
      await d.flush();
      return res;
    } catch (err) {
      return json({ error: err.message || "Server error" }, 500);
    }
  };

  async function route(path, method, data, req, d) {
    if (path === "/api/public/summary" && method === "GET") {
      const sightings = await d.get("sightings");
      const latest = sightings.filter(s => s.status !== "dismissed")[0];
      return json({
        places: PLACES, sightings: sightings.length,
        strong: sightings.filter(s => s.match_level === "strong" && s.status !== "dismissed").length,
        latest: latest ? { location: latest.location, seen_at: latest.seen_at } : null,
      });
    }

    if (path === "/api/login" && method === "POST") {
      const users = await d.get("users");
      const u = users[String(data.username || "").trim().toLowerCase()];
      if (!u || (await hashPw(String(data.password || ""), u.salt)).hash !== u.hash) return json({ error: "Invalid username or password" }, 401);
      return json({ token: await signToken(u.username), user: publicUser(u) });
    }

    if (path === "/api/register" && method === "POST") {
      const users = await d.get("users");
      const uname = String(data.username || "").trim().toLowerCase();
      if (!/^[a-z0-9_]{3,20}$/.test(uname)) return json({ error: "Username must be 3–20 letters, digits or _" }, 400);
      if (users[uname]) return json({ error: "That username is taken" }, 400);
      if (String(data.password || "").length < 6) return json({ error: "Password must be at least 6 characters" }, 400);
      const role = data.role === "agent" ? "agent" : "citizen";
      if (role === "agent" && data.agency_code !== agencyCode) return json({ error: "Invalid agency authorisation code" }, 403);
      const name = String(data.name || uname).trim().slice(0, 60) || uname;
      let agentId = null;
      if (role === "agent") {
        const agents = await d.get("agents");
        agentId = "AG-" + String(agents.length + 10).padStart(3, "0");
        const [x, y] = PLACES["etiNuxe Intelligence Agency HQ"];
        agents.push({ id: agentId, name, username: uname, rank: "Field agent", status: "Active", location: "etiNuxe Intelligence Agency HQ", x, y, last_checkin: nowIso(), assignment: "Unassigned", trail: [] });
        d.touch("agents");
      }
      users[uname] = { username: uname, name, role, agent_id: agentId, created: nowIso(), ...(await hashPw(data.password)) };
      d.touch("users");
      return json({ token: await signToken(uname), user: publicUser(users[uname]) });
    }

    const auth = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const users = await d.get("users");
    const uname = await verifyToken(auth);
    const u = uname && users[uname];
    if (!u) return json({ error: "Not signed in" }, 401);
    const agent = u.role === "agent";

    if (method === "GET") {
      if (path === "/api/me") return json(publicUser(u));
      if (path === "/api/sightings") return json((await d.get("sightings")).map(s => publicSighting(s, u)));
      if (path === "/api/integrity") {
        const items = await d.get("integrity");
        return json(agent ? items : items.filter(r => r.by === u.username));
      }
      if (!agent) return json({ error: "Agents only" }, 403);
      if (path === "/api/agents") return json(await d.get("agents"));
      if (path === "/api/alerts") return json(await d.get("alerts"));
      if (path === "/api/energy") return json((await d.get("energy")).slice(0, 10));
      if (path === "/api/code") return json((await d.get("code")).slice(0, 10));
      if (path === "/api/correlate") return json(await correlation(d));
      return json({ error: "Not found" }, 404);
    }

    if (method !== "POST") return json({ error: "Method not allowed" }, 405);

    if (path === "/api/logout") return json({ ok: true });

    if (path === "/api/sightings") {
      const desc = String(data.description || "").trim();
      if (desc.length < 10) return json({ error: "Please describe what you saw (at least 10 characters)" }, 400);
      const x = Number.isFinite(data.x) ? data.x : null, y = Number.isFinite(data.y) ? data.y : null;
      const s = newSighting(desc.slice(0, 2000), String(data.location || "Unspecified").slice(0, 80), x, y,
        String(data.seen_at || nowIso().slice(0, 16)).slice(0, 16), data.anonymous ? "Anonymous" : u.name, u.username);
      (await d.get("sightings")).unshift(s);
      d.touch("sightings");
      if (s.match_level !== "low") {
        const strong = s.match_level === "strong";
        await raiseAlert(d, strong ? "sighting_strong" : "sighting_possible", strong ? "high" : "medium", "Sightings",
          `${strong ? "Strong" : "Possible"} POI-1 match (${s.match_score}) at ${s.location}`, "Traits: " + s.traits.join(", "), s.id);
      }
      return json(publicSighting(s, u));
    }

    if (path === "/api/integrity") {
      const score = Math.max(0, Math.min(100, Math.round(Number(data.score) || 0)));
      const condition = score >= 60 ? "severe" : score >= 30 ? "moderate" : "minor";
      const findings = (Array.isArray(data.findings) ? data.findings : []).slice(0, 20).map(f => ({ kind: String(f.kind || ""), text: String(f.text || "").slice(0, 300) }));
      const r = {
        id: uid(), created: nowIso(), by: u.username, by_name: u.name, machine_id: String(data.machine_id || "UNKNOWN").slice(0, 40),
        score, condition, metrics: data.metrics || {}, findings, thumbnail: String(data.thumbnail || "").slice(0, 120000),
        notes: String(data.notes || "").slice(0, 1000),
      };
      (await d.get("integrity")).unshift(r);
      d.touch("integrity");
      if (condition !== "minor") {
        await raiseAlert(d, condition === "severe" ? "integrity_severe" : "integrity_moderate", condition === "severe" ? "high" : "low",
          "Asset integrity", `${condition === "severe" ? "Severe surface damage" : "Moderate wear"} on ${r.machine_id} (${score}/100)`,
          findings.slice(0, 4).map(f => f.text).join("; "), r.id);
      }
      return json(r);
    }

    if (!agent) return json({ error: "Agents only" }, 403);

    if (path === "/api/energy/analyze") {
      const result = analyzeEnergy(Array.isArray(data.rows) ? data.rows : [], Number(data.hvac_kw ?? 15), Number(data.hvac_hours ?? 24),
        Boolean(data.harmonics), Boolean(data.phase_imbalance));
      if (result.error) return json(result, 400);
      const rep = { id: uid(), created: nowIso(), by: u.name, result };
      (await d.get("energy")).unshift(rep);
      d.touch("energy");
      for (const s of result.spikes) {
        if (s.verdict === "hvac_consistent") {
          await raiseAlert(d, "energy_hvac", "low", "Energy", `Load spike ${s.date} consistent with HVAC`, s.reasons.join("; "), rep.id);
        } else {
          await raiseAlert(d, "energy_anomaly", s.verdict === "anomalous" ? "critical" : "high", "Energy",
            `${s.verdict === "anomalous" ? "Anomalous" : "Suspicious"} demand spike on ${s.date}: ${Math.round(s.usage).toLocaleString("en-US")} kWh`, s.reasons.join("; "), rep.id);
        }
      }
      if (result.discrepancies.length) {
        await raiseAlert(d, "meter_discrepancy", "high", "Energy", `${result.discrepancies.length} meter discrepancy(ies) referred for verification`,
          result.discrepancies.map(x => `${x.date}: reported ${x.reported} kWh, meter shows ${x.meter_delta} kWh`).join("; "), rep.id);
      }
      return json(rep);
    }

    if (path === "/api/code/analyze") {
      const original = String(data.original || ""), altered = String(data.altered || "");
      if (!original.trim() || !altered.trim()) return json({ error: "Provide both source versions" }, 400);
      if (original.length > 300000 || altered.length > 300000) return json({ error: "Source too large (300 KB max)" }, 400);
      const result = await analyzeCode(original, altered, data.original_label || "original", data.altered_label || "altered",
        data.captured_before, data.captured_after);
      const rep = { id: uid(), created: nowIso(), by: u.name, machine_id: String(data.machine_id || "MJWHKZLTNBUXE5A").slice(0, 40), result };
      (await d.get("code")).unshift(rep);
      d.touch("code");
      if (["critical", "high", "medium"].includes(result.severity)) {
        const top = result.findings[0];
        await raiseAlert(d, "code_" + result.severity, result.severity, "Code forensics", `${result.severity.toUpperCase()}: ${top.title} on ${rep.machine_id}`, top.detail, rep.id);
      }
      return json(rep);
    }

    if (path === "/api/correlate/escalate") {
      const c = await correlation(d);
      if (c.score < 40) return json({ error: "Verdict is below the escalation threshold (40). Gather more evidence first." }, 400);
      const malicious = c.score >= 70;
      const a = await raiseAlert(d, malicious ? "correlation_malicious" : "correlation_suspicious", malicious ? "critical" : "high",
        "Correlation engine", `Case verdict: ${c.verdict} (${c.score}/100)`, c.evidence.filter(e => e.weight).map(e => e.text).join(" | "));
      return json(a);
    }

    if (path === "/api/agents/checkin") {
      const agents = await d.get("agents");
      const me = agents.find(a => a.username === u.username);
      if (!me) return json({ error: "No agent profile" }, 404);
      const x = Number.isFinite(data.x) ? data.x : me.x, y = Number.isFinite(data.y) ? data.y : me.y;
      const location = String(data.location || me.location).slice(0, 80);
      me.trail.unshift({ time: nowIso(), location, x, y, note: String(data.note || "").slice(0, 200) });
      me.trail.length = Math.min(me.trail.length, 20);
      Object.assign(me, { location, x, y, last_checkin: nowIso(), status: String(data.status || me.status).slice(0, 40) });
      d.touch("agents");
      if (/backup/i.test(me.status)) {
        await raiseAlert(d, "sighting_strong", "critical", "Agent tracker", `${me.name} requests backup at ${location}`, me.trail[0].note || "No details given");
      }
      return json(me);
    }

    let m = path.match(/^\/api\/alerts\/(\w+)\/(ack|resolve)$/);
    if (m) {
      const a = (await d.get("alerts")).find(x => x.id === m[1]);
      if (!a) return json({ error: "Not found" }, 404);
      Object.assign(a, { status: m[2] === "ack" ? "acknowledged" : "resolved", handled_by: u.name });
      d.touch("alerts");
      return json(a);
    }

    m = path.match(/^\/api\/sightings\/(\w+)\/(verify|dismiss)$/);
    if (m) {
      const s = (await d.get("sightings")).find(x => x.id === m[1]);
      if (!s) return json({ error: "Not found" }, 404);
      s.status = m[2] === "verify" ? "verified" : "dismissed";
      d.touch("sightings");
      return json(s);
    }

    return json({ error: "Not found" }, 404);
  }
}
