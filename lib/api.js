// Sentinel API. Web-standard Request -> Response handler.
// `store` is any { get(key) -> value|null, set(key, value) } JSON store
// (Netlify Blobs in production, a JSON file locally, memory in tests).

import { PLACES, scoreSighting, matchProfile, bestProfile } from "../public/js/poi.js";
import { analyzeEnergy, analyzeCode, correlate } from "./engines.js";

const enc = new TextEncoder();
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = s => atob(s.replace(/-/g, "+").replace(/_/g, "/"));
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const randHex = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const uid = () => randHex(5);
const nowIso = () => new Date().toISOString().slice(0, 19) + "Z";

const LIMITS = { alerts: 200, energy: 20, code: 20, integrity: 50, sightings: 500, messages: 1500, profiles: 60 };

const CHANNELS = [
  { id: "general", name: "general", topic: "Agency-wide announcements and chatter" },
  { id: "wenoti", name: "wenoti-case", topic: "Wenoti Arcade · The Reckoning V: Origins · MJWHKZLTNBUXE5A" },
  { id: "field", name: "field-ops", topic: "Coordination on the ground. Urgent pings alert every field agent." },
  { id: "sightings", name: "sightings-triage", topic: "Discuss citizen reports of POI-1, other characters and agents" },
];
const dmId = (a, b) => "dm-" + [a, b].sort().join("-");
const ONLINE_MS = 2 * 60 * 1000;

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
  character_strong: ["EXUN Field Agents", "EXUN Operations"],
  agent_sighting: ["EXUN Operations"],
  agent_impostor: ["EXUN Operations", "EIA Command"],
  comms_urgent: ["EXUN Field Agents"],
  profile_strong: ["EXUN Field Agents", "EXUN Operations"],
};

let ITERATIONS = 100000;

async function hashPw(password, salt) {
  salt = salt || randHex(16);
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc.encode(salt), iterations: ITERATIONS, hash: "SHA-256" }, key, 256);
  return { salt, hash: hex(bits) };
}

// subject: "profile" (someone on the missing board), "character" (not on the board) or "agent"
function newSighting(description, location, x, y, seenAt, reporterName, reporter, subject, extra = {}, profiles = []) {
  const p = extra.profile;
  const { score, level, traits } = subject === "profile" ? matchProfile(p, description, x, y) : scoreSighting(subject, description, x, y);
  // Someone "not on the board" may still match a board profile
  const best = subject === "character" ? bestProfile(profiles, description, x, y) : null;
  return {
    id: uid(), created: nowIso(), seen_at: seenAt, subject, profile_id: p?.id || null, profile_name: p?.name || null,
    description, location, x, y, reporter, reporter_name: reporterName,
    match_score: score, match_level: level, traits, status: "new", case_ref: p?.case_ref || null,
    character_name: extra.character_name || null, game: extra.game || null, agent_name: extra.agent_name || null,
    also_match: best && best.level === "strong" ? { id: best.id, name: best.name, score: best.score } : null,
    linked_agent: null, impostor: false,
  };
}

// Sightings stored before the missing board existed referred to POI-1 directly
const normSighting = s => {
  if (s.subject && s.subject !== "poi1") return s;
  return { ...s, subject: "profile", profile_id: "poi-1", profile_name: s.profile_name || "The Armoured Stranger" };
};

