import { google } from "googleapis";
import { buildOAuth2Client, verifyState, saveTokensForUser } from "../_lib/googleOAuth.js";

// This endpoint is opened directly by the user's browser (Google redirects
// here after consent) — not called via fetch — so it responds with a
// redirect back into the app rather than JSON.
export default async function handler(req, res) {
  const { code, state, error: googleError } = req.query;
  const appOrigin = process.env.APP_ORIGIN || `https://${req.headers.host}`;

  if (googleError) {
    return res.redirect(302, `${appOrigin}/?google_error=${encodeURIComponent(String(googleError))}`);
  }
  if (!code || !state) {
    return res.redirect(302, `${appOrigin}/?google_error=missing_code`);
  }

  try {
    const uid = verifyState(String(state));
    const client = buildOAuth2Client();
    const { tokens } = await client.getToken(String(code));

    if (!tokens.refresh_token) {
      // prompt=consent in google-start should prevent this, but guard
      // anyway rather than silently storing a connection that can't
      // actually refresh itself later.
      return res.redirect(302, `${appOrigin}/?google_error=no_refresh_token`);
    }

    client.setCredentials(tokens);
    let googleEmail = null;
    try {
      const oauth2 = google.oauth2({ auth: client, version: "v2" });
      const { data } = await oauth2.userinfo.get();
      googleEmail = data.email || null;
    } catch {
      // Non-fatal — the connection still works without a displayed email.
    }

    await saveTokensForUser(uid, tokens, googleEmail);
    return res.redirect(302, `${appOrigin}/?google_connected=1`);
  } catch (err) {
    console.error("google-callback error:", err);
    return res.redirect(302, `${appOrigin}/?google_error=${encodeURIComponent(err.message || "unknown")}`);
  }
}
