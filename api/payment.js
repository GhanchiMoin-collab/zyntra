import { getAdminAuth, getAdminDb } from "./_lib/firebaseAdmin.js";

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
  const snap = await billingRef.get();
  const prevHistory = snap.exists ? (snap.data().history || []) : [];

  await billingRef.set({
    plan,
    updatedAt: Date.now(),
    lastOrderId: razorpay_order_id,
    lastPaymentId: razorpay_payment_id,
    // Bounded audit trail — same "small capped array on the doc" pattern
    // already used for notifications, not a full payments subcollection.
    history: [...prevHistory, { plan, orderId: razorpay_order_id, paymentId: razorpay_payment_id, at: Date.now() }].slice(-20)
  }, { merge: true });

  return res.status(200).json({ ok: true, plan });
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
    return res.status(400).json({ error: "Unknown action. Use ?action=create-order or ?action=verify." });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.message || "Payment request failed." });
  }
}
