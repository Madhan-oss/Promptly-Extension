// ──────────────────────────────────────────────────────────────
//  Promptly — Popup Script (v1.2.0)
// ──────────────────────────────────────────────────────────────
'use strict';

const DEFAULT_GROQ_API_KEY = "YOUR_DEFAULT_GROQ_API_KEY_HERE";
const PROXY_API_URL   = "https://promptly-umber.vercel.app/api/optimize";

// ════════════════════════════════════════════════════════════
//  MASTER ON / OFF TOGGLE
// ════════════════════════════════════════════════════════════
const masterToggle = document.getElementById('master-toggle-input');

function applyEnabledState(enabled) {
  masterToggle.checked = enabled;
  document.body.classList.toggle('promptly-disabled', !enabled);
}

// Load saved state
chrome.storage.local.get('promptlyEnabled', ({ promptlyEnabled }) => {
  const enabled = promptlyEnabled !== false; // default ON
  applyEnabledState(enabled);
});

masterToggle?.addEventListener('change', () => {
  const enabled = masterToggle.checked;
  chrome.storage.local.set({ promptlyEnabled: enabled });
  applyEnabledState(enabled);

  // Notify the active tab's content script immediately
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'PROMPTLY_TOGGLE', enabled });
    }
  });
});


// ════════════════════════════════════════════════════════════
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.tab-content').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    document.getElementById(`panel-${target}`).classList.add('active');

    // Refresh history tab when opened
    if (target === 'history') loadHistory();
  });
});

// ════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════
function showStatus(elId, message, type, duration = 3000) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = message;
  el.className = `status-msg ${type}`;
  if (duration > 0) {
    setTimeout(() => { el.className = 'status-msg'; el.textContent = ''; }, duration);
  }
}

function generateId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch (_) { return iso; }
}

// ── Test Connection button ───────────────────────────────────
const testConnectionBtn = document.getElementById('test-connection-btn');

