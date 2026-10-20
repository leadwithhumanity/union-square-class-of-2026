// Guest photos and short videos for the yearbook. Files are uploaded in small parts so phones on any connection can send them.
// POST /api/media?op=start  {type, size, name, from, caption, note}   -> {id, chunk}
// PUT  /api/media?id=ID&part=N  (raw bytes, at most CHUNK)            -> {ok}
// POST /api/media?op=done&id=ID                                       -> {ok, item}
// GET  /api/media                                                     -> {items:[...]} (visible, newest first)
// GET  /api/media?file=ID   (supports Range, which phones need to play video)
// Admin: GET ?key=  -> every item including hidden; DELETE ?key=&id= -> hide; PATCH ?key=&id= -> show again
import { getStore } from "@netlify/blobs";

export const CHUNK = 3 * 1024 * 1024;
const TYPES = { "image/jpeg": "img", "image/png": "img", "image/webp": "img", "video/mp4": "vid", "video/quicktime": "vid", "video/webm": "vid" };
const MAX = { img: 15 * 1024 * 1024, vid: 300 * 1024 * 1024 };
const ID = /^[a-z0-9]{6,12}-[a-z0-9]{4,8}$/;
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const clean = (s, n) => String(s || "").replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, n);
const pub = (id, m) => ({ id, type: m.type, kind: TYPES[m.type], size: m.size, name: m.name, from: m.from, caption: m.caption, note: m.note || "", thumb: !!m.thumb, at: m.at });

function magicOk(type, b) {
  const u = new Uint8Array(b.slice(0, 16));
  const s = (i, str) => [...str].every((c, k) => u[i + k] === c.charCodeAt(0));
  if (type === "image/jpeg") return u[0] === 0xff && u[1] === 0xd8;
  if (type === "image/png") return u[0] === 0x89 && s(1, "PNG");
  if (type === "image/webp") return s(0, "RIFF") && s(8, "WEBP");
  if (type === "video/webm") return u[0] === 0x1a && u[1] === 0x45 && u[2] === 0xdf && u[3] === 0xa3;
  return s(4, "ftyp") || s(4, "moov") || s(4, "wide") || s(4, "mdat") || s(4, "free");
}

