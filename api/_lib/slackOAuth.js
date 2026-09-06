import { getAdminDb } from "./firebaseAdmin.js";
import { signState } from "./oauthState.js";

// User Token Scopes — acting as the user, not a bot, matching the pattern
// used for Gmail/Drive/GitHub. Covers public + private channels, DMs,
// group DMs, sending messages, searching workspace content, and looking
// up user names. Canvases scopes were granted on the Slack app but have
// no tool built yet — left as headroom for a later addition, not wired
// to anything right now.
const USER_SCOPES = [
  "channels:read", "channels:history",
  "groups:read", "groups:history",
  "im:history",
  "mpim:history",
  "chat:write",
  "users:read",
  "search:read.public", "search:read.private", "search:read.im", "search:read.mpim", "search:read.users"
].join(",");

function clientId() { return process.env.SLACK_CLIENT_ID?.trim(); }
function clientSecret() { return process.env.SLACK_CLIENT_SECRET?.trim(); }

function redirectUri(req) {
  const appOrigin = process.env.APP_ORIGIN || `https://${req?.headers?.host || ""}`;
  return `${appOrigin}/api/auth/oauth-callback`;
}

export function getConsentUrl(uid, req) {
  if (!clientId()) throw new Error("Slack OAuth environment variables are not fully set.");
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(req),
    user_scope: USER_SCOPES,
    state: signState("slack", uid)
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(code, req) {
  if (!clientId() || !clientSecret()) {
    throw new Error("Slack OAuth environment variables are not fully set.");
  }
  const params = new URLSearchParams({
    client_id: clientId(),
    client_secret: clientSecret(),
    code,
    redirect_uri: redirectUri(req)
  });
  const res = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "slack_oauth_failed");
  // We requested user_scope only (no bot scopes), so the token that acts
  // as the user lives under authed_user, not at the top level.
  if (!data.authed_user?.access_token) throw new Error("no_user_token");
  return data;
}

// Stored in its own top-level collection, isolated from Google's and
// GitHub's tokens the same way those are isolated from each other.
export async function saveSlackTokens(uid, tokenData, label) {
  const db = getAdminDb();
  await db.collection("slack_oauth_tokens").doc(uid).set({
    access_token: tokenData.authed_user.access_token,
    scope: tokenData.authed_user.scope || null,
    team_id: tokenData.team?.id || null,
    team_name: tokenData.team?.name || null,
    label: label || null,
    connectedAt: new Date().toISOString()
  }, { merge: true });
}

export async function getStoredSlackTokens(uid) {
  const db = getAdminDb();
  const snap = await db.collection("slack_oauth_tokens").doc(uid).get();
  return snap.exists ? snap.data() : null;
}

export async function deleteStoredSlackTokens(uid) {
  const db = getAdminDb();
  await db.collection("slack_oauth_tokens").doc(uid).delete();
}

// Classic Slack OAuth v2 user tokens (without token rotation enabled on
// the app) don't expire, so there's no refresh step — just revoke.
export async function revokeSlackToken(access_token) {
  await fetch("https://slack.com/api/auth.revoke", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${access_token}`,
      "Content-Type": "application/x-www-form-urlencoded"
    }
  }).catch(err => console.error("Slack token revoke call failed (non-fatal):", err.message));
}

// No refresh needed — just returns the stored token, or null if this
// user hasn't connected Slack (or Firestore isn't reachable).
export async function getSlackAccessTokenForUser(uid) {
  try {
    const stored = await getStoredSlackTokens(uid);
    return stored?.access_token || null;
  } catch {
    return null;
  }
}
