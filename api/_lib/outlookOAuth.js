import { getAdminDb } from "./firebaseAdmin.js";
import { signState } from "./oauthState.js";

// Microsoft Graph delegated scopes. offline_access is what makes a
// refresh_token come back at all — without it, the access token expires
// (~1 hour) with no way to renew it silently, unlike every other
// provider here except Trello (which requested a non-expiring token
// directly) and GitHub (whose classic tokens don't expire either).
const SCOPES = "offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send";

function clientId() { return process.env.MICROSOFT_CLIENT_ID?.trim(); }
function clientSecret() { return process.env.MICROSOFT_CLIENT_SECRET?.trim(); }

function redirectUri(req) {
  const appOrigin = process.env.APP_ORIGIN || `https://${req?.headers?.host || ""}`;
  return `${appOrigin}/api/auth/oauth-callback`;
}

export function getConsentUrl(uid, req) {
  if (!clientId()) throw new Error("Microsoft OAuth environment variables are not fully set.");
  const params = new URLSearchParams({
    client_id: clientId(),
    response_type: "code",
    redirect_uri: redirectUri(req),
    response_mode: "query",
    scope: SCOPES,
    state: signState("outlook", uid),
    prompt: "consent" // forces a fresh refresh_token even on a repeat connect, same reasoning as Google's prompt=consent
  });
  // "common" accepts both personal Microsoft accounts (outlook.com/hotmail)
  // and work/school (Microsoft 365) accounts through one endpoint.
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(code, req) {
  if (!clientId() || !clientSecret()) {
    throw new Error("Microsoft OAuth environment variables are not fully set.");
  }
  const params = new URLSearchParams({
    client_id: clientId(),
    client_secret: clientSecret(),
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(req),
    scope: SCOPES
  });
  const res = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || "microsoft_oauth_failed");
  return data; // { access_token, refresh_token, expires_in, ... }
}

export async function refreshAccessToken(refresh_token) {
  const params = new URLSearchParams({
    client_id: clientId(),
    client_secret: clientSecret(),
    grant_type: "refresh_token",
    refresh_token,
    scope: SCOPES
  });
  const res = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || "microsoft_refresh_failed");
  return data;
}

export async function saveOutlookTokens(uid, tokenData, email) {
  const db = getAdminDb();
  const now = Date.now();
  await db.collection("outlook_oauth_tokens").doc(uid).set({
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token || null,
    expiresAt: tokenData.expires_in ? now + tokenData.expires_in * 1000 : null,
    email: email || null,
    connectedAt: new Date().toISOString()
  }, { merge: true });
}

export async function getStoredOutlookTokens(uid) {
  const db = getAdminDb();
  const snap = await db.collection("outlook_oauth_tokens").doc(uid).get();
  return snap.exists ? snap.data() : null;
}

export async function deleteStoredOutlookTokens(uid) {
  const db = getAdminDb();
  await db.collection("outlook_oauth_tokens").doc(uid).delete();
}

// Microsoft has no simple "revoke this one token" REST endpoint like
// GitHub/Slack/Trello — the closest equivalent (revoking sign-in
// sessions) affects the whole Microsoft account, not just this app, so
// we don't call it. Disconnecting here removes our stored copy; for
// full removal the user can also visit account.live.com/consent/Manage
// (personal) or their org's Enterprise Apps list (work/school) to
// remove Zyntra's access directly — mentioned in the Privacy Policy.
export async function deleteOutlookAccess(uid) {
  await deleteStoredOutlookTokens(uid);
}

// Refreshes first if the stored access token has expired. Returns null
// if not connected, or if a stale token's refresh attempt fails.
export async function getOutlookAccessTokenForUser(uid) {
  let stored;
  try {
    stored = await getStoredOutlookTokens(uid);
  } catch {
    return null;
  }
  if (!stored || !stored.access_token) return null;

  if (stored.expiresAt && Date.now() > stored.expiresAt - 60000 && stored.refresh_token) {
    try {
      const refreshed = await refreshAccessToken(stored.refresh_token);
      await saveOutlookTokens(uid, refreshed, stored.email);
      return refreshed.access_token;
    } catch (err) {
      console.error("Outlook token refresh failed:", err.message);
      return null;
    }
  }
  return stored.access_token;
}
