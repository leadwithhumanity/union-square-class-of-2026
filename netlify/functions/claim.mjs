// Estate sale claims: the first person to claim an item holds it; everyone else sees "Spoken for".
// GET  /api/claim                         -> { claimed: [itemId, ...] }
// POST /api/claim {action:"claim", id, name, phone, email}  -> 200 held, 409 already claimed
// POST /api/claim {action:"waitlist", id, name, phone}       -> 200 on the list
// Admin (optional, needs SALE_KEY env var in Netlify):
// GET  /api/claim?key=...                 -> every claim and waitlist entry
// DELETE /api/claim?key=...&id=...        -> releases an item back to available
import { getStore } from "@netlify/blobs";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const clean = (s, n) => String(s || "").replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, n);
const ID = /^[a-z0-9_-]{1,48}$/i;

export async function handle(req, claims, waitlist, adminKey) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  const isAdmin = adminKey && key && key === adminKey;

  if (req.method === "GET") {
    const { blobs } = await claims.list();
    if (isAdmin) {
      const out = [];
      for (const b of blobs) out.push({ id: b.key, ...(await claims.get(b.key, { type: "json" })) });
      const w = await waitlist.list(); const wl = [];
      for (const b of w.blobs) wl.push({ key: b.key, ...(await waitlist.get(b.key, { type: "json" })) });
      return json({ claims: out, waitlist: wl });
    }
    return json({ claimed: blobs.map((b) => b.key) });
  }

  if (req.method === "DELETE") {
    if (!isAdmin) return json({ error: "Not allowed" }, 403);
    const id = url.searchParams.get("id");
    if (!ID.test(id || "")) return json({ error: "Unknown item" }, 400);
    await claims.delete(id);
    return json({ ok: true });
  }

  if (req.method === "POST") {
    let b;
    try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
    if (b.website) return json({ ok: true }); // honeypot
    const id = String(b.id || "");
    if (!ID.test(id)) return json({ error: "Unknown item" }, 400);
    const name = clean(b.name, 80), phone = clean(b.phone, 30), email = clean(b.email, 120), item = clean(b.item, 160);
    if (name.length < 2) return json({ error: "Please add your name." }, 400);
    if (phone.replace(/\D/g, "").length < 10) return json({ error: "Please add a cell number we can text." }, 400);
    const rec = { name, phone, email, item, at: new Date().toISOString() };
    if (b.action === "waitlist") {
      await waitlist.setJSON(id + "--" + Date.now(), { id, ...rec });
      return json({ ok: true, waitlist: true });
    }
    const res = await claims.setJSON(id, rec, { onlyIfNew: true });
    if (!res.modified) return json({ error: "Someone just claimed this one.", taken: true }, 409);
    return json({ ok: true, id });
  }

  return json({ error: "Method not allowed" }, 405);
}

export default async (req) => {
  const claims = getStore({ name: "sale-claims", consistency: "strong" });
  const waitlist = getStore({ name: "sale-waitlist", consistency: "strong" });
  const adminKey = globalThis.Netlify?.env?.get("SALE_KEY") || "";
  return handle(req, claims, waitlist, adminKey);
};

export const config = { path: "/api/claim" };
