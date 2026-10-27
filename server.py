#!/usr/bin/env python3
"""EXUN Sentinel - anomaly response platform for the Wenoti Arcade case.

Standard library only. Run:  python3 server.py   then open http://localhost:8000
"""
import difflib
import hashlib
import json
import os
import re
import secrets
import statistics
import threading
import time
import uuid
from datetime import datetime, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "static")
DATA_DIR = os.path.join(ROOT, "data")
DB_PATH = os.path.join(DATA_DIR, "db.json")
AGENCY_CODE = os.environ.get("EXUN_AGENCY_CODE", "EXUN-2026")
PORT = int(os.environ.get("PORT", "8000"))

LOCK = threading.Lock()

# Named places on the nuxEland map (0-100 grid, see static/app.js for the drawing)
PLACES = {
    "Wenoti Arcade, 92nd Ave": (63, 38),
    "etiNuxe Intelligence Agency HQ": (24, 22),
    "Department of Electricity": (57, 66),
    "Central Station": (48, 48),
    "Riverside Market": (78, 66),
    "Old Town Square": (20, 60),
    "92nd Ave Substation": (70, 30),
}


# --------------------------------------------------------------------------- storage

def now_iso():
    return datetime.now().replace(microsecond=0).isoformat()


def hash_pw(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120_000).hex()
    return salt, digest


def make_user(username, name, role, password, agent_id=None):
    salt, digest = hash_pw(password)
    return {"username": username, "name": name, "role": role, "salt": salt,
            "hash": digest, "agent_id": agent_id, "created": now_iso()}


def seed():
    db = {"users": {}, "sessions": {}, "sightings": [], "alerts": [], "agents": [],
          "energy_reports": [], "code_reports": [], "integrity_reports": []}
    agents = [
        ("AG-001", "Conis Nikrobo", "conis", "Handler", "Active - Case lead", "etiNuxe Intelligence Agency HQ"),
        ("AG-007", "Agent Nano", "nano", "Field agent", "Relocation pending", "Wenoti Arcade, 92nd Ave"),
        ("AG-008", "Agent Mega", "mega", "Field agent", "Active - Surveillance", "Wenoti Arcade, 92nd Ave"),
    ]
    for aid, name, uname, rank, status, place in agents:
        x, y = PLACES[place]
        db["users"][uname] = make_user(uname, name, "agent", uname + "2026", aid)
        db["agents"].append({
            "id": aid, "name": name, "username": uname, "rank": rank, "status": status,
            "location": place, "x": x, "y": y, "last_checkin": "2026-10-25T23:54:00",
            "assignment": "Wenoti Arcade / The Reckoning V: Origins (MJWHKZLTNBUXE5A)",
            "trail": [{"time": "2026-10-23T22:31:00", "location": "Wenoti Arcade, 92nd Ave", "x": 63, "y": 38,
                       "note": "Contact with POI-1"}] if uname != "conis" else [],
        })
    db["users"]["citizen"] = make_user("citizen", "Demo Citizen", "citizen", "citizen2026")

    s = new_sighting(
        "Male, wearing sharp pointed ears, leather gloves and boots, and bedazzled armour with a "
        "scabbard slung around his waist. Thick accent, stuttering, flinched when approached. "
        "Fiddled with The Reckoning V arcade machine, then looked at his bare wrist as if checking a "
        "watch and hurried out. Machine began warbling and reverberating afterwards.",
        "Wenoti Arcade, 92nd Ave", 63, 38, "2026-10-23T22:31", "Agents Nano & Mega (Transcript A)", "nano")
    s["status"] = "verified"
    s["case_ref"] = "POI-1"
    db["sightings"].append(s)
    return db


def load_db():
    if os.path.exists(DB_PATH):
        with open(DB_PATH) as f:
            return json.load(f)
    os.makedirs(DATA_DIR, exist_ok=True)
    db = seed()
    save_db(db)
    return db


def save_db(db):
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = DB_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(db, f, indent=1)
    os.replace(tmp, DB_PATH)



# --------------------------------------------------------------------------- alerts

