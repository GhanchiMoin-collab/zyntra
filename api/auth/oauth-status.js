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
    if (!idToken) return res.status(401).json({ error: "Not signed in." });

    const decoded = await getAdminAuth().verifyIdToken(idToken);
    const status = await provider.getStatus(decoded.uid);
    return res.status(200).json(status);
  } catch (err) {
    console.error(`oauth-status (${req.query.provider}) error:`, err);
    return res.status(500).json({ error: "Couldn't check connection status." });
  }
}
