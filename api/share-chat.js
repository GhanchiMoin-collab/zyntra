import { getAdminAuth, getAdminDb } from "./_lib/firebaseAdmin.js";

// Share Chat: takes a snapshot of the current conversation and makes it
// viewable via a public read-only link — like ChatGPT's "Share" button.
// One file handles both directions to save a function slot (Vercel's
// free plan caps a deployment at 12 total):
//   POST -> create a share (requires sign-in)
//   GET  -> fetch a share by ?id= for the read-only /share/:id page (public, no sign-in)

const MAX_MESSAGES = 200; // a very long chat only needs its recent context shared
const SLUG_CHARS = "abcdefghijkmnpqrstuvwxyz23456789"; // no 0/o/1/l — avoids confusing shared links

function randomSlug(length = 9) {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += SLUG_CHARS[Math.floor(Math.random() * SLUG_CHARS.length)];
  }
  return out;
}

async function handleCreate(req, res) {
  const authHeader = req.headers.authorization || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) return res.status(401).json({ error: "Sign in to share a chat." });

  const decoded = await getAdminAuth().verifyIdToken(idToken);
  const uid = decoded.uid;

  const { messages, title, makePublic } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Nothing to share yet." });
  }

  // Only keep the shape a viewer actually needs — strips anything else
  // (tool-call internals, etc.) that might have ended up in the array.
  const cleanMessages = messages
    .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-MAX_MESSAGES)
    .map(m => ({ role: m.role, content: m.content }));

  if (cleanMessages.length === 0) {
    return res.status(400).json({ error: "Nothing to share yet." });
  }

  const db = getAdminDb();
  const collection = db.collection("sharedChats");

  let id, ref, snap;
  for (let attempt = 0; attempt < 5; attempt++) {
    id = randomSlug();
    ref = collection.doc(id);
    snap = await ref.get();
    if (!snap.exists) break;
  }
  if (snap && snap.exists) {
    return res.status(500).json({ error: "Couldn't generate a free link. Please try again." });
  }

  const firstUserMsg = cleanMessages.find(m => m.role === "user");
  const preview = firstUserMsg ? firstUserMsg.content.slice(0, 140) : "";

  await ref.set({
    messages: cleanMessages,
    title: (typeof title === "string" && title.trim()) ? title.trim().slice(0, 120) : "A Zyntra AI conversation",
    preview,
    public: !!makePublic,
    uid,
    createdAt: new Date().toISOString()
  });

  const host = req.headers.host || "zyntra-ai-psi.vercel.app";
  const url = `https://${host}/share/${id}`;
  return res.status(200).json({ ok: true, url, id });
}

async function handleFetch(req, res) {
  const id = req.query?.id;
  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Missing link." });
  }

  const snap = await getAdminDb().collection("sharedChats").doc(id).get();
  if (!snap.exists) {
    return res.status(404).json({ error: "This shared chat doesn't exist or was removed." });
  }

  const data = snap.data();
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.status(200).json({
    ok: true,
    title: data.title || "A Zyntra AI conversation",
    messages: Array.isArray(data.messages) ? data.messages : []
  });
}

// Powers the /discover page — recent conversations people explicitly
// chose to feature publicly. Deliberately just a single-field equality
// filter (no orderBy on a different field in the query itself) so this
// never needs a manual Firestore composite index — sorting by recency
// happens here in JS after the fetch instead.
async function handleList(req, res) {
  const snap = await getAdminDb().collection("sharedChats")
    .where("public", "==", true)
    .limit(200)
    .get();

  const items = snap.docs
    .map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        title: data.title || "A Zyntra AI conversation",
        preview: data.preview || "",
        createdAt: data.createdAt || ""
      };
    })
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
    .slice(0, 30);

  res.setHeader("Cache-Control", "public, max-age=120");
  return res.status(200).json({ ok: true, items });
}

async function requireAuth(req) {
  const authHeader = req.headers.authorization || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) return null;
  try {
    return await getAdminAuth().verifyIdToken(idToken);
  } catch {
    return null;
  }
}

// Powers a "My Shared Chats" management list — every share the signed-in
// user has made, public or private, so they can find one to delete.
// Same single-field-filter-then-sort-in-JS trick as handleList to avoid
// needing a Firestore composite index.
async function handleMine(req, res) {
  const decoded = await requireAuth(req);
  if (!decoded) return res.status(401).json({ error: "Sign in first." });

  const snap = await getAdminDb().collection("sharedChats")
    .where("uid", "==", decoded.uid)
    .limit(200)
    .get();

  const items = snap.docs
    .map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        title: data.title || "A Zyntra AI conversation",
        preview: data.preview || "",
        public: !!data.public,
        createdAt: data.createdAt || ""
      };
    })
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  return res.status(200).json({ ok: true, items });
}

// Deletes a share — only the person who created it can remove it. Also
// takes it off Discover automatically, since it's the same document.
async function handleDelete(req, res) {
  const decoded = await requireAuth(req);
  if (!decoded) return res.status(401).json({ error: "Sign in first." });

  const id = req.query?.id;
  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Missing link." });
  }

  const ref = getAdminDb().collection("sharedChats").doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    return res.status(404).json({ error: "That share doesn't exist (maybe already deleted)." });
  }
  if (snap.data().uid !== decoded.uid) {
    return res.status(403).json({ error: "You can only delete your own shared chats." });
  }

  await ref.delete();
  return res.status(200).json({ ok: true });
}

export default async function handler(req, res) {
  try {
    if (req.method === "POST") return await handleCreate(req, res);
    if (req.method === "DELETE") return await handleDelete(req, res);
    if (req.method === "GET") {
      if (req.query?.mine !== undefined) return await handleMine(req, res);
      if (req.query?.list !== undefined) return await handleList(req, res);
      return await handleFetch(req, res);
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("share-chat error:", error);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
}
