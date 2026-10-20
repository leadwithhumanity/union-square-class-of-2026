// Furniture pickup scheduler: one booking per 30-minute slot.
// GET  /api/pickup            -> { slots: [...], taken: [...] }
// POST /api/pickup {slot,name,phone,items} -> 200 booked, 409 taken
// Admin (optional, needs PICKUP_KEY env var in Netlify):
// GET  /api/pickup?key=...    -> full bookings;  DELETE /api/pickup?key=...&slot=... frees a slot
import { getStore } from "@netlify/blobs";

const DAYS = [
  { date: "2026-10-29", label: "Thursday, Oct 29" },
  { date: "2026-10-30", label: "Friday, Oct 30" },
];
const START = 9 * 60, END = 19 * 60, STEP = 30; // 9 am to 7 pm

export function allSlots() {
  const out = [];
  for (const d of DAYS) for (let m = START; m < END; m += STEP) {
    const hh = String(Math.floor(m / 60)).padStart(2, "0"), mm = String(m % 60).padStart(2, "0");
    out.push({ id: `${d.date}-${hh}${mm}`, day: d.label, date: d.date, minutes: m });
  }
  return out;
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const clean = (s, n) => String(s || "").replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, n);

export async function handle(req, store, adminKey) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  const isAdmin = adminKey && key && key === adminKey;
  const ids = new Set(allSlots().map((s) => s.id));

  if (req.method === "GET") {
    const { blobs } = await store.list();
    const taken = blobs.map((b) => b.key).filter((k) => ids.has(k));
    if (isAdmin) {
      const bookings = [];
      for (const k of taken.sort()) bookings.push({ slot: k, ...(await store.get(k, { type: "json" })) });
      return json({ bookings });
    }
    return json({ slots: allSlots(), taken });
  }

  if (req.method === "DELETE") {
    if (!isAdmin) return json({ error: "Not allowed" }, 403);
    const slot = url.searchParams.get("slot");
    if (!ids.has(slot)) return json({ error: "Unknown slot" }, 400);
    await store.delete(slot);
    return json({ ok: true });
  }

  if (req.method === "POST") {
    let b;
    try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
    if (b.website) return json({ ok: true }); // honeypot
    const slot = String(b.slot || "");
    const name = clean(b.name, 80), phone = clean(b.phone, 30), items = clean(b.items, 300);
    if (!ids.has(slot)) return json({ error: "Please pick a time." }, 400);
    if (name.length < 2) return json({ error: "Please add your name." }, 400);
    if (phone.replace(/\D/g, "").length < 10) return json({ error: "Please add a phone number we can text." }, 400);
    const res = await store.setJSON(slot, { name, phone, items, bookedAt: new Date().toISOString() }, { onlyIfNew: true });
    if (!res.modified) return json({ error: "Someone just took that time. Please pick another." }, 409);
    return json({ ok: true, slot });
  }

  return json({ error: "Method not allowed" }, 405);
}

export default async (req) => {
  const store = getStore({ name: "furniture-pickups", consistency: "strong" });
  const adminKey = globalThis.Netlify?.env?.get("PICKUP_KEY") || "";
  return handle(req, store, adminKey);
};

export const config = { path: "/api/pickup" };
