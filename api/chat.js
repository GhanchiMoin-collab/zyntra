// Vercel's default serverless timeout (10s on Hobby) isn't enough for a
// real web search — Groq has to search, read pages, then write the answer,
// which can take 15-40+ seconds. This raises the ceiling for this function.
// (Also mirrored in vercel.json, which is the more reliable place to set
// this for classic /api serverless functions.)
export const config = {
  maxDuration: 60
};

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
    // fast, reliable plain-text model directly — no compound, no tools, no
    // search — so they're fast and don't add a second point of failure to
    // whatever heavier call happens next.
    if (lite) {
      const result = await callGroqLite(messages);
      if (!result.ok) {
        return res.status(result.status || 500).json({ error: userFacingError(result) });
      }
      return res.status(200).json(result.data);
    }

    // If any message contains an image, we need a vision-capable model.
    const hasImage = messages.some(
      m => Array.isArray(m.content) && m.content.some(part => part.type === 'image_url')
    );

    // llama-3.1-8b-instant was deprecated by Groq on June 17, 2026.
    // openai/gpt-oss-20b is the recommended text-only replacement — it's
    // also noticeably faster than compound, since compound spends time on
    // every message reasoning about whether to use a tool even when it
    // won't. So it's now the DEFAULT for ordinary chat, and compound is
    // only used when a message actually looks like it needs current info,
    // or the user explicitly forced a search with the 🌐 button.
    // qwen/qwen3.6-27b is Groq's current multimodal (text + image) model.
    // groq/compound-mini does a single tool call — faster than full
    // compound and less likely to hit the function timeout, so it's used
    // for explicit forced searches specifically.
    const wantsForcedSearch = !!forceSearch && !hasImage;
    const needsCurrentInfo = !hasImage && !wantsForcedSearch && looksLikeNeedsCurrentInfo(messages);
    const primaryModel = hasImage
      ? 'qwen/qwen3.6-27b'
      : wantsForcedSearch
        ? 'groq/compound-mini'
        : needsCurrentInfo
          ? 'groq/compound'
          : 'openai/gpt-oss-20b';

    // callGroq NEVER throws — every failure path (network error, timeout,
    // bad JSON, non-2xx response) resolves to { ok:false, status, data }
    // so the caller can always safely decide whether to fall back.
    async function callGroq(model, budgetMs){
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
`
        }
      ];

      if(wantsForcedSearch){
        systemMessages.push({
          role: "system",
          content: "The user has explicitly turned on web search for this message. Use the web_search tool (and visit_website if useful) to find current, accurate information before answering, even if you think you already know the answer — prefer freshly retrieved facts over memory. Weave the findings into a natural answer."
        });
      }

      const body = {
        model,
        temperature: 0.7,
        max_tokens: 2048,
        messages: [
          ...systemMessages,
          ...messages
        ]
      };

      // qwen3.6-27b (the vision model) shows its raw <think> reasoning unless told to hide it.
      if(hasImage){
        body.reasoning_format = "hidden";
      }

      // Restrict compound to search-related tools when the user explicitly asked for it,
      // so it prioritizes searching over, say, running code.
      if(wantsForcedSearch && model.startsWith('groq/compound')){
        body.compound_custom = {
          tools: { enabled_tools: ["web_search", "visit_website"] }
        };
      }

      // The actual network call + JSON parsing, isolated so it can be
      // retried once below without duplicating this logic.
      async function attempt(timeBudget){
        const controller = new AbortController();
        const abortTimer = setTimeout(() => controller.abort(), timeBudget);

        let response;
        try{
          response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(body),
            signal: controller.signal
          });
        }catch(fetchErr){
          clearTimeout(abortTimer);
          if(fetchErr && fetchErr.name === 'AbortError'){
            return { ok: false, status: 504, data: { error: { message: "The web search took too long to respond. Please try again, or ask a more specific question." } } };
          }
          console.error('Groq fetch error:', fetchErr);
          return { ok: false, status: 502, data: { error: { message: "Couldn't reach the AI service. Please try again." } } };
        }
        clearTimeout(abortTimer);

        let data;
        try{
          data = await response.json();
        }catch(parseErr){
          console.error('Groq response was not valid JSON:', parseErr);
          return { ok: false, status: 502, data: { error: { message: "Received an unexpected response from the AI service. Please try again." } } };
        }

        return { ok: response.ok, status: response.status, data };
      }

      let result = await attempt(budgetMs);

      // Groq's rate-limit errors include the exact wait time (e.g. "Please
      // try again in 7.2s") — parse and honor it with one automatic retry
      // instead of failing the user's message outright over a brief spike.
      if(!result.ok && result.status === 429){
        const waitMs = parseRetryAfterMs(result.data?.error?.message);
        if(waitMs !== null && waitMs < budgetMs - 2000){
          console.error(`Rate limited on ${model}, retrying in ${waitMs}ms`);
          await sleep(waitMs);
          result = await attempt(Math.max(budgetMs - waitMs, 6000));
        }
      }

      return result;
    }

    // Budget the two attempts so their combined worst case stays safely
    // under Vercel's 60s function ceiling: up to 38s for the primary model,
    // leaving real room for a fast fallback call if needed.
    let result = await callGroq(primaryModel, 38000);

    // If the primary model fails for any reason (tier restrictions, outage,
    // a genuine timeout, etc.), fall back to the standard reliable text
    // model instead of breaking the whole feature.
    if(!result.ok && primaryModel.startsWith('groq/compound')){
      console.error('Primary model failed, falling back:', primaryModel, result.status, result.data?.error?.message);
      result = await callGroq('openai/gpt-oss-20b', 15000);
    }

    if (!result.ok) {
      return res.status(result.status || 500).json({ error: userFacingError(result) });
    }

    // Pull real search result URLs out of Groq's executed_tools, if any were run,
    // so the frontend can show the user what was actually searched.
    const zyntra_sources = extractSources(result.data?.choices?.[0]?.message);

    return res.status(200).json({ ...result.data, zyntra_sources });
  } catch (error) {
    console.error('Unhandled /api/chat error:', error);
    return res.status(500).json({ error: error?.message || 'Something went wrong on our end. Please try again.' });
  }
}

async function callGroqLite(messages){
  async function attempt(timeBudget){
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), timeBudget);

    let response;
    try{
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
    }catch(fetchErr){
      clearTimeout(abortTimer);
      if(fetchErr && fetchErr.name === 'AbortError'){
        return { ok: false, status: 504, data: { error: { message: "That took too long. Please try again." } } };
      }
      console.error('Groq lite fetch error:', fetchErr);
      return { ok: false, status: 502, data: { error: { message: "Couldn't reach the AI service. Please try again." } } };
    }
    clearTimeout(abortTimer);

    let data;
    try{
      data = await response.json();
    }catch(parseErr){
      console.error('Groq lite response was not valid JSON:', parseErr);
      return { ok: false, status: 502, data: { error: { message: "Received an unexpected response. Please try again." } } };
    }

    return { ok: response.ok, status: response.status, data };
  }

  const budgetMs = 12000;
  let result = await attempt(budgetMs);

  if(!result.ok && result.status === 429){
    const waitMs = parseRetryAfterMs(result.data?.error?.message);
    if(waitMs !== null && waitMs < budgetMs - 2000){
      console.error(`Rate limited on lite call, retrying in ${waitMs}ms`);
      await sleep(waitMs);
      result = await attempt(Math.max(budgetMs - waitMs, 4000));
    }
  }

  return result;
}

function parseRetryAfterMs(message){
  const match = /try again in\s*([\d.]+)\s*s/i.exec(message || "");
  if(!match) return null;
  const sec = parseFloat(match[1]);
  if(isNaN(sec)) return null;
  return Math.min(Math.ceil(sec * 1000) + 300, 12000);
}

function sleep(ms){
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Groq's raw error text (org IDs, token quotas, billing links, etc.) is an
// internal implementation detail — never show it to the end user. This maps
// known cases to something clean while the real message still gets logged.
function trimMessages(messages, maxTurns = 16){
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

function userFacingError(result){
  const rawMessage = result.data?.error?.message || '';

  if(/too large|reduce your message size/i.test(rawMessage)){
    console.error('Groq payload-too-large error:', result.status, rawMessage);
    return "That message (or this conversation) is too long for me to process in one go. Try shortening it, pasting less at once, or starting a new chat.";
  }

  if(result.status === 429 || /rate limit|tokens per minute/i.test(rawMessage)){
    console.error('Rate limited:', result.status, rawMessage);
    return "Zyntra AI is handling a lot of requests right now — please wait a few seconds and try again.";
  }

  return rawMessage || 'The AI service returned an error. Please try again.';
}

function looksLikeNeedsCurrentInfo(messages){
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUser) return false;

  let text = '';
  if (typeof lastUser.content === 'string') {
    text = lastUser.content;
  } else if (Array.isArray(lastUser.content)) {
    text = lastUser.content.map(part => part.text || '').join(' ');
  }
  text = text.toLowerCase();

  return /\b(latest|current(ly)?|today|right now|this week|this month|this year|recent(ly)?|breaking|news|weather|forecast|stock price|share price|exchange rate|score|who won|who is the (current|new)|election result|live|update[sd]?|price of|cost of|release date|upcoming|schedule|deadline|202[4-9]|203\d)\b/.test(text);
}

function extractSources(message){
  if (!message || !Array.isArray(message.executed_tools)) return [];

  const sources = [];
  message.executed_tools.forEach(tool => {
    const results = tool.search_results || tool.results || [];
    if (Array.isArray(results)) {
      results.forEach(r => {
        if (r && r.url) {
          sources.push({ title: r.title || r.url, url: r.url });
        }
      });
    }
    // visit_website tool exposes a single visited URL rather than a results array
    if (tool.url) {
      sources.push({ title: tool.title || tool.url, url: tool.url });
    }
  });

  const seen = new Set();
  return sources.filter(s => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  }).slice(0, 6);
}
