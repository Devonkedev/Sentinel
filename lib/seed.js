// Demo content, written once into an empty store. Times are relative to first run
// so the case always looks current. Scores and alerts still come from the real engines.
const T = (label, weight, keywords) => ({ label, weight, keywords });

export const DEMO_AGENTS = [
  { id: "AG-001", name: "Conis Nikrobo", username: "conis", rank: "Handler", status: "Active - Case lead", location: "Victoria Station, Westminster", lat: 51.4952, lng: -0.1441, hours: 1, assignment: "Case lead, missing-board operations" },
  { id: "AG-002", name: "Agent Nano", username: "nano", rank: "Field agent", status: "Active - Interview", location: "Soho Square, West End", lat: 51.5152, lng: -0.1322, hours: 2, assignment: "Arcade canvassing, West End" },
  { id: "AG-003", name: "Agent Mega", username: "mega", rank: "Field agent", status: "Active - Surveillance", location: "Tate Modern, Bankside", lat: 51.5076, lng: -0.0994, hours: 3, assignment: "Surveillance, South Bank" },
];

export const DEMO_CITIZEN = { username: "citizen", name: "Demo Citizen" };

export const DEMO_PROFILES = [
  {
    id: "poi1", name: "The Armoured Stranger", alias: "POI-1", kind: "character", case_ref: "POI-1",
    origin: "Suspected: The Reckoning V: Origins (its Character class is missing)",
    description: "Seen at an arcade off Leicester Square posing as a cosplayer. Tampered with a Reckoning V cabinet, then left in a hurry when approached.",
    danger: "do_not_approach", hours: 30, location: "Leicester Square, West End", lat: 51.5103, lng: -0.1301,
    traits: [
      T("Pointed or sharp ears", 3, ["pointed ear", "pointy ear", "sharp ear", "sharp pointed ear", "elf", "elven", "elvish", "ears were pointed"]),
      T("Armour", 3, ["armour", "armor", "chainmail", "chain mail", "breastplate", "knight"]),
      T("Scabbard or sword", 3, ["scabbard", "sheath", "sword", "blade", "sabre", "saber"]),
      T("Leather gloves", 2, ["glove", "gauntlet"]),
      T("Thick or unusual accent", 2, ["accent", "archaic", "old-fashioned", "spoke strangely", "strange way of speaking"]),
      T("Bedazzled, jewelled outfit", 1, ["bedazzl", "sparkl", "jewel", "gem", "glitter", "shiny"]),
      T("Boots", 1, ["boot"]),
      T("Nervous or evasive", 1, ["stutter", "nervous", "flinch", "jumpy", "hurried", "ran off", "fled", "panick"]),
      T("Near arcades or electronics", 1, ["arcade", "game machine", "cabinet", "electronic", "spark", "flicker", "warbl", "reverberat"]),
    ],
  },
  {
    id: "vexa", name: "Vexa", alias: "The Neon Courier", kind: "character", case_ref: "INT-0412",
    origin: "Skyline Sprint (arcade racer)",
    description: "Courier character missing from an arcade cabinet. Moves at impossible speed and leaves a faint trail of light.",
    danger: "harmless", hours: 50, location: "Camden Market, Camden Town", lat: 51.5416, lng: -0.1464,
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
    id: "ferro", name: "Old Man Ferro", alias: "The Blacksmith", kind: "character", case_ref: "INT-0419",
    origin: "Ironhold Tales (fantasy RPG)",
    description: "Village blacksmith character missing from an RPG cabinet. Friendly but confused. Repeats the same few lines of dialogue to anyone nearby.",
    danger: "caution", hours: 70, location: "Greenwich Market, Greenwich", lat: 51.4811, lng: -0.0090,
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

// status "verified" / "dismissed" are triage decisions already taken; the rest wait for an agent
export const DEMO_SIGHTINGS = [
  { id: "demo1", subject: "profile", profile: "poi1", hours: 30, status: "verified", by: ["Agents Nano & Mega", "nano"], location: "Leicester Square, West End", lat: 51.5103, lng: -0.1301,
    text: "Male with sharp pointed ears, leather gloves and boots, and bedazzled armour with a scabbard at his waist. Thick accent, stuttering, flinched when approached. Fiddled with an arcade cabinet, then hurried out. The machine began warbling afterwards." },
  { id: "demo2", subject: "profile", profile: "vexa", hours: 2, by: ["Demo Citizen", "citizen"], location: "Jubilee Gardens, South Bank", lat: 51.5040, lng: -0.1187,
    text: "Someone in a glowing neon jacket on roller skates zoomed past me along the river, leaving a trail of light. Had a satchel over one shoulder." },
  { id: "demo3", subject: "profile", profile: "ferro", hours: 5, by: ["Anonymous", "citizen"], location: "Borough Market, Southwark", lat: 51.5055, lng: -0.0910,
    text: "Old man with a big grey beard and a leather apron carrying a hammer. He kept saying the same line to the stallholders and seemed confused by the card readers." },
  { id: "demo4", subject: "character", hours: 8, by: ["Demo Citizen", "citizen"], location: "Waterloo Station, Lambeth", lat: 51.5031, lng: -0.1132, character_name: "Unknown knight", game: null,
    text: "A pixelated figure with a shield teleported across the concourse. The lights flickered and the departure screens were full of static." },
  { id: "demo5", subject: "agent", hours: 12, by: ["Demo Citizen", "citizen"], location: "Trafalgar Square, Westminster", lat: 51.5080, lng: -0.1281, agent_name: "Agent Viper",
    text: "A man said he was a Sentinel agent called Viper, flashed a badge and asked about the arcade machines and the missing posters. He was taking notes." },
  { id: "demo6", subject: "profile", profile: "poi1", hours: 20, status: "dismissed", by: ["Demo Citizen", "citizen"], location: "Camden High Street, Camden Town", lat: 51.5390, lng: -0.1426,
    text: "Saw somebody carrying a sword outside a shop. Turned out they were heading to a comic convention, I think." },
];

export const DEMO_MESSAGES = [
  ["case", "mega", 29, "Back from the arcade. The \"cosplayer\" bolted the moment Nano asked what he was doing, and the cabinet started warbling right after. Report is filed."],
  ["case", "conis", 26, "The electricity supplier flagged a huge draw that same night. Energy readings and the recovered source still need running through forensics."],
  ["case", "nano", 7, "New one from Waterloo: lights flickering, figure teleporting. @mega can you get over there?", { urgent: true }],
  ["case", "mega", 6, "On my way once I've finished at the South Bank."],
  ["field", "mega", 3, "Holding on the South Bank. Possible Vexa sighting came in nearby, checking it now."],
  ["general", "conis", 24, "Welcome to Sentinel. Keep all case discussion in here, and check in on the tracker when you move.", { pinned: true }],
  ["sightings", "nano", 11, "Someone at Trafalgar Square met an \"Agent Viper\". We have no such agent. Treating it as impersonation."],
  ["dm-mega-nano", "nano", 4, "Coffee after Waterloo? I've got a theory about the cabinets."],
];
