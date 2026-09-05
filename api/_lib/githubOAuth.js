import crypto from "crypto";
import { getAdminDb } from "./firebaseAdmin.js";
import { signState } from "./oauthState.js";

// "repo" grants read/write on repos, issues, and pull requests (including
// private repos the user has access to) — the narrowest single GitHub
// scope that covers everything Phase 1's actions need. There's no
// separate "issues only" or "PRs only" scope in GitHub's OAuth model.
const SCOPE = "repo";

function redirectUri(req) {
  const appOrigin = process.env.APP_ORIGIN || `https://${req?.headers?.host || ""}`;
  return `${appOrigin}/api/auth/oauth-callback`;
}

export function getConsentUrl(uid, req) {
  if (!process.env.GITHUB_CLIENT_ID) throw new Error("GitHub OAuth environment variables are not fully set.");
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: redirectUri(req),
    scope: SCOPE,
    state: signState("github", uid)
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(code, req) {
  if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
    throw new Error("GitHub OAuth environment variables are not fully set.");
  }
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri(req)
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error_description || data.error);
  return data; // { access_token, refresh_token?, expires_in?, scope, token_type }
}

export async function refreshAccessToken(refresh_token) {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error_description || data.error);
  return data;
}

// Stored in its own top-level collection (not oauth_tokens, which is
// Google's) so a bug in one provider's code can never clobber the
// other's tokens.
export async function saveGithubTokens(uid, tokenData, githubLogin) {
  const db = getAdminDb();
  const now = Date.now();
  await db.collection("github_oauth_tokens").doc(uid).set({
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token || null,
    // Only expiring-token GitHub apps return expires_in; classic tokens
    // don't expire, so expiresAt stays null for those.
    expiresAt: tokenData.expires_in ? now + tokenData.expires_in * 1000 : null,
    scope: tokenData.scope,
    github_login: githubLogin || null,
    connectedAt: new Date().toISOString()
  }, { merge: true });
}

export async function getStoredGithubTokens(uid) {
  const db = getAdminDb();
  const snap = await db.collection("github_oauth_tokens").doc(uid).get();
  return snap.exists ? snap.data() : null;
}

export async function deleteStoredGithubTokens(uid) {
  const db = getAdminDb();
  await db.collection("github_oauth_tokens").doc(uid).delete();
}

// Revokes the grant on GitHub's side too, not just locally — GitHub
// requires Basic-auth as the OAuth app itself to do this, not the
// user's token.
export async function revokeGithubToken(access_token) {
  if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) return;
  const basic = Buffer.from(`${process.env.GITHUB_CLIENT_ID}:${process.env.GITHUB_CLIENT_SECRET}`).toString("base64");
  await fetch(`https://api.github.com/applications/${process.env.GITHUB_CLIENT_ID}/token`, {
    method: "DELETE",
    headers: {
      "Authorization": `Basic ${basic}`,
      "Content-Type": "application/json",
      "Accept": "application/vnd.github+json"
    },
    body: JSON.stringify({ access_token })
  }).catch(err => console.error("GitHub token revoke call failed (non-fatal):", err.message));
}

// Returns a valid access token for this user, refreshing it first if the
// stored token is an expiring one that's run out. Returns null if the
// user hasn't connected GitHub, or if GitHub OAuth isn't configured yet.
export async function getGithubAccessTokenForUser(uid) {
  let stored;
  try {
    stored = await getStoredGithubTokens(uid);
  } catch {
    return null; // admin/Firestore not configured yet — degrade quietly
  }
  if (!stored || !stored.access_token) return null;

  if (stored.expiresAt && Date.now() > stored.expiresAt - 60000 && stored.refresh_token) {
    try {
      const refreshed = await refreshAccessToken(stored.refresh_token);
      await saveGithubTokens(uid, refreshed, stored.github_login);
      return refreshed.access_token;
    } catch (err) {
      console.error("GitHub token refresh failed:", err.message);
      return null; // stored token is stale and refresh failed — treat as disconnected
    }
  }
  return stored.access_token;
}
