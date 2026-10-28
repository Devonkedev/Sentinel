<img src="public/brand/logo.svg" alt="Sentinel" width="320">

Public missing board and agent case console, built around the Wenoti Arcade case (The Reckoning V: Origins, machine `MJWHKZLTNBUXE5A`).

- **Frontend:** static HTML/CSS/JS in `public/` (no build step)
- **Backend:** one Netlify Function (`netlify/functions/api.js`) serving `/api/*`
- **Storage:** Netlify Blobs (no database to set up)

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
| Missing board | Everyone | Agents publish "missing" posters for any character or person, with a description, photo, public guidance (harmless / caution / do not approach), last-seen location and a **"what to look for"** trait list (each trait has keywords and an importance). Citizens browse the board; agents can mark people found or archive them. POI-1 is the first poster. |
| Slideshow and kiosk | Everyone | Published posters rotate on the landing page. `#kiosk` is a full-screen display for public screens outside stations and arcades, like wanted posters. |
| Public appeal + sign-in | Everyone | Landing page with the slideshow, live counts and one-click demo logins. |
| Report a sighting | Citizens | Pick someone from the board (scored live against that poster's traits), **someone not on the board** (checked against every poster, with a "this sounds like…" suggestion), or an **Sentinel agent**. Pin on the map. Strong matches alert field agents. Reporter identity is hidden from other citizens. |
| Sightings map | Everyone | Map plus a feed filterable by subject and match level. Agents verify or dismiss reports. Verifying a sighting moves the poster's last-seen location. |
| Agent sightings | Agents | Never shown publicly. If the reporter names an agent who isn't on the roster, a "possible impersonation" alert is raised. Agents can link reports to an agent profile, and the tracker shows each agent's public sightings. |
| Comms | Agents | Team chat with channels (#general, #wenoti-case, #field-ops, #sightings-triage) and direct messages. Supports @mentions, pinned messages, urgent pings (which alert every field agent), attached evidence (alerts, sightings, analyses), online presence and unread badges. "Discuss" buttons on alerts and sightings open the chat with that item attached. |
| Asset integrity (CV) | Everyone | In-browser computer vision on a casing photo: abrasions (edge density with an orientation filter), discolouration, and change against a reference photo. Includes sample photos. |
| Case dashboard | Agents | Correlation verdict (0–100), evidence breakdown, investigation checklist, live map, timeline, escalation with confirmation. |
| Energy spike detection | Agents | Robust z-score on meter-derived usage, HVAC plausibility test, and meter-vs-reported discrepancy detection, with a chart. |
| Code forensics | Agents | Structural C++ diff: removed classes still referenced, unresolved calls, orphaned includes, unified diff. Drag-and-drop files. |
| Alerts | Agents | Findings routed to the right authority by rule. Duplicates merged. Acknowledge and resolve. New critical alerts show as toasts. |
| Agent tracker | Agents | Positions, status, trails and public sightings, with a "Message" button per agent. Agents check in themselves; "Needs backup" raises a critical alert. |

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
