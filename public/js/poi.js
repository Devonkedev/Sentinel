// POI-1 profile matcher. Shared by the API (scoring) and the browser (live preview).

export const PLACES = {
  "Wenoti Arcade, 92nd Ave": [63, 38],
  "etiNuxe Intelligence Agency HQ": [24, 22],
  "Department of Electricity": [57, 66],
  "Central Station": [48, 48],
  "Riverside Market": [78, 66],
  "Old Town Square": [20, 60],
  "92nd Ave Substation": [70, 30],
};

export const POI_TRAITS = [
  ["Pointed / sharp ears", 20, /\b(pointy|pointed|sharp|elf(in|ish)?|long)\b[\w\s,]{0,20}\bears?\b|\bears?\b[\w\s]{0,12}\b(pointy|pointed|sharp)\b|\belf/],
  ["Armour", 18, /armou?r|chain ?mail|breastplate|plate mail|knight/],
  ["Embellished / bedazzled outfit", 4, /bedazzl|sparkl|jewel|gems?\b|glitter|shiny/],
  ["Scabbard or sword", 15, /scabbard|sheath|sword|blade|sabre|saber/],
  ["Leather gloves / gauntlets", 9, /gloves?|gauntlets?/],
  ["Boots", 7, /\bboots?\b/],
  ["Thick or unusual accent", 9, /accent|archaic|old[- ]fashioned (speech|english)|strange(ly)? (way of )?(speak|talk)/],
  ["Nervous behaviour", 6, /stutter|nervous|flinch|jumpy|hurried|ran off|fled|panick/],
  ["Unfamiliar with modern life", 7, /bare wrist|no watch|wrist|confused by|didn.?t know (what|how)|never seen a/],
  ["Around arcade machines / electronics", 5, /arcade|game machine|cabinet|screen|electronic|spark|flicker|warbl|reverberat|power (cut|surge)/],
];

export function matchPoi(description, x, y) {
  const text = String(description || "").toLowerCase();
  const traits = [];
  let score = 0;
  for (const [label, weight, re] of POI_TRAITS) {
    if (re.test(text)) { traits.push(label); score += weight; }
  }
  const [ax, ay] = PLACES["Wenoti Arcade, 92nd Ave"];
  if (x != null && y != null && Math.hypot(x - ax, y - ay) < 15) {
    score += 5;
    traits.push("Near Wenoti Arcade");
  }
  score = Math.min(score, 100);
  const level = score >= 60 ? "strong" : score >= 35 ? "possible" : "low";
  return { score, level, traits };
}

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

// Reports of an EXUN agent, or someone claiming to be one
export const AGENT_TRAITS = [
  ["Claimed to be an agent", 20, /exun|\bagent\b|etinuxe|intelligence agency|government|official/],
  ["Showed a badge or ID", 15, /badge|id card|\bid\b|credentials|identification/],
  ["Asked about the arcade or machine", 15, /arcade|wenoti|reckoning|machine|cabinet/],
  ["Asked about POI-1", 15, /cosplay|armou?r|pointed ears|poi[- ]?1|knight/],
  ["Surveillance behaviour", 15, /watching|taking notes|photograph|camera|earpiece|following|undercover|staking/],
  ["Gave a name or codename", 10, /\bnano\b|\bmega\b|conis|nikrobo|name was|called (him|her|them)sel(f|ves)|codename/],
];

export const SUBJECTS = {
  poi1: { label: "POI-1", traits: POI_TRAITS },
  character: { label: "Video game character", traits: CHARACTER_TRAITS },
  agent: { label: "EXUN agent", traits: AGENT_TRAITS },
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
export function scoreSighting(subject, description, x, y) {
  if (subject === "agent") return { ...score(AGENT_TRAITS, description), level: "agent" };
  if (subject === "character") {
    const s = score(CHARACTER_TRAITS, description);
    return { ...s, level: s.score >= 50 ? "strong" : s.score >= 25 ? "possible" : "low" };
  }
  return matchPoi(description, x, y);
}

// ---------------------------------------------------------------- missing-board profiles
// A profile's traits are data: { label, keywords: [...], weight: 1-3 }.
// A trait matches when any keyword appears at the start of a word ("armour" matches "armoured").
const kwCache = new Map();
const kwRegex = k => {
  if (!kwCache.has(k)) kwCache.set(k, new RegExp("(?:^|[^a-z0-9])" + k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, ".?")));
  return kwCache.get(k);
};

export function matchProfile(profile, description, x, y) {
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
  if (ls && ls.x != null && x != null && y != null && Math.hypot(x - ls.x, y - ls.y) < 15) {
    score += 5;
    traits.push("Near last known location");
  }
  score = Math.min(score, 100);
  return { score, level: score >= 60 ? "strong" : score >= 35 ? "possible" : "low", traits };
}

// Best-matching profile for a description, for reports of someone "not on the board"
export function bestProfile(profiles, description, x, y) {
  let best = null;
  for (const p of profiles) {
    const m = matchProfile(p, description, x, y);
    if (!best || m.score > best.score) best = { id: p.id, name: p.name, ...m };
  }
  return best;
}
