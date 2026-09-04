import { google } from "googleapis";
import { getAdminAuth, getAdminDb, increment } from "./_lib/firebaseAdmin.js";
import { getAuthorizedClientForUser } from "./_lib/googleOAuth.js";

// Vercel's default serverless timeout (10s on Hobby) isn't enough for a
// real web search — the model may call a tool, wait on the result, then
// write the answer, which can take 15-40+ seconds. This raises the
// ceiling for this function. (Also mirrored in vercel.json, which is the
// more reliable place to set this for classic /api serverless functions.)
export const config = {
  maxDuration: 60
};

// ================= Agent tools =================
// Each tool has a JSON schema (sent to the model so it knows the tool
// exists and how to call it) and an `execute` function (runs server-side
// when the model asks for it). Add new tools here — e.g. Gmail/Calendar
// actions — and they'll automatically be available to the agent loop
// below with no other code changes needed.

const TOOLS = [
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the live web for current, up-to-date, or fact-specific information — news, prices, scores, current people/roles, recent events, or anything that may have changed since training. Returns a list of results with title, url, and a text snippet.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query. Keep it short and specific (a few words), like a real search engine query." }
        },
        required: ["query"]
      }
    },
    // Uses Tavily (built for LLM agents — free tier at tavily.com).
    // Requires TAVILY_API_KEY in your Vercel environment variables.
    async execute({ query }) {
      if (!process.env.TAVILY_API_KEY) {
        return { error: "Web search isn't configured yet — missing TAVILY_API_KEY." };
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: process.env.TAVILY_API_KEY,
            query,
            max_results: 5,
            search_depth: "basic"
          }),
          signal: controller.signal
        });
        const data = await response.json();
        if (!response.ok) {
          return { error: data?.error || "Search request failed." };
        }
        const results = (data.results || []).map(r => ({
          title: r.title,
          url: r.url,
          snippet: r.content ? r.content.slice(0, 500) : ""
        }));
        return { results, answer: data.answer || null };
      } catch (err) {
        if (err.name === "AbortError") {
          return { error: "Search timed out." };
        }
        return { error: "Search failed: " + err.message };
      } finally {
        clearTimeout(timer);
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_current_datetime",
      description: "Get the current real-world date and time. Use this whenever you need to know today's date, or to work out something relative like 'next Friday' or 'in 3 days' — never guess or assume the date from memory.",
      parameters: { type: "object", properties: {} }
    },
    async execute() {
      return { iso: new Date().toISOString() };
    }
  },
  {
    type: "function",
    function: {
      name: "remember_fact",
      description: "Save a short, durable fact about the user for future conversations — something likely to still be true and useful weeks from now (their name, job, ongoing projects, preferences, recurring constraints). Do NOT save one-off details, temporary context, or anything sensitive (passwords, financial account numbers, health details). Call this quietly whenever the user shares something worth remembering — don't announce that you're saving it, and don't ask permission first.",
      parameters: {
        type: "object",
        properties: {
          fact: { type: "string", description: "The fact, written concisely in third person, e.g. \"Building an app called Zyntra AI\" or \"Prefers Python over JavaScript\"." }
        },
        required: ["fact"]
      }
    },
    // This backend has no direct database access (Firestore here is
    // client-side only, scoped to the signed-in user by firestore.rules).
    // So this tool just acknowledges the call — the actual save happens
    // in the frontend, which reads zyntra_memory_writes off the response
    // and writes it to Firestore under the current user. See script.js.
    async execute() {
      return { saved: true };
    }
  },
  {
    requiresGoogle: true,
    type: "function",
    function: {
      name: "send_email",
      description: "Send an email from the user's connected Gmail account. Only available once the user has connected Google in Settings. This sends a real email that can't be unsent — always state the exact recipient, subject, and body back to the user in your reply and get clear confirmation before calling this tool, unless they already gave you all three details explicitly in this message.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email address." },
          subject: { type: "string", description: "Email subject line." },
          body: { type: "string", description: "Plain text email body." }
        },
        required: ["to", "subject", "body"]
      }
    },
    async execute({ to, subject, body }, ctx) {
      if (!ctx?.googleClient) return { error: "Gmail isn't connected for this user." };
      try {
        const gmail = google.gmail({ version: "v1", auth: ctx.googleClient });
        const message = [
          `To: ${to}`,
          `Subject: ${subject}`,
          "Content-Type: text/plain; charset=utf-8",
          "",
          body
        ].join("\n");
        const raw = Buffer.from(message).toString("base64url");
        await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
        return { sent: true, to, subject };
      } catch (err) {
        console.error("send_email failed:", err);
        return { error: "Failed to send email: " + (err.message || "unknown error") };
      }
    }
  },
  {
    requiresGoogle: true,
    type: "function",
    function: {
      name: "create_calendar_event",
      description: "Create an event on the user's connected Google Calendar. Only available once the user has connected Google in Settings. Confirm the title, date/time, and duration with the user before calling this, unless they already gave you all the details explicitly.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Event title." },
          start_iso: { type: "string", description: "Event start time in ISO 8601, e.g. 2026-09-02T15:00:00." },
          end_iso: { type: "string", description: "Event end time in ISO 8601." },
          description: { type: "string", description: "Optional event description." },
          timezone: { type: "string", description: "IANA timezone, e.g. Asia/Kolkata. Ask the user if unclear, otherwise default to Asia/Kolkata." }
        },
        required: ["title", "start_iso", "end_iso"]
      }
    },
    async execute({ title, start_iso, end_iso, description, timezone }, ctx) {
      if (!ctx?.googleClient) return { error: "Google Calendar isn't connected for this user." };
      try {
        const calendar = google.calendar({ version: "v3", auth: ctx.googleClient });
        const { data } = await calendar.events.insert({
          calendarId: "primary",
          requestBody: {
            summary: title,
            description: description || "",
            start: { dateTime: start_iso, timeZone: timezone || "Asia/Kolkata" },
            end: { dateTime: end_iso, timeZone: timezone || "Asia/Kolkata" }
          }
        });
        return { created: true, eventId: data.id, eventLink: data.htmlLink };
      } catch (err) {
        console.error("create_calendar_event failed:", err);
        return { error: "Failed to create event: " + (err.message || "unknown error") };
      }
    }
  },
  {
    requiresGoogle: true,
    type: "function",
    function: {
      name: "list_calendar_events",
      description: "Look up what's already on the user's connected Google Calendar in a given time range. Use this before creating an event if you need to check for conflicts, or whenever the user asks what's on their schedule (e.g. \"what do I have today\", \"am I free Friday afternoon\").",
      parameters: {
        type: "object",
        properties: {
          time_min_iso: { type: "string", description: "Start of the range to check, ISO 8601, e.g. 2026-09-02T00:00:00." },
          time_max_iso: { type: "string", description: "End of the range to check, ISO 8601, e.g. 2026-09-03T00:00:00." }
        },
        required: ["time_min_iso", "time_max_iso"]
      }
    },
    async execute({ time_min_iso, time_max_iso }, ctx) {
      if (!ctx?.googleClient) return { error: "Google Calendar isn't connected for this user." };
      try {
        const calendar = google.calendar({ version: "v3", auth: ctx.googleClient });
        const { data } = await calendar.events.list({
          calendarId: "primary",
          timeMin: new Date(time_min_iso).toISOString(),
          timeMax: new Date(time_max_iso).toISOString(),
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 20
        });
        const events = (data.items || []).map(ev => ({
          id: ev.id,
          title: ev.summary || "(untitled)",
          start: ev.start?.dateTime || ev.start?.date,
          end: ev.end?.dateTime || ev.end?.date
        }));
        return { events };
      } catch (err) {
        console.error("list_calendar_events failed:", err);
        return { error: "Failed to check the calendar: " + (err.message || "unknown error") };
      }
    }
  },
  {
    requiresGoogle: true,
    type: "function",
    function: {
      name: "update_calendar_event",
      description: "Change the time, title, or description of an existing event on the user's connected Google Calendar. Requires the event's ID — call list_calendar_events first if you don't already have it from earlier in this conversation. Confirm the change with the user before calling this.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string", description: "The event's ID, from list_calendar_events or create_calendar_event." },
          title: { type: "string", description: "New title, if changing it." },
          start_iso: { type: "string", description: "New start time in ISO 8601, if changing it." },
          end_iso: { type: "string", description: "New end time in ISO 8601, if changing it." },
          timezone: { type: "string", description: "IANA timezone for the new times, e.g. Asia/Kolkata. Only needed if start_iso/end_iso are given." }
        },
        required: ["event_id"]
      }
    },
    async execute({ event_id, title, start_iso, end_iso, timezone }, ctx) {
      if (!ctx?.googleClient) return { error: "Google Calendar isn't connected for this user." };
      try {
        const calendar = google.calendar({ version: "v3", auth: ctx.googleClient });
        const requestBody = {};
        if (title) requestBody.summary = title;
        if (start_iso) requestBody.start = { dateTime: start_iso, timeZone: timezone || "Asia/Kolkata" };
        if (end_iso) requestBody.end = { dateTime: end_iso, timeZone: timezone || "Asia/Kolkata" };
        const { data } = await calendar.events.patch({
          calendarId: "primary",
          eventId: event_id,
          requestBody
        });
        return { updated: true, eventLink: data.htmlLink };
      } catch (err) {
        console.error("update_calendar_event failed:", err);
        return { error: "Failed to update the event: " + (err.message || "unknown error") };
      }
    }
  },
  {
    requiresGoogle: true,
    type: "function",
    function: {
      name: "cancel_calendar_event",
      description: "Delete/cancel an existing event on the user's connected Google Calendar. Requires the event's ID — call list_calendar_events first if you don't already have it. Always confirm with the user before cancelling, since this can't be undone.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string", description: "The event's ID, from list_calendar_events or create_calendar_event." }
        },
        required: ["event_id"]
      }
    },
    async execute({ event_id }, ctx) {
      if (!ctx?.googleClient) return { error: "Google Calendar isn't connected for this user." };
      try {
        const calendar = google.calendar({ version: "v3", auth: ctx.googleClient });
        await calendar.events.delete({ calendarId: "primary", eventId: event_id });
        return { cancelled: true };
      } catch (err) {
        console.error("cancel_calendar_event failed:", err);
        return { error: "Failed to cancel the event: " + (err.message || "unknown error") };
      }
    }
  }

  // Next tools to add here, following the same { function, execute } shape.
];

