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
import {
  getConsentUrl as slackConsentUrl,
  exchangeCodeForToken as slackExchangeCodeForToken,
  saveSlackTokens,
  getStoredSlackTokens,
  deleteStoredSlackTokens,
  revokeSlackToken
} from "./slackOAuth.js";
import {
  getConsentUrl as discordConsentUrl,
  exchangeCodeForToken as discordExchangeCodeForToken,
  saveDiscordTokens,
  getStoredDiscordTokens,
  deleteStoredDiscordTokens,
  revokeDiscordToken,
  botToken as discordBotToken
} from "./discordOAuth.js";
import {
  getConsentUrl as notionConsentUrl,
  exchangeCodeForToken as notionExchangeCodeForToken,
  saveNotionTokens,
  getStoredNotionTokens,
  deleteStoredNotionTokens
} from "./notionOAuth.js";
import {
  getConsentUrl as trelloConsentUrl,
  exchangeCodeForToken as trelloExchangeCodeForToken,
  saveTrelloTokens,
  getStoredTrelloTokens,
  deleteStoredTrelloTokens,
  revokeTrelloToken
} from "./trelloOAuth.js";
import {
  getConsentUrl as outlookConsentUrl,
  exchangeCodeForToken as outlookExchangeCodeForToken,
  saveOutlookTokens,
  getStoredOutlookTokens,
  deleteOutlookAccess
} from "./outlookOAuth.js";

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
  },
  slack: {
    getConsentUrl: (uid, req) => slackConsentUrl(uid, req),
    async handleCallback(code, req, uid) {
      const tokenData = await slackExchangeCodeForToken(code, req);
      const label = tokenData.team?.name ? `${tokenData.team.name}` : null;
      await saveSlackTokens(uid, tokenData, label);
    },
    async getStatus(uid) {
      const stored = await getStoredSlackTokens(uid);
      return { connected: !!(stored && stored.access_token), label: stored?.team_name ? `${stored.team_name} workspace` : null };
    },
    async disconnect(uid) {
      const stored = await getStoredSlackTokens(uid);
      if (stored?.access_token) {
        await revokeSlackToken(stored.access_token);
      }
      await deleteStoredSlackTokens(uid);
    }
  },
  discord: {
    getConsentUrl: (uid, req) => discordConsentUrl(uid, req),
    async handleCallback(code, req, uid) {
      const tokenData = await discordExchangeCodeForToken(code, req);
      if (!tokenData.guild) {
        // Scope includes "bot", so a successful auth without a chosen
        // server means the user cancelled the server picker — the token
        // alone isn't useful for anything Zyntra can do.
        throw new Error("no_server_selected");
      }
      let identity = null;
      try {
        const userRes = await fetch("https://discord.com/api/users/@me", {
          headers: { "Authorization": `Bearer ${tokenData.access_token}` }
        });
        identity = await userRes.json();
      } catch {
        // Non-fatal — the connection still works without a displayed username.
      }
      await saveDiscordTokens(uid, tokenData, identity);
    },
    async getStatus(uid) {
      const stored = await getStoredDiscordTokens(uid);
      return { connected: !!(stored && stored.guild_id && discordBotToken()), label: stored?.guild_name ? `${stored.guild_name} server` : null };
    },
    async disconnect(uid) {
      const stored = await getStoredDiscordTokens(uid);
      if (stored?.access_token) {
        await revokeDiscordToken(stored.access_token);
      }
      await deleteStoredDiscordTokens(uid);
      // Note: this revokes the user's own OAuth grant, but does not
      // remove the bot from their server — Discord has no API for that;
      // the user removes the bot manually from Server Settings if wanted.
    }
  },
  notion: {
    getConsentUrl: (uid, req) => notionConsentUrl(uid, req),
    async handleCallback(code, req, uid) {
      const tokenData = await notionExchangeCodeForToken(code, req);
      await saveNotionTokens(uid, tokenData);
    },
    async getStatus(uid) {
      const stored = await getStoredNotionTokens(uid);
      return { connected: !!(stored && stored.access_token), label: stored?.workspace_name || null };
    },
    async disconnect(uid) {
      // Notion has no server-side revoke API — see notionOAuth.js for
      // why this only removes our stored copy, not Notion-side access.
      await deleteStoredNotionTokens(uid);
    }
  },
  trello: {
    getConsentUrl: (uid, req) => trelloConsentUrl(uid, req),
    async handleCallback(code, req, uid) {
      // "code" here is the Trello token itself, forwarded by
      // trello-bridge.html — see trelloOAuth.js for why there's no
      // actual exchange step, unlike every other provider.
      const tokenData = await trelloExchangeCodeForToken(code);
      await saveTrelloTokens(uid, tokenData);
    },
    async getStatus(uid) {
      const stored = await getStoredTrelloTokens(uid);
      return { connected: !!(stored && stored.access_token), label: stored?.username ? `@${stored.username}` : null };
    },
    async disconnect(uid) {
      const stored = await getStoredTrelloTokens(uid);
      if (stored?.access_token) {
        await revokeTrelloToken(stored.access_token);
      }
      await deleteStoredTrelloTokens(uid);
    }
  },
  outlook: {
    getConsentUrl: (uid, req) => outlookConsentUrl(uid, req),
    async handleCallback(code, req, uid) {
      const tokenData = await outlookExchangeCodeForToken(code, req);
      if (!tokenData.refresh_token) {
        // prompt=consent in getConsentUrl should prevent this, but guard
        // anyway rather than silently storing a connection that can't
        // refresh itself once the short-lived access token expires.
        throw new Error("no_refresh_token");
      }
      let email = null;
      try {
        const meRes = await fetch("https://graph.microsoft.com/v1.0/me", {
          headers: { "Authorization": `Bearer ${tokenData.access_token}` }
        });
        const me = await meRes.json();
        email = me.mail || me.userPrincipalName || null;
      } catch {
        // Non-fatal — the connection still works without a displayed email.
      }
      await saveOutlookTokens(uid, tokenData, email);
    },
    async getStatus(uid) {
      const stored = await getStoredOutlookTokens(uid);
      return { connected: !!(stored && stored.refresh_token), label: stored?.email || null };
    },
    async disconnect(uid) {
      // See outlookOAuth.js for why this only removes our stored copy —
      // Microsoft has no simple per-app token revoke API like the others.
      await deleteOutlookAccess(uid);
    }
  }

  // Next provider goes here, following the same 4-method shape.
};