ROUTES = {
    "code_critical": ["EIA Command", "EXUN Operations", "Cyber Forensics Unit", "National Defence Liaison"],
    "code_high": ["EXUN Operations", "Cyber Forensics Unit"],
    "code_medium": ["Cyber Forensics Unit", "Machine Vendor"],
    "energy_anomaly": ["EXUN Operations", "Department of Electricity"],
    "energy_hvac": ["Facility Owner (Wenoti Arcade)"],
    "meter_discrepancy": ["Department of Electricity"],
    "sighting_strong": ["EXUN Field Agents", "EXUN Operations"],
    "sighting_possible": ["EXUN Operations (triage)"],
    "integrity_severe": ["EXUN Operations", "Facility Owner (Wenoti Arcade)", "Machine Vendor"],
    "integrity_moderate": ["Facility Owner (Wenoti Arcade)"],
    "correlation_malicious": ["EIA Command", "EXUN Operations", "National Defence Liaison",
                              "Department of Electricity"],
}


def raise_alert(db, route, severity, source, title, body, ref=None):
    alert = {"id": uuid.uuid4().hex[:10], "time": now_iso(), "severity": severity, "source": source,
             "title": title, "body": body, "recipients": ROUTES[route], "route": route,
             "ref": ref, "status": "open"}
    db["alerts"].insert(0, alert)
    return alert


# --------------------------------------------------------------------------- sightings

POI_TRAITS = [
    ("Pointed / sharp ears", 20, r"\b(pointy|pointed|sharp|elf(in|ish)?|long)\b[\w\s,]{0,20}\bears?\b|\bears?\b[\w\s]{0,12}\b(pointy|pointed|sharp)\b|\belf"),
    ("Armour", 18, r"armou?r|chain ?mail|breastplate|plate mail|knight"),
    ("Embellished / bedazzled outfit", 4, r"bedazzl|sparkl|jewel|gems?\b|glitter|shiny"),
    ("Scabbard or sword", 15, r"scabbard|sheath|sword|blade|sabre|saber"),
    ("Leather gloves / gauntlets", 9, r"gloves?|gauntlets?"),
    ("Boots", 7, r"\bboots?\b"),
    ("Thick or unusual accent", 9, r"accent|archaic|old[- ]fashioned (speech|english)|strange(ly)? (way of )?(speak|talk)"),
    ("Nervous behaviour", 6, r"stutter|nervous|flinch|jumpy|hurried|ran off|fled|panick"),
    ("Unfamiliar with modern life", 7, r"bare wrist|no watch|wrist|confused by|didn.?t know (what|how)|never seen a"),
    ("Around arcade machines / electronics", 5, r"arcade|game machine|cabinet|screen|electronic|spark|flicker|warbl|reverberat|power (cut|surge)"),
]


def match_poi(description, x, y):
    text = description.lower()
    matched, score = [], 0
    for label, weight, pattern in POI_TRAITS:
        if re.search(pattern, text):
            matched.append(label)
            score += weight
    # Proximity to the arcade adds a little weight (within ~15 map units)
    ax, ay = PLACES["Wenoti Arcade, 92nd Ave"]
    dist = ((x - ax) ** 2 + (y - ay) ** 2) ** 0.5 if x is not None and y is not None else 999
    if dist < 15:
        score += 5
        matched.append("Near Wenoti Arcade")
    score = min(score, 100)
    level = "strong" if score >= 60 else "possible" if score >= 35 else "low"
    return score, level, matched


def new_sighting(description, location, x, y, seen_at, reporter_name, reporter):
    score, level, traits = match_poi(description, x, y)
    return {"id": uuid.uuid4().hex[:10], "created": now_iso(), "seen_at": seen_at, "description": description,
            "location": location, "x": x, "y": y, "reporter": reporter, "reporter_name": reporter_name,
            "match_score": score, "match_level": level, "traits": traits, "status": "new", "case_ref": None}


# --------------------------------------------------------------------------- energy

