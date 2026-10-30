// Local development server: node dev.js  ->  http://localhost:8888
// Serves public/ and runs the same API as the Netlify function, storing data in ./data/live.
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
import { createApi } from "./lib/api.js";

const PORT = Number(process.env.PORT || 8888);
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const PUBLIC = fileURLToPath(new URL("./public/", import.meta.url));
const DATA = fileURLToPath(new URL("./data/live/", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".txt": "text/plain", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

await mkdir(DATA, { recursive: true });
const handle = createApi({
  store: {
    get: async key => { try { return JSON.parse(await readFile(join(DATA, key + ".json"), "utf8")); } catch { return null; } },
    set: (key, value) => writeFile(join(DATA, key + ".json"), JSON.stringify(value)),
  },
  secret: process.env.SENTINEL_SECRET || undefined,
  agencyCode: process.env.SENTINEL_AGENCY_CODE || undefined,
});

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const response = await handle(new Request(url, {
      method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
    }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    return res.end(Buffer.from(await response.arrayBuffer()));
  }
  const file = normalize(join(PUBLIC, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  try {
    const content = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(content);
  } catch {
    res.writeHead(404); res.end("Not found");
  }
}).listen(PORT, () => console.log(`Sentinel on http://localhost:${PORT}`));
