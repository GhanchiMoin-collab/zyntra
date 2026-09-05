import { verifyState, exchangeCodeForToken, saveGithubTokens } from "../_lib/githubOAuth.js";

// This endpoint is opened directly by the user's browser (GitHub redirects
// here after consent) — not called via fetch — so it responds with a
// redirect back into the app rather than JSON, same as google-callback.js.
export default async function handler(req, res) {
  const { code, state, error: githubError } = req.query;
  const appOrigin = process.env.APP_ORIGIN || `https://${req.headers.host}`;

  if (githubError) {
    return res.redirect(302, `${appOrigin}/?github_error=${encodeURIComponent(String(githubError))}`);
  }
  if (!code || !state) {
    return res.redirect(302, `${appOrigin}/?github_error=missing_code`);
  }

  try {
    const uid = verifyState(String(state));
    const tokenData = await exchangeCodeForToken(String(code), req);

    if (!tokenData.access_token) {
      return res.redirect(302, `${appOrigin}/?github_error=no_access_token`);
    }

    let githubLogin = null;
    try {
      const userRes = await fetch("https://api.github.com/user", {
        headers: {
          "Authorization": `Bearer ${tokenData.access_token}`,
          "Accept": "application/vnd.github+json"
        }
      });
      const userData = await userRes.json();
      githubLogin = userData.login || null;
    } catch {
      // Non-fatal — the connection still works without a displayed username.
    }

    await saveGithubTokens(uid, tokenData, githubLogin);
    return res.redirect(302, `${appOrigin}/?github_connected=1`);
  } catch (err) {
    console.error("github-callback error:", err);
    return res.redirect(302, `${appOrigin}/?github_error=${encodeURIComponent(err.message || "unknown")}`);
  }
}
