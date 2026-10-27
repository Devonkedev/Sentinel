import { webcrypto } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { createApi } from "../../lib/api.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

let handle;

export default async req => {
  if (!handle) {
    // Created per instance on first request, once the Blobs context is available
    const blobs = getStore({ name: "exun-sentinel", consistency: "strong" });
    handle = createApi({
      store: {
        get: key => blobs.get(key, { type: "json" }),
        set: (key, value) => blobs.setJSON(key, value),
      },
      secret: process.env.EXUN_SECRET || undefined,
      agencyCode: process.env.EXUN_AGENCY_CODE || undefined,
    });
  }
  return handle(req);
};

export const config = { path: "/api/*" };
