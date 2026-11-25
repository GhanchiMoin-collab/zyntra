// Zyntra Moments — pure helpers (no I/O), so they can be unit-tested.
// Lives in api/_lib so it does NOT count as a Vercel function.

export const LIMITS = {
  VIDEO_BYTES: 100 * 1024 * 1024,
  BUG_VIDEO_BYTES: 50 * 1024 * 1024,
  THUMB_BYTES: 1024 * 1024,
  AVATAR_BYTES: 1024 * 1024,
  BANNER_BYTES: 3 * 1024 * 1024,
  DURATION_SEC: 10 * 60,
  TITLE: 100,
  DESC: 2000,
  TAGS: 8,
  COMMENT: 500,
  CHANNEL_NAME: 40,
  CHANNEL_DESC: 1000,
  LINKS: 5,
  UPLOADS_PER_DAY: 20,
  REPORTS_AUTOHIDE: 5,
  SAME_NETWORK_VERIFIED_PER_DAY: 3,
  VERIFIED_PER_HOUR_SPIKE: 300
};

export const VIDEO_TYPES = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };
export const IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const VISIBILITIES = ["public", "unlisted", "private"];
export const REPORT_REASONS = ["sexual", "exploitative", "graphic", "harassment", "dangerous", "spam_scam", "private_info", "copyright", "other"];
export const BUG_STATUSES = ["received", "investigating", "in_progress", "fixed", "closed"];
export const BUG_NOTIFY_STATUSES = ["investigating", "in_progress", "fixed", "closed"];
export const RESERVED_HANDLES = ["admin", "administrator", "zyntra", "moments", "support", "official", "help", "api", "root", "system", "staff", "moderator", "mod"];

// ---------- text cleaning ----------
export function clean(text, max) {
  return String(text == null ? "" : text).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
}

export function validateHandle(raw) {
  const h = String(raw || "").trim().toLowerCase().replace(/^@/, "");
  if (!/^[a-z0-9_]{3,30}$/.test(h)) return { error: "Handle must be 3-30 characters: letters, numbers or underscore." };
  if (RESERVED_HANDLES.includes(h)) return { error: "That handle is reserved." };
  return { handle: h };
}

export function validateLinks(links) {
  const arr = Array.isArray(links) ? links : [];
  const out = [];
  for (const l of arr.slice(0, LIMITS.LINKS)) {
    const s = String(l || "").trim();
    if (!s) continue;
    if (s.length > 200) return { error: "A link is too long." };
    let u;
    try { u = new URL(s); } catch (e) { return { error: "A link is not a valid URL." }; }
    if (u.protocol !== "https:") return { error: "Links must start with https://" };
    out.push(u.toString());
  }
  return { links: out };
}

export function tokenize(...parts) {
  const set = new Set();
  for (const p of parts) {
    String(p || "").toLowerCase().split(/[^a-z0-9\u00c0-\uffff]+/).forEach((w) => { if (w.length >= 2 && w.length <= 30) set.add(w); });
  }
  return [...set].slice(0, 25);
}

export function cleanTags(tags) {
  const arr = Array.isArray(tags) ? tags : String(tags || "").split(",");
  const out = [];
  for (const t of arr) {
    const s = clean(t, 24).toLowerCase().replace(/[^a-z0-9\u00c0-\uffff _-]/g, "").trim();
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= LIMITS.TAGS) break;
  }
  return out;
}

