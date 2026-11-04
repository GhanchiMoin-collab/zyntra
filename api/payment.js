import { getAdminAuth, getAdminDb, arrayRemove } from "./_lib/firebaseAdmin.js";
import { effectivePlan, PLAN_DURATION_MS } from "./_lib/plan.js";

// Razorpay integration for plan upgrades. Combined into one action-based
// endpoint (?action=create-order | verify) so this stays a single Vercel
// function — same reasoning as the earlier oauth-manage.js merge, since
// the Hobby plan caps serverless functions at 12 and this repo is
// already sitting right at that line. Replaces the old, unwired,
// never-deployed Stripe api/checkout.js stub.
//
// Uses Razorpay's plain REST API via fetch (Basic Auth: key_id:key_secret)
// rather than their SDK, matching how the rest of this codebase talks to
// Groq/Tavily — no new npm dependency to bundle.
//
// SECURITY: a user's plan is never trusted from the client. It lives in
// its own `billing/{uid}` Firestore doc that firestore.rules locks to
// read-only for the client (write: false) — only this server-verified
// flow, via the Admin SDK, can ever change it. Storing it on the normal
// per-user doc instead would let a client just sync a fake "plan":"ultra"
// straight past Firestore rules, since that doc's rule allows the owner
// to write anything on it.

const PLAN_PRICES_INR = {
  starter: 99,
  pro: 199,
  ultra: 499
};

// ================= Referrals =================
// Bonus messages stack on top of a plan's base monthly limit (see
// PLAN_LIMITS in api/chat.js, which reads billing/{uid}.bonusMessages).
// Both sides of a referral get the same bonus — simple and easy to
// explain in the UI. referralCodes/{code} is a separate lookup
// collection (locked to server-only access in firestore.rules, same as
// oauth_tokens) so a code can be resolved to a uid without exposing the
// whole billing collection to client-side Firestore queries.
const REFERRAL_BONUS_MESSAGES = 20;
const REFERRAL_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I — easy to read/type aloud

function generateReferralCode() {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += REFERRAL_CODE_CHARS[Math.floor(Math.random() * REFERRAL_CODE_CHARS.length)];
  }
  return code;
}

async function handleGetReferralInfo(req, res) {
  const uid = await requireUser(req);
  const db = getAdminDb();
  const billingRef = db.collection("billing").doc(uid);
  const snap = await billingRef.get();
  const data = snap.exists ? snap.data() : {};

  let code = data.referralCode;
  if (!code) {
    // First time this user has asked — mint a code, retrying on the
    // (very unlikely) chance of a collision with an existing one.
    for (let attempt = 0; attempt < 5 && !code; attempt++) {
      const candidate = generateReferralCode();
      const codeRef = db.collection("referralCodes").doc(candidate);
      const codeSnap = await codeRef.get();
      if (!codeSnap.exists) {
        await codeRef.set({ uid, createdAt: Date.now() });
        await billingRef.set({ referralCode: candidate }, { merge: true });
        code = candidate;
      }
    }
    if (!code) {
      return res.status(500).json({ error: "Couldn't generate a referral code right now — try again in a moment." });
    }
  }

  return res.status(200).json({
    code,
    referralCount: data.referralCount || 0,
    bonusMessages: data.bonusMessages || 0,
    referredBy: data.referredBy || null
  });
}

async function handleClaimReferral(req, res) {
  const uid = await requireUser(req);
  const { code } = req.body || {};
  if (!code || typeof code !== "string") {
    return res.status(400).json({ error: "Missing referral code." });
  }
  const normalizedCode = code.trim().toUpperCase();

  const db = getAdminDb();
  const codeRef = db.collection("referralCodes").doc(normalizedCode);
  const newUserBillingRef = db.collection("billing").doc(uid);

  try {
    const result = await db.runTransaction(async (tx) => {
      const [codeSnap, newUserSnap] = await Promise.all([tx.get(codeRef), tx.get(newUserBillingRef)]);

      if (!codeSnap.exists) {
        return { ok: false, error: "That referral code doesn't exist." };
      }
      const referrerUid = codeSnap.data().uid;
      if (referrerUid === uid) {
        return { ok: false, error: "You can't refer yourself." };
      }
      if (newUserSnap.exists && newUserSnap.data().referredBy) {
        return { ok: false, error: "You've already claimed a referral bonus." };
      }

      const referrerRef = db.collection("billing").doc(referrerUid);
      const referrerSnap = await tx.get(referrerRef);
      const referrerBonus = (referrerSnap.exists ? referrerSnap.data().bonusMessages : 0) || 0;
      const referrerCount = (referrerSnap.exists ? referrerSnap.data().referralCount : 0) || 0;
      const newUserBonus = (newUserSnap.exists ? newUserSnap.data().bonusMessages : 0) || 0;

      tx.set(referrerRef, {
        bonusMessages: referrerBonus + REFERRAL_BONUS_MESSAGES,
        referralCount: referrerCount + 1
      }, { merge: true });
      tx.set(newUserBillingRef, {
        bonusMessages: newUserBonus + REFERRAL_BONUS_MESSAGES,
        referredBy: normalizedCode
      }, { merge: true });

      return { ok: true };
    });

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }
    return res.status(200).json({ ok: true, bonusMessages: REFERRAL_BONUS_MESSAGES });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Couldn't claim referral right now." });
  }
}