def analyze_energy(rows, hvac_kw, hvac_hours, harmonics, phase_imbalance):
    rows = sorted(rows, key=lambda r: r["date"])
    out = []
    discrepancies = []
    prev = None
    for r in rows:
        meter = float(r["meter"]) if r.get("meter") not in (None, "") else None
        reported = float(r["usage"]) if r.get("usage") not in (None, "") else None
        delta = round(meter - prev, 2) if meter is not None and prev is not None else None
        trusted = delta if delta is not None else reported
        item = {"date": r["date"], "meter": meter, "reported": reported, "meter_delta": delta, "usage": trusted,
                "discrepancy": None}
        if delta is not None and reported is not None:
            gap = round(reported - delta, 2)
            if abs(gap) > max(0.5, 0.02 * max(abs(delta), 1)):
                item["discrepancy"] = gap
                discrepancies.append({"date": r["date"], "reported": reported, "meter_delta": delta, "gap": gap})
        out.append(item)
        prev = meter if meter is not None else prev

    values = [i["usage"] for i in out if i["usage"] is not None]
    if len(values) < 3:
        return {"error": "Need at least 3 days of readings."}
    median = statistics.median(values)
    mad = statistics.median([abs(v - median) for v in values]) or 1e-9
    spikes = []
    for i in out:
        if i["usage"] is None:
            continue
        z = 0.6745 * (i["usage"] - median) / mad
        i["z"] = round(z, 1)
        i["ratio"] = round(i["usage"] / median, 1) if median else None
        i["spike"] = z > 3.5 and i["usage"] > 2 * median
        if i["spike"]:
            excess = i["usage"] - median
            hvac_max = hvac_kw * hvac_hours
            coverage = min(100.0, 100.0 * hvac_max / excess) if excess > 0 else 100.0
            score = 0
            reasons = []
            if i["ratio"] >= 10:
                score += 30
                reasons.append(f"Demand {i['ratio']}x baseline - far beyond any routine load change")
            elif i["ratio"] >= 3:
                score += 15
                reasons.append(f"Demand {i['ratio']}x baseline")
            if coverage < 50:
                score += 30
                reasons.append(f"A {hvac_kw:g} kW compressor running {hvac_hours:g} h explains at most "
                               f"{coverage:.0f}% of the {excess:,.0f} kWh excess")
            else:
                reasons.append(f"HVAC at {hvac_kw:g} kW x {hvac_hours:g} h could explain {coverage:.0f}% of the excess")
            if harmonics:
                score += 10
                reasons.append("Elevated harmonics point to switching electronics (e.g. a cabinet PSU), not a motor load")
            if phase_imbalance:
                score += 5
                reasons.append("No single phase carries the excursion - unlike a single-phase appliance fault")
            verdict = "anomalous" if score >= 50 else "suspicious" if score >= 30 else "hvac_consistent"
            i.update({"excess_kwh": round(excess, 1), "hvac_coverage": round(coverage, 1),
                      "anomaly_score": score, "verdict": verdict, "reasons": reasons})
            spikes.append(i)
    return {"rows": out, "baseline_median": round(median, 2), "mad": round(mad, 2), "spikes": spikes,
            "discrepancies": discrepancies,
            "params": {"hvac_kw": hvac_kw, "hvac_hours": hvac_hours, "harmonics": harmonics,
                       "phase_imbalance": phase_imbalance}}


# --------------------------------------------------------------------------- code forensics

def strip_comments(src):
    src = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), src, flags=re.S)
    src = re.sub(r"//[^\n]*", "", src)
    return re.sub(r'"(\\.|[^"\\])*"', '""', src)


def match_brace(src, open_idx):
    depth = 0
    for i in range(open_idx, len(src)):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return i
    return len(src) - 1


def parse_cpp(src):
    clean = strip_comments(src)
    classes, spans = {}, []
    for m in re.finditer(r"\b(class|struct)\s+(\w+)[^;{]*\{", clean):
        start = m.start()
        if any(a <= start <= b for a, b in spans):
            continue
        end = match_brace(clean, m.end() - 1)
        body = clean[m.start():end + 1]
        methods = sorted(set(n for n in re.findall(r"(~?\w+)\s*\([^;{}]*\)\s*(?:const)?\s*(?::[^{;]*)?\{", body)
                             if n not in ("if", "for", "while", "switch", "return")))
        classes[m.group(2)] = {"kind": m.group(1), "methods": methods,
                               "line": clean[:start].count("\n") + 1,
                               "hash": hashlib.sha256(re.sub(r"\s+", "", body).encode()).hexdigest()[:12],
                               "body": body}
        spans.append((start, end))
    outside = "".join(c if not any(a <= i <= b for a, b in spans) else " " for i, c in enumerate(clean))
    functions = {}
    for m in re.finditer(r"\b(\w+)\s+(\w+)\s*\([^;{}]*\)\s*\{", outside):
        end = match_brace(outside, m.end() - 1)
        functions[m.group(2)] = hashlib.sha256(re.sub(r"\s+", "", outside[m.start():end]).encode()).hexdigest()[:12]
    includes = re.findall(r"#include\s*[<\"]([^>\"]+)[>\"]", clean)
    std_used = sorted(set(re.findall(r"std::(\w+)", clean)))
    return {"classes": classes, "functions": functions, "includes": includes, "std": std_used, "clean": clean}


