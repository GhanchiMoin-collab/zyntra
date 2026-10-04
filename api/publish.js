import { getAdminAuth, getAdminDb, increment } from "./_lib/firebaseAdmin.js";

// ----------------------------------------------------------------------
// Zyntra Creations — a small "Roblox-style" platform for apps and games.
//
// One serverless function handles everything (the Vercel Hobby plan caps
// the number of functions, so new endpoints are `action`s here instead of
// new files):
//
//   GET  ?action=list     public Discover feed (apps & games)
//   GET  ?action=get      one creation's page data (+ html with &html=1)
//   GET  ?action=icon     the creation's icon image  (cached)
//   GET  ?action=banner   the creation's banner image (cached)
//   GET  ?action=mine     the signed-in creator's own creations
//   POST action=publish   publish a new creation, or update one (existingSlug)
//   POST action=update-details | set-listed | delete   (owner only)
//   POST action=rate      thumbs up / down (signed in, one vote per person)
//   POST action=play      count a play
//   POST action=report    flag something (5 reports auto-hide it for review)
//   POST action=save | load   a player's saved progress for a creation
//
// POST with no `action` is the original "Publish a live link" website
// publish and keeps working exactly as before.
//
// Storage:
//   publishedSites/{slug}        the creation's page data (no html)
//   siteHtml/{slug}              its html (docs are capped at 1 MiB)
//   ratings/{slug}__{uid}        one person's vote
//   gameSaves/{slug}__{uid}      one person's saved progress
//   reports/{slug}__{uid}        reports for review
// Clients never touch these directly (see firestore.rules).
// ----------------------------------------------------------------------

const MAX_HTML_BYTES = 900 * 1024;       // a Firestore document is capped at 1 MiB
const MAX_ICON_BYTES = 60 * 1024;
const MAX_BANNER_BYTES = 150 * 1024;
const MAX_SAVE_BYTES = 100 * 1024;
const MAX_CREATIONS_PER_USER = 30;
const SLUG_CHARS = "abcdefghijkmnpqrstuvwxyz23456789"; // no 0/o/1/l
const GENRES = ["Action", "Adventure", "Arcade", "Puzzle", "Racing", "Strategy", "Simulation", "Role-play", "Education", "Creative", "Tools", "Website", "Other"];

function randomSlug(length = 4) {
  let out = "";
  for (let i = 0; i < length; i++) out += SLUG_CHARS[Math.floor(Math.random() * SLUG_CHARS.length)];
  return out;
}
function slugifyBase(text) {
  return String(text || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36);
}
// Legacy website slug: "My Portfolio" -> "my-portfolio-zyntraai-app".
function slugifyName(name) {
  const base = slugifyBase(name).slice(0, 40);
  return base ? `${base}-zyntraai-app` : null;
}
function clean(text, max) {
  return String(text || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
}
function cleanTags(tags) {
  const arr = Array.isArray(tags) ? tags : String(tags || "").split(",");
  const seen = new Set();
  const out = [];
  for (const t of arr) {
    const v = clean(t, 20).toLowerCase().replace(/[^a-z0-9 \-]/g, "").trim();
    if (v && !seen.has(v)) { seen.add(v); out.push(v); }
    if (out.length >= 5) break;
  }
  return out;
}
function dataUrlOk(dataUrl, maxBytes) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || "");
  if (!m) return false;
  const bytes = Math.floor(m[2].length * 3 / 4);
  return bytes > 0 && bytes <= maxBytes;
}

