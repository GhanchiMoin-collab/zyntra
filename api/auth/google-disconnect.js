import { getAdminAuth } from "../_lib/firebaseAdmin.js";
import { deleteStoredTokens } from "../_lib/googleOAuth.js";

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: "Not signed in." });

    const decoded = await getAdminAuth().verifyIdToken(idToken);
    await deleteStoredTokens(decoded.uid);
    return res.status(200).json({ disconnected: true });
  } catch (err) {
    console.error("google-disconnect error:", err);
    return res.status(500).json({ error: "Couldn't disconnect Google account." });
  }
}
