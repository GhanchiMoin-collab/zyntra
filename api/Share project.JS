import { getAdminAuth, getAdminDb } from "./_lib/firebaseAdmin.js";

// Adds a Zyntra user (by email) as a full member of a project. Runs
// server-side via the Admin SDK specifically because looking up a uid by
// email, and writing another user's uid into a project's members list, are
// both things a client can never be trusted to do itself — the Firestore
// rules for /projects intentionally don't allow a client to add arbitrary
// uids to `members`, only the backend can.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: "Sign in required." });

    const decoded = await getAdminAuth().verifyIdToken(idToken);
    const requesterUid = decoded.uid;

    const { projectId, email } = req.body || {};
    if (!projectId || !email || typeof email !== "string") {
      return res.status(400).json({ error: "Missing projectId or email." });
    }
    const cleanEmail = email.trim().toLowerCase();

    const db = getAdminDb();
    const projectRef = db.collection("projects").doc(String(projectId));
    const projectSnap = await projectRef.get();
    if (!projectSnap.exists) {
      return res.status(404).json({ error: "Project not found." });
    }
    const project = projectSnap.data();

    if (!Array.isArray(project.members) || !project.members.includes(requesterUid)) {
      return res.status(403).json({ error: "You're not a member of this project." });
    }

    // Look up the invitee's account. This is the one thing that genuinely
    // requires the Admin SDK — a client can never resolve an arbitrary
    // email to a uid on its own (that would let anyone probe which emails
    // have accounts), so it has to happen here after we've already
    // confirmed the requester is allowed to invite people to this project.
    let inviteeUser;
    try {
      inviteeUser = await getAdminAuth().getUserByEmail(cleanEmail);
    } catch (err) {
      return res.status(404).json({ error: "No Zyntra account found with that email." });
    }

    if (project.members.includes(inviteeUser.uid)) {
      return res.status(200).json({ ok: true, alreadyMember: true, message: "That person is already in this project." });
    }

    await projectRef.update({
      members: [...project.members, inviteeUser.uid],
      memberEmails: [...(project.memberEmails || []), cleanEmail]
    });

    return res.status(200).json({ ok: true, email: cleanEmail });
  } catch (error) {
    console.error("share-project error:", error);
    return res.status(500).json({ error: "Something went wrong sharing this project. Please try again." });
  }
}