function razorpayAuthHeader() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error("Razorpay isn't configured yet (missing RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET).");
  }
  return "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64");
}

async function requireUser(req) {
  const authHeader = req.headers.authorization || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) throw { status: 401, message: "Sign in required." };
  const decoded = await getAdminAuth().verifyIdToken(idToken);
  return decoded.uid;
}

async function handleCreateOrder(req, res) {
  const uid = await requireUser(req);
  const { plan } = req.body || {};

  const amountInr = PLAN_PRICES_INR[plan];
  if (!amountInr) {
    return res.status(400).json({ error: "Unknown plan. Choose starter, pro, or ultra." });
  }

  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      "Authorization": razorpayAuthHeader(),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      amount: amountInr * 100, // paise
      currency: "INR",
      // Razorpay caps receipt at 40 chars.
      receipt: `zyntra_${plan}_${uid}`.slice(0, 40),
      notes: { uid, plan }
    })
  });

  const order = await response.json();
  if (!response.ok) {
    return res.status(response.status).json({ error: order.error?.description || "Razorpay order creation failed." });
  }

  return res.status(200).json({
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId: process.env.RAZORPAY_KEY_ID,
    plan
  });
}

async function handleVerify(req, res) {
  const { createHmac } = await import("crypto");
  const uid = await requireUser(req);
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    plan
  } = req.body || {};

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !plan) {
    return res.status(400).json({ error: "Missing payment details." });
  }
  if (!PLAN_PRICES_INR[plan]) {
    return res.status(400).json({ error: "Unknown plan." });
  }

  // This is the actual security check — Razorpay signs
  // "order_id|payment_id" with the account's key secret, and only
  // Razorpay and us know that secret. If this doesn't match, the
  // request didn't really come from a completed Razorpay payment.
  const expectedSignature = createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  if (expectedSignature !== razorpay_signature) {
    return res.status(400).json({ error: "Payment verification failed. If money left your account, contact support before retrying." });
  }

  // Double-check with Razorpay directly that the order really belongs to
  // this uid and this plan, so a verified-but-tampered client body (e.g.
  // a real payment for "starter" replayed with plan:"ultra") can't
  // upgrade someone further than what they actually paid for.
  const orderRes = await fetch(`https://api.razorpay.com/v1/orders/${razorpay_order_id}`, {
    headers: { "Authorization": razorpayAuthHeader() }
  });
  const order = await orderRes.json();
  if (!orderRes.ok || order.notes?.uid !== uid || order.notes?.plan !== plan) {
    return res.status(400).json({ error: "Order details don't match this request." });
  }

  const db = getAdminDb();
  const billingRef = db.collection("billing").doc(uid);
  const appliedRef = db.collection("paymentsApplied").doc(razorpay_payment_id);

  // Applying a payment is ONE atomic transaction: the "this payment was used"
  // marker and the plan update commit together or not at all. That gives:
  //  - replay protection: a payment id already marked is never applied again
  //  - concurrency safety: simultaneous requests are serialized by Firestore
  //    (the loser retries, sees the marker, and does nothing)
  //  - crash safety: if the function dies before commit, NEITHER write exists,
  //    so retrying simply applies the payment; there is no state where the
  //    payment is marked but the plan wasn't given.
  const result = await db.runTransaction(async (tx) => {
    const marker = await tx.get(appliedRef);
    const snap = await tx.get(billingRef);
    const prev = snap.exists ? snap.data() : {};
    if (marker.exists) {
      return { alreadyApplied: true, plan: prev.plan || plan, planExpiresAt: prev.planExpiresAt || null };
    }

    // Plans last 30 days from payment. Renewing the SAME plan while it's
    // still active adds on to the remaining time, so paying early never
    // loses days; switching plans (or paying after expiry) starts from now.
    const nowMs = Date.now();
    const prevHistory = prev.history || [];
    const stillActiveSamePlan = prev.plan === plan && typeof prev.planExpiresAt === "number" && prev.planExpiresAt > nowMs;
    const planExpiresAt = (stillActiveSamePlan ? prev.planExpiresAt : nowMs) + PLAN_DURATION_MS;

    tx.create(appliedRef, { uid, plan, orderId: razorpay_order_id, at: nowMs });
    tx.set(billingRef, {
      plan,
      planExpiresAt,
      updatedAt: nowMs,
      lastOrderId: razorpay_order_id,
      lastPaymentId: razorpay_payment_id,
      // Bounded audit trail — same "small capped array on the doc" pattern
      // already used for notifications, not a full payments subcollection.
      history: [...prevHistory, { plan, orderId: razorpay_order_id, paymentId: razorpay_payment_id, at: nowMs }].slice(-20)
    }, { merge: true });
    return { alreadyApplied: false, plan, planExpiresAt };
  });

  return res.status(200).json({ ok: true, ...result });
}

