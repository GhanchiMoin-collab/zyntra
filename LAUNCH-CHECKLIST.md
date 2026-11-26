# Zyntra Moments — launch checklist (stage 1 → 3)

Legend: ✅ built and covered by automated tests (fake database) · 🧪 YOU must test on the live site · 👤 needs a parent/trusted adult or a lawyer

## Recommended stages (Admin → Moments → "Launch controls")
| Stage | Setting | Who can do what |
|---|---|---|
| 1 | Uploads: **Closed** | Everyone can browse, watch, comment, create channels. Nobody uploads (except admins). |
| 2 | Uploads: **Invited creators only** | Only channels you tick "Allow uploads" in the Channels tab. Start with 3–5 people you know. |
| 3 | Uploads: **Open** | Only after the gates below pass and an adult reviewer is in place. |
Safe defaults: uploads closed · 500 MB per channel · 3000 MB total · 800 MB/day playback. When a limit is hit, uploads/playback pause by themselves.
Limits are cautious guesses — compare them with your Firebase plan's free quota (firebase.google.com/pricing) and lower them if needed.

## The 12 gates
1. **Homepage and navigation** 🧪 click every sidebar item, Moments home, search, a channel page, the policy page; on phone and desktop.
2. **Sign-up / login** 🧪 test Google, Microsoft, email, and "not signed in" (guest) separately. Moments only needs sign-in for channel, upload, like, comment, subscribe, report.
3. **Channel creation + deletion** ✅🧪 create → Studio → Settings → Danger zone → delete (type the handle). Check the channel page now says "not found".
4. **Upload + playback** 🧪 the one thing never run against the real Google Storage. Upload a ~5 MB MP4 → it shows "pending" in Studio → approve as admin → open the link in a private window.
5. **Video deletion** ✅🧪 Studio → Delete. Row disappears; the link shows "isn't available"; Firebase Storage → file is gone.
6. **Private videos stay private** ✅🧪 set a video Private; open its link in a private window and a second account → must say "isn't available". Same for a pending video.
7. **Moderation approve/reject/appeal** ✅🧪 reject with a reason → creator sees notification → appeal → admin overturns.
8. **Bug reports private** ✅🧪 file one with account A; account B must not see it (Bug reports page shows only own); only admin sees it in Admin → Bug reports.
9. **Admin protected on the server** ✅ every admin action checks the server; 🧪 sign in with a normal account and open /moments/admin → must say "Administrators only".
10. **Policies + grievance contact** 👤 see "Legal" below. The grievance officer's name and contact are NOT in the policy yet — don't invent them.
11. **Storage + bandwidth limits** ✅ built (see stages); 🧪 try lowering "Max storage per channel" to 10 MB and uploading a bigger file.
12. **Adult review of readiness** 👤.

## Before Stage 2
* **Back up:** GitHub → Releases → "Create a new release" (tag `pre-moments-launch`). Vercel → Deployments keeps your previous builds (use Promote to roll back).
* **Firestore rules:** compare with the deployed ones in the console (the file in the repo is incomplete). Moments needs no new rules.
* **Add a second admin who is an adult**: in Vercel set `ADMIN_UID` to `your-uid,adult-uid` (comma-separated), redeploy.
* **Enable the TTL** on `viewEvents` → field `expireAt` (the policy says raw view records are kept ~35 days).
* **Set the bucket CORS** (cors.json) if you haven't — uploads fail without it.

## Safety: who watches the review queue
Reviewers will see whatever people upload, including things nobody should have to see. **Please don't be the only person who watches unreviewed uploads.** Keep Stage 2 to people you know, have an adult share the admin role, and if something shows up that involves a child, sexual content or serious threats: don't forward or re-share it. Reject it, disable the channel, and let an adult report it (such material has legal reporting duties).

## Legal (not legal advice — have an adult/lawyer check; I searched current sources on 26 Nov 2026)
* **IT (Intermediary Guidelines) Rules 2021, Rule 3(2):** an intermediary must prominently publish the Grievance Officer's name and contact details and how to complain; acknowledge complaints within 24 hours and resolve within 15 days; remove intimate-imagery complaints within 24 hours. It must also publish its rules, privacy policy and user agreement (the Moments guidelines are in the channel form; there is no separate Terms page yet). Some summaries mention a duty to preserve certain information for 180 days (Rule 3(1)(h)), which may conflict with promising full deletion — ask the lawyer.
* **DPDP Act 2023 + Rules 2025 (notified 13–14 Nov 2025):** a "child" is anyone under 18; verifiable parental consent applies (Rule 10). The main obligations phase in over ~18 months, i.e. around **mid-May 2027** — not yet in force today, but it covers every Zyntra user under 18, not only Moments.
* The new 18+ wording for channels is in the policy, but the channel form does not check age — an age checkbox is not "verifiable" consent.
