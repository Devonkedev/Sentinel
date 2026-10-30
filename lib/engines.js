// Analysis engines: energy spikes, C++ code forensics, case correlation.
// Web-standard JS only, so it runs in Netlify Functions, Node, and the browser.

const median = arr => {
  const s = [...arr].sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const fmtInt = v => Math.round(v).toLocaleString("en-US");

export async function sha(text, len = 12) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, len);
}

// Treat date-only and date-time strings consistently (both as local wall-clock time)
export function parseDt(s) {
  if (!s) return null;
  const v = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s + "T00:00" : s.slice(0, 19);
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

// --------------------------------------------------------------------------- energy

export function analyzeEnergy(rows, hvacKw, hvacHours, harmonics, phaseImbalance) {
  const num = v => (v === null || v === undefined || v === "" ? null : Number(v));
  rows = [...rows].filter(r => r.date).sort((a, b) => a.date.localeCompare(b.date));
  const out = [], discrepancies = [];
  let prev = null;
  for (const r of rows) {
    const meter = num(r.meter), reported = num(r.usage);
    const delta = meter !== null && prev !== null ? round(meter - prev, 2) : null;
    const item = { date: r.date, meter, reported, meter_delta: delta, usage: delta ?? reported, discrepancy: null };
    if (delta !== null && reported !== null) {
      const gap = round(reported - delta, 2);
      if (Math.abs(gap) > Math.max(0.5, 0.02 * Math.max(Math.abs(delta), 1))) {
        item.discrepancy = gap;
        discrepancies.push({ date: r.date, reported, meter_delta: delta, gap });
      }
    }
    out.push(item);
    if (meter !== null) prev = meter;
  }
  const values = out.map(i => i.usage).filter(v => v !== null);
  if (values.length < 3) return { error: "Need at least 3 days of readings." };
  const med = median(values);
  const mad = median(values.map(v => Math.abs(v - med))) || 1e-9;
  const spikes = [];
  for (const i of out) {
    if (i.usage === null) continue;
    const z = (0.6745 * (i.usage - med)) / mad;
    i.z = round(z);
    i.ratio = med ? round(i.usage / med) : null;
    i.spike = z > 3.5 && i.usage > 2 * med;
    if (!i.spike) continue;
    const excess = i.usage - med;
    const hvacMax = hvacKw * hvacHours;
    const coverage = excess > 0 ? Math.min(100, (100 * hvacMax) / excess) : 100;
    let score = 0;
    const reasons = [];
    if (i.ratio >= 10) { score += 30; reasons.push(`Demand ${i.ratio}× baseline, far beyond any routine load change`); }
    else if (i.ratio >= 3) { score += 15; reasons.push(`Demand ${i.ratio}× baseline`); }
    if (coverage < 50) {
      score += 30;
      reasons.push(`A ${hvacKw} kW compressor running ${hvacHours} h explains at most ${Math.round(coverage)}% of the ${fmtInt(excess)} kWh excess`);
    } else {
      reasons.push(`HVAC at ${hvacKw} kW × ${hvacHours} h could explain ${Math.round(coverage)}% of the excess`);
    }
    if (harmonics) { score += 10; reasons.push("Elevated harmonics point to switching electronics (e.g. a cabinet PSU), not a motor load"); }
    if (phaseImbalance) { score += 5; reasons.push("No single phase carries the excursion, unlike a single-phase appliance fault"); }
    const verdict = score >= 50 ? "anomalous" : score >= 30 ? "suspicious" : "hvac_consistent";
    Object.assign(i, { excess_kwh: round(excess), hvac_coverage: round(coverage), anomaly_score: score, verdict, reasons });
    spikes.push(i);
  }
  return {
    rows: out, baseline_median: round(med, 2), mad: round(mad, 2), spikes, discrepancies,
    params: { hvac_kw: hvacKw, hvac_hours: hvacHours, harmonics, phase_imbalance: phaseImbalance },
  };
}

// --------------------------------------------------------------------------- line diff

export function unifiedDiff(aText, bText, aLabel, bLabel, ctx = 2) {
  const a = aText.split(/\r?\n/), b = bText.split(/\r?\n/);
  if (a.at(-1) === "") a.pop();
  if (b.at(-1) === "") b.pop();
  const n = a.length, m = b.length;
  // LCS table (suffix lengths)
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { ops.push({ t: " ", s: a[i], ai: i++, bi: j++ }); }
    else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) { ops.push({ t: "+", s: b[j], ai: i, bi: j++ }); }
    else { ops.push({ t: "-", s: a[i], ai: i++, bi: j }); }
  }
  const changes = ops.map((o, k) => (o.t !== " " ? k : -1)).filter(k => k >= 0);
  if (!changes.length) return [];
  const out = [`--- ${aLabel}`, `+++ ${bLabel}`];
  let k = 0;
  while (k < changes.length) {
    let start = Math.max(0, changes[k] - ctx), end = changes[k];
    while (k + 1 < changes.length && changes[k + 1] - end <= 2 * ctx) end = changes[++k];
    end = Math.min(ops.length - 1, end + ctx);
    k++;
    const hunk = ops.slice(start, end + 1);
    const aLen = hunk.filter(o => o.t !== "+").length, bLen = hunk.filter(o => o.t !== "-").length;
    const aStart = aLen ? hunk.find(o => o.t !== "+").ai + 1 : hunk[0].ai;
    const bStart = bLen ? hunk.find(o => o.t !== "-").bi + 1 : hunk[0].bi;
    out.push(`@@ -${aStart},${aLen} +${bStart},${bLen} @@`);
    for (const o of hunk) out.push(o.t + o.s);
  }
  return out;
}