// ================= Admin dashboard =================
// Read-only owner stats. SECURITY: the real gate is HERE, server-side —
// the caller's Firebase ID token is verified, then its uid must appear in
// the ADMIN_UID env var (comma-separated for more than one admin). Hiding
// the menu item in the UI is only cosmetic. Only aggregate numbers and
// masked emails are returned — never chat contents or API keys.
// Lives in this file (action-based) instead of a new api/*.js so the
// Vercel Hobby 12-function cap isn't touched.
const ADMIN_PLAN_LIMITS = { free: 50, starter: 150, pro: 500, ultra: 1500 }; // keep in sync with PLAN_LIMITS in api/chat.js
let adminStatsCache = { at: 0, data: null };

function adminUids() {
  return (process.env.ADMIN_UID || "").split(",").map((x) => x.trim()).filter(Boolean);
}

async function handleAdminCheck(req, res) {
  try {
    const uid = await requireUser(req);
    return res.status(200).json({ admin: adminUids().includes(uid) });
  } catch (e) {
    return res.status(200).json({ admin: false });
  }
}

function maskEmail(user) {
  const email = user?.email;
  if (!email) return user?.displayName ? user.displayName.slice(0, 2) + "***" : "user " + (user?.uid || "").slice(0, 4);
  const [name, domain] = email.split("@");
  return name.slice(0, 2) + "***@" + domain;
}

async function safeCount(query) {
  try {
    const snap = await query.count().get();
    return snap.data().count;
  } catch (e) {
    return null;
  }
}

