// ──────────────────────────────────────────────────────────────
//  Promptly Backend Proxy Server — Serverless API Handler
//  Securely relays prompt-optimization requests to the Groq API
//  without exposing the API key to extension users or Git.
// ──────────────────────────────────────────────────────────────

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL   = "llama-3.3-70b-versatile";

const SYSTEM_PROMPT_BASE =
  "You are a prompt engineering assistant. Rewrite the user's short, casual request " +
  "into a clear, well-structured prompt for an LLM. Always include: (1) the explicit " +
  "goal, (2) relevant context or constraints implied by the request, (3) a requested " +
  "output format if applicable (code, list, table, prose), (4) any tech stack or " +
  "style hints if the request is about building software or design. Keep the tone " +
  "instructional, not conversational. Do not answer the request yourself — only " +
  "rewrite it as a better prompt. Return ONLY the rewritten prompt text, no preamble, " +
  "no quotation marks, no explanation.";

const TONE_INSTRUCTIONS = {
  default:   "",
  technical: " Prioritize technical precision: use exact terminology, mention edge cases, " +
             "specify types/interfaces/return values where relevant, and prefer code examples.",
  creative:  " Prioritize imaginative and expressive language. Encourage exploration of " +
             "novel ideas, metaphors, and narrative. The output should be engaging and vivid.",
  concise:   " Be maximally concise: strip all filler words. Use bullet points and terse " +
             "sentences. Target 50% fewer words than a typical response without losing meaning.",
};

module.exports = async (req, res) => {
  // ── CORS Headers Setup ───────────────────────────────────────
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization"
  );

  // Handle CORS preflight options request
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method Not Allowed. Use POST." });
  }

  try {
    const { text, projectContext, tone } = req.body || {};

    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, error: "Text prompt is required." });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      console.error("[Promptly Proxy] GROQ_API_KEY environment variable is not configured.");
      return res.status(500).json({
        success: false,
        error: "Default cloud optimizer is not configured. GROQ_API_KEY environment variable is missing on proxy."
      });
    }

    // ── Build Prompt with Tone ──────────────────────────────────
    const toneNote = TONE_INSTRUCTIONS[tone || "default"] || "";
    const systemPrompt = SYSTEM_PROMPT_BASE + toneNote;

    let userText = text;
    if (projectContext && projectContext.trim() !== "") {
      userText += `\n\n${projectContext.trim()}`;
    }

    // ── Call Groq API ───────────────────────────────────────────
    const groqResponse = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey.trim()}`
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userText }
        ],
        temperature: 0.4
      })
    });

    if (!groqResponse.ok) {
      const errText = await groqResponse.text().catch(() => "");
      console.error(`[Promptly Proxy] Groq API returned error: ${groqResponse.status} - ${errText}`);
      return res.status(groqResponse.status).json({
        success: false,
        error: `Groq API error: ${groqResponse.status}. ${errText.slice(0, 150)}`
      });
    }

    const data = await groqResponse.json();
    const optimized = data?.choices?.[0]?.message?.content;

    if (!optimized) {
      return res.status(500).json({ success: false, error: "Unexpected API response shape from Groq." });
    }

    return res.status(200).json({ success: true, optimizedPrompt: optimized.trim() });

  } catch (error) {
    console.error("[Promptly Proxy] Optimization request failed:", error);
    return res.status(500).json({ success: false, error: error.message || "Internal server error on proxy." });
  }
};