const T = (label, weight, keywords) => ({ label, weight, keywords });
const SEED_PROFILES = [
  {
    id: "poi-1", name: "The Armoured Stranger", alias: "POI-1", kind: "character", case_ref: "POI-1",
    origin: "Suspected: The Reckoning V: Origins (its Character class is missing)",
    description: "Seen at Wenoti Arcade on 23 October posing as a cosplayer. Tampered with The Reckoning V cabinet, then left in a hurry when approached. Linked to a 96× power surge the same night.",
    danger: "do_not_approach", published: true, status: "missing",
    last_seen: { location: "Wenoti Arcade, 92nd Ave", x: 63, y: 38, time: "2026-10-23T22:31" },
    traits: [
      T("Pointed or sharp ears", 3, ["pointed ear", "pointy ear", "sharp ear", "sharp pointed ear", "elf", "elven", "elvish", "ears were pointed"]),
      T("Armour", 3, ["armour", "armor", "chainmail", "chain mail", "breastplate", "knight"]),
      T("Scabbard or sword", 3, ["scabbard", "sheath", "sword", "blade", "sabre", "saber"]),
      T("Leather gloves", 2, ["glove", "gauntlet"]),
      T("Thick or unusual accent", 2, ["accent", "archaic", "old-fashioned", "spoke strangely", "strange way of speaking"]),
      T("Bedazzled, jewelled outfit", 1, ["bedazzl", "sparkl", "jewel", "gem", "glitter", "shiny"]),
      T("Boots", 1, ["boot"]),
      T("Nervous or evasive", 1, ["stutter", "nervous", "flinch", "jumpy", "hurried", "ran off", "fled", "panick"]),
      T("Unfamiliar with modern life", 1, ["bare wrist", "no watch", "confused by", "didn't know", "never seen"]),
      T("Near arcades or electronics", 1, ["arcade", "game machine", "cabinet", "electronic", "spark", "flicker", "warbl", "reverberat"]),
    ],
  },
  {
    id: "vexa", name: "Vexa", alias: "The Neon Courier", kind: "character", case_ref: "EIA-INT-0412",
    origin: "Skyline Sprint (arcade racer)",
    description: "Courier character reported missing from an arcade cabinet abroad, part of the wave of disappearances partner agencies have reported to the EIA. Moves at impossible speed and leaves a faint trail of light.",
    danger: "harmless", published: true, status: "missing",
    last_seen: { location: "Reported abroad via EIA partner agency", x: null, y: null, time: "2026-10-26T08:00" },
    traits: [
      T("Glowing neon jacket", 3, ["neon", "glowing jacket", "glow", "light-up", "lit up"]),
      T("Roller skates", 3, ["roller skate", "skates", "skating", "rollerblad"]),
      T("Impossible speed", 2, ["super fast", "blur", "zoomed", "sped past", "faster than", "so fast"]),
      T("Trail of light", 2, ["trail of light", "light trail", "streak", "afterimage"]),
      T("Courier satchel", 1, ["satchel", "parcel", "package", "delivery"]),
      T("Spiky teal hair", 1, ["teal hair", "spiky hair", "blue hair", "green hair"]),
    ],
  },
  {
    id: "ferro", name: "Old Man Ferro", alias: "The Blacksmith", kind: "character", case_ref: "EIA-INT-0419",
    origin: "Ironhold Tales (fantasy RPG)",
    description: "Village blacksmith character missing from an RPG cabinet. Friendly but confused. Tends to repeat the same few lines of dialogue to anyone nearby.",
    danger: "caution", published: true, status: "missing",
    last_seen: { location: "Reported abroad via EIA partner agency", x: null, y: null, time: "2026-10-27T11:30" },
    traits: [
      T("Leather apron", 3, ["apron"]),
      T("Hammer", 2, ["hammer", "mallet", "anvil"]),
      T("Repeats the same lines", 3, ["repeat", "same line", "same phrase", "kept saying", "traveller", "traveler"]),
      T("Thick grey beard", 2, ["grey beard", "gray beard", "white beard", "beard"]),
      T("Covered in soot", 1, ["soot", "ash", "smelled of smoke", "smoky", "burnt"]),
      T("Confused by modern life", 1, ["confused", "didn't know", "never seen", "scared of", "afraid of"]),
    ],
  },
];
const seedProfiles = () => SEED_PROFILES.map(p => ({ ...p, image: null, created_by: "Conis Nikrobo", created: "2026-10-24T10:00", updated: "2026-10-27T12:00" }));

