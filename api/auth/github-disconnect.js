import { getAdminAuth } from "../_lib/firebaseAdmin.js";
import { getStoredGithubTokens, deleteStoredGithubTokens, revokeGithubToken } from "../_lib/githubOAuth.js";

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
    const stored = await getStoredGithubTokens(decoded.uid);
    if (stored?.access_token) {
      // Revoke on GitHub's side first (best-effort) so the grant doesn't
      // linger in the user's GitHub "Authorized OAuth Apps" list looking
      // connected after they've disconnected in Zyntra.
      await revokeGithubToken(stored.access_token);
    }
    await deleteStoredGithubTokens(decoded.uid);
    return res.status(200).json({ disconnected: true });
  } catch (err) {
    console.error("github-disconnect error:", err);
    return res.status(500).json({ error: "Couldn't disconnect GitHub account." });
  }
}