const TOOLS_BY_NAME = Object.fromEntries(TOOLS.map(t => [t.function.name, t]));

async function executeTool(name, argsJson, ctx) {
  const tool = TOOLS_BY_NAME[name];
  if (!tool) return { error: `Unknown tool: ${name}` };
  let args = {};
  try {
    args = argsJson ? JSON.parse(argsJson) : {};
  } catch {
    return { error: "Invalid arguments JSON from model." };
  }
  try {
    return await tool.execute(args, ctx);
  } catch (err) {
    console.error(`Tool ${name} threw:`, err);
    return { error: `Tool ${name} failed: ${err.message}` };
  }
}

// Pulls web_search results out of the running message list so the
// frontend can show the user what was actually searched, same shape as
// before (zyntra_sources: [{ title, url }]).
function extractSourcesFromToolMessages(messages, maxSources = 6) {
  const sources = [];
  for (const m of messages) {
    if (m.role !== "tool") continue;
    let parsed;
    try { parsed = JSON.parse(m.content); } catch { continue; }
    if (Array.isArray(parsed?.results)) {
      for (const r of parsed.results) {
        if (r?.url) sources.push({ title: r.title || r.url, url: r.url });
      }
    }
  }
  const seen = new Set();
  return sources.filter(s => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  }).slice(0, maxSources);
}

