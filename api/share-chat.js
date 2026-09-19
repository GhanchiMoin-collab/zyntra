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

  const { messages, title } = req.body || {};
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

  await ref.set({
    messages: cleanMessages,
    title: (typeof title === "string" && title.trim()) ? title.trim().slice(0, 120) : "A Zyntra AI conversation",
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

export default async function handler(req, res) {
  try {
    if (req.method === "POST") return await handleCreate(req, res);
    if (req.method === "GET") return await handleFetch(req, res);
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("share-chat error:", error);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
}
