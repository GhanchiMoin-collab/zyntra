// Shared plan helpers (a _lib module, so it doesn't count as a Vercel
// function). One place decides what plan a billing doc *currently* gives.
//
// Plans are one-time Razorpay payments that last PLAN_DURATION_MS from the
// payment (renewing the same plan early adds on to the remaining time).
// A doc with NO planExpiresAt predates expiry and is treated as still
// active, so existing paid users aren't downgraded by this change.
export const PLAN_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export function effectivePlan(billing, now = Date.now()) {
  const plan = (billing && billing.plan) || "free";
  if (plan === "free") return "free";
  const exp = billing && billing.planExpiresAt;
  if (typeof exp === "number" && exp < now) return "free";
  return plan;
}
