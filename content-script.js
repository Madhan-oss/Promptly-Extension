// ──────────────────────────────────────────────────────────────
//  Promptly — Content Script (v1.2.0)
//
//  Injects two floating buttons on any webpage:
//   ⚡  Optimize Prompt — rewrites your prompt using Groq AI
//   💾  Save Chat       — exports the full chat when limit hit
//
//  New in v1.2.0:
//   • Debounced MutationObserver for performance on heavy pages
//   • Keyboard shortcut support (Alt+Shift+P)
//   • One-click Undo — restores original text after optimization
//   • Tone context passed along from popup selection
//   • chatgpt.com recognised as AI platform for Save button
//
//  Depends on: browser-polyfill.js, chat-exporter.js (loaded first)
// ──────────────────────────────────────────────────────────────
(function () {
  'use strict';

  // ── Constants ────────────────────────────────────────────────
  const BUTTON_ID      = 'promptly-optimize-btn';
  const UNDO_BTN_ID    = 'promptly-undo-btn';
  const SAVE_BTN_ID    = 'promptly-save-btn';
  const TOOLTIP_ID     = 'promptly-tooltip';
  const CONFIRM_ID     = 'promptly-confirm-dialog';
  const BTN_SIZE       = 40;   // px — diameter of each button
  const OFFSET         = 8;    // px — gap from input corner
  const SAVE_GAP       = 52;   // px — vertical gap: optimize → save
  const UNDO_GAP       = 52;   // px — vertical gap: undo → optimize
  const LIMIT_POLL_MS  = 3000; // ms — how often to check for limit banners
  const DEBOUNCE_MS    = 60;   // ms — MutationObserver debounce

  // ── State ────────────────────────────────────────────────────
  let currentInput    = null;
  let isRequesting    = false;
  let isSaving        = false;
  let observer        = null;
  let limitPollTimer  = null;
  let limitDetected   = false;
  let debounceTimer   = null;
  let lastOriginalText = null;  // for undo feature
  let promptlyEnabled  = true;  // master on/off

  // ── Hide / show all Promptly buttons ─────────────────────────
  function setButtonsVisible(visible) {
    [BUTTON_ID, UNDO_BTN_ID, SAVE_BTN_ID].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = visible ? '' : 'none';
    });
  }

  // Listen for toggle from popup
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'PROMPTLY_TOGGLE') {
      promptlyEnabled = msg.enabled;
      setButtonsVisible(promptlyEnabled);
    }
  });

  // Check saved state on load
  chrome.storage.local.get('promptlyEnabled', ({ promptlyEnabled: saved }) => {
    promptlyEnabled = saved !== false;
    if (!promptlyEnabled) setButtonsVisible(false);
  });

  // ════════════════════════════════════════════════════════════
  //  UTILITIES
  // ════════════════════════════════════════════════════════════

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const s = window.getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
  }

  function area(el) {
    const r = el.getBoundingClientRect();
    return r.width * r.height;
  }

  // ════════════════════════════════════════════════════════════
  //  INPUT DETECTION
  // ════════════════════════════════════════════════════════════

  function detectChatInput() {
    const active = document.activeElement;
    if (
      active &&
      (active.tagName === 'TEXTAREA' ||
        (active.contentEditable === 'true' && active.tagName !== 'BODY')) &&
      isVisible(active)
    ) {
      return active;
    }

    const textareas = [...document.querySelectorAll('textarea')].filter(isVisible);
    if (textareas.length > 0) {
      return textareas.reduce((a, b) => (area(a) >= area(b) ? a : b));
    }

    const editables = [...document.querySelectorAll("[contenteditable='true']")].filter(
      el => isVisible(el) && el.tagName !== 'BODY' && el.tagName !== 'HTML'
    );
    if (editables.length > 0) {
      return editables.reduce((a, b) => (area(a) >= area(b) ? a : b));
    }

    return null;
  }

  function readInputText(el) {
    if (!el) return '';
    return el.tagName === 'TEXTAREA' || el.tagName === 'INPUT'
      ? el.value
      : el.innerText || el.textContent || '';
  }

  function writeInputText(el, text) {
    if (!el) return;

    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const setter =
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set ||
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(el, text);
      else el.value = text;
    } else {
      el.innerText = text;
    }

    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ════════════════════════════════════════════════════════════
  //  STYLES
  // ════════════════════════════════════════════════════════════

  function injectStyles() {
    if (document.getElementById('promptly-styles')) return;
    const style = document.createElement('style');
    style.id = 'promptly-styles';
    style.textContent = `
      @keyframes promptly-spin {
        from { transform: rotate(0deg); }
        to   { transform: rotate(360deg); }
      }
      @keyframes promptly-pulse {
        0%, 100% { box-shadow: 0 4px 16px rgba(38,224,181,0.4); }
        50%       { box-shadow: 0 4px 28px rgba(38,224,181,0.85); }
      }
      @keyframes promptly-slide-in {
        from { opacity:0; transform:translateY(8px) scale(0.95); }
        to   { opacity:1; transform:translateY(0)   scale(1);    }
      }
      @keyframes promptly-pop-in {
        0%   { opacity:0; transform:scale(0.5); }
        70%  { transform:scale(1.15); }
        100% { opacity:1; transform:scale(1); }
      }

      #${BUTTON_ID}:hover,
      #${SAVE_BTN_ID}:hover,
      #${UNDO_BTN_ID}:hover {
        transform: scale(1.12) !important;
      }

      #${TOOLTIP_ID} {
        position: fixed;
        z-index: 2147483645;
        background: #13142B;
        color: #fff;
        font: 500 12px/1.4 system-ui, sans-serif;
        padding: 6px 10px;
        border-radius: 6px;
        pointer-events: none;
        white-space: nowrap;
        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        transition: opacity 0.2s;
        animation: promptly-slide-in 0.15s ease;
      }

      #${CONFIRM_ID} {
        position: fixed;
        z-index: 2147483647;
        bottom: 90px;
        right: 20px;
        background: #1C1E3A;
        border: 1px solid #2E3260;
        border-radius: 12px;
        padding: 16px 18px;
        width: 290px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.55);
        font-family: system-ui, sans-serif;
        animation: promptly-slide-in 0.2s ease;
      }
      #${CONFIRM_ID} .pcd-title {
        font-size: 13px;
        font-weight: 700;
        color: #EAEAF8;
        margin-bottom: 4px;
      }
      #${CONFIRM_ID} .pcd-body {
        font-size: 12px;
        color: #8C8FB3;
        margin-bottom: 14px;
        line-height: 1.5;
      }
      #${CONFIRM_ID} .pcd-actions {
        display: flex;
        gap: 8px;
      }
      #${CONFIRM_ID} .pcd-btn-primary {
        flex: 1;
        padding: 8px 12px;
        background: #26E0B5;
        color: #13142B;
        border: none;
        border-radius: 6px;
        font: 600 12px system-ui;
        cursor: pointer;
        transition: background 0.15s;
      }
      #${CONFIRM_ID} .pcd-btn-primary:hover { background: #34f0c4; }
      #${CONFIRM_ID} .pcd-btn-secondary {
        padding: 8px 12px;
        background: #252848;
        color: #8C8FB3;
        border: 1px solid #2E3260;
        border-radius: 6px;
        font: 500 12px system-ui;
        cursor: pointer;
        transition: background 0.15s;
      }
      #${CONFIRM_ID} .pcd-btn-secondary:hover { background: #2E3260; }
    `;
    document.head.appendChild(style);
  }

  // ════════════════════════════════════════════════════════════
  //  ⚡ OPTIMIZE BUTTON
  // ════════════════════════════════════════════════════════════

  function createOptimizeButton() {
    let btn = document.getElementById(BUTTON_ID);
    if (!btn) {
      btn = document.createElement('button');
      btn.id = BUTTON_ID;
      btn.title = 'Optimize Prompt (Promptly) — Alt+Shift+P';
      btn.setAttribute('aria-label', 'Optimize Prompt with Promptly');
      applyOptimizeStyles(btn, 'idle');
      btn.addEventListener('click', handleOptimizeClick);
      document.body.appendChild(btn);
    }
    return btn;
  }

  function applyOptimizeStyles(btn, state) {
    Object.assign(btn.style, {
      position:       'fixed',
      zIndex:         '2147483647',
      width:          `${BTN_SIZE}px`,
      height:         `${BTN_SIZE}px`,
      borderRadius:   '50%',
      border:         'none',
      cursor:         state === 'loading' ? 'wait' : 'pointer',
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      boxShadow:      '0 4px 16px rgba(52,46,173,0.45)',
      transition:     'background 0.2s, transform 0.15s, box-shadow 0.2s',
      outline:        'none',
      padding:        '0',
      background:     state === 'loading' ? '#1e1a7a' : '#342EAD',
      transform:      'scale(1)',
      pointerEvents:  state === 'loading' ? 'none' : 'auto',
    });

    btn.innerHTML = state === 'loading'
      ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20"
              fill="none" stroke="white" stroke-width="2.5" aria-hidden="true"
              style="animation:promptly-spin 0.8s linear infinite;">
           <circle cx="12" cy="12" r="10" stroke-opacity="0.3"/>
           <path d="M12 2 a10 10 0 0 1 10 10" stroke-linecap="round"/>
         </svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20"
              fill="white" aria-hidden="true">
           <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
         </svg>`;
  }

  // ════════════════════════════════════════════════════════════
  //  ↩ UNDO BUTTON (appears briefly after optimization)
  // ════════════════════════════════════════════════════════════

  function createUndoButton() {
    let btn = document.getElementById(UNDO_BTN_ID);
    if (!btn) {
      btn = document.createElement('button');
      btn.id = UNDO_BTN_ID;
      btn.title = 'Undo — restore original text';
      btn.setAttribute('aria-label', 'Undo prompt optimization');
      applyUndoStyles(btn, 'hidden');
      btn.addEventListener('click', handleUndoClick);
      document.body.appendChild(btn);
    }
    return btn;
  }

  function applyUndoStyles(btn, state) {
    const hidden = state === 'hidden';
    Object.assign(btn.style, {
      position:       'fixed',
      zIndex:         '2147483646',
      width:          `${BTN_SIZE}px`,
      height:         `${BTN_SIZE}px`,
      borderRadius:   '50%',
      border:         'none',
      cursor:         'pointer',
      display:        hidden ? 'none' : 'flex',
      alignItems:     'center',
      justifyContent: 'center',
      background:     '#252848',
      boxShadow:      '0 4px 14px rgba(0,0,0,0.35)',
      transition:     'background 0.2s, transform 0.15s',
      outline:        'none',
      padding:        '0',
      animation:      hidden ? 'none' : 'promptly-pop-in 0.25s ease',
    });

    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"
           fill="none" stroke="#8C8FB3" stroke-width="2.5" stroke-linecap="round"
           stroke-linejoin="round" aria-hidden="true">
        <polyline points="9 14 4 9 9 4"/>
        <path d="M20 20v-7a4 4 0 0 0-4-4H4"/>
      </svg>`;
  }

  let undoHideTimer = null;

  function showUndoButton(optBtn) {
    const undoBtn = document.getElementById(UNDO_BTN_ID) || createUndoButton();
    applyUndoStyles(undoBtn, 'visible');
    positionUndoButton(undoBtn, optBtn);

    if (undoHideTimer) clearTimeout(undoHideTimer);
    // Auto-hide after 8 seconds
    undoHideTimer = setTimeout(() => {
      applyUndoStyles(undoBtn, 'hidden');
      lastOriginalText = null;
    }, 8000);
  }

  function hideUndoButton() {
    const btn = document.getElementById(UNDO_BTN_ID);
    if (btn) applyUndoStyles(btn, 'hidden');
    if (undoHideTimer) clearTimeout(undoHideTimer);
    lastOriginalText = null;
  }

  function positionUndoButton(undoBtn, optimizeBtn) {
    if (!undoBtn || !optimizeBtn) return;
    const optRect = optimizeBtn.getBoundingClientRect();
    if (optRect.width === 0) { undoBtn.style.display = 'none'; return; }
    undoBtn.style.top  = `${optRect.top - UNDO_GAP}px`;
    undoBtn.style.left = optimizeBtn.style.left;
    undoBtn.style.position = 'fixed';
  }

  // ════════════════════════════════════════════════════════════
  //  💾 SAVE CHAT BUTTON  (only on AI platforms)
  // ════════════════════════════════════════════════════════════

  function createSaveButton() {
    if (!window.PromptlyExporter?.isAIPlatform()) return null;

    let btn = document.getElementById(SAVE_BTN_ID);
    if (!btn) {
      btn = document.createElement('button');
      btn.id = SAVE_BTN_ID;
      btn.title = 'Save Chat & Continue (Promptly)';
      btn.setAttribute('aria-label', 'Save full chat conversation');
      applySaveStyles(btn, 'idle');
      btn.addEventListener('click', handleSaveClick);
      document.body.appendChild(btn);
    }
    return btn;
  }

  function applySaveStyles(btn, state) {
    const isPulsing = state === 'pulse';
    const isLoading = state === 'loading';

    Object.assign(btn.style, {
      position:       'fixed',
      zIndex:         '2147483646',
      width:          `${BTN_SIZE}px`,
      height:         `${BTN_SIZE}px`,
      borderRadius:   '50%',
      border:         'none',
      cursor:         isLoading ? 'wait' : 'pointer',
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      transition:     'background 0.2s, transform 0.15s, box-shadow 0.2s',
      outline:        'none',
      padding:        '0',
      background:     isLoading ? '#0a7a5e' : '#13a37a',
      transform:      'scale(1)',
      pointerEvents:  isLoading ? 'none' : 'auto',
      animation:      isPulsing ? 'promptly-pulse 1.5s ease-in-out infinite' : 'none',
      boxShadow:      isPulsing
        ? '0 4px 16px rgba(38,224,181,0.6)'
        : '0 4px 16px rgba(19,163,122,0.45)',
    });

    btn.innerHTML = isLoading
      ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18"
              fill="none" stroke="white" stroke-width="2.5" aria-hidden="true"
              style="animation:promptly-spin 0.8s linear infinite;">
           <circle cx="12" cy="12" r="10" stroke-opacity="0.3"/>
           <path d="M12 2 a10 10 0 0 1 10 10" stroke-linecap="round"/>
         </svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18"
              fill="none" stroke="white" stroke-width="2" stroke-linecap="round"
              stroke-linejoin="round" aria-hidden="true">
           <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
           <polyline points="7 10 12 15 17 10"/>
           <line x1="12" y1="15" x2="12" y2="3"/>
         </svg>`;
  }

  function positionSaveButton(saveBtn, optimizeBtn) {
    if (!saveBtn || !optimizeBtn) return;
    const optRect = optimizeBtn.getBoundingClientRect();
    if (optRect.width === 0) {
      saveBtn.style.display = 'none';
      return;
    }
    const undoVisible = document.getElementById(UNDO_BTN_ID)?.style.display !== 'none';
    const extraOffset  = undoVisible ? UNDO_GAP : 0;
    saveBtn.style.display  = 'flex';
    saveBtn.style.top      = `${optRect.top - SAVE_GAP - extraOffset}px`;
    saveBtn.style.left     = optimizeBtn.style.left;
    saveBtn.style.position = 'fixed';
  }

  // ════════════════════════════════════════════════════════════
  //  POSITIONING (shared)
  // ════════════════════════════════════════════════════════════

  function positionOptimizeButton(btn, input) {
    if (!input) { btn.style.display = 'none'; return; }
    const rect = input.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) { btn.style.display = 'none'; return; }
    btn.style.display  = 'flex';
    btn.style.position = 'fixed';
    btn.style.top      = `${rect.bottom - BTN_SIZE - OFFSET}px`;
    btn.style.left     = `${rect.right  - BTN_SIZE - OFFSET}px`;
  }

  function repositionAll() {
    const optBtn  = document.getElementById(BUTTON_ID);
    const saveBtn = document.getElementById(SAVE_BTN_ID);
    const undoBtn = document.getElementById(UNDO_BTN_ID);
    if (optBtn  && currentInput) positionOptimizeButton(optBtn, currentInput);
    if (undoBtn && optBtn)       positionUndoButton(undoBtn, optBtn);
    if (optBtn  && saveBtn)      positionSaveButton(saveBtn, optBtn);
  }

  // ════════════════════════════════════════════════════════════
  //  TOOLTIP
  // ════════════════════════════════════════════════════════════

  function showTooltip(message, color, duration = 4000) {
    removeTooltip();
    const ref  = document.getElementById(SAVE_BTN_ID) || document.getElementById(BUTTON_ID);
    if (!ref) return;
    const rect = ref.getBoundingClientRect();
    const tip  = document.createElement('div');
    tip.id = TOOLTIP_ID;
    tip.textContent = message;
    if (color) tip.style.background = color;
    tip.style.top  = `${rect.top  - 42}px`;
    tip.style.left = `${rect.left - 100}px`;
    document.body.appendChild(tip);
    setTimeout(removeTooltip, duration);
  }

  function removeTooltip() {
    document.getElementById(TOOLTIP_ID)?.remove();
  }

  // ════════════════════════════════════════════════════════════
  //  CONFIRM DIALOG  ("Open new chat?")
  // ════════════════════════════════════════════════════════════

  function showConfirmDialog(result) {
    removeConfirmDialog();
    const dlg = document.createElement('div');
    dlg.id = CONFIRM_ID;
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-label', 'Chat exported');

    dlg.innerHTML = `
      <div class="pcd-title">✅ Chat saved! (${result.messageCount} messages)</div>
      <div class="pcd-body">
        <strong>${result.filename}</strong> downloaded.<br>
        The full chat was also <strong>copied to your clipboard</strong>.<br>
        ${result.newChatUrl ? 'Open a new chat and paste to continue seamlessly.' : ''}
      </div>
      <div class="pcd-actions">
        ${result.newChatUrl
          ? `<button class="pcd-btn-primary" id="promptly-new-chat-btn">🔗 Open New Chat</button>`
          : ''}
        <button class="pcd-btn-secondary" id="promptly-close-dlg-btn">Close</button>
      </div>
    `;

    document.body.appendChild(dlg);

    document.getElementById('promptly-new-chat-btn')?.addEventListener('click', () => {
      window.open(result.newChatUrl, '_blank', 'noopener');
      removeConfirmDialog();
    });
    document.getElementById('promptly-close-dlg-btn')?.addEventListener('click', removeConfirmDialog);

    // Auto-dismiss after 12 seconds
    setTimeout(removeConfirmDialog, 12000);
  }

  function removeConfirmDialog() {
    document.getElementById(CONFIRM_ID)?.remove();
  }

  // ════════════════════════════════════════════════════════════
  //  CLICK HANDLERS
  // ════════════════════════════════════════════════════════════

  async function handleOptimizeClick() {
    if (isRequesting) return;

    const input = detectChatInput();
    const text  = readInputText(input).trim();

    if (!text) {
      showTooltip('✏️  Type something first', '#342EAD', 2500);
      return;
    }

    isRequesting = true;
    const btn = document.getElementById(BUTTON_ID);
    applyOptimizeStyles(btn, 'loading');
    hideUndoButton();

    // Read active project context and selected tone
    let projectContext = '';
    let tone           = 'default';
    try {
      const storage = await new Promise(resolve =>
        chrome.storage.local.get(['projects', 'activeProjectId', 'selectedTone'], resolve)
      );
      const { projects = [], activeProjectId, selectedTone } = storage;
      tone = selectedTone || 'default';
      if (activeProjectId) {
        const proj = projects.find(p => p.id === activeProjectId);
        if (proj) {
          const parts = [];
          if (proj.stackOrDomain) parts.push(`stack: ${proj.stackOrDomain}`);
          if (proj.toneOrStyle)   parts.push(`style: ${proj.toneOrStyle}`);
          if (proj.constraints)   parts.push(`constraints: ${proj.constraints}`);
          if (parts.length > 0) projectContext = `Project context — ${parts.join('; ')}.`;
        }
      }
    } catch (_) { /* non-fatal */ }

    // Store original text for undo
    lastOriginalText = text;

    try {
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: 'OPTIMIZE_PROMPT', text, projectContext, tone },
          resp => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(resp);
          }
        );
      });

      if (response?.success) {
        writeInputText(input, response.optimizedPrompt);
        btn.style.background = '#26E0B5';
        setTimeout(() => {
          applyOptimizeStyles(btn, 'idle');
          showUndoButton(btn);
          repositionAll();
        }, 800);
      } else {
        throw new Error(response?.error || 'Unknown error');
      }
    } catch (err) {
      console.error('[Promptly] Optimization failed:', err);
      showTooltip(`❌  ${(err?.message || 'Unknown error').slice(0, 120)}`, '#8B1A1A', 6000);
      applyOptimizeStyles(btn, 'idle');
      lastOriginalText = null;
    } finally {
      isRequesting = false;
    }
  }

  function handleUndoClick() {
    if (!lastOriginalText) return;
    const input = currentInput || detectChatInput();
    if (!input) return;
    writeInputText(input, lastOriginalText);
    hideUndoButton();
    showTooltip('↩️  Original text restored', '#342EAD', 2000);
  }

  async function handleSaveClick() {
    if (isSaving) return;
    if (!window.PromptlyExporter) {
      showTooltip('❌  Exporter not loaded — reload the page', '#8B1A1A', 4000);
      return;
    }

    isSaving = true;
    const saveBtn = document.getElementById(SAVE_BTN_ID);
    if (saveBtn) applySaveStyles(saveBtn, 'loading');
    removeConfirmDialog();

    try {
      const result = await window.PromptlyExporter.exportChat();

      if (result.success) {
        // Reset pulse state now that user acted
        limitDetected = false;
        if (saveBtn) applySaveStyles(saveBtn, 'idle');
        showConfirmDialog(result);
      } else {
        showTooltip(`❌  ${result.error}`, '#8B1A1A', 5000);
        if (saveBtn) applySaveStyles(saveBtn, 'idle');
      }
    } catch (err) {
      console.error('[Promptly] Save chat failed:', err);
      showTooltip('❌  Could not export chat. Try scrolling the full conversation first.', '#8B1A1A', 6000);
      if (saveBtn) applySaveStyles(saveBtn, 'idle');
    } finally {
      isSaving = false;
    }
  }

  // ════════════════════════════════════════════════════════════
  //  KEYBOARD SHORTCUT HANDLER
  // ════════════════════════════════════════════════════════════

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'PROMPTLY_SHORTCUT') {
      handleOptimizeClick();
    }
  });

  // ════════════════════════════════════════════════════════════
  //  LIMIT DETECTION POLLING
  // ════════════════════════════════════════════════════════════

  function checkForLimit() {
    if (!window.PromptlyExporter?.isAIPlatform()) return;

    const hit = window.PromptlyExporter.detectLimitBanner();
    const saveBtn = document.getElementById(SAVE_BTN_ID);

    if (hit && !limitDetected) {
      limitDetected = true;
      if (saveBtn) {
        applySaveStyles(saveBtn, 'pulse');
        showTooltip('⚠️  Chat limit hit — click 💾 to save & continue', '#7B4F00', 6000);
      }
    } else if (!hit && limitDetected) {
      limitDetected = false;
      if (saveBtn) applySaveStyles(saveBtn, 'idle');
    }
  }

  function startLimitPolling() {
    if (limitPollTimer) clearInterval(limitPollTimer);
    limitPollTimer = setInterval(checkForLimit, LIMIT_POLL_MS);
  }

  // ════════════════════════════════════════════════════════════
  //  ATTACHMENT & LIFECYCLE
  // ════════════════════════════════════════════════════════════

  function attachButtons() {
    injectStyles();
    const input   = detectChatInput();
    const optBtn  = createOptimizeButton();
    const saveBtn = createSaveButton(); // null if not on AI platform
    createUndoButton();

    currentInput = input;
    positionOptimizeButton(optBtn, input);
    if (saveBtn) positionSaveButton(saveBtn, optBtn);
  }

  function onFocusIn(e) {
    const el = e.target;
    if (
      el &&
      (el.tagName === 'TEXTAREA' ||
        (el.contentEditable === 'true' && el.tagName !== 'BODY'))
    ) {
      currentInput = el;
      const optBtn  = document.getElementById(BUTTON_ID);
      const saveBtn = document.getElementById(SAVE_BTN_ID);
      const undoBtn = document.getElementById(UNDO_BTN_ID);
      if (optBtn)  positionOptimizeButton(optBtn, el);
      if (undoBtn) positionUndoButton(undoBtn, optBtn);
      if (saveBtn) positionSaveButton(saveBtn, optBtn);
    }
  }

  function startObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => {
      // Debounce to avoid hammering on mutation-heavy pages (ChatGPT, Claude)
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (currentInput && !document.body.contains(currentInput)) {
          currentInput = null;
          attachButtons();
        } else if (!currentInput) {
          attachButtons();
        } else {
          repositionAll();
        }
      }, DEBOUNCE_MS);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ════════════════════════════════════════════════════════════
  //  BOOTSTRAP
  // ════════════════════════════════════════════════════════════

  function init() {
    attachButtons();
    startObserver();
    startLimitPolling();
    document.addEventListener('focusin',  onFocusIn, true);
    window.addEventListener('scroll',     repositionAll, { passive: true });
    window.addEventListener('resize',     repositionAll, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
