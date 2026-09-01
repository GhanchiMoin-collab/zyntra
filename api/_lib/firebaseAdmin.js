import admin from "firebase-admin";

// This is deliberately lazy — it only throws when something actually
// tries to use it, not on import. api/chat.js imports this module
// unconditionally, and chat needs to keep working even before Gmail/
// Calendar is set up, so a missing FIREBASE_SERVICE_ACCOUNT env var must
// never break plain chat requests.
let initialized = false;

function ensureInitialized() {
  if (initialized) return;
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountJson) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT environment variable is not set.");
  }
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(serviceAccountJson))
    });
  }
  initialized = true;
}

// Verifies a Firebase ID token (sent by the frontend as
// `Authorization: Bearer <token>`) and returns the trusted decoded
// token — this is the ONLY safe way to know which user a request is
// really from; never trust a uid sent as plain request data.
export function getAdminAuth() {
  ensureInitialized();
  return admin.auth();
}

// Firestore access via the Admin SDK bypasses firestore.rules entirely —
// used only for the oauth_tokens collection, which client-side code is
// never allowed to touch (see firestore.rules).
export function getAdminDb() {
  ensureInitialized();
  return admin.firestore();
}

export function isAdminConfigured() {
  return !!process.env.FIREBASE_SERVICE_ACCOUNT;
}

// Shorthand for Firestore's atomic increment — used by the usage-tracking
// writes in api/chat.js so concurrent requests from the same user never
// clobber each other's counts (unlike a read-then-write update).
export function increment(n) {
  return admin.firestore.FieldValue.increment(n);
}
