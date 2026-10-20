// RSVPs for the Oct 23 and 24 gathering, saved even if Netlify form handling is off.
// POST /api/rsvp {name, cell, email, events[], text_ok, keep_in_touch, adults, kids} -> 200 {ok}
// Admin (needs SALE_KEY env var in Netlify):
// GET /api/rsvp?key=...  -> every RSVP plus totals for Friday and Saturday
import { getStore } from "@netlify/blobs";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const clean = (s, n) => String(s || "").replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, n);
const num = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 && n < 20 ? n : 0; };

export async function handle(req, store, adminKey) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  const isAdmin = Boolean(adminKey && key && key === adminKey);

  if (req.method === "GET") {
    if (!isAdmin) return json({ ok: true });
    const { blobs } = await store.list();
    const all = [];
    for (const b of blobs) { const r = await store.get(b.key, { type: "json" }); if (r) all.push(r); }
    all.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const tally = (day) => all.filter((r) => r.events.includes(day)).reduce((t, r) => ({ adults: t.adults + r.adults, kids: t.kids + r.kids }), { adults: 0, kids: 0 });
    return json({ count: all.length, friday: tally("Fri Oct 23"), saturday: tally("Sat Oct 24"), rsvps: all });
  }

  if (req.method === "POST") {
    let b;
    try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
    if (b["bot-field"]) return json({ ok: true });
    const name = clean(b.name, 80), cell = clean(b.cell, 30), email = clean(b.email, 120);
    if (name.length < 2) return json({ error: "Please add your name." }, 400);
    const digits = cell.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
    const allowed = ["Fri Oct 23", "Sat Oct 24", "Cannot come"];
    const events = (Array.isArray(b.events) ? b.events : [b.events]).filter((e) => allowed.includes(e));
    const attending = events.includes("Fri Oct 23") || events.includes("Sat Oct 24");
    if (attending && digits.length !== 10) return json({ error: "Please add your cell number with the area code." }, 400);
    if (!attending && digits.length && digits.length !== 10) return json({ error: "Please include the area code with your cell number." }, 400);
    const rec = { name, cell: digits, email, events, text_ok: Boolean(b.text_ok), keep_in_touch: Boolean(b.keep_in_touch), adults: num(b.adults), kids: num(b.kids), at: new Date().toISOString() };
    const id = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    await store.setJSON(id, rec);
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
}

export default async (req) => {
  const store = getStore({ name: "rsvps", consistency: "strong" });
  const adminKey = globalThis.Netlify?.env?.get("ADMIN_PHRASE") || globalThis.Netlify?.env?.get("SALE_KEY") || "";
  return handle(req, store, adminKey);
};

export const config = { path: "/api/rsvp" };
