import { getAdminDb } from "./firebaseAdmin.js";
import { signState } from "./oauthState.js";

// Trello's auth model predates OAuth2 — there's no client secret, and no
// authorization code to exchange. The "key" is public (like a client id),
// and authorizing returns a usable token directly. That token arrives in
// a URL fragment (#token=...), which browsers never send to a server —
// so it can't land on a normal serverless callback like every other
// provider here. /trello-bridge.html (a static page) reads the fragment
// client-side and forwards it to our shared oauth-callback endpoint as
// if it were an OAuth "code", so the rest of the system doesn't need a
// special case for Trello at all.
function apiKey() { return process.env.TRELLO_API_KEY?.trim(); }

function bridgeUrl(req) {
  const appOrigin = process.env.APP_ORIGIN || `https://${req?.headers?.host || ""}`;
  return `${appOrigin}/trello-bridge.html`;
}

export function getConsentUrl(uid, req) {
  if (!apiKey()) throw new Error("Trello API key is not set.");
  const params = new URLSearchParams({
    key: apiKey(),
    name: "Zyntra AI",
    scope: "read,write",
    expiration: "never",
    response_type: "token",
    return_url: `${bridgeUrl(req)}?state=${encodeURIComponent(signState("trello", uid))}`
  });
  return `https://trello.com/1/authorize?${params.toString()}`;
}

// "code" here is really just the Trello token itself — nothing to
// exchange, unlike every other provider. We still fetch the user's
// identity so there's something to show as "Connected as X".
export async function exchangeCodeForToken(code) {
  if (!apiKey()) throw new Error("Trello API key is not set.");
  const res = await fetch(`https://api.trello.com/1/members/me?key=${apiKey()}&token=${code}&fields=username,fullName`);
  if (!res.ok) throw new Error("Invalid or expired Trello token.");
  const member = await res.json();
  return { access_token: code, username: member.username, fullName: member.fullName };
}

export async function saveTrelloTokens(uid, tokenData) {
  const db = getAdminDb();
  await db.collection("trello_oauth_tokens").doc(uid).set({
    access_token: tokenData.access_token,
    username: tokenData.username || null,
    connectedAt: new Date().toISOString()
  }, { merge: true });
}

export async function getStoredTrelloTokens(uid) {
  const db = getAdminDb();
  const snap = await db.collection("trello_oauth_tokens").doc(uid).get();
  return snap.exists ? snap.data() : null;
}

export async function deleteStoredTrelloTokens(uid) {
  const db = getAdminDb();
  await db.collection("trello_oauth_tokens").doc(uid).delete();
}

// Trello does have a real revoke endpoint (unlike Notion) — this
// actually invalidates the token on Trello's side, not just locally.
export async function revokeTrelloToken(token) {
  if (!apiKey()) return;
  await fetch(`https://api.trello.com/1/tokens/${token}?key=${apiKey()}&token=${token}`, {
    method: "DELETE"
  }).catch(err => console.error("Trello token revoke call failed (non-fatal):", err.message));
}

// expiration=never was requested at consent time, so there's no refresh
// concept — just return the stored token, or null if not connected.
export async function getTrelloAccessTokenForUser(uid) {
  try {
    const stored = await getStoredTrelloTokens(uid);
    return stored?.access_token || null;
  } catch {
    return null;
  }
}
