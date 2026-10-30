<img src="public/brand/logo.svg" alt="Sentinel" width="320">

Public missing board and agent case console. It starts empty: every poster, report, alert and verdict comes from what people actually file.

- **Frontend:** static HTML/CSS/JS in `public/` (no build step)
- **Backend:** one Netlify Function (`netlify/functions/api.js`) serving `/api/*`
- **Storage:** Netlify Blobs (no database to set up)

## First run

There are no preset accounts. Create an agent account (agency code from `SENTINEL_AGENCY_CODE`; if that isn't set, the code `SENTINEL-2026` is shown on the sign-up form), publish a poster on the missing board, then create a citizen account in a second browser and report a sighting. The agent's console updates within about 8 seconds.

The energy dossier, code samples and sample photos in the case files only load when someone presses their load button.

## Map and data sources

The map is OpenStreetMap, shown with Leaflet and opening on New Scotland Yard, London. Place search and address lookup use OpenStreetMap's public Nominatim service, so searched text and clicked coordinates are sent there. Both services are free but rate limited, and a browser needs internet access to use them.

Nothing on the site is cached: pages and API responses are sent with `Cache-Control: no-store`.

## Features

| Feature | Who | What it does |
|---|---|---|
| Missing board | Everyone | Agents publish "missing" posters for any character or person, with a description, photo, public guidance (harmless / caution / do not approach), last-seen location and a **"what to look for"** trait list (each trait has keywords and an importance). Citizens browse the board; agents can mark people found or archive them. |
| Slideshow and kiosk | Everyone | Published posters rotate on the landing page. `#kiosk` is a full-screen display for public screens outside stations and arcades, like wanted posters. |
| Public appeal + sign-in | Everyone | Landing page with the slideshow, live counts and sign-in. |
| Report a sighting | Citizens | Pick someone from the board (scored live against that poster's traits), **someone not on the board** (checked against every poster, with a "this sounds like…" suggestion), or an **Sentinel agent**. Search for a place, use your location or click the map. Strong matches alert field agents. Reporter identity is hidden from other citizens. |
| Sightings map | Everyone | Map plus a feed filterable by subject and match level. Agents verify or dismiss reports. Verifying a sighting moves the poster's last-seen location. |
| Agent sightings | Agents | Never shown publicly. If the reporter names an agent who isn't on the roster, a "possible impersonation" alert is raised. Agents can link reports to an agent profile, and the tracker shows each agent's public sightings. |
| Comms | Agents | Team chat with channels (#general, #case-room, #field-ops, #sightings-triage) and direct messages. Supports @mentions, pinned messages, urgent pings (which alert every field agent), attached evidence (alerts, sightings, analyses), online presence and unread badges. "Discuss" buttons on alerts and sightings open the chat with that item attached. |
| Asset integrity (CV) | Everyone | In-browser computer vision on a casing photo: abrasions (edge density with an orientation filter), discolouration, and change against a reference photo. Sample photos load on request. |
| Case dashboard | Agents | Correlation verdict (0–100), evidence breakdown, investigation checklist, live map, timeline, escalation with confirmation. |
| Energy spike detection | Agents | Robust z-score on meter-derived usage, HVAC plausibility test, and meter-vs-reported discrepancy detection, with a chart. |
| Code forensics | Agents | Structural C++ diff: removed classes still referenced, unresolved calls, orphaned includes, unified diff. Drag-and-drop files. |
| Alerts | Agents | Findings routed to the right authority by rule. Duplicates merged. Acknowledge and resolve. New critical alerts show as toasts. |
| Agent tracker | Agents | Positions, status, trails and public sightings, with a "Message" button per agent. Agents check in themselves; "Needs backup" raises a critical alert. |

Also included: light/dark theme, mobile drawer navigation, toasts, loading skeletons, empty states, and keyboard focus styles.

## Project layout

```
public/            static site (index.html, css/, js/, samples/)
  js/map.js        real map, place search and location picker
  js/poi.js        Sighting scorers, shared by browser and API
lib/api.js         API routes, auth (PBKDF2 + HMAC-signed tokens), alert routing
lib/engines.js     energy, code-forensics and correlation engines
netlify/functions/api.js   Netlify Function entry (Blobs storage)
dev.js             zero-dependency local server (file storage)
```
