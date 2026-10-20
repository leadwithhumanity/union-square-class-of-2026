// Simple open counter for the invitation and the estate sale. No cookies, no personal data.
// POST /api/hit {page, first}  -> records one open (first=true on a device's first visit)
// GET  /api/hit?key=...        -> totals per page (needs SALE_KEY)
import { getStore } from "@netlify/blobs";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const PAGES = ["invite", "sale", "yearbook"];

export async function handle(req, store, adminKey) {
  const url = new URL(req.url);
  if (req.method === "POST") {
    let b = {};
    try { b = await req.json(); } catch {}
    const page = PAGES.includes(b.page) ? b.page : null;
    if (!page) return json({ ok: true });
    const id = `${page}/${b.first ? "u" : "r"}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    await store.set(id, "1");
    return json({ ok: true });
  }
  if (req.method === "GET") {
    const key = url.searchParams.get("key");
    if (!(adminKey && key === adminKey)) return json({ ok: true });
    const out = {};
    for (const p of PAGES) {
      const u = (await store.list({ prefix: `${p}/u/` })).blobs.length;
      const r = (await store.list({ prefix: `${p}/r/` })).blobs.length;
      out[p] = { people: u, opens: u + r };
    }
    return json(out);
  }
  return json({ error: "Method not allowed" }, 405);
}

export default async (req) => {
  const store = getStore({ name: "page-opens", consistency: "strong" });
  const adminKey = globalThis.Netlify?.env?.get("ADMIN_PHRASE") || globalThis.Netlify?.env?.get("SALE_KEY") || "";
  return handle(req, store, adminKey);
};

export const config = { path: "/api/hit" };
