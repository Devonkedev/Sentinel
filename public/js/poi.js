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