async function getUser(req) {
  const authHeader = req.headers.authorization || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) return null;
  try { return await getAdminAuth().verifyIdToken(idToken); } catch (e) { return null; }
}
async function planOf(db, uid) {
  try {
    const snap = await db.collection("billing").doc(uid).get();
    return snap.exists ? (snap.data().plan || "free") : "free";
  } catch (e) { return "free"; }
}
function handleFromUser(decoded) {
  const email = (decoded.email || "").toLowerCase();
  const local = email.split("@")[0];
  return local ? "@" + local.replace(/[^a-z0-9._-]/g, "").slice(0, 30) : "@player";
}
function publicItem(slug, d, { detail = false } = {}) {
  const v = d.version || 1;
  return {
    slug,
    kind: d.kind || "site",
    title: d.title || "Untitled",
    description: d.description || "",
    genre: d.genre || "Other",
    tags: d.tags || [],
    creatorName: d.creatorName || "",
    creatorHandle: d.creatorHandle || "",
    projectName: d.projectName || "",
    listed: d.listed !== false,
    hidden: !!d.hidden,
    version: v,
    plays: d.plays || 0,
    likes: d.likes || 0,
    dislikes: d.dislikes || 0,
    iconUrl: d.iconBase64 ? `/api/publish?action=icon&slug=${encodeURIComponent(slug)}&v=${v}` : "",
    bannerUrl: detail && d.bannerBase64 ? `/api/publish?action=banner&slug=${encodeURIComponent(slug)}&v=${v}` : "",
    changelog: detail ? (d.changelog || []) : undefined,
    createdAt: d.createdAt || "",
    updatedAt: d.updatedAt || d.createdAt || ""
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method === "GET") return await handleGet(req, res);
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const body = req.body || {};
    if (!body.action) return await legacyPublish(req, res);
    return await handlePost(req, res, body.action, body);
  } catch (error) {
    console.error("publish error:", error);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
}

// ======================= GET =======================
async function handleGet(req, res) {
  const action = req.query?.action;
  const db = getAdminDb();
  const col = db.collection("publishedSites");

  if (action === "list") {
    const kind = req.query.kind;      // game | app | (blank = both)
    const genre = req.query.genre;
    const q = String(req.query.q || "").toLowerCase().trim();
    const sort = req.query.sort || "popular";
    const snap = await col.where("listed", "==", true).get();
    const items = [];
    snap.forEach(doc => {
      const d = doc.data();
      if (d.hidden) return;
      if (d.kind !== "game" && d.kind !== "app") return;
      if (kind && kind !== "all" && d.kind !== kind) return;
      if (genre && genre !== "all" && d.genre !== genre) return;
      if (q && !`${d.title} ${d.description} ${(d.tags || []).join(" ")} ${d.creatorName}`.toLowerCase().includes(q)) return;
      const it = publicItem(doc.id, d);
      it.description = it.description.slice(0, 140);
      items.push(it);
    });
    const score = it => { const n = it.likes + it.dislikes; return (it.likes + 1) / (n + 2); }; // smoothed approval
    if (sort === "top") items.sort((a, b) => score(b) - score(a) || b.plays - a.plays);
    else if (sort === "new") items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    else items.sort((a, b) => b.plays - a.plays || score(b) - score(a));
    res.setHeader("Cache-Control", "public, max-age=20, s-maxage=20");
    return res.status(200).json({ items: items.slice(0, 120) });
  }

  if (action === "icon" || action === "banner") {
    const slug = String(req.query.slug || "");
    const snap = await col.doc(slug).get();
    const field = action === "icon" ? "iconBase64" : "bannerBase64";
    if (!snap.exists || !snap.data()[field]) return res.status(404).end();
    const m = /^data:([^;]+);base64,(.+)$/.exec(snap.data()[field]);
    if (!m) return res.status(404).end();
    res.setHeader("Content-Type", m[1]);
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400");
    return res.status(200).send(Buffer.from(m[2], "base64"));
  }

  if (action === "get") {
    const slug = String(req.query.slug || "");
    const snap = await col.doc(slug).get();
    if (!snap.exists) return res.status(404).json({ error: "This creation doesn't exist." });
    const d = snap.data();
    const user = await getUser(req);
    const isOwner = !!user && user.uid === d.uid;
    if (d.hidden && !isOwner) return res.status(404).json({ error: "This creation is under review." });
    const out = { item: publicItem(slug, d, { detail: true }), isOwner, myVote: 0 };
    if (user) {
      try {
        const r = await db.collection("ratings").doc(`${slug}__${user.uid}`).get();
        out.myVote = r.exists ? (r.data().value || 0) : 0;
      } catch (e) { /* ignore */ }
    }
    if (req.query.html === "1") {
      if (d.html) out.html = d.html;
      else {
        const h = await db.collection("siteHtml").doc(slug).get();
        out.html = h.exists ? h.data().html : "";
      }
    }
    return res.status(200).json(out);
  }

  if (action === "mine") {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: "Sign in to see your creations." });
    const snap = await col.where("uid", "==", user.uid).get();
    const items = [];
    snap.forEach(doc => {
      const d = doc.data();
      if (d.kind === "game" || d.kind === "app") items.push(publicItem(doc.id, d));
    });
    items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return res.status(200).json({ items });
  }

  return res.status(400).json({ error: "Unknown request." });
}

