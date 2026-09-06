import { getAdminDb } from "./firebaseAdmin.js";
import { signState } from "./oauthState.js";

// Discord's OAuth model splits in two: a per-user token that only proves
// identity and server membership, and a separate bot token (one shared
// bot user across the whole app) that actually reads/sends messages —
// a plain user OAuth token can't call channel message endpoints at all.
// Including "bot" in scope makes the consent screen also let the user
// pick a server to add the bot to, combining "connect" and "invite bot"
// into one step. permissions=3072 = View Channels (1024) + Send Messages
// (2048) + Read Message History is covered by having View Channels for
// history reads via REST, kept intentionally minimal.
const SCOPES = "identify guilds bot";
const BOT_PERMISSIONS = "66560"; // View Channels + Send Messages + Read Message History

function clientId() { return process.env.DISCORD_CLIENT_ID?.trim(); }
function clientSecret() { return process.env.DISCORD_CLIENT_SECRET?.trim(); }
export function botToken() { return process.env.DISCORD_BOT_TOKEN?.trim(); }

function redirectUri(req) {
  const appOrigin = process.env.APP_ORIGIN || `https://${req?.headers?.host || ""}`;
  return `${appOrigin}/api/auth/oauth-callback`;
}

export function getConsentUrl(uid, req) {
  if (!clientId()) throw new Error("Discord OAuth environment variables are not fully set.");
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(req),
    response_type: "code",
    scope: SCOPES,
    permissions: BOT_PERMISSIONS,
    state: signState("discord", uid)
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(code, req) {
  if (!clientId() || !clientSecret()) {
    throw new Error("Discord OAuth environment variables are not fully set.");
  }
  const params = new URLSearchParams({
    client_id: clientId(),
    client_secret: clientSecret(),
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(req)
  });
  const res = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || "discord_oauth_failed");
  return data; // { access_token, guild? } — guild is present since scope includes "bot"
}

export async function saveDiscordTokens(uid, tokenData, identity) {
  const db = getAdminDb();
  await db.collection("discord_oauth_tokens").doc(uid).set({
    access_token: tokenData.access_token,
    guild_id: tokenData.guild?.id || null,
    guild_name: tokenData.guild?.name || null,
    username: identity?.username || null,
    connectedAt: new Date().toISOString()
  }, { merge: true });
}

export async function getStoredDiscordTokens(uid) {
  const db = getAdminDb();
  const snap = await db.collection("discord_oauth_tokens").doc(uid).get();
  return snap.exists ? snap.data() : null;
}

export async function deleteStoredDiscordTokens(uid) {
  const db = getAdminDb();
  await db.collection("discord_oauth_tokens").doc(uid).delete();
}

// Revokes the per-user OAuth token. This does NOT remove the bot from
// the server — Discord has no API for that; the user has to kick the
// bot from their server manually if they want it fully gone, same as
// removing any other Discord bot.
export async function revokeDiscordToken(access_token) {
  if (!clientId() || !clientSecret()) return;
  const params = new URLSearchParams({
    client_id: clientId(),
    client_secret: clientSecret(),
    token: access_token
  });
  await fetch("https://discord.com/api/oauth2/token/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  }).catch(err => console.error("Discord token revoke call failed (non-fatal):", err.message));
}

// Returns { guildId } for this user if connected, or null. The message
// tools use the shared bot token (not a per-user token) to actually call
// Discord's API, since only the bot — now a member of guildId — can read
// or send channel messages.
export async function getDiscordConnectionForUser(uid) {
  try {
    const stored = await getStoredDiscordTokens(uid);
    if (!stored || !stored.guild_id || !botToken()) return null;
    return { guildId: stored.guild_id, guildName: stored.guild_name };
  } catch {
    return null;
  }
}
