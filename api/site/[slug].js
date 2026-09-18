import { getAdminDb } from "./_lib/firebaseAdmin.js";

// Serves back whatever was published via /api/publish. The stored HTML is
// AI-generated and untrusted, so it's never returned as the top-level
// document directly — that would run on zyntra-ai-psi.vercel.app's own
// origin and could reach this app's own localStorage/cookies. Instead it's
// wrapped in a sandboxed iframe with NO allow-same-origin, which gives it
// a unique opaque origin: its own JS still runs fine (buttons, forms,
// animations, fetch to other sites), it just can never touch anything
// belonging to the real Zyntra AI origin.
//
// This is a plain (non-dynamic) function reached via the /s/:slug ->
// /api/site?slug=:slug rewrite in vercel.json — a vercel.json rewrite
// landing on a SECOND dynamic segment (e.g. straight to api/site/[slug].js)
// is a known Vercel edge case that doesn't always resolve, so the slug is
// passed as a plain query param instead, which is the documented, reliable
// pattern for "rewrite -> serverless function".

function escapeHtmlAttr(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method not allowed');

  const slug = req.query?.slug;
  if (!slug || typeof slug !== "string") {
    return res.status(400).send('Missing link.');
  }

  try {
    const db = getAdminDb();
    const snap = await db.collection("publishedSites").doc(slug).get();

    if (!snap.exists) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(404).send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Not found</title>
        <style>body{font-family:sans-serif;background:#0b0b12;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;}</style>
        </head><body><div><h1>404</h1><p>This link doesn't exist or was never published.</p></div></body></html>`);
    }

    const data = snap.data();
    const title = escapeHtmlAttr(data.title || "Zyntra site");
    const srcdocAttr = escapeHtmlAttr(data.html || "");

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).send(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>html,body{margin:0;padding:0;height:100%;}iframe{width:100%;height:100%;border:0;display:block;}</style>
</head>
<body>
<iframe sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox" srcdoc="${srcdocAttr}"></iframe>
</body>
</html>`);
  } catch (error) {
    console.error("site serve error:", error);
    return res.status(500).send('Something went wrong loading this page.');
  }
}