// ---------- secrets / personal info ----------
const SECRET_PATTERNS = [
  ["OpenAI-style key", /\bsk-[A-Za-z0-9_-]{20,}/],
  ["Groq key", /\bgsk_[A-Za-z0-9]{20,}/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ["Razorpay secret", /\brzp_(live|test)_[A-Za-z0-9]{8,}/],
  ["Private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["JWT / bearer token", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["Token assignment", /\btoken\s*[:=]\s*["']?[A-Za-z0-9_.\-]{16,}/i],
  ["Password or secret assignment", /\b(password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["']?[^\s"']{6,}/i]
];

export function scanSecrets(text) {
  const t = String(text || "");
  const hits = [];
  for (const [label, re] of SECRET_PATTERNS) if (re.test(t)) hits.push(label);
  return hits;
}

export function scanPII(text) {
  const t = String(text || "");
  const hits = [];
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(t)) hits.push("email address");
  if (/(?:\+?\d[\s-]?){10,13}/.test(t)) hits.push("phone-like number");
  return hits;
}

export function countUrls(text) {
  return (String(text || "").match(/https?:\/\/|www\./gi) || []).length;
}

// ---------- file sniffing (don't trust the client's content type) ----------
export function sniffKind(buf) {
  if (!buf || buf.length < 12) return null;
  const b = buf;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.slice(0, 4).toString("latin1") === "RIFF" && b.slice(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video/webm";
  if (b.slice(4, 8).toString("latin1") === "ftyp") {
    const brand = b.slice(8, 12).toString("latin1");
    return brand === "qt  " ? "video/quicktime" : "video/mp4";
  }
  return null;
}

// mp4 and mov share a container family — accept either for either declared type.
export function sniffMatches(declared, sniffed) {
  if (!sniffed) return false;
  if (declared === sniffed) return true;
  const fam = ["video/mp4", "video/quicktime"];
  return fam.includes(declared) && fam.includes(sniffed);
}

// ---------- verified views ----------
// A view is "verified" only after real watch time: 30 s, or 50% of videos
// shorter than 60 s (minimum 5 s). Anything else is just a "play started".
export function verifyThreshold(durationSec) {
  const d = Number(durationSec) || 0;
  if (d > 0 && d < 60) return Math.max(5, Math.floor(d * 0.5));
  return 30;
}

// Accept at most as many watched seconds as wall-clock time allows, so a
// script can't claim 30 s of watching in one request.
export function acceptedSeconds(reportedDelta, lastBeatAt, now) {
  const reported = Math.max(0, Math.min(Number(reportedDelta) || 0, 15));
  const maxByClock = lastBeatAt ? Math.max(0, (now - lastBeatAt) / 1000 + 1.5) : 5;
  return Math.min(reported, maxByClock);
}

export function dayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");
}
export function hourKey(ms) {
  return new Date(ms).toISOString().slice(0, 13).replace(/[-T]/g, "");
}

// ---------- ranking ----------
export function engagementOf(v) {
  return (v.verifiedViews || 0) + 3 * (v.likes || 0) + 2 * (v.comments || 0);
}
export function trendingRank(v, now) {
  const ageHours = Math.max(0, (now - (v.publishedAt || now)) / 3600000);
  return (engagementOf(v) + 1) / Math.pow(ageHours + 2, 1.3);
}

// ---------- reward milestones ----------
export const DEFAULT_REWARDS = {
  eligibility: { minChannelAgeDays: 7, maxStrikes: 0, requireNoRewardHold: true, requireOriginalityConfirm: true },
  milestones: [
    { id: "first_spark", title: "First Spark", metric: "verifiedViews", threshold: 100, enabled: true, reward: { type: "badge", value: "first_spark", label: "First Spark badge" } },
    { id: "rising_creator", title: "Rising Creator", metric: "verifiedViews", threshold: 10000, enabled: true, reward: { type: "decoration", value: "rising_frame", label: "Rising profile frame" } },
    { id: "community_favorite", title: "Community Favorite", metric: "subscribers", threshold: 1000, enabled: true, reward: { type: "ultra_days", value: 7, label: "7 days of Zyntra Ultra" } },
    { id: "million_club", title: "Million Club", metric: "verifiedViews", threshold: 1000000, enabled: true, reward: { type: "ultra_days", value: 30, label: "30 days of Zyntra Ultra + Million Club badge" } }
  ]
};
export const REWARD_TYPES = ["badge", "decoration", "ultra_days", "premium_access", "gift", "recognition"];
export const REWARD_METRICS = ["verifiedViews", "subscribers", "videos", "likes"];

export function metricValue(channel, metric) {
  if (metric === "verifiedViews") return channel.verifiedViews || 0;
  if (metric === "subscribers") return channel.subscribers || 0;
  if (metric === "videos") return channel.videos || 0;
  if (metric === "likes") return channel.likes || 0;
  return 0;
}

export function reachedMilestones(channel, milestones) {
  return (milestones || []).filter((m) => m.enabled !== false && metricValue(channel, m.metric) >= m.threshold);
}

// Returns a list of human-readable reasons a channel is NOT currently
// eligible (empty list = eligible). Used before an admin approves a claim.
export function eligibilityProblems(channel, elig, now, milestone, originalityConfirmed) {
  const e = Object.assign({}, DEFAULT_REWARDS.eligibility, elig || {});
  const problems = [];
  const ageDays = (now - (channel.createdAt || now)) / 86400000;
  if (ageDays < e.minChannelAgeDays) problems.push(`Channel is younger than ${e.minChannelAgeDays} days.`);
  if ((channel.strikes || 0) > e.maxStrikes) problems.push("Channel has community-guideline strikes.");
  if (e.requireNoRewardHold && channel.rewardHold) problems.push("Channel is on hold after a suspicious-activity review.");
  if (channel.suspended) problems.push("Channel is suspended.");
  if (milestone && metricValue(channel, milestone.metric) < milestone.threshold) problems.push("Milestone is no longer met (views may have been invalidated).");
  if (e.requireOriginalityConfirm && !originalityConfirmed) problems.push("Originality (not copied/stolen content) has not been confirmed by a reviewer.");
  return problems;
}

export function validateRewardsConfig(cfg) {
  if (!cfg || typeof cfg !== "object") return { error: "Invalid config." };
  const e = cfg.eligibility || {};
  const eligibility = {
    minChannelAgeDays: Math.max(0, Math.min(365, Number(e.minChannelAgeDays) || 0)),
    maxStrikes: Math.max(0, Math.min(20, Number(e.maxStrikes) || 0)),
    requireNoRewardHold: e.requireNoRewardHold !== false,
    requireOriginalityConfirm: e.requireOriginalityConfirm !== false
  };
  const ms = Array.isArray(cfg.milestones) ? cfg.milestones : [];
  if (ms.length > 30) return { error: "Too many milestones (max 30)." };
  const seen = new Set();
  const milestones = [];
  for (const m of ms) {
    const id = String(m.id || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 40);
    if (!id || seen.has(id)) return { error: "Each milestone needs a unique id (letters, numbers, underscore)." };
    seen.add(id);
    if (!REWARD_METRICS.includes(m.metric)) return { error: `Unknown metric for ${id}.` };
    const threshold = Math.floor(Number(m.threshold));
    if (!(threshold >= 1 && threshold <= 1e9)) return { error: `Bad threshold for ${id}.` };
    const r = m.reward || {};
    if (!REWARD_TYPES.includes(r.type)) return { error: `Unknown reward type for ${id}.` };
    let value = r.value;
    if (r.type === "ultra_days") {
      value = Math.floor(Number(value));
      if (!(value >= 1 && value <= 365)) return { error: `Ultra days for ${id} must be 1-365.` };
    } else value = clean(value, 60);
    milestones.push({ id, title: clean(m.title, 60) || id, metric: m.metric, threshold, enabled: m.enabled !== false, reward: { type: r.type, value, label: clean(r.label, 100) || String(value) } });
  }
  return { config: { eligibility, milestones } };
}

// ---------- device info for bug reports (allow-list; nothing else is stored) ----------
export function cleanDevice(d) {
  d = d && typeof d === "object" ? d : {};
  const pick = (k, n) => clean(d[k], n);
  return { userAgent: pick("userAgent", 250), platform: pick("platform", 60), language: pick("language", 20), screen: pick("screen", 30), viewport: pick("viewport", 30), online: d.online === false ? false : true, page: pick("page", 120) };
}