// Pulls any remember_fact tool calls the model made out of the finished
// conversation, so the frontend can persist them to the signed-in user's
// Firestore doc. Returns a plain array of fact strings.
function extractMemoryWrites(messages) {
  const facts = [];
  for (const m of messages) {
    if (m.role !== "assistant" || !Array.isArray(m.tool_calls)) continue;
    for (const call of m.tool_calls) {
      if (call.function?.name !== "remember_fact") continue;
      try {
        const args = JSON.parse(call.function.arguments || "{}");
        if (args.fact && typeof args.fact === "string") facts.push(args.fact.trim());
      } catch {
        // malformed arguments from the model — skip it rather than error out
      }
    }
  }
  return facts;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages: rawMessages, forceSearch, research, website, lite } = req.body || {};

    if (!Array.isArray(rawMessages)) {
      return res.status(400).json({ error: 'Missing messages array' });
    }

    // Long-running chats keep resending their FULL history on every single
    // message, so a conversation can eventually exceed the token-per-minute
    // limit even when the newest message is just "yes" — the accumulated
    // history is the problem, not any one message. Keep any leading system
    // message(s) (custom instructions etc.) always, and cap the actual
    // conversation to the most recent turns so older context ages out
    // instead of the whole request failing.
    const messages = trimMessages(rawMessages);

    // "lite" calls (e.g. quick internal classification) always use the
    // fast, reliable plain-text model directly — no tools, no agent loop —
    // so they're fast and don't add a second point of failure to whatever
    // heavier call happens next.
    if (lite) {
      const result = await callGroqLite(messages);
      if (!result.ok) {
        return res.status(result.status || 500).json({ error: userFacingError(result) });
      }
      return res.status(200).json(result.data);
    }

    // If any message contains an image, we need a vision-capable model.
    // qwen3.6-27b doesn't support tool calling on Groq, so image messages
    // skip the agent loop entirely and just answer directly.
    const hasImage = messages.some(
      m => Array.isArray(m.content) && m.content.some(part => part.type === 'image_url')
    );

    // If the frontend sent a Firebase ID token (it does automatically once
    // signed in), verify it to get a trusted uid, then check whether that
    // user has connected Google. Both steps fail silently — a missing
    // token, missing admin config, or no Google connection just means the
    // Gmail/Calendar tools aren't offered this request; plain chat is
    // completely unaffected.
    let googleClient = null;
    let uid = null; // trusted user id, used below for server-side usage tracking
    try {
      const authHeader = req.headers.authorization || "";
      const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
      if (idToken) {
        const decoded = await getAdminAuth().verifyIdToken(idToken);
        uid = decoded.uid;
        googleClient = await getAuthorizedClientForUser(decoded.uid);
      }
    } catch (err) {
      console.error("Auth/Google lookup failed (continuing without Google tools):", err.message);
    }

    // ---- Usage tracking ----
    // Accumulates real Groq usage across every round of the agent loop
    // (including retries/fallbacks) for THIS single /api/chat call, then
    // gets written once to Firestore as atomic increments. This is the
    // real, server-side source of truth for plan limits and pricing —
    // never trust anything the client claims about its own usage.
    const usageStats = { groqRequests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, modelCounts: {} };
    function trackUsage(model, usage) {
      usageStats.groqRequests += 1;
      usageStats.modelCounts[model] = (usageStats.modelCounts[model] || 0) + 1;
      if (usage) {
        usageStats.inputTokens += usage.prompt_tokens || 0;
        usageStats.outputTokens += usage.completion_tokens || 0;
        usageStats.totalTokens += usage.total_tokens || 0;
      }
    }
    // Writes the accumulated stats for this call to
    // users/{uid}/usage/{YYYY-MM}. Fire-and-forget-safe: any failure here
    // (Firestore down, admin not configured, etc.) is logged and swallowed
    // — it must never break the actual chat response the user is waiting on.
    async function logUsage() {
      if (!uid) return; // not signed in — nothing to attribute this to
      try {
        const month = new Date().toISOString().slice(0, 7); // "2026-09"
        const ref = getAdminDb().collection('users').doc(uid).collection('usage').doc(month);
        const update = {
          messages: increment(1),
          groqRequests: increment(usageStats.groqRequests),
          inputTokens: increment(usageStats.inputTokens),
          outputTokens: increment(usageStats.outputTokens),
          totalTokens: increment(usageStats.totalTokens),
          lastUpdated: new Date().toISOString()
        };
        if (research) update.researchRequests = increment(1);
        for (const [model, count] of Object.entries(usageStats.modelCounts)) {
          update[`modelCounts.${model}`] = increment(count);
        }
        await ref.set(update, { merge: true });
      } catch (err) {
        console.error('Usage logging failed (non-fatal, response already served):', err.message);
      }
    }

    const systemMessages = [
      {
        role: "system",
        content: `
You are Zyntra AI, a premium AI assistant.
Write exactly like ChatGPT.
Rules:
- Answer naturally and professionally.
- Do NOT make every sentence a separate paragraph.
- Keep related sentences together.
- Start a new paragraph only when changing topics.
- Use bullet points only when listing items.
- Keep answers clean and easy to read.
- Explain clearly without adding unnecessary blank lines.
- Use headings only when they improve readability.
- Sound friendly, intelligent, and helpful.
- Use relevant emojis naturally where they add warmth or clarity (e.g. in greetings, lists, or highlighting key points) — but don't overdo it, a few per reply is enough.
- When you write any code, always wrap it in a triple-backtick fenced code block with the correct language tag right after the backticks (e.g. \`\`\`html, \`\`\`css, \`\`\`javascript, \`\`\`python) — never write code inline without a fenced block, and never leave off the language tag.
- Pay attention to the user's tone and mood, not just their literal words. If they sound frustrated, excited, confused, or upset, acknowledge that briefly and warmly before diving into the answer — like a thoughtful friend would, not a robotic assistant.
- Match their energy: be more playful when they're being casual or joking, more focused and reassuring when they're stressed or stuck on a problem, and genuinely celebratory when they share good news or a win.
- You understand and can respond fluently in any language the user writes in — Hindi, Spanish, Arabic, French, Chinese, and every other language. Always reply in the same language the user used, unless they ask you to switch.
- If the user sends an image, look at it carefully and help solve, explain, or answer whatever they're asking about it.
- You have real tools available (web_search, get_current_datetime, remember_fact, and possibly others). Use web_search and get_current_datetime whenever they'd make your answer more accurate or current — don't guess at facts, prices, dates, or anything time-sensitive when you can look it up instead. Use remember_fact quietly, in the background, whenever the user shares something durable worth remembering for future chats (their name, job, project, preferences) — never announce that you're remembering something, just call the tool and continue the conversation naturally.
`
      }
    ];

    if (!hasImage && forceSearch) {
      systemMessages.push({
        role: "system",
        content: "The user has explicitly turned on web search for this message. Call the web_search tool before answering, even if you think you already know the answer — prefer freshly retrieved facts over memory. Weave the findings into a natural answer."
      });
    }

    if (!hasImage && research) {
      systemMessages.push({
        role: "system",
        content: "The user has turned on Research mode for this message — they want a thorough, well-sourced answer, not a quick one. Use web_search multiple times from different angles (e.g. different phrasings, different aspects of the question, follow-up searches based on what you find) before answering — aim for at least 2-3 searches covering different sources unless the question is genuinely simple. Cross-check facts across sources where possible, note if sources disagree, and write a more complete, structured answer than you normally would. Still keep it readable — use headings or bullet points if that helps organize a longer answer."
      });
    }

    if (googleClient) {
      systemMessages.push({
        role: "system",
        content: "The user has connected their Google account. You may use send_email, create_calendar_event, list_calendar_events, update_calendar_event, and cancel_calendar_event when they clearly ask you to send an email or manage their schedule — check list_calendar_events before creating something if there's any chance of a conflict, and always state the exact recipient/subject/body or event details back to them and get confirmation first (unless they already gave every detail explicitly), since these are real actions that can't be undone."
      });
    } else {
      systemMessages.push({
        role: "system",
        content: "The user has NOT connected a Google account, so you do NOT have access to send_email or any calendar tools right now. If the user asks you to send an email, check/create/update/cancel a calendar event, or do anything else that needs Gmail or Google Calendar, do not pretend to do it and do not just say you can't help — clearly tell them their Google account isn't connected yet and that they can connect it from Account Settings \u2192 Connections, then ask them to try again after connecting."
      });
    }

    const fullMessages = [...systemMessages, ...messages];

    // callGroq NEVER throws — every failure path (network error, timeout,
    // bad JSON, non-2xx response) resolves to { ok:false, status, data }
    // so the caller can always safely decide whether to fall back.
    async function callGroq(model, body, timeBudget) {
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), timeBudget);

      let response;
      try {
        response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ model, ...body }),
          signal: controller.signal
        });
      } catch (fetchErr) {
        clearTimeout(abortTimer);
        if (fetchErr && fetchErr.name === 'AbortError') {
          return { ok: false, status: 504, data: { error: { message: "That took too long to respond. Please try again, or ask a more specific question." } } };
        }
        console.error('Groq fetch error:', fetchErr);
        return { ok: false, status: 502, data: { error: { message: "Couldn't reach the AI service. Please try again." } } };
      }
      clearTimeout(abortTimer);

      let data;
      try {
        data = await response.json();
      } catch (parseErr) {
        console.error('Groq response was not valid JSON:', parseErr);
        return { ok: false, status: 502, data: { error: { message: "Received an unexpected response from the AI service. Please try again." } } };
      }

      // Groq's rate-limit errors include the exact wait time (e.g. "Please
      // try again in 7.2s") — parse and honor it with one automatic retry
      // instead of failing the user's message outright over a brief spike.
      if (!response.ok && response.status === 429) {
        const waitMs = parseRetryAfterMs(data?.error?.message);
        if (waitMs !== null && waitMs < timeBudget - 2000) {
          console.error(`Rate limited on ${model}, retrying in ${waitMs}ms`);
          await sleep(waitMs);
          return callGroq(model, body, Math.max(timeBudget - waitMs, 6000));
        }
      }

      if (response.ok) trackUsage(model, data?.usage);
      return { ok: response.ok, status: response.status, data };
    }

    // Same job as callGroq, but reads Groq's response as a live token
    // stream and calls onDelta(text) as each piece of the reply arrives —
    // used so the user sees words appear in real time instead of waiting
    // for the whole answer. Returns the SAME shape as callGroq once the
    // stream ends (data.choices[0].message), so runAgentLoop below can
    // use either function interchangeably.
    async function callGroqStreaming(model, body, timeBudget, onDelta) {
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), timeBudget);

      let response;
      try {
        response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
            'Content-Type': 'application/json'
          },
          // stream_options.include_usage makes Groq send one extra final
          // chunk (empty choices, populated `usage`) once streaming ends —
          // that's how we get real token counts for streamed responses too.
          body: JSON.stringify({ model, ...body, stream: true, stream_options: { include_usage: true } }),
          signal: controller.signal
        });
      } catch (fetchErr) {
        clearTimeout(abortTimer);
        if (fetchErr && fetchErr.name === 'AbortError') {
          return { ok: false, status: 504, data: { error: { message: "That took too long to respond. Please try again." } } };
        }
        console.error('Groq stream fetch error:', fetchErr);
        return { ok: false, status: 502, data: { error: { message: "Couldn't reach the AI service. Please try again." } } };
      }

      if (!response.ok) {
        clearTimeout(abortTimer);
        // Errors (bad request, rate limit, etc.) come back as a normal
        // JSON body even when stream:true was requested, since the
        // failure happens before any streaming starts.
        let data;
        try {
          data = await response.json();
        } catch {
          data = { error: { message: "The AI service returned an error." } };
        }
        return { ok: false, status: response.status, data };
      }

      let accumulatedContent = "";
      const toolCallsByIndex = {};
      let finishReason = null;
      let streamUsage = null;

      try {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let boundary;
          while ((boundary = buffer.indexOf("\n\n")) !== -1) {
            const rawEvent = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const line = rawEvent.trim();
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") continue;

            let parsed;
            try {
              parsed = JSON.parse(payload);
            } catch {
              continue; // skip a malformed chunk rather than aborting the whole stream
            }

            // The final usage chunk (when stream_options.include_usage is
            // set) has an empty/absent `choices` array, so this check must
            // happen before the `if (!choice) continue` below or it's missed.
            if (parsed.usage) streamUsage = parsed.usage;

            const choice = parsed?.choices?.[0];
            if (!choice) continue;
            if (choice.finish_reason) finishReason = choice.finish_reason;

            const delta = choice.delta || {};
            if (delta.content) {
              accumulatedContent += delta.content;
              if (onDelta) onDelta(delta.content);
            }
            if (Array.isArray(delta.tool_calls)) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!toolCallsByIndex[idx]) {
                  toolCallsByIndex[idx] = { id: tc.id || "", type: "function", function: { name: "", arguments: "" } };
                }
                if (tc.id) toolCallsByIndex[idx].id = tc.id;
                if (tc.function?.name) toolCallsByIndex[idx].function.name += tc.function.name;
                if (tc.function?.arguments) toolCallsByIndex[idx].function.arguments += tc.function.arguments;
              }
            }
          }
        }
      } catch (streamErr) {
        console.error('Groq stream read error:', streamErr);
        if (!accumulatedContent) {
          clearTimeout(abortTimer);
          return { ok: false, status: 502, data: { error: { message: "The connection to the AI service was interrupted. Please try again." } } };
        }
        // Partial content already arrived and was shown to the user —
        // treat what we have as the (possibly cut short) final answer
        // rather than discarding it.
      }

      clearTimeout(abortTimer);
      trackUsage(model, streamUsage);
      const toolCalls = Object.values(toolCallsByIndex);
      const message = {
        role: "assistant",
        content: accumulatedContent || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {})
      };

      return { ok: true, status: 200, data: { choices: [{ message, finish_reason: finishReason }] } };
    }

    // ---- Agent loop ----
    // Give the model the tools and let it decide whether to call one. If
    // it calls a tool, run it server-side, feed the result back as a
    // `tool` message, and ask again — up to a few rounds so it can chain
    // tool calls (e.g. search, then search again with a better query).
    // When onDelta is provided, every round streams live instead of
    // waiting for the full response — safe to do for every round because
    // tool-calling rounds essentially never carry visible content
    // alongside a tool_call, so nothing gets shown until the real answer.
    // Retryable = worth trying the next model in the chain. 429 covers
    // both per-minute rate limits and the daily request cap; 5xx and our
    // own synthetic 504 (request timeout) mean Groq/the network had a bad
    // moment, not that the request itself was invalid. A 400 (e.g. bad
    // request shape) is NOT retryable — trying another model won't fix it,
    // it'll just waste time before falling through to the real error.
    function isRetryableFailure(result) {
      return result.status === 429 || result.status >= 500;
    }

    // Tries each model in modelChain in order, moving to the next one only
    // on a retryable failure (rate limit / daily quota / upstream error).
    // Each Groq model has its OWN separate rate-limit bucket, so this is
    // what actually multiplies daily capacity — not just a safety net.
    // Returns the same { ok, status, data } shape as callGroq/callGroqStreaming,
    // plus `modelUsed` so callers/logs know which model actually answered.
    async function callGroqWithFallback(modelChain, body, timeBudget, streaming, onDelta) {
      let lastResult = null;
      for (const model of modelChain) {
        const result = streaming
          ? await callGroqStreaming(model, body, timeBudget, onDelta)
          : await callGroq(model, body, timeBudget);
        result.modelUsed = model;
        lastResult = result;
        if (result.ok) return result;
        if (!isRetryableFailure(result)) return result;
        console.error(`Model ${model} failed (${result.status}), trying next in chain...`);
      }
      return lastResult;
    }

    async function runAgentLoop(modelChain, includeTools, onDelta) {
      let conversation = [...fullMessages];
      const maxRounds = research ? 8 : 4; // research mode allows several more search rounds to chain
      let overallBudget = 45000; // leaves headroom under the 60s function ceiling
      let lastResult = null;

      for (let round = 0; round < maxRounds; round++) {
        const roundStart = Date.now();
        const body = {
          temperature: 0.7,
          max_tokens: website ? 4096 : (research ? 3072 : 2048), // a full single-file website needs far more room than a normal reply
          messages: conversation
        };
        if (includeTools) {
          const availableTools = TOOLS.filter(t => !t.requiresGoogle || !!googleClient);
          body.tools = availableTools.map(({ function: fn }) => ({ type: "function", function: fn }));
          body.tool_choice = (round === 0 && (forceSearch || research) && !hasImage) ? { type: "function", function: { name: "web_search" } } : "auto";
        }
        if (hasImage) {
          body.reasoning_format = "hidden"; // qwen shows raw <think> reasoning unless hidden
        }

        const result = await callGroqWithFallback(modelChain, body, Math.max(overallBudget, 8000), !!onDelta, onDelta);
        overallBudget -= (Date.now() - roundStart);
        lastResult = result;

        if (!result.ok) return result;

        const message = result.data?.choices?.[0]?.message;
        const toolCalls = message?.tool_calls;

        if (!toolCalls || toolCalls.length === 0) {
          result.finalMessages = conversation;
          return result;
        }

        // Model wants to call one or more tools — run them, append the
        // results, and loop back so it can use them in its next reply.
        conversation = [...conversation, message];
        for (const call of toolCalls) {
          const toolResult = await executeTool(call.function.name, call.function.arguments, { googleClient });
          conversation.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(toolResult)
          });
        }

        if (overallBudget < 8000) {
          // Running low on time — stop looping and let the fallback
          // below (or the last result) handle it rather than risk a
          // hard timeout with no response at all.
          break;
        }
      }

      if (lastResult) lastResult.finalMessages = conversation;
      return lastResult;
    }

    // Text chat tries gpt-oss-20b first, then falls back to gpt-oss-120b,
    // then qwen3.8-27b — each on Groq's own separate per-model daily quota,
    // so this is real extra capacity, not just redundancy. qwen3.6-27b is
    // reserved for vision only (it doesn't support tool calling on Groq),
    // so it's kept out of the text fallback chain to avoid competing with
    // image traffic for its quota.
    // Research mode gets first crack at groq/compound — Groq's own
    // agentic model with server-managed, built-in web search (no Tavily
    // round-trip or manual tool loop needed). It has its own separate,
    // much smaller daily quota (250/day) than the regular chat models, so
    // it's reserved for Research mode specifically instead of being used
    // on every normal message — that would burn through it in minutes.
    // Falls back to the existing gpt-oss + Tavily multi-round research
    // flow below on any failure (quota exhausted, rate limited, etc.), so
    // Research mode never breaks — it just becomes the fallback path.
    let compoundAnswer = null;
    if (research && !hasImage) {
      const compoundResult = await callGroq('groq/compound', {
        temperature: 0.6,
        max_tokens: 3072,
        messages: fullMessages
      }, 40000);
      if (compoundResult.ok) {
        compoundAnswer = compoundResult.data?.choices?.[0]?.message?.content || null;
      } else {
        console.error('groq/compound unavailable for research mode, falling back to gpt-oss + Tavily:', compoundResult.status, compoundResult.data?.error?.message);
      }
    }

    const primaryModelChain = hasImage
      ? ['qwen/qwen3.6-27b']
      : ['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b'];
    // Images stream too now — the frontend always sends stream:true and
    // only knows how to read an SSE response, so silently falling back to
    // plain JSON here for image messages left it waiting for chunks that
    // would never arrive (frontend keeps parsing for "data:" lines that
    // don't exist in a JSON body), producing "Sorry, I didn't get a
    // response" every time an image was attached.
    const wantsStream = !!req.body?.stream;

    if (wantsStream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no' // disables proxy buffering so chunks arrive immediately, not batched
      });

      const sendEvent = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
      const onDelta = (text) => sendEvent({ type: "content", text });

      // groq/compound already answered above — send it as a single chunk
      // (it won't animate token-by-token like a real stream, but Research
      // mode answers already take a while either way) and skip the whole
      // gpt-oss agent loop entirely for this message.
      if (compoundAnswer) {
        onDelta(compoundAnswer);
        await logUsage();
        sendEvent({ type: "done", sources: [], memoryWrites: [] });
        return res.end();
      }

      let streamResult = await runAgentLoop(primaryModelChain, !hasImage, onDelta);

      if (!streamResult.ok) {
        console.error('Streaming agent loop failed, retrying without tools:', streamResult.status, streamResult.data?.error?.message);
        streamResult = await callGroqWithFallback(primaryModelChain, {
          temperature: 0.7,
          max_tokens: website ? 4096 : (research ? 3072 : 2048),
          messages: fullMessages
        }, 15000, true, onDelta);
      }

      // If it's STILL failing and the error looks like it's about the
      // requested response length (e.g. this Groq account's tier caps
      // max_tokens lower than what was requested), retry once more with
      // a small, conservative budget rather than giving up — a shorter
      // reply the user can ask to continue beats a hard failure.
      if (!streamResult.ok && /max.?tokens|too large|reduce/i.test(streamResult.data?.error?.message || '')) {
        console.error('Retrying with a conservative token budget after a likely length-related rejection.');
        streamResult = await callGroqWithFallback(primaryModelChain, {
          temperature: 0.7,
          max_tokens: 1536,
          messages: fullMessages
        }, 15000, true, onDelta);
      }

      if (!streamResult.ok) {
        sendEvent({ type: "error", message: userFacingError(streamResult) });
        return res.end();
      }

      const zyntra_sources = extractSourcesFromToolMessages(streamResult.finalMessages || [], research ? 12 : 6);
      const zyntra_memory_writes = extractMemoryWrites(streamResult.finalMessages || []);
      await logUsage();
      sendEvent({ type: "done", sources: zyntra_sources, memoryWrites: zyntra_memory_writes });
      return res.end();
    }

    // Non-streaming path (lite/image/no-stream callers) — same
    // compound-first, gpt-oss-fallback logic as the streaming branch above.
    if (compoundAnswer) {
      await logUsage();
      return res.status(200).json({
        choices: [{ message: { role: 'assistant', content: compoundAnswer }, finish_reason: 'stop' }],
        zyntra_sources: [],
        zyntra_memory_writes: []
      });
    }

    let result = await runAgentLoop(primaryModelChain, !hasImage);

    // If the tool-enabled call failed outright (e.g. this Groq account
    // tier doesn't support tool calling on this model), retry once with
    // tools turned off so the user still gets a plain answer instead of
    // an error.
    if (!result.ok && !hasImage) {
      console.error('Agent loop failed, retrying without tools:', result.status, result.data?.error?.message);
      result = await callGroqWithFallback(primaryModelChain, {
        temperature: 0.7,
        max_tokens: 2048,
        messages: fullMessages
      }, 15000, false);
    }

    if (!result.ok) {
      return res.status(result.status || 500).json({ error: userFacingError(result) });
    }

    const zyntra_sources = extractSourcesFromToolMessages(result.finalMessages || [], research ? 12 : 6);
    const zyntra_memory_writes = extractMemoryWrites(result.finalMessages || []);

    await logUsage();
    return res.status(200).json({ ...result.data, zyntra_sources, zyntra_memory_writes });
  } catch (error) {
    console.error('Unhandled /api/chat error:', error);
    if (res.headersSent) {
      // Streaming had already started — can't send a fresh status/JSON
      // response at this point, so end the stream with an error event.
      try {
        res.write(`data: ${JSON.stringify({ type: "error", message: "Something went wrong on our end. Please try again." })}\n\n`);
      } catch {}
      return res.end();
    }
    return res.status(500).json({ error: error?.message || 'Something went wrong on our end. Please try again.' });
  }
}