async function buildAdminStats() {
  const db = getAdminDb();
  const auth = getAdminAuth();
  const DAY = 86400000;
  const now = Date.now();
  const month = new Date().toISOString().slice(0, 7);
  const prevDate = new Date();
  prevDate.setUTCDate(1);
  prevDate.setUTCMonth(prevDate.getUTCMonth() - 1);
  const prevMonth = prevDate.toISOString().slice(0, 7);

  const listAllUsers = async () => {
    const out = [];
    let pageToken;
    let pages = 0;
    do {
      const r = await auth.listUsers(1000, pageToken);
      out.push(...r.users);
      pageToken = r.pageToken;
      pages++;
    } while (pageToken && pages < 10);
    return { users: out, truncated: !!pageToken };
  };

  const [usersRes, billingSnap, usageSnap, guestSnap, sharedTotal, sharedPublic, sitesTotal, ratingsTotal, reportsTotal] = await Promise.all([
    listAllUsers(),
    db.collection("billing").limit(5000).get(),
    db.collectionGroup("usage").limit(10000).get(),
    db.collection("guestUsage").limit(10000).get(),
    safeCount(db.collection("sharedChats")),
    safeCount(db.collection("sharedChats").where("public", "==", true)),
    safeCount(db.collection("publishedSites")),
    safeCount(db.collection("ratings")),
    safeCount(db.collection("reports"))
  ]);

  // ---- users ----
  const users = usersRes.users;
  const byUid = new Map(users.map((u) => [u.uid, u]));
  const signupDays = {};
  for (let i = 29; i >= 0; i--) signupDays[new Date(now - i * DAY).toISOString().slice(0, 10)] = 0;
  let new7 = 0, new30 = 0, signedIn7 = 0;
  const providers = {};
  for (const u of users) {
    const created = new Date(u.metadata.creationTime).getTime();
    if (now - created <= 7 * DAY) new7++;
    if (now - created <= 30 * DAY) new30++;
    const day = new Date(created).toISOString().slice(0, 10);
    if (day in signupDays) signupDays[day]++;
    const last = u.metadata.lastSignInTime ? new Date(u.metadata.lastSignInTime).getTime() : 0;
    if (last && now - last <= 7 * DAY) signedIn7++;
    const pid = u.providerData?.[0]?.providerId || "other";
    providers[pid] = (providers[pid] || 0) + 1;
  }

  // ---- plans / revenue ----
  const planOf = new Map();
  const planCounts = { free: 0, starter: 0, pro: 0, ultra: 0 };
  const revenueByMonth = {};
  let revenueTotal = 0, paidPayments = 0, referralJoins = 0, bonusTotal = 0;
  let expiring7 = 0, expiredPlans = 0;
  for (const d of billingSnap.docs) {
    const b = d.data();
    const plan = ADMIN_PLAN_LIMITS[b.plan] ? effectivePlan(b) : "free";
    planOf.set(d.id, { plan, bonus: b.bonusMessages || 0 });
    if (plan !== "free") {
      planCounts[plan]++;
      if (typeof b.planExpiresAt === "number" && b.planExpiresAt - now <= 7 * DAY) expiring7++;
    } else if (b.plan && b.plan !== "free") {
      expiredPlans++;
    }
    referralJoins += b.referralCount || 0;
    bonusTotal += b.bonusMessages || 0;
    for (const h of b.history || []) {
      const price = PLAN_PRICES_INR[h.plan] || 0;
      if (!price) continue;
      revenueTotal += price;
      paidPayments++;
      const m = new Date(h.at).toISOString().slice(0, 7);
      revenueByMonth[m] = (revenueByMonth[m] || 0) + price;
    }
  }
  const paidUsers = planCounts.starter + planCounts.pro + planCounts.ultra;
  planCounts.free = Math.max(0, users.length - paidUsers);

  // ---- usage (this month vs last month) ----
  const cur = { messages: 0, input: 0, output: 0, groq: 0, searches: 0, research: 0, activeUsers: 0, hitLimit: 0 };
  let prevMessages = 0;
  // Per-day numbers (UTC dates) for the last 30 days — written by api/chat.js
  // as usage.daily = { "YYYY-MM-DD": count }. Days before that field existed
  // simply have no data.
  const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
  const dailyMsgs = {}, dailyActive = {}, guestDailyMsgs = {};
  const weeklyUsers = new Set();
  const addDaily = (x, uid) => {
    const dd = x.daily;
    if (!dd || typeof dd !== "object") return;
    for (const [day, n] of Object.entries(dd)) {
      if (!(n > 0)) continue;
      dailyMsgs[day] = (dailyMsgs[day] || 0) + n;
      dailyActive[day] = (dailyActive[day] || 0) + 1;
      if (uid && now - new Date(day + "T00:00:00Z").getTime() < 7 * DAY) weeklyUsers.add(uid);
    }
  };
  const models = {};
  const perUser = [];
  for (const d of usageSnap.docs) {
    const x = d.data();
    if (d.id === prevMonth) { prevMessages += x.messages || 0; addDaily(x, d.ref.parent.parent?.id); continue; }
    if (d.id !== month) continue;
    const uid = d.ref.parent.parent?.id;
    addDaily(x, uid);
    const msgs = x.messages || 0;
    cur.messages += msgs;
    cur.input += x.inputTokens || 0;
    cur.output += x.outputTokens || 0;
    cur.groq += x.groqRequests || 0;
    cur.searches += x.webSearches || 0;
    cur.research += x.researchRequests || 0;
    if (msgs > 0) cur.activeUsers++;
    // Model counts may be a nested map OR literal "modelCounts.<name>" keys
    // (set() with merge keeps dotted keys literal) — handle both.
    for (const [k, v] of Object.entries(x.modelCounts || {})) models[k] = (models[k] || 0) + v;
    for (const [k, v] of Object.entries(x)) {
      if (k.startsWith("modelCounts.")) models[k.slice(12)] = (models[k.slice(12)] || 0) + v;
    }
    const meta = planOf.get(uid) || { plan: "free", bonus: 0 };
    if (msgs >= (ADMIN_PLAN_LIMITS[meta.plan] || 50) + meta.bonus) cur.hitLimit++;
    perUser.push({ uid, msgs });
  }
  perUser.sort((a, b) => b.msgs - a.msgs);
  const topUsers = perUser.slice(0, 5).map((p) => ({
    user: maskEmail(byUid.get(p.uid) || { uid: p.uid }),
    plan: planOf.get(p.uid)?.plan || "free",
    messages: p.msgs
  }));

  // ---- guests ----
  let guestMessages = 0, guestVisitors = 0;
  for (const d of guestSnap.docs) {
    const gd = d.data();
    if (d.id.endsWith("_" + month)) {
      guestMessages += gd.messages || 0;
      guestVisitors++;
    }
    if (d.id.endsWith("_" + month) || d.id.endsWith("_" + prevMonth)) {
      for (const [day, n] of Object.entries(gd.daily || {})) {
        if (n > 0) guestDailyMsgs[day] = (guestDailyMsgs[day] || 0) + n;
      }
    }
  }

  // ---- last 30 days, oldest first ----
  const series = [];
  for (let i = 29; i >= 0; i--) {
    const date = dayKey(now - i * DAY);
    series.push({ date, messages: dailyMsgs[date] || 0, active: dailyActive[date] || 0, guestMessages: guestDailyMsgs[date] || 0 });
  }
  const todayRow = series[series.length - 1];
  const last7 = series.slice(-7);
  const daily = {
    series,
    today: { messages: todayRow.messages, active: todayRow.active },
    weeklyActive: weeklyUsers.size,
    avgPerDay7: Math.round(last7.reduce((a, r) => a + r.messages, 0) / 7),
    hasData: series.some((r) => r.messages > 0 || r.guestMessages > 0)
  };

  return {
    generatedAt: now,
    month,
    razorpayTestMode: (process.env.RAZORPAY_KEY_ID || "").startsWith("rzp_test_"),
    users: {
      total: users.length, truncated: usersRes.truncated, new7, new30, signedIn7, providers,
      signupsByDay: Object.entries(signupDays).map(([date, count]) => ({ date, count }))
    },
    plans: planCounts,
    planHealth: { expiring7, expired: expiredPlans },
    revenue: {
      total: revenueTotal, payments: paidPayments,
      byMonth: Object.entries(revenueByMonth).sort().slice(-6).map(([m, amount]) => ({ month: m, amount }))
    },
    referrals: { joins: referralJoins, bonusMessages: bonusTotal },
    usage: { ...cur, prevMonthMessages: prevMessages, avgPerActive: cur.activeUsers ? Math.round(cur.messages / cur.activeUsers) : 0 },
    models: Object.entries(models).sort((a, b) => b[1] - a[1]).map(([model, count]) => ({ model, count })),
    guests: { visitors: guestVisitors, messages: guestMessages },
    daily,
    content: { sharedChats: sharedTotal, sharedPublic, publishedSites: sitesTotal, ratings: ratingsTotal, reports: reportsTotal },
    topUsers
  };
}