export async function handle(req, store, adminKey) {
  const url = new URL(req.url);
  const q = (k) => url.searchParams.get(k) || "";
  const isAdmin = Boolean(adminKey && q("key") && q("key") === adminKey);

  if (req.method === "GET" && q("file")) {
    const id = q("file");
    if (!ID.test(id)) return new Response("Not found", { status: 404 });
    const m = await store.get(`m/${id}`, { type: "json" });
    if (!m || m.status !== "ready" || m.hidden) return new Response("Not found", { status: 404 });
    if (q("thumb") && m.thumb) {
      const t = await store.get(`p/${id}/t`, { type: "arrayBuffer" });
      if (t) return new Response(t, { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable", "netlify-cdn-cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" } });
    }
    const nparts = Math.ceil(m.size / CHUNK);
    let start = 0, end = m.size - 1, partial = false;
    const r = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") || "");
    if (r && (r[1] || r[2])) {
      partial = true;
      if (r[1] === "") { start = Math.max(0, m.size - Number(r[2])); }
      else { start = Number(r[1]); if (r[2]) end = Math.min(Number(r[2]), m.size - 1); }
      if (start >= m.size) return new Response(null, { status: 416, headers: { "content-range": `bytes */${m.size}` } });
    }
    // one response never spans more than one stored part
    const p = Math.floor(start / CHUNK);
    if (nparts > 1 && (Math.floor(end / CHUNK) !== p)) { end = Math.min(m.size - 1, (p + 1) * CHUNK - 1); partial = true; }
    const buf = await store.get(`p/${id}/${p}`, { type: "arrayBuffer" });
    if (!buf) return new Response("Not found", { status: 404 });
    const body = buf.slice(start - p * CHUNK, end - p * CHUNK + 1);
    const h = { "content-type": m.type, "accept-ranges": "bytes", "content-length": String(body.byteLength), "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff", "content-disposition": "inline" };
    if (partial) h["content-range"] = `bytes ${start}-${end}/${m.size}`;
    h["netlify-vary"] = "header=Range";
    if (!partial) h["netlify-cdn-cache-control"] = "public, max-age=31536000, immutable";
    return new Response(body, { status: partial ? 206 : 200, headers: h });
  }

  if (req.method === "GET") {
    const { blobs } = await store.list({ prefix: "m/" });
    const all = [];
    for (let i = 0; i < blobs.length; i += 50) {
      const got = await Promise.all(blobs.slice(i, i + 50).map((b) => store.get(b.key, { type: "json" }).then((m) => [b.key.slice(2), m])));
      for (const [id, m] of got) if (m && m.status === "ready") all.push({ ...pub(id, m), hidden: !!m.hidden });
    }
    all.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    if (isAdmin) return json({ items: all });
    const r = json({ items: all.filter((i) => !i.hidden).map(({ hidden, ...i }) => i) });
    r.headers.set("netlify-cdn-cache-control", "public, max-age=20, stale-while-revalidate=60");
    return r;
  }

  if ((req.method === "DELETE" || req.method === "PATCH") && isAdmin) {
    const id = q("id");
    const m = ID.test(id) && (await store.get(`m/${id}`, { type: "json" }));
    if (!m) return json({ error: "Unknown item" }, 404);
    await store.setJSON(`m/${id}`, { ...m, hidden: req.method === "DELETE" });
    return json({ ok: true });
  }

  if (req.method === "POST" && q("op") === "start") {
    let b; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
    if (b["bot-field"]) return json({ error: "Bad request" }, 400);
    const kind = TYPES[b.type];
    if (!kind) return json({ error: "Please choose a photo (JPG or PNG) or a video (MP4 or MOV)." }, 400);
    const size = Number(b.size);
    if (!(size > 0)) return json({ error: "That file looks empty." }, 400);
    if (size > MAX[kind]) return json({ error: kind === "vid" ? "That video is too large. Please choose a clip of 2 minutes or less." : "That photo is too large." }, 400);
    const name = clean(b.name, 80);
    if (name.length < 2) return json({ error: "Please add your name." }, 400);
    const id = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    await store.setJSON(`m/${id}`, { type: b.type, size, name, from: clean(b.from, 80), caption: clean(b.caption, 300), note: "", status: "uploading", at: new Date().toISOString() });
    return json({ id, chunk: CHUNK });
  }

  if (req.method === "PUT" && q("part") === "t") {
    const id = q("id");
    const m = ID.test(id) && (await store.get(`m/${id}`, { type: "json" }));
    if (!m || m.status !== "uploading") return json({ error: "Unknown upload" }, 404);
    const buf = await req.arrayBuffer();
    if (buf.byteLength > 600 * 1024 || !magicOk("image/jpeg", buf)) return json({ error: "Bad preview" }, 400);
    await store.set(`p/${id}/t`, buf);
    await store.setJSON(`m/${id}`, { ...m, thumb: true });
    return json({ ok: true });
  }

  if (req.method === "PUT") {
    const id = q("id"), part = Number(q("part"));
    if (!ID.test(id) || !Number.isInteger(part) || part < 0) return json({ error: "Bad request" }, 400);
    const m = await store.get(`m/${id}`, { type: "json" });
    if (!m || m.status !== "uploading") return json({ error: "Unknown upload" }, 404);
    const nparts = Math.ceil(m.size / CHUNK);
    if (part >= nparts) return json({ error: "Bad part" }, 400);
    const buf = await req.arrayBuffer();
    const want = part === nparts - 1 ? m.size - part * CHUNK : CHUNK;
    if (buf.byteLength !== want) return json({ error: "Upload interrupted. Please try again." }, 400);
    if (part === 0 && !magicOk(m.type, buf)) return json({ error: "That file does not look like a photo or video." }, 400);
    await store.set(`p/${id}/${part}`, buf);
    return json({ ok: true });
  }

  if (req.method === "POST" && q("op") === "done") {
    const id = q("id");
    const m = ID.test(id) && (await store.get(`m/${id}`, { type: "json" }));
    if (!m) return json({ error: "Unknown upload" }, 404);
    const nparts = Math.ceil(m.size / CHUNK);
    const { blobs } = await store.list({ prefix: `p/${id}/` });
    if (blobs.filter((b) => !b.key.endsWith("/t")).length !== nparts) return json({ error: "Upload incomplete. Please try again." }, 400);
    const cur = await store.get(`m/${id}`, { type: "json" });
    const done = { ...cur, status: "ready" };
    await store.setJSON(`m/${id}`, done);
    return json({ ok: true, item: pub(id, done) });
  }

  return json({ error: "Method not allowed" }, 405);
}

export default async (req) => {
  const store = getStore({ name: "guest-media", consistency: "strong" });
  const adminKey = globalThis.Netlify?.env?.get("ADMIN_PHRASE") || globalThis.Netlify?.env?.get("SALE_KEY") || "";
  return handle(req, store, adminKey);
};

export const config = { path: "/api/media" };
