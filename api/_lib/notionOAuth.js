import { getAdminDb } from "./firebaseAdmin.js";
import { signState } from "./oauthState.js";

function clientId() { return process.env.NOTION_CLIENT_ID?.trim(); }
function clientSecret() { return process.env.NOTION_CLIENT_SECRET?.trim(); }

function redirectUri(req) {
  const appOrigin = process.env.APP_ORIGIN || `https://${req?.headers?.host || ""}`;
  return `${appOrigin}/api/auth/oauth-callback`;
}

export function getConsentUrl(uid, req) {
  if (!clientId()) throw new Error("Notion OAuth environment variables are not fully set.");
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(req),
    response_type: "code",
    owner: "user",
    state: signState("notion", uid)
  });
  return `https://api.notion.com/v1/oauth/authorize?${params.toString()}`;
}

// Notion uses HTTP Basic auth (client_id:client_secret) for the token
// exchange, unlike the form-encoded or JSON-body patterns the other
// providers use.
export async function exchangeCodeForToken(code, req) {
  if (!clientId() || !clientSecret()) {
    throw new Error("Notion OAuth environment variables are not fully set.");
  }
  const basic = Buffer.from(`${clientId()}:${clientSecret()}`).toString("base64");
  const res = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basic}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(req)
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || "notion_oauth_failed");
  return data; // { access_token, workspace_name, workspace_icon, workspace_id, owner, bot_id }
}

export async function saveNotionTokens(uid, tokenData) {
  const db = getAdminDb();
  await db.collection("notion_oauth_tokens").doc(uid).set({
    access_token: tokenData.access_token,
    workspace_id: tokenData.workspace_id || null,
    workspace_name: tokenData.workspace_name || null,
    bot_id: tokenData.bot_id || null,
    connectedAt: new Date().toISOString()
  }, { merge: true });
}

export async function getStoredNotionTokens(uid) {
  const db = getAdminDb();
  const snap = await db.collection("notion_oauth_tokens").doc(uid).get();
  return snap.exists ? snap.data() : null;
}

export async function deleteStoredNotionTokens(uid) {
  const db = getAdminDb();
  await db.collection("notion_oauth_tokens").doc(uid).delete();
}

// Notion has no public API to revoke a token server-side — disconnecting
// here only deletes our stored copy. The user can additionally remove
// Zyntra's access from their own Notion Settings & Members → Connections
// if they want to fully revoke it on Notion's side; we say so in the
// Privacy Policy since this genuinely differs from our other providers.
export async function getNotionAccessTokenForUser(uid) {
  try {
    const stored = await getStoredNotionTokens(uid);
    return stored?.access_token || null;
  } catch {
    return null;
  }
}
