import { webcrypto } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { createApi } from "../../lib/api.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

// The Blobs token is issued per invocation and expires, so the store is
// opened on every call rather than cached on a warm instance.
const blobs = () => getStore({ name: "sentinel", consistency: "strong" });

const handle = createApi({
  store: {
    get: key => blobs().get(key, { type: "json" }),
    set: (key, value) => blobs().setJSON(key, value),
  },
  secret: process.env.SENTINEL_SECRET || undefined,
  agencyCode: process.env.SENTINEL_AGENCY_CODE || undefined,
});

export default async req => handle(req);

export const config = { path: "/api/*" };
