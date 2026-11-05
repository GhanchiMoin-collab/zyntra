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

// ---------------------------------------------------------------------------
// What a payment does to someone's plan — ONE deterministic policy (a business
// rule: change it here, nowhere else). Principle: paid time is never lost and
// the result doesn't depend on the order payments arrive in, because every
// payment is converted by VALUE (price) into time on the plan that ends up
// active:
//   - no active plan ........ the paid plan, 30 days from now
//   - same plan ............. +30 days on top of the remaining time
//   - upgrade (higher plan) . the higher plan now; remaining time on the old
//                             plan is credited at old-price / new-price
//   - lower plan paid while a higher one is active: the higher plan stays and
//                             gets extra time worth what was paid
//                             (30 days x lower-price / current-price)
// So a late Starter payment can never replace a newer Pro plan, and
// Starter-then-Pro gives exactly the same result as Pro-then-Starter.
// Plans from before expiry existed (no planExpiresAt) count as having no
// remaining time to carry over.
// ---------------------------------------------------------------------------
export const PLAN_RANK = { free: 0, starter: 1, pro: 2, ultra: 3 };

export function computeNextPlan(prev, paidPlan, now, prices, duration = PLAN_DURATION_MS) {
  prev = prev || {};
  const curPlan = effectivePlan(prev, now);
  if (curPlan === "free") {
    return { plan: paidPlan, planExpiresAt: now + duration, kind: "new" };
  }
  const curExp = typeof prev.planExpiresAt === "number" ? prev.planExpiresAt : now;
  const base = Math.max(curExp, now);
  const remaining = Math.max(0, curExp - now);
  const paidRank = PLAN_RANK[paidPlan] || 0;
  const curRank = PLAN_RANK[curPlan] || 0;

  if (paidRank === curRank) {
    return { plan: curPlan, planExpiresAt: base + duration, kind: "renew" };
  }
  if (paidRank > curRank) {
    const credit = remaining * (prices[curPlan] / prices[paidPlan]);
    return { plan: paidPlan, planExpiresAt: Math.round(now + duration + credit), kind: "upgrade" };
  }
  const extra = duration * (prices[paidPlan] / prices[curPlan]);
  return { plan: curPlan, planExpiresAt: Math.round(base + extra), kind: "added-to-current" };
}