STD_HEADERS = {"clamp": "algorithm", "min": "algorithm", "max": "algorithm", "sort": "algorithm",
               "find": "algorithm", "cout": "iostream", "cin": "iostream", "vector": "vector",
               "string": "string", "map": "map"}


def analyze_code(original, altered, original_label, altered_label, captured_before, captured_after):
    a, b = parse_cpp(original), parse_cpp(altered)
    removed = sorted(set(a["classes"]) - set(b["classes"]))
    added = sorted(set(b["classes"]) - set(a["classes"]))
    modified = sorted(n for n in set(a["classes"]) & set(b["classes"])
                      if a["classes"][n]["hash"] != b["classes"][n]["hash"])
    removed_fns = sorted(set(a["functions"]) - set(b["functions"]))
    modified_fns = sorted(n for n in set(a["functions"]) & set(b["functions"])
                          if a["functions"][n] != b["functions"][n])

    alt_lines = altered.splitlines()
    dangling = []
    for name in removed:
        hits = [{"line": i + 1, "code": alt_lines[i].strip()}
                for i, line in enumerate(b["clean"].splitlines()) if re.search(r"\b%s\b" % re.escape(name), line)]
        if hits:
            dangling.append({"class": name, "references": hits,
                             "lost_methods": a["classes"][name]["methods"]})

    remaining_methods = set(m for c in b["classes"].values() for m in c["methods"])
    unresolved = sorted(set(m for m in re.findall(r"\w+\s*\.\s*(\w+)\s*\(", b["clean"])) - remaining_methods)

    orphaned_includes = []
    for inc in b["includes"]:
        needed_before = [s for s in a["std"] if STD_HEADERS.get(s) == inc]
        needed_after = [s for s in b["std"] if STD_HEADERS.get(s) == inc]
        if needed_before and not needed_after:
            orphaned_includes.append({"include": inc, "was_used_by": needed_before})

    findings = []
    for d in dangling:
        findings.append({"severity": "critical", "title": f"class {d['class']} excised but still referenced",
                         "detail": f"{len(d['references'])} reference(s) remain in the altered build. The entity's "
                                   f"definition (methods: {', '.join(d['lost_methods'])}) is gone while the world and "
                                   f"game loop still expect it. A refactor would not leave the build uncompilable - "
                                   f"this pattern is consistent with the entity being extracted from the program."})
    for name in removed:
        if name not in [d["class"] for d in dangling]:
            findings.append({"severity": "high", "title": f"class {name} removed",
                             "detail": "Definition deleted with no remaining references."})
    if unresolved:
        findings.append({"severity": "high", "title": "Unresolved member calls",
                         "detail": "Called but defined by no remaining class: " + ", ".join(m + "()" for m in unresolved)})
    for o in orphaned_includes:
        findings.append({"severity": "medium", "title": f"Orphaned #include <{o['include']}>",
                         "detail": f"Only needed for std::{', std::'.join(o['was_used_by'])} in the removed code. "
                                   f"The removal was surgical - nothing else was cleaned up."})
    for name in modified:
        findings.append({"severity": "medium", "title": f"class {name} modified", "detail": "Body differs from baseline."})
    for name in modified_fns:
        findings.append({"severity": "medium", "title": f"{name}() modified", "detail": "Body differs from baseline."})
    for name in removed_fns:
        findings.append({"severity": "high", "title": f"{name}() removed", "detail": "Free function deleted."})
    for name in added:
        findings.append({"severity": "medium", "title": f"class {name} added", "detail": "New type not in baseline."})

    diff = list(difflib.unified_diff(original.splitlines(), altered.splitlines(),
                                     original_label, altered_label, lineterm="", n=2))
    if not diff:
        severity = "none"
    elif not findings:
        severity = "low"
        findings.append({"severity": "low", "title": "Cosmetic changes only",
                         "detail": "Whitespace or comments differ; structure is identical."})
    else:
        order = ["critical", "high", "medium", "low"]
        severity = min((f["severity"] for f in findings), key=order.index)

    return {"severity": severity, "findings": findings, "removed_classes": removed, "added_classes": added,
            "modified_classes": modified, "dangling": dangling, "unresolved_calls": unresolved,
            "orphaned_includes": orphaned_includes, "diff": diff,
            "stats": {"lines_before": len(original.splitlines()), "lines_after": len(alt_lines),
                      "removed": sum(1 for l in diff if l.startswith("-") and not l.startswith("---")),
                      "added": sum(1 for l in diff if l.startswith("+") and not l.startswith("+++"))},
            "hash_before": hashlib.sha256(original.encode()).hexdigest()[:16],
            "hash_after": hashlib.sha256(altered.encode()).hexdigest()[:16],
            "classes_before": {k: v["methods"] for k, v in a["classes"].items()},
            "classes_after": {k: v["methods"] for k, v in b["classes"].items()},
            "captured_before": captured_before, "captured_after": captured_after}