function cleanProfile(data, prev = {}) {
  const str = (v, n) => String(v ?? "").trim().slice(0, n);
  const name = str(data.name, 60);
  if (name.length < 2) return { error: "Give the profile a name" };
  const traits = (Array.isArray(data.traits) ? data.traits : []).slice(0, 12).map(t => ({
    label: str(t.label, 50),
    weight: [1, 2, 3].includes(Number(t.weight)) ? Number(t.weight) : 1,
    keywords: [...new Set((Array.isArray(t.keywords) ? t.keywords : String(t.keywords || "").split(","))
      .map(k => str(k, 30).toLowerCase()).filter(k => k.length >= 2))].slice(0, 12),
  })).filter(t => t.label && t.keywords.length);
  if (!traits.length) return { error: "Add at least one trait with keywords, so sightings can be matched" };
  let image = prev.image ?? null;
  if (data.image === null) image = null;
  else if (typeof data.image === "string" && data.image !== prev.image) {
    if (!/^data:image\/(png|jpeg|webp);base64,/.test(data.image) || data.image.length > 260000) return { error: "Image must be a PNG, JPEG or WebP under 190 KB" };
    image = data.image;
  }
  const ls = data.last_seen;
  const last_seen = ls && str(ls.location, 80) ? {
    location: str(ls.location, 80), x: Number.isFinite(ls.x) ? ls.x : null, y: Number.isFinite(ls.y) ? ls.y : null, time: str(ls.time, 16) || null,
  } : null;
  return {
    profile: {
      name, alias: str(data.alias, 60) || null, origin: str(data.origin, 80) || null, description: str(data.description, 700),
      kind: ["character", "person", "unknown"].includes(data.kind) ? data.kind : "character",
      danger: ["harmless", "caution", "do_not_approach"].includes(data.danger) ? data.danger : "caution",
      case_ref: str(data.case_ref, 30) || null, published: Boolean(data.published), traits, image, last_seen,
    },
  };
}

const SEED_MESSAGES = [
  ["wenoti", "mega", "2026-10-23T22:58", "Back from the arcade. The \"cosplayer\" bolted the second Nano asked what he was doing. The Reckoning machine started warbling right after. Transcript A is filed."],
  ["wenoti", "conis", "2026-10-24T09:12", "Department of Electricity flagged a huge draw on the 23rd. I've requested the full meter records for Wenoti."],
  ["wenoti", "nano", "2026-10-24T16:40", "We finally got the game source code! Sending it to the code analysts now."],
  ["wenoti", "nano", "2026-10-25T23:54", "OK OK OK, listen. The analysts say one of the character classes is COMPLETELY MISSING from the build. @mega the cosplayer wasn't a cosplayer.", { pinned: true, urgent: true }],
  ["wenoti", "mega", "2026-10-25T23:58", "Nano, it's midnight. ...but the timing does line up with the spike. Let's run it all through Sentinel tomorrow."],
  ["field", "mega", "2026-10-26T14:20", "Holding near Wenoti. Machine is still humming when nobody's playing it."],
  ["general", "conis", "2026-10-27T09:00", "Notice EIA/EXUN/SUS-01 is in effect. Case records stay accessible. Keep all case discussion in Sentinel comms.", { pinned: true }],
  ["dm-mega-nano", "nano", "2026-10-27T20:15", "They're relocating us. I'll explain when I can. Keep watching the arcades."],
];