// ======================= POST (actions) =======================
async function handlePost(req, res, action, body) {
  const db = getAdminDb();
  const col = db.collection("publishedSites");

  // ---- play (anyone) ----
  if (action === "play") {
    const slug = String(body.slug || "");
    if (!slug) return res.status(400).json({ error: "Missing creation." });
    const ref = col.doc(slug);
    const snap = await ref.get();
    if (snap.exists && !snap.data().hidden) await ref.update({ plays: increment(1) });
    return res.status(200).json({ ok: true });
  }

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: "Sign in first." });
  const uid = user.uid;

  // ---- rate ----
  if (action === "rate") {
    const slug = String(body.slug || "");
    const value = body.value === 1 ? 1 : body.value === -1 ? -1 : 0;
    const ref = col.doc(slug);
    const rref = db.collection("ratings").doc(`${slug}__${uid}`);
    const result = await db.runTransaction(async tx => {
      const [snap, rsnap] = await Promise.all([tx.get(ref), tx.get(rref)]);
      if (!snap.exists) throw new Error("missing");
      const prev = rsnap.exists ? (rsnap.data().value || 0) : 0;
      let likes = snap.data().likes || 0, dislikes = snap.data().dislikes || 0;
      if (prev === value) return { likes, dislikes, myVote: value };
      if (prev === 1) likes--;
      if (prev === -1) dislikes--;
      if (value === 1) likes++;
      if (value === -1) dislikes++;
      likes = Math.max(0, likes); dislikes = Math.max(0, dislikes);
      tx.update(ref, { likes, dislikes });
      if (value === 0) tx.delete(rref); else tx.set(rref, { slug, uid, value, at: new Date().toISOString() });
      return { likes, dislikes, myVote: value };
    }).catch(() => null);
    if (!result) return res.status(404).json({ error: "This creation doesn't exist." });
    return res.status(200).json({ ok: true, ...result });
  }

  // ---- report ----
  if (action === "report") {
    const slug = String(body.slug || "");
    const ref = col.doc(slug);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "This creation doesn't exist." });
    const rr = db.collection("reports").doc(`${slug}__${uid}`);
    const existing = await rr.get();
    if (!existing.exists) {
      await rr.set({ slug, uid, reason: clean(body.reason, 300) || "Not specified", at: new Date().toISOString() });
      const reports = (snap.data().reports || 0) + 1;
      const upd = { reports: increment(1) };
      if (reports >= 5) { upd.hidden = true; upd.hiddenReason = "Auto-hidden after 5 reports — awaiting review"; }
      await ref.update(upd);
    }
    return res.status(200).json({ ok: true });
  }

  // ---- saves ----
  if (action === "save" || action === "load") {
    const slug = String(body.slug || "");
    if (!slug) return res.status(400).json({ error: "Missing creation." });
    const sref = db.collection("gameSaves").doc(`${slug}__${uid}`);
    if (action === "load") {
      const s = await sref.get();
      return res.status(200).json({ store: s.exists ? (s.data().store || "") : "" });
    }
    const store = typeof body.store === "string" ? body.store : "";
    if (Buffer.byteLength(store, "utf8") > MAX_SAVE_BYTES) return res.status(413).json({ error: "Save data is too large (100KB limit)." });
    await sref.set({ slug, uid, store, updatedAt: new Date().toISOString() });
    return res.status(200).json({ ok: true });
  }

  // ---- owner-only actions ----
  if (action === "set-listed" || action === "delete" || action === "update-details") {
    const slug = String(body.slug || "");
    const ref = col.doc(slug);
    const snap = await ref.get();
    if (!snap.exists || snap.data().uid !== uid) return res.status(403).json({ error: "That isn't yours to change." });
    if (action === "delete") {
      await Promise.all([ref.delete(), db.collection("siteHtml").doc(slug).delete().catch(() => {})]);
      return res.status(200).json({ ok: true });
    }
    if (action === "set-listed") {
      await ref.update({ listed: !!body.listed, updatedAt: new Date().toISOString() });
      return res.status(200).json({ ok: true });
    }
    const upd = await buildMetaUpdate(db, user, body, snap.data());
    if (upd.error) return res.status(upd.status || 400).json({ error: upd.error });
    await ref.update({ ...upd.fields, updatedAt: new Date().toISOString() });
    return res.status(200).json({ ok: true });
  }

  // ---- publish / update ----
  if (action === "publish") {
    const html = body.html;
    if (!html || typeof html !== "string" || !html.trim()) return res.status(400).json({ error: "Nothing to publish." });
    if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) return res.status(400).json({ error: "That app is too large to publish (900KB limit)." });
    if (body.safeConfirmed !== true) return res.status(400).json({ error: "Please confirm it's safe for all ages and that it's yours to publish." });

    const kind = body.kind === "app" ? "app" : "game";
    const now = new Date().toISOString();
    const host = req.headers.host || "zyntra-ai-psi.vercel.app";

    // ---- update an existing creation ----
    if (body.existingSlug) {
      const slug = String(body.existingSlug);
      const ref = col.doc(slug);
      const snap = await ref.get();
      if (!snap.exists || snap.data().uid !== uid) return res.status(403).json({ error: "That isn't yours to update." });
      const old = snap.data();
      const upd = await buildMetaUpdate(db, user, body, old);
      if (upd.error) return res.status(upd.status || 400).json({ error: upd.error });
      const version = (old.version || 1) + 1;
      const changelog = [{ v: version, at: now, note: clean(body.changelog, 200) || "Updated" }, ...(old.changelog || [])].slice(0, 20);
      await db.collection("siteHtml").doc(slug).set({ html, version, updatedAt: now });
      await ref.update({ ...upd.fields, kind, version, changelog, updatedAt: now });
      return res.status(200).json({ ok: true, slug, version, updated: true, url: `https://${host}/play/${slug}` });
    }

    // ---- brand new creation ----
    const mine = await col.where("uid", "==", uid).get();
    if (mine.size >= MAX_CREATIONS_PER_USER) return res.status(400).json({ error: `You can have up to ${MAX_CREATIONS_PER_USER} creations. Delete one to publish another.` });

    const title = clean(body.title, 60);
    if (!title) return res.status(400).json({ error: "Give your creation a title." });
    const upd = await buildMetaUpdate(db, user, { ...body, title }, null);
    if (upd.error) return res.status(upd.status || 400).json({ error: upd.error });

    let slug = null;
    const base = slugifyBase(title) || "creation";
    for (let n = 0; n < 8 && !slug; n++) {
      const candidate = n === 0 ? base : `${base}-${randomSlug(4)}`;
      const exists = await col.doc(candidate).get();
      if (!exists.exists) slug = candidate;
    }
    if (!slug) return res.status(500).json({ error: "Couldn't generate a free link. Please try again." });

    await db.collection("siteHtml").doc(slug).set({ html, version: 1, updatedAt: now });
    await col.doc(slug).set({
      ...upd.fields,
      kind,
      uid,
      version: 1,
      plays: 0, likes: 0, dislikes: 0, reports: 0,
      changelog: [{ v: 1, at: now, note: "Published" }],
      createdAt: now,
      updatedAt: now
    });
    return res.status(200).json({ ok: true, slug, version: 1, updated: false, url: `https://${host}/play/${slug}` });
  }

  return res.status(400).json({ error: "Unknown request." });
}

