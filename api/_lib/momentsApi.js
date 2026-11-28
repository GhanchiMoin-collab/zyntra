import { getAdminAuth, getAdminDb, getAdminBucket, getAdminBucketNamed, increment, deleteField } from "./firebaseAdmin.js";
import { computeNextPlan } from "./plan.js";
import * as L from "./momentsLogic.js";
import { purgeMomentsChannel } from "./momentsPurge.js";
import { getMomentsBucket } from "./momentsStorage.js";

// ----------------------------------------------------------------------
// Zyntra Moments — ONE serverless function for the whole feature (the
// Vercel Hobby plan caps the number of functions; everything is an `action`).
//
// Security model
//  * Firestore + Storage are NEVER touched by browsers. All reads/writes go
//    through this file with the Admin SDK, so firestore.rules (default-deny)
//    and storage.rules (deny-all) stay closed.
//  * Every action that changes data verifies the Firebase ID token and
//    checks ownership / admin status HERE, on the server.
//  * Uploads: signed POST policies with content-length-range (size is
//    enforced by Cloud Storage itself), then re-verified (size, magic bytes).
//  * Playback: short-lived signed read URLs, issued only after a visibility
//    check. Pending / rejected / private media is never publicly reachable.
//
// Collections (all server-only):
//   channels/{uid}  handles/{handle}  videos/{id}(+/comments,/likes)
//   subscriptions/{uid}__{channelId}  viewEvents/{videoId}__{viewerKey}
//   dailyStats/{v|c}_{id}_{yyyymmdd}  hourly/{videoId}_{yyyymmddhh}
//   notifications/{uid}/items/{id}  momentsPrefs/{uid}
//   moderation/{auto}  momentsReports/{type_target_uid}  suspicious/{id}
//   bugReports/{id}  rewardClaims/{channelId}_{milestoneId}
//   settings/momentsRewards  stats/moments  rateLimits/{key}
// ----------------------------------------------------------------------

const PLAN_PRICES = { free: 0, starter: 99, pro: 199, ultra: 499 }; // keep in sync with api/payment.js
const STRIKE_CATEGORIES = ["sexual", "exploitative", "graphic", "harassment", "dangerous", "spam_scam", "private_info", "copyright"];
const DAY = 86400000;

function fail(status, message) { return { status, message }; }

function realDeps() {
  return {
    db: getAdminDb(),
    verifyToken: (t, strict) => getAdminAuth().verifyIdToken(t, !!strict), // revocation check only when strict (admin actions)
    bucket: getMomentsBucket(process.env), // S3-compatible storage if S3_* env vars are set, otherwise Firebase Storage
    bucketNamed: getAdminBucketNamed,
    inc: increment,
    del: deleteField,
    now: () => Date.now(),
    fetch: (...a) => fetch(...a),
    env: process.env
  };
}

export function createMomentsHandler(getDeps = realDeps) {
  const mem = new Map(); // best-effort per-instance rate limiting (durable limits use Firestore)
  const shared = {};     // per-instance settings caches
  return async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.status(200).end();
    try {
      const deps = getDeps();
      const api = buildApi(deps, mem, shared);
      const isPost = req.method === "POST";
      if (!isPost && req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
      const input = isPost ? (req.body || {}) : (req.query || {});
      const action = String(input.action || "");
      const table = isPost ? api.post : api.get;
      const fn = table[action];
      if (!fn) return res.status(400).json({ error: "Unknown action." });
      return await fn(req, res, input);
    } catch (e) {
      if (e && e.status && e.message) return res.status(e.status).json({ error: e.message });
      console.error("moments error:", e);
      return res.status(500).json({ error: "Something went wrong. Please try again." });
    }
  };
}