// --------------------------------------------------------------------------- code forensics

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => "\n".repeat((m.match(/\n/g) || []).length))
    .replace(/\/\/[^\n]*/g, "")
    .replace(/"(\\.|[^"\\])*"/g, '""');
}

function matchBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return i;
  }
  return src.length - 1;
}

const KEYWORDS = new Set(["if", "for", "while", "switch", "return", "catch"]);

async function parseCpp(src) {
  const clean = stripComments(src);
  const classes = {}, spans = [];
  for (const m of clean.matchAll(/\b(class|struct)\s+(\w+)[^;{]*\{/g)) {
    const start = m.index;
    if (spans.some(([a, b]) => start >= a && start <= b)) continue;
    const end = matchBrace(clean, start + m[0].length - 1);
    const body = clean.slice(start, end + 1);
    const methods = [...new Set([...body.matchAll(/(~?\w+)\s*\([^;{}]*\)\s*(?:const)?\s*(?::[^{;]*)?\{/g)]
      .map(x => x[1]).filter(x => !KEYWORDS.has(x)))].sort();
    classes[m[2]] = { methods, hash: await sha(body.replace(/\s+/g, "")) };
    spans.push([start, end]);
  }
  const outside = [...clean].map((c, i) => (spans.some(([a, b]) => i >= a && i <= b) ? " " : c)).join("");
  const functions = {};
  for (const m of outside.matchAll(/\b(\w+)\s+(\w+)\s*\([^;{}]*\)\s*\{/g)) {
    if (KEYWORDS.has(m[2])) continue;
    const end = matchBrace(outside, m.index + m[0].length - 1);
    functions[m[2]] = await sha(outside.slice(m.index, end).replace(/\s+/g, ""));
  }
  const includes = [...clean.matchAll(/#include\s*[<"]([^>"]+)[>"]/g)].map(x => x[1]);
  const std = [...new Set([...clean.matchAll(/std::(\w+)/g)].map(x => x[1]))].sort();
  return { classes, functions, includes, std, clean };
}

const STD_HEADERS = {
  clamp: "algorithm", min: "algorithm", max: "algorithm", sort: "algorithm", find: "algorithm",
  cout: "iostream", cin: "iostream", vector: "vector", string: "string", map: "map",
};

export async function analyzeCode(original, altered, originalLabel, alteredLabel, capturedBefore, capturedAfter) {
  const a = await parseCpp(original), b = await parseCpp(altered);
  const keys = o => Object.keys(o);
  const removed = keys(a.classes).filter(n => !(n in b.classes)).sort();
  const added = keys(b.classes).filter(n => !(n in a.classes)).sort();
  const modified = keys(a.classes).filter(n => n in b.classes && a.classes[n].hash !== b.classes[n].hash).sort();
  const removedFns = keys(a.functions).filter(n => !(n in b.functions)).sort();
  const modifiedFns = keys(a.functions).filter(n => n in b.functions && a.functions[n] !== b.functions[n]).sort();

  const altLines = altered.split(/\r?\n/);
  const cleanLines = b.clean.split("\n");
  const dangling = [];
  for (const name of removed) {
    const re = new RegExp(`\\b${name}\\b`);
    const references = cleanLines.flatMap((l, i) => (re.test(l) ? [{ line: i + 1, code: (altLines[i] || "").trim() }] : []));
    if (references.length) dangling.push({ class: name, references, lost_methods: a.classes[name].methods });
  }
  const remaining = new Set(Object.values(b.classes).flatMap(c => c.methods));
  const unresolved = [...new Set([...b.clean.matchAll(/\w+\s*\.\s*(\w+)\s*\(/g)].map(x => x[1]))]
    .filter(x => !remaining.has(x)).sort();
  const orphaned = b.includes.flatMap(inc => {
    const before = a.std.filter(s => STD_HEADERS[s] === inc), after = b.std.filter(s => STD_HEADERS[s] === inc);
    return before.length && !after.length ? [{ include: inc, was_used_by: before }] : [];
  });

  const findings = [];
  for (const d of dangling) findings.push({
    severity: "critical", title: `class ${d.class} excised but still referenced`,
    detail: `${d.references.length} reference(s) remain in the altered build. The entity's definition (methods: ${d.lost_methods.join(", ")}) ` +
      `is gone while the world and game loop still expect it. A refactor would not leave the build uncompilable; ` +
      `this pattern is consistent with the entity being extracted from the program.`,
  });
  for (const name of removed) if (!dangling.some(d => d.class === name))
    findings.push({ severity: "high", title: `class ${name} removed`, detail: "Definition deleted with no remaining references." });
  if (unresolved.length) findings.push({
    severity: "high", title: "Unresolved member calls",
    detail: "Called but defined by no remaining class: " + unresolved.map(x => x + "()").join(", "),
  });
  for (const o of orphaned) findings.push({
    severity: "medium", title: `Orphaned #include <${o.include}>`,
    detail: `Only needed for std::${o.was_used_by.join(", std::")} in the removed code. The removal was surgical; nothing else was cleaned up.`,
  });
  for (const n of modified) findings.push({ severity: "medium", title: `class ${n} modified`, detail: "Body differs from baseline." });
  for (const n of modifiedFns) findings.push({ severity: "medium", title: `${n}() modified`, detail: "Body differs from baseline." });
  for (const n of removedFns) findings.push({ severity: "high", title: `${n}() removed`, detail: "Free function deleted." });
  for (const n of added) findings.push({ severity: "medium", title: `class ${n} added`, detail: "New type not in baseline." });

  const diff = unifiedDiff(original, altered, originalLabel, alteredLabel);
  const order = ["critical", "high", "medium", "low"];
  let severity;
  if (!diff.length) severity = "none";
  else if (!findings.length) {
    severity = "low";
    findings.push({ severity: "low", title: "Cosmetic changes only", detail: "Whitespace or comments differ; structure is identical." });
  } else severity = findings.map(f => f.severity).sort((x, y) => order.indexOf(x) - order.indexOf(y))[0];

  const methodMap = c => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.methods]));
  return {
    severity, findings, removed_classes: removed, added_classes: added, modified_classes: modified, dangling,
    unresolved_calls: unresolved, orphaned_includes: orphaned, diff,
    stats: {
      lines_before: original.replace(/\r?\n$/, "").split(/\r?\n/).length, lines_after: altered.replace(/\r?\n$/, "").split(/\r?\n/).length,
      removed: diff.filter(l => l.startsWith("-") && !l.startsWith("---")).length,
      added: diff.filter(l => l.startsWith("+") && !l.startsWith("+++")).length,
    },
    hash_before: await sha(original, 16), hash_after: await sha(altered, 16),
    classes_before: methodMap(a.classes), classes_after: methodMap(b.classes),
    captured_before: capturedBefore || null, captured_after: capturedAfter || null,
  };
}

// --------------------------------------------------------------------------- correlation

export function correlate({ energy, code, integrity, sightings }) {
  const evidence = [], timeline = [];
  let score = 0, spike = null;

  if (energy && energy.result.spikes.length) {
    spike = energy.result.spikes.reduce((x, y) => (y.usage > x.usage ? y : x));
    const w = Math.round(Math.min(45, spike.anomaly_score * 0.6));
    score += w;
    evidence.push({ weight: w, source: "Energy", text: `Spike on ${spike.date}: ${fmtInt(spike.usage)} kWh (${spike.ratio}× baseline); HVAC explains at most ${spike.hvac_coverage}%` });
    for (const s of energy.result.spikes) timeline.push({ time: s.date, source: "Energy", text: `${fmtInt(s.usage)} kWh, ${s.verdict.replace("_", " ")}` });
    for (const d of energy.result.discrepancies) timeline.push({ time: d.date, source: "Energy", text: `Reported ${d.reported} kWh vs meter delta ${d.meter_delta} kWh` });
    if (energy.result.discrepancies.length) {
      score += 5;
      evidence.push({ weight: 5, source: "Energy", text: `${energy.result.discrepancies.length} reported figure(s) disagree with the meter register; records may have been altered` });
    }
  } else evidence.push({ weight: 0, source: "Energy", text: "No spike analysis on file" });

  if (code && ["critical", "high"].includes(code.result.severity)) {
    const r = code.result;
    let w = r.severity === "critical" ? 25 : 15;
    const before = parseDt(r.captured_before), after = parseDt(r.captured_after);
    const inWindow = Boolean(spike && before && after && before <= parseDt(spike.date) && parseDt(spike.date) <= after);
    if (inWindow) w += 10;
    score += w;
    evidence.push({
      weight: w, source: "Code",
      text: `${r.severity.toUpperCase()} change: removed ${r.removed_classes.join(", ") || "n/a"}` +
        (inWindow ? `; alteration window ${r.captured_before} → ${r.captured_after} contains the spike` : ""),
    });
    timeline.push({ time: r.captured_after, source: "Code", text: `Altered build captured, ${r.removed_classes.join(", ") || "changes"} missing` });
  } else evidence.push({ weight: 0, source: "Code", text: "No critical code change on file" });

  const strong = sightings.filter(s => s.status !== "dismissed" && ((s.profile_id && s.match_level === "strong") || s.also_match));
  const near = spike ? strong.filter(s => {
    const t = parseDt(s.seen_at);
    return t && Math.abs(t - parseDt(spike.date)) <= 36 * 3600e3;
  }) : [];
  if (near.length) { score += 15; evidence.push({ weight: 15, source: "Sightings", text: `${near.length} strong missing-board match(es) within 36 h of the spike` }); }
  else if (strong.length) { score += 5; evidence.push({ weight: 5, source: "Sightings", text: `${strong.length} strong missing-board match(es) on file` }); }
  else evidence.push({ weight: 0, source: "Sightings", text: "No strong missing-board matches" });
  for (const s of strong) timeline.push({ time: s.seen_at, source: "Sighting", text: `${s.location}, match ${s.match_score}` });

  if (integrity) {
    timeline.push({ time: integrity.created.slice(0, 16), source: "Integrity", text: `${integrity.machine_id}: ${integrity.condition} (${integrity.score}/100)` });
    evidence.push({ weight: 0, source: "Integrity", text: `Latest inspection: ${integrity.condition}. Physical evidence alone is not causal` });
  }

  score = Math.min(100, Math.round(score));
  const verdict = score >= 70 ? "Malicious / extradigital event" : score >= 40 ? "Suspicious, investigate further" : "Likely benign (HVAC / routine load)";
  timeline.sort((x, y) => (parseDt(x.time) || 0) - (parseDt(y.time) || 0));
  return { score, verdict, evidence, timeline };
}
