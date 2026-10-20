// Yearbook signatures: a note shows on the Sign Our Yearbook page as soon as it is signed.
// GET  /api/guestbook                       -> { notes: [{id, prompt, message, name, from, at}] } (visible notes, oldest first)
// POST /api/guestbook {prompt, message, name, from, email} -> 200 {ok, note}
// Admin (needs SALE_KEY env var in Netlify):
// GET    /api/guestbook?key=...             -> every note, including hidden ones and emails
// DELETE /api/guestbook?key=...&id=...      -> hides a note from the page (kept in storage)
import { getStore } from "@netlify/blobs";

export const PROMPTS = ["Share a memory", "What this place has meant to you", "Advice for our next chapter", "A wish for the future owner of the Loft"];

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const clean = (s, n) => String(s || "").replace(/[\u0000-\u0008\u000b-\u001f<>]/g, " ").trim().slice(0, n);
const ID = /^[a-z0-9-]{6,40}$/i;
const pub = ({ id, prompt, message, name, from, at }) => ({ id, prompt, message, name, from, at });

export async function handle(req, store, adminKey) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  const isAdmin = Boolean(adminKey && key && key === adminKey);

  if (req.method === "GET") {
    const { blobs } = await store.list();
    const all = [];
    for (const b of blobs) {
      const n = await store.get(b.key, { type: "json" });
      if (n) all.push({ id: b.key, ...n });
    }
    all.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    if (isAdmin) return json({ notes: all });
    return json({ notes: all.filter((n) => !n.hidden).map(pub) });
  }

  if (req.method === "DELETE") {
    if (!isAdmin) return json({ error: "Not allowed" }, 403);
    const id = url.searchParams.get("id") || "";
    if (!ID.test(id)) return json({ error: "Unknown note" }, 400);
    const n = await store.get(id, { type: "json" });
    if (!n) return json({ error: "Unknown note" }, 404);
    await store.setJSON(id, { ...n, hidden: true });
    return json({ ok: true });
  }

  if (req.method === "POST") {
    let b;
    try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
    if (b["bot-field"] || b.website) return json({ ok: true }); // honeypot
    const prompt = PROMPTS.includes(b.prompt) ? b.prompt : PROMPTS[0];
    const message = clean(b.message, 900), name = clean(b.name, 80), from = clean(b.from, 80), email = clean(b.email, 120);
    if (message.length < 2) return json({ error: "Please write a note." }, 400);
    if (name.length < 2) return json({ error: "Please add your name." }, 400);
    const at = new Date().toISOString();
    const id = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    const note = { prompt, message, name, from, email, at, hidden: false };
    await store.setJSON(id, note);
    return json({ ok: true, note: pub({ id, ...note }) });
  }

  return json({ error: "Method not allowed" }, 405);
}

export default async (req) => {
  const store = getStore({ name: "yearbook-notes", consistency: "strong" });
  const adminKey = globalThis.Netlify?.env?.get("ADMIN_PHRASE") || globalThis.Netlify?.env?.get("SALE_KEY") || "";
  return handle(req, store, adminKey);
};

export const config = { path: "/api/guestbook" };
