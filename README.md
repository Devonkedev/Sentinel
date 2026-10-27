# EXUN Sentinel

Anomaly response platform for the Wenoti Arcade case (The Reckoning V: Origins, machine `MJWHKZLTNBUXE5A`).

- **Frontend:** static HTML/CSS/JS in `public/` (no build step)
- **Backend:** one Netlify Function (`netlify/functions/api.js`) serving `/api/*`
- **Storage:** Netlify Blobs (no database to set up)

## Deploy to Netlify

**Option A: Git (recommended)**
1. Push this folder to a GitHub/GitLab repo.
2. In Netlify: **Add new site → Import an existing project** → pick the repo.
   The settings are read from `netlify.toml`, so leave build command and publish directory as they are.
3. **Site configuration → Environment variables**, add:
   - `EXUN_SECRET`: a long random string that signs login sessions (**required**; otherwise a public default is used)
   - `EXUN_AGENCY_CODE`: optional, the code needed to register as an agent (default `EXUN-2026`)
4. Deploy. The first request seeds the demo accounts and case data into Blobs.

**Option B: CLI**
```
npm install
npx netlify login
npx netlify init          # create/link a site
npx netlify env:set EXUN_SECRET "$(openssl rand -hex 32)"
npx netlify deploy --prod
```

Netlify Drop (drag and drop) won't work, because it doesn't build functions.

## Run locally

Needs Node 20+.

```
node dev.js                # http://localhost:8888, data stored in ./data
# or, to emulate Netlify exactly:
npx netlify dev
```

Delete `./data` to reset the local case state.

## Demo accounts

| Role    | Username | Password    |
|---------|----------|-------------|
| Agent   | conis    | conis2026   |
| Agent   | mega     | mega2026    |
| Agent   | nano     | nano2026    |
| Citizen | citizen  | citizen2026 |

## Features

| Feature | Who | What it does |
|---|---|---|
| Public appeal + sign-in | Everyone | Landing page with the POI-1 description, live report counts and one-click demo logins. |
| Report a sighting | Citizens | Description scored live against the POI-1 profile as you type (traits light up). Pin on the map. Strong matches alert field agents. Reporter identity hidden from other citizens. |
| Sightings map | Everyone | Map plus filterable feed. Agents verify or dismiss reports. |
| Asset integrity (CV) | Everyone | In-browser computer vision on a casing photo: abrasions (edge density with an orientation filter), discolouration, and change against a reference photo. Includes sample photos. |
| Case dashboard | Agents | Correlation verdict (0–100), evidence breakdown, investigation checklist, live map, timeline, escalation with confirmation. |
| Energy spike detection | Agents | Robust z-score on meter-derived usage, HVAC plausibility test, and meter-vs-reported discrepancy detection, with a chart. |
| Code forensics | Agents | Structural C++ diff: removed classes still referenced, unresolved calls, orphaned includes, unified diff. Drag-and-drop files. |
| Alerts | Agents | Findings routed to the right authority by rule. Duplicates merged. Acknowledge and resolve. New critical alerts show as toasts. |
| Agent tracker | Agents | Positions, status and trails. Agents check in themselves; "Needs backup" raises a critical alert. |

Also included: light/dark theme, mobile drawer navigation, toasts, loading skeletons, empty states, and keyboard focus styles.

## Project layout

```
public/            static site (index.html, css/, js/, samples/)
  js/poi.js        POI-1 matcher, shared by browser and API
lib/api.js         API routes, auth (PBKDF2 + HMAC-signed tokens), alert routing
lib/engines.js     energy, code-forensics and correlation engines
netlify/functions/api.js   Netlify Function entry (Blobs storage)
dev.js             zero-dependency local server (file storage)
```
