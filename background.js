// ──────────────────────────────────────────────────────────────
//  Promptly — Background Service Worker (v1.2.0)
//
//  Relays prompt-optimization requests to the Groq API.
//  Falls back to a built-in key if the user has not saved one,
//  so first-run experience requires zero configuration.
// ──────────────────────────────────────────────────────────────

const GROQ_API_URL    = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL      = "llama-3.3-70b-versatile";
const MAX_INPUT_CHARS = 2000;
const DEFAULT_GROQ_API_KEY = "YOUR_DEFAULT_GROQ_API_KEY_HERE";
const PROXY_API_URL   = "https://promptly-umber.vercel.app/api/optimize";

// ── Tone presets ───────────────────────────────────────────────
const TONE_INSTRUCTIONS = {
  default:   "",
  technical: " Prioritize technical precision: use exact terminology, mention edge cases, " +
             "specify types/interfaces/return values where relevant, and prefer code examples.",
  creative:  " Prioritize imaginative and expressive language. Encourage exploration of " +
             "novel ideas, metaphors, and narrative. The output should be engaging and vivid.",
  concise:   " Be maximally concise: strip all filler words. Use bullet points and terse " +
             "sentences. Target 50% fewer words than a typical response without losing meaning.",
};

const SYSTEM_PROMPT_BASE =
  "You are a prompt engineering assistant. Rewrite the user's short, casual request " +
  "into a clear, well-structured prompt for an LLM. Always include: (1) the explicit " +
  "goal, (2) relevant context or constraints implied by the request, (3) a requested " +
  "output format if applicable (code, list, table, prose), (4) any tech stack or " +
  "style hints if the request is about building software or design. Keep the tone " +
  "instructional, not conversational. Do not answer the request yourself — only " +
  "rewrite it as a better prompt. Return ONLY the rewritten prompt text, no preamble, " +
  "no quotation marks, no explanation.";


// ── Helper: build system prompt with tone ──────────────────────
function buildSystemPrompt(tone) {
  const toneNote = TONE_INSTRUCTIONS[tone] || "";
  return SYSTEM_PROMPT_BASE + toneNote;
}

// ── Helper: call the Groq API once ─────────────────────────────
async function callGroqApi(apiKey, userMessage, tone) {
  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: buildSystemPrompt(tone) },
        { role: "user",   content: userMessage    }
      ],
      temperature: 0.4
    })
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`API error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const optimized = data?.choices?.[0]?.message?.content;
  if (!optimized) throw new Error("Unexpected API response shape.");
  return optimized.trim();
}

// ── Helper: call the Vercel Proxy Server ────────────────────────
async function callProxyApi(text, projectContext, tone) {
  if (!PROXY_API_URL || PROXY_API_URL.includes("YOUR_PROXY_DEPLOYMENT_URL")) {
    throw new Error("No API key configured, and the cloud proxy URL is not set. Please set a custom key in popup settings, or configure the PROXY_API_URL in background.js.");
  }

  const response = await fetch(PROXY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ text, projectContext, tone })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Proxy error ${response.status}`);
  }

  if (!data.success || !data.optimizedPrompt) {
    throw new Error(data.error || "Unexpected proxy response format.");
  }

  return data.optimizedPrompt;
}

// ── Message listener ────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "OPTIMIZE_PROMPT") {
    const { text, projectContext, tone } = message;

    (async () => {
      try {
        // 1. Fetch user's API key from storage; migrate from old key if exists; fall back to built-in key
        const storage = await chrome.storage.local.get(["groqApiKey", "grokApiKey"]);
        let apiKey = (storage.groqApiKey && storage.groqApiKey.trim()) || "";

        // If no new key, migrate from old grokApiKey
        if (!apiKey && storage.grokApiKey && storage.grokApiKey.trim()) {
          apiKey = storage.grokApiKey.trim();
          await chrome.storage.local.set({ groqApiKey: apiKey });
        }

        // If still no key, check built-in fallback
        if (!apiKey && DEFAULT_GROQ_API_KEY && DEFAULT_GROQ_API_KEY !== "YOUR_DEFAULT_GROQ_API_KEY_HERE") {
          apiKey = DEFAULT_GROQ_API_KEY;
        }

        // 2. Build the user message, capping at MAX_INPUT_CHARS
        let userText = text || "";
        if (userText.length > MAX_INPUT_CHARS) {
          userText = userText.slice(0, MAX_INPUT_CHARS) + "...[truncated]";
        }

        if (projectContext && projectContext.trim() !== "") {
          userText += `\n\n${projectContext.trim()}`;
        }

        // 3. Perform optimization (direct API call or Proxy Server fallback)
        let optimized;
        if (apiKey) {
          try {
            optimized = await callGroqApi(apiKey, userText, tone || "default");
          } catch (firstErr) {
            // Retry once on server-side errors (5xx)
            if (firstErr.message.includes("API error 5")) {
              optimized = await callGroqApi(apiKey, userText, tone || "default");
            } else {
              throw firstErr;
            }
          }
        } else {
          // Fall back to backend proxy
          optimized = await callProxyApi(text, projectContext, tone || "default");
        }

        sendResponse({ success: true, optimizedPrompt: optimized });
      } catch (err) {
        console.error("[Promptly] API call failed:", err);
        sendResponse({
          success: false,
          error: err.message || "Unknown error — check your API key in extension settings."
        });
      }
    })();

    // Return true to keep the message channel open for the async response
    return true;
  }

  if (message.type === "TEST_API_KEY") {
    const { apiKey } = message;

    (async () => {
      try {
        if (apiKey && apiKey.trim()) {
          await callGroqApi(apiKey.trim(), "Say OK", "default");
        } else {
          // If no key supplied, verify if proxy is online
          await callProxyApi("Say OK", "", "default");
        }
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();

    return true;
  }

  return false;
});

// ── Keyboard shortcut relay ─────────────────────────────────────
chrome.commands.onCommand.addListener((command) => {
  if (command === "optimize-prompt") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "PROMPTLY_SHORTCUT" })
          .catch(() => { /* Tab may not have content script — ignore */ });
      }
    });
  }
});
