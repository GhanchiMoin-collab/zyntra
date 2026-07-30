export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: "Prompt is required." });
  }

  // Placeholder until we connect a real AI video API
  return res.status(200).json({
    video: "",
    message: "AI Video API not connected yet."
  });

}