# --------------------------------------------------------------------------- correlation

def parse_dt(s):
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(s[:19], fmt)
        except (ValueError, TypeError):
            continue
    return None


def correlate(db):
    energy = db["energy_reports"][0] if db["energy_reports"] else None
    code = db["code_reports"][0] if db["code_reports"] else None
    integrity = db["integrity_reports"][0] if db["integrity_reports"] else None
    evidence, score, timeline = [], 0, []

    spike = None
    if energy and energy["result"]["spikes"]:
        spike = max(energy["result"]["spikes"], key=lambda s: s["usage"])
        score += min(45, spike["anomaly_score"] * 0.6)
        evidence.append({"weight": round(min(45, spike["anomaly_score"] * 0.6)), "source": "Energy",
                         "text": f"Spike on {spike['date']}: {spike['usage']:,} kWh ({spike['ratio']}x baseline); "
                                 f"HVAC explains at most {spike['hvac_coverage']}%"})
        for s in energy["result"]["spikes"]:
            timeline.append({"time": s["date"], "source": "Energy", "text": f"{s['usage']:,} kWh - {s['verdict'].replace('_', ' ')}"})
        for d in energy["result"]["discrepancies"]:
            timeline.append({"time": d["date"], "source": "Energy",
                             "text": f"Reported {d['reported']} kWh vs meter delta {d['meter_delta']} kWh"})
        if energy["result"]["discrepancies"]:
            score += 5
            evidence.append({"weight": 5, "source": "Energy",
                             "text": f"{len(energy['result']['discrepancies'])} reported figure(s) disagree with the meter register - records may have been altered"})
    else:
        evidence.append({"weight": 0, "source": "Energy", "text": "No spike analysis on file"})

    if code and code["result"]["severity"] in ("critical", "high"):
        r = code["result"]
        w = 25 if r["severity"] == "critical" else 15
        before, after = parse_dt(r["captured_before"] or ""), parse_dt(r["captured_after"] or "")
        in_window = bool(spike and before and after and before <= parse_dt(spike["date"]) <= after)
        if in_window:
            w += 10
        score += w
        evidence.append({"weight": w, "source": "Code",
                         "text": f"{r['severity'].upper()} change: removed {', '.join(r['removed_classes']) or 'n/a'}"
                                 + (f"; alteration window {r['captured_before']} -> {r['captured_after']} contains the spike"
                                    if in_window else "")})
        timeline.append({"time": r["captured_after"], "source": "Code",
                         "text": f"Altered build captured - {', '.join(r['removed_classes']) or 'changes'} missing"})
    else:
        evidence.append({"weight": 0, "source": "Code", "text": "No critical code change on file"})

    strong = [s for s in db["sightings"] if s["match_level"] == "strong" and s["status"] != "dismissed"]
    near = []
    if spike:
        sd = parse_dt(spike["date"])
        near = [s for s in strong if parse_dt(s["seen_at"]) and abs(parse_dt(s["seen_at"]) - sd) <= timedelta(days=1, hours=12)]
    if near:
        score += 15
        evidence.append({"weight": 15, "source": "Sightings",
                         "text": f"{len(near)} strong POI match(es) within 36 h of the spike"})
    elif strong:
        score += 5
        evidence.append({"weight": 5, "source": "Sightings", "text": f"{len(strong)} strong POI match(es) on file"})
    for s in strong:
        timeline.append({"time": s["seen_at"], "source": "Sighting", "text": f"{s['location']} - match {s['match_score']}"})

    if integrity:
        timeline.append({"time": integrity["created"][:16], "source": "Integrity",
                         "text": f"{integrity['machine_id']}: condition {integrity['condition']} ({integrity['score']}/100)"})
        evidence.append({"weight": 0, "source": "Integrity",
                         "text": f"Latest inspection: {integrity['condition']} - physical evidence alone is not causal"})

    score = int(min(100, score))
    verdict = ("Malicious / extradigital event" if score >= 70 else
               "Suspicious - investigate further" if score >= 40 else "Likely benign (HVAC / routine load)")
    timeline.sort(key=lambda t: t["time"] or "")
    return {"score": score, "verdict": verdict, "evidence": evidence, "timeline": timeline}