// Validates and normalises the editable details (shared by publish /
// update / edit-details). `old` is the existing doc when editing.
async function buildMetaUpdate(db, user, body, old) {
  const uid = user.uid;
  const fields = {};

  if (body.title !== undefined) {
    const title = clean(body.title, 60);
    if (!title) return { error: "Give your creation a title." };
    fields.title = title;
  }
  if (body.description !== undefined) fields.description = clean(body.description, 600);
  if (body.genre !== undefined) fields.genre = GENRES.includes(body.genre) ? body.genre : "Other";
  if (body.tags !== undefined) fields.tags = cleanTags(body.tags);
  if (body.listed !== undefined) fields.listed = !!body.listed;
  if (!old && fields.listed === undefined) fields.listed = true;

  // creator identity: their account name / handle — never the raw email
  const handle = handleFromUser(user);
  fields.creatorHandle = handle;
  fields.creatorName = clean(body.creatorName, 30) || clean(user.name, 30) || handle.slice(1);

  // images (optional) — only replaced when a new one is sent
  if (body.iconDataUrl) {
    if (!dataUrlOk(body.iconDataUrl, MAX_ICON_BYTES)) return { error: "That icon is too big or isn't a PNG/JPG/WebP picture." };
    fields.iconBase64 = body.iconDataUrl;
  } else if (body.removeIcon) fields.iconBase64 = "";
  if (body.bannerDataUrl) {
    if (!dataUrlOk(body.bannerDataUrl, MAX_BANNER_BYTES)) return { error: "That banner is too big or isn't a PNG/JPG/WebP picture." };
    fields.bannerBase64 = body.bannerDataUrl;
  } else if (body.removeBanner) fields.bannerBase64 = "";

  // publishing "as a project" is a Starter-and-above feature
  if (body.projectId !== undefined) {
    if (!body.projectId) {
      fields.projectId = "";
      fields.projectName = "";
    } else {
      const plan = await planOf(db, uid);
      if (plan === "free") return { status: 403, error: "Publishing under a project needs the Starter plan or above." };
      const pSnap = await db.collection("projects").doc(String(body.projectId)).get();
      if (!pSnap.exists || !(pSnap.data().members || []).includes(uid)) return { status: 403, error: "You're not a member of that project." };
      fields.projectId = pSnap.id;
      fields.projectName = clean(pSnap.data().name, 60);
    }
  }
  return { fields };
}

