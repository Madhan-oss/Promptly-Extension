// ──────────────────────────────────────────────────────────────
//  Promptly — Chat Exporter Module (v1.2.0)
//
//  Detects which AI platform the user is on, scrapes the visible
//  chat conversation, formats it as Markdown, downloads it as a
//  .md file, copies it to the clipboard, and stores a history
//  of the last 5 exports in chrome.storage.local.
//
//  Exposes: window.PromptlyExporter
// ──────────────────────────────────────────────────────────────
(function () {
  'use strict';

  const MAX_HISTORY = 5;

  // ── Platform Configurations ────────────────────────────────
  const CHATGPT_CONFIG = {
    name: 'ChatGPT',
    newChatUrl: 'https://chatgpt.com/',
    userSelectors: [
      '[data-message-author-role="user"]',
      '[data-testid="user-message"]',
      '.user-message',
      '[class*="UserMessage"]',
    ],
    aiSelectors: [
      '[data-message-author-role="assistant"]',
      '[data-testid="assistant-message"]',
      '.assistant-message',
      '[class*="AssistantMessage"]',
      'article.w-full',
      '.markdown',
    ],
    limitPatterns: [
      /you('ve| have) reached (your |the )?(daily |message |free )?(limit|cap)/i,
      /out of (free )?messages/i,
      /upgrade (to |your plan )?to (continue|send more)/i,
      /message limit reached/i,
      /you've reached the (plus|free) plan limit/i,
      /send a message to continue in a new chat/i,
      /you've hit (the |your )?(free )?limit/i,
      /start a new chat to continue/i,
    ],
  };

  const PLATFORMS = {
    // ChatGPT — registered under both old and new domains
    'chatgpt.com':      CHATGPT_CONFIG,
    'chat.openai.com':  CHATGPT_CONFIG,

    'claude.ai': {
      name: 'Claude',
      newChatUrl: 'https://claude.ai/new',
      userSelectors: [
        '[data-testid="human-turn"]',
        '.human-turn',
        '[class*="HumanTurn"]',
        '[class*="human"]',
      ],
      aiSelectors: [
        '[data-testid="assistant-message"]',
        '.font-claude-message',
        '.assistant-turn',
        '[class*="AssistantMessage"]',
      ],
      limitPatterns: [
        /conversation (is |has become )too long/i,
        /usage (limit|cap)/i,
        /message (limit|cap)/i,
        /start a new conversation/i,
        /you've reached your (daily |weekly |monthly )?limit/i,
        /claude\.ai has a usage limit/i,
      ],
    },

    'gemini.google.com': {
      name: 'Gemini',
      newChatUrl: 'https://gemini.google.com/',
      userSelectors: [
        '.user-query-text',
        '.query-text-container',
        '[class*="userQuery"]',
        'user-query',
      ],
      aiSelectors: [
        '.model-response-text',
        '.response-content',
        '[class*="modelResponse"]',
        '.message-content',
      ],
      limitPatterns: [
        /daily limit/i,
        /rate limit/i,
        /quota exceeded/i,
        /too many requests/i,
        /you('ve| have) reached/i,
      ],
    },

    'grok.com': {
      name: 'Grok',
      newChatUrl: 'https://grok.com/',
      userSelectors: [
        '[class*="UserMessage"]',
        '[data-testid="user-message"]',
        '[class*="human"]',
      ],
      aiSelectors: [
        '[class*="BotMessage"]',
        '[class*="AssistantMessage"]',
        '[class*="GrokMessage"]',
      ],
      limitPatterns: [/rate limit/i, /usage limit/i, /quota/i, /limit reached/i],
    },

    'x.com': {
      name: 'Grok (X)',
      newChatUrl: 'https://x.com/i/grok',
      userSelectors: ['[class*="UserMessage"]', '[data-testid="user-message"]'],
      aiSelectors: ['[class*="AssistantMessage"]', '[class*="GrokMessage"]'],
      limitPatterns: [/rate limit/i, /usage limit/i, /limit reached/i],
    },

    'perplexity.ai': {
      name: 'Perplexity',
      newChatUrl: 'https://perplexity.ai/',
      userSelectors: [
        '.my-query-text',
        '[class*="UserQuery"]',
        '.user-query',
        '[class*="QueryText"]',
      ],
      aiSelectors: [
        '.prose',
        '.answer-text',
        '[class*="Answer"]',
        '[class*="ResponseText"]',
      ],
      limitPatterns: [
        /pro query limit/i,
        /daily limit/i,
        /rate limit/i,
        /you('ve| have) (reached|hit) (your |the )?limit/i,
      ],
    },
  };

  // ── Detect Current Platform ──────────────────────────────────
  function detectPlatform() {
    const hostname = window.location.hostname.replace(/^www\./, '');
    return PLATFORMS[hostname] || null;
  }

  // ── Extract Clean Text from a DOM Element ────────────────────
  function extractText(el) {
    const clone = el.cloneNode(true);
    // Remove buttons and aria-hidden noise
    clone.querySelectorAll('button, [aria-hidden="true"], .sr-only').forEach(n => n.remove());
    return (clone.innerText || clone.textContent || '').trim();
  }

  // ── Find elements using multiple selector fallbacks ──────────
  function queryAll(selectors) {
    for (const sel of selectors) {
      try {
        const els = [...document.querySelectorAll(sel)];
        if (els.length > 0) return els;
      } catch (_) { /* invalid selector, skip */ }
    }
    return [];
  }

  // ── Generic Fallback: scrape by DOM heuristics ───────────────
  function scrapeGeneric() {
    // Look for blocks that look like chat messages: decent length, not deeply nested
    const candidates = [...document.querySelectorAll('p, div, article')]
      .filter(el => {
        const text = (el.innerText || '').trim();
        if (text.length < 30 || text.length > 8000) return false;
        if (el.children.length > 8) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 200 && rect.height > 20;
      })
      .slice(0, 50);

    if (candidates.length === 0) return [];

    // Alternate user/assistant labelling as best guess
    return candidates.map((el, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      text: extractText(el),
    }));
  }

  // ── Scrape Chat Messages ─────────────────────────────────────
  function scrapeMessages(config) {
    const userEls   = queryAll(config.userSelectors || []);
    const aiEls     = queryAll(config.aiSelectors   || []);

    if (userEls.length === 0 && aiEls.length === 0) {
      return scrapeGeneric();
    }

    // Tag every element with its role and sort by DOM position
    const tagged = [
      ...userEls.map(el => ({ el, role: 'user' })),
      ...aiEls.map(  el => ({ el, role: 'assistant' })),
    ].sort((a, b) => {
      const rel = a.el.compareDocumentPosition(b.el);
      return (rel & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
    });

    const messages = [];
    for (const { el, role } of tagged) {
      const text = extractText(el);
      if (text.length > 5) messages.push({ role, text });
    }
    return messages;
  }

  // ── Format Messages as Markdown ──────────────────────────────
  function formatAsMarkdown(messages, platform) {
    const now = new Date();
    const dateStr = now.toLocaleString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

    const lines = [
      `# 💬 Chat Export — ${platform?.name || 'AI Chat'}`,
      ``,
      `| Field | Value |`,
      `|-------|-------|`,
      `| **Platform** | ${platform?.name || 'Unknown'} |`,
      `| **Exported** | ${dateStr} |`,
      `| **Messages** | ${messages.length} |`,
      `| **URL** | ${window.location.href} |`,
      ``,
      `---`,
      ``,
    ];

    for (const { role, text } of messages) {
      if (role === 'user') {
        lines.push(`## 👤 You`);
      } else {
        lines.push(`## 🤖 ${platform?.name || 'AI'}`);
      }
      lines.push('');
      lines.push(text);
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    lines.push(`*Exported by [Promptly](https://github.com/promptly-extension/promptly) — AI Prompt Optimizer & Chat Saver*`);

    return lines.join('\n');
  }

  // ── Trigger a .md file download via hidden <a> ───────────────
  function downloadMarkdown(content, filename) {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  // ── Save export entry to chrome.storage.local ────────────────
  async function saveToHistory(entry) {
    return new Promise(resolve => {
      chrome.storage.local.get('chatHistory', ({ chatHistory = [] }) => {
        const updated = [entry, ...chatHistory].slice(0, MAX_HISTORY);
        chrome.storage.local.set({ chatHistory: updated }, resolve);
      });
    });
  }

  // ── Copy text to clipboard (with fallback) ───────────────────
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        Object.assign(ta.style, { position: 'fixed', opacity: '0', top: '0', left: '0' });
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        ta.remove();
        return true;
      } catch (_2) { return false; }
    }
  }

  // ── Detect chat limit banner text on the page ────────────────
  function detectLimitBanner() {
    const platform = detectPlatform();
    if (!platform) return false;
    const bodyText = document.body.innerText || '';
    return platform.limitPatterns.some(rx => rx.test(bodyText));
  }

  // ── Main Export Entry Point ──────────────────────────────────
  async function exportChat() {
    const platform = detectPlatform();
    const cfg      = platform || { userSelectors: [], aiSelectors: [] };
    const messages = scrapeMessages(cfg);

    if (messages.length === 0) {
      return { success: false, error: 'No chat messages found on this page.' };
    }

    const markdown   = formatAsMarkdown(messages, platform);
    const now        = new Date();
    const dateTag    = now.toISOString().slice(0, 10);
    const platTag    = (platform?.name || 'chat').toLowerCase().replace(/\s+/g, '-');
    const filename   = `chat-export-${dateTag}-${platTag}.md`;

    // 1. Download the .md file
    downloadMarkdown(markdown, filename);

    // 2. Copy content to clipboard (for pasting into new chat)
    await copyToClipboard(markdown);

    // 3. Persist to history (store trimmed content to save space — cap at 50KB)
    const storedContent = markdown.length > 51200
      ? markdown.slice(0, 51200) + '\n\n*[Content trimmed for storage]*'
      : markdown;

    await saveToHistory({
      id:           `exp-${Date.now()}`,
      platform:     platform?.name || 'Unknown',
      date:         now.toISOString(),
      messageCount: messages.length,
      filename,
      content:      storedContent,
      url:          window.location.href,
    });

    return {
      success:      true,
      messageCount: messages.length,
      platform:     platform?.name || 'Unknown',
      newChatUrl:   platform?.newChatUrl || null,
      filename,
    };
  }

  // ── Public API ────────────────────────────────────────────────
  window.PromptlyExporter = {
    detectPlatform,
    isAIPlatform:      () => detectPlatform() !== null,
    exportChat,
    detectLimitBanner,
  };
})();
