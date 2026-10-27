# EXUN Sentinel

Anomaly response platform for the Wenoti Arcade case (The Reckoning V: Origins, machine `MJWHKZLTNBUXE5A`).
Python standard library + vanilla JS. No installs needed.

```
python3 server.py        # then open http://localhost:8000
```

Delete `data/` to reset to the seeded case state.

## Accounts

| Role    | Username | Password      |
|---------|----------|---------------|
| Agent   | conis    | conis2026     |
| Agent   | mega     | mega2026      |
| Agent   | nano     | nano2026      |
| Citizen | citizen  | citizen2026   |

Anyone can register as a citizen. Agent registration needs the agency code `EXUN-2026` (env `EXUN_AGENCY_CODE`).

## Features

| Feature | Who | What it does |
|---|---|---|
| Code forensics | Agents | Structural C++ diff: removed/added/modified classes and functions, dangling references to removed types, unresolved member calls, orphaned `#include`s. Severity picks who is alerted. |
| Energy spike detection | Agents | Recomputes daily usage from the meter register, finds outliers by robust z-score (median/MAD), flags reported figures that disagree with the meter, and tests whether an HVAC compressor could explain the excess. |
| Correlation engine | Agents | Combines the spike, the code change window, POI sightings near the spike and physical inspections into one verdict (HVAC/benign → suspicious → malicious/extradigital), with a timeline. One-click escalation. |
| Alerts | Agents | Every finding is routed by rule: e.g. a critical code change goes to EIA Command, Cyber Forensics and Defence Liaison; meter discrepancies go to the Department of Electricity. |
| Agent tracker | Agents | Map plus roster of agent status and last check-in, with trails. Agents check in themselves. |
| Sightings | Everyone | Citizens describe who they saw and drop a pin. Each report is scored against the POI-1 profile from Transcript A; strong matches alert field agents. Citizens never see reporter identities. |
| Asset integrity (CV) | Everyone | In-browser computer vision on a casing photo: Sobel edge density with an orientation filter (scratches vs. grilles and seams), warm/dark tile analysis (discolouration) and an optional reference-photo diff. Includes a synthetic sample, since the report photos are redacted. |

## Case findings it reproduces

- `class Character` is missing from the recovered build while `World::render` and `Game` still use it (CRITICAL).
  `<algorithm>` is left orphaned: only `std::clamp` in `Character::move` needed it.
- Oct 23: 2,684 kWh against a ~27.9 kWh/day baseline (96×). A 15 kW compressor running for 24 h explains at most ~14%.
- Oct 24: 503.2 kWh was reported, but the meter rose only 30.7 kWh. Referred to the Department of Electricity.