async function handleAdminStats(req, res) {
  const uid = await requireUser(req);
  if (!adminUids().includes(uid)) {
    return res.status(403).json({ error: "Not authorized." });
  }
  // Short cache so refreshing the page doesn't re-read every collection.
  if (adminStatsCache.data && Date.now() - adminStatsCache.at < 45000 && !req.body?.refresh) {
    return res.status(200).json(adminStatsCache.data);
  }
  const data = await buildAdminStats();
  adminStatsCache = { at: Date.now(), data };
  return res.status(200).json(data);
}

// ================= Delete account (everything, not just the login) =================
// Removes the person's data from every place Zyntra keeps it, THEN deletes
// their sign-in record. If any step fails the sign-in record is kept and the
// person is told to retry, so a half-deleted account can't get orphaned.
// Safety: needs the typed confirmation AND a sign-in from the last 5 minutes
// (the app re-asks for the password / Google / Microsoft just before calling).
const ACCOUNT_TOKEN_COLLECTIONS = [
  "oauth_tokens", "github_oauth_tokens", "slack_oauth_tokens", "discord_oauth_tokens",
  "notion_oauth_tokens", "trello_oauth_tokens", "outlook_oauth_tokens"
];

async function deleteByQuery(db, query) {
  let total = 0;
  for (;;) {
    const snap = await query.limit(400).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    total += snap.size;
    if (snap.size < 400) break;
  }
  return total;
}

