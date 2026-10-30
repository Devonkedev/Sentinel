// Sighting scoring. Shared by the API and the browser (live preview).

const distanceKm = (a, b) => {
  const r = d => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

// Any video game character that seems to have left its game
export const CHARACTER_TRAITS = [
  ["Glitching, flickering or pixelated", 20, /glitch|flicker|pixel|8[- ]?bit|16[- ]?bit|low[- ]poly|jagged|blocky|lagg?(ed|ing)?\b/],
  ["Costume or game gear", 12, /armou?r|sword|shield|helmet|cape|staff|wand|\bbow\b|gauntlet|tunic|power suit|blaster|potion/],
  ["Impossible movement", 15, /jump(ed)? (really |very |super )?high|double jump|teleport|vanish|disappear|walked through|phas(ed|ing)|float|hover|super ?fast/],
  ["Repeats lines or speaks oddly", 10, /repeat|same (line|phrase|thing)|catchphrase|robotic|monoton|accent|archaic/],
  ["Unfamiliar with the real world", 10, /confused|didn.?t know|never seen|bare wrist|amazed by|scared of|afraid of/],
  ["Near arcades or electronics", 10, /arcade|cabinet|game machine|console|screen|\btv\b|electronic/],
  ["Power disturbance", 15, /spark|power (cut|surge|outage)|lights? (flicker|went out|dimmed)|static|\bhum|buzz|warbl|reverberat/],
  ["Unreal colours or outline", 8, /neon|glow|outline|cel[- ]shad|cartoon|bright(ly)? colou?r/],
];

// Reports of a Sentinel agent, or someone claiming to be one
export const AGENT_TRAITS = [
  ["Claimed to be an agent", 20, /sentinel|\bagent\b|intelligence agency|government|official/],
  ["Showed a badge or ID", 15, /badge|id card|\bid\b|credentials|identification/],
  ["Asked about the arcade or machine", 15, /arcade|machine|cabinet/],
  ["Asked about a missing character", 15, /missing|character|cosplay|poster|wanted/],
  ["Surveillance behaviour", 15, /watching|taking notes|photograph|camera|earpiece|following|undercover|staking/],
  ["Gave a name or codename", 10, /name was|called (him|her|them)sel(f|ves)|codename/],
];

export const SUBJECTS = {
  character: { label: "Video game character", traits: CHARACTER_TRAITS },
  agent: { label: "Sentinel agent", traits: AGENT_TRAITS },
};

function score(traitList, description) {
  const text = String(description || "").toLowerCase();
  const traits = [];
  let total = 0;
  for (const [label, weight, re] of traitList) {
    if (re.test(text)) { traits.push(label); total += weight; }
  }
  return { score: Math.min(total, 100), traits };
}

// Scores a sighting against the profile for its subject.
// Agent sightings get level "agent": they are logged for review, not ranked.
export function scoreSighting(subject, description) {
  if (subject === "agent") return { ...score(AGENT_TRAITS, description), level: "agent" };
  const s = score(CHARACTER_TRAITS, description);
  return { ...s, level: s.score >= 50 ? "strong" : s.score >= 25 ? "possible" : "low" };
}

// ---------------------------------------------------------------- missing-board profiles
// A profile's traits are data: { label, keywords: [...], weight: 1-3 }.
// A trait matches when any keyword appears at the start of a word ("armour" matches "armoured").
const kwCache = new Map();
const kwRegex = k => {
  if (!kwCache.has(k)) kwCache.set(k, new RegExp("(?:^|[^a-z0-9])" + k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, ".?")));
  return kwCache.get(k);
};

export function matchProfile(profile, description, lat, lng) {
  const text = String(description || "").toLowerCase();
  const traits = [];
  let got = 0, total = 0;
  for (const t of profile.traits || []) {
    const w = Number(t.weight) || 1;
    total += w;
    if ((t.keywords || []).some(k => k && kwRegex(k).test(text))) { got += w; traits.push(t.label); }
  }
  let score = total ? Math.round((100 * got) / total) : 0;
  const ls = profile.last_seen;
  if (ls && ls.lat != null && lat != null && lng != null && distanceKm(ls, { lat, lng }) < 2) {
    score += 5;
    traits.push("Near last known location");
  }
  score = Math.min(score, 100);
  return { score, level: score >= 60 ? "strong" : score >= 35 ? "possible" : "low", traits };
}

// Best-matching profile for a description, for reports of someone "not on the board"
export function bestProfile(profiles, description, lat, lng) {
  let best = null;
  for (const p of profiles) {
    const m = matchProfile(p, description, lat, lng);
    if (!best || m.score > best.score) best = { id: p.id, name: p.name, ...m };
  }
  return best;
}
