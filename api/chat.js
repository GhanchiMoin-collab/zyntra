// Vercel's default serverless timeout (10s on Hobby) isn't enough for a
// real web search — Groq has to search, read pages, then write the answer,
// which can take 15-40+ seconds. This raises the ceiling for this function.
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
    const { messages, forceSearch } = req.body;

    // If any message contains an image, we need a vision-capable model.
    const hasImage = messages.some(
      m => Array.isArray(m.content) && m.content.some(part => part.type === 'image_url')
    );

    // llama-3.1-8b-instant was deprecated by Groq on June 17, 2026.
    // openai/gpt-oss-20b is the recommended text-only replacement.
    // qwen/qwen3.6-27b is Groq's current multimodal (text + image) model.
    // groq/compound automatically searches the web when a question needs current info.
    // groq/compound-mini does the same but with a single tool call — much
    // faster and less likely to run into the function timeout, so we use it
    // when the user explicitly forced a search via the 🌐 button.
    // Only meaningful for the compound (text) model — vision requests can't search.
    const wantsForcedSearch = !!forceSearch && !hasImage;
    const model = hasImage ? 'qwen/qwen3.6-27b' : (wantsForcedSearch ? 'groq/compound-mini' : 'groq/compound');

    async function callGroq(model){
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

      // Guard against the whole request hanging past Vercel's function
      // timeout — abort a bit early so we can return a clean error instead
      // of the platform killing the function with a raw 504.
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), 55000);

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
        if(fetchErr.name === 'AbortError'){
          return { ok: false, status: 504, data: { error: { message: "The web search took too long to respond. Please try again, or ask a more specific question." } } };
        }
        throw fetchErr;
      }
      clearTimeout(abortTimer);
      const data = await response.json();
      return { ok: response.ok, status: response.status, data };
    }

    let result = await callGroq(model);

    // If the compound model fails for any reason (tier restrictions, outage, etc.),
    // fall back to the standard reliable text model instead of breaking the whole feature.
    // Skip the retry on a timeout (status 504) — a second attempt would likely just
    // time out again, so we'd rather return the friendly message immediately.
    if(!result.ok && model.startsWith('groq/compound') && result.status !== 504){
      result = await callGroq('openai/gpt-oss-20b');
    }

    if (!result.ok) {
      return res.status(result.status).json({ error: result.data.error?.message || 'Groq API error' });
    }

    // Pull real search result URLs out of Groq's executed_tools, if any were run,
    // so the frontend can show the user what was actually searched.
    const zyntra_sources = extractSources(result.data?.choices?.[0]?.message);

    return res.status(200).json({ ...result.data, zyntra_sources });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
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