async function callGroqLite(messages) {
  async function attempt(timeBudget, model) {
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), timeBudget);

    let response;
    try {
      response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 12,
          messages
        }),
        signal: controller.signal
      });
    } catch (fetchErr) {
      clearTimeout(abortTimer);
      if (fetchErr && fetchErr.name === 'AbortError') {
        return { ok: false, status: 504, data: { error: { message: "That took too long. Please try again." } } };
      }
      console.error('Groq lite fetch error:', fetchErr);
      return { ok: false, status: 502, data: { error: { message: "Couldn't reach the AI service. Please try again." } } };
    }
    clearTimeout(abortTimer);

    let data;
    try {
      data = await response.json();
    } catch (parseErr) {
      console.error('Groq lite response was not valid JSON:', parseErr);
      return { ok: false, status: 502, data: { error: { message: "Received an unexpected response. Please try again." } } };
    }

    return { ok: response.ok, status: response.status, data };
  }

  const budgetMs = 12000;
  const primaryModel = 'openai/gpt-oss-20b';
  let result = await attempt(budgetMs, primaryModel);

  if (!result.ok && result.status === 429) {
    const waitMs = parseRetryAfterMs(result.data?.error?.message);
    if (waitMs !== null && waitMs < budgetMs - 2000) {
      console.error(`Rate limited on lite call, retrying in ${waitMs}ms`);
      await sleep(waitMs);
      result = await attempt(Math.max(budgetMs - waitMs, 4000), primaryModel);
    }
  }

  // Still failing (rate limit with no usable Retry-After, daily quota
  // exhausted, or an upstream error) — try once on a model with its own
  // separate quota rather than surfacing an error for what's usually just
  // a quick internal classification call.
  if (!result.ok && (result.status === 429 || result.status >= 500)) {
    console.error('Lite call still failing, falling back to gpt-oss-120b');
    result = await attempt(6000, 'openai/gpt-oss-120b');
  }

  return result;
}

