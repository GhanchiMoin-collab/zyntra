// Converts a reply to natural-sounding speech using Groq's Orpheus TTS,
// so Jarvis sounds like a real voice instead of the robotic browser
// speechSynthesis API. The frontend falls back to browser TTS
// automatically if this ever fails, so this upgrade is never a hard
// dependency.
//
// Orpheus caps a single request at 200 characters — far shorter than a
// typical AI reply — so longer text is split into sentence-sized chunks,
// each converted separately, and the resulting WAV audio is stitched
// back into one file before being sent to the client.

const ORPHEUS_MODEL = "canopylabs/orpheus-v1-english";
const DEFAULT_VOICE = "autumn";
const MAX_CHUNK_CHARS = 190; // stay safely under Orpheus's 200-char limit
const MAX_TOTAL_CHARS = 4000; // don't let one giant reply trigger dozens of requests

function chunkTextForOrpheus(text, maxLen = MAX_CHUNK_CHARS) {
    const sentences = text.match(/[^.!?]+[.!?]*(\s+|$)/g) || [text];
    const chunks = [];
    let current = "";

    function pushCurrent(){
        if(current.trim()) chunks.push(current.trim());
        current = "";
    }

    for(let sentence of sentences){
        sentence = sentence.trim();
        if(!sentence) continue;

        if(sentence.length > maxLen){
            // An unusually long "sentence" (no punctuation) — hard-split by words.
            const words = sentence.split(/\s+/);
            for(const w of words){
                const candidate = (current ? current + " " : "") + w;
                if(candidate.length > maxLen){
                    pushCurrent();
                    current = w;
                } else {
                    current = candidate;
                }
            }
            continue;
        }

        const candidate = (current ? current + " " : "") + sentence;
        if(candidate.length > maxLen){
            pushCurrent();
            current = sentence;
        } else {
            current = candidate;
        }
    }
    pushCurrent();
    return chunks.length ? chunks : [text.slice(0, maxLen)];
}

async function fetchOrpheusChunk(text, voice){
    const groqRes = await fetch("https://api.groq.com/openai/v1/audio/speech", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: ORPHEUS_MODEL,
            voice,
            input: text,
            response_format: "wav"
        })
    });
    if(!groqRes.ok){
        const errText = await groqRes.text().catch(() => "");
        throw new Error(`Groq TTS failed (${groqRes.status}): ${errText}`);
    }
    return Buffer.from(await groqRes.arrayBuffer());
}

// Minimal RIFF/WAVE chunk reader — enough to pull out "fmt " and "data".
function readWavChunks(buf){
    const chunks = {};
    let offset = 12; // skip the 12-byte RIFF/WAVE header
    while(offset + 8 <= buf.length){
        const id = buf.toString("ascii", offset, offset + 4);
        const size = buf.readUInt32LE(offset + 4);
        const dataStart = offset + 8;
        chunks[id] = buf.subarray(dataStart, dataStart + size);
        offset = dataStart + size + (size % 2); // chunks are word-aligned
    }
    return chunks;
}

// Stitches several separately-generated WAV clips into one playable file
// by concatenating their raw PCM data under a single header (built from
// the first clip's format info — all chunks come from the same model/
// voice/response_format, so the format is identical across them).
function concatWavBuffers(buffers){
    if(buffers.length === 1) return buffers[0];

    const first = readWavChunks(buffers[0]);
    const fmt = first["fmt "];
    const dataParts = buffers.map(b => readWavChunks(b)["data"]).filter(Boolean);
    const totalDataLen = dataParts.reduce((sum, d) => sum + d.length, 0);

    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + totalDataLen, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    fmt.copy(header, 20, 0, 16);
    header.write("data", 36);
    header.writeUInt32LE(totalDataLen, 40);

    return Buffer.concat([header, ...dataParts]);
}

export default async function handler(req, res) {
    if(req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    try{
        const { text, voice } = req.body || {};
        if(!text || typeof text !== "string" || !text.trim()){
            return res.status(400).json({ error: "Nothing to speak." });
        }

        const trimmed = text.trim().slice(0, MAX_TOTAL_CHARS);
        const chunks = chunkTextForOrpheus(trimmed);
        const voiceId = (typeof voice === "string" && voice) ? voice : DEFAULT_VOICE;

        const buffers = await Promise.all(chunks.map(chunk => fetchOrpheusChunk(chunk, voiceId)));
        const finalBuffer = concatWavBuffers(buffers);

        res.setHeader("Content-Type", "audio/wav");
        res.setHeader("Cache-Control", "no-store");
        return res.status(200).send(finalBuffer);
    }catch(error){
        console.error("speak error:", error);
        return res.status(502).json({ error: "Text-to-speech failed." });
    }
}
