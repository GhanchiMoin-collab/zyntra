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
  }

  // Next tools to add here, following the same { function, execute } shape:
  // - send_email (Gmail API, needs stored OAuth token per user)
  // - create_calendar_event (Calendar API, same OAuth token)
  // Both need the user to have connected their Google account first
  // (OAuth + refresh token stored server-side, e.g. in Firestore keyed by
  // their Firebase uid) — that connection flow isn't built yet.
];

const TOOLS_BY_NAME = Object.fromEntries(TOOLS.map(t => [t.function.name, t]));

async function executeTool(name, argsJson) {
  const tool = TOOLS_BY_NAME[name];
  if (!tool) return { error: `Unknown tool: ${name}` };
  let args = {};
  try {
    args = argsJson ? JSON.parse(argsJson) : {};
  } catch {
    return { error: "Invalid arguments JSON from model." };
  }
  try {
    return await tool.execute(args);
  } catch (err) {
    console.error(`Tool ${name} threw:`, err);
    return { error: `Tool ${name} failed: ${err.message}` };
  }
}

// Pulls web_search results out of the running message list so the
// frontend can show the user what was actually searched, same shape as
// before (zyntra_sources: [{ title, url }]).
function extractSourcesFromToolMessages(messages) {
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
  }).slice(0, 6);
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
    const { messages: rawMessages, forceSearch, lite } = req.body || {};

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

      return { ok: response.ok, status: response.status, data };
    }

    // ---- Agent loop ----
    // Give the model the tools and let it decide whether to call one. If
    // it calls a tool, run it server-side, feed the result back as a
    // `tool` message, and ask again — up to a few rounds so it can chain
    // tool calls (e.g. search, then search again with a better query).
    async function runAgentLoop(model, includeTools) {
      let conversation = [...fullMessages];
      const maxRounds = 4;
      let overallBudget = 45000; // leaves headroom under the 60s function ceiling
      let lastResult = null;

      for (let round = 0; round < maxRounds; round++) {
        const roundStart = Date.now();
        const body = {
          temperature: 0.7,
          max_tokens: 2048,
          messages: conversation
        };
        if (includeTools) {
          body.tools = TOOLS.map(({ function: fn }) => ({ type: "function", function: fn }));
          body.tool_choice = (round === 0 && forceSearch && !hasImage) ? { type: "function", function: { name: "web_search" } } : "auto";
        }
        if (hasImage) {
          body.reasoning_format = "hidden"; // qwen shows raw <think> reasoning unless hidden
        }

        const result = await callGroq(model, body, Math.max(overallBudget, 8000));
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
          const toolResult = await executeTool(call.function.name, call.function.arguments);
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

    const primaryModel = hasImage ? 'qwen/qwen3.6-27b' : 'openai/gpt-oss-20b';
    let result = await runAgentLoop(primaryModel, !hasImage);

    // If the tool-enabled call failed outright (e.g. this Groq account
    // tier doesn't support tool calling on this model), retry once with
    // tools turned off so the user still gets a plain answer instead of
    // an error.
    if (!result.ok && !hasImage) {
      console.error('Agent loop failed, retrying without tools:', result.status, result.data?.error?.message);
      result = await callGroq(primaryModel, {
        temperature: 0.7,
        max_tokens: 2048,
        messages: fullMessages
      }, 15000);
    }

    if (!result.ok) {
      return res.status(result.status || 500).json({ error: userFacingError(result) });
    }

    const zyntra_sources = extractSourcesFromToolMessages(result.finalMessages || []);
    const zyntra_memory_writes = extractMemoryWrites(result.finalMessages || []);

    return res.status(200).json({ ...result.data, zyntra_sources, zyntra_memory_writes });
  } catch (error) {
    console.error('Unhandled /api/chat error:', error);
    return res.status(500).json({ error: error?.message || 'Something went wrong on our end. Please try again.' });
  }
}

async function callGroqLite(messages) {
  async function attempt(timeBudget) {
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
          model: 'openai/gpt-oss-20b',
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
  let result = await attempt(budgetMs);

  if (!result.ok && result.status === 429) {
    const waitMs = parseRetryAfterMs(result.data?.error?.message);
    if (waitMs !== null && waitMs < budgetMs - 2000) {
      console.error(`Rate limited on lite call, retrying in ${waitMs}ms`);
      await sleep(waitMs);
      result = await attempt(Math.max(budgetMs - waitMs, 4000));
    }
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