async function handleDeleteAccount(req, res) {
  const authHeader = req.headers.authorization || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) return res.status(401).json({ error: "Sign in required." });
  const decoded = await getAdminAuth().verifyIdToken(idToken);
  const uid = decoded.uid;

  if ((req.body || {}).confirm !== "DELETE") {
    return res.status(400).json({ error: "Type DELETE to confirm." });
  }
  if (Date.now() / 1000 - (decoded.auth_time || 0) > 300) {
    return res.status(401).json({ code: "reauth_required", error: "For your security, please confirm it's you again and retry." });
  }

  const db = getAdminDb();
  const auth = getAdminAuth();
  let email = "";
  try { email = ((await auth.getUser(uid)).email || "").toLowerCase(); } catch (e) { /* phone/other accounts may have no email */ }

  const failures = [];
  const step = async (name, fn) => {
    try { await fn(); } catch (e) { console.error(`delete-account step "${name}" failed:`, e && e.message); failures.push(name); }
  };

  // Their published apps/games, plus the votes, saves and reports attached to them.
  await step("published creations", async () => {
    const sites = await db.collection("publishedSites").where("uid", "==", uid).get();
    for (const d of sites.docs) {
      const slug = d.id;
      await db.collection("siteHtml").doc(slug).delete();
      await deleteByQuery(db, db.collection("ratings").where("slug", "==", slug));
      await deleteByQuery(db, db.collection("gameSaves").where("slug", "==", slug));
      await deleteByQuery(db, db.collection("reports").where("slug", "==", slug));
      await d.ref.delete();
    }
  });
  // Their own votes / saved progress / reports on other people's creations.
  await step("votes and saves", async () => {
    await deleteByQuery(db, db.collection("ratings").where("uid", "==", uid));
    await deleteByQuery(db, db.collection("gameSaves").where("uid", "==", uid));
    await deleteByQuery(db, db.collection("reports").where("uid", "==", uid));
  });
  // Shared chat links (also removes them from the public Discover page).
  await step("shared chats", () => deleteByQuery(db, db.collection("sharedChats").where("uid", "==", uid)));
  // Projects: delete the ones they own, leave the ones they were only invited to.
  await step("projects", async () => {
    const mine = await db.collection("projects").where("members", "array-contains", uid).get();
    for (const d of mine.docs) {
      if (d.data().ownerId === uid) {
        await db.recursiveDelete(d.ref);
      } else {
        const upd = { members: arrayRemove(uid) };
        if (email) upd.memberEmails = arrayRemove(email);
        await d.ref.update(upd);
      }
    }
  });
  // Stored connections (Gmail, GitHub, Slack, …) — our copy of the access tokens.
  await step("connected apps", async () => {
    for (const col of ACCOUNT_TOKEN_COLLECTIONS) await db.collection(col).doc(uid).delete();
  });
  // Plan, referral code, then the main profile doc (chats, memories, usage, notifications).
  await step("plan and referral code", async () => {
    await deleteByQuery(db, db.collection("referralCodes").where("uid", "==", uid));
    // Payment markers are DE-IDENTIFIED, not deleted: the uid is removed from Zyntra's copy,
    // but the payment id stays marked as used (replay protection) and a minimal record
    // (payment id, order id, plan, time) is kept for accounting. NOTE: this is not truly
    // anonymous — anyone with access to Razorpay can look the payment/order up there, and
    // Razorpay's order notes still contain the old uid. State this in the Privacy Policy and
    // have an accountant confirm the retention rules.
    const pays = await db.collection("paymentsApplied").where("uid", "==", uid).get();
    for (const d of pays.docs) await d.ref.update({ uid: null, detachedAt: Date.now() });
    await db.collection("billing").doc(uid).delete();
  });
  await step("profile and chats", () => db.recursiveDelete(db.collection("users").doc(uid)));

  if (failures.length) {
    return res.status(500).json({
      error: `We couldn't remove everything (${failures.join(", ")}), so your account is still active. Please try again in a minute.`
    });
  }

  await auth.deleteUser(uid);
  return res.status(200).json({ ok: true });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const action = req.query?.action;

  try {
    if (action === "create-order") return await handleCreateOrder(req, res);
    if (action === "verify") return await handleVerify(req, res);
    if (action === "get-referral-info") return await handleGetReferralInfo(req, res);
    if (action === "claim-referral") return await handleClaimReferral(req, res);
    if (action === "delete-account") return await handleDeleteAccount(req, res);
    if (action === "admin-check") return await handleAdminCheck(req, res);
    if (action === "admin-stats") return await handleAdminStats(req, res);
    return res.status(400).json({ error: "Unknown action." });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.message || "Payment request failed." });
  }
}
