import { getAdminAuth } from "../_lib/firebaseAdmin.js";
import { getStoredGithubTokens } from "../_lib/githubOAuth.js";

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: "Not signed in." });

    const decoded = await getAdminAuth().verifyIdToken(idToken);
    const stored = await getStoredGithubTokens(decoded.uid);
    return res.status(200).json({
      connected: !!(stored && stored.access_token),
      githubLogin: stored?.github_login || null
    });
  } catch (err) {
    console.error("github-status error:", err);
    return res.status(500).json({ error: "Couldn't check GitHub connection status." });
  }
}
