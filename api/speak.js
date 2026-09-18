// Converts a reply to natural-sounding speech using Groq's TTS, so Jarvis
// sounds like a real voice instead of the robotic browser
// speechSynthesis API. The frontend falls back to browser TTS
// automatically if this ever fails (e.g. the Groq account hasn't
// accepted the model's terms yet), so this upgrade is never a hard
// dependency.
//
// NOTE: the "playai-tts" model requires accepting its terms once at
// https://console.groq.com/playground?model=playai-tts with the same
// account that owns GROQ_API_KEY — otherwise Groq will reject every
// request here with a 400/403 until that's done.

const MAX_CHARS = 2000; // a single reply is read aloud in seconds either way

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { text, voice } = req.body || {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Nothing to speak.' });
    }

    const groqRes = await fetch('https://api.groq.com/openai/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'playai-tts',
        voice: (typeof voice === 'string' && voice) ? voice : 'Fritz-PlayAI',
        input: text.slice(0, MAX_CHARS),
        response_format: 'wav'
      })
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text().catch(() => '');
      console.error('speak error:', groqRes.status, errText);
      return res.status(502).json({ error: 'Text-to-speech failed.' });
    }

    const arrayBuf = await groqRes.arrayBuffer();
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(Buffer.from(arrayBuf));
  } catch (error) {
    console.error('speak error:', error);
    return res.status(500).json({ error: 'Text-to-speech failed.' });
  }
}
