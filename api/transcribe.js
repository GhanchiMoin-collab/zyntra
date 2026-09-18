// Transcribes a short recorded audio clip using Groq's Whisper — used by
// the Jarvis live voice call to turn each utterance into text. Replaces
// the old browser-native SpeechRecognition, which only ever worked
// reliably in Chrome; Whisper works the same everywhere and is generally
// more accurate, especially with accents/background noise.
//
// Body parsing is disabled because the client sends the raw recorded
// audio bytes directly (not JSON) — simplest way to get a Blob from
// MediaRecorder to Groq without extra multipart handling on the client.

export const config = { api: { bodyParser: false } };

const MAX_AUDIO_BYTES = 15 * 1024 * 1024; // a single utterance is seconds long, this is generous

async function readRawBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_AUDIO_BYTES) throw new Error("Audio too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const buf = await readRawBody(req);
    if (!buf.length) return res.status(400).json({ error: 'No audio received.' });

    const contentType = req.headers['content-type'] || 'audio/webm';
    const blob = new Blob([buf], { type: contentType });
    const form = new FormData();
    form.append('file', blob, 'audio.webm');
    form.append('model', 'whisper-large-v3-turbo');
    form.append('response_format', 'json');

    const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: form
    });

    const data = await groqRes.json().catch(() => null);
    if (!groqRes.ok) {
      console.error('transcribe error:', data);
      return res.status(502).json({ error: data?.error?.message || 'Transcription failed.' });
    }

    return res.status(200).json({ text: (data?.text || '').trim() });
  } catch (error) {
    console.error('transcribe error:', error);
    return res.status(500).json({ error: 'Could not transcribe that.' });
  }
}
