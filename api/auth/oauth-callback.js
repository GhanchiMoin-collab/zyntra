import { verifyState } from "../_lib/oauthState.js";
import { PROVIDERS } from "../_lib/oauthProviders.js";

// Opened directly by the user's browser (the provider redirects here after
// consent) — not called via fetch — so it responds with a redirect back
// into the app rather than JSON.
export default async function handler(req, res) {
  const { code, state, error: providerError } = req.query;
  const appOrigin = process.env.APP_ORIGIN || `https://${req.headers.host}`;

  // We don't know which provider this is until the state is decoded, so
  // an early error (before we can decode it) has nowhere provider-specific
  // to redirect to — fall back to a generic error param.
  if (!state) {
    return res.redirect(302, `${appOrigin}/?oauth_error=missing_state`);
  }

  let provider, uid;
  try {
    ({ provider, uid } = verifyState(String(state)));
  } catch (err) {
    console.error("oauth-callback state error:", err);
    return res.redirect(302, `${appOrigin}/?oauth_error=${encodeURIComponent(err.message || "invalid_state")}`);
  }

  if (providerError) {
    return res.redirect(302, `${appOrigin}/?${provider}_error=${encodeURIComponent(String(providerError))}`);
  }
  if (!code) {
    return res.redirect(302, `${appOrigin}/?${provider}_error=missing_code`);
  }

  const providerImpl = PROVIDERS[provider];
  if (!providerImpl) {
    return res.redirect(302, `${appOrigin}/?oauth_error=unknown_provider`);
  }

  try {
    await providerImpl.handleCallback(String(code), req, uid);
    return res.redirect(302, `${appOrigin}/?${provider}_connected=1`);
  } catch (err) {
    console.error(`oauth-callback (${provider}) error:`, err);
    return res.redirect(302, `${appOrigin}/?${provider}_error=${encodeURIComponent(err.message || "unknown")}`);
  }
}