testConnectionBtn?.addEventListener('click', () => {
  testConnectionBtn.disabled = true;
  testConnectionBtn.textContent = '⏳ Testing Connection…';
  showStatus('settings-status', '', '');

  chrome.runtime.sendMessage({ type: 'TEST_API_KEY', apiKey: "" }, (response) => {
    testConnectionBtn.disabled = false;
    testConnectionBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
           width="13" height="13" fill="none" stroke="currentColor"
           stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
      Test Connection`;

    if (response?.success) {
      showStatus('settings-status', '✅  Default cloud proxy is online and ready!', 'success', 4000);
    } else {
      const msg = response?.error || 'Unknown error';
      showStatus('settings-status', `❌  ${msg.slice(0, 80)}`, 'error', 6000);
    }
  });
});

// ── Usage Metrics ─────────────────────────────────────────────
function loadMetrics() {
  chrome.storage.local.get(['promptly_calls', 'promptly_total_ms', 'promptly_month'], (data) => {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${now.getMonth()}`;

    // Reset if new month
    if (data.promptly_month !== monthKey) {
      chrome.storage.local.set({ promptly_calls: 0, promptly_total_ms: 0, promptly_month: monthKey });
      return;
    }

    const calls = data.promptly_calls || 0;
    const totalMs = data.promptly_total_ms || 0;
    const avgMs = calls > 0 ? Math.round(totalMs / calls) : null;
    const pct = Math.min((calls / 200) * 100, 100);

    const callsEl = document.getElementById('metric-calls');
    const barEl   = document.getElementById('metric-bar');
    const timeEl  = document.getElementById('metric-time');

    if (callsEl) callsEl.textContent = calls.toLocaleString();
    if (barEl)   setTimeout(() => barEl.style.width = pct + '%', 80);
    if (timeEl)  timeEl.textContent = avgMs ? `${avgMs}ms` : '—';
  });
}
loadMetrics();

// ── Reset Metrics ─────────────────────────────────────────────
document.getElementById('reset-metrics-btn')?.addEventListener('click', () => {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${now.getMonth()}`;
  chrome.storage.local.set({ promptly_calls: 0, promptly_total_ms: 0, promptly_month: monthKey }, () => {
    loadMetrics();
    showStatus('settings-status', '✅  Metrics reset successfully.', 'success', 3000);
  });
});

// ── Quick Shortcut Cards ──────────────────────────────────────
const SHORTCUT_TONES = {
  'shortcut-creative':   'creative',
  'shortcut-precision':  'technical',
  'shortcut-structural': 'default',
};

Object.entries(SHORTCUT_TONES).forEach(([id, tone]) => {
  document.getElementById(id)?.addEventListener('click', () => {
    // Get the active tab and send optimize message with forced tone
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: 'TRIGGER_OPTIMIZE', forceTone: tone });
      window.close();
    });
  });
});

// ── Auto-creative checkbox ────────────────────────────────────
const autoCreativeCb = document.getElementById('auto-creative-cb');
chrome.storage.local.get('autoCreative', ({ autoCreative }) => {
  if (autoCreativeCb) autoCreativeCb.checked = !!autoCreative;
});
autoCreativeCb?.addEventListener('change', () => {
  chrome.storage.local.set({ autoCreative: autoCreativeCb.checked });
});

// ── Advanced Settings toggle ──────────────────────────────────
const advancedBtn   = document.getElementById('advanced-toggle-btn');
const advancedPanel = document.getElementById('advanced-panel');
advancedBtn?.addEventListener('click', () => {
  const isOpen = advancedPanel.classList.toggle('open');
  advancedBtn.textContent = isOpen ? '[-] Advanced Settings' : '[+] Advanced Settings';
  advancedBtn.setAttribute('aria-expanded', isOpen);
});

// ── Tone selector ────────────────────────────────────────────
const toneSelect = document.getElementById('tone-select');

chrome.storage.local.get('selectedTone', ({ selectedTone }) => {
  if (selectedTone) toneSelect.value = selectedTone;
});

toneSelect.addEventListener('change', () => {
  chrome.storage.local.set({ selectedTone: toneSelect.value });
});


// ════════════════════════════════════════════════════════════
//  PROJECTS TAB
// ════════════════════════════════════════════════════════════

const projectsList      = document.getElementById('projects-list');
const activeProjectSel  = document.getElementById('active-project-select');
const addProjectBtn     = document.getElementById('add-project-btn');
const addProjectForm    = document.getElementById('add-project-form');
const cancelProjectBtn  = document.getElementById('cancel-project-btn');
const saveProjectBtn    = document.getElementById('save-project-btn');
const projNameInput     = document.getElementById('proj-name');
const projStackInput    = document.getElementById('proj-stack');
const projToneInput     = document.getElementById('proj-tone');
const projConsInput     = document.getElementById('proj-constraints');

let editingProjectId = null;

function loadProjects() {
  chrome.storage.local.get(['projects', 'activeProjectId'], ({ projects = [], activeProjectId }) => {
    renderProjectList(projects);
    renderProjectSelect(projects, activeProjectId);
  });
}

function renderProjectSelect(projects, activeProjectId) {
  activeProjectSel.innerHTML = '<option value="">— None —</option>';
  projects.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    if (p.id === activeProjectId) opt.selected = true;
    activeProjectSel.appendChild(opt);
  });
}

function renderProjectList(projects) {
  if (projects.length === 0) {
    projectsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        No projects yet. Add one to give Promptly extra context.
      </div>`;
    return;
  }

  projectsList.innerHTML = '';
  projects.forEach(proj => {
    const card = document.createElement('div');
    card.className = 'project-card';
    card.dataset.id = proj.id;

    const metaParts = [];
    if (proj.stackOrDomain) metaParts.push(`<span><span class="meta-label">Stack:</span> ${escapeHtml(proj.stackOrDomain)}</span>`);
    if (proj.toneOrStyle)   metaParts.push(`<span><span class="meta-label">Style:</span> ${escapeHtml(proj.toneOrStyle)}</span>`);
    if (proj.constraints)   metaParts.push(`<span><span class="meta-label">Constraints:</span> ${escapeHtml(proj.constraints)}</span>`);

    card.innerHTML = `
      <div class="project-card-header">
        <span class="project-name">${escapeHtml(proj.name)}</span>
        <div class="project-card-actions">
          <button class="btn-icon edit-project-btn" data-id="${proj.id}" title="Edit project"
                  aria-label="Edit ${escapeHtml(proj.name)}">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="13" height="13"
                 fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="btn-danger delete-project-btn" data-id="${proj.id}"
                  aria-label="Delete ${escapeHtml(proj.name)}">Delete</button>
        </div>
      </div>
      ${metaParts.length ? `<div class="project-meta">${metaParts.join('')}</div>` : ''}
    `;
    projectsList.appendChild(card);
  });

  projectsList.querySelectorAll('.edit-project-btn').forEach(btn =>
    btn.addEventListener('click', () => startEditProject(btn.dataset.id))
  );
  projectsList.querySelectorAll('.delete-project-btn').forEach(btn =>
    btn.addEventListener('click', () => deleteProject(btn.dataset.id))
  );
}

activeProjectSel.addEventListener('change', () => {
  const id = activeProjectSel.value || null;
  chrome.storage.local.set({ activeProjectId: id });
});

function openForm(project = null) {
  editingProjectId          = project ? project.id : null;
  projNameInput.value       = project?.name          ?? '';
  projStackInput.value      = project?.stackOrDomain ?? '';
  projToneInput.value       = project?.toneOrStyle   ?? '';
  projConsInput.value       = project?.constraints   ?? '';
  saveProjectBtn.textContent = project ? 'Update Project' : 'Save Project';
  addProjectForm.classList.add('open');
  addProjectBtn.setAttribute('aria-expanded', 'true');
  projNameInput.focus();
}

function closeForm() {
  addProjectForm.classList.remove('open');
  addProjectBtn.setAttribute('aria-expanded', 'false');
  editingProjectId = null;
}

addProjectBtn.addEventListener('click', () => {
  if (addProjectForm.classList.contains('open')) closeForm();
  else openForm();
});

cancelProjectBtn.addEventListener('click', closeForm);

addProjectForm.addEventListener('submit', e => {
  e.preventDefault();
  const name = projNameInput.value.trim();
  if (!name) { projNameInput.focus(); return; }

  chrome.storage.local.get('projects', ({ projects = [] }) => {
    if (editingProjectId) {
      const idx = projects.findIndex(p => p.id === editingProjectId);
      if (idx !== -1) {
        projects[idx] = {
          ...projects[idx],
          name,
          stackOrDomain: projStackInput.value.trim(),
          toneOrStyle:   projToneInput.value.trim(),
          constraints:   projConsInput.value.trim(),
        };
      }
    } else {
      projects.push({
        id:            generateId(),
        name,
        stackOrDomain: projStackInput.value.trim(),
        toneOrStyle:   projToneInput.value.trim(),
        constraints:   projConsInput.value.trim(),
      });
    }
    chrome.storage.local.set({ projects }, () => { closeForm(); loadProjects(); });
  });
});

function startEditProject(id) {
  chrome.storage.local.get('projects', ({ projects = [] }) => {
    const proj = projects.find(p => p.id === id);
    if (proj) openForm(proj);
  });
}

function deleteProject(id) {
  chrome.storage.local.get(['projects', 'activeProjectId'], ({ projects = [], activeProjectId }) => {
    const updated   = projects.filter(p => p.id !== id);
    const newActive = activeProjectId === id ? null : activeProjectId;
    chrome.storage.local.set({ projects: updated, activeProjectId: newActive }, loadProjects);
  });
}

loadProjects();

// ════════════════════════════════════════════════════════════
//  HISTORY TAB
// ════════════════════════════════════════════════════════════

const historyList     = document.getElementById('history-list');
const clearHistoryBtn = document.getElementById('clear-history-btn');
const clearConfirmRow = document.getElementById('clear-confirm-row');
const clearConfirmYes = document.getElementById('clear-confirm-yes');
const clearConfirmNo  = document.getElementById('clear-confirm-no');

function loadHistory() {
  chrome.storage.local.get('chatHistory', ({ chatHistory = [] }) => {
    renderHistoryList(chatHistory);
  });
}

function renderHistoryList(history) {
  if (history.length === 0) {
    historyList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">💬</div>
        No chat exports yet.<br>
        Click the <strong>💾 Save Chat</strong> button on any AI chat page.
      </div>`;
    return;
  }

  historyList.innerHTML = '';
  history.forEach(entry => {
    const card = document.createElement('div');
    card.className = 'history-card';
    card.innerHTML = `
      <div class="history-header">
        <div class="history-platform">
          <span class="history-platform-badge">${escapeHtml(entry.platform)}</span>
          <span class="history-msg-count">${entry.messageCount} messages</span>
        </div>
        <span class="history-date">${formatDate(entry.date)}</span>
      </div>
      <div class="history-filename">${escapeHtml(entry.filename)}</div>
      <div class="history-actions">
        <button class="btn-hist-dl"   data-id="${entry.id}" title="Re-download">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12"
               fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Download
        </button>
        <button class="btn-hist-copy" data-id="${entry.id}" title="Copy to clipboard">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12"
               fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          Copy
        </button>
        <button class="btn-hist-del"  data-id="${entry.id}" title="Delete export">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12"
               fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6M14 11v6"/>
          </svg>
          Delete
        </button>
      </div>
    `;
    historyList.appendChild(card);
  });

  // Wire up buttons
  historyList.querySelectorAll('.btn-hist-dl').forEach(btn =>
    btn.addEventListener('click', () => reDownloadExport(btn.dataset.id))
  );
  historyList.querySelectorAll('.btn-hist-copy').forEach(btn =>
    btn.addEventListener('click', () => copyExport(btn.dataset.id, btn))
  );
  historyList.querySelectorAll('.btn-hist-del').forEach(btn =>
    btn.addEventListener('click', () => deleteExport(btn.dataset.id))
  );
}

function reDownloadExport(id) {
  chrome.storage.local.get('chatHistory', ({ chatHistory = [] }) => {
    const entry = chatHistory.find(e => e.id === id);
    if (!entry) return;
    const blob = new Blob([entry.content], { type: 'text/markdown;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = entry.filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  });
}

function copyExport(id, btn) {
  chrome.storage.local.get('chatHistory', ({ chatHistory = [] }) => {
    const entry = chatHistory.find(e => e.id === id);
    if (!entry) return;
    const orig = btn.innerHTML;
    navigator.clipboard.writeText(entry.content).then(() => {
      btn.textContent = '✅ Copied!';
      setTimeout(() => { btn.innerHTML = orig; }, 2000);
    }).catch(() => {
      btn.textContent = '❌ Failed';
      setTimeout(() => { btn.innerHTML = orig; }, 2000);
    });
  });
}

function deleteExport(id) {
  chrome.storage.local.get('chatHistory', ({ chatHistory = [] }) => {
    const updated = chatHistory.filter(e => e.id !== id);
    chrome.storage.local.set({ chatHistory: updated }, loadHistory);
  });
}

// Inline Clear All confirmation — no native confirm()
clearHistoryBtn.addEventListener('click', () => {
  clearConfirmRow.style.display = 'flex';
  clearHistoryBtn.style.display = 'none';
});

clearConfirmNo.addEventListener('click', () => {
  clearConfirmRow.style.display = 'none';
  clearHistoryBtn.style.display = '';
});

clearConfirmYes.addEventListener('click', () => {
  chrome.storage.local.set({ chatHistory: [] }, () => {
    clearConfirmRow.style.display = 'none';
    clearHistoryBtn.style.display = '';
    loadHistory();
  });
});