# --------------------------------------------------------------------------- HTTP

DB = load_db()


def public_user(u):
    return {"username": u["username"], "name": u["name"], "role": u["role"], "agent_id": u.get("agent_id")}


def public_sighting(s, viewer):
    if viewer["role"] == "agent" or s["reporter"] == viewer["username"]:
        return s
    hidden = dict(s)
    hidden["reporter_name"] = "Citizen report"
    hidden["reporter"] = None
    return hidden


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC, **kwargs)

    def log_message(self, fmt, *args):
        pass

    def send_json(self, data, code=200):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}") if n else {}

    def user(self):
        token = (self.headers.get("Authorization") or "").replace("Bearer ", "")
        uname = DB["sessions"].get(token)
        return DB["users"].get(uname) if uname else None

    def do_GET(self):
        path = urlparse(self.path).path
        if not path.startswith("/api/"):
            return super().do_GET()
        u = self.user()
        if path == "/api/places":
            return self.send_json(PLACES)
        if not u:
            return self.send_json({"error": "Not signed in"}, 401)
        with LOCK:
            if path == "/api/me":
                return self.send_json(public_user(u))
            if path == "/api/sightings":
                return self.send_json([public_sighting(s, u) for s in DB["sightings"]])
            if path == "/api/integrity":
                items = DB["integrity_reports"] if u["role"] == "agent" else \
                    [r for r in DB["integrity_reports"] if r["by"] == u["username"]]
                return self.send_json(items)
            if u["role"] != "agent":
                return self.send_json({"error": "Agents only"}, 403)
            if path == "/api/agents":
                return self.send_json(DB["agents"])
            if path == "/api/alerts":
                return self.send_json(DB["alerts"])
            if path == "/api/energy":
                return self.send_json(DB["energy_reports"][:10])
            if path == "/api/code":
                return self.send_json(DB["code_reports"][:10])
            if path == "/api/correlate":
                return self.send_json(correlate(DB))
        self.send_json({"error": "Not found"}, 404)

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            data = self.body()
        except ValueError:
            return self.send_json({"error": "Invalid JSON"}, 400)
        with LOCK:
            if path == "/api/login":
                u = DB["users"].get((data.get("username") or "").strip().lower())
                if not u or hash_pw(data.get("password", ""), u["salt"])[1] != u["hash"]:
                    return self.send_json({"error": "Invalid username or password"}, 401)
                token = secrets.token_urlsafe(24)
                DB["sessions"][token] = u["username"]
                save_db(DB)
                return self.send_json({"token": token, "user": public_user(u)})
            if path == "/api/register":
                uname = (data.get("username") or "").strip().lower()
                if not re.fullmatch(r"[a-z0-9_]{3,20}", uname):
                    return self.send_json({"error": "Username: 3-20 letters, digits or _"}, 400)
                if uname in DB["users"]:
                    return self.send_json({"error": "Username taken"}, 400)
                if len(data.get("password", "")) < 6:
                    return self.send_json({"error": "Password must be at least 6 characters"}, 400)
                role = "agent" if data.get("role") == "agent" else "citizen"
                if role == "agent" and data.get("agency_code") != AGENCY_CODE:
                    return self.send_json({"error": "Invalid agency authorisation code"}, 403)
                name = (data.get("name") or uname).strip()[:60]
                aid = None
                if role == "agent":
                    aid = "AG-%03d" % (len(DB["agents"]) + 10)
                    x, y = PLACES["etiNuxe Intelligence Agency HQ"]
                    DB["agents"].append({"id": aid, "name": name, "username": uname, "rank": "Field agent",
                                         "status": "Active", "location": "etiNuxe Intelligence Agency HQ", "x": x,
                                         "y": y, "last_checkin": now_iso(), "assignment": "Unassigned", "trail": []})
                DB["users"][uname] = make_user(uname, name, role, data["password"], aid)
                token = secrets.token_urlsafe(24)
                DB["sessions"][token] = uname
                save_db(DB)
                return self.send_json({"token": token, "user": public_user(DB["users"][uname])})

            u = self.user()
            if not u:
                return self.send_json({"error": "Not signed in"}, 401)

            if path == "/api/logout":
                token = (self.headers.get("Authorization") or "").replace("Bearer ", "")
                DB["sessions"].pop(token, None)
                save_db(DB)
                return self.send_json({"ok": True})

            if path == "/api/sightings":
                desc = (data.get("description") or "").strip()
                if len(desc) < 10:
                    return self.send_json({"error": "Please describe what you saw (10+ characters)"}, 400)
                x, y = data.get("x"), data.get("y")
                s = new_sighting(desc[:2000], (data.get("location") or "Unspecified")[:80], x, y,
                                 data.get("seen_at") or now_iso()[:16],
                                 "Anonymous" if data.get("anonymous") else u["name"], u["username"])
                DB["sightings"].insert(0, s)
                if s["match_level"] == "strong":
                    raise_alert(DB, "sighting_strong", "high", "Sightings",
                                f"Strong POI-1 match ({s['match_score']}) at {s['location']}",
                                "Traits: " + ", ".join(s["traits"]), s["id"])
                elif s["match_level"] == "possible":
                    raise_alert(DB, "sighting_possible", "medium", "Sightings",
                                f"Possible POI-1 match ({s['match_score']}) at {s['location']}",
                                "Traits: " + ", ".join(s["traits"]), s["id"])
                save_db(DB)
                return self.send_json(public_sighting(s, u))

            if path == "/api/integrity":
                score = max(0, min(100, int(data.get("score", 0))))
                condition = "severe" if score >= 60 else "moderate" if score >= 30 else "minor"
                r = {"id": uuid.uuid4().hex[:10], "created": now_iso(), "by": u["username"], "by_name": u["name"],
                     "machine_id": (data.get("machine_id") or "UNKNOWN")[:40], "score": score, "condition": condition,
                     "metrics": data.get("metrics", {}), "findings": data.get("findings", [])[:20],
                     "thumbnail": (data.get("thumbnail") or "")[:400_000], "notes": (data.get("notes") or "")[:1000]}
                DB["integrity_reports"].insert(0, r)
                if condition == "severe":
                    raise_alert(DB, "integrity_severe", "high", "Asset integrity",
                                f"Severe surface damage on {r['machine_id']} ({score}/100)",
                                "; ".join(f["text"] for f in r["findings"][:4]), r["id"])
                elif condition == "moderate":
                    raise_alert(DB, "integrity_moderate", "low", "Asset integrity",
                                f"Moderate wear on {r['machine_id']} ({score}/100)",
                                "; ".join(f["text"] for f in r["findings"][:4]), r["id"])
                save_db(DB)
                return self.send_json(r)

            if u["role"] != "agent":
                return self.send_json({"error": "Agents only"}, 403)

            if path == "/api/energy/analyze":
                result = analyze_energy(data.get("rows", []), float(data.get("hvac_kw", 15)),
                                        float(data.get("hvac_hours", 24)), bool(data.get("harmonics")),
                                        bool(data.get("phase_imbalance")))
                if "error" in result:
                    return self.send_json(result, 400)
                rep = {"id": uuid.uuid4().hex[:10], "created": now_iso(), "by": u["name"], "result": result}
                DB["energy_reports"].insert(0, rep)
                for s in result["spikes"]:
                    if s["verdict"] == "hvac_consistent":
                        raise_alert(DB, "energy_hvac", "low", "Energy", f"Load spike {s['date']} consistent with HVAC",
                                    "; ".join(s["reasons"]), rep["id"])
                    else:
                        raise_alert(DB, "energy_anomaly", "critical" if s["verdict"] == "anomalous" else "high",
                                    "Energy", f"{s['verdict'].title()} demand spike on {s['date']}: {s['usage']:,} kWh",
                                    "; ".join(s["reasons"]), rep["id"])
                if result["discrepancies"]:
                    raise_alert(DB, "meter_discrepancy", "high", "Energy",
                                f"{len(result['discrepancies'])} meter discrepancy(ies) - referred for verification",
                                "; ".join(f"{d['date']}: reported {d['reported']} kWh, meter shows {d['meter_delta']} kWh"
                                          for d in result["discrepancies"]), rep["id"])
                save_db(DB)
                return self.send_json(rep)

            if path == "/api/code/analyze":
                result = analyze_code(data.get("original", ""), data.get("altered", ""),
                                      data.get("original_label") or "original", data.get("altered_label") or "altered",
                                      data.get("captured_before"), data.get("captured_after"))
                rep = {"id": uuid.uuid4().hex[:10], "created": now_iso(), "by": u["name"],
                       "machine_id": data.get("machine_id") or "MJWHKZLTNBUXE5A", "result": result}
                DB["code_reports"].insert(0, rep)
                sev = result["severity"]
                if sev in ("critical", "high", "medium"):
                    top = result["findings"][0]
                    raise_alert(DB, "code_" + sev, sev, "Code forensics",
                                f"{sev.upper()}: {top['title']} on {rep['machine_id']}", top["detail"], rep["id"])
                save_db(DB)
                return self.send_json(rep)

            if path == "/api/correlate/escalate":
                c = correlate(DB)
                route = "correlation_malicious" if c["score"] >= 70 else "energy_anomaly"
                a = raise_alert(DB, route, "critical" if c["score"] >= 70 else "high", "Correlation engine",
                                f"Case verdict: {c['verdict']} ({c['score']}/100)",
                                " | ".join(e["text"] for e in c["evidence"] if e["weight"]))
                save_db(DB)
                return self.send_json(a)

            if path == "/api/agents/checkin":
                agent = next((a for a in DB["agents"] if a["username"] == u["username"]), None)
                if not agent:
                    return self.send_json({"error": "No agent profile"}, 404)
                loc = data.get("location") or agent["location"]
                x, y = data.get("x", agent["x"]), data.get("y", agent["y"])
                agent["trail"].insert(0, {"time": now_iso(), "location": loc, "x": x, "y": y,
                                          "note": (data.get("note") or "")[:200]})
                agent["trail"] = agent["trail"][:20]
                agent.update({"location": loc, "x": x, "y": y, "last_checkin": now_iso(),
                              "status": (data.get("status") or agent["status"])[:40]})
                save_db(DB)
                return self.send_json(agent)

            m = re.fullmatch(r"/api/alerts/(\w+)/(ack|resolve)", path)
            if m:
                a = next((a for a in DB["alerts"] if a["id"] == m.group(1)), None)
                if not a:
                    return self.send_json({"error": "Not found"}, 404)
                a["status"] = "acknowledged" if m.group(2) == "ack" else "resolved"
                a["handled_by"] = u["name"]
                save_db(DB)
                return self.send_json(a)

            m = re.fullmatch(r"/api/sightings/(\w+)/(verify|dismiss)", path)
            if m:
                s = next((s for s in DB["sightings"] if s["id"] == m.group(1)), None)
                if not s:
                    return self.send_json({"error": "Not found"}, 404)
                s["status"] = "verified" if m.group(2) == "verify" else "dismissed"
                save_db(DB)
                return self.send_json(s)

        self.send_json({"error": "Not found"}, 404)


if __name__ == "__main__":
    print(f"EXUN Sentinel running on http://localhost:{PORT}")
    print("Demo logins  agent: conis / conis2026   citizen: citizen / citizen2026")
    ThreadingHTTPServer(("", PORT), Handler).serve_forever()
