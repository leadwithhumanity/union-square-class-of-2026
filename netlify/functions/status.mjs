// Estate sale status overrides set by Brian and Erica from the private page, so a sale shows on the site without a redeploy.
// GET  /api/status                      -> { status: { itemId: "sold" | "available" | "pending" } }
// POST /api/status?key=...  {id, status} -> set; status "clear" removes the override (admin only)
import { getStore } from "@netlify/blobs";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const ID = /^[a-z0-9_-]{1,48}$/i;
const OK = new Set(["sold", "available", "pending", "clear"]);

export async function handle(req, store, adminKey) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  const isAdmin = Boolean(adminKey && key && key === adminKey);

  if (req.method === "GET") {
    const { blobs } = await store.list();
    const out = {};
    await Promise.all(blobs.map(async (b) => {
      const v = await store.get(b.key, { type: "json" });
      if (v && v.status) out[b.key] = v.status;
    }));
    return json({ status: out });
  }

  if (req.method === "POST") {
    if (!isAdmin) return json({ error: "That key did not work." }, 403);
    let b;
    try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
    const id = String(b.id || "");
    const status = String(b.status || "");
    if (!ID.test(id) || !OK.has(status)) return json({ error: "Bad request" }, 400);
    if (status === "clear") await store.delete(id);
    else await store.setJSON(id, { status, at: new Date().toISOString() });
    return json({ ok: true, id, status });
  }

  return json({ error: "Method not allowed" }, 405);
}

export default async (req) => {
  const store = getStore({ name: "sale-status", consistency: "strong" });
  const adminKey = globalThis.Netlify?.env?.get("ADMIN_PHRASE") || globalThis.Netlify?.env?.get("SALE_KEY") || "";
  return handle(req, store, adminKey);
};

export const config = { path: "/api/status" };