function parseRetryAfterMs(message) {
  const match = /try again in\s*([\d.]+)\s*s/i.exec(message || "");
  if (!match) return null;
  const sec = parseFloat(match[1]);
  if (isNaN(sec)) return null;
  return Math.min(Math.ceil(sec * 1000) + 300, 12000);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Groq's raw error text (org IDs, token quotas, billing links, etc.) is an
// internal implementation detail — never show it to the end user. This maps
// known cases to something clean while the real message still gets logged.
function trimMessages(messages, maxTurns = 16) {
  // Keep any leading system message(s) — e.g. the custom-instructions note
  // — untouched, then cap everything after that to the most recent turns.
  let i = 0;
  while (i < messages.length && messages[i].role === 'system') {
    i++;
  }
  const leadingSystem = messages.slice(0, i);
  const conversation = messages.slice(i);
  const trimmedConversation = conversation.length > maxTurns
    ? conversation.slice(-maxTurns)
    : conversation;

  return [...leadingSystem, ...trimmedConversation];
}

function userFacingError(result) {
  const rawMessage = result.data?.error?.message || '';

  if (/too large|reduce your message size/i.test(rawMessage)) {
    console.error('Groq payload-too-large error:', result.status, rawMessage);
    return "That message (or this conversation) is too long for me to process in one go. Try shortening it, pasting less at once, or starting a new chat.";
  }

  if (result.status === 429 || /rate limit|tokens per minute/i.test(rawMessage)) {
    console.error('Rate limited:', result.status, rawMessage);
    return "Zyntra AI is handling a lot of requests right now — please wait a few seconds and try again.";
  }

  return rawMessage || 'The AI service returned an error. Please try again.';
}
