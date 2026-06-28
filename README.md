# ⚡ Promptly — Chrome Extension

> **Turn one-line prompts into structured, high-quality prompts for any AI chat.  
> No login. No server. Runs entirely in your browser.**

---

## What it does

Promptly injects a small floating **⚡ button** into the corner of any text input on
any website — ChatGPT, Claude.ai, Gemini, Grok, Perplexity, or any site with a
chat box.

1. Type a short, casual one-liner into the textbox.
2. Click the **⚡ button**.
3. Promptly sends your text to the **xAI Grok API** and receives a fully
   structured, detailed prompt in return.
4. The original textbox is updated with the optimized prompt — ready for you
   to review and send.

---

## How to load the extension in Chrome

1. Open Chrome and navigate to **`chrome://extensions`**.
2. Enable **"Developer mode"** (top-right toggle).
3. Click **"Load unpacked"**.
4. Select the **`promptly/`** folder (this directory).
5. The extension icon (⚡) appears in your Chrome toolbar.

---

## Entering your Grok API key

1. Click the **Promptly icon** in the Chrome toolbar to open the popup.
2. Select the **Settings** tab.
3. Paste your xAI Grok API key into the "Grok API Key" field.
4. Click **Save Key**.

> **Your key is stored only in `chrome.storage.local` on your device.  
> It is never sent anywhere except directly to `api.x.ai`.**

Don't have a key yet?  
→ [Get a Grok API key at x.ai/api](https://x.ai/api)

---

## Adding a Project context

Project contexts let you append reusable information to every prompt optimization
call — for example your tech stack, preferred code style, or project constraints.

1. Open the popup and click the **Projects** tab.
2. Click **Add**.
3. Fill in:
   - **Project name** — a short label (e.g. "My SaaS App").
   - **Stack / Domain** — e.g. `Next.js, Postgres, Tailwind CSS`.
   - **Tone / Style** — e.g. `Concise, technical, no fluff`.
   - **Constraints** — e.g. `No external libraries unless essential`.
4. Click **Save Project**.
5. Use the **"Active project context"** dropdown to select it.

The context is automatically appended to every optimization call while selected.
Set the dropdown to **None** to disable it.

---

## File structure

```
promptly/
├── manifest.json          # Manifest V3 config
├── background.js          # Service worker — relays calls to Grok API
├── content-script.js      # Injected into every page — detects inputs, shows button
├── test.html              # Local test page (open in Chrome after loading extension)
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── popup/
    ├── popup.html         # Extension popup UI
    ├── popup.js           # Popup logic (settings + projects)
    └── popup.css          # Popup styles
```

---

## Security & cost guardrails

- **No hardcoded keys** — your API key only ever lives in `chrome.storage.local`.
- **Debounce protection** — the ⚡ button is disabled while a request is in-flight,
  preventing accidental duplicate API calls.
- **Input cap** — text longer than 2,000 characters is truncated before being sent,
  keeping each API call small and cheap.
- **One silent retry** — on a server-side (5xx) error, the extension retries once
  automatically; all other errors surface immediately.

---

## Tech used

| Component | Technology |
|-----------|-----------|
| Extension platform | Chrome Manifest V3 |
| API | xAI Grok (`grok-4-fast` model) |
| Persistence | `chrome.storage.local` |
| UI | Vanilla HTML / CSS / JS |
| Backend | None — fully client-side |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| ⚡ button doesn't appear | Refresh the page after loading the extension |
| "Check your API key" error | Open popup → Settings → verify key is saved |
| Optimized prompt is empty | The Grok API returned an unexpected response — try again |
| Button doesn't appear on ChatGPT/Claude | Click inside the text field first; the button follows focus |
