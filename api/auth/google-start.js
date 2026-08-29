import { getAdminAuth } from "../_lib/firebaseAdmin.js";
import { getConsentUrl } from "../_lib/googleOAuth.js";

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: "Sign in first, then try connecting Google again." });

    const decoded = await getAdminAuth().verifyIdToken(idToken);
    const url = getConsentUrl(decoded.uid);
    return res.status(200).json({ url });
  } catch (err) {
    console.error("google-start error:", err);
    return res.status(500).json({ error: "Couldn't start connecting Google: " + (err.message || "unknown error") });
  }
}
