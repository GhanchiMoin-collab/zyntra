import { getAdminAuth } from "../_lib/firebaseAdmin.js";
import { PROVIDERS } from "../_lib/oauthProviders.js";

// Merges what used to be oauth-start.js, oauth-status.js and
// oauth-disconnect.js into one function (Vercel's Hobby plan caps a
// deployment at 12 total serverless functions — this alone frees up 2
// slots). Branches on ?action=start|status|disconnect.
//
// oauth-callback.js is NOT merged in here on purpose: its URL is
// registered directly inside Google/GitHub/Slack/Discord/Notion/Trello/
// Outlook's own developer consoles as the OAuth redirect URI. Renaming or
// merging it would silently break every connection until each of those
// external settings pages is updated by hand — not worth the risk for
// one more saved slot.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, provider: providerKey } = req.query;
  const provider = PROVIDERS[providerKey];
  if (!provider) return res.status(400).json({ error: `Unknown provider: ${providerKey}` });

  try {
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (action === "start") {
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      if (!idToken) return res.status(401).json({ error: "Sign in first, then try connecting again." });
      const decoded = await getAdminAuth().verifyIdToken(idToken);
      const url = await provider.getConsentUrl(decoded.uid, req);
      return res.status(200).json({ url });
    }

    if (action === "status") {
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      if (!idToken) return res.status(401).json({ error: "Not signed in." });
      const decoded = await getAdminAuth().verifyIdToken(idToken);
      const status = await provider.getStatus(decoded.uid);
      return res.status(200).json(status);
    }

    if (action === "disconnect") {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      if (!idToken) return res.status(401).json({ error: "Not signed in." });
      const decoded = await getAdminAuth().verifyIdToken(idToken);
      await provider.disconnect(decoded.uid);
      return res.status(200).json({ disconnected: true });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    console.error(`oauth-manage (${action}/${providerKey}) error:`, err);
    return res.status(500).json({ error: err.message || "Something went wrong." });
  }
}