function buildApi(deps, mem, shared) {
  const { db, bucket, inc, del } = deps;
  const now = () => deps.now();
  const env = deps.env || {};
  const col = (n) => db.collection(n);
  const ok = (res, data, cache) => { if (cache) res.setHeader("Cache-Control", cache); return res.status(200).json(data); };

  // ---------------- auth ----------------
  async function getUser(req, required, strict) {
    const h = req.headers?.authorization || "";
    const tok = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!tok) { if (required) throw fail(401, "Sign in required."); return null; }
    try {
      const d = await deps.verifyToken(tok, !!strict);
      return { uid: d.uid, name: d.name || null };
    } catch (e) {
      if (required) throw fail(401, "Your session has ended — please sign in again.");
      return null;
    }
  }
  const adminUids = () => String(env.ADMIN_UID || "").split(",").map((x) => x.trim()).filter(Boolean);
  const isAdmin = (uid) => !!uid && adminUids().includes(uid);
  async function requireAdmin(req) {
    const u = await getUser(req, true, true);
    if (!isAdmin(u.uid)) throw fail(403, "Administrators only.");
    return u;
  }

  // ---------------- rate limits ----------------
  function limitMem(key, max, windowMs) {
    const t = now();
    const arr = (mem.get(key) || []).filter((x) => t - x < windowMs);
    if (arr.length >= max) throw fail(429, "Too many requests — slow down a little.");
    arr.push(t); mem.set(key, arr);
    if (mem.size > 5000) for (const k of mem.keys()) { mem.delete(k); if (mem.size < 2500) break; }
  }
  async function limitDurable(key, max, windowMs) {
    const ref = col("rateLimits").doc(key);
    await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const t = now();
      const d = s.exists ? s.data() : null;
      if (d && d.resetAt > t) {
        if (d.count >= max) throw fail(429, "Daily limit reached for this action. Try again later.");
        tx.update(ref, { count: d.count + 1 });
      } else tx.set(ref, { count: 1, resetAt: t + windowMs });
    });
  }
  function clientIp(req) {
    const xf = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
    return xf || req.socket?.remoteAddress || "0.0.0.0";
  }
  async function hmac(text) {
    const { createHmac } = await import("node:crypto");
    const secret = env.MOMENTS_HASH_SECRET || String(env.FIREBASE_SERVICE_ACCOUNT || "dev").slice(-64);
    return createHmac("sha256", secret).update(String(text)).digest("hex");
  }

  // ---------------- media ----------------
  const mediaUrl = (kind, id) => `/api/moments?action=media&kind=${kind}&id=${encodeURIComponent(id)}`;
  async function signedRead(path, seconds = 300) {
    const [url] = await bucket.file(path).getSignedUrl({ action: "read", expires: now() + seconds * 1000, version: "v4" });
    return url;
  }
  async function policyFor(path, contentType, maxBytes, size) {
    const f = bucket.file(path);
    if (f.presignPut) {
      // S3-compatible storage: a presigned PUT whose signature covers the content type (and the exact size).
      if (!(size > 0 && size <= maxBytes)) throw fail(400, `File must be between 1 byte and ${Math.round(maxBytes / 1048576)} MB.`);
      const p = await f.presignPut({ contentType, size, expiresMs: 15 * 60 * 1000 });
      return { method: "PUT", url: p.url, headers: p.headers, path, maxBytes };
    }
    const [p] = await f.generateSignedPostPolicyV4({
      expires: now() + 15 * 60 * 1000,
      conditions: [["content-length-range", 1, maxBytes], ["eq", "$Content-Type", contentType]],
      fields: { "Content-Type": contentType }
    });
    return { url: p.url, fields: p.fields, path, maxBytes };
  }
  // Re-check an uploaded object server-side: it exists, size is in range and
  // the real file signature matches an allowed type. Bad files are deleted.
  async function verifyObject(path, allowed, maxBytes) {
    const f = bucket.file(path);
    const [exists] = await f.exists();
    if (!exists) throw fail(400, "Upload not found — please try uploading again.");
    const [meta] = await f.getMetadata();
    const size = Number(meta.size || 0);
    if (!(size > 0 && size <= maxBytes)) { await f.delete().catch(() => {}); throw fail(400, "File is empty or too large."); }
    const [head] = await f.download({ start: 0, end: 31 });
    const kind = L.sniffKind(head);
    if (!kind || !allowed.includes(kind) || (bucket.kind !== "s3" && !L.sniffMatches(String(meta.contentType || kind), kind))) {
      await f.delete().catch(() => {});
      throw fail(400, "That file's contents don't match an allowed format.");
    }
    return { size, kind };
  }

  // ---------------- notifications ----------------
  const PREF_FOR = { new_subscriber: "subscribers", like: "likes", comment: "comments", video_published: "published", bug_update: "bugUpdates", achievement: "achievements", reward_approved: "rewards" };
  const ALWAYS = ["video_rejected", "moderation"]; // appeal rights: always delivered
  async function notify(uid, type, data, id) {
    try {
      const pref = PREF_FOR[type];
      if (pref && !ALWAYS.includes(type)) {
        const p = await col("momentsPrefs").doc(uid).get();
        if (p.exists && p.data()[pref] === false) return;
      }
      const ref = col("notifications").doc(uid).collection("items");
      const doc = { type, data: data || {}, read: false, createdAt: now() };
      if (id) await ref.doc(id).set(doc); else await ref.add(doc);
    } catch (e) { console.error("notify failed", e); }
  }

  // ---------------- stats helpers ----------------
  async function bumpDaily(videoId, channelId, delta) {
    const day = L.dayKey(now());
    const mk = (k, id) => {
      const o = { kind: k, id, day };
      for (const [f, n] of Object.entries(delta)) o[f] = inc(n);
      return o;
    };
    const jobs = [col("dailyStats").doc(`c_${channelId}_${day}`).set(mk("c", channelId), { merge: true })];
    if (videoId) jobs.push(col("dailyStats").doc(`v_${videoId}_${day}`).set(mk("v", videoId), { merge: true }));
    await Promise.all(jobs);
  }

  // ---------------- shaping ----------------
  const channelCard = (c) => c && ({
    id: c.uid, handle: c.handle, name: c.name,
    avatarUrl: c.avatarPath ? mediaUrl("avatar", c.uid) : null,
    badges: c.badges || [], decorations: c.decorations || []
  });
  const videoCard = (v, ch) => ({
    id: v.id, title: v.title, durationSec: v.durationSec || 0,
    thumbUrl: mediaUrl("thumb", v.id), publishedAt: v.publishedAt || null,
    verifiedViews: v.verifiedViews || 0, likes: v.likes || 0, comments: v.comments || 0,
    channel: channelCard(ch)
  });
  async function channelsFor(ids) {
    const uniq = [...new Set(ids)];
    const snaps = await Promise.all(uniq.map((id) => col("channels").doc(id).get()));
    const m = {};
    snaps.forEach((s) => { if (s.exists) m[s.id] = s.data(); });
    return m;
  }
  async function cardsFor(vids) {
    const chs = await channelsFor(vids.map((v) => v.channelId));
    return vids.filter((v) => chs[v.channelId] && !chs[v.channelId].suspended).map((v) => videoCard(v, chs[v.channelId]));
  }
  const withId = (s) => Object.assign({ id: s.id }, s.data());

  // can this viewer fetch this video at all? (listing is stricter than viewing)
  function canView(v, ch, uid) {
    if (!v || v.status === "removed") return false;
    if (uid && (uid === v.channelId || isAdmin(uid))) return true;
    if (ch && ch.suspended) return false;
    return v.status === "approved" && (v.visibility === "public" || v.visibility === "unlisted");
  }

  // keep `listed` / `listedAt` / channel.videos consistent with status+visibility
  async function relist(videoId) {
    const vref = col("videos").doc(videoId);
    const vs = await vref.get();
    if (!vs.exists) return;
    const v = vs.data();
    const cs = await col("channels").doc(v.channelId).get();
    const ch = cs.exists ? cs.data() : { suspended: true };
    const should = v.status === "approved" && v.visibility === "public" && !ch.suspended;
    if (should === !!v.listed) return;
    if (should) await vref.update({ listed: true, listedAt: v.publishedAt || now() });
    else await vref.update({ listed: false, listedAt: del() });
    if (cs.exists) await col("channels").doc(v.channelId).update({ videos: inc(should ? 1 : -1) });
  }

  // ---------------- automated moderation (a pre-sort, never a verdict) ----------------
  async function groqJSON(model, messages) {
    if (!env.GROQ_API_KEY) return null;
    try {
      const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), 8000) : null;
      const r = await deps.fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST", signal: ctl?.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.GROQ_API_KEY}` },
        body: JSON.stringify({ model, messages, temperature: 0, max_tokens: 400, response_format: { type: "json_object" } })
      });
      if (timer) clearTimeout(timer);
      if (!r.ok) return null;
      const j = await r.json();
      return JSON.parse(j.choices?.[0]?.message?.content || "null");
    } catch (e) { return null; }
  }
  const MOD_INSTR = "You pre-screen user-generated content for a creator platform. Categories: sexual, exploitative, graphic, harassment, dangerous, spam_scam, private_info. Reply ONLY with JSON: {\"flags\":[{\"category\":string,\"confidence\":number between 0 and 1,\"note\":string}]}. Use an empty flags array when nothing concerning is visible. You are a pre-screen only; a human makes the final decision.";
  async function autoCheck(video, frames) {
    const out = { at: now(), secrets: L.scanSecrets(`${video.title}\n${video.description}\n${(video.tags || []).join(" ")}`), pii: L.scanPII(`${video.title}\n${video.description}`), text: { status: "unavailable", flags: [] }, frames: { status: "unavailable", flags: [], count: 0 } };
    const fr = (Array.isArray(frames) ? frames : []).filter((f) => typeof f === "string" && f.startsWith("data:image/jpeg;base64,") && f.length < 160000).slice(0, 6);
    const textJob = groqJSON(env.MODERATION_TEXT_MODEL || "openai/gpt-oss-20b", [{ role: "system", content: MOD_INSTR }, { role: "user", content: `Title: ${video.title}\nDescription: ${video.description}\nTags: ${(video.tags || []).join(", ")}` }]);
    const frameJob = fr.length ? groqJSON(env.MODERATION_VISION_MODEL || "qwen/qwen3.6-27b", [{ role: "system", content: MOD_INSTR }, { role: "user", content: [{ type: "text", text: "These are frames sampled from one user video. Pre-screen them." }].concat(fr.map((u) => ({ type: "image_url", image_url: { url: u } }))) }]) : Promise.resolve(null);
    const [t, v] = await Promise.all([textJob, frameJob]); // in parallel so uploads finish quickly
    if (t && Array.isArray(t.flags)) out.text = { status: "checked", flags: t.flags.filter((f) => Number(f.confidence) >= 0.5).slice(0, 8) };
    if (fr.length) {
      out.frames.count = fr.length;
      if (v && Array.isArray(v.flags)) out.frames = { status: "checked", count: fr.length, flags: v.flags.filter((f) => Number(f.confidence) >= 0.5).slice(0, 8) };
    }
    out.summary = (out.secrets.length || out.text.flags.length || out.frames.flags.length || out.pii.length) ? "flagged" : "no_flags_found";
    return out; // frames come from the browser and can be spoofed: this NEVER lowers the human-review requirement
  }

  async function logModeration(rec) {
    await col("moderation").add(Object.assign({ at: now() }, rec));
  }

  // ---------------- launch controls (staged rollout + free-tier guard rails) ----------------
  // uploads: "closed" (nobody but admins) | "allowlist" (only channels an admin allowed) | "open" (any channel)
  const LAUNCH_DEFAULTS = { uploads: "closed", maxChannelMB: 500, maxStorageMB: 3000, dailyEgressMB: 800 };
  async function launchSettings() {
    if (shared.launch && now() - shared.launch.at < 30000) return shared.launch.cfg;
    const s = await col("settings").doc("momentsLaunch").get();
    const cfg = Object.assign({}, LAUNCH_DEFAULTS, s.exists ? s.data() : {});
    shared.launch = { at: now(), cfg };
    return cfg;
  }
  function uploadGate(cfg, uid, ch) {
    if (isAdmin(uid)) return { allowed: true, mode: cfg.uploads };
    if (cfg.uploads === "open") return { allowed: true, mode: cfg.uploads };
    if (cfg.uploads === "allowlist" && ch && ch.canUpload === true) return { allowed: true, mode: cfg.uploads };
    return { allowed: false, mode: cfg.uploads, reason: cfg.uploads === "allowlist" ? "Video uploads are limited to invited creators during our early launch. Ask for access in our Discord." : "Video uploads aren't open yet. You can still browse, create a channel and join the community." };
  }
  const MB = 1048576;
  const statsDoc = () => col("stats").doc("moments");

  // ---------------- rewards settings / milestones ----------------
  async function rewardSettings() {
    if (shared.rewards && now() - shared.rewards.at < 60000) return shared.rewards.cfg;
    const s = await col("settings").doc("momentsRewards").get();
    const cfg = s.exists ? s.data() : L.DEFAULT_REWARDS;
    shared.rewards = { at: now(), cfg };
    return cfg;
  }
  async function checkMilestones(channelId) {
    const cfg = await rewardSettings();
    const cs = await col("channels").doc(channelId).get();
    if (!cs.exists) return;
    const ch = cs.data();
    const claimed = ch.claimedMilestones || [];
    const fresh = L.reachedMilestones(ch, cfg.milestones).filter((m) => !claimed.includes(m.id));
    if (!fresh.length) return;
    for (const m of fresh) {
      const ref = col("rewardClaims").doc(`${channelId}_${m.id}`);
      let created = false;
      await db.runTransaction(async (tx) => {
        const s = await tx.get(ref);
        if (s.exists) return;
        tx.set(ref, { channelId, ownerUid: channelId, milestoneId: m.id, title: m.title, metric: m.metric, threshold: m.threshold, reward: m.reward, metricAtClaim: L.metricValue(ch, m.metric), status: "pending_review", createdAt: now() });
        created = true;
      });
      if (created) await notify(channelId, "achievement", { milestoneId: m.id, title: m.title }, `ach_${m.id}`);
    }
    await col("channels").doc(channelId).update({ claimedMilestones: claimed.concat(fresh.map((m) => m.id)) });
  }

  // ===================================================================
  //                              GET actions
  // ===================================================================
  const get = {};
  const post = {};

  // Redirects to a short-lived signed URL after a visibility check. Only for
  // things that may be public (listed thumbs, avatars, banners, public video).
  get.media = async (req, res, q) => {
    const kind = String(q.kind || ""); const id = String(q.id || "");
    if (!id || id.length > 80) throw fail(400, "Bad request.");
    let path = null; let seconds = 600; let cache = "public, s-maxage=300, max-age=300";
    if (kind === "avatar" || kind === "banner") {
      const c = await col("channels").doc(id).get();
      if (c.exists && !c.data().suspended) path = c.data()[kind + "Path"];
    } else if (kind === "thumb" || kind === "video") {
      const vs = await col("videos").doc(id).get();
      if (vs.exists) {
        const v = vs.data(); const cs = await col("channels").doc(v.channelId).get();
        const ch = cs.exists ? cs.data() : null;
        if (v.status === "approved" && ch && !ch.suspended && (v.visibility === "public" || (v.visibility === "unlisted" && kind === "video"))) {
          path = kind === "thumb" ? v.thumbPath : v.videoPath;
          if (kind === "video") { seconds = 3600; cache = "private, max-age=300"; }
        }
      }
    }
    if (!path) { res.status(404).end(); return; }
    res.setHeader("Cache-Control", cache);
    res.setHeader("Location", await signedRead(path, seconds));
    res.status(302).end();
  };

  get.feed = async (req, res, q) => {
    const user = await getUser(req, false);
    const sort = ["new", "trending", "recommended"].includes(q.sort) ? q.sort : "trending";
    const limit = Math.min(24, Math.max(1, parseInt(q.limit, 10) || 12));
    const t = now();
    let vids = []; let next = null;
    if (sort === "new") {
      let query = col("videos").orderBy("listedAt", "desc");
      if (q.cursor) query = query.startAfter(Number(q.cursor));
      const snap = await query.limit(limit).get();
      vids = snap.docs.map(withId).filter((v) => v.listed);
      if (snap.docs.length === limit) next = String(snap.docs[snap.docs.length - 1].data().listedAt);
    } else {
      const window = sort === "trending" ? 150 : 60;
      const snap = sort === "trending" ? await col("videos").orderBy("engagement", "desc").limit(window).get() : await col("videos").orderBy("listedAt", "desc").limit(window).get();
      let all = snap.docs.map(withId).filter((v) => v.listed);
      if (sort === "recommended" && user) {
        const subs = await col("subscriptions").where("uid", "==", user.uid).limit(200).get();
        const set = new Set(subs.docs.map((d) => d.data().channelId));
        all = all.filter((v) => v.channelId !== user.uid);
        all.sort((a, b) => (set.has(b.channelId) - set.has(a.channelId)) || (L.trendingRank(b, t) - L.trendingRank(a, t)));
      } else all.sort((a, b) => L.trendingRank(b, t) - L.trendingRank(a, t));
      const off = Math.max(0, parseInt(q.cursor, 10) || 0);
      vids = all.slice(off, off + limit);
      if (off + limit < all.length) next = String(off + limit);
    }
    return ok(res, { videos: await cardsFor(vids), next }, user ? "private, no-store" : "public, s-maxage=30, stale-while-revalidate=60");
  };

  get.search = async (req, res, q) => {
    const text = L.clean(q.q, 60).toLowerCase();
    if (text.length < 2) return ok(res, { channels: [], videos: [] });
    limitMem("search:" + clientIp(req), 30, 60000);
    const tokens = L.tokenize(text);
    const hs = text.replace(/^@/, "");
    const [cs, vs] = await Promise.all([
      col("channels").orderBy("handle").startAt(hs).endAt(hs + "\uf8ff").limit(10).get(),
      tokens.length ? col("videos").where("searchTokens", "array-contains", tokens[0]).limit(60).get() : { docs: [] }
    ]);
    const channels = cs.docs.map((d) => d.data()).filter((c) => !c.suspended).map((c) => Object.assign(channelCard(c), { subscribers: c.showSubscriberCount === false ? null : c.subscribers || 0 }));
    const vids = vs.docs.map(withId).filter((v) => v.listed && tokens.every((tk) => (v.searchTokens || []).includes(tk))).slice(0, 24);
    return ok(res, { channels, videos: await cardsFor(vids) });
  };

  get.watch = async (req, res, q) => {
    const user = await getUser(req, false);
    const vs = await col("videos").doc(String(q.id || "x")).get();
    if (!vs.exists) throw fail(404, "Video not found.");
    const v = withId(vs);
    const cs = await col("channels").doc(v.channelId).get();
    const ch = cs.exists ? cs.data() : null;
    if (!ch || !canView(v, ch, user?.uid)) throw fail(404, "Video not found.");
    const owner = user?.uid === v.channelId;
    if (!owner && !isAdmin(user?.uid) && v.videoSize) {
      // protect the free hosting quota: estimate today's playback from the sizes of videos served
      const cfg = await launchSettings(); const eref = col("stats").doc("egress_" + L.dayKey(now()));
      const es = await eref.get();
      if ((es.exists ? es.data().bytes || 0 : 0) >= cfg.dailyEgressMB * MB) throw fail(503, "Video playback is paused for today to stay within our free hosting limits. Please come back tomorrow!");
      await eref.set({ bytes: inc(v.videoSize) }, { merge: true });
    }
    let liked = false, subscribed = false;
    if (user) {
      const [l, s] = await Promise.all([col("videos").doc(v.id).collection("likes").doc(user.uid).get(), col("subscriptions").doc(`${user.uid}__${v.channelId}`).get()]);
      liked = l.exists; subscribed = s.exists;
    }
    const related = (await col("videos").orderBy("listedAt", "desc").limit(30).get()).docs.map(withId).filter((x) => x.listed && x.id !== v.id).slice(0, 8);
    return ok(res, {
      video: { id: v.id, title: v.title, description: v.description, tags: v.tags || [], visibility: v.visibility, status: v.status, publishedAt: v.publishedAt || null, durationSec: v.durationSec || 0, verifiedViews: v.verifiedViews || 0, plays: v.views || 0, likes: v.likes || 0, comments: v.comments || 0 },
      videoUrl: await signedRead(v.videoPath, 3600), posterUrl: v.thumbPath ? (v.status === "approved" && v.visibility === "public" ? mediaUrl("thumb", v.id) : await signedRead(v.thumbPath, 3600)) : null,
      channel: Object.assign(channelCard(ch), { subscribers: ch.showSubscriberCount === false && !owner ? null : ch.subscribers || 0, commentsEnabled: ch.commentsEnabled !== false }),
      liked, subscribed, owner, related: await cardsFor(related)
    }, "private, no-store");
  };

  get.comments = async (req, res, q) => {
    const user = await getUser(req, false);
    const vs = await col("videos").doc(String(q.id || "x")).get();
    if (!vs.exists) throw fail(404, "Video not found.");
    const v = vs.data(); const cs = await col("channels").doc(v.channelId).get();
    if (!canView(v, cs.exists ? cs.data() : null, user?.uid)) throw fail(404, "Video not found.");
    let query = col("videos").doc(vs.id).collection("comments").orderBy("createdAt", "desc");
    if (q.cursor) query = query.startAfter(Number(q.cursor));
    const snap = await query.limit(20).get();
    const items = snap.docs.map(withId).map((c) => ({ id: c.id, text: c.text, authorName: c.authorName, authorHandle: c.authorHandle || null, createdAt: c.createdAt, mine: user?.uid === c.uid }));
    return ok(res, { comments: items, next: snap.docs.length === 20 ? String(items[items.length - 1].createdAt) : null }, "private, no-store");
  };

  get.channel = async (req, res, q) => {
    const user = await getUser(req, false);
    const h = L.validateHandle(q.handle);
    if (h.error) throw fail(404, "Channel not found.");
    const hs = await col("handles").doc(h.handle).get();
    if (!hs.exists) throw fail(404, "Channel not found.");
    const cs = await col("channels").doc(hs.data().uid).get();
    const ch = cs.data();
    if (!ch || (ch.suspended && !isAdmin(user?.uid))) throw fail(404, "Channel not found.");
    const owner = user?.uid === ch.uid;
    const vsnap = await col("videos").where("channelId", "==", ch.uid).limit(200).get();
    const vids = vsnap.docs.map(withId).filter((v) => v.listed).sort((a, b) => (b.listedAt || 0) - (a.listedAt || 0)).slice(0, 48);
    let subscribed = false;
    if (user) subscribed = (await col("subscriptions").doc(`${user.uid}__${ch.uid}`).get()).exists;
    return ok(res, {
      channel: Object.assign(channelCard(ch), { description: ch.description, links: ch.links || [], bannerUrl: ch.bannerPath ? mediaUrl("banner", ch.uid) : null, createdAt: ch.createdAt, subscribers: ch.showSubscriberCount === false && !owner ? null : ch.subscribers || 0, videos: ch.videos || 0, verifiedViews: ch.verifiedViews || 0 }),
      videos: vids.map((v) => videoCard(v, ch)), subscribed, owner
    }, user ? "private, no-store" : "public, s-maxage=30, stale-while-revalidate=60");
  };

  get.me = async (req, res) => {
    const user = await getUser(req, true);
    const [cs, pr, un] = await Promise.all([
      col("channels").doc(user.uid).get(),
      col("momentsPrefs").doc(user.uid).get(),
      col("notifications").doc(user.uid).collection("items").where("read", "==", false).limit(50).get()
    ]);
    const ch = cs.exists ? cs.data() : null;
    return ok(res, { channel: ch ? Object.assign(channelCard(ch), { description: ch.description, links: ch.links || [], showSubscriberCount: ch.showSubscriberCount !== false, commentsEnabled: ch.commentsEnabled !== false, bannerUrl: ch.bannerPath ? mediaUrl("banner", ch.uid) : null }) : null, prefs: Object.assign({ subscribers: true, likes: true, comments: true, published: true, bugUpdates: true, achievements: true, rewards: true }, pr.exists ? pr.data() : {}), unread: un.docs.length, isAdmin: isAdmin(user.uid), limits: { videoMb: L.LIMITS.VIDEO_BYTES / 1048576, durationSec: L.LIMITS.DURATION_SEC, bugMb: L.LIMITS.BUG_VIDEO_BYTES / 1048576 }, uploads: uploadGate(await launchSettings(), user.uid, ch) }, "private, no-store");
  };

  get.notifications = async (req, res, q) => {
    const user = await getUser(req, true);
    let query = col("notifications").doc(user.uid).collection("items").orderBy("createdAt", "desc");
    if (q.cursor) query = query.startAfter(Number(q.cursor));
    const snap = await query.limit(30).get();
    const items = snap.docs.map(withId);
    return ok(res, { items, next: snap.docs.length === 30 ? String(items[items.length - 1].createdAt) : null }, "private, no-store");
  };

  // ---- creator analytics: real data only ----
  const seriesFrom = (docs, days) => {
    const byDay = {};
    docs.forEach((d) => { byDay[d.data().day] = d.data(); });
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const k = L.dayKey(now() - i * DAY); const r = byDay[k] || {};
      out.push({ day: k, plays: r.views || 0, verified: r.verified || 0, watchSeconds: Math.round(r.watch || 0), likes: r.likes || 0, comments: r.comments || 0, subscribers: r.subs || 0 });
    }
    return out;
  };
  get.studio = async (req, res) => {
    const user = await getUser(req, true);
    const cs = await col("channels").doc(user.uid).get();
    if (!cs.exists) throw fail(404, "Create a channel first.");
    const ch = cs.data();
    const [vsnap, dsnap, claims] = await Promise.all([
      col("videos").where("channelId", "==", user.uid).limit(200).get(),
      col("dailyStats").where("kind", "==", "c").where("id", "==", user.uid).limit(120).get(),
      col("rewardClaims").where("channelId", "==", user.uid).limit(50).get()
    ]);
    // uploads that never finished (tab closed, network lost) for over a day: remove the record and any stray files
    const allVideos = vsnap.docs.map(withId);
    for (const v of allVideos) {
      if (v.status === "uploading" && now() - (v.createdAt || 0) > DAY) {
        for (const pth of [v.videoPath, v.thumbPath]) if (pth) await bucket.file(pth).delete().catch(() => {});
        await col("videos").doc(v.id).update({ status: "removed", removedAt: now() });
        v.status = "removed";
      }
    }
    const vids = allVideos.filter((v) => v.status !== "removed").sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const videos = await Promise.all(vids.slice(0, 50).map(async (v) => ({ id: v.id, title: v.title, status: v.status, visibility: v.visibility, createdAt: v.createdAt, publishedAt: v.publishedAt || null, durationSec: v.durationSec, plays: v.views || 0, verifiedViews: v.verifiedViews || 0, likes: v.likes || 0, comments: v.comments || 0, watchSeconds: Math.round(v.watchSeconds || 0), rejection: v.rejection || null, appeal: v.appeal ? { status: v.appeal.status, note: v.appeal.note || null } : null, thumbUrl: v.thumbPath ? await signedRead(v.thumbPath, 300) : null })));
    const cfg = await rewardSettings();
    const totals = { subscribers: ch.subscribers || 0, videos: ch.videos || 0, plays: vids.reduce((s, v) => s + (v.views || 0), 0), verifiedViews: ch.verifiedViews || 0, likes: ch.likes || 0, comments: vids.reduce((s, v) => s + (v.comments || 0), 0), watchSeconds: Math.round(ch.watchSeconds || 0) };
    totals.engagementRate = totals.verifiedViews ? (totals.likes + totals.comments) / totals.verifiedViews : 0;
    const claimMap = {}; claims.docs.forEach((d) => { claimMap[d.data().milestoneId] = d.data(); });
    const rewards = cfg.milestones.filter((m) => m.enabled !== false).map((m) => ({ id: m.id, title: m.title, metric: m.metric, threshold: m.threshold, progress: L.metricValue(ch, m.metric), reward: m.reward, claim: claimMap[m.id] ? { status: claimMap[m.id].status, note: claimMap[m.id].note || null, decidedAt: claimMap[m.id].decidedAt || null, createdAt: claimMap[m.id].createdAt } : null }));
    return ok(res, { channel: { handle: ch.handle, name: ch.name, badges: ch.badges || [], decorations: ch.decorations || [], strikes: ch.strikes || 0 }, blocked: (ch.blockedCommenters || []).map((x) => ({ uid: x.uid, name: x.name })), totals, series: seriesFrom(dsnap.docs, 28), videos, rewards, eligibility: cfg.eligibility }, "private, no-store");
  };

  get["video-analytics"] = async (req, res, q) => {
    const user = await getUser(req, true);
    const vs = await col("videos").doc(String(q.id || "x")).get();
    if (!vs.exists || vs.data().channelId !== user.uid) throw fail(404, "Video not found.");
    const d = await col("dailyStats").where("kind", "==", "v").where("id", "==", vs.id).limit(120).get();
    const v = vs.data();
    return ok(res, { id: vs.id, title: v.title, totals: { plays: v.views || 0, verifiedViews: v.verifiedViews || 0, likes: v.likes || 0, comments: v.comments || 0, watchSeconds: Math.round(v.watchSeconds || 0) }, series: seriesFrom(d.docs, 28) }, "private, no-store");
  };

  get["bug-mine"] = async (req, res) => {
    const user = await getUser(req, true);
    const snap = await col("bugReports").where("uid", "==", user.uid).limit(50).get();
    const items = snap.docs.map(withId).filter((b) => b.status !== "uploading").sort((a, b) => b.createdAt - a.createdAt).map((b) => ({ id: b.id, title: b.title, status: b.status, createdAt: b.createdAt, updatedAt: b.updatedAt, publicNote: b.publicNote || null }));
    return ok(res, { items }, "private, no-store");
  };

  // ===================================================================
  //                             POST actions
  // ===================================================================
  const myChannel = async (uid, mustExist = true) => {
    const s = await col("channels").doc(uid).get();
    if (!s.exists) { if (mustExist) throw fail(403, "Create a channel first."); return null; }
    if (s.data().suspended && mustExist) throw fail(403, "This channel is suspended.");
    return s.data();
  };
  const ownedVideo = async (id, uid) => {
    const s = await col("videos").doc(String(id || "x")).get();
    if (!s.exists || s.data().channelId !== uid) throw fail(404, "Video not found.");
    return { ref: s.ref || col("videos").doc(s.id), v: withId(s) };
  };
  const rejectSecrets = (...texts) => {
    const hits = L.scanSecrets(texts.join("\n"));
    if (hits.length) throw fail(400, `This looks like it contains a secret (${hits[0]}). Remove passwords, API keys and tokens before submitting.`);
  };

  post["upload-init"] = async (req, res, b) => {
    const user = await getUser(req, true);
    limitMem("upinit:" + user.uid, 30, 60000);
    await limitDurable(`upinit_${user.uid}`, 80, DAY);
    const purpose = String(b.purpose || ""); const ct = String(b.contentType || "");
    let allowed, max, path;
    if (purpose === "avatar" || purpose === "banner") {
      allowed = L.IMAGE_TYPES; max = purpose === "avatar" ? L.LIMITS.AVATAR_BYTES : L.LIMITS.BANNER_BYTES;
      if (!allowed[ct]) throw fail(400, "Use a JPEG, PNG or WebP image.");
      path = `channels/${user.uid}/${purpose}-${now()}.${allowed[ct]}`;
    } else if (purpose === "video" || purpose === "thumb") {
      const { v } = await ownedVideo(b.ref, user.uid);
      if (v.status !== "uploading") throw fail(400, "This video is no longer accepting uploads.");
      allowed = purpose === "video" ? L.VIDEO_TYPES : L.IMAGE_TYPES; max = purpose === "video" ? L.LIMITS.VIDEO_BYTES : L.LIMITS.THUMB_BYTES;
      if (!allowed[ct]) throw fail(400, purpose === "video" ? "Use an MP4, WebM or MOV video." : "Use a JPEG, PNG or WebP thumbnail.");
      path = `videos/${v.id}/${purpose}.${allowed[ct]}`;
      await col("videos").doc(v.id).update(purpose === "video" ? { videoPath: path, videoType: ct } : { thumbPath: path });
    } else if (purpose === "bug") {
      const s = await col("bugReports").doc(String(b.ref || "x")).get();
      if (!s.exists || s.data().uid !== user.uid || s.data().status !== "uploading") throw fail(404, "Report not found.");
      allowed = L.VIDEO_TYPES; max = L.LIMITS.BUG_VIDEO_BYTES;
      if (!allowed[ct]) throw fail(400, "Use an MP4, WebM or MOV recording.");
      path = `bugs/${s.id}/recording.${allowed[ct]}`;
      await col("bugReports").doc(s.id).update({ recordingPath: path });
    } else throw fail(400, "Unknown upload type.");
    if (Number(b.size) > max) throw fail(400, `File too large (max ${Math.round(max / 1048576)} MB).`);
    return ok(res, await policyFor(path, ct, max, Number(b.size)));
  };

  // ---------------- channels ----------------
  post["channel-create"] = async (req, res, b) => {
    const user = await getUser(req, true);
    await limitDurable(`chan_${user.uid}`, 5, DAY);
    if (b.agreeGuidelines !== true) throw fail(400, "You must agree to the community guidelines to create a channel.");
    const name = L.clean(b.name, L.LIMITS.CHANNEL_NAME);
    if (name.length < 2) throw fail(400, "Channel name must be at least 2 characters.");
    const h = L.validateHandle(b.handle); if (h.error) throw fail(400, h.error);
    const desc = L.clean(b.description, L.LIMITS.CHANNEL_DESC);
    const lk = L.validateLinks(b.links); if (lk.error) throw fail(400, lk.error);
    rejectSecrets(name, desc);
    const imgs = {};
    for (const k of ["avatar", "banner"]) {
      const p = b[k + "Path"];
      if (!p) continue;
      if (typeof p !== "string" || !p.startsWith(`channels/${user.uid}/${k}-`)) throw fail(400, `Bad ${k} upload.`);
      await verifyObject(p, Object.keys(L.IMAGE_TYPES), k === "avatar" ? L.LIMITS.AVATAR_BYTES : L.LIMITS.BANNER_BYTES);
      imgs[k + "Path"] = p;
    }
    const cref = col("channels").doc(user.uid); const href = col("handles").doc(h.handle);
    await db.runTransaction(async (tx) => {
      const [cs, hs] = await Promise.all([tx.get(cref), tx.get(href)]);
      if (cs.exists) throw fail(409, "You already have a channel.");
      if (hs.exists) throw fail(409, "That handle is taken.");
      tx.set(href, { uid: user.uid, at: now() });
      tx.set(cref, Object.assign({ uid: user.uid, handle: h.handle, name, description: desc, links: lk.links, createdAt: now(), subscribers: 0, videos: 0, verifiedViews: 0, views: 0, likes: 0, watchSeconds: 0, badges: [], decorations: [], strikes: 0, suspended: false, rewardHold: false, claimedMilestones: [], showSubscriberCount: true, commentsEnabled: true, guidelinesAcceptedAt: now(), guidelinesVersion: 1 }, imgs));
    });
    return ok(res, { handle: h.handle });
  };

  post["channel-update"] = async (req, res, b) => {
    const user = await getUser(req, true);
    const ch = await myChannel(user.uid);
    const patch = {};
    if (b.name !== undefined) { const n = L.clean(b.name, L.LIMITS.CHANNEL_NAME); if (n.length < 2) throw fail(400, "Channel name must be at least 2 characters."); patch.name = n; }
    if (b.description !== undefined) patch.description = L.clean(b.description, L.LIMITS.CHANNEL_DESC);
    if (b.links !== undefined) { const lk = L.validateLinks(b.links); if (lk.error) throw fail(400, lk.error); patch.links = lk.links; }
    if (typeof b.showSubscriberCount === "boolean") patch.showSubscriberCount = b.showSubscriberCount;
    if (typeof b.commentsEnabled === "boolean") patch.commentsEnabled = b.commentsEnabled;
    for (const k of ["avatar", "banner"]) {
      const p = b[k + "Path"]; if (!p) continue;
      if (typeof p !== "string" || !p.startsWith(`channels/${user.uid}/${k}-`)) throw fail(400, `Bad ${k} upload.`);
      await verifyObject(p, Object.keys(L.IMAGE_TYPES), k === "avatar" ? L.LIMITS.AVATAR_BYTES : L.LIMITS.BANNER_BYTES);
      patch[k + "Path"] = p;
    }
    rejectSecrets(patch.name || "", patch.description || "");
    await col("channels").doc(user.uid).update(patch);
    return ok(res, { ok: true, handle: ch.handle });
  };

  // Permanently deletes the caller's channel and all its videos. The user must type the handle.
  post["channel-delete"] = async (req, res, b) => {
    const user = await getUser(req, true);
    limitMem("chdel:" + user.uid, 3, 60000);
    const cs = await col("channels").doc(user.uid).get();
    if (!cs.exists) throw fail(404, "You don't have a channel.");
    if (String(b.confirmHandle || "").trim().toLowerCase().replace(/^@/, "") !== cs.data().handle) throw fail(400, "Type your channel handle exactly to confirm.");
    await purgeMomentsChannel({ db, inc, getBucket: () => bucket }, user.uid);
    await logModeration({ channelId: user.uid, decision: "channel_deleted_by_owner", source: "creator" });
    return ok(res, { ok: true });
  };

  // ---------------- videos ----------------
  post["video-create"] = async (req, res, b) => {
    const user = await getUser(req, true);
    const myCh = await myChannel(user.uid);
    const cfg = await launchSettings();
    const gate = uploadGate(cfg, user.uid, myCh);
    if (!gate.allowed) throw fail(403, gate.reason);
    // free-tier guard rails: total platform storage and per-channel storage
    const st = await statsDoc().get();
    if (!isAdmin(user.uid) && (st.exists ? st.data().storageBytes || 0 : 0) >= cfg.maxStorageMB * MB) throw fail(503, "Uploads are paused because Zyntra Moments reached its storage limit. Please try again later.");
    const mine = await col("videos").where("channelId", "==", user.uid).limit(200).get();
    const usedBytes = mine.docs.map((d) => d.data()).filter((v) => ["pending", "approved", "rejected", "under_review"].includes(v.status)).reduce((a, v) => a + (v.videoSize || 0), 0);
    if (!isAdmin(user.uid) && usedBytes + Number(b.size || 0) > cfg.maxChannelMB * MB) throw fail(400, `Your channel has reached its ${cfg.maxChannelMB} MB storage limit. Delete older videos to upload more.`);
    await limitDurable(`vid_${user.uid}`, L.LIMITS.UPLOADS_PER_DAY, DAY);
    const title = L.clean(b.title, L.LIMITS.TITLE); if (title.length < 2) throw fail(400, "Give your video a title.");
    const description = L.clean(b.description, L.LIMITS.DESC); const tags = L.cleanTags(b.tags);
    const visibility = L.VISIBILITIES.includes(b.visibility) ? b.visibility : "public";
    if (!L.VIDEO_TYPES[b.contentType]) throw fail(400, "Use an MP4, WebM or MOV video.");
    if (!(Number(b.size) > 0 && Number(b.size) <= L.LIMITS.VIDEO_BYTES)) throw fail(400, `Video must be under ${L.LIMITS.VIDEO_BYTES / 1048576} MB.`);
    const dur = Number(b.durationSec);
    if (!(dur > 0 && dur <= L.LIMITS.DURATION_SEC)) throw fail(400, `Video must be between 1 second and ${L.LIMITS.DURATION_SEC / 60} minutes.`);
    rejectSecrets(title, description, tags.join(" "));
    const ref = col("videos").doc();
    await ref.set({ channelId: user.uid, title, description, tags, searchTokens: L.tokenize(title, tags.join(" ")), visibility, status: "uploading", listed: false, createdAt: now(), publishedAt: null, durationSec: Math.round(dur), declaredType: b.contentType, views: 0, verifiedViews: 0, likes: 0, comments: 0, watchSeconds: 0, engagement: 0, reportCount: 0, rejection: null, appeal: null });
    return ok(res, { id: ref.id });
  };

  post["video-finalize"] = async (req, res, b) => {
    const user = await getUser(req, true);
    const { v } = await ownedVideo(b.id, user.uid);
    if (v.status !== "uploading") throw fail(400, "This video was already submitted.");
    if (!v.videoPath || !v.thumbPath) throw fail(400, "Upload the video and a thumbnail first.");
    const vi = await verifyObject(v.videoPath, Object.keys(L.VIDEO_TYPES), L.LIMITS.VIDEO_BYTES);
    await verifyObject(v.thumbPath, Object.keys(L.IMAGE_TYPES), L.LIMITS.THUMB_BYTES);
    const check = await autoCheck(v, b.frames);
    const ref = col("videos").doc(v.id);
    if (check.secrets.length) {
      const reason = `Possible exposed credential in the title or description (${check.secrets[0]}). Remove it and upload again.`;
      await ref.update({ status: "rejected", videoSize: vi.size, autoCheck: check, rejection: { category: "private_info", reason, auto: true, at: now() } });
      await statsDoc().set({ storageBytes: inc(vi.size) }, { merge: true });
      await logModeration({ videoId: v.id, channelId: v.channelId, decision: "reject", source: "auto", category: "private_info", reason });
      await notify(user.uid, "video_rejected", { videoId: v.id, title: v.title, category: "private_info", reason });
      return ok(res, { status: "rejected", reason });
    }
    await ref.update({ status: "pending", videoSize: vi.size, submittedAt: now(), autoCheck: check });
    await statsDoc().set({ storageBytes: inc(vi.size) }, { merge: true });
    await logModeration({ videoId: v.id, channelId: v.channelId, decision: "submitted", source: "auto", autoSummary: check.summary });
    return ok(res, { status: "pending" });
  };

  post["video-update"] = async (req, res, b) => {
    const user = await getUser(req, true);
    const { v } = await ownedVideo(b.id, user.uid);
    if (v.status === "removed") throw fail(404, "Video not found.");
    const patch = {}; let textChanged = false;
    if (b.title !== undefined) { const t = L.clean(b.title, L.LIMITS.TITLE); if (t.length < 2) throw fail(400, "Give your video a title."); patch.title = t; textChanged = true; }
    if (b.description !== undefined) { patch.description = L.clean(b.description, L.LIMITS.DESC); textChanged = true; }
    if (b.tags !== undefined) { patch.tags = L.cleanTags(b.tags); textChanged = true; }
    if (b.visibility !== undefined) { if (!L.VISIBILITIES.includes(b.visibility)) throw fail(400, "Bad visibility."); patch.visibility = b.visibility; }
    const merged = Object.assign({}, v, patch);
    rejectSecrets(merged.title, merged.description, (merged.tags || []).join(" "));
    patch.searchTokens = L.tokenize(merged.title, (merged.tags || []).join(" "));
    let needsReview = false;
    if (textChanged && v.status === "approved") {
      const chk = await autoCheck(merged, []);
      if (chk.summary === "flagged") { patch.status = "pending"; patch.autoCheck = chk; needsReview = true; }
    }
    await col("videos").doc(v.id).update(patch);
    await relist(v.id);
    return ok(res, { ok: true, needsReview });
  };

  post["video-delete"] = async (req, res, b) => {
    const user = await getUser(req, true);
    const s = await col("videos").doc(String(b.id || "x")).get();
    if (!s.exists) throw fail(404, "Video not found.");
    const v = withId(s);
    if (v.channelId !== user.uid && !isAdmin(user.uid)) throw fail(404, "Video not found.");
    await col("videos").doc(v.id).update({ status: "removed", removedAt: now() });
    await relist(v.id);
    for (const p of [v.videoPath, v.thumbPath]) if (p) await bucket.file(p).delete().catch(() => {});
    if (["pending", "approved", "rejected", "under_review"].includes(v.status) && v.videoSize) await statsDoc().set({ storageBytes: inc(-v.videoSize) }, { merge: true });
    return ok(res, { ok: true });
  };

  // ---------------- engagement ----------------
  post["video-like"] = async (req, res, b) => {
    const user = await getUser(req, true);
    limitMem("like:" + user.uid, 40, 60000);
    const vref = col("videos").doc(String(b.id || "x"));
    const vs = await vref.get();
    if (!vs.exists) throw fail(404, "Video not found.");
    const v = vs.data(); const cs = await col("channels").doc(v.channelId).get();
    if (!canView(v, cs.exists ? cs.data() : null, user.uid) || v.status !== "approved") throw fail(404, "Video not found.");
    const lref = vref.collection("likes").doc(user.uid); const cref = col("channels").doc(v.channelId);
    const want = b.like !== false; let changed = 0;
    await db.runTransaction(async (tx) => {
      const l = await tx.get(lref);
      if (want && !l.exists) { tx.set(lref, { at: now() }); tx.update(vref, { likes: inc(1), engagement: inc(3) }); tx.update(cref, { likes: inc(1) }); changed = 1; }
      else if (!want && l.exists) { tx.delete(lref); tx.update(vref, { likes: inc(-1), engagement: inc(-3) }); tx.update(cref, { likes: inc(-1) }); changed = -1; }
    });
    if (changed) await bumpDaily(vs.id, v.channelId, { likes: changed });
    // per-user index so account deletion can find this user's likes without a collection-group index
    if (changed === 1) await col("momentsMyLikes").doc(`${vs.id}__${user.uid}`).set({ uid: user.uid, videoId: vs.id, at: now() });
    if (changed === -1) await col("momentsMyLikes").doc(`${vs.id}__${user.uid}`).delete();
    if (changed === 1 && v.channelId !== user.uid) await notify(v.channelId, "like", { videoId: vs.id, title: v.title }, `like_${vs.id}_${user.uid}`);
    return ok(res, { liked: want });
  };

  post["comment-add"] = async (req, res, b) => {
    const user = await getUser(req, true);
    limitMem("cmt:" + user.uid, 6, 60000);
    await limitDurable(`cmt_${user.uid}`, 200, DAY);
    const text = L.clean(b.text, L.LIMITS.COMMENT);
    if (text.length < 1) throw fail(400, "Write a comment first.");
    if (L.countUrls(text) > 2) throw fail(400, "Too many links in one comment.");
    rejectSecrets(text);
    const vref = col("videos").doc(String(b.id || "x")); const vs = await vref.get();
    if (!vs.exists) throw fail(404, "Video not found.");
    const v = vs.data(); const cs = await col("channels").doc(v.channelId).get(); const ch = cs.exists ? cs.data() : null;
    if (!canView(v, ch, user.uid) || v.status !== "approved") throw fail(404, "Video not found.");
    if (ch.commentsEnabled === false && user.uid !== v.channelId) throw fail(403, "Comments are turned off for this channel.");
    if ((ch.blockedCommenters || []).some((x) => x.uid === user.uid)) throw fail(403, "You can't comment on this channel.");
    const mine = await col("channels").doc(user.uid).get();
    const authorName = mine.exists ? mine.data().name : (user.name ? String(user.name).slice(0, 30) : "Zyntra user");
    const ref = await vref.collection("comments").add({ uid: user.uid, authorName, authorHandle: mine.exists ? mine.data().handle : null, text, createdAt: now() });
    await col("momentsMyComments").doc(ref.id).set({ uid: user.uid, videoId: vs.id, at: now() });
    await vref.update({ comments: inc(1), engagement: inc(2) });
    await bumpDaily(vs.id, v.channelId, { comments: 1 });
    if (v.channelId !== user.uid) await notify(v.channelId, "comment", { videoId: vs.id, title: v.title, preview: text.slice(0, 80) });
    return ok(res, { id: ref.id, comment: { id: ref.id, text, authorName, authorHandle: mine.exists ? mine.data().handle : null, createdAt: now(), mine: true } });
  };

  post["comment-delete"] = async (req, res, b) => {
    const user = await getUser(req, true);
    const vref = col("videos").doc(String(b.videoId || "x")); const vs = await vref.get();
    if (!vs.exists) throw fail(404, "Not found.");
    const cref = vref.collection("comments").doc(String(b.commentId || "x")); const cs = await cref.get();
    if (!cs.exists) throw fail(404, "Not found.");
    if (cs.data().uid !== user.uid && vs.data().channelId !== user.uid && !isAdmin(user.uid)) throw fail(403, "You can't delete this comment.");
    await cref.delete();
    await col("momentsMyComments").doc(cs.id).delete();
    await vref.update({ comments: inc(-1), engagement: inc(-2) });
    return ok(res, { ok: true });
  };

  // channel owner blocks someone from commenting (and deletes that comment)
  post["comment-block"] = async (req, res, b) => {
    const user = await getUser(req, true);
    const vref = col("videos").doc(String(b.videoId || "x")); const vs = await vref.get();
    if (!vs.exists || vs.data().channelId !== user.uid) throw fail(404, "Not found.");
    const cref = vref.collection("comments").doc(String(b.commentId || "x")); const cs = await cref.get();
    if (!cs.exists) throw fail(404, "Not found.");
    const target = cs.data();
    if (target.uid === user.uid) throw fail(400, "You can't block yourself.");
    const chs = await col("channels").doc(user.uid).get(); const list = chs.data().blockedCommenters || [];
    if (!list.some((x) => x.uid === target.uid)) {
      if (list.length >= 200) throw fail(400, "Your block list is full (200).");
      await col("channels").doc(user.uid).update({ blockedCommenters: list.concat([{ uid: target.uid, name: String(target.authorName || "Zyntra user").slice(0, 40), at: now() }]) });
    }
    await cref.delete(); await col("momentsMyComments").doc(cs.id).delete();
    await vref.update({ comments: inc(-1), engagement: inc(-2) });
    return ok(res, { ok: true });
  };
  post["comment-unblock"] = async (req, res, b) => {
    const user = await getUser(req, true);
    const chs = await col("channels").doc(user.uid).get();
    if (!chs.exists) throw fail(404, "Not found.");
    await col("channels").doc(user.uid).update({ blockedCommenters: (chs.data().blockedCommenters || []).filter((x) => x.uid !== String(b.uid || "")) });
    return ok(res, { ok: true });
  };

  post["channel-subscribe"] = async (req, res, b) => {
    const user = await getUser(req, true);
    limitMem("sub:" + user.uid, 30, 60000);
    const cid = String(b.channelId || "");
    if (cid === user.uid) throw fail(400, "You can't subscribe to your own channel.");
    const cs = await col("channels").doc(cid || "x").get();
    if (!cs.exists || cs.data().suspended) throw fail(404, "Channel not found.");
    const sref = col("subscriptions").doc(`${user.uid}__${cid}`); const cref = col("channels").doc(cid);
    const want = b.subscribe !== false; let changed = 0;
    await db.runTransaction(async (tx) => {
      const s = await tx.get(sref);
      if (want && !s.exists) { tx.set(sref, { uid: user.uid, channelId: cid, at: now() }); tx.update(cref, { subscribers: inc(1) }); changed = 1; }
      else if (!want && s.exists) { tx.delete(sref); tx.update(cref, { subscribers: inc(-1) }); changed = -1; }
    });
    if (changed) await bumpDaily(null, cid, { subs: changed });
    if (changed === 1) { await notify(cid, "new_subscriber", {}, `sub_${user.uid}`); await checkMilestones(cid); }
    return ok(res, { subscribed: want });
  };

  // ---------------- views (verified vs. plays) ----------------
  post["view-beat"] = async (req, res, b) => {
    const user = await getUser(req, false);
    const vid = String(b.id || "x");
    const vs = await col("videos").doc(vid).get();
    if (!vs.exists) throw fail(404, "Video not found.");
    const v = withId(vs); const cs = await col("channels").doc(v.channelId).get(); const ch = cs.exists ? cs.data() : null;
    if (!(v.status === "approved" && ch && !ch.suspended && (v.visibility === "public" || v.visibility === "unlisted"))) throw fail(404, "Video not found.");
    const ip = clientIp(req); const ua = String(req.headers?.["user-agent"] || "").slice(0, 120);
    const viewerKey = user ? "u" + user.uid : "a" + (await hmac(ip + "|" + ua)).slice(0, 24);
    limitMem("beat:" + viewerKey, 20, 60000);
    const ipHash = (await hmac(ip)).slice(0, 16);
    const owner = !!user && user.uid === v.channelId;
    const ref = col("viewEvents").doc(`${vid}__${viewerKey}`);
    const threshold = L.verifyThreshold(v.durationSec);
    const pre = await ref.get();
    let sameNet = false;
    if (!owner && (pre.exists ? pre.data().watchSeconds || 0 : 0) + 15 >= threshold) {
      const q = await col("viewEvents").where("videoId", "==", vid).where("ipHash", "==", ipHash).where("verified", "==", true).limit(20).get();
      sameNet = q.docs.map((d) => d.data()).filter((d) => d.viewerKey !== viewerKey && now() - (d.verifiedAt || 0) < DAY).length >= L.LIMITS.SAME_NETWORK_VERIFIED_PER_DAY;
    }
    const r = await db.runTransaction(async (tx) => {
      const s = await tx.get(ref); const t = now();
      let d = s.exists ? s.data() : null; let newStart = false;
      if (!d || t - d.windowStart >= DAY) { d = { videoId: vid, channelId: v.channelId, viewerKey, ipHash, uid: user ? user.uid : null, windowStart: t, lastBeatAt: null, watchSeconds: 0, unflushed: 0, verified: false, held: false, self: owner, expireAt: t + 35 * DAY }; newStart = true; }
      const acc = L.acceptedSeconds(b.delta, d.lastBeatAt, t);
      d.watchSeconds += acc; d.unflushed += acc; d.lastBeatAt = t;
      let newlyVerified = false; let newlyHeld = false;
      if (!d.verified && !d.held && !owner && d.watchSeconds >= threshold) {
        if (sameNet) { d.held = true; newlyHeld = true; } else { d.verified = true; d.verifiedAt = t; newlyVerified = true; }
      }
      let flush = 0;
      if (!owner && !d.held && (d.unflushed >= 30 || b.ended === true)) { flush = d.unflushed; d.unflushed = 0; }
      tx.set(ref, d);
      return { newStart, newlyVerified, newlyHeld, flush };
    });
    if (owner) return ok(res, { ok: true });
    const vref = col("videos").doc(vid); const cref = col("channels").doc(v.channelId);
    if (r.newStart) { await vref.update({ views: inc(1) }); await bumpDaily(vid, v.channelId, { views: 1 }); }
    if (r.flush > 0) { await vref.update({ watchSeconds: inc(r.flush) }); await cref.update({ watchSeconds: inc(r.flush) }); await bumpDaily(vid, v.channelId, { watch: Math.round(r.flush) }); }
    if (r.newlyHeld) await col("suspicious").doc(`net_${vid}_${ipHash}_${L.dayKey(now())}`).set({ type: "same_network", videoId: vid, channelId: v.channelId, ipHash, status: "open", createdAt: now(), note: "Several accounts/devices on one network verified this video in 24h; extra views were not counted." }, { merge: true });
    if (r.newlyVerified) {
      await vref.update({ verifiedViews: inc(1), engagement: inc(1) });
      await cref.update({ verifiedViews: inc(1) });
      await bumpDaily(vid, v.channelId, { verified: 1 });
      await col("stats").doc("moments").set({ verifiedViews: inc(1) }, { merge: true });
      const hid = `${vid}_${L.hourKey(now())}`;
      await col("hourly").doc(hid).set({ videoId: vid, verified: inc(1) }, { merge: true });
      const h = await col("hourly").doc(hid).get();
      if (h.exists && h.data().verified >= L.LIMITS.VERIFIED_PER_HOUR_SPIKE) await col("suspicious").doc(`spike_${hid}`).set({ type: "spike", videoId: vid, channelId: v.channelId, status: "open", createdAt: now(), count: h.data().verified, note: "Unusually many verified views in one hour." }, { merge: true });
      await checkMilestones(v.channelId);
    }
    return ok(res, { ok: true });
  };

  // ---------------- reports & appeals ----------------
  post.report = async (req, res, b) => {
    const user = await getUser(req, true);
    await limitDurable(`rep_${user.uid}`, 30, DAY);
    const type = ["video", "comment", "channel"].includes(b.targetType) ? b.targetType : null;
    if (!type) throw fail(400, "Bad report.");
    if (!L.REPORT_REASONS.includes(b.reason)) throw fail(400, "Pick a reason.");
    const targetId = String(b.targetId || ""); const videoId = type === "comment" ? String(b.videoId || "") : type === "video" ? targetId : null;
    if (type === "channel") { if (!(await col("channels").doc(targetId || "x").get()).exists) throw fail(404, "Not found."); }
    else {
      const vs = await col("videos").doc(videoId || "x").get(); if (!vs.exists) throw fail(404, "Not found.");
      if (type === "comment" && !(await col("videos").doc(videoId).collection("comments").doc(targetId || "x").get()).exists) throw fail(404, "Not found.");
    }
    const rref = col("momentsReports").doc(`${type}_${targetId}_${user.uid}`);
    let isNew = false;
    await db.runTransaction(async (tx) => {
      const s = await tx.get(rref);
      if (s.exists) return;
      tx.set(rref, { targetType: type, targetId, videoId, reporter: user.uid, reason: b.reason, details: L.clean(b.details, 500), status: "open", createdAt: now() });
      isNew = true;
    });
    if (isNew && type === "video") {
      const vref = col("videos").doc(targetId);
      await vref.update({ reportCount: inc(1) });
      const v = (await vref.get()).data();
      if (v.reportCount >= L.LIMITS.REPORTS_AUTOHIDE && v.status === "approved") {
        await vref.update({ status: "under_review", reviewReason: "reports" });
        await relist(targetId);
        await logModeration({ videoId: targetId, channelId: v.channelId, decision: "held_for_review", source: "reports", reason: `${v.reportCount} viewer reports` });
      }
    }
    return ok(res, { ok: true });
  };

  post["appeal-create"] = async (req, res, b) => {
    const user = await getUser(req, true);
    const { v } = await ownedVideo(b.id, user.uid);
    if (v.status !== "rejected") throw fail(400, "Only rejected videos can be appealed.");
    if (v.appeal) throw fail(400, "This video was already appealed.");
    const text = L.clean(b.text, 1000); if (text.length < 10) throw fail(400, "Please explain why the decision should be reconsidered (at least 10 characters).");
    await col("videos").doc(v.id).update({ appeal: { status: "open", text, at: now() } });
    await logModeration({ videoId: v.id, channelId: v.channelId, decision: "appeal_opened", source: "creator" });
    return ok(res, { ok: true });
  };

  // ---------------- notifications & prefs ----------------
  post["notif-read"] = async (req, res, b) => {
    const user = await getUser(req, true);
    const items = col("notifications").doc(user.uid).collection("items");
    let ids = Array.isArray(b.ids) ? b.ids.slice(0, 50).map(String) : [];
    if (b.all === true) ids = (await items.where("read", "==", false).limit(100).get()).docs.map((d) => d.id);
    await Promise.all(ids.map((id) => items.doc(id).update({ read: true }).catch(() => {})));
    return ok(res, { ok: true, count: ids.length });
  };
  post["prefs-set"] = async (req, res, b) => {
    const user = await getUser(req, true);
    const patch = {};
    for (const k of ["subscribers", "likes", "comments", "published", "bugUpdates", "achievements", "rewards"]) if (typeof b[k] === "boolean") patch[k] = b[k];
    await col("momentsPrefs").doc(user.uid).set(patch, { merge: true });
    return ok(res, { ok: true });
  };

  // ---------------- bug reports (private by default) ----------------
  post["bug-create"] = async (req, res, b) => {
    const user = await getUser(req, true);
    await limitDurable(`bug_${user.uid}`, 10, DAY);
    const title = L.clean(b.title, 120); const description = L.clean(b.description, 3000); const steps = L.clean(b.steps, 2000);
    if (title.length < 3 || description.length < 10) throw fail(400, "Please add a title and describe the problem.");
    rejectSecrets(title, description, steps);
    const hasRec = b.hasRecording === true;
    if (hasRec && !L.VIDEO_TYPES[b.contentType]) throw fail(400, "Use an MP4, WebM or MOV recording.");
    if (hasRec && !(Number(b.size) > 0 && Number(b.size) <= L.LIMITS.BUG_VIDEO_BYTES)) throw fail(400, `Recording must be under ${L.LIMITS.BUG_VIDEO_BYTES / 1048576} MB.`);
    const status = hasRec ? "uploading" : "received"; const t = now();
    const ref = col("bugReports").doc();
    await ref.set({ uid: user.uid, title, description, steps, device: L.cleanDevice(b.device), status, private: true, createdAt: t, updatedAt: t, history: [{ status: "received", at: t, by: "system" }] });
    return ok(res, { id: ref.id, status });
  };
  post["bug-finalize"] = async (req, res, b) => {
    const user = await getUser(req, true);
    const s = await col("bugReports").doc(String(b.id || "x")).get();
    if (!s.exists || s.data().uid !== user.uid || s.data().status !== "uploading") throw fail(404, "Report not found.");
    await verifyObject(s.data().recordingPath || "x", Object.keys(L.VIDEO_TYPES), L.LIMITS.BUG_VIDEO_BYTES);
    await col("bugReports").doc(s.id).update({ status: "received", updatedAt: now() });
    return ok(res, { status: "received" });
  };

  // ===================================================================
  //        ADMIN — every action below re-checks admin status server-side
  // ===================================================================
  async function decideVideo(v, decision, o) {
    const ref = col("videos").doc(v.id);
    if (decision === "approve") {
      await ref.update({ status: "approved", publishedAt: v.publishedAt || now(), rejection: null, reviewReason: del() });
      await relist(v.id);
      await logModeration({ videoId: v.id, channelId: v.channelId, decision: "approve", source: o.source || "admin", by: o.by, reason: o.reason || "" });
      await notify(v.channelId, "video_published", { videoId: v.id, title: v.title, visibility: v.visibility });
      return;
    }
    const strike = STRIKE_CATEGORIES.includes(o.category) && o.strike !== false;
    await ref.update({ status: "rejected", rejection: { category: o.category, reason: o.reason, at: now(), by: o.by, strike }, reviewReason: del() });
    await relist(v.id);
    if (strike) await col("channels").doc(v.channelId).update({ strikes: inc(1) });
    await logModeration({ videoId: v.id, channelId: v.channelId, decision: "reject", source: o.source || "admin", by: o.by, category: o.category, reason: o.reason });
    await notify(v.channelId, "video_rejected", { videoId: v.id, title: v.title, category: o.category, reason: o.reason, canAppeal: !v.appeal });
  }
  const loadVideo = async (id) => {
    const s = await col("videos").doc(String(id || "x")).get();
    if (!s.exists) throw fail(404, "Video not found.");
    return withId(s);
  };
  const count = async (q) => { try { return (await q.count().get()).data().count; } catch (e) { return null; } };

  get["admin-stats"] = async (req, res) => {
    await requireAdmin(req);
    const v = (s) => count(col("videos").where("status", "==", s));
    const b = (s) => count(col("bugReports").where("status", "==", s));
    const [channels, pending, underReview, approved, rejected, reports, appeals, suspicious, claims, bugsReceived, bugsInv, bugsProg, bugsFixed, platform] = await Promise.all([
      count(col("channels")), v("pending"), v("under_review"), v("approved"), v("rejected"),
      count(col("momentsReports").where("status", "==", "open")), count(col("videos").where("appeal.status", "==", "open")),
      count(col("suspicious").where("status", "==", "open")), count(col("rewardClaims").where("status", "==", "pending_review")),
      b("received"), b("investigating"), b("in_progress"), b("fixed"), col("stats").doc("moments").get()
    ]);
    return ok(res, { channels, videos: { pending, underReview, approved, rejected }, openReports: reports, openAppeals: appeals, suspicious, pendingClaims: claims, bugs: { received: bugsReceived, investigating: bugsInv, in_progress: bugsProg, fixed: bugsFixed }, verifiedViewsPlatform: platform.exists ? platform.data().verifiedViews || 0 : 0 }, "private, no-store");
  };

  const reviewCard = async (v) => {
    const cs = await col("channels").doc(v.channelId).get(); const ch = cs.exists ? cs.data() : {};
    return { id: v.id, title: v.title, description: v.description, tags: v.tags || [], status: v.status, visibility: v.visibility, durationSec: v.durationSec, submittedAt: v.submittedAt || v.createdAt, reviewReason: v.reviewReason || null, reportCount: v.reportCount || 0, autoCheck: v.autoCheck || null, channel: { id: v.channelId, handle: ch.handle, name: ch.name, strikes: ch.strikes || 0 }, appeal: v.appeal || null, rejection: v.rejection || null, thumbUrl: v.thumbPath ? await signedRead(v.thumbPath, 600) : null };
  };
  get["admin-queue"] = async (req, res) => {
    await requireAdmin(req);
    const [a, b] = await Promise.all([col("videos").where("status", "==", "pending").limit(100).get(), col("videos").where("status", "==", "under_review").limit(50).get()]);
    const vids = a.docs.concat(b.docs).map(withId).sort((x, y) => ((y.autoCheck?.summary === "flagged") - (x.autoCheck?.summary === "flagged")) || ((x.submittedAt || 0) - (y.submittedAt || 0)));
    return ok(res, { items: await Promise.all(vids.map(reviewCard)) }, "private, no-store");
  };
  get["admin-video"] = async (req, res, q) => {
    await requireAdmin(req);
    const v = await loadVideo(q.id);
    return ok(res, { video: await reviewCard(v), videoUrl: v.videoPath ? await signedRead(v.videoPath, 1800) : null }, "private, no-store");
  };
  get["admin-appeals"] = async (req, res) => {
    await requireAdmin(req);
    const s = await col("videos").where("appeal.status", "==", "open").limit(100).get();
    return ok(res, { items: await Promise.all(s.docs.map(withId).map(reviewCard)) }, "private, no-store");
  };
  get["admin-reports"] = async (req, res) => {
    await requireAdmin(req);
    const s = await col("momentsReports").where("status", "==", "open").limit(100).get();
    const items = await Promise.all(s.docs.map(withId).sort((a, b) => a.createdAt - b.createdAt).map(async (r) => {
      let target = {};
      if (r.targetType === "video") { const v = await col("videos").doc(r.targetId).get(); if (v.exists) target = { title: v.data().title, status: v.data().status }; }
      if (r.targetType === "comment") { const c = await col("videos").doc(r.videoId).collection("comments").doc(r.targetId).get(); if (c.exists) target = { text: c.data().text }; }
      if (r.targetType === "channel") { const c = await col("channels").doc(r.targetId).get(); if (c.exists) target = { handle: c.data().handle }; }
      return { id: r.id, targetType: r.targetType, targetId: r.targetId, videoId: r.videoId, reason: r.reason, details: r.details, createdAt: r.createdAt, target };
    }));
    return ok(res, { items }, "private, no-store");
  };
  get["admin-bugs"] = async (req, res, q) => {
    await requireAdmin(req);
    let query = col("bugReports");
    if (L.BUG_STATUSES.includes(q.status)) query = query.where("status", "==", q.status);
    const s = await query.limit(100).get();
    const items = s.docs.map(withId).filter((x) => x.status !== "uploading").sort((a, b) => b.createdAt - a.createdAt).map((x) => ({ id: x.id, title: x.title, status: x.status, createdAt: x.createdAt, hasRecording: !!x.recordingPath }));
    return ok(res, { items }, "private, no-store");
  };
  get["admin-bug"] = async (req, res, q) => {
    await requireAdmin(req);
    const s = await col("bugReports").doc(String(q.id || "x")).get();
    if (!s.exists) throw fail(404, "Not found.");
    const x = withId(s);
    return ok(res, { bug: { id: x.id, title: x.title, description: x.description, steps: x.steps, device: x.device, status: x.status, history: x.history, createdAt: x.createdAt, reporter: x.uid, publicNote: x.publicNote || null }, recordingUrl: x.recordingPath ? await signedRead(x.recordingPath, 1800) : null }, "private, no-store");
  };
  get["admin-channels"] = async (req, res, q) => {
    await requireAdmin(req);
    const t = L.clean(q.q, 30).toLowerCase().replace(/^@/, "");
    const s = t ? await col("channels").orderBy("handle").startAt(t).endAt(t + "\uf8ff").limit(50).get() : await col("channels").orderBy("createdAt", "desc").limit(50).get();
    return ok(res, { items: s.docs.map((d) => d.data()).map((c) => ({ id: c.uid, handle: c.handle, name: c.name, subscribers: c.subscribers || 0, videos: c.videos || 0, verifiedViews: c.verifiedViews || 0, strikes: c.strikes || 0, suspended: !!c.suspended, rewardHold: !!c.rewardHold, canUpload: c.canUpload === true, createdAt: c.createdAt })) }, "private, no-store");
  };
  get["admin-suspicious"] = async (req, res) => {
    await requireAdmin(req);
    const s = await col("suspicious").where("status", "==", "open").limit(100).get();
    return ok(res, { items: s.docs.map(withId).sort((a, b) => b.createdAt - a.createdAt) }, "private, no-store");
  };
  get["admin-claims"] = async (req, res) => {
    await requireAdmin(req);
    const cfg = await rewardSettings();
    const s = await col("rewardClaims").where("status", "==", "pending_review").limit(100).get();
    const items = await Promise.all(s.docs.map(withId).map(async (c) => {
      const cs = await col("channels").doc(c.channelId).get(); const ch = cs.exists ? cs.data() : {};
      const m = cfg.milestones.find((x) => x.id === c.milestoneId) || c;
      return { id: c.id, title: c.title, reward: c.reward, metric: c.metric, threshold: c.threshold, createdAt: c.createdAt, channel: { handle: ch.handle, name: ch.name, strikes: ch.strikes || 0, rewardHold: !!ch.rewardHold, suspended: !!ch.suspended, verifiedViews: ch.verifiedViews || 0, subscribers: ch.subscribers || 0 }, problemsExcludingOriginality: L.eligibilityProblems(ch, cfg.eligibility, now(), m, true) };
    }));
    return ok(res, { items }, "private, no-store");
  };
  get["admin-launch"] = async (req, res) => {
    await requireAdmin(req);
    const cfg = await launchSettings(); const [st, eg, ca] = await Promise.all([statsDoc().get(), col("stats").doc("egress_" + L.dayKey(now())).get(), count(col("channels").where("canUpload", "==", true))]);
    return ok(res, { config: cfg, usage: { storageMB: Math.round(((st.exists ? st.data().storageBytes : 0) || 0) / MB), egressTodayMB: Math.round(((eg.exists ? eg.data().bytes : 0) || 0) / MB), allowedChannels: ca } }, "private, no-store");
  };
  // ---- storage diagnostics: why do uploads fail? (admin only) ----
  const siteOrigin = (req) => {
    const host = String(req.headers?.["x-forwarded-host"] || req.headers?.host || "").split(",")[0].trim();
    const proto = String(req.headers?.["x-forwarded-proto"] || "https").split(",")[0].trim();
    return host ? `${proto}://${host}` : null;
  };
  const errText = (e) => String((e && (e.message || e.code)) || e).slice(0, 300);
  const corsAllows = (cors, origin, method) => (cors || []).some((c) => (c.origin || []).some((o) => o === "*" || o === origin) && (c.method || []).some((m) => m === method || m === "*"));
  get["admin-storage-check"] = async (req, res) => {
    await requireAdmin(req);
    const origin = siteOrigin(req); const isS3 = bucket.kind === "s3"; const needMethod = isS3 ? "PUT" : "POST";
    const out = { provider: isS3 ? "S3-compatible storage" : "Google Cloud Storage", bucket: bucket.name, origin, exists: null, location: null, cors: null, corsOk: null, canWrite: null, canSign: null, problems: [] };
    try { const [ex] = await bucket.exists(); out.exists = !!ex; }
    catch (e) { out.exists = null; out.problems.push(isS3 ? `The server couldn't reach bucket "${bucket.name}" at ${bucket.endpointHost}: ${errText(e)}. Check the S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY variables in Vercel (the key must be allowed to read and write this bucket).` : `The server couldn't look at the bucket "${bucket.name}": ${errText(e)}. Its Google service account probably needs the "Storage Admin" (or at least "Storage Object Admin") role.`); }
    if (out.exists === false) {
      out.problems.push(isS3 ? `Bucket "${bucket.name}" wasn't found at ${bucket.endpointHost}. Check the bucket name (S3_BUCKET) and endpoint (S3_ENDPOINT).` : `The storage bucket "${bucket.name}" doesn't exist. In the Firebase console open Storage → Get started (this needs the Blaze plan), or set the MOMENTS_BUCKET environment variable in Vercel to your real bucket name and redeploy. No card? Use free S3-compatible storage instead (S3_* variables).`);
      if (!isS3 && deps.bucketNamed) {
        // older Firebase projects use <project>.appspot.com, newer ones <project>.firebasestorage.app
        let pid = null; try { pid = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT).project_id; } catch (e) {}
        for (const n of pid ? [`${pid}.appspot.com`, `${pid}.firebasestorage.app`] : []) {
          if (n === bucket.name) continue;
          try { const [ex] = await deps.bucketNamed(n).exists(); if (ex) { out.altBucket = n; out.problems.push(`Found a different bucket named "${n}". In Vercel, add the environment variable MOMENTS_BUCKET = ${n}, then redeploy.`); } } catch (e) { /* ignore */ }
        }
      }
    }
    if (out.exists) {
      try {
        const [meta] = await bucket.getMetadata(); out.location = meta.location || null;
        if (meta.corsUnknown) { out.cors = null; out.corsOk = null; out.problems.push(`This storage provider doesn't let us read its CORS rules, so I can't check that automatically. Press "Fix upload settings (CORS)" to try setting them, or set them in the provider's dashboard (allow ${origin} with the methods PUT, GET and HEAD and any headers). Then just try an upload.`); }
        else { out.cors = meta.cors || []; out.corsOk = corsAllows(out.cors, origin, needMethod); if (!out.corsOk) out.problems.push(`The bucket doesn't allow uploads from ${origin}. This is the usual cause of "Network problem during the upload". Press "Fix upload settings (CORS)".`); }
      } catch (e) { out.problems.push(`Couldn't read the bucket's settings: ${errText(e)}.`); }
      try { const f = bucket.file("_health/check.txt"); await f.save("ok", { contentType: "text/plain" }); await f.delete(); out.canWrite = true; }
      catch (e) { out.canWrite = false; out.problems.push(isS3 ? `The server can't write to the bucket: ${errText(e)}. The access key needs read and write permission on this bucket.` : `The server can't write to the bucket: ${errText(e)}. Give the Firebase service account the "Storage Object Admin" role in Google Cloud → IAM.`); }
      try {
        const f = bucket.file("_health/sign.txt");
        if (!f.presignPut) { await f.generateSignedPostPolicyV4({ expires: now() + 60000, conditions: [["content-length-range", 1, 10]], fields: { "Content-Type": "text/plain" } }); out.canSign = true; }
        else {
          // a REAL round-trip from the server: presigned upload, presigned download, delete — proves our signatures are accepted by this provider
          const roundtrip = async (signLength) => {
            const p = await f.presignPut({ contentType: "text/plain", size: 4, signLength });
            const put = await bucket.fetch(p.url, { method: "PUT", headers: p.headers, body: "test" });
            if (put.status < 200 || put.status >= 300) return `upload link rejected (HTTP ${put.status})`;
            const [gurl] = await f.getSignedUrl({ action: "read", expires: now() + 60000 });
            const get = await bucket.fetch(gurl, { method: "GET" });
            const txt = get.status === 200 ? await get.text() : "";
            await f.delete().catch(() => {});
            return get.status === 200 && txt === "test" ? null : `download link rejected (HTTP ${get.status})`;
          };
          const first = await roundtrip(undefined);
          if (!first) out.canSign = true;
          else {
            out.canSign = false;
            const second = bucket.signsContentLength ? await roundtrip(false) : first;
            if (!second && bucket.signsContentLength) out.problems.push(`This provider rejects uploads whose size is part of the signature. In Vercel add the environment variable S3_SIGN_CONTENT_LENGTH = 0, then redeploy. (Size is still checked after each upload; this only loosens the first line of defence.)`);
            else out.problems.push(`Signed upload/download links don't work with this provider: ${first}. Check S3_ENDPOINT, S3_REGION (for Backblaze it is the middle of the endpoint, e.g. us-west-004) and the access key.`);
          }
        }
      } catch (e) { out.canSign = false; out.problems.push(`Couldn't create or test signed links: ${errText(e)}.`); }
    }
    out.ok = out.exists === true && (out.corsOk === true || out.corsOk === null) && out.canWrite === true && out.canSign === true && !(out.corsOk === null && !out.problems.length);
    out.corsUnverified = out.corsOk === null && out.exists === true;
    return ok(res, out, "private, no-store");
  };
  get["admin-rewards-config"] = async (req, res) => { await requireAdmin(req); return ok(res, { config: await rewardSettings() }, "private, no-store"); };
  get["admin-moderation-log"] = async (req, res) => {
    await requireAdmin(req);
    const s = await col("moderation").orderBy("at", "desc").limit(60).get();
    return ok(res, { items: s.docs.map(withId) }, "private, no-store");
  };

  post["admin-decide"] = async (req, res, b) => {
    const admin = await requireAdmin(req);
    const v = await loadVideo(b.id);
    if (!["pending", "under_review"].includes(v.status)) throw fail(400, "This video isn't waiting for review.");
    if (b.decision === "approve") await decideVideo(v, "approve", { by: admin.uid, reason: L.clean(b.reason, 300) });
    else if (b.decision === "reject") {
      if (!L.REPORT_REASONS.includes(b.category)) throw fail(400, "Pick a rejection category.");
      const reason = L.clean(b.reason, 500); if (reason.length < 5) throw fail(400, "Write a short explanation the creator will see.");
      await decideVideo(v, "reject", { by: admin.uid, category: b.category, reason, strike: b.countsAsStrike !== false });
    } else throw fail(400, "Bad decision.");
    return ok(res, { ok: true });
  };

  post["admin-appeal-decide"] = async (req, res, b) => {
    const admin = await requireAdmin(req);
    const v = await loadVideo(b.id);
    if (!v.appeal || v.appeal.status !== "open") throw fail(400, "No open appeal.");
    const note = L.clean(b.note, 500);
    const ref = col("videos").doc(v.id);
    if (b.decision === "overturn") {
      await ref.update({ status: "approved", publishedAt: v.publishedAt || now(), appeal: Object.assign({}, v.appeal, { status: "overturned", note, decidedAt: now(), by: admin.uid }), rejection: null });
      if (v.rejection && v.rejection.strike) await col("channels").doc(v.channelId).update({ strikes: inc(-1) });
      await relist(v.id);
      await notify(v.channelId, "moderation", { videoId: v.id, title: v.title, decision: "appeal_overturned", note });
    } else if (b.decision === "uphold") {
      await ref.update({ appeal: Object.assign({}, v.appeal, { status: "denied", note, decidedAt: now(), by: admin.uid }) });
      await notify(v.channelId, "moderation", { videoId: v.id, title: v.title, decision: "appeal_denied", note });
    } else throw fail(400, "Bad decision.");
    await logModeration({ videoId: v.id, channelId: v.channelId, decision: "appeal_" + b.decision, source: "admin", by: admin.uid, reason: note });
    return ok(res, { ok: true });
  };

  post["admin-report-resolve"] = async (req, res, b) => {
    const admin = await requireAdmin(req);
    const rs = await col("momentsReports").doc(String(b.id || "x")).get();
    if (!rs.exists || rs.data().status !== "open") throw fail(404, "Report not found.");
    const r = rs.data(); const act = b.resolution === "remove" ? "remove" : "dismiss";
    if (act === "remove") {
      const category = L.REPORT_REASONS.includes(b.category) ? b.category : r.reason;
      if (r.targetType === "video") {
        const v = await loadVideo(r.targetId);
        if (["approved", "pending", "under_review"].includes(v.status)) await decideVideo(v, "reject", { by: admin.uid, category, reason: L.clean(b.note, 500) || "Removed after a community report.", source: "report" });
      } else if (r.targetType === "comment") {
        const cref = col("videos").doc(r.videoId).collection("comments").doc(r.targetId);
        if ((await cref.get()).exists) { await cref.delete(); await col("videos").doc(r.videoId).update({ comments: inc(-1), engagement: inc(-2) }); }
      } else if (r.targetType === "channel") {
        await col("channels").doc(r.targetId).update({ suspended: true, suspendReason: L.clean(b.note, 300) });
        const vs = await col("videos").where("channelId", "==", r.targetId).limit(200).get();
        for (const d of vs.docs) await relist(d.id);
      }
    } else if (r.targetType === "video") {
      const v = (await col("videos").doc(r.targetId).get()).data();
      if (v && v.status === "under_review") await decideVideo(Object.assign({ id: r.targetId }, v), "approve", { by: admin.uid, reason: "Reports dismissed", source: "report" });
    }
    const sib = await col("momentsReports").where("targetId", "==", r.targetId).where("status", "==", "open").limit(100).get();
    await Promise.all(sib.docs.map((d) => col("momentsReports").doc(d.id).update({ status: "resolved", action: act, by: admin.uid, at: now() })));
    return ok(res, { ok: true });
  };

  post["admin-bug-update"] = async (req, res, b) => {
    const admin = await requireAdmin(req);
    if (!L.BUG_STATUSES.includes(b.status)) throw fail(400, "Bad status.");
    const s = await col("bugReports").doc(String(b.id || "x")).get();
    if (!s.exists) throw fail(404, "Not found.");
    const x = s.data(); const note = L.clean(b.note, 500); const t = now();
    const patch = { status: b.status, updatedAt: t, history: (x.history || []).concat([{ status: b.status, at: t, by: "admin", note }]) };
    if (note) patch.publicNote = note;
    await col("bugReports").doc(s.id).update(patch);
    if (b.status !== x.status && L.BUG_NOTIFY_STATUSES.includes(b.status)) await notify(x.uid, "bug_update", { bugId: s.id, title: x.title, status: b.status, note });
    return ok(res, { ok: true });
  };

  post["admin-channel-set"] = async (req, res, b) => {
    const admin = await requireAdmin(req);
    const id = String(b.id || "x"); const cs = await col("channels").doc(id).get();
    if (!cs.exists) throw fail(404, "Channel not found.");
    const suspended = b.suspended === true;
    await col("channels").doc(id).update({ suspended, suspendReason: suspended ? L.clean(b.reason, 300) : "" });
    const vs = await col("videos").where("channelId", "==", id).limit(200).get();
    for (const d of vs.docs) await relist(d.id);
    await logModeration({ channelId: id, decision: suspended ? "channel_suspended" : "channel_restored", source: "admin", by: admin.uid, reason: L.clean(b.reason, 300) });
    await notify(id, "moderation", { decision: suspended ? "channel_suspended" : "channel_restored", note: L.clean(b.reason, 300) });
    return ok(res, { ok: true });
  };

  post["admin-suspicious-resolve"] = async (req, res, b) => {
    const admin = await requireAdmin(req);
    const ref = col("suspicious").doc(String(b.id || "x")); const s = await ref.get();
    if (!s.exists || s.data().status !== "open") throw fail(404, "Not found.");
    const r = s.data();
    if (b.resolution === "invalidate") {
      const v = await loadVideo(r.videoId);
      const n = Math.max(1, Math.min(Math.floor(Number(b.count) || 0), v.verifiedViews || 0));
      if (!(v.verifiedViews > 0)) throw fail(400, "No verified views to invalidate.");
      await col("videos").doc(v.id).update({ verifiedViews: inc(-n), engagement: inc(-n) });
      await col("channels").doc(v.channelId).update({ verifiedViews: inc(-n), rewardHold: true });
      await col("stats").doc("moments").set({ verifiedViews: inc(-n) }, { merge: true });
      await ref.update({ status: "invalidated", invalidated: n, by: admin.uid, at: now() });
    } else await ref.update({ status: "dismissed", by: admin.uid, at: now() });
    return ok(res, { ok: true });
  };

  post["admin-claim-decide"] = async (req, res, b) => {
    const admin = await requireAdmin(req);
    const ref = col("rewardClaims").doc(String(b.id || "x")); const s = await ref.get();
    if (!s.exists || s.data().status !== "pending_review") throw fail(404, "Claim not found.");
    const c = s.data(); const note = L.clean(b.note, 300);
    if (b.decision === "deny") {
      await ref.update({ status: "denied", note, decidedBy: admin.uid, decidedAt: now() });
      await notify(c.ownerUid, "moderation", { decision: "reward_denied", title: c.title, note });
      return ok(res, { ok: true });
    }
    if (b.decision !== "approve") throw fail(400, "Bad decision.");
    const cfg = await rewardSettings(); const cs = await col("channels").doc(c.channelId).get(); const ch = cs.data();
    const m = cfg.milestones.find((x) => x.id === c.milestoneId) || c;
    const problems = L.eligibilityProblems(ch, cfg.eligibility, now(), m, b.originalityConfirmed === true);
    if (problems.length) throw fail(400, "Not eligible yet: " + problems.join(" "));
    const r = c.reward; let fulfillment = "done";
    if (r.type === "badge" || r.type === "decoration") {
      const key = r.type === "badge" ? "badges" : "decorations"; const arr = ch[key] || [];
      if (!arr.includes(r.value)) await col("channels").doc(c.channelId).update({ [key]: arr.concat([r.value]) });
    } else if (r.type === "ultra_days") {
      const bref = col("billing").doc(c.ownerUid); const prev = (await bref.get()).data() || {};
      const next = computeNextPlan(prev, "ultra", now(), PLAN_PRICES, Number(r.value) * DAY);
      await bref.set({ plan: next.plan, planExpiresAt: next.planExpiresAt, lastRewardGrantAt: now() }, { merge: true });
    } else fulfillment = "manual";
    await ref.update({ status: "approved", note, decidedBy: admin.uid, decidedAt: now(), originalityConfirmed: true, fulfillment });
    await notify(c.ownerUid, "reward_approved", { title: c.title, reward: r.label || String(r.value), fulfillment });
    await logModeration({ channelId: c.channelId, decision: "reward_approved", source: "admin", by: admin.uid, reason: c.milestoneId });
    return ok(res, { ok: true, fulfillment });
  };

  post["admin-launch-set"] = async (req, res, b) => {
    await requireAdmin(req);
    const modes = ["closed", "allowlist", "open"];
    if (!modes.includes(b.uploads)) throw fail(400, "Pick closed, allowlist or open.");
    const num = (v, lo, hi, name) => { const n = Math.floor(Number(v)); if (!(n >= lo && n <= hi)) throw fail(400, `${name} must be between ${lo} and ${hi}.`); return n; };
    const cfg = { uploads: b.uploads, maxChannelMB: num(b.maxChannelMB, 10, 100000, "Per-channel storage (MB)"), maxStorageMB: num(b.maxStorageMB, 10, 10000000, "Total storage (MB)"), dailyEgressMB: num(b.dailyEgressMB, 50, 10000000, "Daily playback (MB)") };
    await col("settings").doc("momentsLaunch").set(cfg);
    shared.launch = null;
    return ok(res, { ok: true, config: cfg });
  };
  // sets the bucket's CORS so browsers on THIS site may upload/play (replaces the bucket's existing CORS list)
  post["admin-storage-setup"] = async (req, res) => {
    await requireAdmin(req);
    const isS3 = bucket.kind === "s3";
    const origins = [...new Set([siteOrigin(req)].concat(String(env.MOMENTS_ORIGINS || "").split(",").map((x) => x.trim())).filter(Boolean))];
    if (!origins.length) throw fail(400, "Couldn't work out this site's address.");
    const cors = [{ origin: origins, method: isS3 ? ["PUT", "GET", "HEAD"] : ["POST", "GET", "HEAD"], responseHeader: ["Content-Type", "Range", "Accept-Ranges", "Content-Length", "Content-Range"], maxAgeSeconds: 3600 }];
    try { await bucket.setCorsConfiguration(cors); return ok(res, { ok: true, origins }); }
    catch (e) {
      const base = { ok: false, error: errText(e), corsJson: JSON.stringify(cors, null, 2) };
      if (isS3) return ok(res, Object.assign(base, { hint: `This storage provider didn't accept CORS settings through its API, so set them in its dashboard: allow the origin ${origins.join(", ")} with methods PUT, GET, HEAD and allowed headers *. (Backblaze B2: Buckets → your bucket → CORS Rules; Supabase and others: see their docs.) The JSON below shows the values.` }));
      if (/does not exist|not found|404/i.test(errText(e))) return ok(res, Object.assign(base, { hint: `The bucket "${bucket.name}" doesn't exist yet, so there is nothing to change. Turn on storage first: Firebase console → Storage → Get started (needs the Blaze plan). Then press "Run check again" and "Fix upload settings (CORS)".` }));
      return ok(res, Object.assign(base, { hint: `The server's Google account isn't allowed to change bucket settings. Set it by hand: Google Cloud Console → Cloud Storage → "${bucket.name}" → Configuration → CORS, or run: gcloud storage buckets update gs://${bucket.name} --cors-file=cors.json (using the JSON shown here).` }));
    }
  };
  post["admin-channel-uploads"] = async (req, res, b) => {
    const admin = await requireAdmin(req);
    const cs = await col("channels").doc(String(b.id || "x")).get();
    if (!cs.exists) throw fail(404, "Channel not found.");
    await col("channels").doc(cs.id).update({ canUpload: b.allow === true });
    await logModeration({ channelId: cs.id, decision: b.allow === true ? "upload_access_granted" : "upload_access_removed", source: "admin", by: admin.uid });
    if (b.allow === true) await notify(cs.id, "moderation", { decision: "upload_access_granted" });
    return ok(res, { ok: true });
  };
  post["admin-rewards-config-set"] = async (req, res, b) => {
    await requireAdmin(req);
    const v = L.validateRewardsConfig(b.config);
    if (v.error) throw fail(400, v.error);
    await col("settings").doc("momentsRewards").set(v.config);
    shared.rewards = null;
    return ok(res, { ok: true, config: v.config });
  };

  return { get, post };
}

export default createMomentsHandler();