// ======================= legacy website publish =======================
async function legacyPublish(req, res) {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: "Sign in to publish a live link." });
  const uid = user.uid;

  const { html, title, name } = req.body || {};
  if (!html || typeof html !== "string" || !html.trim()) {
    return res.status(400).json({ error: "Nothing to publish." });
  }
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
    return res.status(400).json({ error: "That page is too large to publish (900KB limit)." });
  }

  const db = getAdminDb();
  const collection = db.collection("publishedSites");
  let slug, ref, snap;
  const wantedSlug = slugifyName(name);

  if (wantedSlug) {
    for (let n = 0; n < 6 && !ref; n++) {
      const candidate = n === 0 ? wantedSlug : `${wantedSlug.replace(/-zyntraai-app$/, "")}-${n + 1}-zyntraai-app`;
      const candidateRef = collection.doc(candidate);
      const candidateSnap = await candidateRef.get();
      if (!candidateSnap.exists) { slug = candidate; ref = candidateRef; }
    }
  }
  if (!ref) {
    for (let attempt = 0; attempt < 5; attempt++) {
      slug = randomSlug(7);
      ref = collection.doc(slug);
      snap = await ref.get();
      if (!snap.exists) break;
    }
    if (snap && snap.exists) return res.status(500).json({ error: "Couldn't generate a free link. Please try again." });
  }

  await ref.set({
    html,
    title: (typeof title === "string" && title.trim()) ? title.trim().slice(0, 120) : "Zyntra site",
    uid,
    kind: "site",
    listed: false,
    createdAt: new Date().toISOString()
  });
  const host = req.headers.host || "zyntra-ai-psi.vercel.app";
  return res.status(200).json({ ok: true, url: `https://${host}/s/${slug}`, slug });
}
