import { getAdminAuth } from "../_lib/firebaseAdmin.js";
import { PROVIDERS } from "../_lib/oauthProviders.js";

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const provider = PROVIDERS[req.query.provider];
  if (!provider) return res.status(400).json({ error: `Unknown provider: ${req.query.provider}` });

  try {
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: "Sign in first, then try connecting again." });

    const decoded = await getAdminAuth().verifyIdToken(idToken);
    const url = await provider.getConsentUrl(decoded.uid, req);
    return res.status(200).json({ url });
  } catch (err) {
    console.error(`oauth-start (${req.query.provider}) error:`, err);
    return res.status(500).json({ error: "Couldn't start connecting: " + (err.message || "unknown error") });
  }
}