function seedMessages(users) {
  return SEED_MESSAGES.filter(([, from]) => users[from]).map(([conv, from, time, text, opts = {}]) => ({
    id: uid(), conv, from, from_name: users[from].name, time, text, ref: null, urgent: Boolean(opts.urgent), pinned: Boolean(opts.pinned),
  })).reverse();
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
    "Wenoti Arcade, 92nd Ave", 63, 38, "2026-10-23T22:31", "Agents Nano & Mega (Transcript A)", "nano", "profile",
    { profile: SEED_PROFILES[0] });
  s.status = "verified";
  return { users, agents, sightings: [s], alerts: [], energy: [], code: [], integrity: [], messages: seedMessages(users), reads: {}, profiles: seedProfiles() };
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
      async get(name) { if (!(name in cache)) cache[name] = (await store.get(name)) ?? (["users", "reads"].includes(name) ? {} : []); return cache[name]; },
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
    const users = await store.get("users");
    if (!users) {
      const data = await seedData();
      for (const [k, v] of Object.entries(data)) await store.set(k, v);
    } else {
      // Deployments seeded before comms / the missing board existed
      if ((await store.get("messages")) === null) await store.set("messages", seedMessages(users));
      if ((await store.get("profiles")) === null) await store.set("profiles", seedProfiles());
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
  // Agent sightings are only visible to agents and to the person who filed them (agents work undercover)
  const visibleTo = viewer => s => viewer.role === "agent" || s.subject !== "agent" || s.reporter === viewer.username;
  const sightingsN = async d => (await d.get("sightings")).map(normSighting);
  const boardCount = (sightings, id) => sightings.filter(s => s.subject !== "agent" && s.status !== "dismissed" && (s.profile_id === id || s.also_match?.id === id)).length;
  const publicProfile = (p, sightings) => {
    const { created_by, ...rest } = p;
    return { ...rest, sightings: boardCount(sightings, p.id) };
  };

  async function correlation(d) {
    const [energy, code, integrity] = await Promise.all(["energy", "code", "integrity"].map(n => d.get(n)));
    const sightings = await sightingsN(d);
    return correlate({ energy: energy[0], code: code[0], integrity: integrity[0], sightings });
  }

  async function resolveConv(d, u, id) {
    const ch = CHANNELS.find(c => c.id === id);
    if (ch) return { ...ch, kind: "channel" };
    const mm = id.match(/^dm-([a-z0-9_]+)-([a-z0-9_]+)$/);
    if (!mm || ![mm[1], mm[2]].includes(u.username) || mm[1] === mm[2]) return null;
    const other = mm[1] === u.username ? mm[2] : mm[1];
    const users = await d.get("users");
    if (users[other]?.role !== "agent" || id !== dmId(u.username, other)) return null;
    return { id, kind: "dm", name: users[other].name, with: other, topic: "Direct message" };
  }

  async function commsOverview(d, u) {
    const [messages, reads, agents] = await Promise.all([d.get("messages"), d.get("reads"), d.get("agents")]);
    const me = agents.find(a => a.username === u.username);
    if (me && Date.now() - Date.parse(me.last_active || 0) > 45000) { me.last_active = nowIso(); d.touch("agents"); }
    const myReads = reads[u.username] || {};
    const mention = new RegExp(`@${u.username}\\b`, "i");
    const summary = id => {
      const conv = messages.filter(x => x.conv === id);
      const unread = conv.filter(x => x.from !== u.username && x.time > (myReads[id] || ""));
      const last = conv[0];
      return {
        unread: unread.length, mentions: unread.filter(x => mention.test(x.text)).length,
        last: last ? { from_name: last.from_name, text: last.text.slice(0, 120), time: last.time } : null,
      };
    };
    const online = a => Date.now() - Date.parse(a.last_active || 0) < ONLINE_MS;
    const people = agents.filter(a => a.username !== u.username);
    return {
      channels: CHANNELS.map(c => ({ ...c, kind: "channel", ...summary(c.id) })),
      dms: people.map(a => ({ id: dmId(u.username, a.username), kind: "dm", name: a.name, with: a.username, status: a.status, online: online(a), ...summary(dmId(u.username, a.username)) })),
      online: agents.filter(online).map(a => a.username),
    };
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
      const sightings = (await sightingsN(d)).filter(s => s.subject !== "agent");
      const latest = sightings.filter(s => s.status !== "dismissed")[0];
      const profiles = await d.get("profiles");
      return json({
        places: PLACES, sightings: sightings.length,
        missing: profiles.filter(p => p.published && p.status === "missing").length,
        found: profiles.filter(p => p.published && p.status === "found").length,
        characters: sightings.filter(s => s.subject === "character").length,
        strong: sightings.filter(s => s.match_level === "strong" && s.status !== "dismissed").length,
        latest: latest ? { location: latest.location, seen_at: latest.seen_at } : null,
      });
    }

    if (path === "/api/public/profiles" && method === "GET") {
      const [profiles, sightings] = await Promise.all([d.get("profiles"), sightingsN(d)]);
      return json(profiles.filter(p => p.published && p.status !== "archived").map(p => publicProfile(p, sightings)));
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
      if (path === "/api/sightings") return json((await sightingsN(d)).filter(visibleTo(u)).map(s => publicSighting(s, u)));
      if (path === "/api/integrity") {
        const items = await d.get("integrity");
        return json(agent ? items : items.filter(r => r.by === u.username));
      }
      if (!agent) return json({ error: "Agents only" }, 403);
      if (path === "/api/agents") return json(await d.get("agents"));
      if (path === "/api/profiles") {
        const [profiles, sightings] = await Promise.all([d.get("profiles"), sightingsN(d)]);
        return json(profiles.map(p => ({ ...p, sightings: boardCount(sightings, p.id) })));
      }
      if (path === "/api/alerts") return json(await d.get("alerts"));
      if (path === "/api/energy") return json((await d.get("energy")).slice(0, 10));
      if (path === "/api/code") return json((await d.get("code")).slice(0, 10));
      if (path === "/api/correlate") return json(await correlation(d));
      if (path === "/api/comms") return json(await commsOverview(d, u));
      const cm = path.match(/^\/api\/comms\/([\w-]+)$/);
      if (cm) {
        const conv = await resolveConv(d, u, cm[1]);
        if (!conv) return json({ error: "Conversation not found" }, 404);
        const after = new URL(req.url).searchParams.get("after");
        const all = (await d.get("messages")).filter(m => m.conv === conv.id);
        const messages = (after ? all.filter(m => m.time > after) : all.slice(0, 200)).reverse();
        return json({ conv, messages, pinned: all.filter(m => m.pinned).reverse() });
      }
      return json({ error: "Not found" }, 404);
    }

    if (method !== "POST") return json({ error: "Method not allowed" }, 405);

    if (path === "/api/logout") return json({ ok: true });

    if (path === "/api/sightings") {
      const desc = String(data.description || "").trim();
      if (desc.length < 10) return json({ error: "Please describe what you saw (at least 10 characters)" }, 400);
      const x = Number.isFinite(data.x) ? data.x : null, y = Number.isFinite(data.y) ? data.y : null;
      let subject = ["profile", "character", "agent"].includes(data.subject) ? data.subject : data.subject === "poi1" ? "profile" : "character";
      const profiles = await d.get("profiles");
      const live = profiles.filter(p => p.published && p.status !== "archived");
      const profile = subject === "profile" ? live.find(p => p.id === (data.profile_id || "poi-1")) : null;
      if (subject === "profile" && !profile) return json({ error: "That missing-board profile isn't available" }, 400);
      const clip = v => String(v || "").trim().slice(0, 60) || null;
      const s = newSighting(desc.slice(0, 2000), String(data.location || "Unspecified").slice(0, 80), x, y,
        String(data.seen_at || nowIso().slice(0, 16)).slice(0, 16), data.anonymous ? "Anonymous" : u.name, u.username, subject,
        { profile, character_name: clip(data.character_name), game: clip(data.game), agent_name: clip(data.agent_name) }, live);
      (await d.get("sightings")).unshift(s);
      d.touch("sightings");
      const traits = "Traits: " + (s.traits.join(", ") || "none matched");
      if (subject === "profile" && s.match_level !== "low") {
        const strong = s.match_level === "strong";
        await raiseAlert(d, strong ? "profile_strong" : "sighting_possible", strong ? "high" : "medium", "Sightings",
          `${strong ? "Strong" : "Possible"} match for ${profile.name}${profile.alias ? ` (${profile.alias})` : ""} at ${s.location}`, `${traits}. Score ${s.match_score}.`, s.id);
      } else if (subject === "character") {
        const who = s.character_name ? `${s.character_name}${s.game ? ` (${s.game})` : ""}` : "Unidentified character";
        if (s.also_match) {
          await raiseAlert(d, "profile_strong", "high", "Sightings", `Unlisted report matches ${s.also_match.name} at ${s.location}`, `${who}. Score ${s.also_match.score}.`, s.id);
        } else if (s.match_level !== "low") {
          const strong = s.match_level === "strong";
          await raiseAlert(d, strong ? "character_strong" : "sighting_possible", strong ? "high" : "medium", "Sightings",
            `${strong ? "Likely" : "Possible"} escaped character: ${who} at ${s.location}`, traits, s.id);
        }
      } else if (subject === "agent") {
        const agents = await d.get("agents");
        const claimed = s.agent_name && s.agent_name.toLowerCase().replace(/^agent\s+/, "");
        const known = claimed && agents.find(a => a.name.toLowerCase().replace(/^agent\s+/, "") === claimed || a.username === claimed);
        if (known) s.linked_agent = known.id;
        if (claimed && !known) {
          s.impostor = true;
          await raiseAlert(d, "agent_impostor", "high", "Sightings", `Possible impersonation: "${s.agent_name}" is not on the EXUN roster`,
            `Reported at ${s.location}. ${traits}`, s.id);
        } else {
          await raiseAlert(d, "agent_sighting", "medium", "Sightings",
            `Agent sighting${known ? `: ${known.name}` : ""} at ${s.location}`, traits, s.id);
        }
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

    if (path === "/api/profiles") {
      const r = cleanProfile(data);
      if (r.error) return json(r, 400);
      const profiles = await d.get("profiles");
      const base = r.profile.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "profile";
      const p = { id: `${base}-${uid().slice(0, 4)}`, ...r.profile, status: "missing", created_by: u.name, created: nowIso(), updated: nowIso() };
      profiles.unshift(p);
      d.touch("profiles");
      if (p.published) await raiseAlert(d, "agent_sighting", "medium", "Missing board", `${u.name} added ${p.name} to the missing board`, p.description.slice(0, 200), p.id);
      return json(p);
    }

    let m = path.match(/^\/api\/profiles\/([\w-]+)(?:\/(status))?$/);
    if (m) {
      const profiles = await d.get("profiles");
      const p = profiles.find(x => x.id === m[1]);
      if (!p) return json({ error: "Profile not found" }, 404);
      if (m[2] === "status") {
        if (!["missing", "found", "archived"].includes(data.status)) return json({ error: "Unknown status" }, 400);
        Object.assign(p, { status: data.status, updated: nowIso() });
      } else {
        const r = cleanProfile(data, p);
        if (r.error) return json(r, 400);
        Object.assign(p, r.profile, { updated: nowIso() });
      }
      d.touch("profiles");
      return json(p);
    }

    m = path.match(/^\/api\/sightings\/(\w+)\/link$/);
    if (m) {
      const s = (await d.get("sightings")).find(x => x.id === m[1]);
      if (!s) return json({ error: "Not found" }, 404);
      const agents = await d.get("agents");
      if (data.agent_id && !agents.some(a => a.id === data.agent_id)) return json({ error: "Unknown agent" }, 400);
      Object.assign(s, { linked_agent: data.agent_id || null, impostor: Boolean(data.impostor) && !data.agent_id });
      d.touch("sightings");
      return json(s);
    }

    m = path.match(/^\/api\/comms\/([\w-]+)(?:\/(read|pin)(?:\/(\w+))?)?$/);
    if (m) {
      const conv = await resolveConv(d, u, m[1]);
      if (!conv) return json({ error: "Conversation not found" }, 404);
      const messages = await d.get("messages");
      if (m[2] === "read") {
        const reads = await d.get("reads");
        (reads[u.username] ||= {})[conv.id] = nowIso();
        d.touch("reads");
        return json({ ok: true });
      }
      if (m[2] === "pin") {
        const msg = messages.find(x => x.id === m[3] && x.conv === conv.id);
        if (!msg) return json({ error: "Message not found" }, 404);
        msg.pinned = !msg.pinned;
        d.touch("messages");
        return json(msg);
      }
      const text = String(data.text || "").trim().slice(0, 2000);
      if (!text) return json({ error: "Message is empty" }, 400);
      const ref = data.ref && typeof data.ref === "object" && ["alert", "sighting", "energy", "code", "agent"].includes(data.ref.type)
        ? { type: data.ref.type, id: String(data.ref.id || "").slice(0, 20), label: String(data.ref.label || "").slice(0, 160) } : null;
      const msg = { id: uid(), conv: conv.id, from: u.username, from_name: u.name, time: nowIso(), text, ref, urgent: Boolean(data.urgent), pinned: false };
      messages.unshift(msg);
      d.touch("messages");
      const reads = await d.get("reads");
      (reads[u.username] ||= {})[conv.id] = msg.time;
      d.touch("reads");
      if (msg.urgent) {
        await raiseAlert(d, "comms_urgent", "high", "Comms", `Urgent from ${u.name} in ${conv.kind === "dm" ? "a direct message" : "#" + conv.name}`, text.slice(0, 240));
      }
      return json(msg);
    }

    m = path.match(/^\/api\/alerts\/(\w+)\/(ack|resolve)$/);
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
      // A verified sighting becomes the profile's last known location on the board
      const ns = normSighting(s), pid = ns.subject === "profile" ? ns.profile_id : ns.also_match?.id;
      if (s.status === "verified" && pid) {
        const p = (await d.get("profiles")).find(x => x.id === pid);
        if (p && (!p.last_seen?.time || ns.seen_at > p.last_seen.time)) {
          p.last_seen = { location: ns.location, x: ns.x, y: ns.y, time: ns.seen_at };
          p.updated = nowIso();
          d.touch("profiles");
        }
      }
      return json(s);
    }

    return json({ error: "Not found" }, 404);
  }
}
