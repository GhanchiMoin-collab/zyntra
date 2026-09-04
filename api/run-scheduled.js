import { getAdminDb } from "./_lib/firebaseAdmin.js";

// Runs once a day via Vercel Cron (see vercel.json). This is what makes
// Scheduled Tasks actually DO something — until this file existed, the
// Scheduled page could create/list/delete tasks, but nothing ever ran
// them. This endpoint scans every signed-up user's scheduledTasks, runs
// the ones that are due, and writes the result back so it's there next
// time they open the app — same idea as ChatGPT's Scheduled tasks.

// Simple, non-streaming, no-tools Groq call — a scheduled task is a single
// one-shot prompt, not a multi-turn conversation, so this stays deliberately
// smaller than the full agent loop in chat.js.
async function runOnePrompt(prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b',
        temperature: 0.7,
        max_tokens: 1024,
        messages: [
          { role: 'system', content: 'You are Zyntra AI, running a scheduled task on the user\'s behalf with no further input from them. Answer the request directly and usefully — no "let me know if you want more" filler, since there is no follow-up turn.' },
          { role: 'user', content: prompt }
        ]
      }),
      signal: controller.signal
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || `Groq returned ${response.status}`);
    return data?.choices?.[0]?.message?.content || "(No response generated.)";
  } finally {
    clearTimeout(timer);
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

function isDue(task, now) {
  if (!task.active) return false;
  if (!task.lastRunAt) return true; // never run yet
  const intervalMs = task.frequency === "weekly" ? 7 * DAY_MS : DAY_MS;
  // Small buffer (-2h) so a task doesn't get skipped for a day if this
  // cron's exact run time drifts slightly from one day to the next.
  return now - task.lastRunAt >= intervalMs - (2 * 60 * 60 * 1000);
}

export default async function handler(req, res) {
  // Vercel signs cron requests with this header automatically — this is
  // the standard way to make sure only Vercel's scheduler (not a random
  // public POST) can trigger task runs. Requires a CRON_SECRET env var
  // set in the Vercel project (any random string works).
  const authHeader = req.headers.authorization || "";
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const db = getAdminDb();
  const now = Date.now();
  let usersChecked = 0, tasksRun = 0, tasksFailed = 0;

  try {
    // Scheduled tasks live inside each user's own doc (same place as
    // profile/sessions/memories), so finding "everyone with due tasks"
    // means scanning the users collection. Fine at this app's current
    // scale; would need its own top-level collection (like projects) if
    // the user base grows large enough for this to get slow.
    const usersSnap = await db.collection("users").get();

    for (const userDoc of usersSnap.docs) {
      const data = userDoc.data();
      const tasks = Array.isArray(data.scheduledTasks) ? data.scheduledTasks : [];
      if (tasks.length === 0) continue;
      usersChecked++;

      let changed = false;
      for (const task of tasks) {
        if (!isDue(task, now)) continue;
        try {
          const reply = await runOnePrompt(task.prompt);
          task.results = Array.isArray(task.results) ? task.results : [];
          task.results.push({ ranAt: now, reply });
          // Keep only the most recent 10 results per task so the doc
          // doesn't grow unbounded over months of daily runs.
          if (task.results.length > 10) task.results = task.results.slice(-10);
          task.lastRunAt = now;
          tasksRun++;
        } catch (err) {
          console.error(`Scheduled task failed (user ${userDoc.id}, task ${task.id}):`, err.message);
          tasksFailed++;
        }
        changed = true;
      }

      if (changed) {
        await userDoc.ref.update({ scheduledTasks: tasks });
      }
    }

    return res.status(200).json({ ok: true, usersChecked, tasksRun, tasksFailed });
  } catch (error) {
    console.error("run-scheduled error:", error);
    return res.status(500).json({ error: "Scheduled run failed", detail: error.message });
  }
}
