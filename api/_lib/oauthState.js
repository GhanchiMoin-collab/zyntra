import crypto from "crypto";

// Carries {provider, uid} through the OAuth redirect round-trip
// unmodified — this is what lets ONE shared callback endpoint handle
// every provider, instead of a separate callback file per provider.
// Signed with HMAC-SHA256 using a server-only secret; a 10 minute
// expiry limits how long a captured state value could be replayed.
export function signState(provider, uid) {
  const secret = process.env.OAUTH_STATE_SECRET;
  if (!secret) throw new Error("OAUTH_STATE_SECRET environment variable is not set.");
  const payload = `${provider}.${uid}.${Date.now()}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}

export function verifyState(state) {
  const secret = process.env.OAUTH_STATE_SECRET;
  if (!secret) throw new Error("OAUTH_STATE_SECRET environment variable is not set.");
  const decoded = Buffer.from(state, "base64url").toString("utf8");
  const [provider, uid, ts, sig] = decoded.split(".");
  if (!provider || !uid || !ts || !sig) throw new Error("Malformed OAuth state.");
  const expectedSig = crypto.createHmac("sha256", secret).update(`${provider}.${uid}.${ts}`).digest("hex");
  if (sig !== expectedSig) throw new Error("OAuth state signature mismatch.");
  if (Date.now() - Number(ts) > 10 * 60 * 1000) throw new Error("OAuth state expired — please try connecting again.");
  return { provider, uid };
}
