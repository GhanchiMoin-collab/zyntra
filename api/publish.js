import { getAdminAuth, getAdminDb } from "./_lib/firebaseAdmin.js";

// Instant Deploy: takes a single generated HTML file and gives it back a
// real, live, public URL instantly — no GitHub, no Vercel account, no
// build step. The HTML is stored in Firestore under a short random slug;
// api/site/[slug].js serves it back on request. Requires sign-in so
// publishing can't be used as an anonymous open relay for arbitrary
// content.

const MAX_HTML_BYTES = 2 * 1024 * 1024; // 2MB — generous for a single-file site, cheap to store
const SLUG_CHARS = "abcdefghijkmnpqrstuvwxyz23456789"; // no 0/o/1/l — avoids confusing shared links

function randomSlug(length = 7) {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += SLUG_CHARS[Math.floor(Math.random() * SLUG_CHARS.length)];
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: "Sign in to publish a live link." });

    const decoded = await getAdminAuth().verifyIdToken(idToken);
    const uid = decoded.uid;

    const { html, title } = req.body || {};
    if (!html || typeof html !== "string" || !html.trim()) {
      return res.status(400).json({ error: "Nothing to publish." });
    }
    if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
      return res.status(400).json({ error: "That page is too large to publish (2MB limit)." });
    }

    const db = getAdminDb();
    const collection = db.collection("publishedSites");

    // Slug collisions are astronomically unlikely at this space size, but
    // a couple of retries costs nothing and makes it a non-issue.
    let slug, ref, snap;
    for (let attempt = 0; attempt < 5; attempt++) {
      slug = randomSlug();
      ref = collection.doc(slug);
      snap = await ref.get();
      if (!snap.exists) break;
    }
    if (snap && snap.exists) {
      return res.status(500).json({ error: "Couldn't generate a free link. Please try again." });
    }

    await ref.set({
      html,
      title: (typeof title === "string" && title.trim()) ? title.trim().slice(0, 120) : "Zyntra site",
      uid,
      createdAt: new Date().toISOString()
    });

    const host = req.headers.host || "zyntra-ai-psi.vercel.app";
    const url = `https://${host}/s/${slug}`;
    return res.status(200).json({ ok: true, url, slug });
  } catch (error) {
    console.error("publish error:", error);
    return res.status(500).json({ error: "Something went wrong publishing this. Please try again." });
  }
}
