import crypto from "crypto";
import { google } from "googleapis";
import { getAdminDb } from "./firebaseAdmin.js";
import { signState } from "./oauthState.js";

// gmail.send lets Zyntra send email AS the user, from their own address —
// it can't read their inbox. calendar.events is scoped to managing
// events only, not the rest of Calendar settings. drive.readonly lets
// Zyntra search/read the user's existing files (needed since we can't
// know a file's ID without search); drive.file is separate and only
// covers files Zyntra itself creates, never the rest of the user's Drive.
const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file"
];

export function buildOAuth2Client() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI) {
    throw new Error("Google OAuth environment variables are not fully set.");
  }
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function getConsentUrl(uid) {
  const client = buildOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline", // required to get a refresh_token back
    prompt: "consent",      // forces Google to re-issue a refresh_token even on a repeat connect
    scope: SCOPES,
    state: signState("google", uid)
  });
}

export async function saveTokensForUser(uid, tokens, googleEmail) {
  const db = getAdminDb();
  await db.collection("oauth_tokens").doc(uid).set({
    provider: "google",
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token,
    expiry_date: tokens.expiry_date,
    scope: tokens.scope,
    google_email: googleEmail || null,
    connectedAt: new Date().toISOString()
  }, { merge: true });
}

export async function getStoredTokens(uid) {
  const db = getAdminDb();
  const snap = await db.collection("oauth_tokens").doc(uid).get();
  return snap.exists ? snap.data() : null;
}

export async function deleteStoredTokens(uid) {
  const db = getAdminDb();
  await db.collection("oauth_tokens").doc(uid).delete();
}

// Returns an OAuth2Client preloaded with this user's stored refresh
// token, ready for Gmail/Calendar API calls — googleapis refreshes the
// access token automatically when it's expired. Returns null if the
// user hasn't connected Google, or if Google OAuth isn't configured yet.
export async function getAuthorizedClientForUser(uid) {
  let stored;
  try {
    stored = await getStoredTokens(uid);
  } catch {
    return null; // admin/Firestore not configured yet — degrade quietly
  }
  if (!stored || !stored.refresh_token) return null;
  let client;
  try {
    client = buildOAuth2Client();
  } catch {
    return null; // Google OAuth env vars not configured yet
  }
  client.setCredentials({ refresh_token: stored.refresh_token });
  return client;
}
