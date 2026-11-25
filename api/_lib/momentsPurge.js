// Deletes everything Zyntra Moments holds about one user. Called from the
// account-deletion flow in api/payment.js (so it adds no serverless function).
//
// Removed: the user's channel, videos (files + comments + likes on them), the
// comments / likes / subscriptions they made elsewhere (counters are corrected),
// raw view records, notifications + preferences, bug reports (+ recordings),
// reward claims, rate-limit counters.
// De-identified, not deleted: reports they filed about other content (reporter
// id removed). Kept: moderation-decision log entries (internal ids + decision +
// reason, used for abuse prevention) and anonymous aggregate counters.
export async function purgeMomentsUser(deps, uid) {
  const { db, inc, getBucket } = deps;
  const col = (n) => db.collection(n);
  let bucketCache;
  const bucket = () => (bucketCache = bucketCache || getBucket());
  const rmFiles = async (prefix) => {
    try { await bucket().deleteFiles({ prefix }); }
    catch (e) { if (!(e && (e.code === 404 || /does not exist|not found/i.test(String(e.message))))) throw e; }
  };
  const each = async (q, fn) => {
    for (;;) {
      const s = await q.limit(300).get();
      if (s.empty) break;
      for (const d of s.docs) await fn(d);
      if (s.docs.length < 300) break;
    }
  };
  const del = (q) => each(q, (d) => d.ref.delete());

  // 1) my videos (and everything hanging off them)
  await each(col("videos").where("channelId", "==", uid), async (d) => {
    const vid = d.id;
    await rmFiles(`videos/${vid}/`);
    await del(col("dailyStats").where("kind", "==", "v").where("id", "==", vid));
    await del(col("hourly").where("videoId", "==", vid));
    await del(col("viewEvents").where("videoId", "==", vid));
    await del(col("momentsMyComments").where("videoId", "==", vid));
    await del(col("momentsMyLikes").where("videoId", "==", vid));
    await del(col("momentsReports").where("videoId", "==", vid));
    await del(col("suspicious").where("videoId", "==", vid));
    await db.recursiveDelete(d.ref); // comments + likes sub-collections
  });

  // 2) my channel
  const cs = await col("channels").doc(uid).get();
  if (cs.exists) {
    const ch = cs.data();
    await del(col("dailyStats").where("kind", "==", "c").where("id", "==", uid));
    await del(col("suspicious").where("channelId", "==", uid));
    await del(col("rewardClaims").where("channelId", "==", uid));
    await del(col("subscriptions").where("channelId", "==", uid));
    if (ch.handle) await col("handles").doc(ch.handle).delete();
    await col("channels").doc(uid).delete();
    await rmFiles(`channels/${uid}/`);
  }

  // 3) comments I made on other people's videos
  await each(col("momentsMyComments").where("uid", "==", uid), async (d) => {
    const { videoId } = d.data();
    const cref = col("videos").doc(videoId).collection("comments").doc(d.id);
    if ((await cref.get()).exists) {
      await cref.delete();
      if ((await col("videos").doc(videoId).get()).exists) await col("videos").doc(videoId).update({ comments: inc(-1), engagement: inc(-2) });
    }
    await d.ref.delete();
  });

  // 4) likes I gave
  await each(col("momentsMyLikes").where("uid", "==", uid), async (d) => {
    const { videoId } = d.data();
    const lref = col("videos").doc(videoId).collection("likes").doc(uid);
    const vs = await col("videos").doc(videoId).get();
    if ((await lref.get()).exists) {
      await lref.delete();
      if (vs.exists) {
        await col("videos").doc(videoId).update({ likes: inc(-1), engagement: inc(-3) });
        const c = await col("channels").doc(vs.data().channelId).get();
        if (c.exists) await col("channels").doc(vs.data().channelId).update({ likes: inc(-1) });
      }
    }
    await d.ref.delete();
  });

  // 5) channels I subscribed to
  await each(col("subscriptions").where("uid", "==", uid), async (d) => {
    const c = await col("channels").doc(d.data().channelId).get();
    if (c.exists) await col("channels").doc(d.data().channelId).update({ subscribers: inc(-1) });
    await d.ref.delete();
  });

  // 6) raw view records, notifications, preferences
  await del(col("viewEvents").where("uid", "==", uid));
  await db.recursiveDelete(col("notifications").doc(uid));
  await col("momentsPrefs").doc(uid).delete();

  // 7) my bug reports (+ recordings)
  await each(col("bugReports").where("uid", "==", uid), async (d) => {
    await rmFiles(`bugs/${d.id}/`);
    await d.ref.delete();
  });

  // 8) reports I filed: keep the report, drop who filed it
  await each(col("momentsReports").where("reporter", "==", uid), (d) => d.ref.update({ reporter: null }));

  // 9) per-user rate-limit counters
  for (const p of ["chan_", "vid_", "upinit_", "cmt_", "rep_", "bug_"]) await col("rateLimits").doc(p + uid).delete();
}
