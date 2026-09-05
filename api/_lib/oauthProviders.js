import { google } from "googleapis";
import {
  buildOAuth2Client,
  getConsentUrl as googleConsentUrl,
  saveTokensForUser,
  getStoredTokens as getGoogleStoredTokens,
  deleteStoredTokens as deleteGoogleStoredTokens
} from "./googleOAuth.js";
import {
  getConsentUrl as githubConsentUrl,
  exchangeCodeForToken,
  saveGithubTokens,
  getStoredGithubTokens,
  deleteStoredGithubTokens,
  revokeGithubToken
} from "./githubOAuth.js";

// Each provider needs exactly 4 things: a consent URL, a way to turn an
// auth code into stored tokens + a display label, a status check, and a
// disconnect. Add a new integration by adding one entry here — the 4
// route files never need to change.
export const PROVIDERS = {
  google: {
    getConsentUrl: (uid) => googleConsentUrl(uid),
    async handleCallback(code, req, uid) {
      const client = buildOAuth2Client();
      const { tokens } = await client.getToken(code);
      if (!tokens.refresh_token) {
        // prompt=consent in getConsentUrl should prevent this, but guard
        // anyway rather than silently storing a connection that can't
        // actually refresh itself later.
        throw new Error("no_refresh_token");
      }
      client.setCredentials(tokens);
      let label = null;
      try {
        const oauth2 = google.oauth2({ auth: client, version: "v2" });
        const { data } = await oauth2.userinfo.get();
        label = data.email || null;
      } catch {
        // Non-fatal — the connection still works without a displayed email.
      }
      await saveTokensForUser(uid, tokens, label);
    },
    async getStatus(uid) {
      const stored = await getGoogleStoredTokens(uid);
      return { connected: !!(stored && stored.refresh_token), label: stored?.google_email || null };
    },
    async disconnect(uid) {
      await deleteGoogleStoredTokens(uid);
    }
  },
  github: {
    getConsentUrl: (uid, req) => githubConsentUrl(uid, req),
    async handleCallback(code, req, uid) {
      const tokenData = await exchangeCodeForToken(code, req);
      if (!tokenData.access_token) throw new Error("no_access_token");
      let label = null;
      try {
        const userRes = await fetch("https://api.github.com/user", {
          headers: { "Authorization": `Bearer ${tokenData.access_token}`, "Accept": "application/vnd.github+json" }
        });
        const userData = await userRes.json();
        label = userData.login || null;
      } catch {
        // Non-fatal — the connection still works without a displayed username.
      }
      await saveGithubTokens(uid, tokenData, label);
    },
    async getStatus(uid) {
      const stored = await getStoredGithubTokens(uid);
      return { connected: !!(stored && stored.access_token), label: stored?.github_login ? `@${stored.github_login}` : null };
    },
    async disconnect(uid) {
      const stored = await getStoredGithubTokens(uid);
      if (stored?.access_token) {
        // Best-effort revoke on GitHub's side too, so the grant doesn't
        // linger in the user's GitHub "Authorized OAuth Apps" list.
        await revokeGithubToken(stored.access_token);
      }
      await deleteStoredGithubTokens(uid);
    }
  }

  // Next provider goes here, following the same 4-method shape.
};
