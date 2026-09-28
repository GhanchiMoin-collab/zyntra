import { verifyState } from "../_lib/oauthState.js";
import { PROVIDERS } from "../_lib/oauthProviders.js";
import { getAdminAuth } from "../_lib/firebaseAdmin.js";

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

  // "Sign in with <provider>": state carries the sentinel uid "signin"
  // instead of a real user id (see getSigninConsentUrl in
  // discordOAuth.js). Instead of saving connector tokens, this looks up
  // or creates a Firebase account keyed to the provider's own user id,
  // mints a custom token for it, and hands that back to the browser to
  // sign in with signInWithCustomToken().
  if (uid === "signin") {
    if (!providerImpl.handleSigninCallback) {
      return res.redirect(302, `${appOrigin}/login?oauth_error=${encodeURIComponent(`Sign-in with ${provider} isn't supported.`)}`);
    }
    try {
      const { externalId, email, displayName } = await providerImpl.handleSigninCallback(String(code), req);
      const firebaseUid = `${provider}:${externalId}`;
      const auth = getAdminAuth();

      try {
        await auth.getUser(firebaseUid);
      } catch {
        // First time this provider account has signed in — create it.
        // If the provider's verified email already belongs to a
        // different Firebase account (e.g. they signed up earlier with
        // email/password), don't fail the whole sign-in over it: create
        // the account without attaching the email instead.
        try {
          await auth.createUser({
            uid: firebaseUid,
            email: email || undefined,
            emailVerified: !!email,
            displayName: displayName || undefined
          });
        } catch (createErr) {
          if (createErr.code === "auth/email-already-exists") {
            await auth.createUser({ uid: firebaseUid, displayName: displayName || undefined });
          } else {
            throw createErr;
          }
        }
      }

      const customToken = await auth.createCustomToken(firebaseUid);
      // URL fragment, not query string: fragments aren't sent to servers
      // or included in Referer headers, so the token doesn't leak into
      // logs or analytics the way a query param could.
      return res.redirect(302, `${appOrigin}/login#${provider}_token=${encodeURIComponent(customToken)}`);
    } catch (err) {
      console.error(`oauth-callback signin (${provider}) error:`, err);
      return res.redirect(302, `${appOrigin}/login?oauth_error=${encodeURIComponent(err.message || "signin_failed")}`);
    }
  }

  try {
    await providerImpl.handleCallback(String(code), req, uid);
    return res.redirect(302, `${appOrigin}/?${provider}_connected=1`);
  } catch (err) {
    console.error(`oauth-callback (${provider}) error:`, err);
    return res.redirect(302, `${appOrigin}/?${provider}_error=${encodeURIComponent(err.message || "unknown")}`);
  }
}
